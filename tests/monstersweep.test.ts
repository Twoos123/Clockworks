// Monster fixes from the Test Range sweep (tools/audit/sweep.ts): what a blow at the knight is
// (data.ts attackHarms) and whether a behaviour aims one (behavior.ts attackOutlook), which
// the judge reads to tell a bark or a healer from a broken attack; and the game bugs the sweep
// found. A bombie's self-destruct ended its attack inside the attack's own step (a crash in
// syncAttackClip); a spookat's pounce flew through the knight it bit; monsters pressed against
// the knight never swung (a gap a hair below zero failed PathAttack's minimum); the Swarm was
// taken for a corpse; Vanaduke's club slam struck with the default shape instead of its
// compound region; a razor's procedural idle loaded as no clip; and a mimic's Eddie spawned
// meat shields inside its own sensor until the page ran out of memory. Most of it reads the
// install in place and skips when the game is not installed.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { attackOutlook, type Behavior } from "../src/game/behavior.ts";
import { damageHarms, readShape, statusNeverTakes } from "../src/game/data.ts";

const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
const haveInstall = existsSync(join(SK, "rsrc", "config", "attack.dat"));
const DT = 1 / 30;
const P = "Character/NPC/Monster/";
const D = "com.threerings.projectx.dungeon.config.DamageConfig$";

test("a damage harms the knight by its amount, table, status or action, and its flags", () => {
  // the "Fake Damage" a bark or a dodge deals, and a bombie's 0.001 marker
  assert.equal(damageHarms({ $class: D + "Normal", shouldReact: false }), false);
  assert.equal(damageHarms({ $class: D + "Normal", amount: 0.001, flags: 4 }), false);
  assert.equal(damageHarms({ $class: D + "Normal", amount: 50, flags: 4 }), true);
  // flags 2 reach monsters only (a bombie's DamageTarget on itself)
  assert.equal(damageHarms({ $class: D + "Unblockable", amount: 9999999, flags: 2 }), false);
  assert.equal(damageHarms({ $class: D + "DepthScale", depthScale: { name: "Monster/Damage/Attack Base" } }), true);
  assert.equal(damageHarms({ $class: D + "Compound", damages: [{ $class: D + "Normal", amount: 0.01, flags: 2 }, { $class: D + "Status", flags: 4, statusCondition: { name: "Stun" } }] }), true);
});

test("a behaviour aims a blow at its foes through its targeting, attacks and script", () => {
  const harms = (i: number) => i !== 9;
  const path = (attacks: number[]) => ({ type: "PathAttack", attacks } as const);
  const t = (targetAction: any, extra: object = {}): Behavior => ({ type: "Targeting", targetAction, routine: { type: "Idle" }, acquireRadius: 10, ...extra });
  assert.deepEqual(attackOutlook(t(path([0])), harms), { aims: true, delay: 0 });
  // only non-blows (a bark), a tortodrone's zero acquire region, a healer's wounded allies,
  // following and fleeing aim nothing
  assert.equal(attackOutlook(t(path([9])), harms).aims, false);
  assert.equal(attackOutlook(t(path([0]), { acquireRadius: 0 }), harms).aims, false);
  assert.equal(attackOutlook(t(path([0]), { targets: "hurtAllies" }), harms).aims, false);
  assert.equal(attackOutlook({ type: "Follow", target: { kind: "allies" } }, harms).aims, false);
  assert.equal(attackOutlook({ type: "Cascading", cascades: [{ behavior: t(path([0]), { targets: "hurtAllies" }) }, { behavior: t({ type: "Flee", distance: 5 }) }] }, harms).aims, false);
  // dodges do not count; the attack inside a Dodging does
  assert.equal(attackOutlook({ type: "Dodging", behavior: t(path([9])), dodges: [{ attack: 0 }] }, harms).aims, false);
  assert.equal(attackOutlook({ type: "Dodging", behavior: t({ type: "RandomAction", actions: [{ weight: 1, action: path([9]) }, { weight: 1, action: path([2]) }] }), dodges: [] }, harms).aims, true);
  // a script's first blow comes after its waits (a Crimson Hammer core: 14 s)
  const W = "com.threerings.tudey.config.ScriptConfig$Wait", A = "com.threerings.projectx.dungeon.config.DungeonScriptConfig$Attack";
  assert.deepEqual(attackOutlook({ type: "Scripted", steps: [{ $class: W, wait: 14000 }, { $class: A, attack: 9 }, { $class: W, wait: 4000 }, { $class: A, attack: 2 }] }, harms),
    { aims: true, delay: 18000 });
});

