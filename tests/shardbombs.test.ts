// Shard bombs (src/game/data.ts projectile, World.detonate): the bomb's timer strikes its
// blast and throws six shards (Bomb/Parts/Shard/Shard Base (Distance Check) bullets), which
// the world flies on the bomb's side, fanned out all round; each shard, where it stops,
// leaves a crystal (Shard Base (Timer)) that strikes when signalled, with its own damage.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { skDir } from "../tools/common.ts";

const SK_RSRC = join(skDir(), "rsrc");

test("spawnedProjectiles finds bullet and bomb spawns inside delays and conditions, and nothing else", async () => {
  const { spawnedProjectiles } = await import("../src/game/data.ts");
  const ref = (name: string) => ({ $class: "com.threerings.config.ConfigReference", name });
  const spawn = (name: string) => ({ $class: "com.threerings.tudey.config.ActionConfig$SpawnTransformedActor", actor: ref(name) });
  const delayed = (a: any) => ({ $class: "com.threerings.tudey.config.ActionConfig$Delayed", action: a });
  const tree = { $class: "com.threerings.tudey.config.ActionConfig$Compound", actions: [
    { $class: "x.DungeonActionConfig$DamageRegionFromPoint" }, delayed(spawn("Bomb/Parts/Shard/A")), delayed(spawn("Bomb/Parts/Shard/A")),
    delayed(spawn("Character/Lichen")),
  ] };
  assert.deepEqual(spawnedProjectiles(tree).map((r: any) => r.name), ["Bomb/Parts/Shard/A", "Bomb/Parts/Shard/A"]);
  // a conditional spawn whose classes the export dropped keeps only its actor
  assert.equal(spawnedProjectiles({ $class: "x.ActionConfig$Conditional", action: { actor: ref("Bomb/Parts/Shard/B") } })[0].name, "Bomb/Parts/Shard/B");
});

test("on the install: the Crystal Bomb throws six shards, each leaving a crystal that strikes",
  { skip: !existsSync(join(SK_RSRC, "config", "actor.dat")) }, async () => {
  const { GameData, SHARD_SIGNAL_MS } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const data = new GameData(nodeLoader());
  await data.preload("config/item.dat", "config/actor.dat", "config/attack.dat", "config/fire_action.dat");
  const w = (await data.weapon("Weapon/Bomb/Crystal Bomb"))!;
  const bomb = (await data.projectile(w.chargedAttack!.fires.find(f => f.spawn)!.spawn!.actor))!;
  assert.equal(bomb.kind, "Bomb");
  assert.ok(bomb.damage, "the blast strikes");
  assert.equal(bomb.spawns?.length, 6, "six shards");
  // its blast's visual is a FireEffect it still runs
  assert.ok(bomb.actions.some(a => /FireEffect$/.test(a.$class)));
  const shard = (await data.projectile(bomb.spawns![0]))!;
  assert.equal(shard.kind, "Bullet");
  assert.ok(shard.harmless, "the flying shard strikes nothing itself");
  assert.ok(Math.abs(shard.speed * shard.fuse / 1000 - 2) < 0.01, `it flies its Max Distance (${shard.speed} x ${shard.fuse} ms)`);
  assert.equal(shard.spawns?.length, 1, "it leaves a crystal");
  const crystal = (await data.projectile(shard.spawns![0]))!;
  assert.equal(crystal.kind, "Bomb");
  assert.equal(crystal.fuse, SHARD_SIGNAL_MS);
  assert.ok(crystal.damage && !crystal.harmless, "the crystal strikes");
  assert.ok(crystal.hitFx, "with its shatter transient");
  assert.ok(crystal.creationFx, "and lands with its slam");
  assert.ok(!crystal.spawns, "and throws nothing more");
});
