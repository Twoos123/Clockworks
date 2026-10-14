// The forge's maths (src/game/forge.ts) and its rules in the economy, against the install's
// config/forge_property.dat where the game is installed.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { importBinary } from "../src/export/BinaryImport.ts";
import { CRYSTAL_PACK, ECONOMY_FILES, Economy, type Wallet } from "../src/game/economy.ts";
import { bonusesAt, crystalBand, crystalFor, forgedLevel, forgeSteps, rollForge, successChance, type ForgeStep } from "../src/game/forge.ts";
import { nodeInflate, skDir } from "../tools/common.ts";

const have = existsSync(join(skDir(), "rsrc", "config", "forge_property.dat"));
const libs = new Map<string, Map<string, any>>();
async function economy() {
  for (const f of ECONOMY_FILES) {
    if (libs.has(f)) continue;
    const root: any = (await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", f))), nodeInflate)).root;
    const list: any[] = Array.isArray(root) ? root : root?.array ?? [];
    libs.set(f, new Map(list.map(c => [c.name, c])));
  }
  return new Economy(f => libs.get(f) ?? new Map());
}
const wallet = (over: Partial<Wallet> = {}): Wallet => ({
  crowns: 0, materials: {}, owned: [], gear: {}, recipes: [], pocket: [],
  loadout: { weapons: [], shield: "", armor: "", helmet: "", trinkets: [], vitapod: "" }, ...over,
});
/** A random source returning the given values in turn. */
const seq = (...xs: number[]) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };

const STEP: ForgeStep = {
  crystals: [16, 32, 48], success: [0.3, 0.75, 1],
  bonuses: [{ kind: "heat", minUnlock: 1, item: null, locked: false }, { kind: "skip", minUnlock: 1, item: null, locked: false },
    { kind: "prize", minUnlock: 2, item: "Upgrade/Prize Box/Radiant Forge Prize Box", locked: false }],
};

test("crystal bands, success chances and bonuses follow ForgeProps.fj, fi and fl", () => {
  assert.equal(crystalBand(STEP, 15), -1);
  assert.equal(crystalBand(STEP, 16), 0);
  assert.equal(crystalBand(STEP, 31), 0);
  assert.equal(crystalBand(STEP, 32), 1);
  assert.equal(crystalBand(STEP, 48), 2);
  assert.equal(successChance(STEP, 10), 0);
  assert.equal(successChance(STEP, 16), 0.3);
  assert.equal(successChance(STEP, 40), 0.75);
  assert.equal(successChance(STEP, 48), 1);
  assert.deepEqual(bonusesAt(STEP, 0), [], "the minimal crystals unlock no bonus");
  assert.deepEqual(bonusesAt(STEP, 1).map(b => b.kind), ["heat", "skip"]);
  assert.deepEqual(bonusesAt(STEP, 2).map(b => b.kind), ["heat", "skip", "prize"]);
});

test("a forging rolls success, then at most one bonus; a skip climbs two levels, never past 10", () => {
  assert.deepEqual(rollForge(STEP, 10, seq(0)), { success: false, bonus: null }, "too few crystals never forge");
  assert.equal(rollForge(STEP, 16, seq(0.5)).success, false, "0.5 misses a 30% chance");
  assert.deepEqual(rollForge(STEP, 16, seq(0.1)), { success: true, bonus: null }, "no bonus with the minimal crystals");
  // maximum: success, then skip (10%), prize (10%), heat (50%) in turn
  assert.equal(rollForge(STEP, 48, seq(0.99, 0.05)).bonus?.kind, "skip");
  assert.equal(rollForge(STEP, 48, seq(0.99, 0.5, 0.05)).bonus?.kind, "prize");
  assert.equal(rollForge(STEP, 48, seq(0.99, 0.5, 0.5, 0.4)).bonus?.kind, "heat");
  assert.equal(rollForge(STEP, 48, seq(0.99, 0.5, 0.5, 0.6)).bonus, null);
  assert.equal(forgedLevel(4, { success: true, bonus: null }), 5);
  assert.equal(forgedLevel(4, { success: true, bonus: STEP.bonuses[1] }), 6);
  assert.equal(forgedLevel(9, { success: true, bonus: STEP.bonuses[1] }), 10);
  assert.equal(forgedLevel(4, { success: false, bonus: null }), 4);
  assert.equal(crystalFor(0), "Rarity/Fire Crystal/Cracked");
  assert.equal(crystalFor(5), "Rarity/Fire Crystal/Radiant");
});

