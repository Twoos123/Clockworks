// The slimes the Test Range sweep flagged: the ice cube (its roundhouse, its self-freezing
// timer, its model) and the Jelly Green Giant (its size and when it attacks).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Agent, type BehaviorHost, type Seen } from "../src/game/behavior.ts";
import { regionStrike } from "../src/game/data.ts";
import { Entity, Logic, type LogicHost } from "../src/game/logic.ts";
import { monsterBehavior } from "../src/game/monsterai.ts";
import { missingFile } from "../src/vfs.ts";

const T = "com.threerings.tudey.config.", D = "com.threerings.projectx.dungeon.config.";
const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
const haveInstall = existsSync(join(SK, "rsrc", "config", "actor.dat"));
const ICE_CUBE = "Character/NPC/Monster/Slime/Jelly/Ice Cube/Ice Cube 1";
const GIANT = "Character/NPC/Monster/Slime/Jelly Green Giant";

test("a fire action's region strike: the stripped conditional's else branch, its parameter-set shape around the attacker", () => {
  const strike = (damage: string) => ({ $class: D + "DungeonActionConfig$DamageRegionFromPoint", damage: { name: damage },
    impulseDealt: { translation: { x: 1.5, y: 0 }, duration: 250 }, region: { shape: { $class: "com.threerings.tudey.shape.config.ShapeConfig$Circle", radius: 1.3 } } });
  const s = regionStrike({ $class: T + "ActionConfig$Conditional", action: strike("plain"), elseAction: strike("frozen") })!;
  assert.equal(s.damage.name, "frozen");
  assert.deepEqual(s.shape, { forward: 0, side: 0, halfLength: 0, halfWidth: 0, radius: 1.3 });
  // one aimed at a target, a kept condition, or a region without a shape is not a strike
  assert.equal(regionStrike({ ...strike("x"), target: { $class: T + "TargetConfig$Activator" } }), null);
  assert.equal(regionStrike({ $class: T + "ActionConfig$Conditional", condition: { $class: T + "ConditionConfig$Always" }, elseAction: strike("x") }), null);
  assert.equal(regionStrike({ ...strike("x"), region: {} }), null);
});

test("an actor's timer that would disable the actor behind a stripped condition never fires; others still do", () => {
  const ran: string[] = [];
  const host: LogicHost = {
    createActor(ref) {
      const e = new Entity(true, ref.name);
      e.handlerConfigs = ref.handlers;
      return e;
    },
    actorDestroyed() {}, fireEffect() {},
    gameAction(cfg) { ran.push(String(cfg.$class).split("$").pop()!); return true; },
    disablesSelf: a => a?.$class?.endsWith("ApplyStatus") && /Freeze/.test(a.condition?.name ?? ""),
  };
  const logic = new Logic(host);
  const cond = (action: any) => ({ $class: T + "ActionConfig$Conditional", action });
  const timer = (action: any) => ({ $class: T + "HandlerConfig$Timer", action: cond(action) });
  logic.spawn({ name: "ice cube", handlers: [timer({ $class: D + "DungeonActionConfig$ApplyStatus", condition: { name: "Freeze 3" } })] }, 0, 0, 0, null, null);
  logic.spawn({ name: "mender", handlers: [timer({ $class: D + "DungeonActionConfig$DepthScaleHeal" })] }, 0, 0, 0, null, null);
  for (let i = 0; i < 25; i++) logic.tick(100);
  assert.deepEqual(ran, ["DepthScaleHeal", "DepthScaleHeal"]);
});

test("a missing install file is reported in the console once, with its path", () => {
  const seen: string[] = [];
  const orig = console.error;
  console.error = (m: string) => { seen.push(m); };
  try {
    missingFile("particle/mesh/freeze/skinhalf.png");
    missingFile("/particle/mesh/freeze/skinhalf.png");
    assert.throws(() => { throw missingFile("particle/mesh/shockwave/testsmoke.png"); }, /Missing file/);
  } finally { console.error = orig; }
  assert.deepEqual(seen, ["Missing file in the install: particle/mesh/freeze/skinhalf.png", "Missing file in the install: particle/mesh/shockwave/testsmoke.png"]);
});

