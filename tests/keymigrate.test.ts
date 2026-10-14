import { test } from "node:test";
import assert from "node:assert/strict";
import { commandKeys, defaultSettings, migrateKeys } from "../src/ui/settings.ts";

test("old default keys move to the client's, removed actions are dropped", () => {
  const d = defaultSettings().keys;
  const k = migrateKeys(d, { forge: "k", help: "h", dash: " ", cycle: "tab", backpack: "b", arsenal: "i", up: "z" });
  assert.equal(k.forge, "u");
  assert.equal(k.help, "f1");
  assert.equal(k.map, "b");
  assert.equal(k.dash, "");
  assert.equal(k.cycle, " ");
  assert.equal(k.up, "z");
  assert.ok(!("backpack" in k));
});

test("the client's Inventory (Tab), Recipes (F5) and Achievements (O) keys are the defaults", () => {
  const d = defaultSettings().keys;
  assert.equal(d.panels, "tab");
  assert.equal(d.recipes, "f5");
  assert.equal(d.achievements, "o");
  assert.equal(d.prevWeapon, "");
});

test("a save from before the new actions gets their keys, unless a saved action holds one", () => {
  const d = defaultSettings().keys;
  // an old save: Next weapon still on its old Tab default, which moves to Space and frees Tab
  const old = migrateKeys(d, { cycle: "tab", arsenal: "i", up: "w" });
  assert.equal(old.cycle, " ");
  assert.equal(old.panels, "tab");
  assert.equal(old.recipes, "f5");
  assert.equal(old.achievements, "o");
  // a player who put the map on O and the loadouts on Tab keeps them; the new actions start unbound
  const taken = migrateKeys(d, { cycle: " ", map: "o", loadout: "tab" });
  assert.equal(taken.map, "o");
  assert.equal(taken.loadout, "tab");
  assert.equal(taken.achievements, "");
  assert.equal(taken.panels, "");
  assert.equal(taken.recipes, "f5");
  // keys the save already has for the new actions are kept
  const saved = migrateKeys(d, { panels: "g", recipes: "", achievements: "o" });
  assert.equal(saved.panels, "g");
  assert.equal(saved.recipes, "");
  assert.equal(saved.achievements, "o");
});

test("the help's weapon and inventory keys: Space or the wheel's down turn, and Tab", () => {
  const s = defaultSettings();
  assert.deepEqual(commandKeys(s, "NEXT_WEAPON"), ["Space", "Wheel Down"]);
  assert.deepEqual(commandKeys(s, "PREV_WEAPON"), ["Wheel Up"]);
  assert.deepEqual(commandKeys(s, "TOGGLE_PANELS"), ["Tab"]);
  assert.deepEqual(commandKeys(s, "MOVE_FORWARD"), []);
  assert.deepEqual(commandKeys({ ...s, mouseMove: true }, "MOVE_FORWARD"), ["Left Mouse"]);
});
