import assert from "node:assert/strict";
import { test } from "node:test";
import { LevelArchive } from "../src/game/archive.ts";
import { arenaOf, deriveArena, derivedArenas, parseDeriveId, pickArenaSource, recastSpawns, rethemeGlobals, SpawnTypes } from "../src/game/derive.ts";
import { checklist, keys, type Level } from "../src/game/levels.ts";

// A synthetic spawn table library in the client's shapes (config/spawn_table.dat): typed leaves
// (Typed with spawnTypes, or derived from a typed base with a "Spawn Types" argument), status
// lists and role lists (SpawnTableConfig$Prefab with a SpawnTypeListEntry root and a default).
// The monsters are made up.
const P = "Monster/Class {stc}/Family/";
const REF = "com.threerings.config.ConfigReference";
const argMap = (entries: [string, unknown][]) => ({ $map: "com.threerings.config.ArgumentMap", entries });
const typed = (name: string, types: string[]) => [name, { $class: "com.threerings.projectx.dungeon.config.SpawnTableConfig$Typed", name, spawnTypes: types }] as const;
const derived = (name: string, types: string[]) => [name, { $class: "com.threerings.config.DerivedConfig", name,
  base: { $class: REF, name: "Monster/Base/Depth Scale", arguments: argMap([["Spawn Types", types]]) } }] as const;
const list = (name: string, entries: string[], fallback: string) => [name, {
  $class: "com.threerings.projectx.dungeon.config.SpawnTableConfig$Prefab", name,
  root: { $class: "com.threerings.projectx.dungeon.config.SpawnTableConfig$SpawnTypeListEntry",
    entries: entries.map(n => ({ spawnTable: { $class: REF, name: n } })), spawnTable: { $class: REF, name: fallback } },
}] as const;

const LIB = new Map<string, any>([
  derived(`${P}Beast/Foo/Foo`, ["beast", "vanilla", "grunt"]),
  derived(`${P}Beast/Foo/Frost Foo`, ["beast", "freeze", "grunt"]),
  derived(`${P}Beast/Foo/Fire Foo`, ["beast", "fire", "grunt"]),
  list(`${P}Beast/Status - Foo`, [`${P}Beast/Foo/Fire Foo`, `${P}Beast/Foo/Foo`, `${P}Beast/Foo/Frost Foo`], `${P}Beast/Foo/Foo`),
  typed(`${P}Beast/Big Foo/Big Foo`, ["beast", "vanilla", "brute"]),
  typed(`${P}Beast/Big Foo/Big Frost Foo`, ["beast", "freeze", "brute"]),
  typed(`${P}Beast/Big Foo/Big Fire Foo`, ["beast", "fire", "brute"]),
  list(`${P}Beast/Status - Big Foo`, [`${P}Beast/Big Foo/Big Foo`, `${P}Beast/Big Foo/Big Frost Foo`, `${P}Beast/Big Foo/Big Fire Foo`], `${P}Beast/Big Foo/Big Foo`),
  list(`${P}Beast/Beast - Grunt`, [`${P}Beast/Status - Foo`], `${P}Beast/Status - Foo`),
  list(`${P}Beast/Beast - Brute`, [`${P}Beast/Status - Big Foo`], `${P}Beast/Status - Big Foo`),
  derived(`${P}Fiend/Bar/Bar`, ["fiend", "vanilla", "grunt"]),
  derived(`${P}Fiend/Bar/Fire Bar`, ["fiend", "fire", "grunt"]),
  derived(`${P}Fiend/Bar/Ice Bar`, ["fiend", "freeze", "grunt"]),
  list(`${P}Fiend/Status - Bar`, [`${P}Fiend/Bar/Bar`, `${P}Fiend/Bar/Fire Bar`, `${P}Fiend/Bar/Ice Bar`], `${P}Fiend/Bar/Bar`),
  list(`${P}Fiend/Fiend - Grunt`, [`${P}Fiend/Status - Bar`], `${P}Fiend/Status - Bar`),
  // a role the family lacks: the list is empty and its default is another family's monster
  list(`${P}Fiend/Fiend - Brute`, [], `${P}Beast/Status - Big Foo`),
  // another family's support, with no fire variant
  typed(`${P}Slime/Blob/Blob`, ["slime", "vanilla", "support"]),
  typed(`${P}Slime/Blob/Frost Blob`, ["slime", "freeze", "support"]),
  list(`${P}Slime/Status - Blob`, [`${P}Slime/Blob/Blob`, `${P}Slime/Blob/Frost Blob`], `${P}Slime/Blob/Blob`),
  typed(`${P}Slime/Drip/Drip`, ["slime", "vanilla", "turret"]),
  typed(`${P}Slime/Drip/Hot Drip`, ["slime", "fire", "turret"]),
  list(`${P}Slime/Status - Drip`, [`${P}Slime/Drip/Drip`, `${P}Slime/Drip/Hot Drip`], `${P}Slime/Drip/Drip`),
  // typed mineral nodes (families and statuses, no role)
  typed("Block/Mineral/Typed/Red", ["beast", "freeze"]),
  typed("Block/Mineral/Typed/Blue", ["fiend", "fire"]),
  typed("Block/Mineral/Typed/Green", ["slime", "shock"]),
  list("Block/Mineral/Generic {stc}", ["Block/Mineral/Typed/Red", "Block/Mineral/Typed/Blue", "Block/Mineral/Typed/Green"], "Block/Mineral/Typed/Green"),
]);

