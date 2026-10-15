// Load-time caches and sharing: applyArguments' shared parts, ModelLoader.prefetch, and the
// server's level index (server/install.ts sceneIndex).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyArguments, cloneGraph } from "../src/config/params.ts";
import { componentRefs, ModelLoader } from "../src/model.ts";
import { sceneIndex, syncArchive } from "../server/install.ts";
import type { Vfs } from "../src/vfs.ts";

const REF = "com.threerings.config.ConfigReference";
const MESH_SET = "com.threerings.opengl.model.config.ModelConfig$MeshSet";
const direct = (name: string, ...paths: string[]) => ({ $class: "com.threerings.config.Parameter$Direct", name, paths });
const ref = (args: [string, unknown][]) => ({ $class: REF, name: "m", arguments: { entries: args } });
const meshSet = (tex: string) => ({ $class: MESH_SET, bounds: { min: 0 }, visible: [{ texture: tex, geometry: { vertexArray: new Float32Array(3) } }],
  collision: { root: { left: { triangle: { v1: { x: 1 } } } } } });

/** applyArguments as it was: a full copy of the config with the arguments written into it. */
function fullClone(config: any, r: any) {
  const c = cloneGraph(config);
  for (const [k, v] of r.arguments.entries) {
    for (const p of c.parameters) if (p.name === k) for (const path of p.paths) {
      const parts = path.split(".");
      let o = c;
      for (const s of parts.slice(0, -1)) o = s.endsWith("]") ? o[s.slice(0, s.indexOf("["))][Number(s.slice(s.indexOf("[") + 1, -1))] : o[s];
      o[parts[parts.length - 1]] = v;
    }
  }
  return c;
}

test("applyArguments shares the mesh sets and parameters no argument can change", () => {
  const a = meshSet("a.png"), b = meshSet("b.png");
  const config: any = {
    $class: "com.threerings.opengl.model.config.ModelConfig",
    parameters: [direct("Model", "implementation.model")],
    implementation: { $class: "StaticSetConfig", model: "a", meshes: { $map: "x", entries: [["a", a], ["b", b]] } },
  };
  const out = applyArguments(config, ref([["Model", "b"]]));
  assert.notEqual(out, config);
  assert.notEqual(out.implementation, config.implementation);
  assert.equal(out.implementation.model, "b");
  assert.equal(config.implementation.model, "a", "original untouched");
  assert.equal(out.implementation.meshes.entries[0][1], a, "mesh set shared");
  assert.equal(out.implementation.meshes.entries[1][1], b);
  assert.equal(out.parameters, config.parameters, "parameter list shared");
  assert.deepEqual(out, fullClone(config, ref([["Model", "b"]])));
  // the same config again (worked out once): the same result
  assert.deepEqual(applyArguments(config, ref([["Model", "a"]])).implementation.model, "a");
});

test("applyArguments copies a mesh set a parameter path writes into or reaches", () => {
  const a = meshSet("a.png");
  const config: any = {
    parameters: [direct("Texture", "implementation.meshes.visible[0].texture")],
    implementation: { meshes: a },
  };
  const out = applyArguments(config, ref([["Texture", "c.png"]]));
  assert.notEqual(out.implementation.meshes, a);
  assert.equal(out.implementation.meshes.visible[0].texture, "c.png");
  assert.equal(a.visible[0].texture, "a.png", "original untouched");
  assert.equal(out.implementation.meshes.visible[0].geometry.vertexArray, a.visible[0].geometry.vertexArray, "typed arrays shared");

  // a mesh set that holds an object an argument changes is copied with it, so it sees the change
  const shared = { color: "red" };
  const m = { ...meshSet("a.png"), tint: shared };
  const aliased: any = { parameters: [direct("Color", "implementation.tint.color")], implementation: { tint: shared, meshes: m } };
  const o2 = applyArguments(aliased, ref([["Color", "blue"]]));
  assert.notEqual(o2.implementation.meshes, m);
  assert.equal(o2.implementation.meshes.tint, o2.implementation.tint);
  assert.equal(o2.implementation.meshes.tint.color, "blue");
  assert.equal(shared.color, "red");
});

test("applyArguments copies a parameter list an option value is shared from", () => {
  const value = { $class: "Color", r: 1 };
  const config: any = {
    parameters: [direct("Tint", "implementation.tint"), { $class: "com.threerings.config.Parameter$Direct", name: "Spare", paths: [], value }],
    implementation: { tint: value },
  };
  const out = applyArguments(config, ref([["Tint", { r: 2 }]]));
  assert.notEqual(out.parameters, config.parameters, "the list reaches an object on a path: copied");
  assert.deepEqual(out.implementation.tint, { r: 2 });
});

