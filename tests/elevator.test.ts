import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CollisionMap } from "../src/game/collision.ts";
import { compose } from "../src/math.ts";

// a 3x3 grate one unit square per cell (two up-facing triangles), at z 0.125 over (0..3, 0..3)
const GRATE = [0, 0, 0.125, 3, 0, 0.125, 3, 3, 0.125, 0, 0, 0.125, 3, 3, 0.125, 0, 3, 0.125];

test("a floor-tile placeable's floor mesh makes the tile-less cells under it floor", () => {
  const c = new CollisionMap();
  // a wall tile and a floor tile already under the grate keep their own
  c.cells.set(CollisionMap.key(11, 10), { flags: 1, floor: false, z: 0 });
  c.cells.set(CollisionMap.key(12, 12), { flags: 0, floor: true, z: -1 });
  const m = compose([10, 10, 0], [0, 0, 0, 1], 1);
  c.addFloor(GRATE, m, 1);
  c.addFloorPlaceableMesh(GRATE, m, 0);
  assert.deepEqual(c.cell(10, 10), { flags: 0, floor: true, z: 0 });
  assert.equal(c.cell(11, 11)?.floor, true);
  assert.deepEqual(c.cell(11, 10), { flags: 1, floor: false, z: 0 });
  assert.equal(c.cell(12, 12)!.z, -1);
  assert.equal(c.cell(13, 11), undefined);
  // walkable, at the grate's height
  assert.equal(c.collides(11.5, 11.5, 1 / 3, 43), false);
  assert.ok(Math.abs(c.groundZ(11.5, 11.5) - 0.125) < 1e-6);
});

// The exit elevators (DungeonPlaceableConfig$ElevatorProp: Next Floor, the lobbies' and the
// terminals' Shadow Lair elevators) stand over a 3x3 shaft with no tiles; their placeable is a
// floorTile whose shape is only the shaft's walls, so the grate is floor from the model's mesh.
// The knight walks from the level's start onto the elevator's middle, stands on the grate, and
// the elevator actor (a 1.75 square around the placeable, the world's `touching`) is under him.
const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
for (const [id, name, elevators] of [
  ["348", "arcade lobby", ["Dynamic/Elevator/Next Floor"]],
  ["330", "terminal 1", ["Dynamic/Elevator/Next Floor", "Dynamic/Elevator/Shadow Lair"]],
  ["370", "an archived floor", ["Dynamic/Elevator/Next Floor"]],
] as const) {
  test(`${name}'s elevators are walked onto and stood on (when the install is present)`, async () => {
    const file = join(SK, "scenes", id);
    if (!existsSync(file) || !existsSync(join(SK, "rsrc", "config", "placeable.dat"))) return;
    const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
    const { SceneLoader } = await import("../src/scene.ts");
    const { propKind } = await import("../src/game/props.ts");
    const { intersects, shapeFromConfig } = await import("../src/game/shapes.ts");
    const loader = new SceneLoader(nodeLoader());
    const scene = await loader.load(id, new Uint8Array(readFileSync(file)));
    const c = scene.collision;
    const [sx, sy] = c.findSpawn(scene.start![0], scene.start![1], 1 / 3, 43)!;
    for (const name of elevators) {
      const entries = scene.logic.filter(l => l.name === name);
      assert.ok(entries.length, `${name} is in the scene`);
      for (const e of entries) {
        const at = `${name} at ${e.x},${e.y}`;
        // the whole grate is floor, and the middle stands clear of the shaft's walls
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert.equal(c.cell(Math.floor(e.x) + dx, Math.floor(e.y) + dy)?.floor, true, `${at}: ${dx},${dy}`);
        assert.equal(c.collides(e.x, e.y, 1 / 3, 43), false, at);
        // the grate's height, from its collision mesh
        const obj = scene.objects.find(o => /world\/dynamic\/elevator\//.test(o.model.path) && !/start/.test(o.model.path) && Math.hypot(o.matrix[12] - e.x, o.matrix[13] - e.y) < 0.01)!;
        assert.ok(obj, at);
        assert.ok(Math.abs(c.groundZ(e.x, e.y) - (obj.matrix[14] + 0.125)) < 0.02, `${at}: grate at ${c.groundZ(e.x, e.y)}`);
        // a path from the start onto its middle
        const path = c.findPath(sx, sy, e.x, e.y, 1 / 3, 43, 50000);
        assert.ok(path?.length, `${at}: a path from the start`);
        assert.deepEqual(path!.at(-1), [e.x, e.y]);
        // standing there the elevator's actor is underfoot (world.updateProps starts the ride)
        const actor = await (loader as any).resolveImpl("config/actor.dat", e.actor, "actor");
        assert.equal(propKind(actor), "elevator", at);
        const shape = shapeFromConfig(actor.shape, e.x, e.y, e.rotation + Math.PI / 2)!;
        assert.ok(intersects(shape, { k: "circle", x: e.x, y: e.y, r: 1 / 3 }), at);
        // and not from the room in front of it
        assert.ok(!intersects(shape, { k: "circle", x: e.x, y: e.y - 3, r: 1 / 3 }), at);
      }
    }
  });
}
