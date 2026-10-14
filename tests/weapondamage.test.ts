import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { dealt } from "../src/game/combat.ts";
import { DepthScales, type DepthContext } from "../src/game/depth.ts";

const P = "com.threerings.projectx.dungeon.config.DepthScaleConfig";
const direct = (name: string, path: string) => ({ $class: "com.threerings.config.Parameter$Direct", name, paths: [path] });
const args = (...e: [string, unknown][]) => ({ $map: "com.threerings.config.ArgumentMap", entries: e });
const derived = (name: string, base: string, ...e: [string, unknown][]) =>
  ({ $class: "com.threerings.config.DerivedConfig", name, base: { $class: "com.threerings.config.ConfigReference", name: base, arguments: args(...e) } });

// the shape of config/depth_scale.dat: DepthScaleConfig keeps its tree in `root`, and most named
// scales are DerivedConfigs of a parameterized base ("Sword Base +05" is Base/Damage Multiplier)
const LIB = [
  { $class: P, name: "Base/Constant", root: { $class: `${P}$Constant`, value: 0 }, parameters: [direct("Value", "root.value")] },
  { $class: P, name: "Base/Damage Multiplier", root: { $class: `${P}$Multiplier` },
    parameters: [direct("Scale", "root.scale"), direct("Multiplier", "root.multiplier")] },
  derived("Star 0", "Base/Constant", ["Value", 20]),
  derived("Star 5", "Base/Constant", ["Value", 49]),
  { $class: P, name: "Base/Rarity", root: { $class: `${P}$Rarity`, depthScales: ["Star 0", "Star 0", "Star 0", "Star 0", "Star 0", "Star 5"]
    .map(n => ({ $class: `${P}$ScaleReference`, depthScale: { name: n } })) } },
  derived("Sword Base", "Base/Rarity"),
  derived("Sword Base (Charged)", "Base/Damage Multiplier", ["Multiplier", 1.5], ["Scale", { name: "Sword Base" }]),
];

async function scales(list: any[]) {
  const d = new DepthScales({ importFile: async () => list } as any);
  await d.ready();
  return d;
}
const ctx = (rarity: number, depth = 1): DepthContext => ({ depth, rarity, difficulty: "medium" });

test("named depth scales are DerivedConfigs followed to their base, evaluated from root", async () => {
  const d = await scales(LIB);
  assert.equal(d.evaluate({ name: "Sword Base" }, ctx(0)), 20);
  assert.equal(d.evaluate({ name: "Sword Base" }, ctx(5)), 49);
  assert.equal(d.evaluate({ name: "Sword Base (Charged)" }, ctx(0)), 30);
  // a reference's own arguments reach the derived config's base, over the base's
  assert.equal(d.evaluate({ name: "Star 0", arguments: args(["Value", 7]) }, ctx(0)), 7);
});

test("a depth-scaled DamageConfig yields its amounts (charged and star-scaled)", async () => {
  const d = await scales(LIB);
  const swing = { $class: "x.DamageConfig$DepthScale", depthScale: { name: "Sword Base" } };
  const charged = { $class: "x.DamageConfig$DepthScale", depthScale: { name: "Sword Base (Charged)" } };
  const fire = { $class: "x.DamageConfig$DepthScaleMulti", type2: { name: "ELEMENTAL" }, depthScale: { name: "Sword Base" } };
  assert.deepEqual(d.damage(swing, ctx(0)), { NORMAL: 20, PIERCING: 0, ELEMENTAL: 0, SHADOW: 0 });
  assert.equal(d.damage(charged, ctx(0)).NORMAL, 30);
  assert.deepEqual(d.damage(fire, ctx(5)), { NORMAL: 24.5, PIERCING: 0, ELEMENTAL: 24.5, SHADOW: 0 });
});

// the same through the game's data path, on the install when it is present
const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
const haveInstall = existsSync(join(SK, "rsrc", "config", "depth_scale.dat"));

test("on the install: a 5-star elemental sword out-damages a proto sword on a jelly, and charges hit harder", { skip: !haveInstall }, async () => {
  const { GameData } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const data = new GameData(nodeLoader());
  await data.preload("config/item.dat", "config/actor.dat", "config/attack.dat", "config/fire_action.dat");
  await data.depth.ready();
  const jelly = (await data.monster({ name: "Character/NPC/Monster/Slime/Jelly/Jelly Cube/Jelly Cube 1" }))!;
  const at = ctx(0);
  const def = jelly.defense ? data.depth.defense(jelly.defense, at) : null;
  assert.ok(jelly.healthScale && data.depth.evaluate(jelly.healthScale, at) > 0, "the jelly's health scale evaluates");

  const proto = (await data.weapon("Weapon/Sword/Proto Sword"))!;
  const combuster = (await data.weapon("Weapon/Sword/Combuster"))!;
  assert.equal(proto.rarity, 0);
  assert.equal(combuster.rarity, 5);
  const hit = (w: typeof proto, a = w.attacks[0]) => data.depth.damage(a.fires.find(f => f.damage)!.damage, ctx(w.rarity));

  const p = hit(proto), c = hit(combuster);
  assert.ok(p.NORMAL > 0, "the proto sword deals its depth-scaled normal damage");
  assert.equal(p.ELEMENTAL, 0);
  assert.ok(c.ELEMENTAL > p.ELEMENTAL && c.ELEMENTAL > 0, "the Combuster deals elemental damage");
  assert.ok(dealt(c, def) > dealt(p, def), "the 5-star sword deals more to the jelly");

  // the charged attack's damage is its own config's scale: Sword Base (Charged), 1.5x the swing
  const charged = proto.chargedAttack!;
  const cfg = charged.fires.find(f => f.damage)!.damage;
  assert.equal(cfg.depthScale.name, "PC/Damage/Sword/Sword Base (Charged)");
  const ch = data.depth.damage(cfg, ctx(0));
  assert.equal(ch.NORMAL, data.depth.evaluate(cfg.depthScale, ctx(0)));
  assert.ok(Math.abs(ch.NORMAL - p.NORMAL * 1.5) < 1e-6, `charged ${ch.NORMAL} vs swing ${p.NORMAL}`);
  assert.ok(dealt(ch, def) > dealt(p, def));
});

