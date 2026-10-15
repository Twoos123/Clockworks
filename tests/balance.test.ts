// Thresholds and rules re-checked after the depth tables started evaluating (monsters with
// hundreds of health, defences on everything): see docs/research/combat-mechanics.md,
// "Balance audit", and tools/audit/balance.ts.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { hitDamage } from "../src/game/combat.ts";
import { zeroAmounts } from "../src/game/depth.ts";
import { defenseKind, performanceOf } from "../src/game/feedback.ts";
import { satisfied } from "../src/game/behavior.ts";
import { monsterBehavior } from "../src/game/monsterai.ts";
import { cursedSlots, ticksDamage } from "../src/game/status.ts";
import { innerStrike } from "../src/game/data.ts";

const am = (o: Partial<Record<"NORMAL" | "PIERCING" | "ELEMENTAL" | "SHADOW", number>>) => ({ ...zeroAmounts(), ...o });

test("a hit's damage rounds up (the wiki's weapon tables), float noise below a whole number counts as it", () => {
  // 49 against 20 normal defence: 39 exactly
  assert.equal(hitDamage(am({ NORMAL: 49 }), am({ NORMAL: 20 })), 39);
  // 155 against 123.75: 93.125, shown as 94
  assert.equal(hitDamage(am({ NORMAL: 155 }), am({ NORMAL: 123.75 })), 94);
  assert.equal(hitDamage(am({ NORMAL: 10.0000000001 }), null), 10);
  // never below 1
  assert.equal(hitDamage(am({ PIERCING: 5 }), am({ PIERCING: 1500 })), 1);
});

test("damage numbers: grey for the resisted type, blue for neutral and normal, brown for the weakness", () => {
  // a jelly: weak to shadow, strongly resists piercing (+1400), neutral elemental, normal like all
  const jelly = am({ NORMAL: 20, PIERCING: 1420, ELEMENTAL: 20, SHADOW: 10 });
  assert.equal(defenseKind(am({ NORMAL: 20 }), jelly), "NORMAL");
  assert.equal(defenseKind(am({ ELEMENTAL: 20 }), jelly), "NORMAL");
  assert.equal(defenseKind(am({ SHADOW: 20 }), jelly), "STRONG");
  assert.equal(defenseKind(am({ PIERCING: 20, NORMAL: 5 }), jelly), "WEAK");
  assert.equal(defenseKind(am({ NORMAL: 20 }), null), null);
  // a proto sword's normal hit on a depth-1 jelly loses half to its defence: still a plain hit
  assert.equal(performanceOf(10, 20, 40, defenseKind(am({ NORMAL: 20 }), jelly)).kind, "NORMAL");
});

test("health thresholds are shares of the monster's own health, whatever its size", () => {
  const agent = {} as any;
  const potion = { type: "Health" as const, health: 0.4 };
  // the same 30% left at depth 1 (40 health) and depth 28 (964)
  assert.equal(satisfied(potion, agent, null, { health: 12, maxHealth: 40 }), true);
  assert.equal(satisfied(potion, agent, null, { health: 290, maxHealth: 964 }), true);
  // 100 health left is no longer "hurt" at depth 28 just because it was a whole monster before
  assert.equal(satisfied(potion, agent, null, { health: 100, maxHealth: 120 }), false);
  assert.equal(satisfied(potion, agent, null, { health: 500, maxHealth: 964 }), false);
});

test("the gremlins' potion and self-destruct thresholds stay fractions", () => {
  const walk = (b: any, out: number[]) => {
    if (!b || typeof b !== "object") return out;
    if (b.type === "Health") out.push(b.health);
    for (const v of Object.values(b)) if (v && typeof v === "object") walk(v, out);
    return out;
  };
  for (const name of ["Character/NPC/Monster/Gremlin/Darkfang Thwacker", "Character/NPC/Monster/Gremlin/Ironclaw Scorcher"]) {
    const b = monsterBehavior({ name, attacks: ["Hammer Thwack", "Use Potion", "Self Destruct", "Torch", "Fire Bullet"], speed: 4, targetedSpeed: 4,
      melee: [true, false, false, true, false], reach: [1, 1, 1, 1, 6], radius: 0.45 } as any);
    const hs = walk(b, []);
    assert.ok(hs.length > 0, `${name} has health conditions`);
    for (const h of hs) assert.ok(h > 0 && h < 1, `${name}: ${h} is a share`);
  }
});

test("a curse bites on use (locked weapons), it does not tick; fire burns on its interval", () => {
  assert.equal(ticksDamage("Curse"), false);
  assert.equal(ticksDamage("Fire"), true);
  // minCurseWeapons 1 to maxCurseWeapons 4 by power, out of the knight's weapons
  assert.deepEqual(cursedSlots({}, 0, 3, () => 0.99), [0]);
  assert.equal(cursedSlots({}, 1, 3).length, 3);
  assert.equal(cursedSlots({ minCurseWeapons: 2, maxCurseWeapons: 2 }, 0.5, 4).length, 2);
  for (const s of cursedSlots({}, 0.6, 3)) assert.ok(s >= 0 && s < 3);
});

