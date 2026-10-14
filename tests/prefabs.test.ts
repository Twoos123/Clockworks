import assert from "node:assert/strict";
import { test } from "node:test";
import { nameSides, segment } from "../src/gen/prefabs.ts";
import { assemble, assembledRoot, libraryPieces, type LibPiece } from "../src/gen/assemble.ts";
import { classifyCapture, classifyLevel, LevelArchive } from "../src/game/archive.ts";
import { gateFloors, makeGate, BOSSES } from "../src/game/clockworks.ts";

// a synthetic generated floor: tiles 0 (floor) and 1 (wall), prefab labels, tagged entries
const FLOOR = { name: "floor" }, WALL = { name: "wall" };
const facts = (ref: any) => ({ width: 1, height: 1, walkable: ref?.name === "floor" });
function floorRoot(rows: string[], labels: [string, number, number][], entries: any[] = []) {
  const blocks = new Map<string, { coord: { x: number; y: number }; values: Int32Array }>();
  rows.forEach((row, r) => {
    const y = rows.length - 1 - r;
    [...row].forEach((ch, x) => {
      if (ch === " ") return;
      const k = (x >> 3) + "," + (y >> 3);
      let b = blocks.get(k);
      if (!b) blocks.set(k, b = { coord: { x: x >> 3, y: y >> 3 }, values: new Int32Array(64).fill(-1) });
      b.values[((y & 7) << 3) | (x & 7)] = (ch === "." ? 0 : 1) << 16;
    });
  });
  const label = ([text, x, y]: [string, number, number]) => ({
    $class: "com.threerings.tudey.data.TudeySceneModel$PlaceableEntry",
    placeable: { name: "Dev/Label - Prefab", arguments: { entries: [["Text", text]] } },
    transform: { translation: { x, y, z: 0 } },
  });
  return {
    tiles: { granularity: 3, empty: -1, cells: { entries: [...blocks.values()].map(b => [b.coord, { values: b.values }]) } },
    tileConfigs: [{ tile: FLOOR }, { tile: WALL }],
    entries: [...labels.map(label), ...entries],
  };
}
const spawn = (tag: string, x: number, y: number) => ({
  $class: "com.threerings.tudey.data.TudeySceneModel$PlaceableEntry",
  placeable: { name: "Character/Monster/Generic/Subset Spawn", arguments: { entries: [["Tag", tag]] } },
  transform: { translation: { x, y, z: 0 } },
});

// start room (west), a corridor three wide, a general room (east) with an opening north to a treasure room
const ROWS = [
  "                      #######",
  "                      #.....#",
  "                      #.....#",
  "                      ##...##",
  "                       #...# ",
  "#######              ###...###",
  "#.....#              #.......#",
  "#.....################.......#",
  "#............................#",
  "#............................#",
  "#............................#",
  "#.....################.......#",
  "#.....#              #.......#",
  "#######              #########",
];

test("prefab names give their sides", () => {
  assert.deepEqual(nameSides("room_general_NEW_3w_5w_02"), ["N", "E", "W"]);
  assert.deepEqual(nameSides("room_golddoor_SN_5w_03"), ["S", "N"]);
  assert.deepEqual(nameSides("trans_Nwild_Scompound_01"), ["N", "S"]);
  assert.equal(nameSides("room_field_15w_01"), null);
});

test("a captured floor is cut at its corridors into the prefabs its labels name", () => {
  const root = floorRoot(ROWS, [["elevator_start_E_3w_01", 3, 4], ["room_general_NW_3w_01", 25, 5], ["room_treasure_S_3w_01", 25, 11]],
    [spawn("2_auto_subset 1", 24, 4), spawn("2_auto_subset 1", 27, 6)]);
  const seg = segment(root, facts);
  assert.equal(seg.pieces.length, 3);
  const [start, room, treasure] = seg.pieces;
  assert.deepEqual(start.connections.map(c => c.side + c.width), ["E3"]);
  assert.deepEqual(room.connections.map(c => c.side + c.width).sort(), ["N3", "W3"]);
  assert.deepEqual(treasure.connections.map(c => c.side + c.width), ["S3"]);
  // the tagged spawners went with the room that holds them
  assert.equal(room.entries.filter(e => /Subset Spawn/.test(e.placeable?.name)).length, 2);
  assert.equal(room.tagNumber, "2");
  // every walkable cell belongs to one piece
  assert.equal(start.walk.length + room.walk.length + treasure.walk.length, seg.walk.size);
});

