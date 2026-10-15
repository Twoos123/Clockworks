// Balance audit: per depth tier, each monster family's health, defence and damage per attack
// against a typical loadout for that tier, and time-to-kill both ways (the knight killing one
// monster, one monster knocking out the knight). Everything comes from the install's configs
// through the game's own code paths (src/game/data.ts, depth.ts, combat.ts, economy.ts), so a
// change to those shows up here. See docs/research/combat-mechanics.md, "Balance audit".
//
// Usage: npx tsx tools/audit/balance.ts [difficulty: easy|medium|hard] [monster filter]
//
// Model (an estimate, not a simulation):
// - Knight damage: each sword swing's (or bullet's) depth-scaled damage at the weapon's star
//   rating, with its level's damage bonuses, against the monster's defence (dealt()).
// - Knight attack time: a sword combo takes the sum of each swing's land/startSpeed +
//   rearm/fireSpeed and the last swing's clear/endSpeed; a gun its clip the same way plus its
//   reload (the cooldown attack). TTK = health / (combo damage / combo time), always hitting.
// - Monster damage: each attack's hits (melee or the projectile it fires) against the knight's
//   armour and helmet defence. Its attack cycle is the attack's own length or the default
//   1 s between attack starts (TargetActionConfig SimpleAttack minAttackInterval), whichever
//   is longer. TTK = hits to empty the knight's health x that cycle, every attack landing.
import { GameData, type AttackDef, type MonsterDef, type WeaponDef } from "../../src/game/data.ts";
import { DAMAGE_MASK, DAMAGE_TYPES, zeroAmounts, type Amounts, type DepthContext, type Difficulty } from "../../src/game/depth.ts";
import { hitDamage, modifyDamage } from "../../src/game/combat.ts";
import { addItemBonuses, emptyBonuses, forWeapon } from "../../src/game/bonus.ts";
import { DIFFICULTY_SCALES } from "../../src/game/difficulty.ts";
import { ECONOMY_FILES, Economy } from "../../src/game/economy.ts";
import { nodeLoader } from "./nodevfs.ts";

export interface Loadout {
  label: string;
  sword: string; gun: string; armor: string; helm: string; shield: string;
  /** Item level (1 to 10) of every piece. */
  level: number;
}

/** A tier, the depths shown for it, and its typical loadout. */
export const TIERS: { tier: number; depths: number[]; loadout: Loadout }[] = [
  { tier: 1, depths: [1, 4, 7], loadout: { label: "proto (0*) lvl 1", sword: "Weapon/Sword/Proto Sword", gun: "Weapon/Handgun/Proto Gun",
    armor: "Gear/Armor/Parts/Proto (Base)", helm: "Gear/Helm/Parts/Proto (Base)", shield: "Gear/Shield/Proto Shield", level: 1 } },
  { tier: 1, depths: [4, 7], loadout: { label: "2* cobalt/calibur lvl 5", sword: "Weapon/Sword/Calibur", gun: "Weapon/Handgun/Blaster",
    armor: "Gear/Armor/Cobalt Armor", helm: "Gear/Helm/Cobalt Helm", shield: "Gear/Shield/Iron Buckler", level: 5 } },
  { tier: 2, depths: [8, 12, 17], loadout: { label: "3-4* mighty cobalt lvl 10", sword: "Weapon/Sword/Tempered Calibur", gun: "Weapon/Handgun/Valiance",
    armor: "Gear/Armor/Mighty Cobalt Armor", helm: "Gear/Helm/Mighty Cobalt Helm", shield: "Gear/Shield/Aegis", level: 10 } },
  { tier: 3, depths: [18, 24, 28], loadout: { label: "5* skolver/leviathan lvl 10", sword: "Weapon/Sword/Leviathan Blade", gun: "Weapon/Handgun/Polaris",
    armor: "Gear/Armor/Skolver Coat", helm: "Gear/Helm/Skolver Cap", shield: "Gear/Shield/Aegis", level: 10 } },
];