let nextId = 100;
const spawn = (table: string, tag: string, wave = tag.replace("spawn", "wave")) => ({
  $class: "com.threerings.tudey.data.TudeySceneModel$PlaceableEntry", id: nextId++,
  placeable: { $class: REF, name: "Character/Monster/Generic/Class Spawn", arguments: argMap([
    ["Spawn Table", { $class: REF, name: table, arguments: argMap([["Depth Offset", 0], ["Loot", "Primary"], ["Wave Tag", wave]]) }],
    ["Spawn Tag", tag]]) },
});
const mineral = (table: string) => ({ $class: "com.threerings.tudey.data.TudeySceneModel$PlaceableEntry", id: nextId++,
  placeable: { $class: REF, name: "Dynamic/Block/Mineral/Class {tb}/Generic Mineral", arguments: argMap([["Loot Table", { $class: REF, name: table }]]) } });
const global = (name: string, id: number) => ({ $class: "com.threerings.tudey.data.TudeySceneModel$GlobalEntry", id, sceneGlobal: { $class: REF, name } });
const tableOf = (e: any) => e.placeable.arguments.entries.find(([k]: [string]) => k === "Spawn Table" || k === "Loot Table")[1];
const short = (n: string) => n.replace(P, "");

/** An Ice Maul Beastly Brawl in miniature. */
function iceBeast(): { name: string; entries: any[] } {
  return {
    name: "%dungeon:m.ima_beast",
    entries: [
      global("Environment/Custom/Battle Arena/Freeze/Fog", 1), global("Environment/Custom/Battle Arena/Freeze/Music Mix", 2),
      global("Environment/Custom/Universal/Freeze/Vision Snow", 3), global("Environment/Custom/Camera (Default)", 4),
      spawn(`${P}Beast/Foo/Frost Foo`, "1_auto_spawn 1"), spawn(`${P}Beast/Foo/Frost Foo`, "1_auto_spawn 1"),
      spawn(`${P}Beast/Foo/Foo`, "1_auto_spawn 2"),
      spawn(`${P}Beast/Big Foo/Big Frost Foo`, "1_auto_spawn 3"),
      spawn(`${P}Slime/Blob/Frost Blob`, "1_auto_spawn 4"), spawn(`${P}Slime/Blob/Blob`, "1_auto_spawn 5"),
      spawn("Treasure/Crowns/Scaled Crown", "1_auto_spawn 6"),
      mineral("Block/Mineral/Typed/Red"),
    ],
  };
}
const GLOBALS = new Set(["Environment/Custom/Battle Arena/Default/Fog", "Environment/Custom/Battle Arena/Default/Music Mix",
  "Environment/Custom/Battle Arena/Fire/Fog", "Environment/Custom/Battle Arena/Freeze/Fog", "Environment/Custom/Battle Arena/Freeze/Music Mix",
  "Environment/Custom/Universal/Freeze/Vision Snow"]);