test("on the install: barks, dodges, deflects, weak spots, potions and swaps are no blows", { skip: !haveInstall }, async () => {
  const { GameData, attackHarms } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const data = new GameData(nodeLoader());
  await data.preload("config/actor.dat", "config/attack.dat", "config/fire_action.dat");
  const kindOf = (ref: any) => String(data.resolveSync("config/actor.dat", ref, "actor")?.$class ?? "").split("$").pop() ?? null;
  const verdicts = async (monster: string) => {
    const m = (await data.monster({ name: P + monster }))!;
    return new Map(m.attacks.map(a => [a.name.replace(P, ""), attackHarms(a, kindOf)]));
  };
  const expect = async (monster: string, want: Record<string, boolean>) => {
    const got = await verdicts(monster);
    for (const [a, h] of Object.entries(want)) assert.equal(got.get(a), h, `${monster}: ${a}`);
  };
  await expect("Beast/Wolver/Wolver/Wolver 1", { "Beast/Wolver/Bark": false, "Beast/Wolver/Bite, chain 1": true });
  await expect("Fiend/Devilite/Devilite/Devilite 1", { "Fiend/Devilite/Dodge": false, "Fiend/Devilite/Throw/Office Supplies/Book": true });
  await expect("Undead/Deadnaught/Deadnaught/Deadnought 1", { "Fiend/Dark Knight/Shield Deflect": false });
  await expect("Construct/Blastcore/Blastcore (Modular)", { "Construct/Blastcore/Weak Spot/Expose": false, "Construct/Blastcore/Weak Spot/Hide": false,
    "Construct/Blastcore/AoE/Buff, Attackup": false, "Construct/Blastcore/Scatter Shot/2-Way, Rocket": true });
  await expect("Boss/Roarmulus Twins/East", { "Boss/Roarmulus Twins/Expose": false, "Boss/Roarmulus Twins/Bullets/Spread Shot": true });
  await expect("Boss/Vanaduke/Stage 1 Complete", { "Boss/Vanaduke/Swap": false });
  await expect("Boss/Vanaduke/Stage 1", { "Boss/Vanaduke/Club Slam (Stage 1)": true });
  await expect("Gremlin/Darkfang Scorcher", { "Gremlin/Generic/Use Potion": false, "Gremlin/Scorcher/Fire Bullet": true });
  await expect("Gremlin/Stalker/Ghostmane Stalker 1", { "Gremlin/Stalker/Uncloak, Chain": false });
  await expect("Drone/Damage/Shankle", { "Drone/Damage/Peek": false });
  await expect("Fiend/Silkwing/Silkwing 1", { "Fiend/Silkwing 0": false });
  await expect("Fiend/Devilite/Yesman/Yesman 1", { "Fiend/Devilite/Yesman Twitch": false });
  await expect("Undead/Bombie/Bombie/Bombie 1", { "Undead/Zombie/Destroy Actor": false });
  await expect("Undead/Spookat/Spookat/Spookat 2", { "Undead/Spookat Bite": true });
  await expect("Construct/Mecha Knight Bodyguard/Sword/Mecha Knight Bodyguard", { "Construct/Mech Knight Defend": false });
});

test("on the install: Vanaduke's club slam strikes with each part of its compound region", { skip: !haveInstall }, async () => {
  const { GameData } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const data = new GameData(nodeLoader());
  await data.preload("config/actor.dat", "config/attack.dat", "config/fire_action.dat");
  const slam = (await data.monster({ name: P + "Boss/Vanaduke/Stage 1" }))!.attacks[0];
  const shape = slam.fires[0].shape!;
  assert.equal(shape.parts?.length, 2, JSON.stringify(shape));
  // the circle where the club lands, 7.5 ahead, and the rectangle along it from 2 to 6
  assert.ok(shape.parts!.some(p => Math.abs(p.forward - 7.5) < 1e-3 && Math.abs(p.radius - 1.9) < 1e-3));
  assert.ok(shape.parts!.some(p => Math.abs(p.forward - 4) < 1e-3 && Math.abs(p.halfLength - 2) < 1e-3 && Math.abs(p.halfWidth - 0.8) < 1e-3));
  assert.equal(shape.forward, 7.5, "the reach is the farthest part's");
});

