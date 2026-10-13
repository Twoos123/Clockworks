// The level checklist: which server-side levels the player has collected (cached by the
// official client and kept in the private archive) and which are still missing, with where to
// get each one in the real game. Reads only the player's own files.
// Usage: npm run levels [-- --all]   (--all also lists every collected level)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { archiveDir, detectInstall } from "../server/install.ts";
import { checklist, GROUPS, matchLevels } from "../src/game/levels.ts";
import { sceneName } from "../src/scene.ts";

const all = process.argv.includes("--all");
const install = process.env.SK_DIR ?? detectInstall();
const SCENE = /^[0-9]+$/;

// every cached scene file by its number: the archive's copy, else the install's
const files = new Map<string, string>();
for (const dir of [install ? join(install, "scenes") : null, archiveDir()]) {
  if (!dir || !existsSync(dir)) continue;
  for (const f of readdirSync(dir)) if (SCENE.test(f)) files.set(f, join(dir, f));
}

const named: { id: string; name: string }[] = [];
const failed: string[] = [];
for (const [id, file] of [...files].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  try { named.push({ id, name: await sceneName(new Uint8Array(readFileSync(file))) }); }
  catch (e) { failed.push(`${id}: ${(e as Error).message}`); }
}

const list = checklist(named.map(s => s.name), rsrc => !!install && existsSync(join(install, "rsrc", rsrc)));
console.log(`Install: ${install ?? "(not found)"}`);
console.log(`Archive: ${archiveDir()}`);
console.log(`Cached scenes read: ${named.length}${failed.length ? `, ${failed.length} unreadable` : ""}\n`);

for (const g of list.groups) {
  const total = g.have.length + g.missing.length;
  console.log(`== ${g.title}: ${g.have.length} of ${total}`);
  if (all || g.have.length) for (const l of g.have) console.log(`  [x] ${l.set}: ${l.name}`);
  let set = "";
  for (const l of g.missing) {
    if (l.set !== set) { set = l.set; console.log(`  ${set}`); }
    const tag = l.availability === "regular" ? "" : l.availability === "event" ? ` [event: ${l.event}]` : ` [${l.availability}]`;
    console.log(`    [ ] ${l.name}${tag} - ${l.where}`);
  }
  console.log("");
}

console.log(`Total: ${list.have} of ${list.total} levels`);
for (const g of GROUPS) {
  const c = list.groups.find(x => x.group === g.id)!;
  console.log(`  ${g.title.padEnd(34)} ${String(c.have.length).padStart(3)} / ${c.have.length + c.missing.length}`);
}

console.log("\nCached scenes:");
for (const s of named) {
  const m = matchLevels(s.name);
  console.log(`  ${s.id.padStart(6)}  ${s.name.padEnd(44)} ${m.length ? m.map(l => `${l.set}: ${l.name}`).join("; ") : "(matches nothing)"}`);
}
if (list.unmatched.length) {
  console.log(`\nScene names that match no level (fix the patterns in src/game/levels.ts):`);
  for (const n of list.unmatched) console.log(`  ${n}`);
}
for (const f of failed) console.log(`unreadable: ${f}`);
