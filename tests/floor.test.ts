import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CollisionMap, rayDownZ } from "../src/game/collision.ts";
import { compose } from "../src/math.ts";
import { floorTriangles, type LoadedModel } from "../src/model.ts";

// a 2x1 ramp rising 1 unit along +x, wound counter-clockwise seen from above (faces up)
const RAMP = [0, 0, 0, 2, 0, 1, 2, 1, 1, 0, 0, 0, 2, 1, 1, 0, 1, 0];

test("a vertical ray meets a triangle at its interpolated height", () => {
  assert.equal(rayDownZ([0, 0, 0, 2, 0, 1, 2, 1, 1], 1, 0.25), 0.5);
  assert.equal(rayDownZ([0, 0, 0, 2, 0, 1, 2, 1, 1], 0.25, 0.9), -Infinity);
});

test("floors follow the floor mesh, the highest face wins, and the tile grid stands in elsewhere", () => {
  const c = new CollisionMap();
  c.cells.set(CollisionMap.key(5, 5), { flags: 0, floor: true, z: 1.5 });
  c.addFloor(RAMP, compose([10, 0, 2], [0, 0, 0, 1], 1));
  assert.ok(Math.abs(c.groundZ(10.5, 0.5) - 2.25) < 1e-6);
  assert.ok(Math.abs(c.groundZ(11.5, 0.5) - 2.75) < 1e-6);
  // a lower face under the ramp does not win
  c.addFloor([0, 0, 0, 1, 0, 0, 0, 1, 0], compose([10, 0, 0], [0, 0, 0, 1], 1));
  assert.ok(Math.abs(c.groundZ(10.2, 0.2) - 2.1) < 1e-6);
  // no floor mesh: the tile elevation, then 0
  assert.equal(c.groundZ(5.5, 5.5), 1.5);
  assert.equal(c.groundZ(50, 50), 0);
});

test("faces looking down, sprites without floor flags and masked-out floors are ignored", () => {
  const c = new CollisionMap();
  // the ramp wound clockwise: its front faces down, which a downward ray passes through
  const flipped = [0, 0, 0, 2, 1, 1, 2, 0, 1, 0, 0, 0, 0, 1, 0, 2, 1, 1];
  c.addFloor(flipped, compose([0, 0, 0], [0, 0, 0, 1], 1));
  c.addFloor(RAMP, compose([0, 0, 5], [0, 0, 0, 1], 1), 0);
  assert.equal(c.groundZ(1, 0.5), 0);
  c.addFloor(RAMP, compose([0, 0, 0], [0, 0, 0, 1], 1), 0x02);
  assert.ok(Math.abs(c.floorZ(1, 0.5, 0x02) - 0.5) < 1e-6);
  assert.equal(c.floorZ(1, 0.5, 0x01), 0);
  // rotated a quarter turn the ramp rises along +y
  const r = new CollisionMap();
  r.addFloor(RAMP, compose([0, 0, 0], [0, 0, Math.SQRT1_2, Math.SQRT1_2], 1));
  assert.ok(Math.abs(r.groundZ(-0.5, 1.5) - 0.75) < 1e-6);
});

test("a model's floor triangles include its attachments, placed by their transforms", () => {
  const leaf: LoadedModel = { path: "a", kind: "Static", parts: [], attachments: [], autoAnimations: [], animations: {}, billboards: new Map(),
    procedurals: [], skipped: [], collision: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  const outer: LoadedModel = { ...leaf, path: "b", kind: "Compound", collision: undefined,
    attachments: [{ node: "", transform: { t: [3, 0, 2], r: [0, 0, 0, 1], s: 1 }, model: leaf }] };
  assert.deepEqual(Array.from(floorTriangles(outer)), [3, 0, 2, 4, 0, 2, 3, 1, 2]);
});

// Haven town square's stairways (scene 1) are tiles whose model is a ramp-shaped collision
// mesh: the knight walks up them instead of standing at the bottom tile's elevation
const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
test("Haven's stairways lift the knight step by step (when the install is present)", async () => {
  const file = join(SK, "scenes", "1");
  if (!existsSync(file) || !existsSync(join(SK, "rsrc", "config", "tile.dat"))) return;
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const { SceneLoader } = await import("../src/scene.ts");
  const scene = await new SceneLoader(nodeLoader()).load("1", new Uint8Array(readFileSync(file)));
  const c = scene.collision;
  // [from, to, bottom z, top z]: the south stairway (tiles at y -24..-19, elevation -7),
  // the west one (x -24..-19 running down toward +x) and the east one (x 20..25)
  const runs: [[number, number], [number, number], number, number][] = [
    [[0.5, -25.5], [0.5, -17.5], -3.5, -0.5],
    [[-14.5, 0.5], [-25.5, 0.5], -0.5, 2.5],
    [[18.5, -5.5], [26.5, -5.5], -0.5, 2.5],
  ];
  for (const [[x0, y0], [x1, y1], lo, hi] of runs) {
    let prev = -Infinity;
    const zs: number[] = [];
    for (let i = 0; i <= 32; i++) {
      const z = c.groundZ(x0 + (x1 - x0) * i / 32, y0 + (y1 - y0) * i / 32);
      // (the paving at either end has small bumps of its own)
      assert.ok(z >= prev - 0.1, `stairs only climb: ${zs.join(" ")} then ${z}`);
      zs.push(z);
      prev = z;
    }
    assert.ok(Math.abs(zs[0] - lo) < 0.15 && Math.abs(zs[32] - hi) < 0.15, `from ${lo} to ${hi}: ${zs.join(" ")}`);
    // halfway up, the knight is halfway up, not at the bottom tile's elevation
    assert.ok(zs.some(z => z > lo + 1 && z < hi - 1), `intermediate heights: ${zs.join(" ")}`);
  }
});
