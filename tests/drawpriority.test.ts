import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigLibrary } from "../src/config/materials.ts";
import { DECAL_LIFT, DECAL_QUEUE, drawOrder, RENDER_QUEUES, sortsByDepth } from "../src/render/renderer.ts";
import { UNLIT_VIEW_ENVIRONMENT } from "../src/environment.ts";

const T = "com.threerings.opengl.material.config.";

// the shape of config/material.dat's "Model/Additive": a NormalEnqueuer whose priority is a
// parameter (the Cradle's glow decals pass "-1")
const additive = {
  name: "Model/Additive", $class: T + "MaterialConfig",
  parameters: [{ $class: "com.threerings.config.Parameter$Direct", name: "Priority", paths: ["implementation.techniques[0].enqueuer.priority"] }],
  implementation: { $class: T + "MaterialConfig$Original", techniques: [{ $class: T + "TechniqueConfig", enqueuer: {
    $class: T + "TechniqueConfig$NormalEnqueuer", queue: "Transparent", priority: 0,
    passes: [{ depthState: { mask: false } }],
  } }] },
};
const translucent = {
  name: "Model/Translucent", $class: T + "MaterialConfig",
  implementation: { $class: T + "MaterialConfig$Original", techniques: [{ $class: T + "TechniqueConfig", enqueuer: {
    $class: T + "TechniqueConfig$NormalEnqueuer", queue: "Transparent", passes: [{ depthState: { mask: false } }],
  } }] },
};