/** One representative per family and kind; "{t}" is the tier number in the config name. */
export const MONSTERS: string[] = [
  "Slime/Jelly/Jelly Cube/Jelly Cube {t}",
  "Beast/Wolver/Wolver/Wolver {t}",
  "Beast/Chromalisk/Chromalisk/Chromalisk {t}",
  "Construct/Gun Puppy/Gun Puppy/Gun Puppy {t}",
  "Construct/Retrode/Retrode/Retrode {t}",
  "Construct/Lumber/Lumber/Lumber {t}",
  "Construct/Scuttlebot/Scuttlebot/Scuttlebot Mk {m}",
  "Construct/Mecha Knight/Mecha Knight/Mecha Knight {t}",
  "Fiend/Devilite/Devilite/Devilite {t}",
  "Fiend/Greaver/Vanilla/Greaver {t}",
  "Fiend/Trojan/Trojan {t}",
  "Gremlin/{g} Thwacker",
  "Gremlin/{g} Mender",
  "Undead/Zombie/Dust Zombie/Dust Zombie {t}",
  "Undead/Spookat/Spookat/Spookat {t}",
  "Undead/Deadnaught/Deadnaught/Deadnought {t}",
];
const GREMLIN = ["", "Tenderfoot", "Ironclaw", "Darkfang"];
const MK = ["", "I", "II", "III"];

const KNIGHT_HEALTH = 200;
const MIN_ATTACK_INTERVAL = 1;

const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = (a: Amounts) => DAMAGE_TYPES.reduce((s, t) => s + a[t], 0) + (a.UNBLOCKABLE ?? 0);
const short = (a: Amounts) => DAMAGE_TYPES.filter(t => a[t] > 0.05).map(t => `${r1(a[t])}${t[0]}`).join("+") || "0";

export class BalanceAudit {
  readonly data: GameData;
  eco!: Economy;
  constructor(data = new GameData(nodeLoader())) { this.data = data; }

  async load() {
    await this.data.preload("config/item.dat", ...ECONOMY_FILES, "config/actor.dat", "config/attack.dat", "config/fire_action.dat");
    await this.data.depth.ready();
    this.eco = new Economy(f => this.data.library_(f));
    return this;
  }

  /** Monster health as World.spawnMonster sets it. */
  monsterHealth(def: MonsterDef, depth: number, difficulty: Difficulty) {
    const base = def.healthScale ? this.data.depth.evaluate(def.healthScale, { depth, rarity: 0, difficulty }) : def.health;
    return Math.max(1, Math.round((base || 100) * DIFFICULTY_SCALES[difficulty].monsterHealth));
  }

  monsterDefense(def: MonsterDef, depth: number, difficulty: Difficulty): Amounts | null {
    return def.defense ? this.data.depth.defense(def.defense, { depth, rarity: 0, difficulty }) : null;
  }

  /** The knight's health and armour defence for a loadout at a depth (World.updateKnightStats). */
  knight(l: Loadout, depth: number, difficulty: Difficulty) {
    const def = zeroAmounts();
    let health = KNIGHT_HEALTH;
    const bonuses = emptyBonuses();
    for (const n of [l.armor, l.helm, l.shield]) addItemBonuses(bonuses, this.data.resolveSync("config/item.dat", { name: n }, "item"));
    for (const n of [l.armor, l.helm]) {
      const item = this.data.resolveSync("config/item.dat", { name: n }, "item");
      const st = this.eco.info(n)?.heatable ? this.eco.levelStats(n, l.level, depth) : { defense: 0, health: 0 };
      health += st.health;
      if (!item?.defense) continue;
      const own = this.data.depth.defense(item.defense, { depth, rarity: item.rarity ?? 0, difficulty });
      for (const t of DAMAGE_TYPES) def[t] += own[t] > 0 ? own[t] + st.defense : 0;
    }
    health += bonuses.health;
    // the shield's health and defence (World.updateKnightStats; its level adds defence)
    const sh = this.data.resolveSync("config/item.dat", { name: l.shield }, "item");
    const sctx = { depth, rarity: sh?.rarity ?? 0, difficulty };
    const shield = sh ? Math.max(1, this.data.depth.evaluate(sh.healthScale, sctx) || 50) : 0;
    const shieldDefense = sh?.defense ? this.data.depth.defense(sh.defense, sctx) : zeroAmounts();
    return { health, defense: def, bonuses, shield, shieldDefense };
  }

