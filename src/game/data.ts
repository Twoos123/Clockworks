// Gameplay definitions read from the install's config libraries: monsters (config/actor.dat),
// attacks (config/attack.dat), weapons and gear (config/item.dat), projectiles (bullets and
// bombs, also actors) and spawn tables (config/spawn_table.dat). The classes these use are
// game-specific, so their meaning is inferred from the data; field names follow what the
// exported configs contain. Damage stays as the raw DamageConfig, evaluated against depth
// and defence when it lands (see combat.ts).

import { applyArguments, getArg } from "../config/params";
import type { ModelLoader } from "../model";
import { DepthScales } from "./depth";

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

export interface AttackDef {
  name: string;
  start?: string;
  fire?: string;
  end?: string;
  startSpeed: number;
  fireSpeed: number;
  endSpeed: number;
  /** Milliseconds after firing until the attacker may move or chain (clear), and rearm. */
  clear: number;
  rearm: number;
  /** The DamageConfig of the attack's hit (melee) or null. */
  damage: any;
  /** Delay in ms after the fire animation starts before the hit or spawn. */
  delay: number;
  /** Melee hit shape, when the attack strikes directly. */
  shape: DamageShape | null;
  knockback: number;
  /** Particle model for the swing trail, from the fire animation's "Swing" argument. */
  swing?: any;
  /** Whether the attacker may cancel the follow-through by moving. */
  interruptable: boolean;
  /**
   * Movement the attack gives the attacker (ImpulseConfig$ItemImpulse "impulseReceived"):
   * units along its facing, spread over `duration` ms starting `delay` ms into the fire phase.
   */
  impulse: { forward: number; side: number; delay: number; duration: number } | null;
  /** An actor the attack spawns (a bullet or bomb), with its spread in radians. */
  spawn: { actor: any; variance: number; rotation: number } | null;
}

export interface MonsterDef {
  name: string;
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
  idle?: string;
  move?: string;
  moveSpeed: number;
  activation?: string;
  attacks: AttackDef[];
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
  /** Movement speed factor while attacking, or null when attacks root the knight. */
  attackingSpeed: number | null;
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
}

export interface ArmorDef { name: string; defense: any; rarity: number }

/** A bullet or bomb actor (DungeonActorConfig$Bullet or $Bomb). */
export interface ProjectileDef {
  name: string;
  kind: "Bullet" | "Bomb";
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
  regionRadius: number;
  knockback: number;
  /** Played where a bullet hits or a bomb goes off; a bullet that runs out fizzles. */
  hitFx: any;
  fizzleFx: any;
}

