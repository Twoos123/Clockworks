import assert from "node:assert/strict";
import { test } from "node:test";
import { arrivalPoint, exitTarget, placeKey } from "../src/game/portals.ts";
import type { LogicEntry } from "../src/scene.ts";

const scenes = [{ id: "1", name: "haven town square" }, { id: "2", name: "haven bazaar" }, { id: "23389", name: "hall (The Exceeds)" }];
const entry = (name: string, x: number, y: number, rotation: number, tags: string[]): LogicEntry =>
  ({ id: 0, name, x, y, rotation, shape: null, tags, handlers: [] });

test("a scene move to a cached scene walks there, to the exit's portal", () => {
  const t = exitTarget({ tags: ["to_bazaar_east"], sceneId: 2, portal: "from_town_square_west", area: "Portals/Portal" }, scenes);
  assert.deepEqual(t, { kind: "scene", id: "2", portal: "from_town_square_west" });
});

test("the Arcade (not cached) is the gate board; other uncached places are not available", () => {
  assert.deepEqual(exitTarget({ tags: ["to_arcade_central"], sceneId: 3, portal: "from_town_square_north" }, scenes), { kind: "arcade" });
  assert.deepEqual(exitTarget({ tags: ["to_garrison_west"], sceneId: 445, portal: "from_town_square_east" }, scenes),
    { kind: "missing", place: "%town:m.border_eastside" });
  // the guild hall's way out names a town and scene instead of a scene id
  assert.deepEqual(exitTarget({ tags: [], sceneId: NaN, portal: "from_your_guildhall", townName: "haven", sceneInternalId: "haven_eastside", area: "Portals/Town Portal" }, scenes),
    { kind: "missing", place: "%town:m.border_eastside" });
  // an exit whose action the data dropped altogether
  assert.equal(exitTarget({ tags: [], sceneId: NaN, portal: "", area: "Portals/To Advanced Training" }, scenes).kind, "missing");
  assert.equal(placeKey({ tags: [], sceneId: NaN, portal: "", area: "Portals/To Advanced Training" }), "%town:m.border_training_hall");
  assert.equal(placeKey({ tags: [], sceneId: NaN, portal: "", area: "Portals/To Guild Training" }), "%guild:m.border_training_hall");
});

test("an archived scene not yet named is still walked into; an archived Arcade replaces the board", () => {
  const ids = new Set(["3", "445"]);
  assert.deepEqual(exitTarget({ tags: ["to_garrison_west"], sceneId: 445, portal: "from_town_square_east" }, scenes, ids),
    { kind: "scene", id: "445", portal: "from_town_square_east" });
  assert.deepEqual(exitTarget({ tags: ["to_arcade_central"], sceneId: 3, portal: "from_town_square_north" }, scenes, ids),
    { kind: "scene", id: "3", portal: "from_town_square_north" });
});

test("a town move to a cached scene finds it by its internal name", () => {
  assert.deepEqual(exitTarget({ tags: [], sceneId: NaN, portal: "p", townName: "haven", sceneInternalId: "haven_bazaar" }, scenes), { kind: "scene", id: "2", portal: "p" });
});

test("the knight arrives at the destination with the portal's tag, else the default entrance", () => {
  const logic = [
    entry("Dynamic/Portal/Level Start", 1, -30.5, Math.PI / 2, ["(Destination Tag)"]),
    entry("Dynamic/Portal/Destination", -30.5, 0.5, 0, ["from_bazaar_east"]),
    entry("Portals/Portal", -38, 0.5, 0, ["to_bazaar_east"]),
  ];
  assert.deepEqual(arrivalPoint(logic, "from_bazaar_east"), { x: -30.5, y: 0.5, heading: 0 });
  assert.deepEqual(arrivalPoint(logic, "nowhere"), { x: 1, y: -30.5, heading: Math.PI / 2 });
  assert.deepEqual(arrivalPoint(logic, ""), { x: 1, y: -30.5, heading: Math.PI / 2 });
  assert.equal(arrivalPoint([], "x"), null);
});
