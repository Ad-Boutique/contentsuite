// Statusseite ohne Geheimnisse: zeigt nur, ob die Einrichtung vollständig ist
import { redis, redisMode, send, safe } from "./_lib.js";

async function handler(req, res) {
  const secretOk = !!(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 24);
  const codes = String(process.env.ACCESS_CODES || "").split(",").map((p) => p.split("=")[0].trim()).filter(Boolean);
  const mode = redisMode().mode;
  let db = "nicht verbunden";
  if (mode !== "none") {
    try { const [pong] = await redis(["PING"]); db = pong === "PONG" ? "ok" : "unerwartete Antwort"; }
    catch (e) { db = "Fehler: " + e.message; }
  }
  const hub = !!(process.env.HUB_WEBHOOK_URL && process.env.HUB_WEBHOOK_SECRET);
  return send(res, 200, { sessionSecret: secretOk, projekteMitCode: codes.length, teamCode: !!process.env.TEAM_CODE, datenbank: db, datenbankArt: mode, hubBenachrichtigung: hub ? "eingerichtet" : "aus" });
}
export default safe(handler);