test("a burst bullet passes its Damage, Color and Burst Scale to the bursts it leaves, Burst Count of them", async () => {
  const { burstTrail, BURST_INTERVAL } = await import("../src/game/data.ts");
  const spawn = { $class: "x.ActionConfig$SpawnActor", actor: { name: "Burst Trail", arguments: args(["Damage", "default"], ["Scale", "Medium"]) } };
  const bullet = { handlers: [{ $class: "x.HandlerConfig$Startup" },
    { $class: "x.HandlerConfig$Timer", action: { $class: "x.ActionConfig$Conditional", action: { $class: "x.ActionConfig$Compound", actions: [spawn] } } }] };
  // the stripped export: the parameter paths name a second action that is no longer there
  const base = { parameters: [
    direct("Damage", 'implementation.handlers[1].action.action.actions[1].actor["Damage"]'),
    direct("Burst Scale", 'implementation.handlers[1].action.action.actions[1].actor["Scale"]'),
    direct("Burst Count", "implementation.handlers[2].action.value.value")] };
  const dmg = { $class: "x.DamageConfig$DepthScale", depthScale: { name: "Sword Base" } };
  const t = burstTrail(bullet, { name: "Burst Bullet", arguments: args(["Damage", dmg], ["Burst Scale", "Large"], ["Burst Count", "5"]) }, base)!;
  assert.equal(t.count, 5);
  assert.equal(t.interval, BURST_INTERVAL);
  assert.equal(t.actor.name, "Burst Trail");
  assert.deepEqual(new Map(t.actor.arguments.entries), new Map<unknown, unknown>([["Damage", dmg], ["Scale", "Large"]]));
  // the spawn in the config is left as it was
  assert.equal(spawn.actor.arguments.entries[0][1], "default");
});

test("on the install: bullets, bombs and brandish bursts deal their configs' scaled damage", { skip: !haveInstall }, async () => {
  const { GameData } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const data = new GameData(nodeLoader());
  await data.preload("config/item.dat", "config/actor.dat", "config/attack.dat", "config/fire_action.dat");
  await data.depth.ready();
  const at = (w: { rarity: number }) => ctx(w.rarity);
  const shot = async (weapon: string, charged = false) => {
    const w = (await data.weapon(weapon))!;
    const a = charged ? w.chargedAttack! : w.attacks[0];
    const f = a.fires.find(x => x.spawn)!;
    return { w, f, p: (await data.projectile(f.spawn!.actor))! };
  };

  // a gun's bullet: its Damage argument, PC/Damage/Handgun/Handgun Base
  const gun = await shot("Weapon/Handgun/Blaster");
  assert.equal(gun.p.damage?.depthScale?.name, "PC/Damage/Handgun/Handgun Base");
  const g = data.depth.damage(gun.p.damage, at(gun.w));
  assert.equal(g.NORMAL, data.depth.evaluate({ name: "PC/Damage/Handgun/Handgun Base" }, at(gun.w)));
  assert.ok(g.NORMAL > 10);

  // a bomb's blast: its detonation region's damage
  const bomb = await shot("Weapon/Bomb/Blast Bomb", true);
  assert.equal(bomb.p.damage?.depthScale?.name, "PC/Damage/Bomb/Bomb Base");
  assert.ok(data.depth.damage(bomb.p.damage, at(bomb.w)).NORMAL > 10);

  // a shard bomb goes off through its Timer handler: that blast's damage
  const shard = await shot("Weapon/Bomb/Crystal Bomb", true);
  assert.equal(shard.p.harmless, false);
  const s = data.depth.damage(shard.p.damage, at(shard.w));
  assert.ok(s.ELEMENTAL + s.PIERCING > 0, JSON.stringify(s));
  assert.ok(!shard.p.actions.some(a => /\$(Delayed|Spawn)/.test(String(a.$class))), "its shard spawns are left out");

  // Acheron's charge: the Burst Bullet strikes nothing itself and leaves 5 large bursts, each
  // a bomb dealing the Damage the charge gave the bullet
  const burst = await shot("Weapon/Sword/Acheron", true);
  assert.equal(burst.p.name, "Bullet/Sword/Burst Bullet");
  assert.equal(burst.p.harmless, true);
  assert.equal(burst.p.trail?.count, 5);
  const given = (burst.f.spawn!.actor.arguments.entries as [string, any][]).find(([k]) => k === "Damage")![1];
  const trail = (await data.projectile(burst.p.trail!.actor))!;
  assert.equal(trail.kind, "Bomb");
  assert.deepEqual(trail.damage, given);
  assert.ok(Math.abs(trail.regionRadius - 1.2) < 1e-6, "a Large burst");
  const b = data.depth.damage(trail.damage, at(burst.w));
  assert.ok(b.SHADOW > 0 && b.NORMAL > 0, JSON.stringify(b));
});
