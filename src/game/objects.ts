// Dungeon objects whose behaviour is closed game code, written here from their configs
// (config/actor.dat DungeonActorConfig classes) and the wiki's descriptions:
//
//   Starlink crystals   (StarlinkBlock) break on a hit and take every touching crystal of
//                       their colour with them, unbreakable ones (UnbreakableStarlinkBlock)
//                       included; unbreakable ones cannot be broken directly
//   Ghostlink blocks    (GhostlinkBlock) break on a hit and fade the chain of blocks touching
//                       them: unbreakable blocks, stone, treasure (scene 370 walls buttons in
//                       unbreakable blocks with a ghost block in the wall)
//   Timed explosives    (TimedBlock) light on a hit, count down their `fuse` (Explosive 0.1 s,
//                       Explosive Timed 4 s, with its countdown state) and run their
//                       detonationAction: a blast that strikes the knight, monsters and blocks
//                       around them; other explosives in the blast light in turn
//   Prism puzzles       emitters (Switch, toggled by hits or signals) send a beam along their
//                       facing; prisms (PrismBlock) take it in at a receptor face and send it
//                       out of their other face (L bends) or straight on (passthroughs); hits
//                       turn rotatable prisms a quarter turn (their damageAction); receivers
//                       light and run their receptor's action, and its offAction when the beam
//                       leaves
//   Gun blocks          (Switch) fire a Gun Block Bullet along their facing when struck while
//                       ready, then reload for their Cooldown; "(Self)" ones answer only to
//                       other gun blocks' bullets, so they chain
//   Prisoner cages      (DumbSwitch, three states) take three hits; the prisoner inside (a
//                       Monster whose Shutdown handler spawns the freed companion) is released
//   Healing totems      (Block) pulse "Healing, pulse" from their WarnTimer (effect.dat: a
//                       DepthScaleHeal over a circle of radius 6), healing monsters
//   Heal pads           heal a knight standing on them every Interval seconds by their Health
//   Fuse actors         actors whose Startup is a Delayed with the action lost (the mortar
//                       shell's stage 3) end after the delay, running their Shutdown handler
//   Hit-replaced actors generic actors with a Damage handler and a destruction transient
//                       (mortar shells, wooden barricades) run the handler and are destroyed
//
// Numbers the data does not carry (blast radius, beam step, default delays) are ours.

import type { Entity, Logic } from "./logic";
import type { Prop } from "./props";

const cls = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };

export type ObjectKind = "starlink" | "starlinkFixed" | "ghost" | "timed" | "prism" | "emitter" | "gunBlock" | "cage"
  | "totem" | "healPad" | "fuseActor" | "hitReplace";

/** Radius of a timed block's blast (cells). The DamageRegion has no region in the data. */
export const BLAST_RADIUS = 1.5;
/** A prism laser's length (Block/Prism/Laser/Prism Laser `length`). */
export const BEAM_LENGTH = 10;
/** Seconds before a fuse actor whose delay was lost ends. */
export const FUSE_ACTOR_DELAY = 1.5;

/** An argument of a ConfigReference (ArgumentMap entries or a plain object). */
export function refArg(ref: any, key: string): any {
  const a = ref?.arguments;
  if (!a) return undefined;
  if (Array.isArray(a.entries)) return (a.entries as [string, any][]).find(([k]) => k === key)?.[1];
  return a[key];
}