test("a material keeps its enqueuer's priority, also when an argument sets it", async () => {
  const lib = await new ConfigLibrary().load(async p => (p === "config/material.dat" ? [additive, translucent] : []));
  assert.equal(lib.resolve({ name: "Model/Translucent" }, null).priority, 0);
  assert.equal(lib.resolve({ name: "Model/Additive" }, null).priority, 0);
  const ref = { name: "Model/Additive", arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Priority", "-1"]] } };
  assert.equal(lib.resolve(ref, null).priority, -1);
});

test("meshes draw by queue, then by rising priority, else in collection order", () => {
  // the Cradle: the planet (Translucent, 0) is collected before its glow decals (Additive, -1)
  // and the galaxy (-1), which must still draw behind it; the opaque arm draws before all
  const planet = { name: "planet", queue: "Transparent", priority: 0 };
  const decal = { name: "decal", queue: "Transparent", priority: -1 };
  const galaxy = { name: "galaxy", queue: "Transparent", priority: -1 };
  const stars = { name: "stars", queue: "Transparent", priority: -5 };
  const arm = { name: "arm", queue: "Opaque", priority: 1 };
  const sorted = [planet, arm, stars, galaxy, decal].sort(drawOrder).map(m => m.name);
  assert.deepEqual(sorted, ["arm", "stars", "galaxy", "decal", "planet"]);
  // no priority counts as 0
  assert.deepEqual([{ name: "a", queue: "Transparent" }, decal].sort(drawOrder).map(m => m.name), ["decal", "a"]);
});

test("queues render in config/render_queue.dat's priority order", () => {
  // Skybox -100, Skybox (Fov Standard) -90, Blurred -75, Opaque 0, an unlisted queue (the
  // defaults: 0, created after Opaque), Transparent 100, Overlay 200
  const qs = ["Overlay", "Transparent", "Custom", "Opaque", "Blurred", "Skybox (Fov Standard)", "Skybox"];
  const sorted = qs.map(queue => ({ queue })).sort(drawOrder).map(m => m.queue);
  assert.deepEqual(sorted, ["Skybox", "Skybox (Fov Standard)", "Blurred", "Opaque", "Custom", "Transparent", "Overlay"]);
  assert.equal(RENDER_QUEUES.Opaque.sort, "BY_STATE");
  assert.equal(RENDER_QUEUES.Transparent.sort, "BACK_TO_FRONT");
  assert.equal(RENDER_QUEUES.Overlay.sort, "NONE");
});

test("a priority-1 floor decal in Opaque draws after the characters it lies under", () => {
  // Model/Decal/Emissive/Translucent: Opaque, priority 1, no depth writes; the characters are
  // Opaque at 0 and write depth first, so the decal's depth test hides it behind them
  const decal = { name: "decal", queue: "Opaque", priority: 1, depth: -2 };
  const knight = { name: "knight", queue: "Opaque", priority: 0, depth: -10 };
  const floor = { name: "floor", queue: "Opaque", priority: 0, depth: -12 };
  const glow = { name: "glow", queue: "Transparent", priority: 0, depth: -1 };
  assert.deepEqual([glow, decal, knight, floor].sort(drawOrder).map(m => m.name), ["knight", "floor", "decal", "glow"]);
});

// config/material.dat's projection material for the floor decals (the Haven emblem): a
// NormalEnqueuer with no queue (Opaque) at priority 1, depth tested, no depth writes
const decalMaterial = {
  name: "Model/Decal/Emissive/Translucent", $class: T + "MaterialConfig",
  implementation: { $class: T + "MaterialConfig$Original", techniques: [{ $class: T + "TechniqueConfig", enqueuer: {
    $class: T + "TechniqueConfig$NormalEnqueuer", priority: 1,
    passes: [{ depthState: { mask: false }, alphaState: { destBlendFactor: { name: "ONE_MINUS_SRC_ALPHA" } } }],
  } }] },
};

test("scene decals draw in their material's slot: after the characters on them, before Transparent", async () => {
  const lib = await new ConfigLibrary().load(async p => (p === "config/material.dat" ? [decalMaterial] : []));
  const m = lib.resolve({ name: "Model/Decal/Emissive/Translucent" }, null);
  assert.equal(m.queue, DECAL_QUEUE.queue);
  assert.equal(m.priority, DECAL_QUEUE.priority);
  assert.equal(m.passes[0].depthMask, false);
  assert.equal(m.passes[0].depthFunc, "LEQUAL");
  // the knight (and the floor) are Opaque at 0 and write depth first, so the decal's depth test
  // hides it wherever the knight stands; translucent things blend over the decal
  const knight = { name: "knight", queue: "Opaque", priority: 0 };
  const floor = { name: "floor", queue: "Opaque", priority: 0 };
  const grass = { name: "grass", queue: "Opaque", priority: 1 };
  const decal = { name: "decal", ...DECAL_QUEUE };
  const beam = { name: "beam", queue: "Transparent", priority: 0, depth: -30 };
  const visor = { name: "visor", queue: "Transparent", priority: -1, depth: -5 };
  // (drawItems adds the decal batch after the meshes, so it follows the other priority-1 ones)
  assert.deepEqual([visor, beam, knight, grass, floor, decal].sort(drawOrder).map(o => o.name),
    ["knight", "floor", "grass", "decal", "visor", "beam"]);
  // the quad floats a fixed world height over its origin, not the placement's scaled one
  assert.ok(DECAL_LIFT > 0 && DECAL_LIFT <= 0.12);
});

test("Transparent sorts back to front inside each priority; Opaque and Overlay keep their order", () => {
  // view-space z: more negative is farther
  const far = { name: "far", queue: "Transparent", depth: -20 };
  const mid = { name: "mid", queue: "Transparent", depth: -10 };
  const near = { name: "near", queue: "Transparent", depth: -2 };
  const lowNear = { name: "lowNear", queue: "Transparent", priority: -1, depth: -1 };
  assert.deepEqual([near, far, lowNear, mid].sort(drawOrder).map(m => m.name), ["lowNear", "far", "mid", "near"]);
  const a = { name: "a", queue: "Opaque", depth: -1 }, b = { name: "b", queue: "Opaque", depth: -9 };
  assert.deepEqual([a, b].sort(drawOrder).map(m => m.name), ["a", "b"]);
  const o1 = { name: "o1", queue: "Overlay", depth: -1 }, o2 = { name: "o2", queue: "Overlay", depth: -9 };
  assert.deepEqual([o1, o2].sort(drawOrder).map(m => m.name), ["o1", "o2"]);
  assert.equal(sortsByDepth({ queue: "Transparent" }), true);
  assert.equal(sortsByDepth({ queue: "Opaque" }), false);
  // a skybox group's Transparent queue sorts by depth inside the group, after its Opaque one
  assert.equal(sortsByDepth({ queue: "Skybox", subQueue: "Transparent" }), true);
  const skyT = { name: "skyT", queue: "Skybox", subQueue: "Transparent", depth: -50 };
  const skyO = { name: "skyO", queue: "Skybox", subQueue: "Opaque", depth: -1 };
  assert.deepEqual([skyT, skyO].sort(drawOrder).map(m => m.name), ["skyO", "skyT"]);
});

test("interface views draw unlit (no lights, full ambient)", () => {
  assert.deepEqual(UNLIT_VIEW_ENVIRONMENT.lights, []);
  assert.deepEqual(UNLIT_VIEW_ENVIRONMENT.ambient, [1, 1, 1]);
  assert.equal(UNLIT_VIEW_ENVIRONMENT.fog, null);
});
