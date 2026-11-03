// Servidor local: sirve los archivos estáticos y ejecuta las funciones de /api
// igual que Vercel (handlers GET/POST/... que reciben un Request y devuelven un Response).
// Uso: npm run dev   (lee .env.local; sin Turso usa una base local en archivo)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

process.env.TURSO_DATABASE_URL ||= "file:local.db";
const PORT = Number(process.env.PORT) || 5173;
const ROOT = process.cwd();
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const name = url.pathname.slice(5).replace(/[^a-z-]/g, "");
      const mod = await import(pathToFileURL(join(ROOT, "api", `${name}.js`)).href);
      const handler = mod[req.method];
      if (!handler) return res.writeHead(405).end();
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (path.startsWith("..")) throw Object.assign(new Error(), { code: "ENOENT" });
    if (!path || path.endsWith("/") || path.endsWith("\\")) path += "index.html";
    if (!extname(path)) path += ".html";
    const file = await readFile(join(ROOT, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(file);
  } catch (err) {
    if (err.code !== "ENOENT" && err.code !== "ERR_MODULE_NOT_FOUND") console.error(err);
    res.writeHead(404, { "content-type": "text/plain" }).end("No encontrado");
  }
}).listen(PORT, () => console.log(`HZ Suplementos en http://localhost:${PORT}`));
