import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent, selfHealth, type Behavior, type BehaviorHost, type Seen, type Threat } from "../src/game/behavior.ts";
import { DODGE, monsterBehavior, tierOf, type MonsterInfo } from "../src/game/monsterai.ts";

/** An open floor with optional walls (x >= wallX blocked), foes, allies and an attack log. */
function world(opts: { foes?: Seen[]; allies?: Seen[]; attacks?: number; attackMs?: number; wallX?: number; threats?: Threat[]; rand?: () => number; mwa?: boolean } = {}) {
  const log: { i: number; at: number; rot: number }[] = [];
  let attackEnd = -1, now = 0;
  const hurt = new Map<number, { hits: number; damage: number }>();
  const foes = opts.foes ?? [], allies = opts.allies ?? [];
  const host: BehaviorHost = {
    rand: opts.rand ?? (() => 0.5),
    foes: () => foes, allies: () => allies,
    damage: id => hurt.get(id), damagers: () => [...hurt.keys()],
    path: (_ax, _ay, bx, by) => [[bx, by]],
    sees: () => true,
    threats: () => opts.threats ?? [],
    attackCount: () => opts.attacks ?? 4,
    canAttack: () => now >= attackEnd,
    attacking: () => now < attackEnd,
    attack: i => { if (now < attackEnd) return false; log.push({ i, at: now, rot: agent?.rotation ?? 0 }); attackEnd = now + (opts.attackMs ?? 300); return true; },
    stopAttack: () => { attackEnd = now; },
    moveWhileAttacking: () => !!opts.mwa,
  };
  let agent: Agent | null = null;
  const make = (cfg: Behavior, speed = 2, targeted = 3, turn = Math.PI * 4, x = 0, y = 0, rot = 0) => {
    agent = new Agent(host, cfg, speed, targeted, turn, 0.4, x, y, rot);
    return agent;
  };
  /** Runs the agent for ms milliseconds in 1/60 s ticks, moving it as it asks. */
  const run = (ms: number) => {
    const a = agent!;
    for (let t = 0; t < ms; t += 1000 / 60) {
      now += 1000 / 60;
      const m = a.tick(now, a.x, a.y, a.rotation);
      if (m.moving) {
        const nx = a.x + Math.cos(m.direction) * m.speed / 60, ny = a.y + Math.sin(m.direction) * m.speed / 60;
        if (opts.wallX !== undefined && nx >= opts.wallX) a.blocked(-1, 0);
        else { a.x = nx; a.y = ny; }
      }
    }
  };
  return { host, log, hurt, make, run, get now() { return now; } };
}

const foe = (x: number, y: number, id = 0): Seen => ({ id, x, y, radius: 0.33, health: 200, maxHealth: 200 });

test("Wander walks off after its evaluation, bounces off walls and heads home past its radius", () => {
  const w = world({ wallX: 2, rand: () => 0.5 });
  const a = w.make({ type: "Wander", evaluationInterval: 1, radius: 3 });
  w.run(300);
  assert.ok(a.x > 0.3, "it walks along its heading (direction change 0 at rand 0.5)");
  w.run(1500);
  assert.ok(a.x < 2, "the wall stops it");
  assert.ok(Math.abs(Math.cos(a.rotation) + 1) < 0.05, "and it turns back the way it came (a reflection off the wall)");
});

test("Targeting acquires a foe in its region, not one beyond, and runs its routine meanwhile", () => {
  const near = world({ foes: [foe(5, 0)] });
  const a = near.make({ type: "Targeting", acquireRadius: 8, targetAction: { type: "PathAttack" } });
  near.run(100);
  assert.equal(a.target?.id, 0);
  const far = world({ foes: [foe(20, 0)] });
  const b = far.make({ type: "Targeting", acquireRadius: 8, targetAction: { type: "PathAttack" } });
  far.run(100);
  assert.equal(b.target, null);
});

test("Targeting acquires whoever hurt it from beyond the region unless acquireDamagers is NEVER", () => {
  for (const [mode, expect] of [["ALWAYS", 0], ["NEVER", null]] as const) {
    const w = world({ foes: [foe(20, 0)] });
    w.hurt.set(0, { hits: 1, damage: 10 });
    const a = w.make({ type: "Targeting", acquireRadius: 8, acquireDamagers: mode, targetAction: { type: "PathAttack" } });
    w.run(100);
    assert.equal(a.target?.id ?? null, expect, mode);
  }
});