test("a fire action's own damage region is its strike (a lumber's slam), its stripped region leaves no shape", () => {
  const hit = innerStrike({ $class: "x.ActionConfig$Compound", actions: [
    { $class: "x.DungeonActionConfig$DamageRegionFromPoint", damage: { $class: "x.DamageConfig$Normal", amount: 5 } },
    { $class: "x.DungeonActionConfig$ImpartImpulse", impulseDealt: { translation: { x: 4 } } },
  ] });
  assert.ok(hit);
  assert.equal(hit!.damage.amount, 5);
  assert.equal(hit!.shape, null);
  assert.equal(hit!.impulseDealt.translation.x, 4);
  assert.equal(innerStrike({ $class: "x.DungeonActionConfig$DamageRegion", target: {}, damage: {} }), null);
});

const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
const haveInstall = existsSync(join(SK, "rsrc", "config", "depth_scale.dat"));

test("on the install: the Leviathan Blade and Proto Sword hit as the wiki's tables say, every stratum", { skip: !haveInstall }, async () => {
  const { BalanceAudit, LEVIATHAN_WIKI, PROTO_SWORD_WIKI, TIERS } = await import("../tools/audit/balance.ts");
  const audit = await new BalanceAudit().load();
  const jelly = (await audit.data.monster({ name: "Character/NPC/Monster/Slime/Jelly/Jelly Cube/Jelly Cube 1" }))!;
  let rows = 0, exact = 0;
  for (const [name, table] of [["Weapon/Sword/Leviathan Blade", LEVIATHAN_WIKI], ["Weapon/Sword/Proto Sword", PROTO_SWORD_WIKI]] as const) {
    const w = (await audit.data.weapon(name))!;
    for (const s of table) for (const [i, depth] of s.depths.entries()) {
      const ctx = audit.weaponCtx(w, { ...TIERS[3].loadout, level: 10 }, depth, "medium");
      const def = audit.monsterDefense(jelly, depth, "medium");
      const got = [w.attacks[0], w.attacks[2], w.chargedAttack!];
      const want = [s.swing[i], s.third[i], s.charge[i]];
      for (let j = 0; j < 3; j++) {
        const d = hitDamage((await audit.fireAmounts(got[j], ctx, 3))[0], def, ctx.bonus ?? 0);
        rows++;
        if (d === want[j]) exact++;
        assert.ok(Math.abs(d - want[j]) <= 1, `${name} depth ${depth} attack ${j}: ${d} vs the wiki's ${want[j]}`);
      }
    }
  }
  assert.ok(exact >= rows - 3, `${exact} of ${rows} exact`);
});

test("on the install: slams, charges and scuttlebot pellets deal their configs' damage; fake strikes none", { skip: !haveInstall }, async () => {
  const { BalanceAudit } = await import("../tools/audit/balance.ts");
  const audit = await new BalanceAudit().load();
  const ctx = { depth: 12, rarity: 0, difficulty: "medium" as const };
  const total = (a: any) => a.NORMAL + a.PIERCING + a.ELEMENTAL + a.SHADOW;
  const strongest = async (name: string) => {
    const m = (await audit.data.monster({ name: "Character/NPC/Monster/" + name }))!;
    let best = 0;
    for (const a of m.attacks) for (const x of await audit.fireAmounts(a, ctx, 13)) best = Math.max(best, total(x));
    return best;
  };
  // each well past the flat 10 normal these fell back to
  for (const n of ["Construct/Lumber/Lumber/Lumber 2", "Fiend/Trojan/Trojan 2", "Undead/Deadnaught/Deadnaught/Deadnought 2", "Construct/Scuttlebot/Scuttlebot/Scuttlebot Mk II"])
    assert.ok(await strongest(n) > 40, n);
  // the lumber's slam lands where its Attack Shape says, three units ahead
  const lumber = (await audit.data.monster({ name: "Character/NPC/Monster/Construct/Lumber/Lumber/Lumber 2" }))!;
  assert.equal(lumber.attacks[0].fires[0].shape?.forward, 3);
  // a gremlin's dodge carries "Fake Damage": a zero amount
  const gremlin = (await audit.data.monster({ name: "Character/NPC/Monster/Gremlin/Ironclaw Mender" }))!;
  const dodge = gremlin.attacks.find(a => /Dodge/.test(a.name))!;
  for (const f of dodge.fires) if (f.damage) assert.equal(total(audit.data.depth.damage(f.damage, ctx)), 0);
});
