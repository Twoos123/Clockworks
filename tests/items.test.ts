import assert from "node:assert/strict";
import { test } from "node:test";
import { CATEGORIES, isEquipped, toggleEquip, unequip, type ItemEntry } from "../src/game/items.ts";
import { DEFAULT_LOADOUT, type Loadout } from "../src/game/save.ts";

const cat = (id: string) => CATEGORIES.find(c => c.id === id)!;
const entry = (name: string, id: string): ItemEntry => ({ name, label: name.split("/").pop()!, category: cat(id), rarity: 2, icon: null });
const loadout = (): Loadout => ({ ...DEFAULT_LOADOUT, weapons: [...DEFAULT_LOADOUT.weapons], trinkets: [] });

test("equipping keeps three weapons, two trinkets and one of each other slot", () => {
  let l = loadout();
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

test("the last weapon stays equipped", () => {
  let l: Loadout = { ...loadout(), weapons: ["Weapon/Sword/Proto Sword"] };
  l = unequip(l, "weapon", 0);
  assert.deepEqual(l.weapons, ["Weapon/Sword/Proto Sword"]);
  l = toggleEquip(l, entry("Weapon/Sword/Proto Sword", "sword"));
  assert.deepEqual(l.weapons, ["Weapon/Sword/Proto Sword"]);
});
