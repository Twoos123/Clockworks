// Gameplay definitions read from the install's config libraries: monsters (config/actor.dat),
// attacks (config/attack.dat), weapons and gear (config/item.dat), projectiles (bullets and
// bombs, also actors) and spawn tables (config/spawn_table.dat). The classes these use are
// game-specific, so their meaning is inferred from the data; field names follow what the
// exported configs contain. Damage stays as the raw DamageConfig, evaluated against depth
// and defence when it lands (see combat.ts).

import { applyArguments, getArg } from "../config/params";
import type { ModelLoader } from "../model";
import { readKnock, type Knock } from "./combat";
import { DepthScales } from "./depth";
import { resolveRef } from "./logic";
import { setItemResolver } from "./text";
import { descriptionBundle } from "./action";
import { readOrbit, type OrbitDef } from "./orbitals";

const kind = (o: any) => (o?.$class ?? "").substring((o?.$class ?? "").lastIndexOf("$") + 1);

export interface DamageShape {
  /** Hit box centre, in front of the attacker (attacker space, +x forward). */
  forward: number;
  side: number;
  /** Rectangle half-extents, or a circle radius when halfWidth is 0. */
  halfLength: number;
  halfWidth: number;
  radius: number;
}

/** One fire action of an attack: a melee hit (shape and damage) or a spawned bullet or bomb. */
export interface FireDef {
  delay: number;
  damage: any;
  shape: DamageShape | null;
  knockback: Knock;
  spawn: SpawnDef | null;
  /** The fire action's name (Base/Spawn Actor, a monster's own). */
  name?: string;
  /** A fire action that runs an action (a mender's heal spawns its heal bomb). */
  action?: any;
}

/**
 * An actor a fire action spawns: its reference, its rotation and spread in radians (the
 * client turns a spawn by up to half the spread either way), its offset from the attacker
 * (SpawnTransformedPrespawned: forward, side) and its place in a multi-spawn (the client
 * stamps each spawn with the next creation time, which picks an alternating disk's spin).
 */
export interface SpawnDef {
  actor: any;
  variance: number;
  rotation: number;
  translation?: [number, number];
  index?: number;
}

export interface AttackDef {
  name: string;
  /** Animation references (with arguments: the fire animation carries sound and effects). */
  start?: any;
  fire?: any;
  end?: any;
  startSpeed: number;
  fireSpeed: number;
  endSpeed: number;
  /**
   * AttackConfig timings in ms: the attack lands (fires) `land` after it starts, may fire
   * again `rearm` later, and clears (ends) `clear` after that; each part runs at its speed.
   */
  land: number;
  clear: number;
  rearm: number;
  /** The DamageConfig of the attack's hit (melee) or null. */
  damage: any;
  /** Delay in ms after the fire animation starts before the hit or spawn. */
  delay: number;
  /** Melee hit shape, when the attack strikes directly. */
  shape: DamageShape | null;
  knockback: Knock;
  /** Particle model for the swing trail, from the fire animation's "Swing" argument. */
  swing?: any;
  /** Whether the attacker may cancel the follow-through by moving. */
  interruptable: boolean;
  /**
   * Movement the attack gives the attacker (ImpulseConfig$ItemImpulse "impulseReceived"):
   * units along its facing, spread over `duration` ms starting `delay` ms into the attack;
   * a speed-modified impulse stretches with the attacker's status speed.
   */
  impulse: { forward: number; side: number; delay: number; duration: number; speedModified?: boolean } | null;
  /** An actor the attack spawns (a bullet or bomb), with its spread in radians. */
  spawn: SpawnDef | null;
  /** Upper-body attack (AttackConfig blended, true unless the config says otherwise). */
  blended: boolean;
  /** A Chain attack: the index of the attacker's attack that follows it. */
  chainTo: number | null;
  /** Every fire action, in order: its delay, melee hit or spawned actor. */
  fires: FireDef[];
  /** Shield bash: damage dealt once to each enemy touched during the attack's charge. */
  contact: { damage: any; knockback: Knock } | null;
  /** Shield bash: the share of the shield's health it costs (AttackConfig ShieldBash, 0.5). */
  bashHealthPct?: number;
}

