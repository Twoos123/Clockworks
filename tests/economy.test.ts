// The economy against the install's own configs (read in place, never copied); the tests
// skip when the game is not installed.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { importBinary } from "../src/export/BinaryImport.ts";
import { ECONOMY_FILES, Economy, heatCurve, seeded, type Wallet } from "../src/game/economy.ts";
import { SpawnTables } from "../src/game/spawntable.ts";
import { nodeInflate, skDir } from "../tools/common.ts";

const have = existsSync(join(skDir(), "rsrc", "config", "item_property.dat"));
const libs = new Map<string, Map<string, any>>();
async function load(file: string) {
  if (libs.has(file)) return;
  const r = await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", file))), nodeInflate);
  const root: any = r.root;
  const list: any[] = Array.isArray(root) ? root : root?.array ?? [];
  libs.set(file, new Map(list.map(c => [c.name, c])));
}
async function economy() {
  for (const f of [...ECONOMY_FILES, "config/spawn_table.dat"]) await load(f);
  return new Economy(f => libs.get(f) ?? new Map());
}
const wallet = (over: Partial<Wallet> = {}): Wallet => ({
  crowns: 0, materials: {}, owned: [], gear: {}, recipes: [], pocket: [],
  loadout: { weapons: [], shield: "", armor: "", helmet: "", trinkets: [], vitapod: "" }, ...over,
});

test("heat curve: the client's series, each level a fixed step dearer than the last", () => {
  const t = heatCurve(100, 5000);
  assert.equal(t.length, 10);
  assert.equal(t[0], 0);
  assert.equal(t[1], 100);
  // step (2 * 5000 / 10 - 200) / 9 = 88.9; level 10 at 100 + 0.8 * 5000
  assert.equal(t[9], 4100);
  for (let i = 2; i < 10; i++) assert.ok(Math.abs((t[i] - t[i - 1]) - (t[i - 1] - t[i - 2]) - 800 / 9) < 2);
  // the class defaults (baseHeat 5, maxHeat 2000)
  assert.deepEqual(heatCurve(5, 2000), [0, 5, 53, 145, 280, 458, 680, 945, 1253, 1605]);
});

