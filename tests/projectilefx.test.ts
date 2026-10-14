// Projectiles' particles: a fired bullet's instance is advanced by the world each tick, and its
// particle systems keep that clock (clockEmitter), so a bullet drawn a few ticks after it was
// fired already shows its particles. The install test reads the Blaster's bullet in place and
// skips when the game is not installed.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { clockEmitter, Emitter, type ParticleLayer } from "../src/particles.ts";
import { ModelInstance } from "../src/render/renderer.ts";
import { compose } from "../src/math.ts";
import { skDir } from "../tools/common.ts";

const at = (x: number) => compose([x, 0, 0], [0, 0, 0, 1], 1);
const alpha = (e: Emitter) => Math.max(0, ...e.states.flatMap(s => s.particles.map(p => p.color(Math.min(1, p.age / p.life))[3])));

test("an advanced instance's emitter runs on the instance's clock, caught up from where it was last drawn", () => {
  const layer = {
    name: "core", count: 1, respawn: true, startTime: 0, timeScale: 1, moveWithEmitter: true, influences: [],
    transform: at(0), counter: { kind: "Unlimited" }, place: () => [0, 0, 0], shoot: () => [1, 0, 0], speed: () => 0,
    lifespan: () => 1, orientation: () => [0, 0, 0, 1], angularVelocity: () => [0, 0, 0],
    // fades in over the particle's first half
    color: () => (t: number) => [1, 1, 1, Math.min(1, t * 2)], size: () => () => 1, length: () => () => 0, frame: () => () => 0,
  } as unknown as ParticleLayer;
  const e = new Emitter([layer]);
  // the world has advanced the bullet's instance 0.2 s before its first draw
  clockEmitter(e, 0.2, 100, 1 / 60, at(3));
  assert.equal(e.states[0].particles.length, 1);
  // (born at the end of the first 1/30 s step, it has lived the rest of the 0.2 s)
  const age0 = e.states[0].particles[0].age;
  assert.ok(Math.abs(age0 - (0.2 - 1 / 30)) < 1e-6, `caught up over the 0.2 s it has flown (${age0})`);
  assert.ok(alpha(e) > 0.3);
  // drawn again with no tick in between: no time passes
  clockEmitter(e, 0.2, 100.5, 1 / 60, at(3));
  assert.ok(Math.abs(e.states[0].particles[0].age - age0) < 1e-6);
  clockEmitter(e, 0.2 + 1 / 60, 100.6, 1 / 60, at(3));
  assert.ok(Math.abs(e.states[0].particles[0].age - (age0 + 1 / 60)) < 1e-6);
  // scenery (age 0) keeps the renderer's clock
  const s = new Emitter([layer]);
  clockEmitter(s, 0, 10, 1 / 60, at(0));
  const a0 = s.states[0].particles[0].age;
  clockEmitter(s, 0, 10.05, 1 / 60, at(0));
  assert.ok(Math.abs(s.states[0].particles[0].age - a0 - 0.05) < 1e-6);
});

const SK_RSRC = join(skDir(), "rsrc");
test("a fired Blaster bullet's instance ages each tick and its particles are visible a moment after it is fired",
  { skip: !existsSync(join(SK_RSRC, "config", "actor.dat")) }, async () => {
  const { GameData } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const loader = nodeLoader();
  const data = new GameData(loader);
  await data.preload("config/item.dat", "config/actor.dat", "config/attack.dat", "config/fire_action.dat");
  const w = (await data.weapon("Weapon/Handgun/Blaster"))!;
  const p = (await data.projectile(w.attacks[0].fires.find(f => f.spawn)!.spawn!.actor))!;
  const model = (await loader.loadRef(p.model))!;
  // the bullet's particle system (a compound's component)
  const sys = model.particles?.length ? model : model.attachments.map(a => a.model).find(m => m.particles?.length)!;
  assert.ok(sys, "the bullet model has a particle system");
  const inst = new ModelInstance(sys);
  const e = new Emitter(sys.particles!);
  // as World.updateProjectiles: each tick advances the instance; the renderer draws between
  for (let tick = 1; tick <= 6; tick++) {
    inst.advance(1 / 60);
    assert.ok(Math.abs(inst.age - tick / 60) < 1e-9, "the instance's age advances each tick");
    clockEmitter(e, inst.age, 0, 1 / 60, at(tick * 0.25));
  }
  const live = e.states.reduce((n, s) => n + s.particles.length, 0);
  assert.ok(live > 0, "it has particles");
  assert.ok(alpha(e) > 0.05, `they are visible (${alpha(e)})`);
});