export class GameData {
  private libs = new Map<string, Promise<Map<string, any>>>();
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
    if (!a || kind(a) !== "Original") return null;
    const fire = (a.fireRefs ?? []).find((f: any) => f?.ref)?.ref;
    const kb = getArg(fire, "Knock-Back") as any;
    const actor = (getArg(fire, "Actor") ?? getArg(fire, "Bullet")) as any;
    const shapeArg = getArg(fire, "Shape");
    return {
      name: ref?.name ?? "",
      start: a.start?.name, fire: a.fire?.name, end: a.end?.name,
      startSpeed: a.startSpeed ?? 1, fireSpeed: a.fireSpeed ?? 1, endSpeed: a.endSpeed ?? 1,
      clear: a.clear ?? 400, rearm: a.rearm ?? 300,
      damage: getArg(fire, "Damage") ?? null,
      delay: Number(getArg(fire, "Delay") ?? 0),
      shape: actor?.name && !shapeArg ? null : readShape(shapeArg),
      knockback: kb?.translation?.x ?? 0.5,
      swing: getArg(a.fire, "Swing"),
      interruptable: !!a.interruptable,
      impulse: a.impulseReceived ? {
        forward: a.impulseReceived.translation?.x ?? 0, side: a.impulseReceived.translation?.y ?? 0,
        delay: a.impulseReceived.delay ?? 0, duration: a.impulseReceived.duration ?? 150,
      } : null,
      spawn: actor?.name ? { actor, variance: Number(getArg(fire, "Rotation Variance") ?? 0), rotation: Number(getArg(fire, "Rotation") ?? 0) } : null,
    };
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
    return {
      name: ref?.name ?? "",
      model: sprite.model,
      scale: sprite.scale ?? 1,
      radius: m.shape?.radius ?? 0.5,
      speed: m.speed ?? 2,
      targetedSpeed: m.targetedSpeed ?? m.speed ?? 2,
      health: m.health ?? 100,
      healthScale: m.healthScale ?? null,
      defense: m.defense ?? null,
      turnRate: m.turnRate ?? 180,
      idle: (sprite.targetedIdles ?? sprite.idles)?.[0]?.animation?.name,
      move: (sprite.targetedMovements ?? sprite.movements)?.[0]?.animation?.name,
      moveSpeed: (sprite.targetedMovements ?? sprite.movements)?.[0]?.speed ?? 2,
      activation: sprite.activation?.name,
      attacks: await this.attacks(m.attacks),
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
      attackingSpeed: w.attackingSpeed ?? null,
      targetingDist: w.targetingDist ?? 0,
      targetingAngle: w.targetingAngle ?? 0,
    };
  }

  async shield(name: string): Promise<ShieldDef | null> {
    const s = await this.resolve("config/item.dat", { name }, "item");
    if (!s?.model) return null;
    return { name, model: s.model, effect: s.effect, defendingSpeed: s.defendingSpeed ?? -0.5, icon: s.icon ?? null,
      regenTime: s.regenTime ?? 6000, breakTime: s.breakTime ?? 8000, hitTime: s.hitTime ?? 3000, breakEffect: s.breakEffect,
      healthScale: s.healthScale ?? null, defense: s.defense ?? null, rarity: s.rarity ?? 0 };
  }

  async armor(name: string): Promise<ArmorDef | null> {
    const a = await this.resolve("config/item.dat", { name }, "item");
    return a ? { name, defense: a.defense ?? null, rarity: a.rarity ?? 0 } : null;
  }

  /** A bullet or bomb actor, with the spawning attack's arguments applied. */
  async projectile(ref: any): Promise<ProjectileDef | null> {
    const p = await this.resolve("config/actor.dat", ref, "actor");
    const k = kind(p);
    if (k !== "Bullet" && k !== "Bomb") return null;
    const det = p.detonationAction;
    const region = det?.region?.shape;
    const transient = (t: any) => (getArg(t, "Transient") as any) ?? (t?.name?.endsWith(".dat") ? t : null);
    return {
      name: ref?.name ?? "", kind: k, model: p.model ?? null,
      speed: p.speed ?? 0, fuse: p.fuse ?? (k === "Bomb" ? 2000 : 500),
      radius: p.shape?.radius ?? 0.2,
      offset: [p.offset?.x ?? 0.5, p.offset?.y ?? 0], height: p.height ?? (k === "Bomb" ? 0 : 1),
      collisionMask: p.collisionMask ?? 1,
      damage: det?.damage ?? null,
      regionRadius: region?.radius ?? (k === "Bomb" ? 2 : 0.5),
      knockback: det?.impulseDealt?.translation?.x ?? 1,
      hitFx: transient(p.sprite?.destructionTransient),
      fizzleFx: transient(p.sprite?.fizzleTransient),
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

function findActorRef(o: any, depth = 0): any | null {
  if (!o || typeof o !== "object" || depth > 10 || ArrayBuffer.isView(o)) return null;
  if (o.$class === "com.threerings.config.ConfigReference" && typeof o.name === "string" && o.name.startsWith("Character/")) return o;
  if (o.$map) { for (const [, v] of o.entries) { const r = findActorRef(v, depth + 1); if (r) return r; } return null; }
  for (const k of Object.keys(o)) { if (k === "$outer") continue; const r = findActorRef(o[k], depth + 1); if (r) return r; }
  return null;
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