export interface MonsterDef {
  name: string;
  /** The monster's name key in the monster bundle (its description config's dname, "n.blast_cube"). */
  nameKey: string | null;
  /**
   * The description's target-panel parts (DescriptionConfig.Monster): its family icon, the
   * damage type it is weak to and the one it deals ("NORMAL" when the export drops them).
   */
  descIcon?: string | null;
  weakness?: string;
  attackType?: string;
  model: any;
  scale: number;
  radius: number;
  speed: number;
  targetedSpeed: number;
  /** Health as a percentage of the depth-scaled health table, and that table. */
  health: number;
  healthScale: any;
  defense: any;
  turnRate: number;
  /** Animation references (their arguments, such as playback speed, apply). */
  idle?: any;
  move?: any;
  moveSpeed: number;
  activation?: any;
  /** A hit of at least this fraction of maximum health interrupts the monster for reactTime ms. */
  minReactPercent: number;
  reactTime: number;
  /** Impulses below this level do not move the monster (DungeonActorConfig impulseLevel). */
  impulseLevel: number;
  /** Played when the monster appears. */
  creationFx?: any;
  /** The model's own hit reaction and death animations (its "reacting" and "dying" mappings). */
  react?: any;
  dying?: any;
  /** Milliseconds the body stays after death (the dying animation's time). */
  deathTime: number;
  attacks: AttackDef[];
  /**
   * The attacks in the config's own order, null where one did not resolve: the behaviour
   * configs (and the scripts that survive) name attacks by this index.
   */
  slots: (AttackDef | null)[];
  /** DungeonActorConfig Monster size (MINI, SMALL, MEDIUM, LARGE; UNKNOWN by default). */
  size: string;
  /** DungeonActorConfig Monster moveWhileAttacking (false) and activateTime (0 ms). */
  moveWhileAttacking: boolean;
  activateTime: number;
  hitFx?: any;
  deathFx?: any;
  collisionFlags: number;
  /** Handlers such as loot drops. */
  handlers: any[];
}

export type WeaponKind = "Sword" | "Handgun" | "Bomb" | "Other";

export interface WeaponDef {
  name: string;
  kind: WeaponKind;
  model: any;
  attacks: AttackDef[];
  /** Milliseconds of holding the attack button to fully charge. */
  chargeTime: number;
  chargedAttack: AttackDef | null;
  /** Released before full charge (bombs drop a small one). */
  incompleteChargedAttack: AttackDef | null;
  /** The inventory icon (IconConfig), shown in the HUD's weapon slots. */
  icon: any;
  /** Star rating, 0 to 5; picks the depth-scale column for damage. */
  rarity: number;
  /** Attacks before the cooldown attack (a gun's clip); 0 for no limit. */
  maxChain: number;
  /** Milliseconds without firing after which a partly used chain restores. */
  chainCooldown: number;
  /** Played when the chain is spent: a gun's reload. */
  cooldownAttack: AttackDef | null;
  /** Movement speed factor during attacks (ItemConfig Weapon attackingSpeed, 1 by default). */
  attackingSpeed: number;
  /**
   * Whether the knight may walk and turn during its blended attacks (the client's
   * `Weapon.Vb`): never for swords, a handgun's `moveAndAttack` (true by default), always
   * for bombs and the rest.
   */
  moves: boolean;
  /**
   * Whether the combo loops back to the first attack after the last (`Weapon.Vc`): swords,
   * bombs and swinging handguns; plain handguns repeat their last attack instead.
   */
  cycles: boolean;
  /** Auto-targeting also while walking (ItemConfig Weapon targetingMoving, true by default). */
  targetingMoving: boolean;
  /** Movement factor while charging (ItemConfig Weapon chargingSpeed, 1 by default). */
  chargingSpeed: number;
  /** Auto-aim: distance and half-angle (degrees) within which attacks snap to a target. */
  targetingDist: number;
  targetingAngle: number;
}

export interface ShieldDef {
  name: string;
  model: any;
  /** The bubble shown while defending. */
  effect: any;
  /** Movement speed change while defending (-0.5 = half speed). */
  defendingSpeed: number;
  icon: any;
  /** Milliseconds a full shield takes to refill, once regeneration starts. */
  regenTime: number;
  /** Milliseconds a broken shield stays down. */
  breakTime: number;
  /** Milliseconds after a hit before the shield starts to regenerate. */
  hitTime: number;
  breakEffect: any;
  healthScale: any;
  defense: any;
  rarity: number;
  /** The shield bash (raise the shield with a full bar, then attack). */
  bash: AttackDef | null;
}

export interface ArmorDef {
  name: string;
  defense: any;
  rarity: number;
  /** The model the knight wears, or null to keep the body model's default. */
  model: any;
  icon: any;
  slot?: "armor" | "helmet";
}

