// The wiki's drop rules (src/game/droprates.ts), the spawn tables' use of them, and the wiki's
// tables checked against the install's own configs (skipped when the game is not installed).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { importBinary } from "../src/export/BinaryImport.ts";
import {
  asTheme, BELT_STACK, BOX_CONTENTS, dropTags, FREQUENTED_TO_UNCOMMON, MATERIALS, mineralOf, MINERALS, MINERALS_BY_THEME,
  mineralWeight, themeTag, tierOf, vitapodBetter, vitapodHealth, vitapodPips, WHEEL_CROWNS, WHEEL_CROWNS_BY_TIER, WHEEL_ODDS,
  wheelPickup, type BeltSlot,
} from "../src/game/droprates.ts";
import { crownChoices, wheelTier } from "../src/game/prizewheel.ts";
import { SpawnTables, type SpawnContext } from "../src/game/spawntable.ts";
import { nodeInflate, skDir } from "../tools/common.ts";

const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
const ST = "com.threerings.projectx.dungeon.config.SpawnTableConfig$";
const ctx = (over: Partial<SpawnContext> = {}): SpawnContext => ({ depth: 10, tier: 2, difficulty: "medium", ...over });

test("tiers by depth (Clockworks): 0-7, 8-17, 18 and below; the wheel follows", () => {
  for (const [d, t] of [[0, 1], [7, 1], [8, 2], [17, 2], [18, 3], [29, 3]] as const) {
    assert.equal(tierOf(d), t);
    assert.equal(wheelTier(d), t);
  }
});

test("a monster drops its family's and its status's materials; treasure the floor's theme", () => {
  assert.deepEqual(dropTags("Slime", ["sc_fire"], null), ["fam_slime", "sc_fire"]);
  // Zee Core's tag is a bare "sleep": a sleep monster counts it
  assert.deepEqual(dropTags("Beast", ["sc_sleep"], null), ["fam_beast", "sc_sleep", "sleep"]);
  // other tags are not drop tags
  assert.deepEqual(dropTags("Gremlin", ["boss", "wave_1"], "Fire"), ["fam_gremlin"]);
  // no monster: the floor's family or status
  assert.deepEqual(dropTags(null, [], "Freeze"), ["sc_freeze"]);
  assert.deepEqual(dropTags(null, [], "Undead"), ["fam_undead"]);
  assert.deepEqual(dropTags(null, [], null), []);
  assert.deepEqual(themeTag("Shock"), ["sc_shock"]);
  assert.equal(asTheme("poison"), "Poison");
  assert.equal(asTheme("Curse"), null);
});

test("the wiki's materials: every one in a theme, stars 0 to 5, multi-family ones only at 0 and 1 star", () => {
  for (const [name, m] of Object.entries(MATERIALS)) {
    assert.ok(m.stars >= 0 && m.stars <= 5, name);
    assert.ok(m.themes.length >= 1, name);
    if (m.themes.length > 1) assert.ok(m.stars <= 1, `${name}: only shards and some 1 star materials span families`);
  }
  assert.equal(Object.keys(MATERIALS).length, 83);
});

test("minerals by theme: each row names all five colours once; frequented ones weigh more", () => {
  for (const [theme, row] of Object.entries(MINERALS_BY_THEME)) {
    assert.deepEqual([...row.uncommon, ...row.frequented].sort(), [...MINERALS].sort(), theme);
    assert.equal(row.uncommon.length, 2, theme);
  }
  assert.equal(mineralWeight("Beast", "Moonstone"), FREQUENTED_TO_UNCOMMON);
  assert.equal(mineralWeight("Beast", "Crimsonite"), 1);
  assert.equal(mineralWeight(null, "Crimsonite"), 1);
  assert.equal(mineralWeight("Sleep", "Crimsonite"), 1);
  assert.equal(mineralOf("Block/Mineral/Typed/Dark Matter Node"), "Dark Matter");
  assert.equal(mineralOf("Block/Mineral/Valestone Node"), "Valestone");
  assert.equal(mineralOf("Treasure/Mineral/Luminite Deposit"), "Luminite");
  assert.equal(mineralOf("Block/Treasure"), null);
});

