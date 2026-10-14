import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CollisionMap } from "../src/game/collision.ts";
import { compose } from "../src/math.ts";

// PlaceableConfig floorTile (the start platform): TudeySceneModel.getFloorZ falls back to the
// floor placeables' elevations where no tile lies, so the platform over its shaft is floor
test("a floor-tile placeable is walkable floor where no tile is, and keeps tiles' own", () => {
  const c = new CollisionMap();
  c.cells.set(CollisionMap.key(2, 0), { flags: 0, floor: true, z: -1 });
  // a 3x3 rectangle centred on (1.5, 1.5): cells 0..2 x 0..2
  c.addFloorPlaceable({ k: "poly", pts: [[0, 0], [3, 0], [3, 3], [0, 3]] }, 0.25);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) assert.equal(c.cell(x, y)?.floor, true, `${x},${y}`);
  assert.equal(c.cell(3, 1), undefined);
  assert.equal(c.cell(1, 1)!.z, 0.25);
  assert.equal(c.cell(2, 0)!.z, -1);
  assert.equal(c.collides(1.5, 1.5, 1 / 3, 43), false);
  assert.equal(c.collides(3.5, 1.5, 1 / 3, 43), true);
});

test("a moving floor carries its height, and is a lift only while off its rest pose", () => {
  const c = new CollisionMap();
  const lift = { node: "collision", dz: 0 };
  c.addFloor([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], compose([0, 0, 0.13], [0, 0, 0, 1], 1), 1, lift);
  assert.ok(Math.abs(c.groundZ(0.5, 0.5) - 0.13) < 1e-6);
  assert.equal(c.liftAt(0.5, 0.5), null);
  lift.dz = 3.27;
  assert.ok(Math.abs(c.groundZ(0.5, 0.5) - 3.4) < 1e-5);
  assert.equal(c.liftAt(0.5, 0.5), lift);
  assert.equal(c.liftAt(5, 5), null);
});

// The start platform (Dynamic/Elevator/Start Platform: a Prop, floorTile, collisionFlags 0,
// 3x3 rectangle) sits over its shaft with no tiles under it; its model's Arrive plays once
// (startAutomatically) and brings its "collision" node, with the grate, down from 3.27 to rest
const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
for (const [id, name] of [["348", "arcade lobby"], ["330", "terminal 1"], ["328", "terminal core"]]) {
  test(`${name}'s start platform is walkable and the knight spawns on its grate (when the install is present)`, async () => {
    const file = join(SK, "scenes", id);
    if (!existsSync(file) || !existsSync(join(SK, "rsrc", "config", "placeable.dat"))) return;
    const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
    const { SceneLoader } = await import("../src/scene.ts");
    const { loadAnimation } = await import("../src/model.ts");
    const loader = nodeLoader();
    const scene = await new SceneLoader(loader).load(id, new Uint8Array(readFileSync(file)));
    assert.ok(scene.start, "the scene has a start platform");
    const [sx, sy] = scene.start!;
    const c = scene.collision;
    // the whole grate is floor: the knight stands on it and walks across it
    for (const [dx, dy] of [[0, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]]) assert.equal(c.collides(sx + dx, sy + dy, 1 / 3, 43), false, `${dx},${dy}`);
    // the knight spawns in the middle of the platform, on the grate
    const spawn = c.findSpawn(sx, sy, 1 / 3, 43)!;
    assert.deepEqual(spawn, [sx, sy]);
    const platform = scene.objects.find(o => /model_start\.dat$/.test(o.model.path) && Math.hypot(o.matrix[12] - sx, o.matrix[13] - sy) < 0.01);
    assert.ok(platform?.lift, "the platform's floor moves with its collision node");
    const rest = c.groundZ(spawn[0], spawn[1]);
    assert.ok(Math.abs(rest - (platform!.matrix[14] + 0.125)) < 0.02, `the grate's height: ${rest} over ${platform!.matrix[14]}`);
    // as Arrive begins the grate (and the knight on it) is 3.27 up; at its end it is at rest
    const clip = (await loadAnimation(loader, platform!.model.autoAnimations[0]))!;
    assert.equal(clip.loop, false);
    const at = (f: number) => clip.frames[f][clip.targets.indexOf("collision")].t[2];
    assert.ok(Math.abs(at(0) - 3.27) < 0.01, `starts ${at(0)} up`);
    assert.ok(Math.abs(at(clip.frames.length - 1)) < 1e-6);
    platform!.lift!.dz = at(0);
    assert.ok(Math.abs(c.groundZ(spawn[0], spawn[1]) - (rest + at(0))) < 1e-4);
    assert.ok(c.liftAt(spawn[0], spawn[1]));
    platform!.lift!.dz = 0;
  });
}
