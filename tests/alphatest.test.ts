import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ModelLoader } from "../src/model.ts";
import { alphaTestPasses, FRAGMENT_SHADER } from "../src/render/renderer.ts";
import type { Vfs } from "../src/vfs.ts";

test("the alpha test compares at 8-bit precision, as GL's glAlphaFunc does", () => {
  // "Masked Hard" (EQUAL 1): an interpolated alpha a rounding error off 1 is still 1
  assert.equal(alphaTestPasses("EQUAL", 1, 1), true);
  assert.equal(alphaTestPasses("EQUAL", 0.99999994, 1), true);
  assert.equal(alphaTestPasses("EQUAL", 1.0000001, 1), true);
  // ...but a texel at a mask's edge (filtered part way to transparent) is not
  assert.equal(alphaTestPasses("EQUAL", 0.99, 1), false);
  assert.equal(alphaTestPasses("EQUAL", 0.5, 1), false);
  // "Masked (Soft)" (GEQUAL 0.6) keeps its threshold
  assert.equal(alphaTestPasses("GEQUAL", 0.6, 0.6000000238418579), true);
  assert.equal(alphaTestPasses("GEQUAL", 0.59, 0.6000000238418579), false);
  assert.equal(alphaTestPasses("ALWAYS", 0, 0), true);
  assert.equal(alphaTestPasses("NEVER", 1, 0), false);
  // the fragment shader runs the same rule
  assert.match(FRAGMENT_SHADER, /floor\(clamp\(a, 0\.0, 1\.0\) \* 255\.0 \+ 0\.5\)/);
  assert.match(FRAGMENT_SHADER, /floor\(clamp\(u_alphaRef, 0\.0, 1\.0\) \* 255\.0 \+ 0\.5\)/);
  assert.doesNotMatch(FRAGMENT_SHADER, /a == u_alphaRef/);
});

const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
const RSRC = join(SK, "rsrc");
const FOOD = "world/dynamic/energy/model_sprite-alchemy.dat";

test("Haven's sprite food machine draws with the EQUAL 1 alpha test its body needs to pass (when the install is present)", async () => {
  if (!existsSync(join(RSRC, FOOD))) return;
  const vfs = {
    label: "test", list: async () => [], read: async (p: string) => new Uint8Array(readFileSync(join(RSRC, p))),
    blob: async (p: string) => new Blob([readFileSync(join(RSRC, p))]), scenes: async () => [], readScene: async () => new Uint8Array(),
    colorDefs: async () => null, messageBundles: async () => [], messageBundle: async () => null,
  } as unknown as Vfs;
  const model = await new ModelLoader(vfs).load(FOOD, { name: FOOD });
  const body = model.parts[0];
  assert.equal(body.material.name, "Model/Sphere Overlay/Additive Mask");
  const [base, sheen] = body.material.passes;
  assert.equal(base.alphaFunc, "EQUAL");
  assert.equal(base.alphaRef, 1);
  // opaque texels with white vertex colours (alpha exactly 1 per vertex) are drawn wherever the
  // interpolation lands
  for (const a of [1, 0.99999994, 1 - 1e-6]) assert.equal(alphaTestPasses(base.alphaFunc, a, base.alphaRef), true);
  // the sheen pass adds over the same faces without a test of its own
  assert.equal(sheen.alphaFunc, "ALWAYS");
  assert.equal(sheen.destBlend, "ONE");
});
