// Energy (src/game/energy.ts), the Supply Depot's energy goods, orbs of alchemy in crafting and
// Haven's wiki stock lists (src/game/vendors.ts). The economy tests read the install's configs
// in place and skip when the game is not installed.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { importBinary } from "../src/export/BinaryImport.ts";
import { ECONOMY_FILES, Economy, seeded, type Wallet } from "../src/game/economy.ts";
import {
  buyEnergy, energyNow, EXCHANGE_CROWNS, freshEnergy, MIST_MAX, MIST_REFILL_MS, mistFullIn, mistNow, normalizeEnergy, payEnergy,
  sellEnergy, spendEnergy, SPARK_COST, EXCHANGE_SELL_CROWNS,
} from "../src/game/energy.ts";
import { LOBBY_RECIPES, RANDOM_PER_DAY, terminalStars, vendorDay, vendorKey, vendorMatch, vendorNames, vendorSeed, VENDORS } from "../src/game/vendors.ts";
import { nodeInflate, skDir } from "../tools/common.ts";

test("the mist tank refills 100 over 22 hours and is spent before crystal energy", () => {
  const e = freshEnergy(0);
  assert.equal(mistNow(e, 0), MIST_MAX);
  assert.ok(spendEnergy(e, 60, 0));
  assert.equal(mistNow(e, 0), 40);
  assert.equal(mistNow(e, MIST_REFILL_MS / 2), 90);
  assert.equal(mistNow(e, MIST_REFILL_MS * 3), MIST_MAX);
  assert.equal(mistFullIn(e, 0), Math.ceil(MIST_REFILL_MS * 0.6));
  e.crystal = 30;
  assert.ok(spendEnergy(e, 50, 0));
  assert.deepEqual([mistNow(e, 0), e.crystal], [0, 20]);
  assert.ok(!spendEnergy(e, 21, 0), "not enough: nothing spent");
  assert.equal(energyNow(e, 0), 20);
});

test("the exchange sells 100 energy for 6500 crowns; prices are paid with the shortfall bought", () => {
  const w = { crowns: 7000 }, e = freshEnergy(0);
  assert.ok(buyEnergy(w, e));
  assert.deepEqual([w.crowns, e.crystal], [500, 100]);
  assert.ok(!buyEnergy(w, e));
  // a 250 energy price with 200 in hand: one lot of 100 is bought, then it is paid
  let paid = 0;
  assert.ok(payEnergy(e, 250, n => { paid += n; return true; }, 0));
  assert.equal(paid, EXCHANGE_CROWNS);
  assert.equal(energyNow(e, 0), 50);
  assert.ok(!payEnergy(e, 500, () => false, 0));
  assert.equal(energyNow(e, 0), 50, "a refused exchange spends nothing");
  assert.equal(SPARK_COST, 50);
});

test("saved energy is repaired: a full tank for a new knight, bad numbers fixed", () => {
  assert.deepEqual(normalizeEnergy(null, 5), { mist: MIST_MAX, at: 5, crystal: 0 });
  assert.deepEqual(normalizeEnergy({ mist: 400, at: 99, crystal: -3 }, 10), { mist: MIST_MAX, at: 10, crystal: 0 });
});

test("vendor days turn at midnight Pacific, each player sees their own stock", () => {
  const day = vendorDay(Date.UTC(2026, 9, 14, 7, 59));
  assert.equal(vendorDay(Date.UTC(2026, 9, 14, 8, 1)), day + 1);
  const v = VENDORS.swords;
  const a = vendorNames(v, seeded(vendorSeed(day, "Asad"))), b = vendorNames(v, seeded(vendorSeed(day, "Asad")));
  assert.deepEqual(a, b);
  for (const n of v.always) assert.ok(a.includes(n));
  assert.ok(a.length <= v.always.length + 1 + 2 * RANDOM_PER_DAY);
  assert.equal(new Set(a).size, a.length, "never two of one good");
  assert.equal(vendorKey("Shop/Haven/Swords"), "swords");
  assert.equal(vendorKey("Shop/Haven/Recipes"), "recipes");
  assert.equal(vendorKey("Shop/Traveler/Terminal Tier 1"), null);
  assert.equal(vendorMatch("Weapon/Sword/Fireburst Brandish"), "fireburst brandish");
});

// ------------------------------------------------------------------ against the install