test("spawn types: a leaf's own or its base's, and the lists holding it", () => {
  const t = new SpawnTypes(LIB);
  assert.deepEqual(t.types(`${P}Beast/Foo/Frost Foo`), ["beast", "freeze", "grunt"]);
  assert.deepEqual(t.types(`${P}Slime/Blob/Blob`), ["slime", "vanilla", "support"]);
  assert.deepEqual(t.types(`${P}Beast/Status - Foo`), []);
  assert.equal(t.listOf(`${P}Beast/Foo/Frost Foo`), `${P}Beast/Status - Foo`);
  assert.equal(t.listOf("Treasure/Crowns/Scaled Crown"), null);
});

test("resolving a type list follows the client's rule", () => {
  const t = new SpawnTypes(LIB);
  const r = () => 0;
  // the best score wins: two types beat one
  assert.equal(t.resolve(`${P}Beast/Status - Foo`, ["beast", "fire"], r), `${P}Beast/Foo/Fire Foo`);
  // nested lists are flattened to their leaves
  assert.equal(t.resolve(`${P}Fiend/Fiend - Grunt`, ["fiend", "freeze"], r), `${P}Fiend/Bar/Ice Bar`);
  // no leaf scores: the list's default
  assert.equal(t.resolve(`${P}Slime/Status - Blob`, ["shock"], r), `${P}Slime/Blob/Blob`);
  // an empty list: its default, itself a list resolved in turn
  assert.equal(t.resolve(`${P}Fiend/Fiend - Brute`, ["fiend", "fire"], r), `${P}Beast/Big Foo/Big Fire Foo`);
  // ties are picked at random among the best
  const tied = new Set([0, 0.4, 0.9].map(x => t.resolve("Block/Mineral/Generic {stc}", ["beast", "fire"], () => x)));
  assert.deepEqual([...tied].sort(), ["Block/Mineral/Typed/Blue", "Block/Mineral/Typed/Red"]);
  // a table that is not a list is itself
  assert.equal(t.resolve(`${P}Beast/Foo/Foo`, ["fiend"], r), `${P}Beast/Foo/Foo`);
});

test("re-casting an arena's spawns to another family and status", () => {
  const root = iceBeast();
  const report = recastSpawns(root, { family: "Beast", status: "Freeze" }, { family: "Fiend", status: "Fire" }, new SpawnTypes(LIB), 7);
  const names = root.entries.slice(4).map(e => short(tableOf(e).name));
  assert.deepEqual(names, [
    // the arena family's monsters: the new family's of the same role, a status one in the new status...
    "Fiend/Bar/Fire Bar", "Fiend/Bar/Fire Bar",
    // ...and a vanilla one vanilla
    "Fiend/Bar/Bar",
    // a role the new family lacks: its list's default (another family's), in the new status
    "Beast/Big Foo/Big Fire Foo",
    // other families' monsters keep their monster; one without the new status falls back to vanilla
    "Slime/Blob/Blob", "Slime/Blob/Blob",
    // untyped tables are left alone
    "Treasure/Crowns/Scaled Crown",
    // a mineral node: the typed node best matching the new family and status
    "Block/Mineral/Typed/Blue",
  ]);
  // the references keep their arguments
  assert.deepEqual(tableOf(root.entries[4]).arguments.entries, [["Depth Offset", 0], ["Loot", "Primary"], ["Wave Tag", "1_auto_wave 1"]]);
  assert.equal(report.changes.get(`${P}Beast/Foo/Frost Foo`)?.get(`${P}Fiend/Bar/Fire Bar`), 2);
  assert.equal(report.kept, 1); // the vanilla Blob
});