/** A Vfs whose reads take a while, counting how many run at once. */
function slowVfs(delay = 5) {
  const reads: string[] = [];
  let inFlight = 0, most = 0;
  const vfs = {
    label: "test", list: async () => [], blob: async () => new Blob([]), scenes: async () => [], readScene: async () => new Uint8Array(),
    colorDefs: async () => null, messageBundles: async () => [], messageBundle: async () => null,
    read: async (p: string) => {
      reads.push(p);
      most = Math.max(most, ++inFlight);
      await new Promise(r => setTimeout(r, delay));
      inFlight--;
      return new Uint8Array([1, 2, 3]);
    },
  } satisfies Vfs;
  return { vfs, reads, most: () => most };
}

test("ModelLoader.prefetch reads each model file once, all at once", async () => {
  const { vfs, reads, most } = slowVfs();
  const loader = new ModelLoader(vfs);
  const refs = [{ name: "a/model.dat" }, { name: "b/model.dat" }, { name: "a/model.dat" }, { name: "editor/marker/model.dat" },
    { name: "texture.png" }, null, { name: "c/model.dat", arguments: { entries: [["x", 1]] } }];
  loader.prefetch(refs);
  loader.prefetch(refs);
  // the (unparseable) files fail when imported, as they would have when loaded
  await assert.rejects(loader.importFile("a/model.dat"));
  await loader.importFile("c/model.dat").catch(() => null);
  assert.deepEqual(reads.sort(), ["a/model.dat", "b/model.dat", "c/model.dat"]);
  assert.equal(most(), 3, "the reads overlap");
  assert.equal(await loader.loadRef({ name: "b/model.dat" }), null);
});

test("prefetching follows a model file to the components it always loads", () => {
  const MODEL = "com.threerings.opengl.model.config.ModelConfig";
  const r = (name: string) => ({ $class: REF, name });
  const names = (root: any) => componentRefs(root).map(x => x?.name);
  assert.deepEqual(names({ $class: MODEL, implementation: { $class: `${MODEL}$Derived`, model: r("base.dat") } }), ["base.dat"]);
  assert.deepEqual(names({ $class: MODEL, implementation: { $class: "x.CompoundConfig", models: [{ model: r("a.dat") }, { model: r("b.dat") }] } }), ["a.dat", "b.dat"]);
  assert.deepEqual(names({ $class: MODEL, implementation: { $class: "x.ConditionalConfig", defaultModel: r("d.dat"), cases: [{ model: r("c.dat") }] } }), ["d.dat"]);
  // a schemed model: only the variant tried first (the one for no scheme)
  assert.deepEqual(names({ $class: MODEL, implementation: { $class: `${MODEL}$Schemed`, models: [{ scheme: "low", model: r("low.dat") }, { model: r("hi.dat") }] } }), ["hi.dat"]);
  assert.deepEqual(names({ $class: MODEL, implementation: { $class: "x.ArticulatedConfig", attachments: [{ node: "n", model: r("hat.dat") }] } }), ["hat.dat"]);
  assert.deepEqual(names({ $class: "x.AnimationConfig", implementation: { attachments: [{ model: r("no.dat") }] } }), []);
});

test("the level index checks each archived file once per run, and again when replaced", async () => {
  const root = mkdtempSync(join(tmpdir(), "sk-index-"));
  try {
    const archive = join(root, "scenes"), install = join(root, "install");
    mkdirSync(archive);
    mkdirSync(join(install, "scenes"), { recursive: true });
    writeFileSync(join(archive, "1"), "one");
    writeFileSync(join(archive, "2"), "two");
    writeFileSync(join(archive, "notes.txt"), "not a level");
    const st = (id: string) => { const s = statSync(join(archive, id)); return { size: s.size, mtime: s.mtimeMs }; };
    const indexFile = join(root, "scene-index.json");
    writeFileSync(indexFile, JSON.stringify({ 1: { ...st("1"), name: "Level one" }, 2: { ...st("2"), name: "Level two" } }));
    const tick = () => new Promise(r => setTimeout(r, 5));
    assert.deepEqual(await sceneIndex(archive), [["1", "Level one"], ["2", "Level two"]]);
    await tick();

    // a new level is read (this one is not a scene: it has no name and is left out, but indexed)
    writeFileSync(join(archive, "3"), "three");
    assert.deepEqual(await sceneIndex(archive), [["1", "Level one"], ["2", "Level two"]]);
    assert.equal(JSON.parse(readFileSync(indexFile, "utf8"))[3].name, "");
    await tick();

    // a level the install's cache replaces (syncArchive) is read again
    writeFileSync(join(install, "scenes", "2"), "two, updated");
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(install, "scenes", "2"), later, later);
    assert.equal(syncArchive(install, archive), 1);
    assert.deepEqual(await sceneIndex(archive), [["1", "Level one"]]);
    assert.equal(JSON.parse(readFileSync(indexFile, "utf8"))[2].size, "two, updated".length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
