// Benachrichtigung an boutique.OS (Hub), wenn Kund:innen Feedback geben.
// Bleibt still, solange HUB_WEBHOOK_URL oder HUB_WEBHOOK_SECRET fehlen. Gebündelt: höchstens eine Meldung je Projekt
// alle NOTIFY_WINDOW_MIN Minuten (Standard 30); Änderungen des ad.boutique-Teams lösen nichts aus.
// Vertrag mit dem Hub: docs/hub-benachrichtigung.md
import { createHmac } from "node:crypto";
import { redis } from "./_lib.js";

const STATUS_DE = { must: "Muss rein", maybe: "Optional", cut: "Raus" };

export async function notifyHub(id, project, session, publicBase) {
  const url = process.env.HUB_WEBHOOK_URL, secret = process.env.HUB_WEBHOOK_SECRET;
  if (!url || !secret || session.r === "team") return;
  const recipients = Array.isArray(project.notify) ? project.notify.filter((e) => /^[^@\s]+@ad\.boutique$/i.test(e)) : [];
  if (!recipients.length) return;

  const windowMin = Math.max(5, Number(process.env.NOTIFY_WINDOW_MIN || 30));
  const lockKey = `cs:${id}:notify:lock`;
  // Sperre setzen; ist sie schon da, wurde in diesem Zeitfenster bereits gemeldet
  const [got] = await redis(["SET", lockKey, String(Date.now()), "NX", "EX", windowMin * 60]);
  if (got !== "OK") return;

  const [lastRaw, logRaw] = await redis(["GET", `cs:${id}:notify:last`], ["LRANGE", `cs:${id}:log`, 0, 499]);
  const since = Number(lastRaw || 0);
  const entries = (logRaw || []).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && !e.team && e.at > since);
  const people = [...new Set(entries.map((e) => e.by))];
  const count = { must: 0, maybe: 0, cut: 0, comments: 0 };
  const seen = new Set();
  for (const e of entries) {             // neuester Stand je Passage zählt
    if (seen.has(e.id)) continue; seen.add(e.id);
    if (count[e.status] !== undefined) count[e.status]++;
    if (e.comment) count.comments++;
  }
  const parts = Object.entries(STATUS_DE).filter(([k]) => count[k]).map(([k, v]) => `${count[k]}× ${v}`);
  if (count.comments) parts.push(`${count.comments} Kommentar${count.comments > 1 ? "e" : ""}`);
  const who = people.length ? people.join(", ") : session.n;
  const text = `${who} ${people.length > 1 ? "geben" : "gibt"} Feedback in der Content Suite: ${project.title}` + (parts.length ? ` (${parts.join(", ")})` : "");

  const now = Date.now();
  const payload = {
    event: "contentsuite.feedback",
    project: id,
    projectTitle: project.title,
    client: project.client || null,
    actors: people.length ? people : [session.n],
    summary: { ...count, changes: entries.length },
    text,
    link: `${publicBase}/${id}`,
    recipients,
    dedupeKey: `contentsuite:${id}:${Math.floor(now / (windowMin * 60000))}`,
    sentAt: new Date(now).toISOString(),
  };
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(now / 1000));
  const sig = createHmac("sha256", secret).update(ts + "." + body).digest("hex");
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, { method: "POST", signal: ctrl.signal, headers: {
      "Content-Type": "application/json", "X-Contentsuite-Timestamp": ts, "X-Contentsuite-Signature": "sha256=" + sig } , body });
    clearTimeout(t);
    if (!res.ok) throw new Error("Hub antwortet " + res.status);
    await redis(["SET", `cs:${id}:notify:last`, String(now)], ["SET", `cs:${id}:notify:status`, JSON.stringify({ ok: true, at: now })]);
  } catch (e) {
    // Fehlschlag: Sperre lösen, damit die nächste Änderung es erneut versucht
    await redis(["DEL", lockKey], ["SET", `cs:${id}:notify:status`, JSON.stringify({ ok: false, at: now, error: String(e.message || e).slice(0, 200) })]);
  }
}
