// The shield bubble (src/game/shieldfx.ts): its strength, its state as the shield goes up, is
// hit and comes down, and the install's bubble effect drawing once it has run a moment. The
// install tests read particle/shield/omni.dat in place and skip when the game is not installed.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { importBinary } from "../src/export/BinaryImport.ts";
import { applyArguments, getArg } from "../src/config/params.ts";
import { catchUpSteps, Emitter, readParticleLayers } from "../src/particles.ts";
import { compose } from "../src/math.ts";
import { ShieldBubble, shieldEffectRef, shieldPowerLevel, type BubbleHost } from "../src/game/shieldfx.ts";
import { nodeInflate, skDir } from "../tools/common.ts";

const BASE = { $class: "com.threerings.config.ConfigReference", name: "particle/shield/omni_w_sound.dat",
  arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Power", "100"], ["Radius", 1]] } };

test("the bubble's Power is the shield's health in quarters", () => {
  assert.equal(shieldPowerLevel(50, 50), 4);
  assert.equal(shieldPowerLevel(38, 50), 3);
  assert.equal(shieldPowerLevel(25, 50), 2);
  assert.equal(shieldPowerLevel(1, 50), 0);
  assert.equal(shieldPowerLevel(-5, 50), 0);
  assert.equal(shieldPowerLevel(0, 0, false), 4);
  const ref = shieldEffectRef(BASE, 3);
  assert.equal(getArg(ref, "Power"), "75");
  assert.equal(getArg(ref, "Radius"), 1);
  assert.equal(getArg(BASE, "Power"), "100", "the item's own reference is left alone");
});

type Fx = { id: number; power: string; life: number };
function host() {
  const shown: Fx[] = [];
  const pending: { ref: any; resolve: (e: Fx | null) => void }[] = [];
  let n = 0;
  const h: BubbleHost<Fx> = {
    load: ref => new Promise(resolve => pending.push({ ref, resolve })),
    attach: e => { shown.push(e); },
    detach: e => { e.life = 0; shown.splice(shown.indexOf(e), 1); },
    holds: e => shown.includes(e),
  };
  const finish = async () => {
    for (const p of pending.splice(0)) p.resolve({ id: ++n, power: String(getArg(p.ref, "Power")), life: 1 });
    await new Promise(r => setTimeout(r, 0));
  };
  return { h, shown, pending, finish };
}

test("the bubble goes up with the shield, stays through a hit and comes down with it", async () => {
  const { h, shown, pending, finish } = host();
  const b = new ShieldBubble(h);
  const knight = {};
  b.set(true, knight, BASE, 4);
  b.set(true, knight, BASE, 4); // every frame while held: one load
  assert.equal(pending.length, 1);
  await finish();
  assert.deepEqual(shown.map(e => e.power), ["100"]);
  // a hit that does not change the quarter (the recoil keeps it wanted): the same bubble
  b.set(true, knight, BASE, 4);
  assert.equal(shown.length, 1);
  assert.equal(pending.length, 0);
  // a hit down a quarter: remade, green
  b.set(true, knight, BASE, 3);
  assert.equal(shown.length, 0);
  await finish();
  assert.deepEqual(shown.map(e => e.power), ["75"]);
  b.set(false, knight, BASE, 3);
  assert.equal(shown.length, 0);
  assert.equal(b.effect, null);
});

test("a load that lands after the shield came down is dropped", async () => {
  const { h, shown, finish } = host();
  const b = new ShieldBubble(h);
  const knight = {};
  b.set(true, knight, BASE, 4);
  b.set(false, knight, BASE, 4);
  await finish();
  assert.equal(shown.length, 0);
  // raised again: a fresh load
  b.set(true, knight, BASE, 4);
  await finish();
  assert.equal(shown.length, 1);
});

test("a bubble the world dropped (its effects cleared) is made again", async () => {
  const { h, shown, pending, finish } = host();
  const b = new ShieldBubble(h);
  const knight = {};
  b.set(true, knight, BASE, 4);
  await finish();
  shown.length = 0; // the level's (or an audit's) effects cleared under it
  b.set(true, knight, BASE, 4);
  assert.equal(pending.length, 1);
  await finish();
  assert.equal(shown.length, 1);
});

test("no shield effect, no bubble", () => {
  const { h, pending } = host();
  new ShieldBubble(h).set(true, {}, null, 4);
  assert.equal(pending.length, 0);
});

test("an emitter catches up with its instance's clock in short steps", () => {
  assert.deepEqual(catchUpSteps(undefined, 0), []);
  assert.deepEqual(catchUpSteps(1, 0.5), []);
  const s = catchUpSteps(undefined, 0.1);
  assert.equal(s.length, 3);
  assert.ok(Math.abs(s.reduce((a, b) => a + b, 0) - 0.1) < 1e-9);
  assert.ok(Math.abs(catchUpSteps(undefined, 100).reduce((a, b) => a + b, 0) - 2) < 1e-9, "capped");
  assert.equal(catchUpSteps(0.5, 0.5 + 1 / 60).length, 1);
});

const omni = join(skDir(), "rsrc", "particle/shield/omni.dat");
test("the shield bubble's layers are shown at every strength and visible once it has run a moment", { skip: !existsSync(omni) }, async () => {
  const root: any = (await importBinary(new Uint8Array(readFileSync(omni)), nodeInflate)).root;
  const material = { name: "", queue: "Transparent", passes: [], resolved: true } as any;
  for (const [power, ambient] of [["100", true], ["75", true], ["50", true], ["25", true], ["0", false]] as const) {
    const cfg = applyArguments(root, { arguments: { entries: [["Power", power], ["Radius", 1]] } });
    const layers = readParticleLayers(cfg.implementation, () => material);
    const names = layers.map(l => l.name);
    assert.equal(names.includes("Shield"), ambient, `Power ${power}: the ambient bubble`);
    assert.equal(names.includes("Broke Ring"), !ambient, `Power ${power}: the broken rings`);
    const m = compose([0, 0, 0], [0, 0, 0, 1], 1);
    // drawn the moment it is made, every particle is at age 0: the rings fade in from nothing
    const fresh = new Emitter(layers);
    fresh.update(1 / 60, m);
    const alpha = (e: Emitter) => Math.max(0, ...e.states.flatMap(s => s.particles.map(p => p.color(Math.min(1, p.age / p.life))[3])));
    assert.ok(alpha(fresh) < 0.05, `Power ${power}: nothing to see at age 0`);
    // caught up over the half second the shield has been held
    const held = new Emitter(layers);
    for (const s of catchUpSteps(undefined, 0.5)) held.update(s, m);
    assert.ok(alpha(held) > 0.05, `Power ${power}: visible after half a second (${alpha(held)})`);
  }
});