test("seeded random is repeatable", () => {
  const a = seeded(7), b = seeded(7);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test("prices and sell prices come from item_property.dat by star rating", { skip: !have }, async () => {
  const e = await economy();
  assert.equal(e.info("Gear/Armor/Cobalt Armor")?.rarity, 2);
  assert.equal(e.price("Gear/Armor/Cobalt Armor"), 7500);
  assert.equal(e.sellPrice("Gear/Armor/Cobalt Armor"), 750);
  assert.equal(e.info("Weapon/Sword/Calibur")?.category, "sword");
  assert.equal(e.price("Weapon/Sword/Calibur"), 7500);
  assert.equal(e.price("Recipe/Sword/Calibur Recipe"), 1000);
  assert.equal(e.price("Pickup/Capsule/Health Capsule"), 100);
  assert.equal(e.sellPrice("Material/Gel Drop"), 1);
});

test("weapons and armour level 1-10 with heat; level tables give damage, charge, defence and health", { skip: !have }, async () => {
  const e = await economy();
  const sword = "Weapon/Sword/Calibur", armor = "Gear/Armor/Cobalt Armor";
  const t = e.heatTable(sword);
  assert.equal(t[1], 100); // 2-star baseHeat
  assert.equal(t[9], 4100); // 2-star maxHeat 5000: 100 + 0.8 * 5000
  assert.equal(e.levelFor(sword, 0), 1);
  assert.equal(e.levelFor(sword, 4100), 10);
  // 2-3 star weapons: +75% damage at level 10 from depth 8; charge time reduction low at 5, medium at 10
  // the level tables' damage is uncapped (applied on its own, not in the gear bonus pool)
  assert.ok(Math.abs(e.levelStats(sword, 10, 10).uncapped - 0.75) < 1e-6);
  assert.equal(e.levelStats(sword, 10, 3).uncapped, 0);
  // ItemValueKey CHARGE: 0.08 a step (LOW at 5, MEDIUM at 10)
  assert.ok(Math.abs(e.levelStats(sword, 5, 10).charge - 0.08) < 1e-6);
  assert.ok(Math.abs(e.levelStats(sword, 10, 10).charge - 0.16) < 1e-6);
  assert.equal(e.levelStats(sword, 4, 10).charge, 0);
  assert.equal(e.levelStats(armor, 10, 10).defense, 25);
  // most armour gains a heart pip at level 5 (the wiki); 2-star armour gains another from tier 2
  assert.ok(e.levelStats(armor, 5, 1).health >= 40);
  assert.ok(e.levelStats(armor, 5, 10).health > e.levelStats(armor, 5, 1).health);
  const w = wallet({ owned: [sword, armor], loadout: { weapons: [sword], shield: "", armor, helmet: "", trinkets: ["Gear/Trinket/Heart Pendant"], vitapod: "" } });
  e.addHeat(w, 60);
  assert.equal(w.gear[sword].heat, 30, "the heat is shared between the two heated items");
  assert.equal(w.gear["Gear/Trinket/Heart Pendant"], undefined, "trinkets take no heat");
  w.heatAmplifier = Date.now() + 1000;
  e.addHeat(w, 20);
  assert.equal(w.gear[sword].heat, 50, "the heat amplifier doubles heat");
  // a full bar waits for the forge: no level is gained, the heat stops at the level's end
  const ready = e.addHeat(w, 8000);
  assert.ok(ready.some(u => u.name === sword && u.level === 1) && ready.some(u => u.name === armor));
  assert.equal(w.gear[sword].level, 1);
  assert.equal(w.gear[sword].heat, 100);
  assert.ok(e.forgeReady(w, sword));
  assert.deepEqual(e.heatedItems(w), [], "items ready to forge take no more heat");
});

test("shops: keepers sell their kinds within the star range; buying, recipes and selling", { skip: !have }, async () => {
  const e = await economy();
  // Haven's swords: the wiki's list (src/game/vendors.ts), zero to three stars
  const swords = e.catalogue("Shop/Haven/Swords", { maxRarity: 5 });
  assert.ok(swords.length > 10 && swords.every(s => s.category === "sword" && s.rarity >= 0 && s.rarity <= 3));
  // a keeper without a wiki list sells every item of its kind in its star range
  const any = e.catalogue("Shop/Elsewhere/Swords", { maxRarity: 5 });
  assert.ok(any.length > swords.length && any.every(s => s.category === "sword" && s.rarity >= 1 && s.rarity <= 5));
  const basil = e.catalogue("Shop/Traveler/Terminal Tier 1", { tier: 1, seed: 3 });
  // the wiki: six to twenty-five recipes at a terminal
  assert.ok(basil.length >= 6 && basil.length <= 25 && basil.every(s => s.category === "recipe" && s.rarity <= 2));
  assert.deepEqual(basil, e.catalogue("Shop/Traveler/Terminal Tier 1", { tier: 1, seed: 3 }));
  const depot = e.catalogue("Supply Depot", { tier: 1 });
  assert.ok(depot.some(d => d.name === "Pickup/Capsule/Health Capsule"));
  const w = wallet({ crowns: 20000 });
  assert.ok(e.buy(w, "Weapon/Sword/Calibur"));
  assert.equal(w.crowns, 12500);
  assert.ok(!e.buy(w, "Weapon/Sword/Calibur"), "one of each");
  assert.ok(e.buy(w, "Recipe/Sword/Calibur Recipe"));
  assert.deepEqual(w.recipes, ["Sword/Calibur"]);
  assert.ok(e.buy(w, "Pickup/Capsule/Health Capsule"));
  assert.deepEqual(w.pocket, [["Pickup/Capsule/Health Capsule", 1]]);
  assert.equal(e.sell(w, "Weapon/Sword/Calibur"), 750);
  assert.ok(!w.owned.includes("Weapon/Sword/Calibur"));
  w.materials["Material/Gel Drop"] = 3;
  assert.equal(e.sell(w, "Material/Gel Drop", 2), 2);
  assert.equal(w.materials["Material/Gel Drop"], 1);
});

test("crafting costs what the recipe says and needs the recipe, materials and the levelled base", { skip: !have }, async () => {
  const e = await economy();
  const tempered = e.recipeFor("Weapon/Sword/Tempered Calibur")!;
  assert.equal(tempered.base, "Weapon/Sword/Calibur");
  assert.equal(tempered.crowns, 1000);
  assert.equal(tempered.rarity, 3);
  const ascended = e.recipeFor("Weapon/Sword/Ascended Calibur")!;
  assert.equal(ascended.baseLevel, 5);
  assert.equal(ascended.crowns, 2500);
  assert.equal(e.recipeFor("Weapon/Sword/Leviathan Blade")!.baseLevel, 10);
  assert.deepEqual(e.lineage("Weapon/Sword/Leviathan Blade"), ["Weapon/Sword/Calibur", "Weapon/Sword/Tempered Calibur", "Weapon/Sword/Ascended Calibur", "Weapon/Sword/Leviathan Blade"]);
  const w = wallet({ crowns: 5000, owned: ["Weapon/Sword/Calibur"], loadout: { weapons: ["Weapon/Sword/Calibur"], shield: "", armor: "", helmet: "", trinkets: [], vitapod: "" } });
  for (const [m, n] of tempered.materials) w.materials[m] = n;
  // and three Advanced Orbs of Alchemy (tests/energy.test.ts has the energy side)
  w.materials["Rarity/Orb of Alchemy/Advanced"] = 3;
  assert.ok(!e.canCraft(w, tempered), "the recipe must be learned first");
  w.recipes.push(tempered.name);
  assert.ok(e.canCraft(w, tempered), e.missing(w, tempered).join());
  const made = e.craft(w, tempered, seeded(1));
  assert.ok(made);
  assert.equal(w.crowns, 4000);
  assert.deepEqual(w.loadout.weapons, ["Weapon/Sword/Tempered Calibur"]);
  assert.ok(!w.owned.includes("Weapon/Sword/Calibur"));
  assert.equal(made!.level, 1);
});

test("unique variants roll from the variant tables: mostly none, sometimes one to three", { skip: !have }, async () => {
  const e = await economy();
  const rand = seeded(42);
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < 4000; i++) counts[Math.min(3, e.rollVariants("Gear/Armor/Cobalt Armor", undefined, rand).length)]++;
  assert.ok(counts[0] > 3200 && counts[1] > 250 && counts[1] < 600, counts.join());
  // armour rolls defences and resistances, weapons roll family damage and speed
  let seen = new Set<string>();
  for (let i = 0; i < 3000; i++) for (const v of e.rollVariants("Weapon/Sword/Calibur", undefined, rand)) seen.add(v);
  assert.ok([...seen].every(v => v.startsWith("Weapon/")), [...seen].join());
  seen = new Set();
  for (let i = 0; i < 3000; i++) for (const v of e.rollVariants("Gear/Armor/Cobalt Armor", undefined, rand)) seen.add(v);
  assert.ok([...seen].every(v => v.startsWith("Gear/")));
  assert.equal(e.variantLabel("Gear/Elemental Defense 3"), "Elemental Defense: High");
  // a named bonus level overrides the config's own amount: MEDIUM is two 0.08 steps
  assert.ok(Math.abs(e.variant("Weapon/Beast Damage 2")!.tagged!.damage - 0.16) < 1e-6);
  assert.deepEqual(e.variant("Gear/Fire Resist 4")?.resist, { mask: 4, points: 40, scaled: true });
  assert.match(e.displayName("Weapon/Sword/Calibur", { heat: 0, level: 1, variants: ["Weapon/Charge Time 1"] }), /Calibur \(Charge Time: Low\)/);
});

test("drops: materials by depth weight and the monster's family; mineral deposits", { skip: !have }, async () => {
  const e = await economy();
  const rand = seeded(5);
  for (let i = 0; i < 200; i++) {
    const m = e.autoItem("MATERIAL", "Materials", { depth: 2, tags: ["fam_slime"] }, rand)!;
    const it = e.info(m)!;
    assert.ok(it.tags.includes("fam_slime"), m);
    assert.ok(it.rarity <= 1, `${m} ${it.rarity} at depth 2`);
  }
  let deep = 0;
  for (let i = 0; i < 300; i++) if (e.info(e.autoItem("MATERIAL", "Materials", { depth: 26 }, rand)!)!.rarity >= 4) deep++;
  assert.ok(deep > 10, `${deep} high-star materials deep down`);
  assert.equal(e.depthWeight("Gear", 5, 10), 0);
  assert.deepEqual(e.deposit("Mineral/Dungeon/Crimsonite Deposit 4"), { mineral: "Mineral/Inventory/Crimsonite", count: 6 });
});

test("spawn tables: valued crowns interpolate by depth and AutoItem tables drop items", { skip: !have }, async () => {
  const e = await economy();
  const st = new SpawnTables(libs.get("config/spawn_table.dat")!, {
    autoItem: (type, dw, ctx) => e.autoItem(type, dw, ctx),
    rarity: name => e.info(name)?.rarity ?? 0,
    depthWeight: (dw, r, d) => e.depthWeight(dw, r, d),
  });
  const coins = st.coinValue("Item/Consumable/Crowns/Silver Crown");
  assert.equal(coins, 10);
  assert.equal(st.coinValue("Item/Consumable/Heat/Ember 5"), 50);
  let shallow = 0, deep = 0;
  for (let i = 0; i < 300; i++) {
    const total = (d: number) => st.evaluate({ name: "Treasure/Crowns/Monster Crowns, small" }, { depth: d, tier: 1, difficulty: "medium" })
      .reduce((s, r) => s + st.coinValue(r.actor?.name ?? ""), 0);
    shallow += total(1); deep += total(6);
  }
  assert.ok(deep > shallow * 2, `${shallow} at depth 1, ${deep} at depth 6`);
  let items = 0;
  for (let i = 0; i < 50; i++) items += st.evaluate({ name: "Treasure/Item Loot/AutoItem Materials" }, { depth: 3, tier: 1, difficulty: "medium", tags: ["fam_beast"] }).filter(r => r.item).length;
  assert.equal(items, 50);
  const mineral = st.evaluate({ name: "Treasure/Mineral/Crimsonite Deposit" }, { depth: 3, tier: 1, difficulty: "medium" });
  assert.match(mineral[0]?.item?.name ?? "", /^Mineral\/Dungeon\/Crimsonite Deposit \d$/);
});