test("on the install: a procedural animation (a razor's jitter) plays as a looping clip", { skip: !haveInstall }, async () => {
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const { loadAnimation } = await import("../src/model.ts");
  const clip = (await loadAnimation(nodeLoader(), "character/npc/monster/drone/razor/anim/jitter.dat"))!;
  assert.ok(clip, "it loads");
  assert.deepEqual(clip.targets, ["mesh_razor"]);
  assert.ok(clip.loop && clip.frames.length > 30);
  // the blade turns: the frames differ
  const a = clip.frames[0][0].matrix!, b = clip.frames[7][0].matrix!;
  assert.ok(a.some((x, i) => Math.abs(x - b[i]) > 1e-4));
});

/** A world on an open floor with the knight at the origin facing +x. */
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
  await w.start([0, 0], { weapons: ["Weapon/Sword/Proto Sword"] } as any);
  w.knight.heading = 0;
  w.knight.undying = true;
  return w;
}
type W = Awaited<ReturnType<typeof world>>;

/** Spawns a monster `x` ahead of the knight facing it and waits for it to load and activate. */
async function spawn(w: W, name: string, x = 4.5, hold: "frozen" | "live" = "frozen") {
  const e = w.logic.spawn({ name: P + name }, x, 0, Math.PI, w.knightEntity, w.knightEntity);
  let m = null;
  for (let i = 0; i < 300 && !m; i++) { m = w.monsters.find(o => o.entity === e) ?? null; if (!m) await new Promise(r => setTimeout(r, 20)); }
  assert.ok(m, `${name} appeared`);
  m.hold = hold; m.undying = true;
  step(w, 1.6);
  return m;
}

function step(w: W, seconds: number, until?: () => boolean) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    w.update(DT, { move: [0, 0], aim: [w.knight.x + 1, w.knight.y] } as any);
    if (until?.()) return true;
  }
  return false;
}

/** Counts the knight's hits. */
function hits(w: W) {
  const list: unknown[] = [];
  const ww = w as any, dk = ww.damageKnight;
  ww.damageKnight = function (...a: unknown[]) { list.push(a[0]); return dk.apply(this, a); };
  return list;
}

test("on the install: a bombie's self-destruct ends its attack without a crash", { skip: !haveInstall }, async () => {
  const w = await world();
  const m = await spawn(w, "Undead/Bombie/Bombie/Bombie 1");
  w.monsterAttack(m, m.def.attacks[0]);
  assert.doesNotThrow(() => step(w, 2, () => !m.attack));
  assert.equal(m.attack, null);
});

test("on the install: a spookat's pounce stops against the knight it bites", { skip: !haveInstall }, async () => {
  const w = await world();
  const got = hits(w);
  const m = await spawn(w, "Undead/Spookat/Spookat/Spookat 2");
  w.knight.x = m.x - 1.05;
  m.heading = Math.PI;
  w.monsterAttack(m, m.def.attacks[0]);
  step(w, 3, () => !m.attack);
  assert.equal(got.length, 1, "the bite landed");
  assert.ok(m.x > w.knight.x, `the cat (${m.x}) stayed in front of the knight (${w.knight.x})`);
});

test("on the install: a zombie pressed against the knight swings", { skip: !haveInstall }, async () => {
  const w = await world();
  const m = await spawn(w, "Undead/Zombie/Droul/Droul 1");
  // touching, edge to edge, as the separation leaves two actors
  w.knight.x = m.x - m.radius - w.knight.radius;
  let swung = false;
  const ww = w as any, sa = ww.startAttack;
  ww.startAttack = function (a: unknown, ...rest: unknown[]) { if (a === m) swung = true; return sa.call(this, a, ...rest); };
  m.hold = "live";
  step(w, 6, () => swung);
  assert.ok(swung, "it attacked");
});

test("on the install: the Swarm comes in as a monster, not a corpse", { skip: !haveInstall }, async () => {
  const w = await world();
  const m = await spawn(w, "Boss/Swarm/Swarm", 6);
  assert.deepEqual(m.def.attacks.map(a => a.name), [P + "Boss/Swarm/Consume"]);
});