  /** The attacker context of a knight's weapon (World.attackerCtx, without buffs). */
  weaponCtx(w: WeaponDef, l: Loadout, depth: number, difficulty: Difficulty, bonuses = emptyBonuses()): DepthContext {
    const st = this.eco.levelStats(w.name, l.level, depth);
    return { depth, rarity: w.rarity, difficulty, uncapped: st.uncapped, bonus: st.damage + forWeapon(bonuses.damage, w.kind) };
  }

  /** Damage amounts of one fire of an attack: its melee hit, or its projectile's blast. */
  async fireAmounts(a: AttackDef, ctx: DepthContext, mask = -1): Promise<Amounts[]> {
    const out: Amounts[] = [];
    for (const f of a.fires) {
      let dmg = f.damage;
      if (!dmg && f.spawn?.actor) dmg = (await this.data.projectile(f.spawn.actor).catch(() => null))?.damage ?? null;
      if (!dmg) continue;
      const am = this.data.depth.damage(dmg, ctx, undefined, mask);
      if (ctx.uncapped) for (const t of DAMAGE_TYPES) am[t] = modifyDamage(am[t], 1 + ctx.uncapped);
      out.push(am);
    }
    return out;
  }

  /** Seconds an attack occupies its attacker (land, rearm and clear at their speeds). */
  static attackTime(a: AttackDef, last = true) {
    return (a.land / a.startSpeed + a.rearm / a.fireSpeed + (last ? a.clear / a.endSpeed : 0)) / 1000;
  }

  /** A weapon's damage per second against a defence, over its combo (and a gun's reload). */
  async weaponDps(w: WeaponDef, ctx: DepthContext, defense: Amounts | null) {
    let damage = 0, time = 0, hits: number[] = [];
    const swings = w.kind === "Handgun" && w.maxChain ? Array.from({ length: w.maxChain }, (_, i) => w.attacks[Math.min(i, w.attacks.length - 1)]) : w.attacks;
    for (let i = 0; i < swings.length; i++) {
      const a = swings[i];
      for (const am of await this.fireAmounts(a, ctx, DAMAGE_MASK.MONSTER)) {
        const d = hitDamage(am, defense, ctx.bonus ?? 0);
        damage += d; hits.push(d);
      }
      time += BalanceAudit.attackTime(a, i === swings.length - 1);
    }
    if (w.cooldownAttack) time += BalanceAudit.attackTime(w.cooldownAttack);
    return { damage, time, hits, dps: time > 0 ? damage / time : 0 };
  }