/** Which dungeon object an actor config is, or null for plain props. */
export function objectKind(cfg: any, name: string): ObjectKind | null {
  switch (cls(cfg)) {
    case "StarlinkBlock": return "starlink";
    case "UnbreakableStarlinkBlock": return "starlinkFixed";
    case "GhostlinkBlock": return "ghost";
    case "TimedBlock": return "timed";
    case "PrismBlock": return "prism";
  }
  const handlers: any[] = cfg?.handlers ?? [];
  const damage = handlers.some(h => cls(h) === "Damage");
  if (/Prism\/.*Emitter/.test(name) || (cls(cfg) === "Switch" && /prism_puzzle\/emitter/.test(cfg?.sprite?.model?.name ?? ""))) return "emitter";
  if (/Gun Block/.test(name) || /gun_block\/model/.test(cfg?.sprite?.model?.name ?? "")) return "gunBlock";
  if (cls(cfg) === "DumbSwitch" && /Prisoner Cage|prisoner_cage/.test(name + (cfg?.sprite?.model?.name ?? ""))) return "cage";
  if (/Healing Totem/.test(name) && cls(cfg) === "Block") return "totem";
  if (/Heal Pad/.test(name)) return "healPad";
  const startup = handlers.find(h => cls(h) === "Startup");
  if (startup && cls(startup.action) === "Delayed" && !startup.action.action && handlers.some(h => cls(h) === "Shutdown")) return "fuseActor";
  if (damage && !/Block|Switch|Door/.test(cls(cfg)) && cfg?.sprite?.destructionTransient) return "hitReplace";
  return null;
}

/** A block's colour: its model's "Color" argument (starlink crystals), lower case. */
export function blockColor(cfg: any): string {
  return String(refArg(cfg?.sprite?.model, "Color") ?? "").toLowerCase();
}

/** A colour name from an enum value, a string or nothing ("" means any colour). */
export function colorName(v: any): string {
  const s = typeof v === "string" ? v : v?.name ?? "";
  const n = String(s).split(".").pop()!.toLowerCase();
  return n === "none" || n === "<ref>" ? "" : n;
}

const cellOf = (x: number, y: number) => `${Math.floor(x)},${Math.floor(y)}`;

/**
 * The chain of items touching `start` four ways (one cell apart), through items `joins`
 * accepts. `start` itself is included.
 */
export function linked<T extends { x: number; y: number }>(start: T, items: readonly T[], joins: (t: T) => boolean): T[] {
  const at = new Map<string, T[]>();
  for (const t of items) { const k = cellOf(t.x, t.y); const l = at.get(k); if (l) l.push(t); else at.set(k, [t]); }
  const seen = new Set<T>([start]), q = [start];
  while (q.length) {
    const c = q.pop()!;
    const cx = Math.floor(c.x), cy = Math.floor(c.y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const n of at.get(`${cx + dx},${cy + dy}`) ?? []) if (!seen.has(n) && joins(n)) { seen.add(n); q.push(n); }
    }
  }
  return [...seen];
}

// ------------------------------------------------------------------- prism beams

/** A receptor face: its outward angle in the block's frame, or null for the whole block. */
export interface Face { angle: number | null; color: string; action: any; offAction: any }

/** A PrismBlock's receptor faces (LaserReceptor shapes are offset to the face they sit on). */
export function prismFaces(cfg: any): Face[] {
  return ((cfg?.receptors ?? []) as any[]).map(r => {
    const t = r?.shape?.transform?.translation;
    const angle = t && (t.x || t.y) ? Math.atan2(t.y ?? 0, t.x ?? 0) : null;
    return { angle, color: colorName(r?.color), action: r?.action ?? null, offAction: r?.offAction ?? null };
  });
}