test("on the install: a mimic's Eddie and Weirdo Hello spawn once per knight, not on every tick", { skip: !haveInstall }, async () => {
  const w = await world();
  const spawned = new Map<string, number>();
  const spawnOf = w.logic.spawn.bind(w.logic);
  w.logic.spawn = (ref: any, ...rest: any[]) => {
    spawned.set(ref?.name, (spawned.get(ref?.name) ?? 0) + 1);
    return (spawnOf as any)(ref, ...rest);
  };
  await spawn(w, "Slime/Mimic/Pieces/Eddie", 4.5, "live");
  w.logic.spawn({ name: P + "Slime/Mimic/Tentacle/Weirdo Hello" }, 4.5, 1, Math.PI, w.knightEntity, w.knightEntity);
  step(w, 4);
  // the knight walks up against them and stands there
  w.knight.x = 2.2;
  step(w, 4);
  const shields = spawned.get(P + "Slime/Mimic/Tentacle/Meat Shield") ?? 0, tentacles = spawned.get(P + "Slime/Mimic/Tentacle/Weirdo Tentacle") ?? 0;
  // one each time the knight comes in: Eddie's roundhouse (its compound region read whole, 4.5
  // around it) knocks the knight out of the sensor and it comes back in, a few times in 8 s,
  // where every tick raised one (thirty a second)
  assert.ok(shields <= 4 && tentacles <= 4, `meat shields ${shields}, tentacles ${tentacles}`);
  assert.ok(w.monsters.length < 10, `${w.monsters.length} monsters`);
});

// ------------------------------------------------------------------ the sweep's last flags

test("a condition given no chance never takes; an empty transformed shape is a point", () => {
  const ref = (entries: [string, unknown][]) => ({ name: "Stun", arguments: { $map: "com.threerings.config.ArgumentMap", entries } });
  const CUSTOM = { $enum: "x", name: "CUSTOM" }, LOW = { $enum: "x", name: "LOW" };
  // a wolver's warp: a stun ring of CUSTOM chance 0
  assert.equal(statusNeverTakes(ref([["Chance", 0], ["Status Chance", CUSTOM]])), true);
  assert.equal(damageHarms({ $class: D + "Status", flags: 4, statusCondition: ref([["Chance", 0], ["Status Chance", CUSTOM]]) }), false);
  // a black kat's bite: chance 0 under a named level, which wins
  assert.equal(statusNeverTakes(ref([["Chance", 0], ["Status Chance", LOW]])), false);
  assert.equal(statusNeverTakes(ref([["Chance", 0.25]])), false);
  assert.equal(statusNeverTakes(ref([])), false);
  // ShapeConfig.TransformedShape's shape defaults to a Point (the Swarm's Consume)
  const S = "com.threerings.tudey.shape.config.ShapeConfig$";
  assert.deepEqual(readShape({ $class: S + "TransformedShape" }), { forward: 0, side: 0, halfLength: 0, halfWidth: 0, radius: 0 });
  assert.equal(readShape({ $class: S + "TransformedShape", transform: { translation: { x: 0.75, y: 0 } } }).forward, 0.75);
});