/** Runs a behaviour against a knight standing `gap` units (edge to edge) away; the first attack's time and gap. */
function firstAttack(radius: number, reach: number[], attacks: string[], gap: number): { at: number; gap: number } | null {
  const b = monsterBehavior({ name: GIANT, attacks, speed: 0.5, targetedSpeed: 1, melee: attacks.map(() => true), reach, radius });
  let now = 0, end = -1;
  const knight: Seen = { id: 0, x: radius + 0.33 + gap, y: 0, radius: 0.33, health: 100, maxHealth: 100 };
  let hit = null as { at: number; gap: number } | null;
  const host: BehaviorHost = {
    rand: () => 0.5, foes: () => [knight], allies: () => [], damage: () => undefined, damagers: () => [],
    path: (_ax, _ay, bx, by) => [[bx, by]], sees: () => true, threats: () => [], attackCount: () => attacks.length,
    canAttack: () => now >= end, attacking: () => now < end,
    attack: () => { if (now < end) return false; hit ??= { at: now, gap: Math.hypot(knight.x - a.x, knight.y - a.y) - radius - 0.33 }; end = now + 2000; return true; },
    stopAttack: () => { end = now; }, moveWhileAttacking: () => false,
  };
  const a = new Agent(host, b, 0.5, 1, 5.24, radius, 0, 0, 0);
  for (; now < 10000 && !hit; now += 1000 / 60) {
    const m = a.tick(now, a.x, a.y, a.rotation);
    if (m.moving) { a.x += Math.cos(m.direction) * m.speed / 60; a.y += Math.sin(m.direction) * m.speed / 60; }
  }
  return hit;
}

test("the Jelly Green Giant strikes from within its own wide reach, a jelly cube from a cube's distance", () => {
  const atk = ["Character/NPC/Monster/Slime/Jelly Roundhouse", "Character/NPC/Monster/Slime/Jelly Spin"];
  // the giant: radius 1, its roundhouse and spin reaching 2.2 edge to edge (World.brainOf)
  const giant = firstAttack(1, [2.2, 2.2], atk, 4)!;
  assert.ok(giant, "it attacks");
  assert.ok(giant.gap > 1.5 && giant.gap <= 2.2, `from inside its reach, well back (${giant.gap.toFixed(2)})`);
  assert.ok(giant.at < 2500, `after walking ~2 units at 1 a second (${giant.at.toFixed(0)} ms)`);
  // a jelly cube still closes to 0.85
  const cube = firstAttack(0.4, [1.6], atk.slice(0, 1), 4)!;
  assert.ok(cube.gap <= 0.86, `a cube's tackle distance (${cube.gap.toFixed(2)})`);
});

test("on the install: the ice cube's roundhouse strikes around it and freezes, and its model's files exist", { skip: !haveInstall }, async () => {
  const { GameData } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const loader = nodeLoader();
  const data = new GameData(loader);
  await data.preload("config/actor.dat", "config/attack.dat", "config/fire_action.dat");
  const ice = (await data.monster({ name: ICE_CUBE }))!;
  const round = ice.slots[0]!;
  assert.equal(round.name, "Character/NPC/Monster/Slime/Jelly Roundhouse (Ice)");
  // its "Damage Region" (Medium: a 1.3 circle) and "Damage Frozen" (piercing and Freeze)
  assert.equal(round.shape?.radius ?? 0, 1.2999999523162842);
  assert.ok(round.fires[0].damage, "the hit carries damage");
  assert.match(JSON.stringify(round.fires[0].damage), /"name":"Freeze"/);
  assert.equal(typeof round.knockback === "object" ? round.knockback.distance : round.knockback, 1.5);
  // its Timer's stripped-condition action freezes itself (so World.disablesSelf holds it back)
  const { StatusConditions } = await import("../src/game/status.ts");
  await data.preload("config/status_condition.dat");
  await data.depth.ready();
  const conditions = new StatusConditions(data.library_("config/status_condition.dat"), data.depth);
  const timer = ice.handlers.find((h: any) => /\$Timer$/.test(h?.$class ?? ""));
  assert.equal(conditions.get(timer.action.action.condition, { depth: 1, rarity: 0, difficulty: "medium" })?.def.kind, "Freeze");
  // the model: the blast cube's ice variant, every texture it draws with on the install
  assert.equal(ice.model.name, "character/npc/monster/blastcube/model_ice.dat");
  const model = (await loader.loadRef(ice.model))!;
  assert.ok(model.parts.length >= 3);
  const missing: string[] = [];
  const walk = (m: typeof model) => {
    for (const p of m.parts) for (const pass of p.material.passes) for (const u of pass.units) if (u.texture && !existsSync(join(SK, "rsrc", u.texture))) missing.push(u.texture);
    for (const a of m.attachments) walk(a.model);
  };
  walk(model);
  assert.deepEqual(missing, []);
});

test("on the install: the Jelly Green Giant's Circle takes the default radius, 1", { skip: !haveInstall }, async () => {
  const { GameData } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const data = new GameData(nodeLoader());
  await data.preload("config/actor.dat", "config/attack.dat", "config/fire_action.dat");
  const giant = (await data.monster({ name: GIANT }))!;
  assert.equal(giant.radius, 1);
  const cube = (await data.monster({ name: "Character/NPC/Monster/Slime/Jelly/Jelly Cube/Jelly Cube 1" }))!;
  assert.equal(cube.radius, 0.4000000059604645);
});