/** One of the four grid directions from an angle: 0 +x, 1 +y, 2 -x, 3 -y. */
export const quadrant = (a: number) => ((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4;
const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export interface BeamCell {
  /** A prism or receiver in the cell (its faces and rotation), a solid block, or nothing. */
  kind: "prism" | "solid" | "open";
  id?: number;
  faces?: Face[];
  rotation?: number;
}

export interface BeamResult {
  /** Straight beam pieces from cell centre to cell centre (stops at a wall's face). */
  segments: { x0: number; y0: number; x1: number; y1: number; dir: number }[];
  /** Receivers lit, by id, with the emitter's colour. */
  lit: Set<number>;
}

/**
 * Traces an emitter's beam from cell (x, y) along direction `dir` (0..3) in `color`. `cell`
 * says what occupies a cell, `wall` whether the beam is stopped there. Prisms take the beam at
 * a matching face (one facing back along the beam) and send it on from their other face, or
 * straight on with one face; a face-less receptor (receiver) takes it from any side.
 */
export function traceBeam(x: number, y: number, dir: number, color: string,
  cell: (x: number, y: number) => BeamCell, wall: (x: number, y: number) => boolean, length = BEAM_LENGTH): BeamResult {
  const out: BeamResult = { segments: [], lit: new Set() };
  const visited = new Set<string>();
  let cx = x, cy = y, d = dir, left = length, sx = x + 0.5, sy = y + 0.5;
  const end = (ex: number, ey: number) => { if (ex !== sx || ey !== sy) out.segments.push({ x0: sx, y0: sy, x1: ex, y1: ey, dir: d }); };
  for (let guard = 0; guard < 400; guard++) {
    const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
    if (left <= 0) { end(cx + 0.5, cy + 0.5); return out; }
    if (wall(nx, ny)) { end(cx + 0.5 + DIRS[d][0] * 0.5, cy + 0.5 + DIRS[d][1] * 0.5); return out; }
    const c = cell(nx, ny);
    if (c.kind === "solid") { end(nx + 0.5 - DIRS[d][0] * 0.5, ny + 0.5 - DIRS[d][1] * 0.5); return out; }
    if (c.kind === "prism") {
      end(nx + 0.5, ny + 0.5);
      const faces = c.faces ?? [], rot = c.rotation ?? 0;
      const back = (d + 2) % 4;
      const hit = faces.find(f => f.angle === null || quadrant(f.angle + rot) === back);
      if (!hit || (hit.color && color && hit.color !== color && hit.color !== "white")) return out;
      if (hit.angle === null) { if (c.id !== undefined) out.lit.add(c.id); return out; }
      const other = faces.find(f => f !== hit && f.angle !== null);
      const nd = other ? quadrant(other.angle! + rot) : d;
      const key = `${nx},${ny},${nd}`;
      if (visited.has(key)) return out;
      visited.add(key);
      if (c.id !== undefined) out.lit.add(c.id);
      cx = nx; cy = ny; d = nd; left = length; sx = nx + 0.5; sy = ny + 0.5;
      continue;
    }
    cx = nx; cy = ny; left--;
  }
  end(cx + 0.5, cy + 0.5);
  return out;
}

// ------------------------------------------------------------------- the system

/** Per-prop state of a dungeon object. */
export interface ObjectState {
  kind: ObjectKind;
  color?: string;
  /** Timed blocks: seconds left on a lit fuse. */
  fuse?: number;
  /** Gun blocks: seconds until ready again; emitters: hit cooldown. */
  cooldown?: number;
  /** Emitters: on. Receivers: lit. */
  on?: boolean;
  /** Cages: hits taken. */
  hits?: number;
  /** Heal pads and fuse actors: seconds to the next pulse or the end. */
  timer?: number;
  /** The sprite state shown, and whether its animation loops. */
  state?: number;
  loop?: boolean;
}

/** What the objects need from the world. */
export interface ObjectWorld {
  readonly logic: Logic;
  readonly knightEntity: Entity;
  readonly props: Prop[];
  knight(): { x: number; y: number; dead: boolean };
  /** Destroys a prop's actor (its destruction transient plays). */
  destroy(p: Prop): void;
  /** Plays one of a prop's sprite states. */
  playState(p: Prop, i: number, loop?: boolean): void;
  /** A blast: strikes the knight, monsters and blocks within r of (x, y) with a DamageConfig. */
  blast(x: number, y: number, r: number, action: any, source: Entity): void;
  /** Spawns an actor (a bullet) through the logic. */
  spawn(ref: any, x: number, y: number, rotation: number, source: Entity): void;
  heal(amount: number): void;
  /** Whether a beam stops in this cell (walls). */
  wall(x: number, y: number): boolean;
  /** Draws (or clears, with null) the prism beams. */
  beams(segments: BeamResult["segments"] | null): void;
  /** Destroys monsters (captives) within r of a point. */
  release(x: number, y: number, r: number): void;
}

export class DungeonObjects {
  constructor(private readonly w: ObjectWorld) {}

  /** Sets a new prop up as a dungeon object; returns its kind or null. */
  setup(p: Prop): ObjectKind | null {
    const k = objectKind(p.cfg, p.entity.name);
    if (!k) return null;
    const st: ObjectState = { kind: k };
    p.obj = st;
    switch (k) {
      case "starlink": p.breakable = true; st.color = blockColor(p.cfg); break;
      case "starlinkFixed": p.breakable = false; p.hittable = true; st.color = blockColor(p.cfg); break;
      case "ghost": p.breakable = true; break;
      case "timed": p.breakable = true; break;
      case "totem": p.breakable = true; p.health = p.maxHealth = 3; p.hits = true; break;
      case "prism": p.breakable = false; p.hittable = true; break;
      case "emitter": p.hittable = true; st.on = false; st.cooldown = 0; break;
      case "gunBlock": p.hittable = true; st.cooldown = 0; break;
      case "cage": p.hittable = true; st.hits = 0; break;
      case "hitReplace": p.hittable = true; break;
      case "healPad": st.timer = this.padInterval(p); break;
      case "fuseActor": st.timer = (p.cfg.handlers.find((h: any) => cls(h) === "Startup").action.delay ?? FUSE_ACTOR_DELAY * 1000) / 1000; break;
    }
    return k;
  }

  private padInterval(p: Prop) { return Math.max(0.25, p.cfg.handlers?.[0]?.interval ?? 1); }

  /** The mask of what may strike a prop's Damage handler: 1 hazards and bullets, 2 knights. */
  private damageMask(p: Prop): number {
    const h = (p.cfg.handlers ?? []).find((x: any) => cls(x) === "Damage");
    return h?.mask ?? p.cfg.damageMask ?? 3;
  }

  /**
   * A hit on a dungeon object from `by` (1 hazard, 2 knight). True when the object handled
   * it; false to let the default block damage run.
   */
  hit(p: Prop, by: number): boolean {
    const st = p.obj;
    if (!st) return false;
    const lg = this.w.logic, ke = this.w.knightEntity;
    switch (st.kind) {
      case "starlink": case "ghost": case "totem": return false;
      case "starlinkFixed": return true;
      case "timed":
        if (st.fuse === undefined) {
          lg.damaged(p.entity, ke);
          st.fuse = (p.cfg.fuse ?? 100) / 1000;
          this.w.playState(p, 1, false);
        }
        return true;
      case "prism":
        if ((this.damageMask(p) & by) === 0) return true;
        if (p.cfg.damageAction) lg.execute(p.cfg.damageAction, p.entity, ke);
        return true;
      case "emitter":
        if ((this.damageMask(p) & by) === 0 || (st.cooldown ?? 0) > 0) return true;
        if (!(p.cfg.handlers ?? []).some((h: any) => cls(h) === "Damage")) return true;
        this.setEmitter(p, !st.on);
        st.cooldown = 0.3;
        return true;
      case "gunBlock": {
        if ((this.damageMask(p) & by) === 0 || (st.cooldown ?? 0) > 0) return true;
        const fire = p.cfg.stateActions?.[1]?.actions?.[0]?.action ?? p.cfg.stateActions?.[1]?.actions?.[0];
        const actor = fire?.actor ?? { name: "Bullet/Dynamic Objects/Gun Block/Gun Block Bullet" };
        const a = p.entity.rotation;
        // the bullet leaves from the block's face, not from inside it
        this.w.spawn(actor, p.x + Math.cos(a) * 0.75, p.y + Math.sin(a) * 0.75, a, p.entity);
        st.cooldown = (p.cfg.stateActions?.[1]?.actions?.[1]?.delay ?? 4000) / 1000;
        p.pressed = true;
        this.w.playState(p, 1, false);
        return true;
      }
      case "cage": {
        if ((this.damageMask(p) & by) === 0) return true;
        lg.damaged(p.entity, ke);
        st.hits = (st.hits ?? 0) + 1;
        if (st.hits >= (p.cfg.states ?? 3)) this.w.destroy(p);
        else this.w.playState(p, st.hits, true);
        return true;
      }
      case "hitReplace":
        if ((this.damageMask(p) & by) === 0) return true;
        lg.damaged(p.entity, ke);
        this.w.destroy(p);
        return true;
      default: return false;
    }
  }

  private setEmitter(p: Prop, on: boolean) {
    const st = p.obj!;
    if (st.on === on) return;
    st.on = on;
    p.pressed = on;
    this.w.playState(p, on ? 1 : 0, true);
  }

  /** Signals to objects: signal-driven emitters switch; true when handled. */
  signal(p: Prop, name: string): boolean {
    const st = p.obj;
    if (st?.kind !== "emitter") return false;
    const n = name.toLowerCase();
    if (/^(activate|open|on|start|enable)$/.test(n)) this.setEmitter(p, true);
    else if (/^(deactivate|close|off|stop|disable)$/.test(n)) this.setEmitter(p, false);
    else if (n === "toggle") this.setEmitter(p, !st.on);
    return true;
  }

  /** A prop's actor was destroyed: crystal and ghost chains, cage releases. */
  destroyed(p: Prop) {
    const st = p.obj;
    if (!st) return;
    const blocks = this.w.props.filter(o => o !== p && !o.entity.destroyed && o.kind === "block");
    if (st.kind === "starlink" || st.kind === "starlinkFixed") {
      const same = (o: Prop) => (o.obj?.kind === "starlink" || o.obj?.kind === "starlinkFixed") && o.obj.color === st.color;
      for (const o of linked(p, [p, ...blocks], same)) if (o !== p) this.w.destroy(o);
    } else if (st.kind === "ghost") {
      // most blocks touching the ghost fade with it; prism pieces and explosives stay
      const joins = (o: Prop) => o.obj?.kind !== "prism" && o.obj?.kind !== "timed";
      for (const o of linked(p, [p, ...blocks], joins)) if (o !== p) this.w.destroy(o);
    } else if (st.kind === "cage") {
      this.w.release(p.x, p.y, 1.2);
    }
  }

  /** Per tick: fuses, reloads, heal pads, fuse actors and the prism beams. */
  update(dt: number) {
    const k = this.w.knight();
    let anyPrism = false;
    for (const p of [...this.w.props]) {
      const st = p.obj;
      if (!st || p.entity.destroyed) continue;
      if (st.cooldown !== undefined && st.cooldown > 0) {
        st.cooldown -= dt;
        if (st.cooldown <= 0 && st.kind === "gunBlock") { p.pressed = false; this.w.playState(p, 0, false); }
      }
      switch (st.kind) {
        case "timed":
          if (st.fuse !== undefined && (st.fuse -= dt) <= 0) {
            // the blast first (it lights neighbours), then the block goes
            const act = p.cfg.detonationAction;
            if (act) this.w.blast(p.x, p.y, BLAST_RADIUS, act, p.entity);
            this.w.destroy(p);
          }
          break;
        case "healPad":
          if ((st.timer! -= dt) <= 0) {
            st.timer = this.padInterval(p);
            const r = 0.5 + 0.33;
            if (!k.dead && Math.abs(k.x - p.x) < r && Math.abs(k.y - p.y) < r) {
              // the Heart choice's Health (40, 80, 120 of the game's 400 health; ours is 100)
              const h = p.cfg.handlers?.[0]?.action?.condition?.action?.current ?? 40;
              this.w.heal(h / 4);
            }
          }
          break;
        case "fuseActor":
          if ((st.timer! -= dt) <= 0) this.w.destroy(p);
          break;
        case "emitter": case "prism": anyPrism = true; break;
      }
    }
    if (anyPrism) this.updateBeams();
  }

  private beamKey = "";

  /** Traces every lit emitter's beam, lights receivers and runs their actions on changes. */
  private updateBeams() {
    const cells = new Map<string, Prop>();
    for (const p of this.w.props) if (!p.entity.destroyed && (p.kind === "block" || p.obj)) cells.set(cellOf(p.x, p.y), p);
    const ids = new Map<number, Prop>();
    let n = 0;
    const cell = (x: number, y: number): BeamCell => {
      const p = cells.get(`${x},${y}`);
      if (!p) return { kind: "open" };
      if (p.obj?.kind === "prism") {
        const id = n++;
        ids.set(id, p);
        return { kind: "prism", id, faces: prismFaces(p.cfg), rotation: p.entity.rotation };
      }
      // anything standing (blocks, emitters, gun blocks) stops the beam; low props do not
      return p.collisionId !== null ? { kind: "solid" } : { kind: "open" };
    };
    const segments: BeamResult["segments"] = [];
    const lit = new Set<Prop>();
    for (const p of this.w.props) {
      if (p.obj?.kind !== "emitter" || !p.obj.on || p.entity.destroyed) continue;
      const r = traceBeam(Math.floor(p.x), Math.floor(p.y), quadrant(p.entity.rotation), blockColor(p.cfg), cell, (x, y) => this.w.wall(x, y));
      segments.push(...r.segments);
      for (const id of r.lit) { const q = ids.get(id); if (q) lit.add(q); }
    }
    const key = segments.map(s => `${s.x0},${s.y0},${s.x1},${s.y1}`).join(";");
    if (key !== this.beamKey) { this.beamKey = key; this.w.beams(segments.length ? segments : null); }
    // receivers (face-less receptors) light while a beam reaches them
    for (const p of this.w.props) {
      if (p.obj?.kind !== "prism") continue;
      const faces = prismFaces(p.cfg);
      if (!faces.some(f => f.angle === null)) continue;
      const on = lit.has(p);
      if (!!p.obj.on === on) continue;
      p.obj.on = on;
      this.w.playState(p, on ? 1 : 0, true);
      const f = faces.find(x => x.angle === null)!;
      const act = on ? f.action : f.offAction;
      if (act) this.w.logic.execute(act, p.entity, this.w.knightEntity);
    }
  }
}

/** Monsters on the knight's side: freed companions and energy turrets. */
export const isAlly = (name: string) => /^Character\/NPC\/Companions\/|Energy-Consuming Objects\/|Player Allied/.test(name);
/** Allies waiting in a cage: they stand still until released. */
export const isCaptive = (name: string) => /Prisoner/.test(name);

const cref = (name: string, args?: [string, unknown][]) => ({ $class: "com.threerings.config.ConfigReference", name,
  ...(args ? { arguments: { $map: "com.threerings.config.ArgumentMap", entries: args } } : {}) });

/**
 * Models standing in for ones the install lacks: the prism puzzle's (world/dynamic/
 * prism_puzzle) are missing, so emitters show as gun blocks, prisms as echo (mirror) blocks,
 * receivers as unbreakable starlink crystals, and beams use the Roarmulus twins' beam model.
 */
export function standInModel(p: Prop): any | null {
  const name = p.cfg?.sprite?.model?.name ?? "";
  if (!/prism_puzzle/.test(name)) return null;
  if (p.obj?.kind === "emitter") return cref("world/dynamic/gun_block/model.dat");
  if (/receiver/.test(name)) return cref("world/dynamic/block/unbreakablestarlink/model.dat", [["Color", "blue"]]);
  return cref("world/dynamic/block/echo/model.dat");
}
export const BEAM_MODELS = ["world/dynamic/prism_puzzle/laser/model_beam.dat", "character/npc/monster/twingun/parts/model_beam.dat"];