test("Targeting weighs hits and damage over distance (hitWeight, damageWeight, distanceWeight)", () => {
  const w = world({ foes: [foe(3, 0, 1), foe(7, 0, 2)] });
  const a = w.make({ type: "Targeting", acquireRadius: 10, targetAction: { type: "PathAttack" } });
  w.run(50);
  assert.equal(a.target?.id, 1, "the nearer by default");
  const v = world({ foes: [foe(3, 0, 1), foe(7, 0, 2)] });
  v.hurt.set(2, { hits: 3, damage: 60 });
  const b = v.make({ type: "Targeting", acquireRadius: 10, targetAction: { type: "PathAttack" } });
  selfHealth.set(b, { health: 100, maxHealth: 100 });
  v.run(50);
  assert.equal(b.target?.id, 2, "the one that hurt it");
});

test("PathAttack walks to within maxAttackDistance, then attacks facing its target, once a second", () => {
  const w = world({ foes: [foe(6, 2)] });
  const a = w.make({ type: "Targeting", targetAction: { type: "PathAttack", attacks: [2], maxAttackDistance: 0.85 } }, 2, 3);
  w.run(400);
  assert.equal(w.log.length, 0, "still too far");
  assert.ok(a.x > 0.3);
  w.run(3000);
  assert.ok(w.log.length >= 1);
  assert.equal(w.log[0].i, 2);
  const gap = Math.hypot(6 - a.x, 2 - a.y) - 0.73;
  assert.ok(gap <= 0.9, `gap ${gap}`);
  assert.ok(Math.abs(w.log[0].rot - Math.atan2(2 - a.y, 6 - a.x)) < 0.05, "snapped to face it (attackFacesTarget)");
  const gaps = w.log.slice(1).map((l, i) => l.at - w.log[i].at);
  assert.ok(gaps.every(g => g >= 999), "minAttackInterval 1000 ms between starts");
});

test("SimpleAttack turns at its turn rate and only fires once it faces the target", () => {
  const w = world({ foes: [foe(-5, 0)] });
  const a = w.make({ type: "Targeting", targetAction: { type: "SimpleAttack" } }, 0, 0, Math.PI / 2);
  w.run(1000);
  assert.equal(w.log.length, 0, "half way round after a second");
  w.run(1300);
  assert.equal(w.log.length, 1);
  assert.equal(a.x, 0, "a turret never moves");
});

test("TrackAttack backs off inside its minimum distance and fires from its band", () => {
  const w = world({ foes: [foe(1, 0)] });
  const a = w.make({ type: "Targeting", targetAction: { type: "TrackAttack", minAttackDistance: 3, maxAttackDistance: 6 } });
  w.run(2500);
  assert.ok(a.x < -1, `it retreated to ${a.x}`);
  assert.ok(w.log.length >= 1);
});

test("ChargeAttack winds up, runs straight at its speed and finishes with its charge attack", () => {
  const w = world({ foes: [foe(8, 0)], attackMs: 5000 });
  const a = w.make({ type: "Targeting", targetAction: { type: "ChargeAttack", attacks: [1], chargeAttacks: [3], warmup: 500, maxLength: 3000 } }, 6, 2);
  w.run(400);
  assert.deepEqual(w.log.map(l => l.i), [1], "the wind-up");
  assert.equal(a.x, 0, "standing during the warm-up");
  w.run(1600);
  assert.ok(a.x > 6, `ran at its untargeted speed to ${a.x}`);
  assert.equal(w.log[w.log.length - 1].i, 3, "and finished with the charge attack");
});

test("a charge that runs into a wall stops there and finishes", () => {
  const w = world({ foes: [foe(8, 0)], attackMs: 5000, wallX: 3 });
  const a = w.make({ type: "Targeting", targetAction: { type: "ChargeAttack", attacks: [0], chargeAttacks: [2], warmup: 0, maxLength: 3000 } }, 6, 2);
  w.run(1500);
  assert.ok(a.x < 3);
  assert.equal(a.run, null);
  assert.equal(w.log[w.log.length - 1].i, 2);
});

test("Scripted runs its steps: waits, attacks to their end, and Goto loops", () => {
  const w = world({ attackMs: 500 });
  w.make({ type: "Scripted", steps: [
    { $class: "tudey.config.ScriptConfig$Wait", wait: 1000 },
    { $class: "projectx.dungeon.config.DungeonScriptConfig$Attack", attack: 2 },
    { $class: "projectx.dungeon.config.DungeonScriptConfig$Attack" },
    { $class: "tudey.config.ScriptConfig$Goto" }] });
  w.run(4500);
  assert.deepEqual(w.log.map(l => l.i), [2, 0, 2, 0]);
  assert.ok(Math.abs(w.log[0].at - 1000) < 40, "after the first wait");
  assert.ok(Math.abs(w.log[1].at - 1500) < 40, "the next attack once the first has ended");
});