test("vitapods: a pod no better is not kept; a better one adds 40 a pip without healing", () => {
  assert.equal(vitapodPips("Gear/Dungeon/Vitapod/Health +12"), 12);
  assert.equal(vitapodPips("Gear/Dungeon/Vitapod/Health +03"), 3);
  assert.equal(vitapodPips("Pickup/Capsule/Health Capsule"), 0);
  assert.equal(vitapodBetter(12, 12), false);
  assert.equal(vitapodBetter(9, 12), false);
  assert.equal(vitapodBetter(12, 9), true);
  assert.equal(vitapodHealth(12), 480);
});

test("the wheel's pickups follow the belt: empty, part-filled, full", () => {
  const random = () => "Pickup/Vial/Fire Vial";
  // empty belt: one at random
  assert.equal(wheelPickup([], 4, random, seq(0)), "Pickup/Vial/Fire Vial");
  // a stack that is not full: another of it on the chance, else at random
  const belt: BeltSlot[] = [["Pickup/Capsule/Health Capsule", 1]];
  assert.equal(wheelPickup(belt, 4, random, seq(0.1, 0)), "Pickup/Capsule/Health Capsule");
  assert.equal(wheelPickup(belt, 4, random, seq(0.9)), "Pickup/Vial/Fire Vial");
  // no free slot: only a top-up, never a replacement
  const full: BeltSlot[] = [["A", BELT_STACK], ["B", 2], ["C", BELT_STACK], ["D", BELT_STACK]];
  assert.equal(wheelPickup(full, 4, random, seq(0.99, 0)), "B");
  assert.equal(wheelPickup(full.map(([n]) => [n, BELT_STACK] as BeltSlot), 4, random, seq(0)), null);
});

test("wheel crowns stay within the wiki's 5, 10, 25 or 50 and the guessed odds sum to one", () => {
  for (const t of [1, 2, 3] as const) {
    for (const n of WHEEL_CROWNS_BY_TIER[t]) assert.ok((WHEEL_CROWNS as readonly number[]).includes(n));
    assert.deepEqual(crownChoices(t), WHEEL_CROWNS_BY_TIER[t]);
  }
  assert.ok(Math.abs(WHEEL_ODDS.reduce((s, [, w]) => s + w, 0) - 1) < 1e-9);
});

test("an Always Better table gives its fallback for a pod no better than the one held", () => {
  const pod = (n: string) => ({ $class: ST + "ItemEntry", item: { name: `Gear/Dungeon/Vitapod/Health +${n}` } });
  const lib = new Map<string, any>([
    ["Pods", { $class: ST + "AlwaysBetterDungeonItem", name: "Pods", fallback: { name: "Hearts" },
      root: { $class: ST + "DepthListEntry", entries: [{ $class: ST + "DepthEntry", entry: pod("03") }, { $class: ST + "DepthEntry", depth: 8, entry: pod("06") }] } }],
    ["Hearts", { $class: ST + "Original", name: "Hearts", root: { $class: ST + "ItemEntry", item: { name: "Instant/Heart/Heart 2" } } }],
  ]);
  const t = new SpawnTables(lib);
  assert.equal(t.evaluate({ name: "Pods" }, ctx({ pod: 0 }))[0].item.name, "Gear/Dungeon/Vitapod/Health +06");
  assert.equal(t.evaluate({ name: "Pods" }, ctx({ pod: 6 }))[0].item.name, "Instant/Heart/Heart 2");
  assert.equal(t.evaluate({ name: "Pods" }, ctx({ depth: 3, pod: 5 }))[0].item.name, "Instant/Heart/Heart 2");
});

test("a depth list's offset picks deeper, and carries down to what it holds", () => {
  const leaf = (n: string, depth = 0) => ({ $class: ST + "DepthEntry", depth, entry: { $class: ST + "ItemEntry", item: { name: n } } });
  const lib = new Map<string, any>([
    ["Inner", { $class: ST + "Original", name: "Inner", root: { $class: ST + "DepthListEntry", entries: [leaf("a"), leaf("b", 8)] } }],
    ["Outer", { $class: ST + "Original", name: "Outer", root: { $class: ST + "DepthListEntry", offset: 1,
      entries: [{ $class: ST + "DepthEntry", entry: { $class: ST + "TableEntry", spawnTable: { name: "Inner" } } }] } }],
  ]);
  const t = new SpawnTables(lib);
  assert.equal(t.evaluate({ name: "Inner" }, ctx({ depth: 7 }))[0].item.name, "a");
  assert.equal(t.evaluate({ name: "Outer" }, ctx({ depth: 7 }))[0].item.name, "b");
});

