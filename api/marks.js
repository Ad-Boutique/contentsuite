// Gemeinsame Markierungen: GET liest alles (mit Revisionsnummer), POST schreibt eine Änderung
import { projectId, loadProject, readSession, redis, send, safe } from "./_lib.js";

const STATUS = new Set(["", "must", "maybe", "cut"]);
const ID_RE = /^[a-z0-9]{1,12}$/i;

async function handler(req, res) {
  const id = projectId(req.query.project);
  const project = id && loadProject(id);
  if (!project) return send(res, 404, { error: "Projekt nicht gefunden" });
  const session = readSession(req, id);
  if (!session) return send(res, 401, { error: "Bitte anmelden" });

  const K = (s) => `cs:${id}:${s}`;

  if (req.method === "GET") {
    const since = Number(req.query.since || -1);
    const [rev] = await redis(["GET", K("rev")]);
    const r = Number(rev || 0);
    if (since === r) return send(res, 200, { rev: r, unchanged: true });
    const [marksFlat, settings, general] = await redis(["HGETALL", K("marks")], ["GET", K("settings")], ["GET", K("general")]);
    const marks = {};
    for (let i = 0; i < (marksFlat || []).length; i += 2) {
      try { marks[marksFlat[i]] = JSON.parse(marksFlat[i + 1]); } catch {}
    }
    return send(res, 200, {
      rev: r, marks,
      settings: settings ? JSON.parse(settings) : { goal: 90 },
      general: general ? JSON.parse(general) : { text: "" },
    });
  }

  if (req.method !== "POST") return send(res, 405, { error: "Methode nicht erlaubt" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const at = Date.now(), by = session.n;
  const segIds = new Set(project.segments.map((s) => s.id));

  if (body.kind === "mark") {
    if (!ID_RE.test(body.id || "") || !segIds.has(body.id)) return send(res, 400, { error: "Unbekannte Passage" });
    const status = String(body.status || "");
    if (!STATUS.has(status)) return send(res, 400, { error: "Ungültiger Status" });
    const comment = String(body.comment || "").slice(0, 2000);
    const pos = Math.max(0, Math.min(999, parseInt(body.pos, 10) || 0));
    const cmds = !status && !comment && !pos
      ? [["HDEL", K("marks"), body.id]]
      : [["HSET", K("marks"), body.id, JSON.stringify({ status, comment, pos, by, at })]];
    const out = await redis(...cmds, ["INCR", K("rev")], ["LPUSH", K("log"), JSON.stringify({ id: body.id, status, comment, pos, by, at })], ["LTRIM", K("log"), 0, 1999]);
    return send(res, 200, { ok: true, rev: out[1] });
  }
  if (body.kind === "settings") {
    const goal = Math.max(10, Math.min(3600, parseInt(body.goal, 10) || 90));
    const out = await redis(["SET", K("settings"), JSON.stringify({ goal, by, at })], ["INCR", K("rev")]);
    return send(res, 200, { ok: true, rev: out[1] });
  }
  if (body.kind === "general") {
    const text = String(body.text || "").slice(0, 10000);
    const out = await redis(["SET", K("general"), JSON.stringify({ text, by, at })], ["INCR", K("rev")]);
    return send(res, 200, { ok: true, rev: out[1] });
  }
  return send(res, 400, { error: "Unbekannte Änderung" });
}

export default safe(handler);
