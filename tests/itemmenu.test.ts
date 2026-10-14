import assert from "node:assert/strict";
import { test } from "node:test";
import { CATEGORIES, type ItemEntry } from "../src/game/items.ts";
import { resistBar } from "../src/game/itemstats.ts";
import type { SaveData } from "../src/game/save.ts";
import { previewModel } from "../src/ui/itemlist.ts";
import { applyItemAction, COMPARE, compareTarget, equipAt, itemMenu, rankAllows, unequipAt } from "../src/ui/itemmenu.ts";

const save = (): SaveData => ({
  version: 2, crowns: 0, heat: 0, materials: {}, bestDepth: 0, runs: 0, gear: {}, recipes: [], color: 257, pocket: [], heatAmplifier: 0,
  loadout: { weapons: ["Weapon/Sword/Proto Sword", "Weapon/Handgun/Proto Gun"], shield: "Gear/Shield/Proto Shield", armor: "Gear/Armor/Cobalt Armor", helmet: "", trinkets: [], vitapod: "" },
  owned: [], missions: { rank: 1, subrank: 1, completed: [], prestige: 0, cycles: {} },
});
const entry = (name: string, id: string, rarity = 2): ItemEntry => ({ name, label: name.split("/").pop()!, rarity, icon: null, category: CATEGORIES.find(c => c.id === id)! });
const none = { helmet: "", armor: "", shield: "" };

test("the rank limits follow ItemCodes.bwB", () => {
  const d = save();
  assert.ok(rankAllows(d, 1));
  assert.ok(!rankAllows(d, 2));
  d.missions!.rank = 3;
  assert.ok(rankAllows(d, 2));
  assert.ok(!rankAllows(d, 3));
});

test("a sword's menu offers the three weapon slots, the worn one as Unequip", () => {
  const d = save();
  d.missions!.rank = 10;
  const acts = itemMenu(d, none, entry("Weapon/Sword/Proto Sword", "sword", 0)).map(m => m.action);
  assert.deepEqual(acts, ["unequip_6", "equip_7", "equip_8", "compare"]);
});

test("worn armour cannot be taken off; an armour above the knight's rank shows the limit", () => {
  const d = save();
  assert.deepEqual(itemMenu(d, none, entry("Gear/Armor/Cobalt Armor", "armor")).map(m => m.action), ["compare"]);
  const m = itemMenu(d, none, entry("Gear/Armor/Other", "armor", 3));
  assert.deepEqual(m.map(x => x.action), ["rank_limit", "compare"]);
  assert.equal(m[0].enabled, false);
});

test("equipping to a slot moves the item; the last weapon stays", () => {
  const d = save();
  const l = equipAt(d.loadout, 6, "Weapon/Handgun/Proto Gun");
  assert.deepEqual(l.weapons, ["Weapon/Handgun/Proto Gun"], "moved out of slot 7 into slot 6, replacing the sword");
  assert.equal(unequipAt({ ...d.loadout, weapons: ["A"] }, 6), null);
  assert.deepEqual(equipAt(d.loadout, 8, "Weapon/Bomb/X").weapons, ["Weapon/Sword/Proto Sword", "Weapon/Handgun/Proto Gun", "Weapon/Bomb/X"]);
  const c = applyItemAction(d, entry("Gear/Armor/Cobalt Armor", "armor"), "equip_4");
  assert.deepEqual(c?.costume, ["armor", "Gear/Armor/Cobalt Armor"]);
});

test("tooltips compare with the chosen item, else the first other worn of the group", () => {
  const d = save();
  d.loadout.weapons = ["Weapon/Sword/A", "Weapon/Handgun/G", "Weapon/Sword/B"];
  assert.equal(compareTarget(d.loadout, entry("Weapon/Sword/C", "sword")), "Weapon/Sword/A");
  assert.equal(compareTarget(d.loadout, entry("Weapon/Sword/A", "sword")), "Weapon/Sword/B");
  applyItemAction(d, entry("Weapon/Sword/C", "sword"), "compare");
  assert.equal(compareTarget(d.loadout, entry("Weapon/Sword/A", "sword")), "Weapon/Sword/C");
  COMPARE.clear();
});

test("a tooltip's 3D preview wraps the coloured model in its kind's preview model", () => {
  const m = previewModel({ $class: "x.ItemConfig$Armor", model: { name: "a.dat", arguments: { entries: [["Colorization", 1]] } } }, 300);
  assert.equal(m.name, "item/preview/model_gear-armor.dat");
  assert.deepEqual(m.arguments.entries[0][1].arguments.entries, [["Colorization", 300]]);
  assert.equal(previewModel({ $class: "x.ItemConfig$Dungeon", model: { name: "v.dat" } }, 1), null, "vitapods hide the view");
  assert.equal(previewModel({ $class: "x.ItemConfig$Trinket" }, 1), null);
});

test("status resist bars are value + 8, at most 82, weakness on the penalty side", () => {
  assert.deepEqual(resistBar("fire", 12, 12), { status: "fire", bonus: 20, bonusPotential: 20, penalty: 0, penaltyPotential: 0 });
  assert.deepEqual(resistBar("shock", -100, -100), { status: "shock", bonus: 0, bonusPotential: 0, penalty: 82, penaltyPotential: 82 });
});
