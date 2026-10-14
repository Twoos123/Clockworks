import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { applyArguments, setPath } from "../src/config/params.ts";
import { floatExpr, transformExpr } from "../src/expr.ts";
import { parseProperties } from "../src/i18n.ts";
import { JarReader } from "../src/java/jar.ts";
import { billboardPart, loadAnimation, paintBillboards, type ComponentBillboardDef, type LoadedModel } from "../src/model.ts";
import { nodeLoader } from "../tools/audit/nodevfs.ts";
import { skDir } from "../tools/common.ts";

const HAVE_INSTALL = existsSync(join(skDir(), "rsrc", "ui", "prolgue", "interface.dat"));
const PANELS = "ui/prolgue/parts/panels/";
const BUBBLES: Record<string, string> = {
  "model_003.dat": "m.helmsman_arrive", "model_004.dat": "m.ozlo_arrive",
  "model_006.dat": "m.helmsman_warning", "model_008.dat": "m.ozlo_evac",
};

test("an argument written through a defaulted expression field is that field's Constant", () => {
  // model_comicpanel.dat's "Panel Offset" sets transforms[3].expression.value of a target
  // transform the export left without an expression (Clyde's default: a Constant)
  const procedural: any = { transforms: [{ targets: ["pivot_root"] }] };
  const q = { x: 0, y: Math.sin(0.25), z: 0, w: Math.cos(0.25) };
  assert.ok(setPath(procedural, "transforms[0].expression.value", { translation: { x: -0.5, y: -0.4, z: 0.2 }, rotation: q }));
  const m = transformExpr(procedural.transforms[0].expression)!(0);
  assert.ok(m, "the offset compiles");
  assert.deepEqual([m[12], m[13], m[14]].map(v => +v.toFixed(3)), [-0.5, -0.4, 0.2]);
  // a turn about y: the x axis leans into z (the panels' slant)
  assert.ok(Math.abs(m[2]) > 0.4, "rotated");
  // "Tail Rotation" and "Tail Scale": an Angles quaternion's z and a Uniform's scale
  assert.equal(floatExpr({ value: -0.4 })(0), -0.4);
  assert.equal(floatExpr({ value: 2.02 }, 1)(0), 2.02);
});

test("a component billboard is a quad of its size in pixels times its scale, premultiplied and unlit", () => {
  const p = billboardPart("%component/1", 800, 300, 0.01, 2);
  assert.deepEqual(Array.from(p.vertex.data), [-4, -1.5, 0, 4, -1.5, 0, 4, 1.5, 0, -4, 1.5, 0]);
  assert.equal(p.material.queue, "Transparent");
  assert.equal(p.material.priority, 2);
  const pass = p.material.passes[0];
  assert.equal(pass.srcBlend, "ONE");
  assert.equal(pass.destBlend, "ONE_MINUS_SRC_ALPHA");
  assert.equal(pass.depthMask, false);
  assert.equal(pass.lit, false);
  assert.equal(pass.units[0].texture, "%component/1");
  assert.deepEqual(Array.from(p.indices!), [0, 1, 2, 0, 2, 3]);
});

/** The comic panel model a panel file derives from, loaded with a painter that records what it draws. */
async function panel(file: string, args: [string, unknown][] = []) {
  const loader = nodeLoader();
  const painted: ComponentBillboardDef[] = [];
  const ref = { $class: "com.threerings.config.ConfigReference", name: PANELS + file,
    arguments: { $map: "com.threerings.config.ArgumentMap", entries: args } };
  const model = await loader.load(ref.name, args.length ? ref : undefined);
  // unpainted, the balloon draws nothing (as the world leaves such models)
  assert.equal(balloonOf(model)?.parts.length ?? 0, 0);
  await paintBillboards(model, async def => { painted.push(def); return { texture: `%component/${painted.length}`, width: 800, height: 300 }; });
  return { loader, model, painted };
}

const balloonOf = (m: LoadedModel) => m.attachments.find(a => a.node === "pivot_balloon-scale")?.model ?? null;

