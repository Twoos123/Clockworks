// Gameplay definitions read from the install's config libraries: monsters (config/actor.dat),
// attacks (config/attack.dat), weapons (config/item.dat) and spawn tables
// (config/spawn_table.dat). The classes these use are game-specific, so their meaning is
// inferred from the data; field names follow what the exported configs contain.

import { applyArguments, getArg } from "../config/params";
import type { ModelLoader } from "../model";

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
  /** Milliseconds after firing until the attacker may move or chain (clear), land, rearm. */
  clear: number;
  rearm: number;
  damage: number;
  /** Delay in ms after the fire animation starts before damage is applied. */
  delay: number;
  shape: DamageShape;
  knockback: number;
  /** Particle model for the swing trail, from the fire animation's "Swing" argument. */
  swing?: any;
}

export interface MonsterDef {
  name: string;
  model: any;
  scale: number;
  radius: number;
  speed: number;
  targetedSpeed: number;
  health: number;
  turnRate: number;
  idle?: string;
  move?: string;
  moveSpeed: number;
  activation?: string;
  attacks: AttackDef[];
  hitFx?: any;
  deathFx?: any;
  collisionFlags: number;
}

export interface WeaponDef {
  name: string;
  model: any;
  attacks: AttackDef[];
  /** Milliseconds of holding the attack button to fully charge. */
  chargeTime: number;
  chargedAttack: AttackDef | null;
}

export interface ShieldDef {
  name: string;
  model: any;
  /** The bubble shown while defending. */
  effect: any;
  /** Movement speed change while defending (-0.5 = half speed). */
  defendingSpeed: number;
}

export class GameData {
  private libs = new Map<string, Promise<Map<string, any>>>();
  constructor(private readonly loader: ModelLoader) {}

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
    const damage = getArg(fire, "Damage");
    const shape = getArg(fire, "Shape") as any;
    const kb = getArg(fire, "Knock-Back") as any;
    return {
      name: ref?.name ?? "",
      start: a.start?.name, fire: a.fire?.name, end: a.end?.name,
      startSpeed: a.startSpeed ?? 1, fireSpeed: a.fireSpeed ?? 1, endSpeed: a.endSpeed ?? 1,
      clear: a.clear ?? 400, rearm: a.rearm ?? 300,
      damage: damageAmount(damage),
      delay: Number(getArg(fire, "Delay") ?? 0),
      shape: readShape(shape),
      knockback: kb?.translation?.x ?? 0.5,
      swing: getArg(a.fire, "Swing"),
    };
  }

  async monster(ref: any): Promise<MonsterDef | null> {
    const m = await this.resolve("config/actor.dat", ref, "actor");
    if (!m || !m.sprite?.model) return null;
    const sprite = m.sprite;
    const attacks: AttackDef[] = [];
    for (const r of m.attacks ?? []) {
      const def = r?.ref ? await this.attack(r.ref) : null;
      if (def) attacks.push(def);
    }
    const transient = (t: any) => (getArg(t, "Transient") as any) ?? (t?.name?.endsWith(".dat") ? t : undefined);
    return {
      name: ref?.name ?? "",
      model: sprite.model,
      scale: sprite.scale ?? 1,
      radius: m.shape?.radius ?? 0.5,
      speed: m.speed ?? 2,
      targetedSpeed: m.targetedSpeed ?? m.speed ?? 2,
      health: m.health ?? 100,
      turnRate: m.turnRate ?? 180,
      idle: (sprite.targetedIdles ?? sprite.idles)?.[0]?.animation?.name,
      move: (sprite.targetedMovements ?? sprite.movements)?.[0]?.animation?.name,
      moveSpeed: (sprite.targetedMovements ?? sprite.movements)?.[0]?.speed ?? 2,
      activation: sprite.activation?.name,
      attacks,
      hitFx: transient(sprite.hitTransient),
      deathFx: transient(sprite.destructionTransient),
      collisionFlags: m.collisionFlags ?? 8,
    };
  }

  async weapon(name: string): Promise<WeaponDef | null> {
    const w = await this.resolve("config/item.dat", { name }, "item");
    if (!w?.model) return null;
    const attacks: AttackDef[] = [];
    for (const r of w.attacks ?? []) {
      const def = r?.ref ? await this.attack(r.ref) : null;
      if (def) attacks.push(def);
    }
    const chargedAttack = w.chargedAttack ? await this.attack(w.chargedAttack) : null;
    return { name, model: w.model, attacks, chargeTime: w.chargeTime ?? 2000, chargedAttack };
  }

  async shield(name: string): Promise<ShieldDef | null> {
    const s = await this.resolve("config/item.dat", { name }, "item");
    if (!s?.model) return null;
    return { name, model: s.model, effect: s.effect, defendingSpeed: s.defendingSpeed ?? -0.5 };
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

function damageAmount(d: any): number {
  switch (kind(d)) {
    case "Normal": case "Piercing": case "Elemental": case "Shadow": return d.amount ?? 20;
    case "Compound": return (d.damages ?? []).reduce((s: number, x: any) => s + damageAmount(x), 0) || 20;
    // depth-scaled damage depends on dungeon depth tables; use a tier-1 baseline
    case "DepthScale": case "DepthScaleMulti": return d.majorReact ? 45 : 30;
    default: return 20;
  }
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
