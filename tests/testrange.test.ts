import assert from "node:assert/strict";
import { test } from "node:test";
import { rangePlan, rangeSpawn, RANGE_SIZE } from "../src/dev/rangescene.ts";
import { attackTiming, damageSplit, hitLines, monsterParts, monsterTree, statusText, summarize, timingText, type HitRecord } from "../src/dev/readout.ts";
import { bindPose, groupOf, judgeKnight, judgeMonster, judgeWeapon, parseArgs, reportMarkdown, slug, tally, type MonsterRecord, type WeaponRecord } from "../tools/audit/sweep-judge.ts";
import type { AttackDef } from "../src/game/data.ts";

// Synthetic attacks, hits and records in the shapes the world, the range and the sweep use.
const attack = (over: Partial<AttackDef> = {}): AttackDef => ({
  name: "Swing", startSpeed: 1, fireSpeed: 1, endSpeed: 1, land: 200, rearm: 300, clear: 100, damage: null, delay: 0, shape: null,
  knockback: 1, interruptable: true, impulse: null, spawn: null, blended: true, chainTo: null, fires: [], contact: null, ...over,
});
const hit = (over: Partial<HitRecord> = {}): HitRecord => ({
  t: 1, from: "knight", to: "Slime/Dummy", attack: "Swing", amounts: { NORMAL: 30, PIERCING: 10 }, dealt: 25, knock: 1.5, knockMs: 250,
  knockLevel: 1, moved: true, reacted: true, killed: false, statuses: [], timing: null, ...over,
});

test("the range hall: floor ringed by wall, the knight inside it", () => {
  const plan = rangePlan(false, 4, 3);
  const floor = [...plan.cells].filter(([, s]) => s === 1).length;
  const wall = [...plan.cells].filter(([, s]) => s === 2).length;
  assert.equal(floor, 12);
  assert.equal(wall, 6 * 5 - 12);
  assert.equal(rangePlan(true, 4, 3).cells.size, 8 * 7);
  assert.deepEqual(plan.rooms, [{ x: 0, y: 0, w: 4, h: 3 }]);
  const [x, y] = rangeSpawn();
  assert.ok(x > 0 && x < RANGE_SIZE.w && y > 0 && y < RANGE_SIZE.h);
});

test("attack timing follows the attack's speeds and fire delays", () => {
  const t = attackTiming(attack({ startSpeed: 2, fireSpeed: 0.5, fires: [{ delay: 50 } as any, { delay: 120 } as any] }));
  assert.deepEqual(t, { startup: 100, activeFrom: 50, activeTo: 120, rearm: 600, clear: 100, total: 800 });
  assert.equal(timingText(t, 2000), "startup 100 ms, active +50-120 ms, rearm 600 ms, clear 100 ms, charge 2000 ms");
  assert.equal(timingText(null), "-");
});

test("hit readouts: the type split, statuses and totals", () => {
  assert.equal(damageSplit({ NORMAL: 30, PIERCING: 10 }), "NORMAL 75% / PIERCING 25%");
  assert.equal(damageSplit({}), "none");
  assert.equal(statusText({ kind: "Fire", chance: 0.25, applied: true, duration: 4000 }), "Fire 25% (applied, 4 s)");
  assert.equal(statusText({ kind: "Shock", chance: 0.5, applied: false, duration: 3000 }), "Shock 50% (not applied)");
  const lines = hitLines(hit({ statuses: [{ kind: "Fire", chance: 0.25, applied: true, duration: 4000 }], knockdown: false, reacted: true }));
  assert.match(lines[1], /^damage 25 of 40 raw · NORMAL 75% \/ PIERCING 25%$/);
  assert.match(lines[3], /flinch/);
  assert.match(lines[4], /Fire 25%/);
  const s = summarize([hit(), hit({ dealt: 5, knock: 3.04, reacted: false, statuses: [{ kind: "Freeze", chance: 1, applied: true, duration: 1 }] })]);
  assert.deepEqual(s, { hits: 2, dealt: 30, maxKnock: 3, reacted: 1, statuses: ["Freeze"] });
});

test("monster names: family, species and tier", () => {
  assert.deepEqual(monsterParts("Character/NPC/Monster/Slime/Jelly/Jelly Cube/Jelly Cube 3"), { family: "Slime", species: "Jelly/Jelly Cube", tier: "3" });
  assert.deepEqual(monsterParts("Character/NPC/Monster/Construct/Scuttlebot/Scuttlebot/Scuttlebot Mk II"), { family: "Construct", species: "Scuttlebot", tier: "Mk II" });
  assert.deepEqual(monsterParts("Character/NPC/Monster/Fiend/Trojan/Trojan 2"), { family: "Fiend", species: "Trojan", tier: "2" });
  assert.deepEqual(monsterParts("Character/NPC/Monster/Construct/Tortodrone/Tortodrone"), { family: "Construct", species: "Tortodrone", tier: "" });
  const tree = monsterTree(["Character/NPC/Monster/Fiend/Trojan/Trojan 2", "Character/NPC/Monster/Fiend/Trojan/Trojan 1", "Character/NPC/Monster/Slime/Sloom/Sloom 3"]);
  assert.deepEqual([...tree.keys()], ["Fiend", "Slime"]);
  assert.deepEqual(tree.get("Fiend")!.get("Trojan")!.map(t => t.tier), ["1", "2"]);
});

