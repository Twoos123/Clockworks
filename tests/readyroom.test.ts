import assert from "node:assert/strict";
import { test } from "node:test";
import { placeCamera, READY_ROOM_POSE } from "../src/game/places.ts";

const cameraEntry = (name: string, camera: any) => ({
  $class: "com.threerings.tudey.data.TudeySceneModel$PlaceableEntry",
  placeable: { name, arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Camera", camera], ["Transition", 0]] } },
});

test("the Ready Room's camera is its Camera/Default placeable's CameraConfig", () => {
  const root = {
    entries: [
      { $class: "com.threerings.tudey.data.TudeySceneModel$GlobalEntry", sceneGlobal: { name: "Environment/Fog" } },
      cameraEntry("Camera/Default", {
        fov: 0.5235987901687622, near: 0.01, priority: 1,
        coords: { azimuth: -2.094395160675049, elevation: 0.19198621809482574, distance: 4.929999828338623 },
        offset: { x: 0, y: -0.6669999957084656, z: 1 },
      }),
    ],
  };
  const v = placeCamera(root);
  assert.ok(v);
  assert.equal(v.fov, 0.5235987901687622);
  assert.equal(v.azimuth, -2.094395160675049);
  assert.equal(v.elevation, 0.19198621809482574);
  assert.equal(v.distance, 4.929999828338623);
  assert.deepEqual(v.offset, [0, -0.6669999957084656, 1]);
});

test("scenes without a camera placeable have none", () => {
  assert.equal(placeCamera({ entries: [cameraEntry("Camera/Other", {})] }), null);
  assert.equal(placeCamera(null), null);
});

test("the Ready Room's knight faces -y in the inventory pose (client activity 3)", () => {
  assert.equal(READY_ROOM_POSE.heading, -Math.PI / 2);
  assert.match(READY_ROOM_POSE.start, /use_inventory_start\.dat$/);
  assert.match(READY_ROOM_POSE.loop, /use_inventory_loop\.dat$/);
});