/**
 * A bullet or bomb actor (DungeonActorConfig$Bullet or $Bomb), or an orbiting one: a disk
 * (OrbitalBullet, CompoundOrbitalBullet), a satellite following its source (Orbital,
 * RelativeOrbital), or a mixer's core (a plain ActorConfig$Agent that flies straight and
 * carries the satellites its startup spawns).
 */
export interface ProjectileDef {
  name: string;
  kind: "Bullet" | "Bomb" | "Orbital" | "Agent";
  model: any;
  /** Units per second; 0 for bombs. */
  speed: number;
  /** Milliseconds until a bullet fizzles or a bomb detonates. */
  fuse: number;
  radius: number;
  /** Spawn offset from the attacker (forward, side) and height above the ground. */
  offset: [number, number];
  height: number;
  collisionMask: number;
  /** DamageRegionFromPoint: damage, radius and knockback impulse. */
  damage: any;
  /** The detonation does no damage (it spawns, heals or signals). */
  harmless: boolean;
  /** The detonation's other logic actions, run where it goes off. */
  actions: any[];
  regionRadius: number;
  knockback: Knock;
  /** Played where a bullet hits or a bomb goes off; a bullet that runs out fizzles. */
  hitFx: any;
  fizzleFx: any;
  /** Orbitals: the orbit and flight (src/game/orbitals.ts). */
  orbit?: OrbitDef;
  /** A returning disk's damage and knockback (its Shutdown's other branch). */
  returnDamage?: any;
  returnKnockback?: Knock;
  /** The model a disk shows while returning (its sprite's RETURNING flag model). */
  returnModel?: any;
  /** Actors its startup spawns (a mixer core's satellites), which follow it. */
  children: any[];
  /** Other startup actions (sounds, sparks). */
  startActions: any[];
  /** Orbitals: played where it appears (a disk's whoosh, a core's shot sound). */
  creationFx?: any;
}

/**
 * How long a mixer core flies, in ms. Its timer is server data the client export strips;
 * the mixer disks that replaced the cores fly out for 990 ms (Bullet/Handgun/Diskgun/Parts/
 * Mixer (Orbital Bullet) outDuration), so the core is given the same reach.
 */
export const AGENT_BULLET_FUSE = 990;

export class GameData {
  private libs = new Map<string, Promise<Map<string, any>>>();
  private loaded = new Map<string, Map<string, any>>();
  readonly depth: DepthScales;
  constructor(private readonly loader: ModelLoader) {
    this.depth = new DepthScales(loader);
  }

  private library(file: string) {
    let p = this.libs.get(file);
    if (!p) {
      p = this.loader.importFile(file).then(root => {
        const list: any[] = Array.isArray(root) ? root : (root as any)?.array ?? [];
        return new Map(list.map(c => [c.name, c]));
      });
      this.libs.set(file, p);
    }
    return p;
  }

  /** Loads config libraries so the synchronous lookups below can use them. */
  async preload(...files: string[]) {
    for (const f of files) {
      const lib = await this.library(f);
      this.loaded.set(f, lib);
      if (f === "config/item.dat") setItemResolver(name => resolveRef(lib, { name }, "item"));
    }
  }

  /**
   * A DescriptionConfig (config/description.dat) through its derivations, arguments applied:
   * dname is its name key, title and description its other text, in the bundle its kind names.
   */
  /** The description config an actor names (its own description field, or one of the same name). */
  async actorDescription(name: string): Promise<{ dname: string; title: string; description: string } | null> {
    const impl = await this.resolve("config/actor.dat", { name }, "actor").catch(() => null);
    const ref = impl?.description ?? impl?.sprite?.description ?? impl?.property ?? null;
    return (ref ? await this.description(ref) : null) ?? (await this.description({ name }));
  }

  async description(ref: any): Promise<{ dname: string; title: string; description: string; icon: string | null; weakness: string; damage: string; bundle: string } | null> {
    if (!ref?.name) return null;
    const lib = await this.library("config/description.dat");
    let cfg: any = null, r = ref;
    for (let i = 0; i < 10 && r?.name; i++) {
      const base = lib.get(r.name);
      if (!base) return null;
      cfg = applyArguments(base, r);
      if (!String(cfg.$class ?? "").endsWith("DerivedConfig")) break;
      r = cfg.base;
    }
    const enumOf = (v: any): string => (typeof v === "string" ? v : v?.name) ?? "NORMAL";
    return cfg ? { dname: cfg.dname ?? "", title: cfg.title ?? "", description: cfg.description ?? "",
      icon: cfg.icon?.file ?? null, weakness: enumOf(cfg.weakness), damage: enumOf(cfg.damage), bundle: descriptionBundle(cfg.$class) } : null;
  }