  async row(name: string, depth: number, l: Loadout, difficulty: Difficulty) {
    const def = await this.data.monster({ name: "Character/NPC/Monster/" + name });
    if (!def) return null;
    const health = this.monsterHealth(def, depth, difficulty);
    const mdef = this.monsterDefense(def, depth, difficulty);
    const k = this.knight(l, depth, difficulty);
    const sword = (await this.data.weapon(l.sword))!, gun = (await this.data.weapon(l.gun))!;
    const s = await this.weaponDps(sword, this.weaponCtx(sword, l, depth, difficulty, k.bonuses), mdef);
    const g = await this.weaponDps(gun, this.weaponCtx(gun, l, depth, difficulty, k.bonuses), mdef);
    // the monster's attacks, its strongest landing every cycle
    const ctx: DepthContext = { depth, rarity: 0, difficulty };
    const attacks: { name: string; raw: Amounts; dealt: number; cycle: number }[] = [];
    for (const a of def.attacks) {
      for (const am of await this.fireAmounts(a, ctx, DAMAGE_MASK.KNIGHT)) {
        if (sum(am) <= 0) continue;
        attacks.push({ name: a.name.split("/").pop()!, raw: am, dealt: hitDamage(am, k.defense),
          cycle: Math.max(MIN_ATTACK_INTERVAL, BalanceAudit.attackTime(a)) });
      }
    }
    const worst = attacks.reduce<typeof attacks[number] | null>((b, x) => !b || x.dealt > b.dealt ? x : b, null);
    const hitsToKo = worst ? Math.ceil(k.health / worst.dealt) : Infinity;
    return {
      name, depth, health, defense: mdef, knightHealth: k.health, knightDefense: k.defense,
      sword: s, gun: g, swordHits: Math.ceil(health / Math.max(1, s.damage / Math.max(1, s.hits.length))),
      ttkSword: health / Math.max(1e-6, s.dps), ttkGun: health / Math.max(1e-6, g.dps),
      attacks, worst, hitsToKo, ttkKnight: worst ? hitsToKo * worst.cycle : Infinity,
    };
  }
}

/**
 * The wiki's Leviathan Blade table (wiki.spiralknights.com/Leviathan_Blade, "at its completed
 * level, without any UV or bonus"): hits 1-2, hit 3 and the charge, first to last floor of
 * each stratum, as damage numbers shown on monsters (so after a monster's normal defence).
 */
type WikiRow = { stratum: number; depths: [number, number]; swing: [number, number]; third: [number, number]; charge: [number, number] };
export const LEVIATHAN_WIKI: WikiRow[] = [
  { stratum: 1, depths: [1, 3], swing: [39, 45], third: [47, 54], charge: [64, 75] },
  { stratum: 2, depths: [5, 7], swing: [50, 54], third: [60, 67], charge: [86, 96] },
  { stratum: 3, depths: [9, 12], swing: [90, 92], third: [110, 114], charge: [155, 165] },
  { stratum: 4, depths: [14, 17], swing: [94, 95], third: [117, 121], charge: [171, 180] },
  { stratum: 5, depths: [19, 22], swing: [148, 180], third: [184, 224], charge: [267, 327] },
  { stratum: 6, depths: [24, 28], swing: [193, 203], third: [241, 258], charge: [355, 386] },
];

/** The same for the Proto Sword (wiki.spiralknights.com/Proto_Sword); its ranges run either way. */
export const PROTO_SWORD_WIKI: WikiRow[] = [
  { stratum: 1, depths: [1, 3], swing: [20, 26], third: [25, 33], charge: [35, 48] },
  { stratum: 2, depths: [5, 7], swing: [21, 19], third: [26, 23], charge: [41, 34] },
  { stratum: 3, depths: [9, 12], swing: [17, 16], third: [20, 19], charge: [29, 25] },
  { stratum: 4, depths: [14, 17], swing: [15, 14], third: [18, 17], charge: [24, 22] },
  { stratum: 5, depths: [19, 22], swing: [14, 13], third: [16, 15], charge: [21, 19] },
  { stratum: 6, depths: [24, 28], swing: [12, 11], third: [14, 13], charge: [18, 17] },
];