test("on the install: warps, heals and raises are no blows; regions, beams and stripped shapes read as the configs give them", { skip: !haveInstall }, async () => {
  const { GameData, attackHarms } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const data = new GameData(nodeLoader());
  await data.preload("config/actor.dat", "config/attack.dat", "config/fire_action.dat");
  const cfgOf = (ref: any) => data.resolveSync("config/actor.dat", ref, "actor");
  const attacks = async (monster: string) => (await data.monster({ name: P + monster }))!.attacks;
  const named = async (monster: string, re: RegExp) => (await attacks(monster)).find(a => re.test(a.name))!;
  // the wolver's warp: a chanceless stun ring and a jump beside its target, either side
  const warps = (await attacks("Beast/Wolver/Wolver/Wolver 3")).filter(a => /Warp \(Instant\)$/.test(a.name));
  const warp = warps[0];
  assert.equal(attackHarms(warp, cfgOf), false);
  assert.deepEqual(warps.map(a => a.fires.find(f => f.warp)?.warp), [[0.5, 2], [-0.5, -2]]);
  assert.ok(!warp.fires.some(f => /Spawn Rotated Actor/.test(f.name ?? "") && f.shape), "a spawn of no actor strikes nothing");
  // a mender's heals and raises, a heal core's heal: their bombs heal or raise, nothing more
  for (const re of [/Heal \(Target\)$/, /Heal \(Omni\)$/, /Heal \(Renew\)$/, /Raise Dead$/, /Raise Construct$/])
    assert.equal(attackHarms(await named("Gremlin/Darkfang Mender", re), cfgOf), false, String(re));
  assert.equal(attackHarms(await named("Construct/Blastcore/Presets/Crimson BossCores/Crimson BossCoreMain3", /Buff, Heal$/), cfgOf), false);
  // ...but a flame jet's torches and a demo's mine are
  assert.equal(attackHarms(await named("Construct/Blastcore/Presets/BP NSEWBlastNetCore", /2-Way, Alternating$/), cfgOf), true);
  assert.equal(attackHarms((await attacks("Gremlin/Darkfang Demo")).filter(a => /Place Bomb$/.test(a.name))[1], cfgOf), true);
  // a lichen's swipe: its own compound region (classless in the export), ahead of it
  const lichen = (await named("Slime/Large Lichen Colony", /Slime\/Lichen$/)).fires[0].shape!;
  assert.ok(lichen.forward > 1 && Math.abs(lichen.radius - 0.5) < 1e-6, JSON.stringify(lichen));
  // the Swarm's Consume: the point at its middle
  assert.deepEqual((await named("Boss/Swarm/Swarm", /Consume$/)).fires[0].shape, { forward: 0, side: 0, halfLength: 0, halfWidth: 0, radius: 0 });
  // a blastcore's 4-way beam: four warm-up beams a quarter turn apart
  const beams = (await named("Construct/Blastcore/Presets/Crimson BossCores/Crimson BossCoreLeft2", /Beam, 4-Way$/)).fires.filter(f => f.spawn);
  assert.deepEqual(beams.map(f => +f.spawn!.rotation.toFixed(3)), [0, 1.571, 3.142, 4.712]);
  const warm = (await data.projectile(beams[0].spawn!.actor))!;
  assert.equal(warm.kind, "Laser");
  assert.equal(warm.harmless, true);
  assert.equal(warm.fuse, 3000);
  assert.equal(warm.laser?.then?.name, "Bullet/Monster/Laser Beam/Beam, Active");
  const active = (await data.projectile(warm.laser!.then))!;
  assert.ok(active.damage && !active.harmless && active.laser!.length === 15 && active.fuse === 15000, JSON.stringify(active.laser));
  // a trojan's slam: the export kept no region (a stand-in, marked), and its own 160 ms delay
  const slam = (await named("Fiend/Trojan/Trojan 1", /Sword Slam$/)).fires[0];
  assert.equal(slam.shape?.guessed, true);
  assert.equal(slam.delay, 160);
});

/** Steps the world letting its loads (projectile models and definitions) finish between ticks. */
async function run(w: W, seconds: number, until?: () => boolean) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    w.update(DT, { move: [0, 0], aim: [w.knight.x + 1, w.knight.y] } as any);
    await new Promise(r => setTimeout(r, 0));
    if (until?.()) return true;
  }
  return false;
}

/** The knight's hits as the probe sees them (status-only ones included). */
function probeHits(w: W) {
  const list: any[] = [];
  (w as any).probe = { hitKnight: (h: any) => list.push(h) };
  return list;
}

test("on the install: a toxilargo's punch reaches the knight pressed against its body", { skip: !haveInstall }, async () => {
  const w = await world();
  const got = probeHits(w);
  const m = await spawn(w, "Slime/Toxilargo, Fire/Toxilargo, Fire 1");
  w.knight.x = m.x - m.radius - w.knight.radius;
  m.heading = Math.PI;
  w.monsterAttack(m, m.def.attacks.find(a => /Jelly Punch$/.test(a.name))!);
  step(w, 3, () => !m.attack);
  assert.ok(got.some(h => h.dealt > 0), "the punch landed");
});

test("on the install: a black kat's curse aura does not shove the knight out of its bite", { skip: !haveInstall }, async () => {
  const w = await world();
  const got = probeHits(w);
  const m = await spawn(w, "Undead/Spookat/Black Kat/Black Kat 2");
  w.knight.x = m.x - 1.55;
  m.heading = Math.PI;
  w.monsterAttack(m, m.def.attacks.find(a => /Black Kat Bite$/.test(a.name))!);
  step(w, 3, () => !m.attack);
  assert.ok(got.some(h => h.dealt > 0), "the bite landed");
  // the aura's chanceless curse ticks reach the probe, without a push
  assert.ok(got.some(h => h.dealt === 0 && !h.moved), "the aura's ticks are seen");
});

