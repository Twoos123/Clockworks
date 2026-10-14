import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigLibrary } from "../src/config/materials.ts";
import { drawOrder } from "../src/render/renderer.ts";
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

test("interface views draw unlit (no lights, full ambient)", () => {
  assert.deepEqual(UNLIT_VIEW_ENVIRONMENT.lights, []);
  assert.deepEqual(UNLIT_VIEW_ENVIRONMENT.ambient, [1, 1, 1]);
  assert.equal(UNLIT_VIEW_ENVIRONMENT.fog, null);
});