  /** resolve() for a preloaded library, synchronously (game logic spawns immediately). */
  resolveSync(file: string, ref: any, field: string): any | null {
    const lib = this.loaded.get(file);
    return lib ? resolveRef(lib, ref, field) : null;
  }

  /** A preloaded library's configs by name. */
  library_(file: string): Map<string, any> { return this.loaded.get(file) ?? new Map(); }

  /** A library config by name, without arguments applied (preloaded libraries only). */
  config(file: string, name: string): any | null { return this.loaded.get(file)?.get(name) ?? null; }

  /** spawnActor() for a preloaded spawn table library. */
  spawnActorSync(tableRef: any, tier = 1): any | null {
    const lib = this.loaded.get("config/spawn_table.dat");
    if (!lib) return null;
    let ref = tableRef;
    for (let i = 0; i < 12 && ref?.name; i++) {
      if (ref.name.startsWith("Character/")) return ref;
      const base = lib.get(ref.name);
      if (!base) return null;
      const cfg = applyArguments(base, ref);
      const next = cfg.base ?? cfg.implementation?.table;
      const tiered = getArg(next, `Tier ${tier}`) ?? getArg(next, "Tier 1");
      if (tiered && (tiered as any).name) return tiered;
      // loot tables name items and pickups, not only monsters
      const actors = this.loaded.get("config/actor.dat");
      const actor = findActorRef(cfg, 0, actors ? (n: string) => actors.has(n) : undefined);
      if (actor) return actor;
      ref = next;
    }
    return null;
  }

  /** Follows Derived implementations (and DerivedConfig bases) applying arguments. */
  async resolve(file: string, ref: any, field: string): Promise<any | null> {
    const lib = await this.library(file);
    for (let i = 0; i < 12 && ref?.name; i++) {
      const base = lib.get(ref.name);
      if (!base) return null;
      const cfg = applyArguments(base, ref);
      if (cfg.$class?.endsWith("DerivedConfig")) { ref = cfg.base; continue; }
      const impl = cfg.implementation;
      if (impl?.$class?.endsWith("$Derived") && impl[field]) { ref = impl[field]; continue; }
      return impl ?? cfg;
    }
    return null;
  }