test("on the install: a lichen's swipe strikes before the back-step that starts with it", { skip: !haveInstall }, async () => {
  const w = await world();
  const got = probeHits(w);
  const m = await spawn(w, "Slime/Large Lichen Colony");
  const swipe = m.def.attacks.find(a => /Slime\/Lichen$/.test(a.name))!;
  w.knight.x = m.x - swipe.fires[0].shape!.forward;
  m.heading = Math.PI;
  w.monsterAttack(m, swipe);
  step(w, 3, () => !m.attack);
  assert.ok(got.some(h => h.dealt > 0), "the swipe landed");
});

test("on the install: a mecha knight's shock is a status-only blow the probe sees", { skip: !haveInstall }, async () => {
  const w = await world();
  const got = probeHits(w);
  const m = await spawn(w, "Construct/Mecha Knight Bodyguard/Sword/Mecha Knight Bodyguard");
  w.knight.x = m.x - 1.2;
  m.heading = Math.PI;
  w.monsterAttack(m, m.def.attacks.find(a => /Mecha Knight Spaz$/.test(a.name))!);
  step(w, 2, () => !m.attack);
  assert.ok(got.some(h => h.dealt === 0 && !h.reacted), JSON.stringify(got));
});

test("on the install: the Swarm's Consume drains the knight on it without a flinch", { skip: !haveInstall }, async () => {
  const w = await world();
  const got = probeHits(w);
  const m = await spawn(w, "Boss/Swarm/Swarm", 6);
  w.knight.x = m.x; w.knight.y = m.y;
  w.monsterAttack(m, m.def.attacks[0]);
  step(w, 0.5, () => got.length > 0);
  assert.ok(got.length && got[0].dealt > 0, JSON.stringify(got));
  assert.equal(got[0].reacted, false);
  assert.ok(w.knight.hurtTime <= 0, "no flinch");
});

test("on the install: a wolver's warp takes it to its spot in the knight's frame", { skip: !haveInstall }, async () => {
  const w = await world();
  const m = await spawn(w, "Beast/Wolver/Wolver/Wolver 3", 4);
  // (without the sidestep its impulse adds)
  const warp = m.def.attacks.find(a => /Warp \(Instant\)$/.test(a.name))!;
  w.monsterAttack(m, { ...warp, impulse: null });
  step(w, 0.1);
  // 0.5 ahead of the knight (aiming along +x) and 2 to its left, facing it
  assert.ok(Math.hypot(m.x - 0.5, m.y - 2) < 0.05, `wolver at ${m.x.toFixed(2)}, ${m.y.toFixed(2)}`);
  assert.ok(Math.abs(m.heading - Math.atan2(-2, -0.5)) < 0.05, `heading ${m.heading}`);
});

test("on the install: a blastcore's beam strikes along its length; a warm-up beam becomes its live one", { skip: !haveInstall }, async () => {
  const lasers = (w: W) => ((w as any).projectiles as any[]).filter(p => p.def.kind === "Laser").map(p => p.def.name as string);
  const fire = async (heading: number) => {
    const w = await world();
    const got = probeHits(w);
    const m = await spawn(w, "Construct/Blastcore/Presets/Ghost in the Machine/GitM, Stage1", 9);
    w.knight.x = m.x - 8;
    m.heading = heading;
    // its two beams' directions are random: here both point the attack's way
    const beam = m.def.attacks.find(a => /Beam, 2-Random$/.test(a.name))!;
    w.monsterAttack(m, { ...beam, fires: beam.fires.map(f => f.spawn ? { ...f, spawn: { ...f.spawn, rotation: 0, variance: 0 } } : f) });
    return { w, got };
  };
  const { w, got } = await fire(Math.PI);
  assert.ok(await run(w, 3, () => lasers(w).length > 0), "a beam appeared");
  assert.ok(lasers(w).every(n => /Warmup/.test(n)), lasers(w).join());
  assert.ok(await run(w, 5, () => lasers(w).some(n => /Active/.test(n))), "the warm-up beam became the live one");
  assert.ok(await run(w, 3, () => got.some(h => h.dealt > 0)), "the live beam struck the knight 8 units off");
  // a beam aimed away strikes nothing
  const away = await fire(Math.PI / 2);
  await run(away.w, 7);
  assert.ok(!away.got.some(h => h.dealt > 0), "a beam aimed away missed");
});
