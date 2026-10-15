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
import { damageHarms } from "../src/game/data.ts";

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
  assert.ok(shields <= 2 && tentacles <= 2, `meat shields ${shields}, tentacles ${tentacles}`);
  assert.ok(w.monsters.length < 10, `${w.monsters.length} monsters`);
});
