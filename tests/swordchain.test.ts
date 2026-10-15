// A sword's full combo in the world (World.update with the knight's controls): each swing's
// step carries the knight (tests/attackmove.test.ts has the impulses themselves). The Test
// Range sweep once reported "the knight moved 0.00" for most swords: its clicks all came
// before the first swing's rearm, which the client drops, so only the first swing (no step)
// played. With a monster in front, the last swing's 2-unit step (0.8 units in its first 33 ms
// tick) used to carry the knight past the monster's middle and out its far side; it now stops
// against it (World.moveAmongActors). Reads the install in place and skips when the game is
// not installed.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
const haveInstall = existsSync(join(SK, "rsrc", "config", "attack.dat"));
const SWORD = "Weapon/Sword/Proto Sword";
const DUMMY = "Character/NPC/Monster/Slime/Jelly/Jelly Cube/Jelly Cube 1";
const DT = 1 / 30;

/** A world on an open floor with the knight at the origin facing +x, holding the sword. */
async function world() {
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
  await w.start([0, 0], { weapons: [SWORD] } as any);
  w.knight.heading = 0;
  return w;
}

type W = Awaited<ReturnType<typeof world>>;

/** The Test Range's dummy 1.6 units ahead: frozen, undying and pinned where it stands. */
async function dummy(w: W) {
  w.logic.spawn({ name: DUMMY }, 1.6, 0, Math.PI, w.knightEntity, w.knightEntity);
  for (let i = 0; i < 250 && !w.monsters.length; i++) await new Promise(r => setTimeout(r, 20));
  const d = w.monsters[0];
  assert.ok(d, "the dummy spawned");
  d.hold = "frozen"; d.undying = true;
  for (let i = 0; i < 150 && d.state === "spawning"; i++) w.update(DT, { move: [0, 0] } as any);
  return d;
}

/** Clicks (one-frame presses) on the ticks `click` picks; the swings started and how far the knight went. */
function chain(w: W, click: (tick: number, swings: number) => boolean, pin?: W["monsters"][number]) {
  const k = w.knight, x0 = k.x, y0 = k.y;
  const swings: { name: string; step: number }[] = [];
  for (let i = 0; i < 120; i++) {
    if (pin) { pin.x = 1.6; pin.y = 0; pin.impulse = null; }
    const before = k.attack;
    w.update(DT, { move: [0, 0], aim: [k.x + 5, k.y], attackDown: click(i, swings.length) } as any);
    if (k.attack && k.attack !== before) swings.push({ name: k.attack.def.name, step: k.attack.def.impulse?.forward ?? 0 });
  }
  return { swings, travel: Math.hypot(k.x - x0, k.y - y0) };
}

/** A player mashing the button: a click every 3 ticks until the combo's swings have started. */
const mash = (n: number) => (tick: number, swings: number) => tick % 3 === 0 && swings < n;

test("a sword's three-swing combo steps the knight 0, 1.25 and 2 units on open floor", { skip: !haveInstall }, async () => {
  const w = await world();
  const r = chain(w, mash(3));
  assert.deepEqual(r.swings.map(s => s.step), [0, 1.25, 2]);
  assert.ok(Math.abs(r.travel - 3.25) < 0.05, `travelled ${r.travel}`);
  assert.equal(w.knight.y, 0, "straight ahead");
});

test("with a monster in front, the combo's steps carry the knight up to it and stop there", { skip: !haveInstall }, async () => {
  const w = await world();
  const d = await dummy(w);
  const r = chain(w, mash(3), d);
  assert.deepEqual(r.swings.map(s => s.step), [0, 1.25, 2]);
  const k = w.knight, gap = Math.hypot(d.x - k.x, d.y - k.y) - d.radius - k.radius;
  // the dummy started 1.6 - 0.4 - 1/3 = 0.87 units off, edge to edge
  assert.ok(r.travel > 0.8 && r.travel < 3.25, `travelled ${r.travel}`);
  assert.ok(Math.abs(gap) < 0.05, `ended ${gap} from the dummy edge; travel ${r.travel} k ${k.x},${k.y} d ${d.x},${d.y}`);
  assert.ok(k.x < d.x, "not through it");
});

test("clicks before a swing's rearm are dropped: three quick clicks play one swing", { skip: !haveInstall }, async () => {
  // the sweep's old driving (a click every 5 ticks, three in all): only the stepless first swing
  const w = await world();
  let clicks = 0;
  const r = chain(w, tick => tick % 5 === 0 && clicks++ < 3);
  assert.equal(r.swings.length, 1);
  assert.equal(r.travel, 0);
});
