import assert from "node:assert/strict";
import { test } from "node:test";
import { CollisionMap } from "../src/game/collision.ts";

test("A* routes around a wall through its gap", () => {
  const c = new CollisionMap();
  // a 12x12 floor with a wall along x = 5 except a gap at y = 9
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) {
    c.cells.set(CollisionMap.key(x, y), { flags: x === 5 && y !== 9 ? 1 : 0, floor: true, z: 0 });
  }
  assert.equal(c.clearLine(2.5, 2.5, 8.5, 2.5, 0.3, 1), false);
  const path = c.findPath(2.5, 2.5, 8.5, 2.5, 0.3, 1);
  assert.ok(path, "a path exists");
  assert.ok(path!.some(([x, y]) => Math.floor(x) === 5 && Math.floor(y) === 9), "it passes through the gap");
  assert.deepEqual(path![path!.length - 1], [8.5, 2.5]);
  // no way through: null
  c.cells.set(CollisionMap.key(5, 9), { flags: 1, floor: true, z: 0 });
  assert.equal(c.findPath(2.5, 2.5, 8.5, 2.5, 0.3, 1, 500), null);
});
