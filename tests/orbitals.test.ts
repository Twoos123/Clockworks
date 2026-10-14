// Orbiting projectiles (src/game/orbitals.ts) and the diskgun and mixer configs that make
// them (src/game/data.ts: multi-spawn fire actions, orbital definitions).
import assert from "node:assert/strict";
import { test } from "node:test";
import { OrbitMotion, orbitOffset, readOrbit, spinAngle } from "../src/game/orbitals.ts";
import { AGENT_BULLET_FUSE, orbitalDef, prespawns, shutdownParts } from "../src/game/data.ts";

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const ref = (name: string, args: Record<string, unknown> = {}) => ({ $class: "com.threerings.config.ConfigReference", name, arguments: { $map: "ArgumentMap", entries: Object.entries(args) } });
const dmg = (name: string) => ({ $class: "x.DamageConfig$DepthScale", depthScale: ref(name) });
const region = (d: any, knock?: any) => ({ $class: "x.DungeonActionConfig$DamageRegionFromPoint", damage: d, impulseDealt: knock });
const effect = { $class: "tudey.config.ActionConfig$FireEffect", effect: ref("Basic") };

// Bullet/Handgun/Diskgun/Parts/Diskgun MKI (Orbital Bullet), as the install has it
const mki = {
  $class: "projectx.dungeon.config.DungeonActorConfig$OrbitalBullet", collisionMask: 137,
  shape: { $class: "ShapeConfig$Circle", radius: 0.2 }, outDuration: 870, orbitRadius: 0.333, alternateSpin: true, speed: 1.5, height: 1.1,
  handlers: [
    { $class: "tudey.config.HandlerConfig$Shutdown", action: { $class: "tudey.config.ActionConfig$Conditional", action: { $class: "tudey.config.ActionConfig$Compound", actions: [
      effect,
      { $class: "tudey.config.ActionConfig$Conditional", action: region(dmg("Handgun Base +10")), elseAction: region(dmg("Handgun Base +05")) },
    ] } } },
    { $class: "tudey.config.HandlerConfig$Intersection" },
  ],
  sprite: { model: ref("item/weapon/handgun/diskgun/part_disk.dat"), flagModels: [{ flag: "RETURNING", model: ref("item/weapon/handgun/diskgun/part_disk.dat", { Variant: "Returning" }) }] },
};

test("a spin turns speed revolutions a second, over whole-millisecond periods, backwards when negative", () => {
  near(spinAngle(1.5, 0), 0);
  near(spinAngle(1.5, 333), Math.PI * 2 * 333 / 666);
  near(spinAngle(1.5, 666), 0);
  near(spinAngle(-1.5, 333), -Math.PI * 2 * 333 / 666);
  assert.equal(spinAngle(0, 500), 0);
});

test("class defaults fill an orbital config's missing fields", () => {
  const o = readOrbit({}, "OrbitalBullet");
  assert.deepEqual(o.bullet, { flightSpeed: 8, outDuration: 750, lifespan: 1700, alternateSpin: false });
  assert.equal(o.follow, "NONE");
  const s = readOrbit({}, "Orbital");
  assert.equal(s.follow, "SOURCE");
  near(s.speed, 0.33); near(s.orbitRadius, 1);
  assert.equal(s.relative, false);
  const c = readOrbit({}, "CompoundOrbitalBullet");
  assert.deepEqual(c.second, { orbitRadius: 0.667, speed: -1.5, startingRotation: 0 });
});

test("a disk flies out along its aim, turns home after its out duration and fizzles at its lifespan", () => {
  const o = readOrbit(mki, "OrbitalBullet");
  const m = new OrbitMotion(o, 0, 0, 0, false);
  for (let i = 0; i < 52; i++) assert.equal(m.step(1 / 60, { x: 0, y: 0 }), null);
  // 8 units a second for 0.867 s
  near(m.cx, 8 * 52 / 60, 1e-6);
  assert.equal(m.returning, false);
  near(Math.hypot(m.x - m.cx, m.y - m.cy), 0.333);
  m.step(1 / 60, { x: 0, y: 0 });
  assert.equal(m.returning, true);
  // heading back to the shooter at the same speed, and sitting on it once there
  const before = m.cx;
  m.step(0.1, { x: 0, y: 0 });
  near(before - m.cx, 0.8, 1e-6);
  assert.equal(m.step(0.5, { x: 0, y: 0 }), null);
  // the 1700 ms lifespan (the class default) runs out as it reaches the shooter
  assert.equal(m.step(0.3, { x: 0, y: 0 }), "fizzle");
  near(m.cx, 0); near(m.cy, 0);
});

test("an alternating disk's odd twin spins the other way; spawn rotation turns the orbit", () => {
  const o = readOrbit(mki, "OrbitalBullet");
  const [ax, ay] = orbitOffset(o, 100, 1, 0, false);
  const [bx, by] = orbitOffset(o, 100, 1, 0, true);
  near(ax, bx); near(ay, -by);
  const [cx, cy] = orbitOffset(o, 0, 1, Math.PI / 2, false);
  near(cx, 0); near(cy, 1);
  // a plain orbital ignores its spawn rotation
  const plain = readOrbit({ speed: 1, orbitRadius: 1, startingRotation: Math.PI }, "Orbital");
  const [px, py] = orbitOffset(plain, 0, 1, Math.PI / 2, false);
  near(px, -1); near(py, 0);
});

