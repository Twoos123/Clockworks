import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { editorCase, ModelLoader, type LoadedModel, type MeshPart } from "../src/model.ts";
import { modelPass } from "../src/render/renderer.ts";
import type { Vfs } from "../src/vfs.ts";

const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
const RSRC = join(SK, "rsrc");
const installed = existsSync(join(RSRC, "world", "prop", "outershell", "sunbeam", "compound_model.dat"));

function loader(): ModelLoader {
  const vfs = {
    label: "test", list: async () => [], read: async (p: string) => new Uint8Array(readFileSync(join(RSRC, p))),
    blob: async (p: string) => new Blob([readFileSync(join(RSRC, p))]), scenes: async () => [], readScene: async () => new Uint8Array(),
    colorDefs: async () => null, messageBundles: async () => [], messageBundle: async () => null,
  } as unknown as Vfs;
  return new ModelLoader(vfs);
}

const parts = (m: LoadedModel, out: { part: MeshPart; model: LoadedModel }[] = []) => {
  for (const part of m.parts) out.push({ part, model: m });
  for (const a of m.attachments) parts(a.model, out);
  return out;
};

test("model/conditional/marker.dat's markersVisible case is editor-only", () => {
  const ref = (name: string) => ({ $class: "com.threerings.expr.BooleanExpression$Reference", name });
  assert.equal(editorCase(ref("markersVisible")), true);
  assert.equal(editorCase(ref("__server__xmas")), false);
  assert.equal(editorCase(null), false);
  assert.equal(editorCase({ $class: "com.threerings.expr.BooleanExpression$FloatLess" }), false);
});

test("the sunbeams draw only their additive, textured, non-depth-writing beam (when the install is present)", async () => {
  if (!installed) return;
  for (const variant of ["beam_small", "beam_tall"]) {
    const ref = { name: "world/prop/outershell/sunbeam/compound_model.dat",
      arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Model", variant]] } };
    const model = await loader().load(ref.name, ref);
    const all = parts(model);
    // no editor marker pole (sunbeam/markers.dat: untextured Model/Opaque, drawn solid yellow)
    assert.ok(!all.some(p => p.model.path.includes("markers.dat")), `${variant}: no marker mesh`);
    assert.equal(all.length, 1, `${variant}: the beam alone`);
    const { part, model: beam } = all[0];
    assert.equal(part.material.name, "Model/Scrolling/Additive");
    assert.equal(part.material.queue, "Transparent");
    assert.equal(part.material.passes.length, 1);
    const pass = part.material.passes[0];
    assert.equal(pass.srcBlend, "ONE");
    assert.equal(pass.destBlend, "ONE");
    assert.equal(pass.depthMask, false);
    assert.equal(pass.lit, false);
    assert.equal(modelPass(pass, beam.receivesLights !== false).lit, false);
    assert.equal(pass.units[0]?.texture, "world/prop/outershell/sunbeam/ambient_sunbeam.png");
    assert.equal(pass.units[0]?.rgbScale, 2);
    // the dim vertex colours (about 0.06 to 0.125) are what keep the beam subtle
    assert.ok(part.color && !pass.ignoreVertexColors, `${variant}: vertex colours`);
    const c = part.color!, stride = c.stride ? c.stride / 4 : c.size;
    for (let i = c.offset / 4; i + 3 < c.data.length; i += stride) assert.ok(c.data[i] <= 0.2, `${variant}: dim vertex colour`);
  }
});