async function weaponCheck(audit: BalanceAudit, difficulty: Difficulty, name: string, table: WikiRow[]) {
  const w = (await audit.data.weapon(name))!;
  const jelly = (await audit.data.monster({ name: "Character/NPC/Monster/Slime/Jelly/Jelly Cube/Jelly Cube 1" }))!;
  const l = { ...TIERS[3].loadout, level: 10 };
  console.log(`\n== ${name.split("/").pop()} lvl 10 on a jelly's normal defence: ours vs the wiki (first-last floor of each stratum)`);
  for (const s of table) {
    const at = async (depth: number) => {
      const ctx = audit.weaponCtx(w, l, depth, difficulty);
      const def = audit.monsterDefense(jelly, depth, difficulty);
      const one = async (a: AttackDef | null) => a ? hitDamage((await audit.fireAmounts(a, ctx, DAMAGE_MASK.MONSTER))[0] ?? zeroAmounts(), def, ctx.bonus ?? 0) : 0;
      return [await one(w.attacks[0]), await one(w.attacks[2] ?? w.attacks[0]), await one(w.chargedAttack)];
    };
    const [a, b] = [await at(s.depths[0]), await at(s.depths[1])];
    console.log(`stratum ${s.stratum} (depth ${s.depths.join("-")}): swing ${a[0]}-${b[0]} (wiki ${s.swing.join("-")}), third ${a[1]}-${b[1]} (wiki ${s.third.join("-")}), charge ${a[2]}-${b[2]} (wiki ${s.charge.join("-")})`);
  }
}

/** Each boss at the depth of its level, its stages' health and the windows it takes. */
const BOSSES: { label: string; depth: number; tier: number; stages: string[]; window?: { what: string; seconds: number; cap?: number } }[] = [
  { label: "Snarbolax", depth: 7, tier: 1, stages: ["Boss/Snarbolax/Snarbolax"], window: { what: "bell stun", seconds: 8, cap: 1 / 3 } },
  { label: "Royal Jelly", depth: 7, tier: 1, stages: [1, 2, 4].map(n => `Boss/Royal Jelly (v2)/Royal Jelly (Stage ${n})`) },
  { label: "Roarmulus Twins (each)", depth: 17, tier: 2, stages: ["Boss/Roarmulus Twins/West", "Boss/Roarmulus Twins/West (2)", "Boss/Roarmulus Twins/West (3)"], window: { what: "exposed", seconds: 7 } },
  { label: "Vanaduke", depth: 28, tier: 3, stages: ["Boss/Vanaduke/Stage 1", "Boss/Vanaduke/Mask Stage 1", "Boss/Vanaduke/Stage 2", "Boss/Vanaduke/Mask Stage 2", "Boss/Vanaduke/Stage 3"], window: { what: "doused mask", seconds: 5 } },
];

async function bossCheck(audit: BalanceAudit, difficulty: Difficulty) {
  console.log("\n== Bosses: stage health and sword time-to-kill with the tier's best loadout (windows: hits only land then)");
  for (const b of BOSSES) {
    const l = [...TIERS].reverse().find(t => t.tier === b.tier)!.loadout;
    const sword = (await audit.data.weapon(l.sword))!;
    const k = audit.knight(l, b.depth, difficulty);
    for (const s of b.stages) {
      const def = await audit.data.monster({ name: "Character/NPC/Monster/" + s });
      if (!def) { console.log(`${s}: (no config)`); continue; }
      const hp = audit.monsterHealth(def, b.depth, difficulty);
      const dps = (await audit.weaponDps(sword, audit.weaponCtx(sword, l, b.depth, difficulty, k.bonuses), audit.monsterDefense(def, b.depth, difficulty))).dps;
      let line = `${b.label} d${b.depth} ${s.split("/").pop()}: ${hp} hp, sword ${r1(dps)}/s -> ${r1(hp / dps)}s of hitting`;
      if (b.window && (b.label !== "Vanaduke" || /Mask/.test(s))) {
        const per = Math.min(b.window!.cap ? hp * b.window!.cap : Infinity, dps * b.window!.seconds);
        line += `; ${Math.ceil(hp / per)} ${b.window!.what} windows of ${b.window!.seconds}s`;
      }
      console.log(line);
    }
  }
}

