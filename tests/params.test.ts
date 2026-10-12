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
