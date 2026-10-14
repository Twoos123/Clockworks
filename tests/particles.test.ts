import assert from "node:assert/strict";
import { test } from "node:test";
import { Emitter, layerOrder, type ParticleLayer } from "../src/particles.ts";
import { compose } from "../src/math.ts";
import { gateDisplayModel } from "../src/game/props.ts";

test("a system's layers draw by rising GroupPriority, others at priority 0 in config order", () => {
  // omni.dat (the shield bubble): Init Ring, Init Flash (none), Ring 10, Ring Vert 5, Ring Wave 2, Shield 0, Shadow -10, Source 1
  const p = [null, null, 10, 5, 2, 0, -10, 1].map(priority => ({ priority }));
  assert.deepEqual(layerOrder(p), [6, 0, 1, 5, 7, 4, 3, 2]);
});

test("a quad reaches its size each way from the particle, as Clyde's quad geometry does", () => {
  const layer = {
    name: "q", count: 1, alphaMode: "TRANSLUCENT", alignment: "FIXED", geometry: "Quads", segments: 0, priority: null,
    material: { name: "", queue: "Transparent", passes: [], resolved: true }, divisionsS: 1, divisionsT: 1,
    color: () => () => [1, 1, 1, 1], size: () => () => 1, length: () => () => 0.1, frame: () => () => 0,
    speed: () => 0, lifespan: () => 10, orientation: () => [0, 0, 0, 1], angularVelocity: () => [0, 0, 0],
    place: () => [0, 0, 0], shoot: () => [0, 0, 1], counter: { kind: "Unlimited", rate: 0, interval: () => 1 },
    respawn: true, startTime: 0, timeScale: 1, moveWithEmitter: true, transform: compose([0, 0, 0], [0, 0, 0, 1], 1), influences: [],
  } as unknown as ParticleLayer;
  const e = new Emitter([layer]);
  const m = compose([0, 0, 0], [0, 0, 0, 1], 1);
  e.update(0.01, m);
  const out: number[] = [];
  e.emit(0, m, [1, 0, 0], [0, 1, 0], out);
  const xs = out.filter((_, i) => i % 9 === 0);
  assert.equal(Math.min(...xs), -1);
  assert.equal(Math.max(...xs), 1);
});

test("a gate pillar shows the gate's six themes, launched while the gate is active", () => {
  const ref = gateDisplayModel(["Gremlin", "Slime", "Undead", "Freeze", "Fiend"], true);
  const args = Object.fromEntries(ref.arguments.entries);
  assert.equal(ref.name, "world/dynamic/gates/arcade_pillar/model_v2.dat");
  assert.equal(args.Icon1, "ui/icon/theme/gremlin.png");
  assert.equal(args.Icon4, "ui/icon/theme/freeze.png");
  assert.equal(args.Icon6, "ui/icon/theme/unk.png");
  assert.equal(args.Arrow, "Off");
  assert.equal(args.State, "Launched");
  assert.equal(Object.fromEntries(gateDisplayModel([], false).arguments.entries).State, "Dormant");
});