test("from a vanilla arena every spawn takes the new status; a group is decided once", () => {
  const root = iceBeast();
  root.name = "%dungeon:m.iea_beast";
  for (const e of root.entries.slice(4)) {
    const t = tableOf(e);
    t.name = t.name.replace("Frost Foo", "Foo").replace("Big Frost Foo", "Big Foo").replace("Frost Blob", "Blob");
  }
  recastSpawns(root, { family: "Beast", status: null }, { family: "Beast", status: "Freeze" }, new SpawnTypes(LIB), 3);
  assert.deepEqual(root.entries.slice(4, 10).map(e => short(tableOf(e).name)),
    ["Beast/Foo/Frost Foo", "Beast/Foo/Frost Foo", "Beast/Foo/Frost Foo", "Beast/Big Foo/Big Frost Foo", "Slime/Blob/Frost Blob", "Slime/Blob/Frost Blob"]);
  // a wave of tied choices is still all one monster
  const lib = new Map(LIB);
  const baz = typed(`${P}Fiend/Baz/Baz`, ["fiend", "vanilla", "grunt"]);
  lib.set(baz[0], baz[1]);
  lib.set(`${P}Fiend/Fiend - Grunt`, list(`${P}Fiend/Fiend - Grunt`, [`${P}Fiend/Status - Bar`, `${P}Fiend/Baz/Baz`], `${P}Fiend/Bar/Bar`)[1]);
  const picked = new Set<string>();
  for (let seed = 0; seed < 12; seed++) {
    const wave = { name: "%dungeon:m.iea_beast", entries: Array.from({ length: 8 }, () => spawn(`${P}Beast/Foo/Foo`, "2_auto_spawn 1")) };
    recastSpawns(wave, { family: "Beast", status: null }, { family: "Fiend", status: null }, new SpawnTypes(lib), seed);
    const names = new Set(wave.entries.map(e => short(tableOf(e).name)));
    assert.equal(names.size, 1);
    picked.add([...names][0]);
  }
  // (Bar and Baz tie for {fiend, vanilla}: both turn up across seeds)
  assert.deepEqual([...picked].sort(), ["Fiend/Bar/Bar", "Fiend/Baz/Baz"]);
});

test("objects shared between entries are re-cast once per entry", () => {
  const root = iceBeast();
  // the scene format shares equal objects: two spawn groups holding one reference
  const shared = tableOf(root.entries[4]);
  root.entries[6].placeable.arguments.entries[0][1] = shared;
  recastSpawns(root, { family: "Beast", status: "Freeze" }, { family: "Beast", status: "Fire" }, new SpawnTypes(LIB), 5);
  assert.equal(short(tableOf(root.entries[4]).name), "Beast/Foo/Fire Foo");
  assert.equal(short(tableOf(root.entries[6]).name), "Beast/Foo/Fire Foo");
});

test("re-theming the environment to another status", () => {
  const root = iceBeast();
  const missing = rethemeGlobals(root, "Freeze", "Fire", n => GLOBALS.has(n));
  const g = root.entries.filter(e => e.$class.endsWith("GlobalEntry")).map(e => (e as any).sceneGlobal.name);
  // the status's own global, else the arena set's Default one; the freeze snowfall goes
  assert.deepEqual(g, ["Environment/Custom/Battle Arena/Fire/Fog", "Environment/Custom/Battle Arena/Default/Music Mix", "Environment/Custom/Camera (Default)"]);
  assert.deepEqual(missing, []);
  // to freeze: the snowfall comes back
  rethemeGlobals(root, "Fire", "Freeze", n => GLOBALS.has(n));
  assert.ok(root.entries.some(e => (e as any).sceneGlobal?.name === "Environment/Custom/Universal/Freeze/Vision Snow"));
});