  async attack(ref: any): Promise<AttackDef | null> {
    const a = await this.resolve("config/attack.dat", ref, "attack");
    // a Chain attack is an Original that leads into another of the monster's attacks
    if (!a || (kind(a) !== "Original" && kind(a) !== "ShieldBash" && kind(a) !== "Chain")) return null;
    const contactAction = kind(a) === "ShieldBash" ? a.handler?.action : null;
    // every fire action: a burst fires several bullets at their own delays and angles, a
    // thrust both strikes and spawns
    const fires: FireDef[] = [];
    for (const f of (a.fireRefs ?? []) as any[]) {
      const fire = f?.ref;
      if (!fire) continue;
      const kb = getArg(fire, "Knock-Back") as any;
      const actor = (getArg(fire, "Actor") ?? getArg(fire, "Bullet")) as any;
      const shapeArg = getArg(fire, "Shape");
      const damage = getArg(fire, "Damage") ?? null;
      const spawn = actor?.name ? { actor, variance: Number(getArg(fire, "Rotation Variance") ?? 0), rotation: Number(getArg(fire, "Rotation") ?? 0) } : null;
      // "Fire Prefired" launches bullets spawned earlier in the attack; it hits nothing itself
      if (!spawn && /Prefired/.test(fire.name ?? "")) continue;
      const delay = Number(getArg(fire, "Delay") ?? 0);
      // a fire action that names its own spawns (the diskguns' and mixers' twin, triple and
      // quad disks: DungeonActionConfig MultiSpawnPrespawned, or one SpawnPrespawned)
      if (!spawn && !shapeArg) {
        const fa = await this.resolve("config/fire_action.dat", fire, "action");
        const own = prespawns(fa?.action);
        if (own.length) {
          for (const s of own) fires.push({ delay, damage: null, shape: null, knockback: 0, spawn: s, name: fire.name });
          continue;
        }
      }
      // "Base/Default" fire actions run an action of their own (a heal bomb, a raised corpse)
      const act = getArg(fire, "Action") as any;
      if (!spawn && !shapeArg && act?.$class && /ActionConfig\$/.test(String(act.$class))) {
        fires.push({ delay, damage: null, shape: null, knockback: 0, spawn: null, name: fire.name, action: act });
        continue;
      }
      // a fire action whose config does nothing (a lichen's merge) marks a moment the game's
      // own code acts on; it strikes nothing
      if (!spawn && !shapeArg && !damage) {
        const fa = await this.resolve("config/fire_action.dat", fire, "action");
        if (fa && !fa.action) { fires.push({ delay, damage: null, shape: null, knockback: 0, spawn: null, name: fire.name }); continue; }
      }
      const shape = !spawn || shapeArg ? readShape(shapeArg) : null;
      fires.push({ delay, damage: spawn && !shapeArg ? null : damage, shape, knockback: readKnock(kb), spawn, name: fire.name });
    }
    const primary = fires[0] ?? null;
    return {
      name: ref?.name ?? "",
      start: a.start?.name ? a.start : undefined, fire: a.fire?.name ? a.fire : undefined, end: a.end?.name ? a.end : undefined,
      startSpeed: a.startSpeed ?? 1, fireSpeed: a.fireSpeed ?? 1, endSpeed: a.endSpeed ?? 1,
      // AttackConfig Original defaults: land 350, rearm 83, clear 833 ms
      land: a.land ?? 350, clear: a.clear ?? 833, rearm: a.rearm ?? 83,
      damage: primary?.damage ?? null,
      delay: primary?.delay ?? 0,
      shape: primary ? primary.shape : readShape(undefined),
      knockback: primary?.knockback ?? 0,
      swing: getArg(a.fire, "Swing"),
      interruptable: !!a.interruptable,
      blended: a.blended !== false,
      chainTo: kind(a) === "Chain" && typeof a.attack === "number" ? a.attack : null,
      impulse: a.impulseReceived ? {
        forward: a.impulseReceived.translation?.x ?? 0, side: a.impulseReceived.translation?.y ?? 0,
        delay: a.impulseReceived.delay ?? 0, duration: Math.max(1, a.impulseReceived.duration ?? 0),
        speedModified: !!a.impulseReceived.speedModified,
      } : null,
      spawn: fires.find(f => f.spawn)?.spawn ?? null,
      fires: fires.length ? fires : [{ delay: 0, damage: null, shape: readShape(undefined), knockback: 0, spawn: null }],
      contact: contactAction ? { damage: contactAction.damage ?? null, knockback: readKnock(contactAction.impulseDealt) } : null,
      bashHealthPct: kind(a) === "ShieldBash" ? a.bashHealthPct ?? 0.5 : undefined,
    };
  }

  private async attackSlots(refs: any[] | undefined): Promise<{ attacks: AttackDef[]; slots: (AttackDef | null)[] }> {
    const slots: (AttackDef | null)[] = [];
    for (const r of refs ?? []) slots.push(r?.ref ? await this.attack(r.ref).catch(() => null) : null);
    return { attacks: slots.filter((a): a is AttackDef => !!a), slots };
  }

  private async attacks(refs: any[] | undefined): Promise<AttackDef[]> {
    const out: AttackDef[] = [];
    for (const r of refs ?? []) {
      const def = r?.ref ? await this.attack(r.ref) : null;
      if (def) out.push(def);
    }
    return out;
  }

