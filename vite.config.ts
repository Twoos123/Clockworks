import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Development-only: serves the developer's own local install so the viewer can be tested
// without a folder picker. It is registered only for `vite` (serve), never for builds,
// and only listens on localhost. Set SK_DIR to point at a different install.
const SK_DIR = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";

function localInstall(): Plugin {
  const rsrc = join(SK_DIR, "rsrc");
  let listing: string[] | null = null;
  const walk = (dir: string, prefix: string, out: string[]) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, prefix + name + "/", out);
      else out.push(prefix + name);
    }
    return out;
  };
  return {
    name: "local-install",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__sk", (req, res) => {
        if (!existsSync(rsrc)) { res.statusCode = 404; res.end(); return; }
        const url = decodeURIComponent((req.url ?? "").split("?")[0]);
        if (url === "/ping") { res.end("ok"); return; }
        if (url === "/list") {
          listing ??= walk(rsrc, "", []);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(listing));
          return;
        }
        if (url === "/configjar") {
          // the one file served from code/: a data archive the viewer extracts colordefs from
          const jar = join(SK_DIR, "code", "projectx-config.jar");
          if (!existsSync(jar)) { res.statusCode = 404; res.end(); return; }
          createReadStream(jar).pipe(res);
          return;
        }
        const scenes = join(SK_DIR, "scenes");
        if (url === "/scenelist") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(existsSync(scenes) ? readdirSync(scenes).filter(n => /^[0-9]+$/.test(n)) : []));
          return;
        }
        if (url.startsWith("/scenes/")) {
          const name = url.substring(8);
          const file = join(scenes, name);
          if (!/^[0-9]+$/.test(name) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
          createReadStream(file).pipe(res);
          return;
        }
        if (url.startsWith("/rsrc/")) {
          const file = normalize(join(rsrc, url.substring(6)));
          if (!file.startsWith(normalize(rsrc) + sep) || !existsSync(file)) {
            res.statusCode = 404; res.end(); return;
          }
          createReadStream(file).pipe(res);
          return;
        }
        res.statusCode = 404; res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [localInstall()],
  server: { host: "localhost", port: 5174 },
  build: { target: "es2022" },
});