/** Status conditions at each tier's depths: damage over the condition against health. */
async function statusCheck(audit: BalanceAudit, difficulty: Difficulty) {
  await audit.data.preload("config/status_condition.dat");
  const { StatusConditions } = await import("../../src/game/status.ts");
  const sc = new StatusConditions(audit.data.library_("config/status_condition.dat"), audit.data.depth);
  console.log("\n== Status conditions (the Scaled configs, MODERATE power): per tick, interval, duration, total vs knight / monster health");
  for (const depth of [1, 7, 12, 17, 24, 28]) {
    const tier = depth < 8 ? 0 : depth < 18 ? 2 : 3;
    const l = TIERS[tier].loadout;
    const k = audit.knight(l, depth, difficulty);
    const jelly = (await audit.data.monster({ name: `Character/NPC/Monster/Slime/Jelly/Jelly Cube/Jelly Cube ${Math.max(1, tier)}` }))!;
    const mhp = audit.monsterHealth(jelly, depth, difficulty);
    const parts: string[] = [];
    for (const n of ["Fire (Scaled)", "Curse (Scaled)", "Shock (Scaled)", "Freeze (Scaled)", "Poison (Scaled)", "Sleep"]) {
      const got = sc.get({ name: n, arguments: { $map: "x", entries: [["Status Power", { $enum: "x", name: "MODERATE" }]] } }, { depth, rarity: 0, difficulty });
      if (!got) { parts.push(`${n}: -`); continue; }
      const d = got.def;
      if (d.kind === "Freeze") { parts.push(`freeze ice ${Math.round(d.ice)}, thaw ${Math.round(d.thaw)} (${Math.round(100 * d.thaw / mhp)}% jelly) (${r1(d.duration)}s)`); continue; }
      if (d.kind === "Sleep") { parts.push(`sleep regen ${Math.round(d.regen)}/${Math.round(d.playerRegen)} per ${r1(d.interval)}s`); continue; }
      if (d.kind === "Poison") { parts.push(`poison atk x${r1(d.attack)} def x${r1(d.defense)} (${r1(d.duration)}s)`); continue; }
      if (d.kind === "Curse") { parts.push(`curse ${Math.round(d.tickDamage)} a bite (${Math.round(100 * d.tickDamage / k.health)}% knight, ${Math.round(100 * d.tickDamage / mhp)}% jelly) for ${r1(d.duration)}s`); continue; }
      const ticks = d.kind === "Shock" ? 1 : Math.floor(d.duration / d.interval);
      const total = d.tickDamage * ticks;
      parts.push(`${d.kind.toLowerCase()} ${Math.round(d.tickDamage)}/${r1(d.kind === "Shock" ? d.spasmInterval : d.interval)}s x${r1(d.duration)}s = ${Math.round(total)} (${Math.round(100 * total / k.health)}% knight, ${Math.round(100 * total / mhp)}% jelly)`);
    }
    console.log(`d${depth} (knight ${k.health}, jelly ${mhp}): ${parts.join("; ")}`);
  }
}