  async monster(ref: any): Promise<MonsterDef | null> {
    const m = await this.resolve("config/actor.dat", ref, "actor");
    if (!m || !m.sprite?.model) return null;
    const sprite = m.sprite;
    const transient = (t: any) => (getArg(t, "Transient") as any) ?? (t?.name?.endsWith(".dat") ? t : undefined);
    // movements are single animations or quad sets (forward, back, left, right, as a knight's);
    // of several, the one made for the speed the monster chases at
    const chase = m.targetedSpeed ?? m.speed ?? 2;
    const movement = ((sprite.targetedMovements ?? sprite.movements ?? []) as any[]).filter(Boolean)
      .reduce((best: any, x: any) => !best || Math.abs((x.speed ?? 2) - chase) < Math.abs((best.speed ?? 2) - chase) ? x : best, null);
    const desc = await this.description(m.property).catch(() => null);
    return {
      name: ref?.name ?? "",
      nameKey: desc?.dname || null,
      descIcon: desc?.icon ?? null,
      weakness: desc?.weakness ?? "NORMAL",
      attackType: desc?.damage ?? "NORMAL",
      model: sprite.model,
      scale: sprite.scale ?? 1,
      radius: m.shape?.radius ?? 0.5,
      // ActorConfig Mobile speed and Monster targetedSpeed both default to 6
      speed: m.speed ?? 6,
      targetedSpeed: m.targetedSpeed ?? 6,
      health: m.health ?? 0,
      healthScale: m.healthScale ?? null,
      defense: m.defense ?? null,
      turnRate: m.turnRate ?? Math.PI,
      idle: refOf((sprite.targetedIdles ?? sprite.idles)?.[0]?.animation),
      move: refOf(movement?.animation ?? movement?.forward),
      moveSpeed: movement?.speed ?? 2,
      activation: refOf(sprite.activation),
      // DungeonActorConfig Monster defaults: react to any hit for 567 ms, die over 2467 ms
      minReactPercent: m.minReactPercent ?? 0,
      reactTime: m.reactTime ?? 567,
      deathTime: m.deathTime ?? 2467,
      impulseLevel: m.impulseLevel ?? 1,
      creationFx: sprite.creationTransient ?? undefined,
      ...await this.attackSlots(m.attacks),
      size: m.size?.name ?? "UNKNOWN",
      moveWhileAttacking: !!m.moveWhileAttacking,
      activateTime: m.activateTime ?? 0,
      hitFx: transient(sprite.hitTransient),
      deathFx: transient(sprite.destructionTransient),
      collisionFlags: m.collisionFlags ?? 8,
      handlers: m.handlers ?? [],
    };
  }

  async weapon(name: string): Promise<WeaponDef | null> {
    const w = await this.resolve("config/item.dat", { name }, "item");
    if (!w?.model) return null;
    const k = kind(w);
    return {
      name, model: w.model,
      kind: k === "Sword" ? "Sword" : k === "Handgun" || k === "SwingingHandgun" ? "Handgun" : k === "Bomb" ? "Bomb" : "Other",
      attacks: await this.attacks(w.attacks),
      chargeTime: w.chargeTime ?? 2000,
      chargedAttack: w.chargedAttack ? await this.attack(w.chargedAttack) : null,
      incompleteChargedAttack: w.incompleteChargedAttack ? await this.attack(w.incompleteChargedAttack) : null,
      icon: w.icon ?? null,
      rarity: w.rarity ?? 0,
      maxChain: w.maxChain ?? 0,
      chainCooldown: w.chainCooldown ?? 0,
      cooldownAttack: w.cooldownAttack ? await this.attack(w.cooldownAttack) : null,
      attackingSpeed: w.attackingSpeed ?? 1,
      chargingSpeed: w.chargingSpeed ?? 1,
      moves: k === "Sword" ? false : k === "Handgun" || k === "SwingingHandgun" ? w.moveAndAttack !== false : true,
      cycles: k !== "Handgun",
      targetingMoving: w.targetingMoving !== false,
      // ItemConfig Weapon defaults: auto-targeting within 3 units and a 90 degree cone
      targetingDist: w.targetingDist ?? 3,
      targetingAngle: w.targetingAngle ?? 90,
    };
  }

  async shield(name: string): Promise<ShieldDef | null> {
    const s = await this.resolve("config/item.dat", { name }, "item");
    if (!s?.model) return null;
    // ItemConfig Shield defaults: regenTime 5000, hitTime 2000, breakTime 7000, defendingSpeed 0
    return { name, model: s.model, effect: s.effect, defendingSpeed: s.defendingSpeed ?? 0, icon: s.icon ?? null,
      regenTime: s.regenTime ?? 5000, breakTime: s.breakTime ?? 7000, hitTime: s.hitTime ?? 2000, breakEffect: s.breakEffect,
      healthScale: s.healthScale ?? null, defense: s.defense ?? null, rarity: s.rarity ?? 0,
      bash: s.bash ? await this.attack(s.bash) : null };
  }

  async armor(name: string): Promise<ArmorDef | null> {
    const a = await this.resolve("config/item.dat", { name }, "item");
    return a ? { name, defense: a.defense ?? null, rarity: a.rarity ?? 0, model: a.model ?? null, icon: a.icon ?? null } : null;
  }