test("deriving an arena names it as the arena it stands for", () => {
  const out = deriveArena(iceBeast(), { family: "Fiend", status: null }, new SpawnTypes(LIB), n => GLOBALS.has(n), 1);
  assert.equal(out.root.name, "%dungeon:m.iea_fiend");
  assert.ok(out.root.entries.some((e: any) => e.sceneGlobal?.name === "Environment/Custom/Battle Arena/Default/Fog"));
  assert.ok(!out.root.entries.some((e: any) => e.sceneGlobal?.name?.includes("Vision Snow")));
  assert.throws(() => deriveArena({ name: "%dungeon:m.ct_beast", entries: [] }, { family: "Fiend", status: null }, new SpawnTypes(LIB), () => true, 1));
});

test("arena sources and derived ids", () => {
  assert.deepEqual(arenaOf("ima beast"), { area: "ima", family: "Beast", status: "Freeze" });
  // mission floors on the arena skeleton are their mission's, not sources
  assert.equal(arenaOf("ima construct spark roar"), null);
  const src = [{ id: "5", name: "iea slime" }, { id: "9", name: "ima beast" }, { id: "7", name: "fla undead" }];
  assert.equal(pickArenaSource(src, "Fiend", "Freeze")?.name, "ima beast"); // same status first
  assert.equal(pickArenaSource(src, "Slime", "Shock")?.name, "iea slime"); // then same family
  assert.equal(pickArenaSource(src, "Gremlin", "Shock")?.name, "ima beast"); // then the newest
  assert.equal(pickArenaSource(src, "Beast", "Freeze"), null); // archived itself
  const a = new LevelArchive([{ id: "1900000023", name: "ima beast" }, { id: "1073741852", name: "ima construct spark roar" }]);
  const d = a.deriveArena("Fiend", "Fire", 42)!;
  assert.deepEqual(d, { id: "derive:1900000023:fiend:fire:42", name: "fla fiend", source: { id: "1900000023", name: "ima beast" } });
  assert.deepEqual(parseDeriveId(d.id), { source: "1900000023", family: "Fiend", status: "Fire", seed: 42 });
  assert.equal(a.deriveArena("Beast", "Freeze", 1), null);
  assert.equal(new LevelArchive([{ id: "1073741852", name: "ima construct spark roar" }]).deriveArena("Beast", null, 1), null);
});

test("the checklist counts derived arenas apart from collected levels", () => {
  const lv = (name: string, pattern: RegExp): Level => ({ group: "clockworks", set: "Arena", name, where: "", pattern, availability: "regular" });
  const SYNTH = [lv("Ice Beast", keys("ima_beast")), lv("Fire Fiend", keys("fla_fiend")), lv("Plain Slime", keys("iea_slime")), lv("Tunnel", keys("ct_beast"))];
  const c = checklist(["ima beast", "ct beast"], () => true, SYNTH);
  const g = c.groups.find(x => x.group === "clockworks")!;
  assert.deepEqual(g.have.map(l => l.name), ["Ice Beast", "Tunnel"]);
  assert.deepEqual(g.derived.map(l => l.name), ["Fire Fiend", "Plain Slime"]);
  assert.deepEqual(g.missing.map(l => l.name), []);
  assert.equal(c.have, 2);
  assert.equal(c.derived, 2);
  assert.equal(c.derivedFrom.get(SYNTH[1]), "ima beast");
  // with no arena collected (a mission floor on the arena skeleton is not one), nothing derives
  const none = checklist(["ima construct spark roar", "ct beast"], () => true, SYNTH);
  assert.equal(none.derived, 0);
  assert.deepEqual(none.groups.find(x => x.group === "clockworks")!.missing.map(l => l.name), ["Ice Beast", "Fire Fiend", "Plain Slime"]);
  // every arena but the collected one derives
  assert.equal(derivedArenas(["ima beast"]).size, 29);
});
