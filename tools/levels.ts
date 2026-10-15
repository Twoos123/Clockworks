// The level checklist: which server-side levels the player has collected (cached by the
// official client and kept in the private archive) and which are still missing, with where to
// get each one in the real game. Reads only the player's own files.
// Usage: npm run levels [-- --all]   (--all also lists every collected level and every cached name)
//
// The archive's names come from scene-index.json beside it (server/install.ts sceneIndex), so
// only levels that are new or changed since the last run are parsed; the install's own cache
// adds the few it holds that the archive does not.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { archiveDir, detectInstall, sceneIndex } from "../server/install.ts";
import { checklist, GROUPS, GUILD_HALL, matchLevels, normalizeSceneName } from "../src/game/levels.ts";
import { prettySceneName, sceneName } from "../src/scene.ts";

const all = process.argv.includes("--all");
const install = process.env.SK_DIR ?? detectInstall();
const SCENE = /^[0-9]+$/;

// every cached scene by its number: the archive's (from its index), else the install's
const named = new Map<string, string>();
// names indexed before src/scene.ts knew a form are tidied here as well
for (const [id, name] of await sceneIndex(archiveDir())) named.set(id, prettySceneName(name));
const failed: string[] = [];
const cache = install ? join(install, "scenes") : null;
if (cache && existsSync(cache))
  for (const id of readdirSync(cache).filter(f => SCENE.test(f) && !named.has(f))) {
    try { named.set(id, await sceneName(new Uint8Array(readFileSync(join(cache, id))))); }
    catch (e) { failed.push(`${id}: ${(e as Error).message}`); }
  }

const names = [...named.values()];
const list = checklist(names, rsrc => !!install && existsSync(join(install, "rsrc", rsrc)));
console.log(`Install: ${install ?? "(not found)"}`);
console.log(`Archive: ${archiveDir()}`);
console.log(`Cached scenes read: ${named.size}${failed.length ? `, ${failed.length} unreadable` : ""}\n`);

// a level this port derives from a collected one (src/game/derive.ts) is playable, but it is
// not the game's own: it is counted apart and stays on the list of levels to capture
const derivedNote = (n: number) => (n ? ` (+${n} derived from a capture)` : "");
for (const g of list.groups) {
  const total = g.have.length + g.derived.length + g.missing.length;
  console.log(`== ${g.title}: ${g.have.length} of ${total}${derivedNote(g.derived.length)}`);
  if (all) for (const l of g.have) console.log(`  [x] ${l.set}: ${l.name}`);
  if (g.derived.length) {
    console.log(`  Derived from a capture (playable, still to capture):`);
    for (const l of g.derived) console.log(`    [~] ${l.set}: ${l.name} - from "${list.derivedFrom.get(l)}"; capture: ${l.where}`);
  }
  let set = "";
  for (const l of g.missing) {
    if (l.set !== set) { set = l.set; console.log(`  ${set}`); }
    const tag = l.availability === "regular" ? "" : l.availability === "event" ? ` [event: ${l.event}]` : ` [${l.availability}]`;
    console.log(`    [ ] ${l.name}${tag} - ${l.where}`);
  }
  console.log("");
}

console.log(`Total: ${list.have} of ${list.total} levels${derivedNote(list.derived)}`);
for (const g of GROUPS) {
  const c = list.groups.find(x => x.group === g.id)!;
  console.log(`  ${g.title.padEnd(34)} ${String(c.have.length).padStart(3)} / ${c.have.length + c.derived.length + c.missing.length}${derivedNote(c.derived.length)}`);
}
console.log(`  ${"Guild halls".padEnd(34)} ${list.guildHalls} archived`);
console.log(`  ${"Dev, test and unnamed scenes".padEnd(34)} ${list.other}`);

if (all) {
  // each distinct name once, with how many cached scenes have it (guild halls left out)
  const counts = new Map<string, number>();
  for (const n of names) if (!GUILD_HALL.test(normalizeSceneName(n))) counts.set(n, (counts.get(n) ?? 0) + 1);
  console.log("\nCached scene names:");
  for (const [n, c] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    const m = matchLevels(n);
    console.log(`  ${String(c).padStart(4)}  ${n.padEnd(52)} ${m.length ? m.map(l => `${l.set}: ${l.name}`).join("; ") : "-"}`);
  }
}
if (list.unmatched.length) {
  console.log(`\nScene names that match no level (fix the patterns in src/game/levels.ts):`);
  for (const n of [...new Set(list.unmatched)].sort()) console.log(`  ${n}`);
}
for (const f of failed) console.log(`unreadable: ${f}`);
