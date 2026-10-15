// The level checklist: which server-side levels the player has collected (cached by the
// official client and kept in the private archive), which this port builds from what is
// collected, and which are still missing, with where to get each one in the real game. Reads
// only the player's own files.
// Usage: npm run levels [-- --all]   (--all also lists every collected and generated level and every cached name)
//
// The archive's names come from scene-index.json beside it (server/install.ts sceneIndex), so
// only levels that are new or changed since the last run are parsed; the install's own cache
// adds the few it holds that the archive does not. The captured prefab floors are read as well
// (their tiles and globals: tools/coverage.ts), for the coverage of the levels the servers build
// from prefab rooms on every run (src/game/coverage.ts).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { archiveDir, detectInstall, sceneIndex } from "../server/install.ts";
import { statusLabel } from "../src/game/coverage.ts";
import { checklist, GROUPS, GUILD_HALL, matchLevels, normalizeSceneName } from "../src/game/levels.ts";
import { prettySceneName, sceneName } from "../src/scene.ts";
import { captureFacts, captureScenes } from "./coverage.ts";

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
const facts = captureFacts(await captureScenes());
const list = checklist(names, rsrc => !!install && existsSync(join(install, "rsrc", rsrc)), undefined, facts);
console.log(`Install: ${install ?? "(not found)"}`);
console.log(`Archive: ${archiveDir()}`);
console.log(`Cached scenes read: ${named.size}${failed.length ? `, ${failed.length} unreadable` : ""}; captured prefab floors read: ${facts.size} names\n`);

// three states: captured (the game's own level), generated or derived (built by this port from
// captured ones: playable, not the game's own capture), missing
const counts = (have: number, built: number, missing: number) =>
  `${have} captured, ${built} generated or derived, ${missing} missing (of ${have + built + missing})`;

// the levels the servers build from prefab rooms: what matters is each (type x status) pair
console.log("== Prefab-built level types, by (type x status): what the generator needs");
console.log("   (a named level of a covered pair is generated from its captured rooms, with its own monsters)");
const mark = { captured: "[x]", derived: "[~]", missing: "[ ]" } as const;
for (const r of list.coverage) {
  const names = [...list.generated].filter(([, row]) => row === r).length;
  console.log(`  ${mark[r.state]} ${r.type.name.padEnd(18)} ${statusLabel(r.status).padEnd(10)} ${r.state.padEnd(9)}`
    + ` ${String(r.captures.length).padStart(2)} capture${r.captures.length === 1 ? " " : "s"}${r.note ? ` - ${r.note}` : ""}`);
  if (all) {
    for (const c of r.captures) console.log(`        ${c.name}${c.rooms ? "" : " (no rooms in its tiles)"}${c.env === false ? " (a mission's environment)" : ""}`);
    if (names) console.log(`        ${names} named level${names === 1 ? "" : "s"} built from it`);
  }
}
const byState = (s: string) => list.coverage.filter(r => r.state === s).length;
console.log(`  Pairs: ${byState("captured")} captured, ${byState("derived")} derived, ${byState("missing")} missing (of ${list.coverage.length})\n`);

for (const g of list.groups) {
  console.log(`== ${g.title}: ${counts(g.have.length, g.derived.length, g.missing.length)}`);
  if (all) for (const l of g.have) console.log(`  [x] ${l.set}: ${l.name}`);
  // generated from a covered pair's captured rooms: listed with --all; derived ones always (their
  // environment or source is not the game's own, so a capture still helps)
  const built = g.derived.filter(l => all || !(list.generated.has(l) && list.how.get(l)!.startsWith("generated")));
  const hidden = g.derived.length - built.length;
  if (built.length) {
    console.log(`  Generated or derived (playable; a capture would make it the game's own):`);
    for (const l of built) console.log(`    [~] ${l.set}: ${l.name} - ${list.how.get(l)}; capture: ${l.where}`);
  }
  if (hidden) console.log(`  (${hidden} more generated from the captured rooms of their covered pair: --all lists them)`);
  let set = "";
  for (const l of g.missing) {
    if (l.set !== set) { set = l.set; console.log(`  ${set}`); }
    const tag = l.availability === "regular" ? "" : l.availability === "event" ? ` [event: ${l.event}]` : ` [${l.availability}]`;
    console.log(`    [ ] ${l.name}${tag} - ${l.where}`);
  }
  console.log("");
}

console.log(`Total: ${counts(list.have, list.derived, list.missing)} levels`);
for (const g of GROUPS) {
  const c = list.groups.find(x => x.group === g.id)!;
  console.log(`  ${g.title.padEnd(34)} ${String(c.have.length).padStart(3)} captured, ${String(c.derived.length).padStart(3)} generated or derived, ${String(c.missing.length).padStart(3)} missing`);
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