test("sweep command line: kinds, filters and defaults", () => {
  const all = parseArgs([]);
  assert.ok(all.weapons && all.monsters && all.knight);
  assert.equal(all.out, ".scratch/sweep");
  assert.equal(all.workers, 1);
  const sw = parseArgs(["--weapons", "sword", "--limit", "5"]);
  assert.ok(sw.weapons!.test("Weapon/Sword/Calibur") && !sw.weapons!.test("Weapon/Bomb/Proto Bomb"));
  assert.equal(sw.monsters, null);
  assert.equal(sw.knight, false);
  assert.equal(sw.limit, 5);
  const m = parseArgs(["--monsters", "--redo-errors", "--knight"]);
  assert.ok(m.monsters!.test("anything"));
  assert.equal(m.redoErrors, true);
  assert.equal(m.redo, false);
  assert.equal(m.knight, true);
});

test("sweep file names are safe, stable and unique", () => {
  const a = slug("Weapon/Sword/Calibur"), b = slug("Weapon/Sword/Calibur (Dev)");
  assert.match(a, /^sword-calibur-[a-z0-9]+$/);
  assert.notEqual(a, b);
  assert.equal(a, slug("Weapon/Sword/Calibur"));
  assert.equal(groupOf("weapons", "Weapon/Handgun/Blaster"), "handgun");
  assert.equal(groupOf("monsters", "Character/NPC/Monster/Undead/Zombie/Droul/Droul 2"), "undead");
});

test("bind poses: nothing playing, or a clip that moves none of the nodes", () => {
  assert.equal(bindPose(null), null);
  assert.match(bindPose({ clip: null, targets: 0, matched: 0 })!, /bind pose/);
  assert.match(bindPose({ clip: "a.dat", targets: 10, matched: 0 })!, /moves none/);
  assert.equal(bindPose({ clip: "animation/common/blank.dat", targets: 1, matched: 0 }), null);
  assert.equal(bindPose({ clip: "a.dat", targets: 10, matched: 8 }), null);
});

test("weapon anomalies", () => {
  const run = { attacks: ["Swing 1"], projectiles: [], effects: ["particle/x.dat (failed)"], sounds: [], hits: [hit({ dealt: 0 })] };
  const r: WeaponRecord = { name: "Weapon/Handgun/X", kind: "Handgun", chargedName: "Charged", chain: run,
    charge: { ...run, attacks: ["Swing 1"], hits: [], full: false, pose: null }, shots: [{ label: "chain 1", pose: { clip: null, targets: 0, matched: 0 } }],
    console: ["boom"], problems: [] };
  const p = judgeWeapon(r);
  for (const want of ["chain 1: no animation (bind pose)", "chain: no projectile", "chain: zero damage", "chain: missing effect particle/x.dat",
    "charge: no hit on the dummy", "charge: never reached full charge", "charge: no charging pose", "charge: the charged attack never fired", "console: boom"]) {
    assert.ok(p.includes(want), `${want} in ${p.join(" | ")}`);
  }
  const ok: WeaponRecord = { name: "Weapon/Sword/Y", kind: "Sword", chargedName: null, chain: { attacks: ["A"], projectiles: [], effects: [], sounds: [], hits: [hit()] },
    shots: [{ label: "chain 1", pose: { clip: "a.dat", targets: 4, matched: 4 } }], console: [], problems: [] };
  assert.deepEqual(judgeWeapon(ok), []);
  // a combo that played one of its three swings, or whose steps never moved the knight
  const swing = (n: number, travel: number, blocked = false) => judgeWeapon({ ...ok,
    chain: { attacks: ["A", "B", "C"].slice(0, n), projectiles: [], effects: [], sounds: [], hits: [hit()], swings: 3, impulse: 3.25, travel, blocked } });
  assert.ok(swing(1, 0).includes("chain: 1 of its 3 swings played"));
  assert.ok(swing(3, 0).includes("chain: the knight moved 0.00 of its attacks' 3.25 units"));
  assert.deepEqual(swing(3, 3.1), []);
  // stopped against the dummy: the step's legitimate end
  assert.deepEqual(swing(3, 0.5, true), []);
});

