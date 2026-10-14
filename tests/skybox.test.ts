import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigLibrary } from "../src/config/materials.ts";

const T = "com.threerings.opengl.material.config.";

test("a grouped enqueuer's passes draw in its queue, ordered by their own queue inside it", async () => {
  // the shape of config/material.dat's "Model/Skybox/..." materials
  const grouped = {
    name: "Sky/Translucent", $class: T + "MaterialConfig",
    implementation: { $class: T + "MaterialConfig$Original", techniques: [{ $class: T + "TechniqueConfig", enqueuer: {
      $class: T + "TechniqueConfig$GroupedEnqueuer", queue: "Skybox",
      enqueuers: [{ $class: T + "TechniqueConfig$NormalEnqueuer", queue: "Transparent", passes: [{ depthState: { mask: false } }] }],
    } }] },
  };
  const lib = await new ConfigLibrary().load(async p => (p === "config/material.dat" ? [grouped] : []));
  const m = lib.resolve({ name: "Sky/Translucent" }, null);
  assert.equal(m.queue, "Skybox");
  assert.equal(m.subQueue, "Transparent");
  assert.equal(m.passes.length, 1);
  assert.equal(m.passes[0].depthMask, false);
});
