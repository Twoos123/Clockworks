import assert from "node:assert/strict";
import { test } from "node:test";
import { learn, paint, remapModel, remapName, State } from "../src/gen/autotile.ts";
import { ruleModel } from "../src/gen/rules.ts";
import { mergeGlobals } from "../src/gen/themes.ts";
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

// --- theme remapping

const facts = (entries: [string, boolean][]) => new Map(entries.map(([n, walkable]) => [n, { width: 1, height: 1, walkable }]));

test("remapping takes the same-suffix tile of the target theme", () => {
  const target = facts([["Night/Floor/Base", true], ["Night/Edge/Cliff", false]]);
  const rules = [{ from: "Day", to: "Night" }];
  assert.equal(remapName("Day/Floor/Base", rules, target, { width: 1, height: 1, walkable: true }), "Night/Floor/Base");
  assert.equal(remapName("Day/Edge/Cliff", rules, target), "Night/Edge/Cliff");
  // other themes' tiles are left alone
  assert.equal(remapName("Traps/Spikes", rules, target), null);
});

test("remapping falls back to the nearest-named tile of the same walkability", () => {
  const target = facts([["G/Wall/Flat A01", false], ["G/Wall/Corner OUT 03", false], ["G/Wall/Corner OUT, arch", false],
    ["G/Floor/Grass 01", true], ["G/Floor Edge/02", false], ["G/Floor Edge/Corner In 01", false]]);
  const rules = [{ from: "L", to: "G", alias: [[/^Rail\//, "Floor Edge/"]] as [RegExp, string][] },
    { from: "Ice", to: "G", alias: [[/^0?(\d+)$/, "Floor/Grass 0$1"]] as [RegExp, string][] }];
  const wall = { width: 1, height: 1, walkable: false };
  assert.equal(remapName("L/Wall/Flat A", rules, target, wall), "G/Wall/Flat A01");
  assert.equal(remapName("L/Wall/Corner OUT 01", rules, target, wall), "G/Wall/Corner OUT 03");
  assert.equal(remapName("L/Rail/02", rules, target, wall), "G/Floor Edge/02");
  assert.equal(remapName("L/Rail/Corner In 01", rules, target, wall), "G/Floor Edge/Corner In 01");
  assert.equal(remapName("Ice/01", rules, target, { width: 1, height: 1, walkable: true }), "G/Floor/Grass 01");
  // floors stay floors: a walkable tile takes a walkable one of its folder...
  assert.equal(remapName("L/Floor/Rug", rules, target, { width: 1, height: 1, walkable: true }), "G/Floor/Grass 01");
  // ...and with nothing walkable alike (only walls share its words) keeps the source tile
  assert.equal(remapName("L/Stairs/Corner In", rules, target, { width: 1, height: 1, walkable: true }), null);
});

test("a remapped model paints the target theme's tiles in the learned places", () => {
  const model = learn([scene()], () => [1, 1], r => /Floor/.test(r.name));
  const target = facts([["U/Floor/Base", true], ["U/Edge/Cliff", false], ["U/Edge/Corner", false]]);
  const mirrored = remapModel(model, n => remapName(n, [{ from: "T", to: "U" }], target));
  assert.equal(mirrored.cases, model.cases);
  const cells = new Map<string, State>();
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) cells.set(x + "," + y, State.Floor);
  for (let x = -1; x <= 4; x++) for (let y = -1; y <= 4; y++) if (!cells.has(x + "," + y)) cells.set(x + "," + y, State.Other);
  const out = paint(mirrored, cells, rng(3));
  const at = (x: number, y: number) => out.find(p => p.x === x && p.y === y)!;
  assert.equal(mirrored.tiles[at(1, 1).tile].name, "U/Floor/Base");
  assert.equal(mirrored.tiles[at(1, -1).tile].name, "U/Edge/Cliff");
  assert.equal(at(1, -1).rot, 0);
  assert.equal(at(1, 4).rot, 2);
});

test("rule-based tiling walls the floor in, each piece turned toward it", () => {
  const names = facts([["R/Floor/A", true], ["R/Floor/B", true], ["R/Wall/Flat", false], ["R/Wall/In", false], ["R/Wall/Out", false]]);
  const model = ruleModel({ prefix: "R", floor: /^Floor\//, wall: /^Wall\/Flat/, cornerIn: /^Wall\/In/, cornerOut: /^Wall\/Out/ }, names);
  const cells = new Map<string, State>();
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) cells.set(x + "," + y, State.Floor);
  for (let x = -1; x <= 5; x++) for (let y = -1; y <= 5; y++) if (!cells.has(x + "," + y)) cells.set(x + "," + y, State.Other);
  const out = paint(model, cells, rng(9));
  const at = (x: number, y: number) => { const p = out.find(p => p.x === x && p.y === y)!; return [model.tiles[p.tile].name, p.rot]; };
  assert.match(String(at(2, 2)[0]), /^R\/Floor\//);
  // floor to the north, west, south, east of the wall: rotations 0, 1, 2, 3
  assert.deepEqual(at(2, -1), ["R/Wall/Flat", 0]);
  assert.deepEqual(at(5, 2), ["R/Wall/Flat", 1]);
  assert.deepEqual(at(2, 5), ["R/Wall/Flat", 2]);
  assert.deepEqual(at(-1, 2), ["R/Wall/Flat", 3]);
  // the ring's corners see the floor on one diagonal only: outer corners (floor northwest: 0)
  assert.deepEqual(at(5, -1), ["R/Wall/Out", 0]);
  assert.deepEqual(at(-1, -1), ["R/Wall/Out", 3]);
  // every ring cell is a blocking piece, every inner cell walkable floor
  for (const p of out) assert.equal(names.get(model.tiles[p.tile].name)!.walkable, cells.get(p.x + "," + p.y) === State.Floor);
});

test("theme presets replace the level's globals of the same kind", () => {
  const g = (name: string) => ({ $class: "x$GlobalEntry", sceneGlobal: { name } });
  const merged = mergeGlobals([g("Environment/Fog"), g("Camera"), g("Environment/Light"), g("Environment/Ambient")],
    ["Environment/Custom/Graveyard/Default/Fog", "Environment/Custom/Graveyard/Default/Light Set"]);
  assert.deepEqual(merged.map(e => e.sceneGlobal.name), ["Camera", "Environment/Custom/Graveyard/Default/Fog", "Environment/Custom/Graveyard/Default/Light Set"]);
});

test("a sky preset replaces the level's skyboxes and sky models", () => {
  const ref = (name: string, model?: string) => ({ $class: "x$GlobalEntry", sceneGlobal: { name,
    ...(model ? { arguments: { entries: [["Model", { name: model }]] } } : {}) } });
  const merged = mergeGlobals([ref("Camera"), ref("Environment/Skybox", "world/skybox/visionfog/skybox.dat"),
    ref("Environment/Model", "world/skybox/clockwork_tunnels/model.dat"), ref("Environment/Model", "particle/world_floatingembers.dat")],
    [{ name: "Environment/Model", arguments: { entries: [["Model", { name: "world/skybox/castle_firestorm/model.dat" }]] } }]);
  assert.deepEqual(merged.map(e => JSON.stringify(e.sceneGlobal.arguments?.entries?.[0]?.[1]?.name ?? e.sceneGlobal.name)),
    ['"Camera"', '"particle/world_floatingembers.dat"', '"world/skybox/castle_firestorm/model.dat"']);
});