test("a bomb's tap is an early release that fizzles: no projectile or hit is asked of it", () => {
  // the sweep once flagged every bomb "chain: no projectile" and "chain: no hit on the dummy": a
  // bomb has no basic attacks, so its tap plays the incomplete charged attack, as in the client
  const fizzle = "Weapon/Bomb/Parts/Base Interupt";
  const charged = { attacks: ["Weapon/Bomb/Parts/Base Charge"], projectiles: ["Bomb/Blast (Charged)"], effects: [], sounds: [], hits: [hit()], full: true, pose: "charge_bomb_hold.dat" };
  const bomb: WeaponRecord = { name: "Weapon/Bomb/Blast Bomb", kind: "Bomb", attackNames: [], chargedName: "Weapon/Bomb/Parts/Base Charge", incompleteName: fizzle,
    chain: { attacks: [fizzle], projectiles: [], effects: [], sounds: ["Custom/Weapons/Bomb, Fizzle"], hits: [] }, charge: charged, shots: [], console: [], problems: [] };
  assert.deepEqual(judgeWeapon(bomb), []);
  // a record from before the sweep wrote the attack names: judged by its kind
  assert.deepEqual(judgeWeapon({ ...bomb, attackNames: undefined, incompleteName: undefined }), []);
  // a tap that placed a bomb, struck, or played something else is still caught
  const placed = judgeWeapon({ ...bomb, chain: { ...bomb.chain!, attacks: ["Other"], projectiles: ["Bomb/Blast"], hits: [hit()] } });
  for (const want of [`tap: played Other, not its fizzle ${fizzle}`, "tap: an early release placed Bomb/Blast", "tap: an early release hit the dummy"])
    assert.ok(placed.includes(want), `${want} in ${placed.join(" | ")}`);
  assert.deepEqual(judgeWeapon({ ...bomb, chain: { ...bomb.chain!, attacks: [] } }), ["tap: no attack started"]);
});

test("monster anomalies", () => {
  const base: MonsterRecord = { name: "Character/NPC/Monster/Slime/X/X 1", passive: false, speed: 3, idle: "idle.dat", move: null, reactTime: 500, minReact: 0.1,
    forced: { name: "Bite", hits: [], projectiles: [], effects: [] }, live: { attacked: false, moved: 0 }, reacted: false, died: false, shots: [], console: [], problems: [] };
  const p = judgeMonster(base);
  for (const want of ["attack Bite: no hit and no projectile", "never attacks (left to its own behaviour)", "no hit reaction", "never dies"]) {
    assert.ok(p.includes(want), `${want} in ${p.join(" | ")}`);
  }
  // a monster that never reacts by its config is not flagged for it; a passive one is not asked to fight
  assert.ok(!judgeMonster({ ...base, minReact: 1 }).includes("no hit reaction"));
  assert.deepEqual(judgeMonster({ ...base, passive: true, move: "walk.dat" }), []);
  assert.deepEqual(judgeMonster({ name: "n", error: "never appeared (Agent)", shots: [], console: [], problems: [] }), ["sweep error: never appeared (Agent)"]);
  const dead = judgeMonster({ ...base, move: "w.dat", forced: { name: "Bite", hits: [hit({ to: "knight" })], projectiles: [], effects: [] }, live: { attacked: true, moved: 2 },
    reacted: true, died: true, removedAfter: 1.2, deathEffects: ["particle/death.dat"] });
  assert.deepEqual(dead, []);
});

test("monster sweep false alarms: parts, absent models, non-blows, peaceful behaviours, configs without clips", () => {
  const base: MonsterRecord = { name: "Character/NPC/Monster/Beast/Wolver/Wolver/Wolver 1", passive: false, speed: 3, idle: null, move: null, reactTime: 500, minReact: 0.1,
    forced: { name: "Character/NPC/Monster/Beast/Wolver/Bark", harms: false, hits: [], projectiles: [], effects: [] }, live: { attacked: false, moved: 0, aims: false, delay: 0, window: 12 },
    reacted: true, died: true, removedAfter: 1, deathEffects: ["particle/death.dat"],
    shots: [{ label: "idle", pose: { clip: null, targets: 0, matched: 0 } }], console: [], problems: [] };
  // a bark is no blow, a behaviour that aims none need not attack, a config without an idle or
  // a movement shows its model as it stands
  assert.deepEqual(judgeMonster(base), []);
  // but a blow that lands nothing, a behaviour that aims one and never does, are still caught
  const bad = judgeMonster({ ...base, forced: { ...base.forced!, harms: true }, live: { ...base.live!, aims: true } });
  assert.ok(bad.includes("attack Character/NPC/Monster/Beast/Wolver/Bark: no hit and no projectile"), bad.join(" | "));
  assert.ok(bad.includes("never attacks (left to its own behaviour)"), bad.join(" | "));
  // a script that waits past the window (a Crimson Hammer core's 14 s) is not caught out
  assert.deepEqual(judgeMonster({ ...base, live: { attacked: false, moved: 0, aims: true, delay: 30000, window: 22 } }), []);
  // a named idle that fails is still a bind pose
  assert.ok(judgeMonster({ ...base, idle: "idle.dat" }).includes("idle: no animation (bind pose)"));
  // a boss's part is not a monster; a model the install lacks cannot appear
  assert.deepEqual(judgeMonster({ name: "Character/NPC/Monster/Boss/Vanaduke/Part/Flame", part: "Orbital", shots: [], console: [], problems: [] }), []);
  assert.deepEqual(judgeMonster({ name: "Character/NPC/Monster/Beast/Lizardman/Hunter/Ironscale Hunter 1", error: "never appeared (Monster)", shots: [],
    console: ["Missing file in the install: character/npc/monster/lizardman/hunter/model_nrm-r1.dat"], problems: [] }), []);
});

