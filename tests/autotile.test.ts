import assert from "node:assert/strict";
import { test } from "node:test";
import { learn, paint, State } from "../src/gen/autotile.ts";
import { generateLayout, rng } from "../src/gen/layout.ts";

// A synthetic scene: a 6x6 floor ringed by edge tiles. Edges along the south side are placed
// unrotated with the floor to their north; the other sides are the same tile turned.
function scene() {
  const refs = [{ name: "T/Floor/Base" }, { name: "T/Edge/Cliff" }, { name: "T/Edge/Corner" }];
  const values = new Int32Array(64).fill(-1);
  const set = (x: number, y: number, tile: number, rot: number) => { values[(y << 3) | x] = (tile << 16) | rot; };
  for (let x = 1; x <= 6; x++) for (let y = 1; y <= 6; y++) set(x, y, 0, 0);
  for (let i = 1; i <= 6; i++) { set(i, 0, 1, 0); set(7, i, 1, 1); set(i, 7, 1, 2); set(0, i, 1, 3); }
  set(0, 0, 2, 0); set(7, 0, 2, 1); set(7, 7, 2, 2); set(0, 7, 2, 3);
  return { tileConfigs: refs.map(tile => ({ tile })), tiles: { granularity: 3, empty: -1, cells: { entries: [[{ x: 0, y: 0 }, { values }]] } } };
}

test("learned tiling paints floors as floor and edges facing the floor", () => {
  const model = learn([scene()], () => [1, 1], r => /Floor/.test(r.name));
  const cells = new Map<string, State>();
  for (let x = 10; x < 14; x++) for (let y = 10; y < 14; y++) cells.set(x + "," + y, State.Floor);
  for (let x = 9; x <= 14; x++) for (let y = 9; y <= 14; y++) if (!cells.has(x + "," + y)) cells.set(x + "," + y, State.Other);
  const out = paint(model, cells, rng(1));
  const at = (x: number, y: number) => out.find(p => p.x === x && p.y === y)!;
  const name = (x: number, y: number) => model.tiles[at(x, y).tile].name;
  assert.equal(name(11, 11), "T/Floor/Base");
  // the south edge faces north (rotation 0), the north edge is turned half way (rotation 2)
  assert.equal(name(11, 9), "T/Edge/Cliff");
  assert.equal(at(11, 9).rot, 0);
  assert.equal(at(11, 14).rot, 2);
  assert.equal(name(9, 9), "T/Edge/Corner");
});

test("layouts connect every room and put the exit away from the start", () => {
  const l = generateLayout(rng(42));
  assert.ok(l.rooms.length >= 5);
  assert.notEqual(l.exit, l.start);
  // flood the floor from the start room: every room is reached
  const floor = new Set([...l.cells].filter(([, s]) => s === State.Floor).map(([k]) => k));
  const r0 = l.rooms[0], seen = new Set([r0.x + "," + r0.y]), q = [[r0.x, r0.y]];
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = (x + dx) + "," + (y + dy);
      if (floor.has(k) && !seen.has(k)) { seen.add(k); q.push([x + dx, y + dy]); }
    }
  }
  for (const r of l.rooms) assert.ok(seen.has(r.x + "," + r.y), "room reachable");
});
