// Lokaler Testserver: bildet Vercel-Routing nach und ersetzt Redis durch einen Speicher im Arbeitsspeicher.
// Start: SESSION_SECRET=... ACCESS_CODES=ksg26=TEST-1234 node scripts/devserver.mjs
import http from "node:http";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { join, extname } from "node:path";

const mem = new Map();
const fakeRedis = (cmds) => cmds.map(([c, k, ...a]) => {
  c = c.toUpperCase();
  if (c === "GET") return { result: mem.get(k) ?? null };
  if (c === "SET") { mem.set(k, a[0]); return { result: "OK" }; }
  if (c === "DEL") { mem.delete(k); return { result: 1 }; }
  if (c === "INCR") { const v = Number(mem.get(k) || 0) + 1; mem.set(k, String(v)); return { result: v }; }
  if (c === "EXPIRE") return { result: 1 };
  if (c === "PING") return { result: "PONG" };
  if (c === "HSET") { const h = mem.get(k) || {}; h[a[0]] = a[1]; mem.set(k, h); return { result: 1 }; }
  if (c === "HDEL") { const h = mem.get(k) || {}; delete h[a[0]]; mem.set(k, h); return { result: 1 }; }
  if (c === "HGETALL") { const h = mem.get(k) || {}; return { result: Object.entries(h).flat() }; }
  if (c === "LPUSH" || c === "LTRIM") return { result: 1 };
  return { error: "unbekannt " + c };
});
const realFetch = globalThis.fetch;
const useFake = !process.env.REDIS_URL;   // mit REDIS_URL=redis://localhost:6379 gegen echtes Redis testen
if (useFake) { process.env.UPSTASH_REDIS_REST_URL = "http://fake-redis"; process.env.UPSTASH_REDIS_REST_TOKEN = "x"; }
if (useFake) globalThis.fetch = async (url, opts) => String(url).startsWith("http://fake-redis")
  ? new Response(JSON.stringify(fakeRedis(JSON.parse(opts.body))), { status: 200 }) : realFetch(url, opts);

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".txt": "text/plain" };
const root = process.cwd();
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  req.query = Object.fromEntries(u.searchParams);
  if (u.pathname.startsWith("/api/")) {
    let body = ""; for await (const ch of req) body += ch;
    req.body = body ? JSON.parse(body) : {};
    req.headers["x-forwarded-for"] = "127.0.0.1";
    const mod = await import(join(root, "api", u.pathname.slice(5) + ".js"));
    const end = res.end.bind(res); res.status = (s) => { res.statusCode = s; return res; };
    try { await mod.default(req, res); } catch (e) { res.statusCode = 500; end(String(e)); }
    return;
  }
  let p = join(root, "public", u.pathname);
  if (u.pathname === "/") p = join(root, "public", "index.html");
  else if (/^\/[a-z0-9-]+$/.test(u.pathname) && !existsSync(p)) p = join(root, "public", "app.html");
  if (!existsSync(p) || statSync(p).isDirectory()) { res.statusCode = 404; return res.end("404"); }
  const size = statSync(p).size, range = req.headers.range;
  res.setHeader("Content-Type", types[extname(p)] || "application/octet-stream"); res.setHeader("Accept-Ranges", "bytes");
  if (range) { const [a, b] = range.replace("bytes=", "").split("-"); const s = +a, e = b ? +b : size - 1;
    res.statusCode = 206; res.setHeader("Content-Range", `bytes ${s}-${e}/${size}`); res.setHeader("Content-Length", e - s + 1); return createReadStream(p, { start: s, end: e }).pipe(res); }
  res.setHeader("Content-Length", size); createReadStream(p).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log("http://localhost:" + (process.env.PORT || 3000)));
