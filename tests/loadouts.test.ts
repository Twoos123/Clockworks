import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyAppearance } from "../src/game/accessories.ts";
import { MAX_LOADOUTS, normalizeLoadouts, saveLoadout, wearableLoadout, type SaveData } from "../src/game/save.ts";

const save = (): SaveData => ({
  version: 2, crowns: 0, heat: 0, materials: {}, bestDepth: 0, runs: 0, gear: {}, recipes: [], color: 257, pocket: [], heatAmplifier: 0,
  loadout: { weapons: ["Weapon/Sword/Proto Sword", "Weapon/Handgun/Proto Gun"], shield: "Gear/Shield/Proto Shield", armor: "", helmet: "", trinkets: [], vitapod: "" },
  owned: ["Weapon/Sword/Proto Sword", "Weapon/Handgun/Proto Gun", "Gear/Shield/Proto Shield"],
  appearance: { ...emptyAppearance(), costume: { armor: "", helmet: "Costume/Helm/Aero Helm/Aero Helm, Green", shield: "" } },
});

test("saving a loadout copies the gear, costumes and sprite; the same name replaces it", () => {
  const d = save();
  assert.ok(saveLoadout(d, " Gunner ", "Drakon"));
  assert.equal(d.loadouts![0].name, "Gunner");
  assert.equal(d.loadouts![0].sprite, "Drakon");
  assert.equal(d.loadouts![0].appearance.costume.helmet, "Costume/Helm/Aero Helm/Aero Helm, Green");
  d.loadout.weapons.pop();
  assert.equal(d.loadouts![0].loadout.weapons.length, 2, "a copy, not the live loadout");
  assert.ok(saveLoadout(d, "gunner", ""));
  assert.equal(d.loadouts!.length, 1);
  assert.equal(d.loadouts![0].loadout.weapons.length, 1);
});

test("the list holds ten loadouts", () => {
  const d = save();
  for (let i = 0; i < MAX_LOADOUTS; i++) assert.ok(saveLoadout(d, `L${i}`, ""));
  assert.equal(saveLoadout(d, "one more", ""), false);
  assert.ok(saveLoadout(d, "L3", ""), "an existing name still saves");
});

test("a saved loadout wears only what is still owned; broken saves are repaired", () => {
  const d = save();
  saveLoadout(d, "A", "");
  d.owned = d.owned.filter(n => n !== "Weapon/Handgun/Proto Gun");
  assert.deepEqual(wearableLoadout(d, d.loadouts![0]).weapons, ["Weapon/Sword/Proto Sword"]);
  const fixed = normalizeLoadouts([{ name: "X", loadout: { weapons: ["a", 3, "b", "c", "d"], trinkets: "no" } }, { name: "" }, null]);
  assert.equal(fixed.length, 1);
  assert.deepEqual(fixed[0].loadout.weapons, ["a", "b", "c"]);
  assert.deepEqual(fixed[0].loadout.trinkets, []);
});
