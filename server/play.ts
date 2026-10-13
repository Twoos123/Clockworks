// The game's launcher: finds the Spiral Knights install, serves the built game (dist/) and the
// install's files on localhost only, and opens the browser. `npm start` builds first.

import { exec } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { archiveDir, candidates, detectInstall, installMiddleware, syncArchive } from "./install";

const DIST = normalize(join(import.meta.dirname, "..", "dist"));
const PORT = Number(process.env.PORT ?? 5175);
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon" };

const install = detectInstall();
if (install) {
  console.log(`Spiral Knights found at ${install}`);
  const n = syncArchive(install);
  console.log(`Level archive: ${archiveDir()} (${n} new level${n === 1 ? "" : "s"} saved)`);
}
else {
  console.log("Spiral Knights was not found. Looked in:\n  " + candidates().join("\n  ") + "\nSet SK_DIR to the install folder and run again.");
}
if (!existsSync(join(DIST, "index.html"))) { console.log("No build found: run `npm start` (it builds first)."); process.exit(1); }

const sk = installMiddleware(() => install);
createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (url.startsWith("/__sk/")) { req.url = req.url!.substring(5); sk(req, res); return; }
  let file = normalize(join(DIST, decodeURIComponent(url)));
  if (!file.startsWith(DIST + sep) && file !== DIST) { res.statusCode = 403; res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`Playing at ${url}`);
  if (!process.env.NO_OPEN) exec(process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open ${url}` : `xdg-open ${url}`);
});