/** The mender's heal and the revive's energy blast against a same-depth monster's health. */
async function supportCheck(audit: BalanceAudit, difficulty: Difficulty) {
  console.log("\n== Mender heal (its bomb's DepthScaleHeal: Monster/Damage/Attack Base, Omni +05) and the revive blast (Bomb Base by stars)");
  const revive = await audit.data.projectile({ name: "Bomb/Revive/Revive" });
  for (const depth of [1, 7, 12, 17, 24, 28]) {
    const tier = depth < 8 ? 1 : depth < 18 ? 2 : 3;
    const jelly = (await audit.data.monster({ name: `Character/NPC/Monster/Slime/Jelly/Jelly Cube/Jelly Cube ${tier}` }))!;
    const hp = audit.monsterHealth(jelly, depth, difficulty), def = audit.monsterDefense(jelly, depth, difficulty);
    const ctx = { depth, rarity: 0, difficulty };
    const heal = audit.data.depth.evaluate({ name: "Monster/Damage/Attack Base" }, ctx), omni = audit.data.depth.evaluate({ name: "Monster/Damage/Attack Base +05" }, ctx);
    const potion = audit.data.depth.evaluate({ name: "Monster/Heal/Heal Base +10" }, ctx);
    const blast = (stars: number) => revive?.damage ? hitDamage(audit.data.depth.damage(revive.damage, { ...ctx, rarity: stars }), def) : 0;
    console.log(`d${depth}: jelly ${hp} hp; mender heal ${Math.round(heal)} (${Math.round(100 * heal / hp)}%), omni ${Math.round(omni)} (${Math.round(100 * omni / hp)}%); gremlin potion ${Math.round(potion)} (${Math.round(100 * potion / hp)}%); revive blast 0* ${blast(0)}, 2* ${blast(2)}, 5* ${blast(5)} (${Math.round(100 * blast(5) / hp)}% of a jelly)`);
  }
}

async function main() {
  const difficulty = ((process.argv[2] ?? "medium") as Difficulty);
  const filter = (process.argv[3] ?? "").toLowerCase();
  const audit = await new BalanceAudit().load();
  console.log(`Balance audit, difficulty ${difficulty} (monster health x${DIFFICULTY_SCALES[difficulty].monsterHealth})`);
  if (!filter) {
    await weaponCheck(audit, difficulty, "Weapon/Sword/Leviathan Blade", LEVIATHAN_WIKI);
    await weaponCheck(audit, difficulty, "Weapon/Sword/Proto Sword", PROTO_SWORD_WIKI);
    await bossCheck(audit, difficulty);
    await statusCheck(audit, difficulty);
    await supportCheck(audit, difficulty);
  }
  for (const { tier, depths, loadout } of TIERS) {
    for (const depth of depths) {
      const k = audit.knight(loadout, depth, difficulty);
      console.log(`\n== Tier ${tier}, depth ${depth}: ${loadout.label}; knight ${k.health} hp, armour ${short(k.defense)}; shield ${Math.round(k.shield)} hp, ${short(k.shieldDefense)}`);
      console.log("monster".padEnd(26) + "hp".padStart(6) + "  defence".padEnd(18) + "sword/hit".padStart(10) + "  hits" + " ttk(sword)" + " ttk(gun)"
        + "  | worst attack (raw -> dealt)".padEnd(42) + "hits to KO  ttk(knight)");
      for (const pat of MONSTERS) {
        const name = pat.replace("{t}", String(tier)).replace("{g}", GREMLIN[tier]).replace("{m}", MK[tier]);
        if (filter && !name.toLowerCase().includes(filter)) continue;
        const r = await audit.row(name, depth, loadout, difficulty).catch(e => { console.log(`${name}: ${e}`); return null; });
        if (!r) { console.log(`${name}: (no config)`); continue; }
        const per = r.sword.hits.length ? r1(r.sword.damage / r.sword.hits.length) : 0;
        const w = r.worst ? `${r.worst.name.slice(0, 18)} ${short(r.worst.raw)} -> ${r.worst.dealt}` : "(no damaging attack)";
        console.log(name.split("/").pop()!.padEnd(26) + String(r.health).padStart(6) + "  " + (r.defense ? short(r.defense) : "-").padEnd(16)
          + String(per).padStart(10) + String(r.swordHits).padStart(6) + `${r1(r.ttkSword)}s`.padStart(11) + `${r1(r.ttkGun)}s`.padStart(9)
          + "  | " + w.padEnd(40) + String(r.hitsToKo).padStart(10) + `${r1(r.ttkKnight)}s`.padStart(13));
      }
    }
  }
}

// run as a script (imported by tests, it only exports)
if (/[\\/]balance\.ts$/.test(process.argv[1] ?? "")) await main();
