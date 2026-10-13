// Imports levels from a local copy of a community scene archive into the player's private level
// archive (server/install.ts: archiveDir()), so the game can play them. Nothing is copied into
// this repository and nothing is uploaded. Levels the player's own client cached take priority:
// an archived level is never overwritten.
//
//   npx tsx tools/import-scenes.ts [source folder]
//
// The source defaults to <archive>/../scene-archive-src. Files named by a bare scene id are
// imported; revision copies ("<id>_rev2019") are kept aside under <archive>/../scene-revisions.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { archiveDir } from "../server/install";

const archive = archiveDir();
const source = process.argv[2] ?? join(dirname(archive), "scene-archive-src");
const revisions = join(dirname(archive), "scene-revisions");
if (!existsSync(source)) { console.log(`No scene archive at ${source}`); process.exit(1); }
mkdirSync(archive, { recursive: true });
mkdirSync(revisions, { recursive: true });

// the revised archive first, so its copies win over the legacy folders' duplicates
const roots = ["Master", "Legacy"].map(r => join(source, r)).filter(existsSync);
if (!roots.length) roots.push(source);

let imported = 0, kept = 0, revs = 0, procedural = 0;
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    if (name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (/^\d+$/.test(name)) {
      const to = join(archive, name);
      if (existsSync(to)) { kept++; continue; }
      copyFileSync(p, to);
      imported++;
      if (Number(name) > 1073741823) procedural++;
    } else if (/^\d+_rev/.test(name)) {
      const to = join(revisions, name);
      if (!existsSync(to)) { copyFileSync(p, to); revs++; }
    }
  }
};
for (const r of roots) walk(r);
console.log(`Imported ${imported} levels into ${archive} (${procedural} procedurally generated floors); ` +
  `${kept} already there were kept; ${revs} older revisions put aside in ${revisions}.`);