test("monster sweep false alarms: status-only blows, chanceless auras, borrowed clips, stripped regions", () => {
  const base: MonsterRecord = { name: "Character/NPC/Monster/Construct/X/X 1", passive: false, speed: 3, idle: null, move: null, reactTime: 500, minReact: 0.1,
    model: "character/npc/monster/blastcore/model.dat", radius: 2,
    forced: { name: "Spaz", harms: true, hits: [], projectiles: [], effects: [] }, live: { attacked: true, moved: 1 },
    reacted: true, died: true, removedAfter: 1, deathEffects: ["particle/death.dat"], shots: [], console: [], problems: [] };
  const shock = { kind: "Shock", chance: 0.25, applied: false, duration: 3 }, curse = { kind: "Curse", chance: 0, applied: false, duration: 10 };
  // a status-only blow (a mecha knight's shock) lands with no health taken
  const statusOnly = hit({ to: "knight", amounts: {}, dealt: 0, statuses: [shock] });
  assert.deepEqual(judgeMonster({ ...base, forced: { ...base.forced!, hits: [statusOnly] } }), []);
  // a chanceless aura's ticks (a black kat's curse) are not a landed blow
  const aura = hit({ to: "knight", amounts: {}, dealt: 0, statuses: [curse] });
  assert.ok(judgeMonster({ ...base, forced: { ...base.forced!, hits: [aura] } }).includes("attack Spaz: no hit and no projectile"));
  // a blow that lands and takes nothing is still caught
  assert.ok(judgeMonster({ ...base, forced: { ...base.forced!, hits: [hit({ to: "knight", dealt: 0 })] } }).includes("attack Spaz: zero damage"));
  // a clip from another monster's folder that moves none of the model's nodes is the config's
  // pairing (a Crimson BossCore 3 playing the Roarmulus Twins' laser charge); its own is not
  const shot = (clip: string) => ({ label: "wind-up", pose: { clip, targets: 2, matched: 0 } });
  const landed = { ...base.forced!, hits: [hit({ to: "knight" })] };
  assert.deepEqual(judgeMonster({ ...base, forced: landed, shots: [shot("character/npc/monster/twingun/animations/animation_laser-start.dat")] }), []);
  assert.equal(judgeMonster({ ...base, forced: landed, shots: [shot("character/npc/monster/blastcore/animations/animation_guns-start.dat")] }).length, 1);
  // a stripped region's stand-in inside the attacker's own body (Vanaduke's seat and base
  // configs with a dark knight's slam) says nothing; one that reaches past it still must hit
  const slam = { ...base.forced!, name: "Sword Slam", guessReach: 1.7 };
  assert.deepEqual(judgeMonster({ ...base, radius: 1.75, forced: slam }), []);
  assert.ok(judgeMonster({ ...base, radius: 0.6, forced: slam }).includes("attack Sword Slam: no hit and no projectile"));
});

test("knight anomalies and the report", () => {
  assert.deepEqual(judgeKnight({ actions: [{ label: "death", playing: "idle", dead: false }, { label: "revive", playing: "idle", dead: false }], shots: [], console: [], problems: [] }),
    ["death: the knight did not fall"]);
  assert.deepEqual(tally([["missing effect particle/b.dat"], ["missing effect particle/c.dat", "hit 3 times"]]), [["missing effect …", 2], ["hit # times", 1]]);
  const md = reportMarkdown({ generated: "now", sheets: ["weapons-sword.png"], knight: null, monsters: [],
    weapons: [{ name: "Weapon/Sword/Y", chargedName: null, chain: { attacks: ["A"], projectiles: [], effects: [], sounds: [], hits: [hit()] }, shots: [], console: [], problems: [] }] });
  assert.match(md, /\| Sword\/Y \| 25 · kb 1\.5 \| - \| OK \|/);
  assert.match(md, /\[weapons-sword\.png\]\(sheets\/weapons-sword\.png\)/);
});
