import assert from "node:assert/strict";
import { test } from "node:test";
import { collidesWith, separationShares } from "../src/game/collision.ts";
import { modelPass } from "../src/render/renderer.ts";
import type { PassState } from "../src/config/materials.ts";

// Character/PC/Default, Character/NPC/Snipe/Snipe, Walk, a jelly, Character/NPC/Haven/Stranger
const knight = { collisionFlags: 4, collisionMask: 43 };
const snipe = { collisionFlags: 4, collisionMask: 79 };
const monster = { collisionFlags: 8, collisionMask: 79 };
const stranger = { collisionFlags: 8, collisionMask: 15 };
// a monster that blocks the knight but walks through it (mask 3, flags 8)
const oneWay = { collisionFlags: 8, collisionMask: 3 };

test("collision between actors is one-way, as Tudey's Actor.collidesWith", () => {
  assert.equal(collidesWith(knight, snipe), false);
  assert.equal(collidesWith(snipe, knight), true);
  assert.equal(collidesWith(knight, monster), true);
  assert.equal(collidesWith(monster, knight), true);
});

test("the knight walks through snipes, and idle snipes are not shoved aside", () => {
  assert.deepEqual(separationShares(knight, snipe, true, false), [0, 0]);
  assert.deepEqual(separationShares(snipe, knight, false, true), [0, 0]);
});

test("the knight and monsters (and strangers) still push apart halfway", () => {
  assert.deepEqual(separationShares(knight, monster), [0.5, 0.5]);
  assert.deepEqual(separationShares(knight, stranger, true, false), [0.5, 0.5]);
});

test("in a one-way pair only the blocked one yields", () => {
  assert.deepEqual(separationShares(knight, oneWay), [1, 0]);
  assert.deepEqual(separationShares(oneWay, knight), [0, 1]);
});

const pass = (p: Partial<PassState>): PassState => ({
  srcBlend: "ONE", destBlend: "ZERO", alphaFunc: "ALWAYS", alphaRef: 0, depthFunc: "LEQUAL", depthMask: true, cullFace: "BACK",
  color: null, lit: true, ambient: null, overrideLights: 0, ignoreVertexColors: false, fog: true, fogLinear: null, units: [], shaders: [], ...p,
} as PassState);

test("a model with light influences off draws its scene-lit passes unlit", () => {
  const p = pass({});
  assert.equal(modelPass(p, true), p);
  const u = modelPass(p, false);
  assert.equal(u.lit, false);
  assert.equal(modelPass(p, false), u, "cached per pass");
  // a light-state override of its own keeps it lit; an unlit pass is unchanged
  const own = pass({ ambient: [0.5, 0.5, 0.5, 1] });
  assert.equal(modelPass(own, false), own);
  const off = pass({ lit: false });
  assert.equal(modelPass(off, false), off);
});
