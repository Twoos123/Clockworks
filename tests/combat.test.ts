// The damage formula (src/game/combat.ts), as the client's damage summary computes it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { afterDefense, cappedBonus, dealt, decreaseDamage, impulseShare, increaseDamage, modifyDamage, readKnock, reduction } from "../src/game/combat.ts";
import { zeroAmounts } from "../src/game/depth.ts";
import { capValue, itemValue } from "../src/game/bonus.ts";
import { trapState } from "../src/game/props.ts";

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const amounts = (o: Partial<Record<string, number>>) => Object.assign(zeroAmounts(), o);

test("damage at or above the defence loses half the defence", () => {
  near(afterDefense(100, 60), 70);
  near(afterDefense(100, 100), 50);
  near(afterDefense(100, 0), 100);
  near(reduction(100, 100), 0.5);
});

test("damage below the defence loses half and 19% per decade more", () => {
  near(reduction(50, 100), 0.5 + 0.19 * Math.log10(50 / 15 + 1));
  near(afterDefense(50, 100), 50 * (0.5 - 0.19 * Math.log10(50 / 15 + 1)));
  // far enough below, nothing gets through
  assert.equal(afterDefense(10, 10000), 0);
  assert.equal(reduction(0, 50), 1);
});

test("increases go halfway to the multiple", () => {
  near(increaseDamage(100, 1.5), 125);
  near(modifyDamage(100, 2), 150);
  near(modifyDamage(100, 1), 100);
  assert.equal(modifyDamage(100, 0), 0);
  assert.equal(increaseDamage(0, 2), 0);
});

test("decreases find the damage doing that share against the original as defence", () => {
  const d = decreaseDamage(100, 0.5);
  assert.equal(Math.trunc(afterDefense(d, 100)), 25);
  assert.ok(d > 60 && d < 66, String(d));
  // a quarter
  const q = decreaseDamage(200, 0.25);
  assert.equal(Math.trunc(afterDefense(q, 200)), 25);
  assert.equal(modifyDamage(100, 0.5), d);
});

test("summed bonuses cap at six steps of 0.08", () => {
  near(cappedBonus(0.9), 0.48);
  near(cappedBonus(-0.9), -0.48);
  near(cappedBonus(0.16), 0.16);
});

test("dealt: per type against the same type, bonus first, unblockable untouched", () => {
  near(dealt(amounts({ NORMAL: 100, PIERCING: 40 }), amounts({ NORMAL: 60 })), 70 + 40);
  // a 0.24 bonus adds 12% before defence
  near(dealt(amounts({ NORMAL: 100 }), amounts({ NORMAL: 60 }), 0.24), 112 - 30);
  near(dealt(amounts({ UNBLOCKABLE: 30 }), amounts({ NORMAL: 500 })), 30);
  near(dealt(amounts({ NORMAL: 100 }), null), 100);
});

test("impulses ease out: 2u - u^2 of the distance, three quarters by halfway", () => {
  near(impulseShare(0, 1), 1);
  near(impulseShare(0, 0.5), 0.75);
  near(impulseShare(0.5, 1), 0.25);
  near(impulseShare(0.9, 2), 0.01);
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += impulseShare(i / 10, (i + 1) / 10);
  near(sum, 1);
  assert.deepEqual(readKnock({ translation: { x: 2.5, y: 0 }, duration: 300, level: 2 }), { distance: 2.5, duration: 300, level: 2 });
  assert.deepEqual(readKnock({ translation: { x: 1 } }), { distance: 1, duration: 0, level: 1 });
  assert.equal(readKnock(null), 0);
});

test("trap cycles: down, warn, up in interval units, offset", () => {
  assert.equal(trapState(0, "A", 1), 0);
  assert.equal(trapState(3.5, "A", 1), 1);
  assert.equal(trapState(4, "A", 1), 2);
  assert.equal(trapState(7.9, "A", 1), 2);
  assert.equal(trapState(8, "A", 1), 0);
  // B runs four intervals ahead of A: up when A is down
  assert.equal(trapState(0, "B", 1), 2);
  assert.equal(trapState(1, "SLOW", 0.5), 0);
  assert.equal(trapState(123, "UP", 1), 2);
  assert.equal(trapState(123, "DOWN", 1), 0);
});

test("ItemValueKey: named bonus levels are steps of the key's size, CUSTOM its own amount", () => {
  const e = (name: string) => ({ $enum: "ItemCodes$ItemBonus", name });
  near(itemValue("DAMAGE", e("LOW"), undefined, 0.5), 0.08);
  near(itemValue("DAMAGE", e("MAXIMUM"), undefined, 0), 0.48);
  near(itemValue("SPEED", e("MEDIUM"), false, 0), -0.08);
  near(itemValue("CHARGE", e("HIGH"), true, 0), 0.24);
  assert.equal(itemValue("HEALTH", e("VERY_HIGH"), true, 0), 160);
  near(itemValue("DAMAGE", undefined, undefined, 0.05), 0.05);
  near(itemValue("DAMAGE", e("CUSTOM"), false, 0.05), 0.05);
  near(capValue("SPEED", 0.5), 0.24);
  near(capValue("CHARGE", -1), -0.48);
});
