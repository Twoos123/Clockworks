import assert from "node:assert/strict";
import { test } from "node:test";
import { discAlpha, Exploration, LevelMap, MAP_MASK } from "../src/game/levelmap.ts";

/** A room: floor inside, a one-cell wall ring, and a walled-off floor cell beyond. */
function room(): LevelMap {
  const m = new LevelMap();
  for (let y = 0; y <= 6; y++) for (let x = 0; x <= 6; x++) {
    const wall = x === 0 || y === 0 || x === 6 || y === 6;
    m.tile(x, y, wall ? 1 : 0);
  }
  m.tile(10, 3, 0);
  return m;
}

test("tile cells keep the highest masked flags; flags outside the map mask read as floor", () => {
  const m = new LevelMap();
  m.tile(0, 0, 64); // monster barrier only
  m.tile(1, 0, 2);
  m.tile(1, 0, 1);
  assert.equal(m.get(0, 0), 0);
  assert.equal(m.get(1, 0), 2);
  assert.equal(MAP_MASK, 39);
  assert.equal(m.get(5, 5), undefined);
});

test("the flood reaches floor through four sides from the entrances, not past walls", () => {
  const m = room();
  m.entrance(3.4, 3.9);
  m.flood();
  assert.equal(m.reached.size, 25);
  const cells = [...m.cells()];
  assert.ok(cells.some(([x, y, , r]) => x === 3 && y === 3 && r));
  assert.ok(cells.some(([x, y, v, r]) => x === 10 && y === 3 && v === 0 && !r), "the walled-off cell is floor but not reached");
  assert.ok(cells.some(([x, y, v, r]) => x === 0 && y === 0 && v === 1 && !r));
});

test("a placeable marks the cells its shape covers (more than four of nine thirds)", () => {
  const m = new LevelMap();
  // a 2 x 1 box from (0.1, 0) to (2.1, 1): covers cells 0 and 1, only a third of cell 2
  m.entry({ k: "poly", pts: [[0.1, 0], [2.1, 0], [2.1, 1], [0.1, 1]] }, 1);
  assert.equal(m.get(0, 0), 1);
  assert.equal(m.get(1, 0), 1);
  assert.equal(m.get(2, 0), undefined);
  // no masked flags and not a floor tile: nothing
  m.entry({ k: "circle", x: 5.5, y: 5.5, r: 1 }, 64);
  assert.equal(m.get(5, 5), undefined);
  // a floor tile placeable marks floor
  m.entry({ k: "circle", x: 5.5, y: 5.5, r: 1 }, 0, true);
  assert.equal(m.get(5, 5), 0);
});

test("the exploration disc is solid to 20 cells and gone past 32", () => {
  assert.equal(discAlpha(0), 1);
  assert.equal(discAlpha(400), 1);
  assert.ok(Math.abs(discAlpha(712) - 0.5) < 1e-9);
  assert.equal(discAlpha(1024), 0);
  assert.equal(discAlpha(1025), 0);
  const e = new Exploration(0, 0, 99, 0);
  assert.ok(e.stamp(0, 0));
  assert.equal(e.at(20, 0), 1);
  assert.ok(e.at(26, 0) > 0 && e.at(26, 0) < 1);
  assert.equal(e.at(40, 0), 0);
  assert.equal(e.stamp(0, 0), false, "a second stamp changes nothing");
});

test("the full map shows the disc around every reached cell", () => {
  const m = room();
  m.entrance(3, 3);
  m.flood();
  const e = Exploration.around(m)!;
  assert.equal(e.at(3, 3), 1);
  assert.equal(e.at(0, 0), 1);
  assert.equal(e.at(10, 3), 1, "five cells from the room");
});
