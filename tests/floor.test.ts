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

/** The floor index as it was built at load: every face looking up, in every cell it touches. */
function eagerFloorZ(sprites: [number[], number[], number][]) {
  const cells = new Map<string, { v: Float32Array; flags: number }[]>();
  for (const [tris, m, flags] of sprites) {
    if (!flags) continue;
    const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
    for (let i = 0; i + 8 < tris.length; i += 9) {
      const w = new Float32Array(9);
      for (let k = 0; k < 3; k++) {
        const x = tris[i + k * 3], y = tris[i + k * 3 + 1], z = tris[i + k * 3 + 2];
        w[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        w[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        w[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      if (((w[3] - w[0]) * (w[7] - w[1]) - (w[4] - w[1]) * (w[6] - w[0])) * (det < 0 ? -1 : 1) <= 1e-9) continue;
      const x0 = Math.floor(Math.min(w[0], w[3], w[6])), x1 = Math.floor(Math.max(w[0], w[3], w[6]));
      const y0 = Math.floor(Math.min(w[1], w[4], w[7])), y1 = Math.floor(Math.max(w[1], w[4], w[7]));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) continue;
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const list = cells.get(cx + "," + cy) ?? [];
        list.push({ v: w, flags });
        cells.set(cx + "," + cy, list);
      }
    }
  }
  return (x: number, y: number, mask = 0xff) => {
    let best = -Infinity;
    for (const t of cells.get(Math.floor(x) + "," + Math.floor(y)) ?? []) if (t.flags & mask) best = Math.max(best, rayDownZ(t.v, x, y));
    return best > -Infinity ? best : 0;
  };
}

test("the floor index, placed as queries reach it, answers as the one built at load did", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const sprites: [number[], number[], number][] = [];
  for (let n = 0; n < 300; n++) {
    const tris: number[] = [];
    const size = n % 50 === 0 ? 40 : 1 + rand() * 3;
    for (let t = 0; t < 1 + Math.floor(rand() * 6); t++) for (let v = 0; v < 3; v++) tris.push(rand() * size, rand() * size, rand() * 2);
    const a = rand() * Math.PI * 2, s = n % 7 === 0 ? -1 : 1;
    const m = Array.from(compose([rand() * 120 - 60, rand() * 120 - 60, rand() * 3], [0, 0, Math.sin(a / 2), Math.cos(a / 2)], 1));
    // some placements mirror (which flips the faces the ray test keeps)
    m[0] *= s; m[1] *= s; m[2] *= s;
    sprites.push([tris, m, n % 11 === 0 ? 2 : n % 13 === 0 ? 0 : 1]);
  }
  const c = new CollisionMap();
  for (const [tris, m, flags] of sprites) c.addFloor(tris, m as any, flags);
  assert.equal(c.floors.size, 0, "nothing is placed before a query");
  const ref = eagerFloorZ(sprites);
  for (let y = -70; y < 110; y += 0.37) for (let x = -70; x < 110; x += 0.41) {
    assert.equal(c.floorZ(x, y), ref(x, y), `at ${x}, ${y}`);
    assert.equal(c.floorZ(x, y, 0x02), ref(x, y, 0x02));
  }
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