test("pieces join opening to opening, every free opening closed by a dead end", () => {
  const root = floorRoot(ROWS, [["elevator_start_E_3w_01", 3, 4], ["room_general_NW_3w_01", 25, 5], ["room_treasure_S_3w_01", 25, 11]]);
  const lib = libraryPieces("1", root, facts);
  assert.deepEqual(lib.map(p => p.kind).sort(), ["dead", "room", "start"]);
  // an exit and another room, made from copies with their names changed
  const exit: LibPiece = { ...lib.find(p => p.kind === "dead")!, kind: "exit", label: "elevator_next_S_3w_01" };
  const corridor: LibPiece = { ...lib.find(p => p.kind === "room")!, label: "room_general_NW_3w_02" };
  const a = assemble([...lib, exit, corridor], 7, { before: 1, after: 0, attempts: 20 });
  assert.ok(a, "assembled");
  assert.equal(a!.placed[0].piece.kind, "start");
  assert.equal(a!.placed[a!.path[a!.path.length - 1]].piece.kind, "exit");
  // no two pieces share a cell
  const seen = new Set<string>();
  for (const p of a!.placed) for (const k of p.piece.cells) {
    const [x, y] = k.split(",").map(Number), kk = (x + p.dx) + "," + (y + p.dy);
    assert.ok(!seen.has(kk), "overlap at " + kk);
    seen.add(kk);
  }
  const out = assembledRoot(a!, [], "test");
  assert.equal(out.prefabs.length, a!.placed.length);
});

test("archived scene names sort into styles, themes and statuses", () => {
  assert.deepEqual(classifyLevel("ct beast"), { style: "tunnels", family: "Beast", element: null });
  assert.deepEqual(classifyLevel("bf slime"), { style: "tunnels", family: "Slime", element: "Fire" });
  assert.deepEqual(classifyLevel("wolver den freeze"), { style: "den", family: null, element: "Freeze" });
  assert.equal(classifyLevel("rc undead minis")?.style, "compound");
  assert.equal(classifyLevel("jigsaw valley emerald axis 2")?.style, "valley");
  assert.equal(classifyLevel("wolver den fire terminal meltdown"), null);
  assert.deepEqual(classifyCapture("ww fiend silent legion"), { style: "tunnels", family: "Fiend", element: "Poison" });
  assert.equal(classifyCapture("ck freeze owlite tome")?.style, "keep");
  const a = new LevelArchive([{ id: "27", name: "royal jelly lair" }, { id: "255", name: "royal jelly lair" }, { id: "1073741864", name: "ct beast" },
    { id: "1073741869", name: "ct beast" }, { id: "1073741876", name: "bf slime fuel depot" }, { id: "47", name: "terminal 1" }]);
  assert.equal(a.level("m.royal_jelly_lair")?.id, "255");
  assert.equal(a.forStratum("tunnels", "Beast").length, 2);
  assert.equal(a.forStratum("tunnels", "Fire").length, 0);
  assert.equal(a.prefabSources("tunnels", "Fire").length, 1);
  assert.equal(a.level("m.terminal_1")?.id, "47");
});

test("a boss stratum's floors are its stages, the boss's lair last", () => {
  for (let seed = 1; seed < 200; seed++) {
    const g = makeGate(seed);
    for (const s of g.strata) {
      if (!s.boss) continue;
      const floors = gateFloors(g).filter(f => f.stratum === s && f.levelKey);
      const stages = BOSSES[s.boss].stages;
      assert.equal(floors[floors.length - 1].levelKey, stages[stages.length - 1]);
      assert.equal(floors[floors.length - 1].kind, "boss");
      assert.deepEqual(floors.map(f => f.levelKey), stages.slice(stages.length - floors.length));
    }
  }
});