test("each speaking panel's word balloon is a billboarded label of its prologue line, popping up after its delay",
  { skip: !HAVE_INSTALL && "no install" }, async () => {
  for (const [file, key] of Object.entries(BUBBLES)) {
    const { loader, model, painted } = await panel(file);
    // the balloon: part_interface_balloon.dat's label, in its own Balloon style, translated
    // in the prologue bundle
    const balloon = balloonOf(model);
    assert.ok(balloon, `${file} has its balloon`);
    assert.equal(balloon!.parts[0]?.material.name, "ComponentBillboard", file);
    assert.equal(painted.length, 1);
    assert.equal(painted[0].bundle, "prologue");
    const label = painted[0].root.layout.children[0].component;
    assert.equal(label.text, key);
    assert.equal(label.style.name, "Balloon");
    assert.ok(painted[0].styles.get("Balloon"), "the model's own Balloon style");
    // the "balloon" mapping starts by itself: a delay, then the pop to full size
    const ref = model.autoRefs?.find(r => r.name === "animation/sequential/simple.dat");
    assert.ok(ref, `${file} starts its balloon`);
    const clip = (await loadAnimation(loader, ref))!;
    const at = (s: number) => {
      const f = Math.min(clip.frames.length - 1, Math.round(s * clip.rate));
      return clip.frames[f][clip.targets.indexOf("pivot_balloon-scale")].s;
    };
    const duration = (clip.frames.length - 1) / clip.rate;
    assert.ok(duration > 0.3 && duration < 0.8, `${file}: balloon up after ${duration.toFixed(2)} s`);
    assert.ok(at(0) < 0.01, "hidden at first");
    assert.ok(Math.abs(at(duration) - 1) < 1e-6, "full size at the end");
  }
});

test("a panel without speech (or one shown again with Word Balloon off) starts no balloon",
  { skip: !HAVE_INSTALL && "no install" }, async () => {
  const quiet = await panel("model_001.dat");
  assert.ok(!quiet.model.autoRefs?.some(r => r.name === "animation/sequential/simple.dat"));
  const again = await panel("model_003.dat", [["Word Balloon", false]]);
  assert.ok(!again.model.autoRefs?.some(r => r.name === "animation/sequential/simple.dat"));
});

test("the panels lean at their Panel Offset, not flat to the view", { skip: !HAVE_INSTALL && "no install" }, async () => {
  // (model_001, 007, 008 and 015 face the view square in the data too)
  for (const file of ["model_002.dat", "model_003.dat", "model_004.dat", "model_006.dat", "model_012.dat"]) {
    const { model } = await panel(file);
    const root = model.procedurals.find(p => p.targets.includes("pivot_root"));
    assert.ok(root, `${file} places pivot_root`);
    const m = root!.transform(0);
    // not the identity: turned out of the view plane
    assert.ok(Math.abs(m[2]) > 0.05 || Math.abs(m[8]) > 0.05, `${file} is tilted`);
  }
});

test("the balloons' lines are in the install's prologue bundle", { skip: !HAVE_INSTALL && "no install" }, async () => {
  const jar = await JarReader.open(new Blob([readFileSync(join(skDir(), "code", "projectx-config.jar"))]));
  const bytes = await jar.read("rsrc/i18n/prologue.properties");
  assert.ok(bytes, "prologue.properties");
  const props = parseProperties(new TextDecoder().decode(bytes!));
  for (const key of [...Object.values(BUBBLES), "m.preface1", "m.preface2", "m.preface3"]) assert.ok(props.get(key), key);
  // and the panel files name exactly those
  const loader = nodeLoader();
  for (const [file, key] of Object.entries(BUBBLES)) {
    const cfg: any = await loader.importFile(PANELS + file);
    const args = applyArguments(cfg, null).implementation.model.arguments.entries as [string, unknown][];
    assert.equal(args.find(([k]) => k === "Text")?.[1], key, file);
  }
});