  /** A bullet or bomb actor, with the spawning attack's arguments applied. */
  async projectile(ref: any): Promise<ProjectileDef | null> {
    const p = await this.resolve("config/actor.dat", ref, "actor");
    const k = kind(p);
    if (/^(Orbital|RelativeOrbital|OrbitalBullet|CompoundOrbitalBullet|Agent)$/.test(k)) return orbitalDef(ref?.name ?? "", p, k);
    if (k !== "Bullet" && k !== "Bomb") return null;
    // the detonation: its damage region (a Compound may hold one beside other actions), and
    // whatever else it does (a lichen bomb spawns its colony, a marker activates monsters)
    const flat = (a: any, d = 0): any[] => !a || d > 6 ? [] : kind(a) === "Compound" ? (a.actions ?? []).flatMap((x: any) => flat(x, d + 1)) : [a];
    const acts = flat(p.detonationAction);
    const det = acts.find(a => /^DamageRegion/.test(kind(a))) ?? null;
    const region = det?.region?.shape;
    const transient = (t: any) => (getArg(t, "Transient") as any) ?? (t?.name?.endsWith(".dat") ? t : null);
    return {
      name: ref?.name ?? "", kind: k, model: p.sprite?.model ?? p.model ?? null,
      // Bullet: Mobile speed 6, fuse 1100, no offset or height; Bomb: fuse 2000
      speed: p.speed ?? (k === "Bullet" ? 6 : 0), fuse: p.fuse ?? (k === "Bomb" ? 2000 : 1100),
      radius: p.shape?.radius ?? 0.2,
      offset: [p.offset?.x ?? 0, p.offset?.y ?? 0], height: p.height ?? 0,
      collisionMask: p.collisionMask ?? 1,
      damage: det?.damage ?? null,
      harmless: !!p.detonationAction && !det,
      actions: acts.filter(a => a !== det && a?.$class),
      regionRadius: region?.radius ?? (k === "Bomb" ? 2 : 0.5),
      knockback: readKnock(det?.impulseDealt),
      hitFx: transient(p.sprite?.destructionTransient),
      fizzleFx: transient(p.sprite?.fizzleTransient),
      children: [], startActions: [],
    };
  }

  /**
   * Picks the actor a spawn table produces. Tables are layered derived configs whose
   * arguments name actors per tier; this takes the requested tier, else the first actor.
   */
  async spawnActor(tableRef: any, tier = 1): Promise<any | null> {
    const lib = await this.library("config/spawn_table.dat");
    let ref = tableRef;
    for (let i = 0; i < 12 && ref?.name; i++) {
      if (ref.name.startsWith("Character/")) return ref;
      const base = lib.get(ref.name);
      if (!base) return null;
      const cfg = applyArguments(base, ref);
      const next = cfg.base ?? cfg.implementation?.table;
      const tiered = getArg(next, `Tier ${tier}`) ?? getArg(next, "Tier 1");
      if (tiered && (tiered as any).name) return tiered;
      const actor = findActorRef(cfg);
      if (actor) return actor;
      ref = next;
    }
    return null;
  }
}

/** The first actor reference in a spawn table: a monster, or any name `isActor` accepts. */
function findActorRef(o: any, depth = 0, isActor?: (name: string) => boolean): any | null {
  if (!o || typeof o !== "object" || depth > 10 || ArrayBuffer.isView(o)) return null;
  if (o.$class === "com.threerings.config.ConfigReference" && typeof o.name === "string"
    && (o.name.startsWith("Character/") || isActor?.(o.name))) return o;
  if (o.$map) { for (const [, v] of o.entries) { const r = findActorRef(v, depth + 1, isActor); if (r) return r; } return null; }
  for (const k of Object.keys(o)) { if (k === "$outer") continue; const r = findActorRef(o[k], depth + 1, isActor); if (r) return r; }
  return null;
}

/**
 * An orbiting projectile's definition from its resolved actor config: its orbit, its removal
 * (Shutdown handler: the damage it deals, outgoing and returning, and its other actions), and
 * its startup (the satellites a mixer core spawns, and its sounds).
 */
