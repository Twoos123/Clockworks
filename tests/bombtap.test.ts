// Bombs in the world (World.update with the knight's controls). A bomb item has no basic
// attacks (ItemConfig Weapon `attacks` is empty): a click only starts a charge, and letting go
// before it is full plays the incomplete charged attack (Weapon/Bomb/Parts/Base Interupt, the
// fizzle) and places nothing, as in the client. The full charge places the bomb, which goes off
// on its fuse. The Test Range sweep once flagged every bomb's tap for placing no bomb.
// The vortex bombs (Graviton, Electron, Obsidian Crusher...) pass their last implode "FX" null
// and an "FX Transform"; that used to leave an empty reference as its destruction transient, an
// effect named null. Reads the install in place and skips when the game is not installed.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
const haveInstall = existsSync(join(SK, "rsrc", "config", "attack.dat"));
const DT = 1 / 30;

/** A world on an open floor with the knight at the origin facing +x, holding the bomb. */
async function world(weapon: string) {
  const { World } = await import("../src/game/world.ts");
  const { CollisionMap } = await import("../src/game/collision.ts");
  const { ModelInstance } = await import("../src/render/renderer.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const col = new CollisionMap();
  for (let x = -20; x <= 20; x++) for (let y = -20; y <= 20; y++) col.cells.set(CollisionMap.key(x, y), { flags: 0, floor: true, z: 0 } as any);
  const renderer: any = { instantiate: async (m: any) => new ModelInstance(m) };
  const scene: any = { id: "t", name: "t", objects: [], globals: [], bounds: { min: [-20, -20], max: [20, 20] }, collision: col,
    spawns: [], triggers: [], startupActors: [], logic: [], start: null };
  const w = new World(nodeLoader(), renderer, scene, col, {});
  await w.start([0, 0], { weapons: [weapon] } as any);
  w.knight.heading = 0;
  // the effects the world spawns, by name
  const effects: unknown[] = [];
  const ww = w as any;
  const spawn = ww.spawnEffect;
  ww.spawnEffect = function (ref: any, ...rest: unknown[]) { effects.push(typeof ref === "string" ? ref : ref?.name); return spawn.call(this, ref, ...rest); };
  return { w, effects };
}

type W = Awaited<ReturnType<typeof world>>["w"];

/** Ticks with the button as `held` says; the attacks started and the projectiles seen. */
async function run(w: W, ticks: number, held: (i: number) => boolean) {
  const k = w.knight, attacks: string[] = [], projectiles = new Set<string>();
  for (let i = 0; i < ticks; i++) {
    const before = k.attack;
    const h = held(i);
    w.update(DT, { move: [0, 0], aim: [k.x + 5, k.y], attackDown: h && i === 0, attackHeld: h } as any);
    if (k.attack && k.attack !== before) attacks.push(k.attack.def.name);
    for (const p of w.projectiles) projectiles.add(p.def.name);
    // the projectile defs load asynchronously
    await new Promise(r => setTimeout(r, 1));
  }
  return { attacks, projectiles: [...projectiles] };
}

test("a bomb's tap fizzles and places nothing; its full charge places a bomb that goes off", { skip: !haveInstall }, async () => {
  const { w } = await world("Weapon/Bomb/Blast Bomb");
  const def = w.knight.weapon!;
  assert.equal(def.attacks.length, 0, "a bomb has no basic attacks");
  assert.equal(def.incompleteChargedAttack?.name, "Weapon/Bomb/Parts/Base Interupt");
  // a click: down for a frame, then released
  const tap = await run(w, 90, i => i === 0);
  assert.deepEqual(tap.attacks, ["Weapon/Bomb/Parts/Base Interupt"]);
  assert.deepEqual(tap.projectiles, []);
  // held past the charge time, then released
  const ticks = Math.ceil((def.chargeTime + 200) / 1000 / DT);
  const charge = await run(w, ticks + 150, i => i < ticks);
  assert.deepEqual(charge.attacks, ["Weapon/Bomb/Parts/Base Charge"]);
  assert.deepEqual(charge.projectiles, ["Bomb/Blast (Charged)"]);
  assert.equal(w.projectiles.length, 0, "it went off on its fuse");
});

test("a vortex bomb's implodes spawn no effect named null", { skip: !haveInstall }, async () => {
  const { w, effects } = await world("Weapon/Bomb/Graviton Bomb");
  const ticks = Math.ceil((w.knight.weapon!.chargeTime + 200) / 1000 / DT);
  const r = await run(w, ticks + 200, i => i < ticks);
  assert.ok(r.projectiles.includes("Bomb/Parts/Gravidos (Implode) (Charged)"), r.projectiles.join(", "));
  assert.ok(r.projectiles.includes("Bomb/Parts/Gravidos (Explode) (Charged)"), r.projectiles.join(", "));
  assert.ok(effects.some(e => /gravidos_vortex/.test(String(e))), "the implodes' vortex transients");
  assert.ok(effects.every(e => typeof e === "string" && e), `effects: ${effects.join(", ")}`);
});
