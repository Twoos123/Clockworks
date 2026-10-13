import assert from "node:assert/strict";
import { test } from "node:test";
import {
  costumeSlot, dressArgs, emptyAppearance, equipAccessory, equipCostume, normalizeAppearance, removeAccessory, slotOfLocation,
} from "../src/game/accessories.ts";

const ref = (name: string, entries: [string, unknown][] = []) => ({ $class: "com.threerings.config.ConfigReference", name, arguments: { $map: "x", entries } });

test("accessory locations map to the body model's parameters; the default is the helmet top", () => {
  assert.equal(slotOfLocation("ItemCodes$AccessoryLocation.ARMOR_BACK"), "armor_back");
  assert.equal(slotOfLocation("ItemCodes$AccessoryLocation.HELM_FRONT"), "helm_front");
  assert.equal(slotOfLocation({ $enum: "com.threerings.projectx.item.ItemCodes$AccessoryLocation", name: "ARMOR_AURA" }), "armor_aura");
  assert.equal(slotOfLocation(undefined), "helm_top");
});

test("an accessory replaces what is in its slot; a multi-slot one clears its second slot too", () => {
  const app = emptyAppearance();
  equipAccessory(app, "Wings", { slot: "armor_back", also: null });
  equipAccessory(app, "Hat", { slot: "helm_top", also: null });
  equipAccessory(app, "Cape", { slot: "armor_back", also: null });
  assert.deepEqual({ ...app.accessories }, { armor_back: "Cape", helm_top: "Hat" });
  const defs = (n: string) => n === "Symbol" ? { slot: "armor_aura" as const, also: "armor_back" as const } : { slot: "armor_back" as const, also: null };
  const freed = equipAccessory(app, "Symbol", { slot: "armor_aura", also: "armor_back" }, defs);
  assert.deepEqual(freed, ["armor_back"]);
  assert.equal(app.accessories.armor_aura, "Symbol");
  // a back accessory now pushes the multi-slot one out
  equipAccessory(app, "Wings", { slot: "armor_back", also: null }, defs);
  assert.equal(app.accessories.armor_aura, undefined);
  removeAccessory(app, "helm_top");
  assert.deepEqual(app.accessories, { armor_back: "Wings" });
});

test("costumes replace the shown armour, helmet and shield; accessories add parameters", () => {
  assert.equal(costumeSlot("Costume/Helm/Aero Helm/Aero Helm, Blue"), "helmet");
  assert.equal(costumeSlot("Gear/Helm/Cobalt Helm"), null);
  const app = emptyAppearance();
  equipCostume(app, "helmet", "Costume/Helm/X");
  assert.equal(app.costume.helmet, "Costume/Helm/X");
  const args: [string, any][] = [["Colorization", 300], ["Armor", ref("armor.dat")], ["Helmet", ref("helm.dat")]];
  const out = dressArgs(args, { armor: null, helmet: ref("costume_helm.dat", [["Colorization", 257]]), shield: ref("shield_costume.dat"),
    attachments: [["armor_back", ref("wings.dat")]], step: ref("particle/footstep/x.dat") }, 300);
  const m = new Map(out);
  assert.equal(m.get("Armor").name, "armor.dat", "no armour costume: the gear shows");
  assert.equal(m.get("Helmet").name, "costume_helm.dat");
  assert.equal(new Map(m.get("Helmet").arguments.entries).get("Colorization"), 300, "costumes take the personal colour");
  assert.equal(m.has("Shield"), false, "a shield costume does not add a shield the knight is not holding");
  assert.equal(m.get("armor_back").name, "wings.dat");
  assert.equal(m.get("Step Effect").name, "particle/footstep/x.dat");
});

test("a saved appearance is repaired", () => {
  const a = normalizeAppearance({ accessories: { helm_top: "Hat", bogus: "x" } as any, costume: { armor: "Costume/Armor/A" } as any });
  assert.deepEqual(a.accessories, { helm_top: "Hat" });
  assert.deepEqual(a.costume, { armor: "Costume/Armor/A", helmet: "", shield: "" });
});