test("a floor's weights steer an even pick (mineral colours by theme)", () => {
  const node = (m: string) => ({ $class: ST + "ActorEntry", actor: { name: `Block/Mineral/${m} Node` } });
  const lib = new Map<string, any>([["Node", { $class: ST + "Original", name: "Node",
    root: { $class: ST + "SimpleRandomEntry", entries: MINERALS.map(node) } }]]);
  const t = new SpawnTables(lib);
  const only = (name: string) => (name.includes("Moonstone") ? 1 : 0);
  for (let i = 0; i < 20; i++) assert.equal(t.evaluate({ name: "Node" }, ctx({ pickWeight: only }))[0].actor.name, "Block/Mineral/Moonstone Node");
  // the even pick without weights reaches every colour
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) seen.add(t.evaluate({ name: "Node" }, ctx())[0].actor.name);
  assert.equal(seen.size, 5);
});

// ------------------------------------------------------------------ against the install

const have = existsSync(join(skDir(), "rsrc", "config", "item.dat"));
const libs = new Map<string, Map<string, any>>();
async function lib(file: string) {
  let m = libs.get(file);
  if (m) return m;
  const r = await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", file))), nodeInflate);
  const root: any = r.root;
  m = new Map((Array.isArray(root) ? root : root?.array ?? []).map((c: any) => [c.name, c]));
  libs.set(file, m);
  return m;
}

test("the wiki's materials match item.dat: stars and family or status tags", { skip: !have }, async () => {
  const items = await lib("config/item.dat");
  for (const [name, m] of Object.entries(MATERIALS)) {
    // (item.dat spells the 3 star fiend material "Wicked idol")
    const cfg = items.get(`Material/${name}`) ?? items.get(`Material/${name.replace("Idol", "idol")}`);
    assert.ok(cfg, name);
    const impl = cfg.implementation;
    assert.equal(impl.rarity ?? 0, m.stars, `${name} stars`);
    const tags: string[] = impl.tags?.tags ?? [];
    assert.deepEqual([...tags].sort(), m.themes.flatMap(t => themeTag(t).slice(t === "Sleep" ? 1 : 0)).sort(), `${name} tags`);
  }
});

test("the treasure tables hold what the wiki's Treasure box page lists", { skip: !have }, async () => {
  const tables = await lib("config/spawn_table.dat");
  const refs = (name: string) => JSON.stringify(tables.get(name)?.root ?? {});
  const kinds = (s: string) => {
    const k = new Set<string>();
    if (/Treasure Crown/.test(s)) k.add("crowns");
    if (/Treasure Heat/.test(s)) k.add("heat");
    if (/Scaled Pickups|Capsules/.test(s)) k.add("pickup");
    if (/Vitapod/.test(s)) k.add("vitapod");
    if (/AutoItem Materials/.test(s)) k.add("material");
    if (/AutoItem Tokens/.test(s)) k.add("token");
    if (/AutoItem Gear/.test(s)) k.add("gear");
    if (/Treasure Rarities/.test(s)) k.add("rarity");
    if (/Hearts/.test(s)) k.add("heart");
    return [...k].sort();
  };
  assert.deepEqual(kinds(refs("Treasure/Block/Treasure, Normal")), [...BOX_CONTENTS.green].sort());
  assert.deepEqual(kinds(refs("Treasure/Block/Treasure, Rare")), [...BOX_CONTENTS.red].sort());
  // heart boxes: hearts, the odd capsule, and a vitapod (with hearts as its fallback)
  for (const k of BOX_CONTENTS.heart) assert.ok(kinds(refs("Treasure/Block/Treasure, Health")).includes(k), k);
});

test("the vitapod tables are Always Better ones with a fallback, as the wiki describes", { skip: !have }, async () => {
  const tables = await lib("config/spawn_table.dat");
  const base = tables.get("Treasure/Health/Parts/Vitapods: Always Better");
  assert.match(base.$class, /AlwaysBetterDungeonItem$/);
  assert.equal(base.fallback?.name, "Treasure/Pickups/Scaled Pickups");
  // every tier's pods divide by the tier (the wiki: "always evenly divisible by the tier")
  for (const t of [1, 2, 3]) {
    for (const e of tables.get(`Treasure/Health/Parts/Vitapod Tier ${t}`).root.entries) assert.equal(vitapodPips(e.entry.item.name) % t, 0);
  }
});
