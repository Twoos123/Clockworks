// Packages the game as one Windows executable (Node's single executable applications): the
// launcher (server/play.ts) bundled to one script, the built game (dist/) embedded as assets, and
// a copy of node.exe with both injected. The result, release/SpiralKnightsWeb.exe, finds the
// player's Spiral Knights install, serves the game on localhost and opens the browser. It holds
// no game files: everything the game shows is read from the player's own install.
//
//   npm run package
//
// Needs `postject` (the Node project's tool for injecting the blob into the executable).

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { build } from "esbuild";

const root = join(import.meta.dirname, "..");
const out = join(root, "release");
mkdirSync(out, { recursive: true });

// 1. the game, built
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { cwd: root, stdio: "inherit", shell: true });

// 2. the launcher as one CommonJS script (single executables run CommonJS)
await build({
  entryPoints: [join(root, "server", "play.ts")], bundle: true, platform: "node", format: "cjs", target: "node22",
  outfile: join(out, "play.cjs"), supported: { "top-level-await": true }, logLevel: "warning",
  // import.meta has no meaning in CommonJS; the packaged launcher serves dist/ from its assets
  define: { "import.meta.dirname": "__dirname", "import.meta.url": "undefined" },
});

// 3. the single-executable config: the script plus every built file as an asset
const dist = join(root, "dist");
const assets: Record<string, string> = {};
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else assets[relative(dist, p).split(sep).join("/")] = p;
  }
};
walk(dist);
writeFileSync(join(out, "sea-config.json"), JSON.stringify({
  main: join(out, "play.cjs"), output: join(out, "sea-prep.blob"), disableExperimentalSEAWarning: true, assets,
}, null, 1));
execFileSync(process.execPath, ["--experimental-sea-config", join(out, "sea-config.json")], { stdio: "inherit" });

// 4. node.exe with the blob injected
const exe = join(out, process.platform === "win32" ? "SpiralKnightsWeb.exe" : "SpiralKnightsWeb");
copyFileSync(process.execPath, exe);
const postject = join(root, "node_modules", ".bin", process.platform === "win32" ? "postject.cmd" : "postject");
if (!existsSync(postject)) { console.log("postject is not installed: run `npm install --save-dev postject`, then this again."); process.exit(1); }
execFileSync(postject, [exe, "NODE_SEA_BLOB", join(out, "sea-prep.blob"), "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : [])], { stdio: "inherit", shell: true });
console.log(`Built ${exe}`);