export function orbitalDef(name: string, p: any, k: string): ProjectileDef {
  const transient = (t: any) => (getArg(t, "Transient") as any) ?? (t?.name?.endsWith(".dat") ? t : null);
  const handlers: any[] = p.handlers ?? [];
  const shut = shutdownParts(handlers.find(h => kind(h) === "Shutdown")?.action);
  const children: any[] = [], startActions: any[] = [];
  const startup = (a: any, d = 0) => {
    if (!a?.$class || d > 6) return;
    if (kind(a) === "Compound") { for (const x of a.actions ?? []) startup(x, d + 1); return; }
    if (/^Spawn(Rotated|Transformed)?Actor$/.test(kind(a))) { if (a.actor?.name) children.push(a.actor); return; }
    startActions.push(a);
  };
  for (const h of handlers) if (kind(h) === "Startup") startup(h.action);
  const sprite = p.sprite ?? {};
  const agent = k === "Agent";
  const region = (det: any) => det?.region?.shape?.radius ?? 0.5;
  return {
    name, kind: agent ? "Agent" : "Orbital",
    model: sprite.model ?? null,
    // ActorConfig Mobile speed 6
    speed: agent ? p.speed ?? 6 : 0,
    fuse: agent ? AGENT_BULLET_FUSE : Infinity,
    radius: p.shape?.radius ?? 0.2,
    offset: [0, 0], height: p.height ?? 0,
    collisionMask: p.collisionMask ?? 0,
    damage: shut.out?.damage ?? null,
    harmless: !shut.out,
    actions: shut.other,
    regionRadius: region(shut.out),
    knockback: readKnock(shut.out?.impulseDealt),
    hitFx: transient(sprite.destructionTransient),
    fizzleFx: transient(sprite.fizzleTransient),
    orbit: agent ? undefined : readOrbit(p, k),
    returnDamage: shut.back?.damage ?? null,
    returnKnockback: readKnock(shut.back?.impulseDealt),
    returnModel: (sprite.flagModels ?? []).find((f: any) => f?.flag === "RETURNING")?.model ?? null,
    children, startActions,
    creationFx: sprite.creationTransient ?? null,
  };
}

/**
 * The spawns of a prespawning fire action (DungeonActionConfig SpawnPrespawned and its
 * transformed form, or a MultiSpawnPrespawned of several), each with its rotation, spread,
 * offset and multi-spawn index.
 */
export function prespawns(action: any): SpawnDef[] {
  const k = kind(action);
  const list: any[] = k === "MultiSpawnPrespawned" ? action.spawns ?? []
    : /^SpawnPrespawned$|^SpawnTransformedPrespawned$/.test(k) ? [action] : [];
  return list.filter(s => s?.actor?.name).map((s, index) => ({
    actor: s.actor, variance: s.rotationVariance ?? 0, rotation: s.rotation ?? 0,
    translation: s.translation ? [s.translation.x ?? 0, s.translation.y ?? 0] as [number, number] : undefined,
    index,
  }));
}

/**
 * An orbital's removal (its Shutdown handler): the damage regions, split where a conditional
 * with an else branch picks between a returning disk's damage (its action) and an outgoing
 * one's (its else), and the other actions it runs (sounds and sparks).
 */
export function shutdownParts(action: any): { out: any | null; back: any | null; other: any[] } {
  const res = { out: null as any, back: null as any, other: [] as any[] };
  const walk = (a: any, branch: "out" | "back" | null, d: number) => {
    if (!a?.$class || d > 8) return;
    const k = kind(a);
    if (k === "Compound") { for (const x of a.actions ?? []) walk(x, branch, d + 1); return; }
    if (k === "Conditional") {
      if (a.elseAction) { walk(a.action, "back", d + 1); walk(a.elseAction, "out", d + 1); }
      else walk(a.action, branch, d + 1);
      return;
    }
    if (/^DamageRegion/.test(k)) {
      if (branch !== "back" && !res.out) res.out = a;
      if (branch !== "out" && !res.back) res.back = a;
      return;
    }
    res.other.push(a);
  };
  walk(action, null, 0);
  return res;
}

/** An animation reference, kept whole when it names a file (its arguments matter). */
function refOf(r: any): any {
  return r?.name?.endsWith(".dat") ? r : undefined;
}

function readShape(s: any): DamageShape {
  const t = s?.transform?.translation;
  const inner = s?.shape ?? s;
  const k = kind(inner);
  const base: DamageShape = { forward: t?.x ?? 0.8, side: t?.y ?? 0, halfLength: 0, halfWidth: 0, radius: 0.9 };
  if (k === "Rectangle") return { ...base, halfLength: (inner.width ?? 1) / 2, halfWidth: (inner.height ?? 1) / 2 };
  if (k === "Circle") return { ...base, radius: inner.radius ?? 1 };
  return base;
}
