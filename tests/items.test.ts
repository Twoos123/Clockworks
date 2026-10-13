import assert from "node:assert/strict";
import { test } from "node:test";
import { buyItem, CATEGORIES, craftRecipe, craftShortfall, isEquipped, toggleEquip, unequip, type ItemEntry, type Recipe } from "../src/game/items.ts";
import { DEFAULT_LOADOUT, type SaveData } from "../src/game/save.ts";

const cat = (id: string) => CATEGORIES.find(c => c.id === id)!;
const entry = (name: string, id: string): ItemEntry => ({ name, label: name.split("/").pop()!, category: cat(id), rarity: 2, icon: null });
const save = (): SaveData => ({ version: 1, loadout: { ...DEFAULT_LOADOUT, weapons: [...DEFAULT_LOADOUT.weapons], trinkets: [] }, crowns: 1000, heat: 0,
  materials: { "Material/Gel Drop": 3 }, bestDepth: 0, runs: 0, owned: [...DEFAULT_LOADOUT.weapons, DEFAULT_LOADOUT.shield], color: 257, weaponHeat: {}, pocket: [] });

test("equipping keeps three weapons, two trinkets and one of each other slot", () => {
  let l = save().loadout;
  const blade = entry("Weapon/Sword/Bolted Blade", "sword");
  l = toggleEquip(l, blade);
  assert.deepEqual(l.weapons, ["Weapon/Handgun/Proto Gun", "Weapon/Bomb/Proto Bomb", "Weapon/Sword/Bolted Blade"]);
  assert.ok(isEquipped(l, blade));
  l = toggleEquip(l, blade);
  assert.equal(l.weapons.length, 2);
  for (const t of ["A", "B", "C"]) l = toggleEquip(l, entry(`Gear/Trinket/${t}`, "trinket"));
  assert.deepEqual(l.trinkets, ["Gear/Trinket/B", "Gear/Trinket/C"]);
  l = unequip(l, "trinket", 0);
  assert.deepEqual(l.trinkets, ["Gear/Trinket/C"]);
  // the shield stays on; armour comes off
  l = toggleEquip(l, entry("Gear/Armor/Plate", "armor"));
  assert.equal(l.armor, "Gear/Armor/Plate");
  assert.equal(unequip(l, "armor").armor, "");
  assert.equal(unequip(l, "shield").shield, DEFAULT_LOADOUT.shield);
});

test("buying spends crowns once", () => {
  const s = save();
  assert.ok(buyItem(s, "Gear/Helm/Cap", 300));
  assert.equal(s.crowns, 700);
  assert.ok(!buyItem(s, "Gear/Helm/Cap", 300));
  assert.ok(!buyItem(s, "Gear/Helm/Crown", 5000));
});

test("crafting an upgrade replaces its levelled base item", () => {
  const s = save();
  const r: Recipe = { name: "Sword/Better", output: "Weapon/Sword/Better", label: "Better", rarity: 2, icon: null, category: cat("sword"),
    materials: [["Material/Gel Drop", 2]], consumes: "Weapon/Sword/Proto Sword", level: 5, cost: 150 };
  assert.equal(craftShortfall(s, r).levelShort, true);
  assert.ok(!craftRecipe(s, r));
  s.weaponHeat["Weapon/Sword/Proto Sword"] = 60;
  assert.ok(craftRecipe(s, r));
  assert.equal(s.crowns, 850);
  assert.equal(s.materials["Material/Gel Drop"], 1);
  assert.ok(s.owned.includes("Weapon/Sword/Better") && !s.owned.includes("Weapon/Sword/Proto Sword"));
  assert.equal(s.loadout.weapons[0], "Weapon/Sword/Better");
  assert.equal(s.weaponHeat["Weapon/Sword/Better"], 0);
});