test("the install's forge tables are the wiki's crystal counts", { skip: !have }, async () => {
  const lib = (await economy(), libs.get("config/forge_property.dat")!);
  const steps = (star: number) => forgeSteps(lib.get(`Star ${star}`));
  // the wiki's totals from level 1 to 10 (minimal, medium, maximum)
  const totals: [number, number, number][] = [[12, 24, 36], [21, 42, 63], [32, 64, 96], [58, 116, 174], [103, 206, 309], [151, 302, 453]];
  for (let s = 0; s <= 5; s++) {
    const st = steps(s);
    assert.equal(st.length, 9);
    assert.deepEqual([0, 1, 2].map(i => st.reduce((a, x) => a + x.crystals[i], 0)), totals[s], `star ${s}`);
  }
  // the user's screenshot: a 5-star item at level 6 takes up to 48 Radiant crystals; the live
  // client's 9 to 10 with the minimal 34 is guaranteed
  assert.deepEqual(steps(5)[5].crystals, [16, 32, 48]);
  assert.equal(successChance(steps(5)[8], 34), 1);
  // Heat Bonus and Skip Level from the medium band; the prize box (locked below three stars) with the maximum; the last step offers boxes only
  assert.deepEqual(bonusesAt(steps(5)[0], 1).map(b => b.kind), ["heat", "skip"]);
  assert.deepEqual(bonusesAt(steps(5)[0], 2).map(b => b.kind), ["heat", "skip", "prize"]);
  assert.ok(bonusesAt(steps(1)[0], 2).find(b => b.kind === "prize")?.locked);
  assert.deepEqual([...new Set(steps(5)[8].bonuses.map(b => b.kind))], ["prize"]);
});

test("the forge levels a ready item with its star's crystals; failure keeps the heat", { skip: !have }, async () => {
  const e = await economy();
  const sword = "Weapon/Sword/Calibur"; // two stars: Warm crystals
  const w = wallet({ owned: [sword], gear: { [sword]: { heat: 0, level: 1, variants: [] } }, loadout: { weapons: [sword], shield: "", armor: "", helmet: "", trinkets: [], vitapod: "" } });
  assert.equal(e.forgeReady(w, sword), false);
  assert.equal(e.forge(w, sword, 3), null, "not ready");
  e.addHeat(w, 1000);
  assert.ok(e.forgeReady(w, sword));
  assert.deepEqual(e.forgeable(w), [sword]);
  const step = e.forgeStep(sword, 1)!;
  assert.deepEqual(step.crystals, [1, 2, 3]);
  assert.equal(e.forge(w, sword, 1), null, "no crystals held");
  w.materials["Rarity/Fire Crystal/Warm"] = 8;
  // a failed roll (a draw of 1 misses even the install's 100%) spends the crystals and keeps the heat
  const heat = w.gear[sword].heat;
  const fail = e.forge(w, sword, 3, seq(1))!;
  assert.equal(fail.success, false);
  assert.equal(w.materials["Rarity/Fire Crystal/Warm"], 5);
  assert.equal(w.gear[sword].heat, heat);
  assert.equal(w.gear[sword].level, 1);
  assert.ok(e.forgeReady(w, sword));
  const r = e.forge(w, sword, 9, seq(0.5, 0.99, 0.99, 0.99))!;
  assert.equal(r.success, true);
  assert.equal(r.spent, 3, "no more than the step's maximum is spent");
  assert.equal(w.materials["Rarity/Fire Crystal/Warm"], 2);
  assert.equal(w.gear[sword].level, 2);
  assert.equal(w.gear[sword].heat, e.heatTable(sword)[1], "the new level's bar starts empty");
  assert.ok(heat >= e.heatTable(sword)[1]);
  assert.equal(e.forgeReady(w, sword), false);
  // the Heat Bonus adds a quarter to the next level's heat
  w.gear[sword].heatBonus = 0.25;
  const before = w.gear[sword].heat;
  e.addHeat(w, 8);
  assert.equal(w.gear[sword].heat, before + 10);
  // a skip climbs two levels and clears the heat bonus
  e.addHeat(w, 100000);
  w.materials["Rarity/Fire Crystal/Warm"] = 3;
  const skip = e.forge(w, sword, 3, seq(0, 0.01))!;
  assert.equal(skip.bonus?.kind, "skip");
  assert.equal(w.gear[sword].level, 4);
  assert.equal(w.gear[sword].heatBonus, undefined);
});

test("fire crystals: the depot's packs of fifty for energy, Cracked and Dim by five for crowns", { skip: !have }, async () => {
  const e = await economy();
  assert.deepEqual(e.crystalOffer(5), { name: "Rarity/Fire Crystal/Radiant", count: CRYSTAL_PACK, energy: 700, crowns: 0 });
  assert.deepEqual(e.crystalOffer(2), { name: "Rarity/Fire Crystal/Warm", count: 50, energy: 85, crowns: 0 });
  assert.deepEqual(e.crystalOffer(0), { name: "Rarity/Fire Crystal/Cracked", count: 5, energy: 0, crowns: 50 });
  assert.deepEqual(e.crystalOffer(1), { name: "Rarity/Fire Crystal/Dim", count: 5, energy: 0, crowns: 125 });
  const w = wallet({ crowns: 60 });
  assert.ok(e.buyCrystals(w, e.crystalOffer(0)!));
  assert.equal(w.crowns, 10);
  assert.equal(w.materials["Rarity/Fire Crystal/Cracked"], 5);
  assert.ok(!e.buyCrystals(w, e.crystalOffer(0)!), "ten crowns do not cover five more");
  assert.ok(e.depotGoods().some(g => g.kind === "crystal" && g.name === "Rarity/Fire Crystal/Glowing" && g.energy === 175 && g.count === 50));
});
