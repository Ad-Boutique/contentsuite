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
  if (!s || s.length < 24) throw new Error("SESSION_SECRET fehlt oder ist zu kurz");
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

// Upstash Redis über REST (Vercel-Marketplace setzt KV_REST_API_* oder UPSTASH_REDIS_REST_*)
function redisConf() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Redis ist nicht verbunden (UPSTASH_REDIS_REST_URL / _TOKEN fehlen)");
  return { url: url.replace(/\/$/, ""), token };
}

export async function redis(...commands) {
  const { url, token } = redisConf();
  const res = await fetch(url + "/pipeline", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error("Redis-Fehler " + res.status);
  const out = await res.json();
  return out.map((r) => { if (r.error) throw new Error(r.error); return r.result; });
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
