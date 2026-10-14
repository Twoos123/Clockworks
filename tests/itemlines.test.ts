import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeKey, levelLines, statusLines } from "../src/game/itemlines.ts";

const enumOf = (name: string) => ({ $enum: "x", name });
const item = (cfg: any) => ({ resolveSync: () => cfg }) as any;
const eco = (levels: any[]) => ({ levelConfigs: () => levels }) as any;

test("ItemValueKey grades: steps of the key's size", () => {
  assert.equal(gradeKey("DAMAGE", 0.08), "m.low");
  assert.equal(gradeKey("DAMAGE", 0.24), "m.high");
  assert.equal(gradeKey("CHARGE", -0.1), "m.medium");
  assert.equal(gradeKey("SPEED", 1), "m.maximum");
});

test("a weapon's status values become 'chance of causing' rows with the condition's icon", () => {
  const sword = item({ $class: "x.ItemConfig$Sword", statusValues: [{ flags: 4, chance: enumOf("VERY_HIGH"), power: enumOf("STRONG") }] });
  const rows = statusLines(sword, "Weapon/Sword/Combuster");
  assert.equal(rows.length, 1);
  assert.match(rows[0].text, /Good chance of causing Strong Fire/i);
  assert.equal(rows[0].icon, "ui/icon/debuff/fire.png");
  assert.deepEqual(statusLines(item({ $class: "x.ItemConfig$Armor" }), "Gear/Armor/X"), []);
});

test("level rows: a weapon's tagged damage, charge time; gear's damage bonus", () => {
  const basher = item({ $class: "x.ItemConfig$Sword", globalModifier: { $class: "x.LevelConfig$TaggedDamageBonus", damage: 0.35, bonus: enumOf("HIGH"), tag: "fam_beast" } });
  const rows = levelLines(basher, eco([{ $class: "x.LevelConfig$ChargeTimeReduction", bonus: enumOf("MEDIUM") },
    { $class: "x.LevelConfig$RelativeDamageBonus", bonus: enumOf("LOW") }]), "Weapon/Sword/Big Beast Basher", 3);
  assert.deepEqual(rows.map(r => r.text), ["Charge Time Reduction: Medium", "Damage Bonus vs Fam Beast: High"]);
  const armor = item({ $class: "x.ItemConfig$Armor", globalModifier: { $class: "x.LevelConfig$Empty" } });
  const g = levelLines(armor, eco([{ $class: "x.LevelConfig$Compound", levels: [{ $class: "x.LevelConfig$HealthBonus", health: 80 },
    { $class: "x.LevelConfig$WeaponClass", weaponClass: enumOf("SWORD"), level: { $class: "x.LevelConfig$RelativeDamageBonus", bonus: enumOf("MEDIUM") } }] }]),
  "Gear/Armor/X", 5);
  assert.equal(g[0].text, "Health Bonus: +2");
  assert.equal(g[1].text, "Damage Bonus: Medium");
  assert.equal(g[1].icon, "ui/icon/inventory/categories/icon_sword.png");
});
