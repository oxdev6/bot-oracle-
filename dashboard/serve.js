/* Minimal zero-dependency static file server for the dashboard (demo use). */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "out");
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        // SPA fallback
        if (urlPath === "/_not-found") { res.writeHead(404).end("Not found"); return; }
        filePath = path.join(ROOT, "index.html");
      }
      fs.readFile(filePath, (e, buf) => {
        if (e) { res.writeHead(500).end(String(e)); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
        res.end(buf);
      });
    });
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`serving dashboard from ${ROOT} on http://localhost:${PORT}`);
  });