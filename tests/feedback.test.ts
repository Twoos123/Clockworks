import assert from "node:assert/strict";
import { test } from "node:test";
import { heartCount, hitFlash, numberLength, numberPose, numberStyle, performanceOf, performanceVariant, readShake, shakeOffset, shakeScale } from "../src/game/feedback.ts";
import { inTargetWedge, quadMovement } from "../src/game/knight.ts";

test("a struck actor flashes red, back to white over 150 ms on a squared curve", () => {
  assert.deepEqual(hitFlash(0), [1, 0, 0, 1]);
  assert.deepEqual(hitFlash(75), [1, 0.25, 0.25, 1]);
  assert.equal(hitFlash(150), null);
  assert.equal(hitFlash(-1), null);
});

test("ShakeCamera: class defaults, felt by distance, a decaying sine", () => {
  const d = readShake({});
  assert.deepEqual(d, { frequency: 50, falloff: 30, duration: 1, innerRadius: 10, outerRadius: 100, amplitude: [0, 0, 1] });
  // the monster hit shake (fx_gethit_monster-scaled, Normal (Small)): full within 1, gone past 3
  const s = readShake({ duration: 0.3, innerRadius: 1, falloff: 20, outerRadius: 3, amplitude: { x: 0.0125, y: -0.05, z: 0 } });
  assert.equal(shakeScale(s, 0.5), 1);
  assert.equal(shakeScale(s, 2), 0.5);
  assert.equal(shakeScale(s, 3.5), 0);
  assert.deepEqual(shakeOffset(s, 1, 0), [0, -0, 0]);
  const t = Math.PI / 100;
  const o = shakeOffset(s, 1, t);
  assert.ok(Math.abs(o[1] - -0.05 * Math.exp(-20 * t)) < 1e-9, "a peak of the 50 rad/s sine");
});

test("hit performance names the particle variant and the number's style", () => {
  const p = performanceOf(100, 100, 2000);
  assert.deepEqual(p, { kind: "STRONG", size: "SMALL" });
  assert.equal(performanceVariant(p), "Effective (Small)");
  assert.equal(numberStyle(p), "Effective Damage");
  assert.equal(numberStyle(performanceOf(40, 100, 100)), "Crap");
  assert.equal(performanceVariant(performanceOf(70, 100, 200)), "Normal (Large)");
  assert.equal(numberStyle(null), "Heal");
});

test("damage numbers appear after 0.15 s, pop and settle, fall, and are gone after their life", () => {
  assert.equal(numberPose("Damage", 0.1), null);
  const early = numberPose("Damage", 0.15 + 0.5 * 0.1)!;
  assert.ok(Math.abs(early.scale - 1.125) < 1e-9, "the pop at a tenth of its life");
  const later = numberPose("Damage", 0.15 + 0.5 * 0.5)!;
  assert.ok(Math.abs(later.scale - 0.75) < 1e-9);
  assert.ok(later.dz < early.dz && later.dz < -0.9, "shot downward, slowed by drag");
  assert.equal(numberPose("Damage", 0.15 + 0.5), null);
  assert.ok(Math.abs(numberLength("Damage") - 0.65) < 1e-9);
  assert.ok(Math.abs(numberLength("Effective Damage") - 0.9) < 1e-9, "1.5 s at twice the speed");
  const heal = numberPose("Heal", 0.5)!;
  assert.ok(heal.dz > 0 && heal.dx < 0, "heals drift up and aside");
});

test("hearts: one per 10 health, 1 to 15", () => {
  assert.equal(heartCount(1), 1);
  assert.equal(heartCount(35), 4);
  assert.equal(heartCount(999), 15);
});

test("QuadMovement: walk below 3.5, run above; the side by direction against facing", () => {
  assert.deepEqual(quadMovement(0, 0, 5), { set: "run", side: "forward", rate: 5 / 6 });
  assert.deepEqual(quadMovement(0, 0, 2.5), { set: "walk", side: "forward", rate: 2.5 });
  assert.equal(quadMovement(Math.PI, 0, 5).side, "backward");
  assert.equal(quadMovement(Math.PI / 2, 0, 5).side, "left");
  assert.equal(quadMovement(-Math.PI / 2, 0, 5).side, "right");
  assert.equal(quadMovement(Math.PI / 4, 0, 5).side, "left", "diagonals take the side");
});

test("auto-target: a triangle out to the distance at half the angle either side", () => {
  // 3 units, 90 degrees: the triangle's far corners at +-45 degrees
  assert.ok(inTargetWedge(0, 0, 0, 3, 90, 2, 0, 0.1));
  assert.ok(inTargetWedge(0, 0, 0, 3, 90, 1.5, 1.4, 0.1), "near the 45 degree edge");
  assert.ok(!inTargetWedge(0, 0, 0, 3, 90, 1, 1.6, 0.1), "outside the edge");
  assert.ok(!inTargetWedge(0, 0, 0, 3, 90, 2.9, 0, 0), "straight ahead the triangle reaches only 3 cos 45 degrees");
  assert.ok(!inTargetWedge(0, 0, 0, 3, 90, 2.4, 1.7, 0.1), "the far side is a chord, not an arc");
  assert.ok(inTargetWedge(0, 0, 0, 3, 90, 2.4, 1.7, 0.4), "but a big enough monster reaches it");
  assert.ok(!inTargetWedge(0, 0, 0, 3, 90, -1, 0, 0.3), "behind");
});