test("a compound disk adds its second orbit", () => {
  const o = readOrbit({ orbitRadius: 1.2, speed: 0.667, secondOrbitRadius: 0.5, secondSpeed: 1, secondStartingRotation: Math.PI }, "CompoundOrbitalBullet");
  const [x, y] = orbitOffset(o, 0, 1.2, 0, false);
  near(x, 1.2 - 0.5); near(y, 0);
});

test("a satellite circles what it follows and is lost with it; a relative radius adds the source's", () => {
  const o = readOrbit({ speed: 1.5, orbitRadius: 0.667 }, "Orbital");
  const m = new OrbitMotion(o, 0, 0, 0, false, 0.2);
  near(m.radius, 0.667);
  assert.equal(m.step(0.1, { x: 5, y: 1 }), null);
  near(Math.hypot(m.x - 5, m.y - 1), 0.667);
  assert.equal(m.step(0.1, null), "lost");
  const rel = new OrbitMotion(readOrbit({ relativeRadius: true }, "Orbital"), 0, 0, 0, false, 0.2);
  near(rel.radius, 1.2);
});

test("multi-spawn fire actions give each disk its own spawn, offset and index", () => {
  const multi = { $class: "projectx.dungeon.config.DungeonActionConfig$MultiSpawnPrespawned", spawns: [
    { $class: "projectx.dungeon.config.DungeonActionConfig$SpawnTransformedPrespawned", actor: ref("A"), translation: { x: 0.2, y: 0 } },
    { $class: "projectx.dungeon.config.DungeonActionConfig$SpawnPrespawned", actor: ref("B"), rotation: 1, rotationVariance: 0.5 },
    { $class: "projectx.dungeon.config.DungeonActionConfig$SpawnPrespawned" },
  ] };
  const s = prespawns(multi);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0].translation, [0.2, 0]);
  assert.equal(s[0].index, 0);
  assert.equal(s[1].actor.name, "B");
  assert.equal(s[1].rotation, 1);
  assert.equal(s[1].variance, 0.5);
  assert.equal(s[1].index, 1);
  assert.equal(prespawns({ $class: "x.DungeonActionConfig$DamageRegionFromPoint" }).length, 0);
});

test("a disk's removal deals its outgoing or returning damage, and runs its sparks", () => {
  const parts = shutdownParts(mki.handlers[0].action);
  assert.equal(parts.out.damage.depthScale.name, "Handgun Base +05");
  assert.equal(parts.back.damage.depthScale.name, "Handgun Base +10");
  assert.equal(parts.other.length, 1);
  // one damage region without a branch serves both ways
  const single = shutdownParts({ $class: "x.ActionConfig$Compound", actions: [effect, region(dmg("Handgun Base +05"))] });
  assert.equal(single.out, single.back);
});

test("orbital definitions: disks, mixer cores and their satellites", () => {
  const disk = orbitalDef("MKI", mki, "OrbitalBullet");
  assert.equal(disk.kind, "Orbital");
  assert.equal(disk.damage.depthScale.name, "Handgun Base +05");
  assert.equal(disk.returnDamage.depthScale.name, "Handgun Base +10");
  assert.equal(disk.returnModel.arguments.entries[0][1], "Returning");
  assert.equal(disk.harmless, false);
  near(disk.height, 1.1);
  // Bullet/Handgun/Parts/Mixer/Parts/Mixer (Core Bullet): flies at 8, spawns two satellites
  const core = orbitalDef("Core", {
    $class: "tudey.config.ActorConfig$Agent", collisionMask: 129, speed: 8, shape: { radius: 0.2 },
    handlers: [{ $class: "tudey.config.HandlerConfig$Startup", action: { $class: "tudey.config.ActionConfig$Compound", actions: [
      { $class: "tudey.config.ActionConfig$SpawnActor", actor: ref("Sat", { "Starting Rotation": 0 }) },
      { $class: "tudey.config.ActionConfig$SpawnActor", actor: ref("Sat", { "Starting Rotation": Math.PI }) },
      effect,
    ] } }, { $class: "tudey.config.HandlerConfig$Timer" }],
  }, "Agent");
  assert.equal(core.kind, "Agent");
  assert.equal(core.speed, 8);
  assert.equal(core.fuse, AGENT_BULLET_FUSE);
  assert.equal(core.children.length, 2);
  assert.equal(core.startActions.length, 1);
  assert.equal(core.harmless, true);
  assert.equal(core.orbit, undefined);
  // the charged core has no speed of its own: ActorConfig Mobile's 6
  assert.equal(orbitalDef("Charged", { $class: "tudey.config.ActorConfig$Agent" }, "Agent").speed, 6);
});
