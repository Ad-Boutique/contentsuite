import { projectId, loadProject, checkCode, makeSession, sessionCookie, redis, clientIp, send, safe } from "./_lib.js";

async function handler(req, res) {
  if (req.method === "DELETE") {
    const id = projectId(req.query.project);
    if (id) res.setHeader("Set-Cookie", sessionCookie(id, "", 0));
    return send(res, 200, { ok: true });
  }
  if (req.method !== "POST") return send(res, 405, { error: "Methode nicht erlaubt" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const id = projectId(body.project);
  if (!id || !loadProject(id)) return send(res, 404, { error: "Projekt nicht gefunden" });

  const name = String(body.name || "").trim().slice(0, 60);
  if (name.length < 2) return send(res, 400, { error: "Bitte geben Sie Ihren Namen ein." });

  // Schutz gegen Durchprobieren: höchstens 10 Versuche pro IP und Projekt in 15 Minuten
  const key = `cs:${id}:login:${clientIp(req)}`;
  const [tries] = await redis(["INCR", key]);
  if (tries === 1) await redis(["EXPIRE", key, 900]);
  if (tries > 10) return send(res, 429, { error: "Zu viele Versuche. Bitte in 15 Minuten erneut probieren." });

  if (!checkCode(id, body.code)) return send(res, 401, { error: "Der Zugangscode stimmt nicht." });

  await redis(["DEL", key]);
  res.setHeader("Set-Cookie", sessionCookie(id, makeSession(id, name), 60 * 60 * 24 * 60));
  return send(res, 200, { ok: true, name });
}

export default safe(handler);