const have = existsSync(join(skDir(), "rsrc", "config", "item_property.dat"));
const libs = new Map<string, Map<string, any>>();
async function economy() {
  for (const f of ECONOMY_FILES) {
    if (libs.has(f)) continue;
    const r: any = (await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", f))), nodeInflate)).root;
    const list: any[] = Array.isArray(r) ? r : r?.array ?? [];
    libs.set(f, new Map(list.map(c => [c.name, c])));
  }
  return new Economy(f => libs.get(f) ?? new Map());
}
const wallet = (over: Partial<Wallet> = {}): Wallet => ({
  crowns: 0, materials: {}, owned: [], gear: {}, recipes: [], pocket: [],
  loadout: { weapons: [], shield: "", armor: "", helmet: "", trinkets: [], vitapod: "" }, ...over,
});

test("the Supply Depot's energy goods are priced from item_property.dat depotCost", { skip: !have }, async () => {
  const e = await economy();
  const goods = Object.fromEntries(e.depotGoods().map(g => [g.name, g]));
  assert.equal(goods["Upgrade/Heat Bonus"]?.energy, 800);
  assert.equal(goods["Upgrade/Heat Bonus (7 days)"]?.energy, 1600);
  assert.equal(goods["Upgrade/Heat Bonus (30 days)"]?.energy, 5000);
  assert.deepEqual([goods["Rarity/Spark of Life"]?.energy, goods["Rarity/Spark of Life"]?.count], [200, 10]);
  assert.deepEqual(["Flawed", "Simple", "Advanced", "Elite", "Eternal"].map(o => goods[`Rarity/Orb of Alchemy/${o}`]?.energy), [10, 50, 200, 400, 800]);
  assert.equal(e.amplifierDays("Upgrade/Heat Bonus (7 days)"), 7);
  // the heat amplifier runs its days from now, or on from the one running
  const w = wallet({ energy: freshEnergy(0), heatAmplifier: 0 });
  w.energy!.crystal = 2000;
  assert.ok(e.buyDepot(w, goods["Upgrade/Heat Bonus"], 1000));
  assert.equal(w.heatAmplifier, 1000 + 2 * 86400_000);
  assert.ok(e.buyDepot(w, goods["Rarity/Spark of Life"], 1000));
  assert.equal(w.sparks, 13);
  assert.ok(!e.buyDepot(w, goods["Upgrade/Heat Bonus (7 days)"], 1000), "1600 energy is more than is left");
  // the Supply Depot keeper lists them in energy beside its capsules
  const stock = e.catalogue("Shop/Haven/Spiral Quartermaster");
  assert.ok(stock.some(s => s.name === "Upgrade/Heat Bonus" && s.currency === "energy" && s.price === 800));
  assert.ok(stock.some(s => s.name === "Pickup/Capsule/Health Capsule" && !s.currency));
});

test("crafting takes three orbs of the recipe's star, else their pack's energy", { skip: !have }, async () => {
  const e = await economy();
  const calibur = e.recipeFor("Weapon/Sword/Calibur")!;
  assert.deepEqual(calibur.orbs, ["Rarity/Orb of Alchemy/Simple", 3]);
  const w = wallet({ crowns: 10000, recipes: [calibur.name], energy: freshEnergy(0) });
  for (const [m, n] of calibur.materials) w.materials[m] = n;
  w.energy!.mist = 0;
  w.energy!.at = Date.now();
  assert.ok(!e.canCraft(w, calibur));
  assert.match(e.missing(w, calibur).join(), /50 energy/);
  w.energy!.crystal = 60;
  assert.ok(e.craft(w, calibur, seeded(1)));
  assert.equal(w.energy!.crystal, 10);
  // with the orbs in hand they are used instead
  const w2 = wallet({ crowns: 10000, recipes: [calibur.name], materials: { "Rarity/Orb of Alchemy/Simple": 4 } });
  for (const [m, n] of calibur.materials) w2.materials[m] = n;
  assert.ok(e.canCraft(w2, calibur), e.missing(w2, calibur).join());
  assert.ok(e.craft(w2, calibur, seeded(1)));
  assert.equal(w2.materials["Rarity/Orb of Alchemy/Simple"], 1);
});

test("Haven's Strangers stock the wiki's lists: every listed good is in the install", { skip: !have }, async () => {
  const e = await economy();
  const keepers: Record<string, string> = { swords: "Shop/Haven/Swords", guns: "Shop/Haven/Guns and Bombs", armor: "Shop/Haven/Armor and Helms",
    shields: "Shop/Haven/Shields and Trinkets", recipes: "Shop/Haven/Recipes" };
  const missing: string[] = [];
  for (const [key, v] of Object.entries(VENDORS)) {
    const kp = e.keeper(keepers[key]);
    // every name of the list, all drawn at once
    const all = { ...v, always: [...v.always, ...v.random.flat()], random: [] };
    const stock = e.catalogue({ ...kp, vendor: undefined, minRarity: 0, maxRarity: 5 });
    const names = new Set(stock.map(s => vendorMatch(v.recipes ? e.recipeOfItem(s.name)!.output : s.name)));
    for (const n of all.always) if (!names.has(n.toLowerCase())) missing.push(`${v.name}: ${n}`);
  }
  assert.ok(missing.length <= 0, missing.join("; "));
  // a day's swords: the always-stocked ones and a few random two and three star blades
  const day = e.catalogue("Shop/Haven/Swords", { player: "Asad", now: Date.UTC(2026, 9, 14, 12) });
  assert.ok(day.some(s => s.name === "Weapon/Sword/Proto Sword"), day.map(s => s.name).join());
  const twos = day.filter(s => s.rarity === 2).length, threes = day.filter(s => s.rarity === 3).length;
  assert.ok(twos >= 1 && twos <= RANDOM_PER_DAY && threes >= 1 && threes <= RANDOM_PER_DAY, `${twos} two-star, ${threes} three-star`);
  assert.ok(!day.some(s => s.rarity >= 4), "four and five star gear is crafted, not sold");
});

test("the exchange buys 100 Crystal Energy for crowns, never the mist tank's", () => {
  const w = { crowns: 0 }, e = freshEnergy(0);
  assert.ok(!sellEnergy(w, e), "mist is not sold");
  e.crystal = 150;
  assert.ok(sellEnergy(w, e));
  assert.equal(w.crowns, EXCHANGE_SELL_CROWNS);
  assert.equal(e.crystal, 50);
  assert.ok(EXCHANGE_SELL_CROWNS < EXCHANGE_CROWNS, "selling and buying back costs crowns");
});

test("Basil's lobby stock: the mission's recipes from the wiki and the recorded supplies", { skip: !have }, async () => {
  const e = await economy();
  const stock = e.catalogue(e.keeper("Shop/Mission/Items 5", { mission: "The Great Escape" }));
  const price = (n: string) => stock.find(s => s.category !== "recipe" && vendorMatch(s.name) === n.toLowerCase())?.price;
  assert.equal(price("Remedy Capsule"), 100);
  assert.equal(price("Ultra Health Capsule"), 500);
  for (const v of ["Fire", "Freeze", "Poison", "Shock"]) assert.equal(price(`Ultra ${v} Vial`), 250);
  assert.equal(price("Health +12"), 3000);
  const out = (s: { name: string }) => vendorMatch(e.recipeOfItem(s.name)!.output);
  const pepperbox = stock.find(s => s.category === "recipe" && out(s) === "volcanic pepperbox");
  assert.equal(pepperbox?.price, 25000, stock.map(s => s.name).join());
  // every lobby's recipes are in the install
  const missing: string[] = [];
  for (const [mission, list] of Object.entries(LOBBY_RECIPES)) {
    const got = new Set(e.catalogue(e.keeper("Shop/Mission/Items 0-1", { mission })).filter(s => s.category === "recipe").map(out));
    for (const n of list) if (!got.has(n.toLowerCase())) missing.push(`${mission}: ${n}`);
  }
  assert.deepEqual(missing, []);
});

test("Basil's terminal recipes: the tier's stars, six to twenty-five, one of the top star", { skip: !have }, async () => {
  const e = await economy();
  for (const tier of [1, 2, 3]) {
    const [lo, hi] = terminalStars(tier);
    for (let seed = 1; seed < 6; seed++) {
      const stock = e.catalogue(e.keeper("Shop/Traveler/Terminal Tier " + tier, { tier }), { seed });
      assert.ok(stock.length >= 6 && stock.length <= 25, `${stock.length}`);
      assert.ok(stock.every(s => s.category === "recipe" && s.rarity >= lo && s.rarity <= hi));
      assert.ok(stock.some(s => s.rarity === hi), `tier ${tier} seed ${seed}`);
    }
  }
});
