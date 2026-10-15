import assert from "node:assert/strict";
import { test } from "node:test";
import { applyArguments, fieldName, getArg, parsePath, setPath } from "../src/config/params.ts";

const REF = "com.threerings.config.ConfigReference";

test("parses dotted paths with index and argument selectors", () => {
  assert.deepEqual(parsePath('a.b_c[0].d["File"]'), [
    [{ kind: "word", value: "a" }],
    [{ kind: "word", value: "b_c" }, { kind: "index", value: 0 }],
    [{ kind: "word", value: "d" }, { kind: "arg", value: "File" }],
  ]);
  assert.equal(fieldName("color_state_override"), "colorStateOverride");
});

test("setPath creates omitted default objects and sets reference arguments", () => {
  const cfg: any = { implementation: { techniques: [{ enqueuer: { passes: [{}] } }] } };
  setPath(cfg, "implementation.techniques[0].enqueuer.passes[0].color_state_override.color", "red");
  assert.equal(cfg.implementation.techniques[0].enqueuer.passes[0].colorStateOverride.color, "red");
  const withRef: any = { tex: { $class: REF, name: "2D/File/Default" } };
  setPath(withRef, 'tex["File"]', "a.png");
  assert.equal(getArg(withRef.tex, "File"), "a.png");
});

test("setPath writes nothing through an argument of a reference that is not there", () => {
  // the vortex bombs' last implode: "FX" null empties its destruction transient, then "FX
  // Transform" (destruction_transient["Transform"]) used to leave {} there, an effect named null
  const cfg: any = { implementation: { sprite: { destructionTransient: null } } };
  assert.equal(setPath(cfg, 'implementation.sprite.destruction_transient["Transform"]', { scale: 2 }), false);
  assert.equal(cfg.implementation.sprite.destructionTransient, null);
  const list: any = { refs: [null] };
  assert.equal(setPath(list, 'refs[0]["File"]', "a.png"), false);
  assert.equal(list.refs[0], null);
  // an omitted field before more fields still gets its placeholder
  const omitted: any = {};
  assert.equal(setPath(omitted, "a.b", 1), true);
  assert.equal(omitted.a.b, 1);
});

test("a vortex implode's FX argument of null leaves the implode with no destruction transient", async () => {
  const REF_ = { $class: REF, name: "fx.dat" };
  const actor = {
    name: "Implode", implementation: { sprite: { destructionTransient: REF_ } },
    parameters: [
      { $class: "com.threerings.config.Parameter$Direct", name: "FX", paths: ["implementation.sprite.destruction_transient"] },
      { $class: "com.threerings.config.Parameter$Direct", name: "FX Transform", paths: ['implementation.sprite.destruction_transient["Transform"]'] },
    ],
  };
  const out = applyArguments(actor, { $class: REF, name: "Implode", arguments: { entries: [["FX", null], ["FX Transform", { scale: 1 }]] } });
  assert.equal(out.implementation.sprite.destructionTransient, null);
  // with a transient given, its transform lands on it
  const given = applyArguments(actor, { $class: REF, name: "Implode", arguments: { entries: [["FX", { $class: REF, name: "v.dat" }], ["FX Transform", { scale: 3 }]] } });
  assert.deepEqual(getArg(given.implementation.sprite.destructionTransient, "Transform"), { scale: 3 });
});

test("applies direct and choice parameters to a clone", () => {
  const material = {
    name: "M",
    implementation: { passes: [{ textureState: { units: [{}] } }] },
    parameters: [
      { $class: "com.threerings.config.Parameter$Direct", name: "Texture", paths: ["implementation.passes[0].texture_state.units[0].texture"] },
      {
        $class: "com.threerings.config.Parameter$Choice", name: "Pass Mode",
        options: [{ name: "Multiply x2", arguments: { entries: [["Type", "combine"]] } }],
        directs: [{ $class: "com.threerings.config.Parameter$Direct", name: "Type", paths: ["implementation.passes[0].texture_state.units[0].environment"] }],
      },
    ],
  };
  const ref = { $class: REF, name: "M", arguments: { entries: [["Texture", "T"], ["Pass Mode", "Multiply x2"]] } };
  const out = applyArguments(material, ref);
  assert.equal(out.implementation.passes[0].textureState.units[0].texture, "T");
  assert.equal(out.implementation.passes[0].textureState.units[0].environment, "combine");
  assert.equal((material.implementation.passes[0].textureState.units[0] as any).texture, undefined, "original untouched");
});