test("Dodging dodges a threat with an entry's attack, at most once per interval", () => {
  const threats = [{ x: 3, y: 0 }];
  const w = world({ threats });
  w.make({ type: "Dodging", minDodgeInterval: 1000, dodges: [{ attack: 3 }], behavior: { type: "Idle" } });
  w.run(100);
  assert.deepEqual(w.log.map(l => l.i), [3]);
  assert.ok(Math.abs(w.log[0].rot) < 1e-6, "turned to the threat first");
  w.run(1500);
  assert.equal(w.log.length, 1, "the same threat is not dodged twice");
  threats.push({ x: 0, y: 3 });
  w.run(100);
  assert.equal(w.log.length, 2);
});

test("a mender heals a wounded ally and otherwise flees", () => {
  const info: MonsterInfo = { name: "Character/NPC/Monster/Gremlin/Ironclaw Mender", speed: 4, targetedSpeed: 4,
    attacks: ["Generic/Dodge Back", "Generic/Dodge Back", "Generic/Dodge", "Healer/Heal (Target)", "Healer/Heal (Omni)"],
    melee: [true, true, true, true, true], reach: [1, 1, 1, 1, 1] };
  const hurtAlly = { id: 5, x: 8, y: 0, radius: 0.4, health: 50, maxHealth: 100 };
  const w = world({ foes: [foe(-2, 0)], allies: [hurtAlly] });
  const a = w.make(monsterBehavior(info), 4, 4);
  w.run(3000);
  assert.ok(w.log.some(l => l.i === 3 || l.i === 4), "it healed");
  assert.ok(a.x > 0.5, "going to the ally");
  hurtAlly.health = 100;
  const x = a.x;
  w.run(3000);
  assert.ok(a.x > x + 1, `then ran from the knight (to ${a.x})`);
});

test("the family table keeps barks, dodges and burrows out of a wolver's attacks", () => {
  const info: MonsterInfo = { name: "Character/NPC/Monster/Beast/Wolver/Wolver/Wolver 2", speed: 3.5, targetedSpeed: 4.5,
    attacks: ["Wolver/Bark", "Wolver/Dodge (Y)", "Wolver/Dodge (Y)", "Wolver/Dodge (X)", "Wolver/Bite, chain 1"],
    melee: [true, true, true, true, true], reach: [1, 1, 1, 1, 1] };
  const b = monsterBehavior(info);
  assert.equal(b.type, "Dodging");
  const s = JSON.stringify(b);
  assert.match(s, /"attacks":\[4\]/, "the bite is its attack");
  assert.ok(DODGE.test("Wolver/Dodge (X)"));
});

test("devilites throw from their spot, gun puppies are turrets, surviving scripts run as written", () => {
  const dev = monsterBehavior({ name: "Character/NPC/Monster/Fiend/Devilite/Devilite/Devilite 1", speed: 2, targetedSpeed: 3,
    attacks: ["Devilite/Dodge", "Devilite/Dodge", "Devilite/Dive Away", "Devilite/Cower", "Office Supplies/Book"],
    melee: [true, true, true, true, false], reach: [1, 1, 1, 1, 6] });
  assert.match(JSON.stringify(dev), /"type":"TrackAttack","attacks":\[4\]/);
  const pup = monsterBehavior({ name: "Character/NPC/Monster/Construct/Gun Puppy/Gun Puppy/Gun Puppy 1", speed: 0, targetedSpeed: 0,
    attacks: ["Construct/Gun Puppy"], melee: [false], reach: [6] });
  assert.match(JSON.stringify(pup), /SimpleAttack/);
  const steps = [{ $class: "tudey.config.ScriptConfig$Wait", wait: 5 }];
  assert.deepEqual(monsterBehavior({ name: "x", speed: 0, targetedSpeed: 0, attacks: [], melee: [], reach: [], script: steps }), { type: "Scripted", steps });
});

test("tiers come from the name", () => {
  assert.equal(tierOf("Character/NPC/Monster/Beast/Wolver/Wolver/Wolver 3"), 3);
  assert.equal(tierOf("Character/NPC/Monster/Construct/Mecha Knight/Sword/Mecha Knight Mk II"), 2);
  assert.equal(tierOf("Character/NPC/Monster/Slime/Jelly Cube (Intro)"), 1);
});
