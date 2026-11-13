// Gemeinsame Helfer: Projekte, Zugangscodes, Sitzungs-Cookies, Redis (Upstash REST)
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PROJECT_RE = /^[a-z0-9-]{2,40}$/;

export function projectId(raw) {
  const id = String(raw || "").toLowerCase();
  return PROJECT_RE.test(id) ? id : null;
}

export function loadProject(id) {
  const file = join(process.cwd(), "projects", id, "project.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

// ACCESS_CODES="ksg26=CODE-1,anderesprojekt=CODE-2"
function codeFor(id) {
  const all = String(process.env.ACCESS_CODES || "");
  for (const pair of all.split(",")) {
    const [k, ...v] = pair.split("=");
    if (k && k.trim().toLowerCase() === id) return v.join("=").trim();
  }
  return null;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkCode(id, code) {
  const expected = codeFor(id);
  if (!expected) return false;
  return safeEqual(String(code || "").trim().toUpperCase(), expected.toUpperCase());
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 24) throw new HttpError(503, "Server ist noch nicht fertig eingerichtet (SESSION_SECRET)");
  return s;
}
const b64 = (s) => Buffer.from(s).toString("base64url");
const unb64 = (s) => Buffer.from(s, "base64url").toString("utf8");
const sign = (payload) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function makeSession(id, name) {
  const payload = b64(JSON.stringify({ p: id, n: name, t: Date.now() }));
  return payload + "." + sign(payload);
}

export function readSession(req, id) {
  const cookies = Object.fromEntries(
    String(req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((c) => c[0])
  );
  const raw = cookies["cs_" + id];
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const s = JSON.parse(unb64(payload));
    if (s.p !== id) return null;
    if (Date.now() - s.t > 1000 * 60 * 60 * 24 * 60) return null; // 60 Tage
    return s;
  } catch { return null; }
}

export function sessionCookie(id, value, maxAge) {
  return `cs_${id}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// Datenbank: Upstash über REST (Variablen *_KV_REST_API_URL/_TOKEN oder UPSTASH_REDIS_REST_URL/_TOKEN,
// auch mit eigenem Präfix aus dem Vercel-Marketplace) oder klassisches Redis über REDIS_URL.
function findEnv(suffixes) {
  for (const suf of suffixes) {
    if (process.env[suf]) return process.env[suf];
    const k = Object.keys(process.env).find((n) => n.endsWith("_" + suf) && process.env[n]);
    if (k) return process.env[k];
  }
  return null;
}
export function redisMode() {
  const url = findEnv(["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"]);
  const token = findEnv(["UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"]);
  if (url && token) return { mode: "rest", url: url.replace(/\/$/, ""), token };
  const tcp = findEnv(["REDIS_URL", "KV_URL"]);
  if (tcp && /^rediss?:\/\//.test(tcp)) return { mode: "tcp", url: tcp };
  return { mode: "none" };
}

let tcpClient = null;
async function tcp(url) {
  if (tcpClient && tcpClient.isOpen) return tcpClient;
  const { createClient } = await import("redis");
  tcpClient = createClient({ url, socket: { connectTimeout: 5000 } });
  tcpClient.on("error", () => {});
  await tcpClient.connect();
  return tcpClient;
}

export async function redis(...commands) {
  const conf = redisMode();
  if (conf.mode === "rest") {
    const res = await fetch(conf.url + "/pipeline", {
      method: "POST",
      headers: { Authorization: `Bearer ${conf.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new HttpError(503, "Datenbank antwortet nicht (" + res.status + ")");
    const out = await res.json();
    return out.map((r) => { if (r.error) throw new Error(r.error); return r.result; });
  }
  if (conf.mode === "tcp") {
    const c = await tcp(conf.url);
    const out = [];
    for (const cmd of commands) {
      const r = await c.sendCommand(cmd.map(String));
      out.push(typeof r === "string" && /^-?\d+$/.test(r) && cmd[0].toUpperCase() === "INCR" ? Number(r) : r);
    }
    return out;
  }
  throw new HttpError(503, "Datenbank ist nicht verbunden");
}

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// Fehler abfangen, damit statt eines Absturzes eine verständliche Meldung kommt
export function safe(handler) {
  return async (req, res) => {
    try { return await handler(req, res); }
    catch (e) {
      console.error("[contentsuite]", e && e.stack || e);
      const status = e instanceof HttpError ? e.status : 500;
      return send(res, status, { error: status === 500 ? "Interner Fehler. Bitte später erneut versuchen." : e.message });
    }
  };
}

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
