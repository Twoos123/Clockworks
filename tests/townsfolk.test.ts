import assert from "node:assert/strict";
import { test } from "node:test";
import { pickMovement, pickWeighted, startWander, stepWander, WANDER, wanders } from "../src/game/townsfolk.ts";

const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

test("idles are drawn by weight (default 1)", () => {
  const idles = [{}, { weight: 0.5 }, { weight: 0.1 }];
  assert.equal(pickWeighted(idles, () => 0), 0);
  assert.equal(pickWeighted(idles, () => 0.7), 1);
  assert.equal(pickWeighted(idles, () => 0.99), 2);
  assert.equal(pickWeighted([], () => 0), null);
});

test("the movement nearest the actor's speed plays, at the matching rate", () => {
  const mv = [{ animation: "walk", speed: 1 }, { animation: "run", speed: 6 }];
  assert.deepEqual(pickMovement(mv, 1.5), { animation: "walk", rate: 1.5 });
  assert.deepEqual(pickMovement(mv, 5), { animation: "run", rate: 5 / 6 });
  assert.equal(pickMovement([], 1), null);
});

test("wanderers pause, walk, turn about when blocked and come home past the radius", () => {
  const w = startWander(0, 0, () => 0);
  assert.equal(w.walking, false);
  let s = stepWander(w, 0, 0, WANDER.pause[0] + 0.01, false, seq(0.5));
  assert.equal(s.walk, true);
  const dir = s.dir;
  s = stepWander(w, 0, 0, 0.1, true, () => 0);
  assert.ok(Math.abs(s.dir - dir - Math.PI / 2) < 1e-9);
  s = stepWander(w, WANDER.radius + 1, 0, 0.1, false, () => 0);
  assert.ok(Math.abs(Math.abs(s.dir) - Math.PI) < 1e-9);
  assert.ok(wanders("Character/NPC/Emberlight/Gremlin (Wander)", 1.5));
  assert.ok(!wanders("Character/NPC/Haven/Stranger/Greeter", 0.66));
  assert.ok(!wanders("Character/NPC/Emberlight/Gremlin (Wander)", 0));
});
