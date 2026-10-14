import assert from "node:assert/strict";
import { test } from "node:test";
import { ARSENAL_STATION, canChangeEquipment, canEquipAt, levelCanEquip, policyOf, setEquipGate } from "../src/game/equippolicy.ts";
import { CATEGORIES, type ItemEntry } from "../src/game/items.ts";
import type { SaveData } from "../src/game/save.ts";
import { applyItemAction, itemMenu } from "../src/ui/itemmenu.ts";

const save = (): SaveData => ({
  version: 2, crowns: 0, heat: 0, materials: {}, bestDepth: 0, runs: 0, gear: {}, recipes: [], color: 257, pocket: [], heatAmplifier: 0,
  loadout: { weapons: ["Weapon/Sword/Proto Sword", "Weapon/Handgun/Proto Gun"], shield: "Gear/Shield/Proto Shield", armor: "Gear/Armor/Cobalt Armor", helmet: "", trinkets: [], vitapod: "" },
  owned: [], missions: { rank: 10, subrank: 1, completed: [], prestige: 0, cycles: {} },
});
const sword: ItemEntry = { name: "Weapon/Sword/Proto Sword", label: "Proto Sword", rarity: 0, icon: null, category: CATEGORIES.find(c => c.id === "sword")! };
const none = { helmet: "", armor: "", shield: "" };

test("LevelType.canEquip: towns, lobbies, terminals, subtowns and the Core allow gear changes; Clockworks levels do not", () => {
  assert.ok(levelCanEquip({ town: true }));
  assert.ok(levelCanEquip({ town: false, lobby: true }));
  for (const k of ["terminal", "subtown", "core", "lobby"]) assert.ok(levelCanEquip({ town: false, floorKind: k }), k);
  for (const k of ["level", "boss"]) assert.ok(!levelCanEquip({ town: false, floorKind: k }), k);
  // archived scenes outside a gate
  assert.ok(levelCanEquip({ town: false, sceneName: "terminal 1" }));
  assert.ok(levelCanEquip({ town: false, sceneName: "emberlight" }));
  assert.ok(!levelCanEquip({ town: false, sceneName: "jigsaw valley emerald axis" }));
});

test("an Arsenal Station's SetEquipPolicy ANY lets gear change in a Clockworks level (LevelPartyObject.a)", () => {
  const level = { town: false, floorKind: "level" };
  assert.ok(!canEquipAt(level, "NORMAL"));
  assert.ok(canEquipAt(level, "ANY"));
  assert.ok(!canEquipAt(level, "PVP_LOADOUT"));
  // the zone's IntersectionStart sets ANY, its IntersectionStop the default NORMAL
  assert.equal(policyOf({ equipPolicy: { $enum: "com.threerings.projectx.data.PlayerObject$EquipPolicy", name: "ANY" } }), "ANY");
  assert.equal(policyOf({}), "NORMAL");
  assert.ok(ARSENAL_STATION.test("Dynamic/Misc/Arsenal/Arsenal Zone"));
  assert.ok(ARSENAL_STATION.test("Dynamic/Misc/Arsenal/Arsenal Box"));
  assert.ok(!ARSENAL_STATION.test("Dynamic/Misc/Arsenal/Arsenal Arrow"));
});

test("away from a station the item menu offers no Equip or Unequip, and equipping is refused", () => {
  const d = save();
  const locked = itemMenu(d, none, sword, false);
  assert.deepEqual(locked.map(m => m.action), ["cant_equip", "compare"]);
  assert.equal(locked[0].enabled, false);
  assert.equal(applyItemAction(d, sword, "equip_7", false), null);
  assert.deepEqual(itemMenu(d, none, sword, true).map(m => m.action), ["unequip_6", "equip_7", "equip_8", "compare"]);
});

test("the item windows read the game's gate (M.K), which defaults to allowing changes", () => {
  assert.ok(canChangeEquipment());
  setEquipGate(() => false);
  try {
    assert.ok(!canChangeEquipment());
    assert.deepEqual(itemMenu(save(), none, sword).map(m => m.action), ["cant_equip", "compare"]);
  } finally {
    setEquipGate(() => true);
  }
});
