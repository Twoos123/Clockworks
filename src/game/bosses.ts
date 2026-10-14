// Boss arenas and fights. Each of the Clockworks' four bosses gets a dedicated arena floor
// (a TudeySceneModel root painted like a generated floor, see src/gen/level.ts) and a fight
// director. The bosses' actors, attacks, stage chains, minions, props and loot all come from
// the install's configs, but the fight logic that ties them together (when a bell stuns the
// Snarbolax, when a twin is exposed, when Vanaduke's mask is wet) is server code whose
// conditions the client data leaves out. The directors here reproduce it clean-room from the
// configs and from how the fights are described on the game's wiki:
//
// - Royal Jelly (Royal Jelly Palace): the v2 stage chain (Stage 1 -> 2 -> crownless
//   transition -> 4), Royal Polyps around the hall that bud Royal Minis, minis the Jelly
//   absorbs to heal, four Jelly Cubes every "Hvy Minion Interval", polyps respawning from
//   stage 2, and a rage spin (invulnerable) in the last stage.
// - Snarbolax (Gloaming Wildwoods): invulnerable until a Beast Bell is rung near it; the
//   bell's ring runs the Snarbolax's own stun handler (Stun 3); it can be hurt while it lies
//   stunned (a third of its health at most per stun), then burrows to a corner.
// - Roarmulus Twins (Ironclaw Munitions Factory): two turrets at either end of the hall,
//   armoured except against each other's rockets. Pressure plates raise a blast wall in front
//   of one twin, which stops that twin's rockets, so its brother's reach it and expose it
//   (Expose, Recover, the Exposed status' 5 seconds). Three stages each (East, East (2),
//   East (3)), moving between lanes from stage 2, a lane laser in stage 3; scuttle pads
//   keep sending Surgebots.
// - Lord Vanaduke (Firestorm Citadel): body stages 1, 2 and 3 with Slag Walker minions and
//   falling debris; between them he kneels ("Stage N Complete") and his burning mask flies
//   ("Mask Stage N"), immune until a knight douses it with a water pot.

import { State } from "../gen/autotile";
import { generateLevel, type LevelOptions } from "../gen/level";
import type { Layout, Room } from "../gen/layout";
import type { BossKey } from "./clockworks";
import type { AttackDef } from "./data";
import type { Entity } from "./logic";
import type { Prop } from "./props";
import { Monster, type BossDirector, type World } from "./world";

const CLS = "com.threerings.tudey.data.TudeySceneModel$";
const REF = "com.threerings.config.ConfigReference";
const argMap = (entries: [string, unknown][]) => ({ $map: "com.threerings.config.ArgumentMap", entries });
const ref = (name: string, args: [string, unknown][] = []) => ({ $class: REF, name, arguments: argMap(args) });
const place = (id: number, name: string, args: [string, unknown][], x: number, y: number, rotZ = 0) => ({
  $class: CLS + "PlaceableEntry", id, placeable: ref(name, args),
  transform: { $class: "com.threerings.math.Transform3D", translation: { $class: "com.threerings.math.Vector3f", x, y, z: 0 },
    rotation: { $class: "com.threerings.math.Quaternion", x: 0, y: 0, z: Math.sin(rotZ / 2), w: Math.cos(rotZ / 2) }, scale: 1 },
});

const BOSS = "Character/NPC/Monster/Boss/";
const GATE = "Dynamic/Door/Iron Gate/Monster 3";
const GATE_TAG = "boss gate";
const H40 = { $class: REF, name: "Monster/Health/Health Base +40" };

// ------------------------------------------------------------------ arenas

/** An arena floor plan: a start room, the arena, and the exit room past it. */
export interface ArenaPlan { start: Room; arena: Room; exit: Room; gates: [number, number][] }

/** Each arena's size in cells (its look is the boss level's tileset: BOSSES[key].tileset). */
export const ARENAS: Record<BossKey, { w: number; h: number }> = {
  jelly: { w: 22, h: 20 },
  snarbolax: { w: 20, h: 20 },
  twins: { w: 28, h: 13 },
  vanaduke: { w: 24, h: 22 },
};

/** The floor plan of a boss's arena (fixed per boss, so the fight knows where things are). */
export function arenaPlan(key: BossKey): ArenaPlan {
  const { w, h } = ARENAS[key];
  const start: Room = { x: 0, y: 0, w: 9, h: 9 };
  const arena: Room = { x: 4 - Math.floor(w / 2), y: 14, w, h };
  const exit: Room = { x: 1, y: arena.y + h + 5, w: 7, h: 7 };
  // the corridor mouths: the way in from the start room, and the way out to the elevator
  return { start, arena, exit, gates: [[4.5, arena.y - 0.5], [4.5, arena.y + h + 0.5]] };
}

function planLayout(p: ArenaPlan, deep: boolean): Layout {
  const floor = new Set<string>();
  const put = (x: number, y: number) => floor.add(x + "," + y);
  for (const r of [p.start, p.arena, p.exit]) for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) put(x, y);
  // corridors three cells wide between the rooms
  for (let y = p.start.y + p.start.h; y < p.arena.y; y++) for (let x = 3; x <= 5; x++) put(x, y);
  for (let y = p.arena.y + p.arena.h; y < p.exit.y; y++) for (let x = 3; x <= 5; x++) put(x, y);
  const cells = new Map<string, State>();
  for (const k of floor) cells.set(k, State.Floor);
  let ring: string[] = [...floor];
  for (let n = 0; n < (deep ? 2 : 1); n++) {
    const added: string[] = [];
    for (const k of ring) {
      const [x, y] = k.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const c = (x + dx) + "," + (y + dy);
        if (!cells.has(c)) { cells.set(c, State.Other); added.push(c); }
      }
    }
    ring = added;
  }
  return { cells, rooms: [p.start, p.arena, p.exit], start: 0, exit: 2 };
}

/**
 * Builds a boss arena's scene root: the boss tileset's tiling (src/gen/themes.ts) over the
 * arena plan, the start platform and exit elevator, Iron Gates in both corridor
 * mouths, and the arena's own props (the Snarbolax's bell, the twins' pressure plates and
 * blast walls).
 */
export function bossArena(key: BossKey, sources: { id: string; root: any }[], seed: number, title: string, pool: any[] = [],
  theme: Pick<LevelOptions, "model" | "globals"> = {}): any {
  const plan = arenaPlan(key);
  const root = generateLevel(sources, () => ({ width: 1, height: 1, walkable: false }), seed, title, pool,
    { ...theme, plan: deep => planLayout(plan, deep), encounters: false });
  const entries: any[] = root.entries;
  let id = entries.reduce((m, e) => Math.max(m, e.id ?? 0), 0) + 1;
  for (const [x, y] of plan.gates) entries.push(place(id++, GATE, [["Open", true], ["Tag", GATE_TAG]], x, y, 0));
  const a = plan.arena, cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  if (key === "snarbolax") entries.push(place(id++, "Dynamic/Monster Objects/Beast Bell (Boss)", [], Math.floor(cx) + 0.5, Math.floor(cy) + 0.5));
  if (key === "twins") {
    const t = twinGeometry(plan);
    entries.push(place(id++, "Dynamic/Switch/Button/Pressure Plate", [], t.plates.west[0], t.plates.west[1]));
    entries.push(place(id++, "Dynamic/Switch/Button/Pressure Plate", [], t.plates.east[0], t.plates.east[1]));
    for (const side of ["west", "east"] as const) {
      for (const ly of t.lanes) entries.push(place(id++, GATE, [["Open", true], ["Tag", `twin wall ${side}`]], t.wallX[side], ly, Math.PI / 2));
    }
  }
  return root;
}

const TWIN_ACTOR = /^Character\/NPC\/Monster\/Boss\/Roarmulus Twins\/(?:Ultimate\/)?(West|East)( \(\d\))?$/;

/** The game's own factory hall: the twins' lane markers (west_top, east_middle...). */
function realTwinGeometry(w: World): ReturnType<typeof twinGeometry> | null {
  const at = (tag: string) => w.logic.tagged(tag).map(e => [e.x, e.y] as [number, number]);
  const west = [...at("west_top"), ...at("west_middle"), ...at("west_bottom")], east = [...at("east_top"), ...at("east_middle"), ...at("east_bottom")];
  if (!west.length || !east.length) return null;
  const lanes = [...new Set(west.map(p => p[1]))].sort((a, b) => a - b);
  const wx = west[0][0], ex = east[0][0], cy = (lanes[0] + lanes[lanes.length - 1]) / 2;
  return { x: { west: wx, east: ex }, lanes, wallX: { west: wx + 8, east: ex - 8 },
    plates: { west: [wx, cy] as [number, number], east: [ex, cy] as [number, number] }, pads: [] as [number, number][] };
}

/** The Twins' hall: the turrets at either end, three lanes, the blast walls and plates. */
function twinGeometry(p: ArenaPlan) {
  const a = p.arena, cy = a.y + a.h / 2;
  const lanes = [cy - 3.5, cy, cy + 3.5].map(y => Math.floor(y) + 0.5);
  return {
    x: { west: a.x + 1.5, east: a.x + a.w - 1.5 },
    lanes,
    wallX: { west: a.x + 5.5, east: a.x + a.w - 5.5 },
    plates: { west: [a.x + a.w / 2 - 3.5, a.y + 1.5] as [number, number], east: [a.x + a.w / 2 + 3.5, a.y + 1.5] as [number, number] },
    pads: [[a.x + a.w / 2, a.y + 1.5], [a.x + a.w / 2, a.y + a.h - 1.5]] as [number, number][],
  };
}

// ------------------------------------------------------------------ fights

const mon = (e: Entity | null | undefined): Monster | null => (e && !e.destroyed && e.game instanceof Monster ? e.game : null);
const named = (m: Monster, re: RegExp): AttackDef | null => m.def.attacks.find(a => re.test(a.name)) ?? null;

// ------------------------------------------------------------------ the game's own boss levels

/**
 * The boss hall of the game's own level, from its markers: the Royal Jelly's mini spawn
 * points, the Snarbolax's warp markers, the Twins' lane markers, Vanaduke's sprite wells.
 */
export function realArena(key: BossKey, w: World): Room | null {
  const at = (...tags: string[]) => tags.flatMap(t => w.logic.tagged(t).map(e => [e.x, e.y] as [number, number]));
  const pts = key === "jelly" ? at("minispawnpoint")
    : key === "snarbolax" ? at("snarbolax_warp_a", "snarbolax_warp_b")
    : key === "twins" ? at("west_random", "east_random", "west_top", "west_bottom", "east_top", "east_bottom")
    : w.props.filter(p => /Sprite Well/.test(p.entity.name)).map(p => [p.x, p.y] as [number, number]);
  if (pts.length < 2) {
    // a boss level of another layout: the hall around its boss token
    const t = at("boss_token")[0];
    return t ? { x: t[0] - 10, y: t[1] - 10, w: 20, h: 20 } : null;
  }
  const pad = key === "snarbolax" ? 1.5 : key === "twins" ? 2 : 2.5;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad - (key === "twins" ? 2 : 0);
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad + (key === "twins" ? 2 : 0) - y };
}

/** What a fight director shares: the arena, its gates, spawning, the finish. */
export abstract class BossFight implements BossDirector {
  started = false;
  defeated = false;
  /** Seconds since the fight began. */
  t = 0;
  /** A line for tests and the HUD: the stage the fight is in. */
  stage = "waiting";
  protected readonly arena: Room;
  private seen = new WeakSet<Entity>();
  /**
   * `real`: the fight is on the game's own boss level, whose logic shuts its doors, brings the
   * boss on and opens the way out (its platforms, triggers and Actor Removed handlers); the
   * director then takes up the boss the level spawned and runs only what is server code.
   */
  /**
   * `ultimate`: the boss's Shadow Lair form, as the "_ultimate" levels spawn it: the Royal Jelly's
   * and the Twins' Ultimate configs, Darkfire Vanaduke (Vanaduke/Ultimate), two Rabid (Poison) Snarbolaxes.
   */
  constructor(readonly key: BossKey, protected readonly w: World, readonly plan: ArenaPlan, readonly real = false, readonly ultimate = false) {
    this.arena = (real ? realArena(key, w) : null) ?? plan.arena;
  }

  /** On the game's own level: whether the level has brought the boss on (the fight begins). */
  protected ready(): boolean {
    const k = this.w.knight;
    return this.inArena(k.x, k.y, 1.5);
  }

  get cx() { return this.arena.x + this.arena.w / 2; }
  get cy() { return this.arena.y + this.arena.h / 2; }
  protected get ke() { return this.w.knightEntity; }
  protected inArena(x: number, y: number, inset = 0) {
    const a = this.arena;
    return x >= a.x + inset && x <= a.x + a.w - inset && y >= a.y + inset && y <= a.y + a.h - inset;
  }

  update(dt: number) {
    if (this.defeated) return;
    if (!this.started) {
      const k = this.w.knight;
      if (this.real ? !this.ready() : !this.inArena(k.x, k.y, 1.5)) return;
      this.started = true;
      this.gates("close");
      this.begin();
      return;
    }
    this.t += dt;
    this.tick(dt);
  }

  /** The knight came in: the gates shut and the boss appears. */
  protected abstract begin(): void;
  protected abstract tick(dt: number): void;

  protected gates(name: "open" | "close") {
    // the game's own level opens and shuts its doors itself
    if (this.real) return;
    for (const e of [...this.w.logic.tagged(GATE_TAG)]) this.w.logic.signal(e, this.ke, name);
  }

  /** Marker positions of the level by tag (the game's own level). */
  protected marks(tag: string): [number, number][] { return this.w.logic.tagged(tag).map(e => [e.x, e.y]); }

  protected spawn(name: string, x: number, y: number, rot = 0, args: [string, unknown][] = []): Entity | null {
    return this.w.logic.spawn(ref(name, args), x, y, rot, this.ke, this.ke);
  }

  /** Actors whose config name matches, alive. */
  protected actors(re: RegExp): Entity[] { return this.w.logic.actors.filter(e => !e.destroyed && re.test(e.name)); }

  /** True the first time a monster has loaded for this entity (for one-off setup). */
  protected fresh(e: Entity): Monster | null {
    const m = mon(e);
    if (!m || this.seen.has(e)) return null;
    this.seen.add(e);
    return m;
  }

  /**
   * Sets a boss's health to a multiple of the depth's boss health (Health Base +40), but
   * only for an actor whose config gives none: the bosses' own configs carry their health
   * (Snarbolax and the Royal Jelly (v1) Health Base +40, the Jelly v2 stages +30 and +20,
   * the Twins +10, Vanaduke 15000 and his mask 5000), which the spawn has already applied.
   */
  protected sizeHealth(m: Monster, factor: number) {
    if (m.def.healthScale || m.def.health) return;
    const base = this.w.depthValue(H40) || 100;
    m.maxHealth = m.health = Math.max(1, Math.round(base * factor));
  }

  /** A random free point in the arena, away from its rim. */
  protected randomPoint(inset = 2, radius = 0.5): [number, number] {
    const a = this.arena;
    for (let i = 0; i < 20; i++) {
      const x = a.x + inset + Math.random() * (a.w - 2 * inset), y = a.y + inset + Math.random() * (a.h - 2 * inset);
      if (!this.w.collisionMap.collides(x, y, radius, 1 | 2)) return [x, y];
    }
    return [this.cx, this.cy];
  }

  /** The fight is won: the gates open, the loot table drops and the elevator runs. */
  protected finish(loot: string | null, x = this.cx, y = this.cy) {
    if (this.defeated) return;
    this.defeated = true;
    this.stage = "defeated";
    this.gates("open");
    if (loot) this.w.tableSpawn({ $class: REF, name: loot }, x, y);
    this.w.say(this.w.knight.x, this.w.knight.y, `${BOSS_NAMES[this.key]} defeated!`, "#ffd84d");
    // the boss's remaining minions scatter
    for (const m of [...this.w.monsters]) {
      if (m.entity && m.state !== "dying" && (!m.passive || /\/Boss\//.test(m.entity.name))) this.w.logic.destroy(m.entity, this.ke);
    }
  }
}

const BOSS_NAMES: Record<BossKey, string> = { jelly: "Royal Jelly", snarbolax: "Snarbolax", twins: "Roarmulus Twins", vanaduke: "Lord Vanaduke" };

// ------------------------------------------------------------------ Royal Jelly

const RJ = BOSS + "Royal Jelly (v2)/";
const RJ_STAGE = /^Character\/NPC\/Monster\/Boss\/Royal Jelly \(v2\)\/(?:Ultimate\/)?Royal Jelly \(Stage (\d)\)$/;
const POLYP = RJ + "Parts/Royal Polyp";
const MINI = BOSS + "Royal Jelly/Parts/Royal Mini/Royal Mini 1";
/** The Ice Queen's (the Shadow Lair's) minis and polyps are the freeze ones. */
const MINI_ICE = BOSS + "Royal Jelly/Parts/Royal Mini/Royal Mini Ice";
const CUBE = "Character/NPC/Monster/Slime/Jelly Cube/Jelly Cube 1";
/** Per stage: polyps at its start ("Polyp Startup Count"), heavy minion interval (ms), polyps respawn. */
const RJ_STAGES: Record<number, { polyps: number; heavy: number; respawn: boolean; health: number }> = {
  1: { polyps: 3, heavy: 30000, respawn: false, health: 2.2 },
  2: { polyps: 4, heavy: 20000, respawn: true, health: 2.2 },
  3: { polyps: 0, heavy: 0, respawn: false, health: 1 },
  4: { polyps: 6, heavy: 20000, respawn: true, health: 2.6 },
};

export class JellyFight extends BossFight {
  private jelly: Entity | null = null;
  private stageNo = 0;
  private stageT = 0;
  private heavyT = 0;
  private budT = 0;
  private polypSpots: [number, number][] = [];
  private respawns: number[] = [];
  private rage = 0;
  private rageT = 0;

  /** The game's own Battle Royale: its platform's One Time Action spawns the first stage. */
  protected ready() { return this.actors(RJ_STAGE).length > 0; }

  protected begin() {
    const a = this.arena;
    if (this.real) {
      // the level's own hall: polyps at its mini spawn points; the Jelly and its first Jelly
      // Cubes and Royal Minis are the level's (One Time Action, Wave Spawns)
      this.polypSpots = this.marks("minispawnpoint");
      this.jelly = this.actors(RJ_STAGE)[0] ?? null;
      this.w.say(this.cx, this.cy, "The Royal Jelly!", "#d79bff");
      return;
    }
    // Royal Polyps stand around the hall's rim
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + Math.PI / 8;
      this.polypSpots.push([this.cx + Math.cos(ang) * (a.w / 2 - 2.5), this.cy + Math.sin(ang) * (a.h / 2 - 2.5)]);
    }
    this.jelly = this.spawn(RJ + (this.ultimate ? "Ultimate/" : "") + "Royal Jelly (Stage 1)", this.cx, this.cy + 1, -Math.PI / 2, [["Wave Tag", "boss"]]);
    // the first three Jelly Cubes come with him (the only ones that drop loot)
    for (let i = 0; i < 3; i++) this.spawn(CUBE, this.cx - 3 + i * 3, this.cy - 3, -Math.PI / 2);
    this.w.say(this.cx, this.cy, "The Royal Jelly!", "#d79bff");
  }

  protected tick(dt: number) {
    // the current stage: the newest live Royal Jelly stage actor (each stage's Shutdown
    // handler spawns the next)
    const stages = this.actors(RJ_STAGE);
    const cur = stages[stages.length - 1] ?? null;
    if (!cur) {
      // the last stage fell (its own Shutdown dropped the Royal Jelly Loot table)
      if (this.stageNo === 4 && this.jelly?.destroyed) this.finish(null, this.jelly.x, this.jelly.y);
      return;
    }
    const n = Number(RJ_STAGE.exec(cur.name)![1]);
    if (cur !== this.jelly || n !== this.stageNo) {
      this.jelly = cur;
      this.stageNo = n;
      this.stageT = 0;
      this.heavyT = 0;
      this.stage = `stage ${n}`;
    }
    const m = mon(cur);
    if (!m) return;
    if (this.fresh(cur)) {
      this.sizeHealth(m, RJ_STAGES[n].health);
      // new polyps at the start of each stage
      const want = RJ_STAGES[n].polyps - this.actors(/Royal Polyp$/).length;
      for (let i = 0; i < want; i++) this.spawnPolyp();
      if (n === 3) { m.scripted = true; this.w.say(m.x, m.y, "The crown falls!", "#d79bff"); }
    }
    this.stageT += dt;
    // the crownless transition shakes for a moment, then the last stage rises from it
    if (n === 3) {
      if (this.stageT > 3) this.w.logic.destroy(cur, cur);
      return;
    }
    // heavy minions: four Jelly Cubes every "Hvy Minion Interval"
    this.heavyT += dt * 1000;
    if (this.heavyT >= RJ_STAGES[n].heavy) {
      this.heavyT = 0;
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2;
        this.spawn(CUBE, m.x + Math.cos(ang) * 3, m.y + Math.sin(ang) * 3, ang);
      }
    }
    // polyps bud Royal Minis, which crawl to the Jelly
    this.budT += dt;
    const minis = this.w.monsters.filter(x => x.state !== "dying" && /Royal Mini/.test(x.entity?.name ?? ""));
    if (this.budT >= 6) {
      this.budT = 0;
      for (const p of this.actors(/Royal Polyp$/)) {
        if (minis.length >= 12) break;
        const pm = mon(p);
        if (pm) { this.spawn(this.ultimate ? MINI_ICE : MINI, pm.x + (Math.random() - 0.5), pm.y + (Math.random() - 0.5), Math.atan2(m.y - pm.y, m.x - pm.x)); minis.push(pm); }
      }
    }
    // absorb: minis that touch the Jelly are eaten and heal it (Monster/Boss/Royal Jelly/Absorb)
    for (const mini of minis) {
      if (!mini.entity || Math.hypot(mini.x - m.x, mini.y - m.y) > m.radius + mini.radius + 0.6) continue;
      this.w.logic.destroy(mini.entity, cur);
      this.w.healMonster(m, Math.max(this.w.depthValue({ $class: REF, name: "Monster/Heal/Heal Base -05" }), m.maxHealth * 0.03));
      this.w.effectAt("particle/fx_burstheal-wsound.dat", m.x, m.y, 1.5);
    }
    // minis head for the Jelly when they are not fighting (the polyps' minis feed him)
    for (const mini of minis) if (Math.hypot(mini.x - m.x, mini.y - m.y) < 6 && mini.state !== "attack") mini.homeX = m.x, mini.homeY = m.y;
    // polyps come back from stage 2 on (Monster/Boss/Royal Jelly/Respawn Polyp)
    if (RJ_STAGES[n].respawn) {
      const live = this.actors(/Royal Polyp$/).length + this.respawns.length;
      if (live < RJ_STAGES[n].polyps) this.respawns.push(this.t + 15);
      this.respawns = this.respawns.filter(at => { if (this.t >= at) { this.spawnPolyp(); return false; } return true; });
    }
    // the last stage's rage: pink, spinning, invulnerable
    if (n === 4) {
      this.rageT += dt;
      if (this.rage > 0) {
        this.rage -= dt;
        if (!m.attack) { const spin = named(m, /Tantrum Spin/); if (spin) this.w.monsterAttack(m, spin); }
        if (this.rage <= 0) m.scripted = false;
      } else if (this.rageT > 16) {
        this.rageT = 0;
        this.rage = 4;
        m.scripted = true;
        m.attack = null;
        this.w.say(m.x, m.y, "Enraged!", "#ff7ad9");
      }
    }
  }

  private spawnPolyp() {
    const used = this.actors(/Royal Polyp$/).map(e => [e.x, e.y]);
    const free = this.polypSpots.filter(([x, y]) => !used.some(([ux, uy]) => Math.hypot(ux - x, uy - y) < 1));
    const [x, y] = free[Math.floor(Math.random() * free.length)] ?? this.randomPoint(3);
    this.spawn(POLYP, x, y, Math.atan2(this.cy - y, this.cx - x), [["Variant", this.ultimate ? "Ice" : "Normal"], ["Wave Tag", "royal_minion"]]);
  }

  damage(m: Monster, dmg: number): number {
    const name = m.entity?.name ?? "";
    if (RJ_STAGE.test(name)) {
      const n = Number(RJ_STAGE.exec(name)![1]);
      if (n === 3 || (n === 4 && this.rage > 0)) return 0;
    }
    return dmg;
  }

  attacks(m: Monster): AttackDef[] | null {
    // the rage spin is the director's to start
    if (RJ_STAGE.test(m.entity?.name ?? "")) return m.def.attacks.filter(a => !/Tantrum Spin|Royal Mini Spawn/.test(a.name));
    return null;
  }
}

// ------------------------------------------------------------------ Snarbolax

const SNARB = BOSS + "Snarbolax/Snarbolax";
const SNARB_ACTOR = /^Character\/NPC\/Monster\/Boss\/Snarbolax\/Snarbolax$/;
/** Seconds the Snarbolax lies stunned after a bell ("a few seconds"). */
// The bell's ring runs the Snarbolax's handler: ApplyStatus "Stun 3" at ULTIMATE power, whose
// maxDuration is 8000 ms (status_condition.dat).
const SNARB_STUN = 8;
/** How close it must be to the bell for the ring to stun it. */
const BELL_RANGE = 4.5;

/** One Snarbolax of the fight (the Shadow Lair has two Rabid ones). */
interface Snarb { e: Entity; stunned: number; stunDamage: number; burrow: number; looks: { normal: any; invulnerable: any } | null; seen: boolean }

export class SnarbolaxFight extends BossFight {
  private snarbs: Snarb[] = [];
  stuns = 0;
  /** The first Snarbolax (tests and the HUD). */
  get snarb(): Entity | null { return this.snarbs[0]?.e ?? null; }
  /** Its config's variant: the Shadow Lair's are Rabid Snarbolaxes ("Poison"). */
  private get variant() { return this.ultimate ? "Poison" : "Normal"; }

  /** The game's own lair: its platform's Repeat Action activates the Snarbolax's spawn table. */
  protected ready() { return this.actors(SNARB_ACTOR).length > 0; }

  protected begin() {
    if (this.real) {
      this.adopt();
      this.stage = "invulnerable";
      this.w.say(this.cx, this.cy, "The Snarbolax!", "#9fd27b");
      return;
    }
    // the Shadow Lair's lair: two Rabid Snarbolaxes
    for (let i = 0; i < (this.ultimate ? 2 : 1); i++) {
      const [x, y] = this.corner();
      const e = this.spawn(SNARB, x, y, Math.atan2(this.cy - y, this.cx - x), [["Variant", this.variant], ["Warp", i ? "B" : "A"], ["Wave Tag", "boss"]]);
      if (e) this.snarbs.push({ e, stunned: 0, stunDamage: 0, burrow: 0, looks: null, seen: false });
    }
    this.stage = "invulnerable";
    this.w.say(this.cx, this.cy, "The Snarbolax!", "#9fd27b");
  }

  /** Takes up the Snarbolaxes the level spawned (its spawn tables may bring the second on later). */
  private adopt() {
    for (const e of this.actors(SNARB_ACTOR)) if (!this.snarbs.some(s => s.e === e)) this.snarbs.push({ e, stunned: 0, stunDamage: 0, burrow: 0, looks: null, seen: false });
  }

  /** One of the arena's four corners (where it surfaces), away from the knight. */
  private corner(): [number, number] {
    const a = this.arena, k = this.w.knight;
    // the game's own lair has warp markers for it (snarbolax_warp_a and _b)
    const warps = this.real ? [...this.marks("snarbolax_warp_a"), ...this.marks("snarbolax_warp_b")] : [];
    const cs: [number, number][] = warps.length ? warps
      : [[a.x + 2.5, a.y + 2.5], [a.x + a.w - 2.5, a.y + 2.5], [a.x + 2.5, a.y + a.h - 2.5], [a.x + a.w - 2.5, a.y + a.h - 2.5]];
    const far = cs.filter(([x, y]) => Math.hypot(x - k.x, y - k.y) > 6);
    const list = far.length ? far : cs;
    return list[Math.floor(Math.random() * list.length)];
  }

  protected tick(dt: number) {
    if (this.real) this.adopt();
    if (!this.snarbs.length) return;
    // (the game's own lair drops the loot from its Actor Removed handler)
    if (this.snarbs.every(s => s.e.destroyed)) {
      const last = this.snarbs[this.snarbs.length - 1].e;
      this.finish(this.real ? null : this.ultimate ? "Treasure/Monster/Beast/Ultimate Snarbolax Loot" : "Treasure/Monster/Beast/Snarbolax Loot", last.x, last.y);
      return;
    }
    for (const s of this.snarbs) if (!s.e.destroyed) this.tickOne(s, dt);
  }

  private tickOne(s: Snarb, dt: number) {
    const e = s.e, m = mon(e);
    if (!m) return;
    if (!s.seen) {
      s.seen = true;
      this.sizeHealth(m, 3);
      const cfg = this.w.data.resolveSync("config/actor.dat", ref(SNARB, [["Variant", this.variant]]), "actor");
      s.looks = { normal: cfg?.sprite?.model, invulnerable: cfg?.sprite?.flagModels?.[0]?.model };
      // in its shadowy, invulnerable coat until a bell stuns it
      if (s.looks.invulnerable) void this.w.setModel(m, s.looks.invulnerable);
    }
    if (s.stunned > 0) {
      s.stunned -= dt;
      m.attack = null;
      if (s.stunned <= 0 || s.stunDamage >= m.maxHealth / 3) this.recover(s, m);
    } else if (s.burrow > 0) {
      s.burrow -= dt;
      if (s.burrow <= 0) {
        // it surfaces at a corner and springs out with its warp attack (barbs and a stun ring)
        const [x, y] = this.corner();
        m.x = m.homeX = e.x = x; m.y = m.homeY = e.y = y;
        m.heading = Math.atan2(this.w.knight.y - y, this.w.knight.x - x);
        m.scripted = false;
        const warp = named(m, /Warp To/);
        if (warp) this.w.monsterAttack(m, warp);
        this.w.effectAt("particle/fx_spawn_monster.dat", x, y, 1.5, 2);
      }
    }
    if (this.snarbs.some(x => x.stunned > 0)) this.stage = "stunned";
    else if (this.stage === "stunned") this.stage = "invulnerable";
  }

  /** A bell rang: a Snarbolax close to it runs its own stun handler (Stun 3) and drops. */
  struck(p: Prop) {
    for (const s of this.snarbs) {
      const e = s.e, m = mon(e);
      if (!m || s.stunned > 0 || s.burrow > 0) continue;
      if (Math.hypot(m.x - p.x, m.y - p.y) > BELL_RANGE + m.radius) continue;
      // the first SignalStart handler: the bell-break flash and ApplyStatus "Stun 3"
      const h = e.handlers.find(x => x.kind === "SignalStart");
      const act = h?.cfg?.action;
      if (act) this.w.logic.execute(act.$class?.endsWith("$Conditional") && !act.condition ? act.action : act, e, e);
      s.stunned = SNARB_STUN;
      s.stunDamage = 0;
      this.stuns++;
      this.stage = "stunned";
      m.attack = null;
      m.scripted = true;
      const stun = named(m, /Snarbolax\/Stun$/);
      if (stun?.start) this.w.playOn(m, stun.start, false, stun.startSpeed);
      if (s.looks?.normal) void this.w.setModel(m, s.looks.normal).then(() => { if (stun?.start && s.stunned > 0) this.w.playOn(m, stun.start, false, stun.startSpeed); });
      this.w.say(m.x, m.y, "Stunned!", "#ffe27a");
    }
  }

  private recover(s: Snarb, m: Monster) {
    s.stunned = 0;
    const stun = named(m, /Snarbolax\/Stun$/);
    if (s.looks?.invulnerable) void this.w.setModel(m, s.looks.invulnerable);
    if (stun?.fire) this.w.playOn(m, stun.fire, false, stun.fireSpeed);
    // it burrows and comes up at another corner
    s.burrow = 1.4;
  }

  damage(m: Monster, dmg: number): number {
    const s = this.snarbs.find(x => x.e === m.entity);
    if (!s) return dmg;
    if (s.stunned <= 0) return 0;
    s.stunDamage += dmg;
    return dmg;
  }

  attacks(m: Monster): AttackDef[] | null {
    if (!this.snarbs.some(x => x.e === m.entity)) return null;
    return m.def.attacks.filter(a => !/Snarbolax\/(Stun|Warp|Flee|Charge - End)/.test(a.name));
  }
}

// ------------------------------------------------------------------ Roarmulus Twins

const RT = BOSS + "Roarmulus Twins/";
type Side = "west" | "east";
const other = (s: Side): Side => (s === "west" ? "east" : "west");
const ROCKET = RT + "Parts/Rocket";
/** Seconds a struck twin stays exposed (Monster Attacks/Boss/Roarmulus Twins/Exposed: 7000 ms). */
const EXPOSED = 7;
const LASER_DAMAGE = { $class: "projectx.dungeon.config.DamageConfig$DepthScale", flags: 4, depthScale: { $class: REF, name: "Monster/Damage/Attack Base +10" } };

interface Twin { side: Side; e: Entity | null; stage: number; exposed: number; cooldown: number; lane: number; targetY: number;
  pending: { at: number; n: number } | null; laser: number; looks: { open: any; shielded: any } | null }

export class TwinsFight extends BossFight {
  readonly geo = (this.real ? realTwinGeometry(this.w) : null) ?? twinGeometry(this.plan);
  readonly twins: Record<Side, Twin> = {
    west: { side: "west", e: null, stage: 1, exposed: 0, cooldown: 2, lane: 1, targetY: 0, pending: null, laser: 0, looks: null },
    east: { side: "east", e: null, stage: 1, exposed: 0, cooldown: 3, lane: 1, targetY: 0, pending: null, laser: 0, looks: null },
  };
  /** Which blast wall is up. */
  wall: Side | null = null;
  private padT = [8, 14];
  private bots: (Entity | null)[] = [null, null];
  exposures = 0;

  /** The game's own factory: its One Time Actions spawn both twins once the party is warped in. */
  protected ready() { return this.actors(TWIN_ACTOR).length >= 2; }

  /** The level's wave tag for the twins (its Actor Removed opens the way out when they are gone). */
  private waveTag = "boss";

  protected begin() {
    if (this.real) {
      // the level's twins: the director takes them up as they stand
      for (const e of this.actors(TWIN_ACTOR)) {
        const t = this.twins[/West/.test(e.name) ? "west" : "east"];
        t.e = e;
        e.handlers = e.handlers.filter(h => h.kind !== "Shutdown");
        if (e.tags[0]) this.waveTag = e.tags[0];
        let best = 0;
        this.geo.lanes.forEach((ly, i) => { if (Math.abs(ly - e.y) < Math.abs(this.geo.lanes[best] - e.y)) best = i; });
        t.lane = best;
        t.targetY = this.geo.lanes[best];
        t.cooldown = 2.5;
      }
      // the toggle walls start with the yellow ones up
      this.toggleWalls(true);
    } else {
      for (const side of ["west", "east"] as Side[]) this.spawnTwin(this.twins[side]);
      for (const [x, y] of this.geo.pads) this.spawn(RT + "Parts/Scuttle Pad", x, y, 0);
    }
    this.stage = "stage 1";
    this.w.say(this.cx, this.cy, "The Roarmulus Twins!", "#9fd8ff");
  }

  private stageName(t: Twin) {
    const dir = t.side === "west" ? "West" : "East";
    const base = RT + (this.ultimate ? "Ultimate/" : "");
    return t.stage === 1 ? base + dir : `${base}${dir} (${t.stage})`;
  }

  private spawnTwin(t: Twin) {
    t.targetY = this.geo.lanes[t.lane];
    const x = this.geo.x[t.side];
    t.e = this.spawn(this.stageName(t), x, t.targetY, t.side === "west" ? 0 : Math.PI, [["Wave Tag", this.waveTag]]);
    // the director runs what its Shutdown would (the next stage, or the loot when it falls)
    if (t.e) t.e.handlers = t.e.handlers.filter(h => h.kind !== "Shutdown");
    t.exposed = 0;
    t.pending = null;
    t.cooldown = 2.5;
  }

  protected tick(dt: number) {
    // the plates: the last one stood on keeps its wall up
    for (const p of this.w.props) {
      if (!/Pressure Plate/.test(p.entity.name) || !p.pressed) continue;
      const side: Side = p.x < this.cx ? "west" : "east";
      if (this.wall !== side) this.raiseWall(side);
    }
    for (const side of ["west", "east"] as Side[]) {
      const t = this.twins[side];
      if (!t.e) continue;
      if (t.e.destroyed) {
        if (t.stage >= 3) { this.win(t); return; }
        t.stage++;
        this.stage = `stage ${Math.max(this.twins.west.stage, this.twins.east.stage)}`;
        this.spawnTwin(t);
        continue;
      }
      const m = mon(t.e);
      if (!m) continue;
      if (this.fresh(t.e)) {
        m.scripted = true;
        this.sizeHealth(m, 1.2);
        const cfg = this.w.data.resolveSync("config/actor.dat", ref(this.stageName(t)), "actor");
        t.looks = { open: cfg?.sprite?.model, shielded: cfg?.sprite?.flagModels?.[0]?.model };
        if (t.looks.shielded) void this.w.setModel(m, t.looks.shielded);
        m.heading = side === "west" ? 0 : Math.PI;
      }
      this.runTwin(t, m, dt);
    }
    // scuttle pads: a Surgebot from each when its last is gone, after the pad's "Delay" (45 s)
    // (the game's own factory spawns its pads from One Time Actions)
    const pads = this.real ? this.actors(/Roarmulus Twins\/Parts\/Scuttle Pad$/).map(e => [e.x, e.y] as [number, number]) : this.geo.pads;
    pads.forEach(([x, y], i) => {
      if (this.bots[i] && !this.bots[i]!.destroyed) return;
      this.padT[i] = (this.padT[i] ?? 8 + 6 * i) - dt;
      if (this.padT[i] > 0) return;
      this.padT[i] = 45;
      this.bots[i] = this.spawn("Character/NPC/Monster/Construct/Scuttlebot/Surgebot/Surgebot Mk II", x, y, 0, [["Loot", "Health Only"], ["Wave Tag", "minion"]]);
    });
  }

  private runTwin(t: Twin, m: Monster, dt: number) {
    const k = this.w.knight;
    const face = t.side === "west" ? 0 : Math.PI;
    if (t.exposed > 0) {
      t.exposed -= dt;
      if (t.exposed <= 0) {
        // the armour closes again (Recover)
        if (t.looks?.shielded) void this.w.setModel(m, t.looks.shielded);
        const rec = named(m, /Twins\/Recover$/);
        if (rec) this.w.monsterAttack(m, rec);
        t.cooldown = 1.5;
      }
      return;
    }
    // stage 2 on: they slide between the lanes between attacks
    if (t.stage >= 2 && !m.attack && Math.abs(m.y - t.targetY) > 0.05) {
      const sp = (t.stage === 2 ? 3 : 6) * dt;
      m.y += Math.sign(t.targetY - m.y) * Math.min(sp, Math.abs(t.targetY - m.y));
      return;
    }
    // the lane laser (stage 3): a beam down its lane
    if (t.laser > 0) {
      t.laser -= dt;
      const ahead = t.side === "west" ? k.x > m.x : k.x < m.x;
      const shielded = this.wall === t.side && (t.side === "west" ? k.x > this.geo.wallX.west : k.x < this.geo.wallX.east);
      if (t.laser < 2.2 && ahead && !shielded && Math.abs(k.y - m.y) < 0.9) this.w.hurtKnight(LASER_DAMAGE, m.x, m.y, 0.3);
      return;
    }
    if (t.pending && this.w.time >= t.pending.at) {
      // the rockets leave the launcher side by side down its lane (stage 1 fires only straight
      // ahead, later ones lean a little toward the knight), so a volley that misses the knight
      // flies on to the twin at the other end
      const aim = Math.atan2(k.y - m.y, k.x - m.x);
      const arc = t.stage === 1 ? 0 : 0.15;
      const h = face + Math.max(-arc, Math.min(arc, Math.atan2(Math.sin(aim - face), Math.cos(aim - face))));
      for (let i = 0; i < t.pending.n; i++) {
        const side = (i - (t.pending.n - 1) / 2) * 0.35;
        this.spawn(ROCKET, m.x + Math.cos(h) * 1.4 - Math.sin(h) * side, m.y + Math.sin(h) * 1.4 + Math.cos(h) * side, h, [["Type", "Normal"]]);
      }
      t.pending = null;
    }
    if (m.attack) return;
    t.cooldown -= dt;
    if (t.cooldown > 0) return;
    const r = Math.random();
    if (t.stage >= 2 && r < 0.3) {
      // move to another lane
      t.lane = (t.lane + 1 + Math.floor(Math.random() * 2)) % 3;
      t.targetY = this.geo.lanes[t.lane];
      t.cooldown = 0.4;
      return;
    }
    if (t.stage >= 3 && r < 0.45) {
      const charge = named(m, /Twins\/Laser Charge$/);
      if (charge) this.w.monsterAttack(m, charge);
      t.laser = 3;
      t.cooldown = 3;
      this.w.say(m.x, m.y, "Laser!", "#9fe8ff");
      return;
    }
    // rockets: two in stage 1, four from stage 2; a spread shot now and then
    if (r > 0.85) {
      const spread = named(m, /Spread Shot/);
      if (spread) { m.heading = Math.atan2(k.y - m.y, k.x - m.x); this.w.monsterAttack(m, spread); t.cooldown = 2; return; }
    }
    const n = t.stage === 1 ? 2 : 4;
    const atk = named(m, n === 2 ? /Rockets \(2\)$/ : /Rockets \(4\)$/);
    if (atk) this.w.monsterAttack(m, atk);
    t.pending = { at: this.w.time + 0.5, n };
    t.cooldown = t.stage === 1 ? 3.2 : 2.6;
  }

  /** The game's own factory: its toggle walls, yellow or purple up (they stop knights and rockets). */
  private yellowUp = true;
  private toggleWalls(yellow: boolean) {
    this.yellowUp = yellow;
    for (const p of this.w.props) {
      const m = /Toggle Walls\/(Yellow|Purple) Wall/.exec(p.entity.name);
      if (m) this.w.logic.signal(p.entity, this.ke, (m[1] === "Yellow") === yellow ? "close" : "open");
    }
  }

  /** A toggle switch was struck: the other walls come up. */
  struck(p: Prop) {
    if (this.real && /Toggle Walls\/Toggle$/.test(p.entity.name)) {
      this.toggleWalls(!this.yellowUp);
      this.w.effectAt("particle/fx_spark_metal.dat", p.x, p.y, 0.6);
    }
  }

  private raiseWall(side: Side) {
    this.wall = side;
    for (const s of ["west", "east"] as Side[]) {
      for (const e of [...this.w.logic.tagged(`twin wall ${s}`)]) {
        this.w.logic.signal(e, this.ke, s === side ? "close" : "open");
        // a blast wall: it stops rockets, not knights
        const p = e.game;
        if (p?.collisionId != null) { this.w.collisionMap.remove(p.collisionId); p.collisionId = null; }
      }
    }
    this.w.say(this.geo.wallX[side], this.cy, "Blast wall up", "#c9e6ff");
  }

  /** A twin's rocket in flight: stopped by its own side's raised wall, or exposing its brother. */
  bullet(x: number, y: number, heading: number, owner: Monster | null): boolean {
    if (!this.started || this.defeated) return false;
    const from: Side = owner ? (owner.entity === this.twins.west.e ? "west" : "east") : Math.cos(heading) > 0 ? "west" : "east";
    if (owner && owner.entity !== this.twins.west.e && owner.entity !== this.twins.east.e) return false;
    if (this.real) {
      // a raised toggle wall stops the rocket
      for (const p of this.w.props) {
        if (!p.open && /Toggle Walls\/(Yellow|Purple) Wall/.test(p.entity.name) && Math.abs(p.x - x) < 0.6 && Math.abs(p.y - y) < 0.6) {
          this.w.effectAt("particle/fx_spark_metal.dat", x, y, 0.6);
          return true;
        }
      }
    }
    if (this.wall === from && Math.abs(x - this.geo.wallX[from]) < 0.5 && Math.abs(y - this.cy) < this.arena.h / 2) {
      this.w.effectAt("particle/fx_spark_metal.dat", x, y, 0.6);
      return true;
    }
    const t = this.twins[other(from)], m = mon(t.e);
    if (m && Math.hypot(m.x - x, m.y - y) < m.radius + 0.9) {
      this.expose(t, m);
      return true;
    }
    return false;
  }

  private expose(t: Twin, m: Monster) {
    if (t.exposed > 0) return;
    t.exposed = EXPOSED;
    t.pending = null;
    t.laser = 0;
    this.exposures++;
    m.attack = null;
    const ex = named(m, /Twins\/Expose$/);
    if (ex) this.w.monsterAttack(m, ex);
    if (t.looks?.open) void this.w.setModel(m, t.looks.open);
    this.w.say(m.x, m.y, "Exposed!", "#ffe27a");
  }

  private win(t: Twin) {
    // when one twin falls in its last stage, its brother leaves and the fight is over
    const o = this.twins[other(t.side)];
    const e = t.e!;
    this.spawn(RT + "Parts/Corpse", e.x, e.y, e.rotation, [["Direction", t.side === "west" ? "West" : "East"]]);
    if (o.e && !o.e.destroyed) this.w.logic.destroy(o.e, this.ke);
    o.e = null;
    t.e = null;
    this.finish("Treasure/Monster/Construct/Roarmulus Loot", this.cx, this.cy);
  }

  damage(m: Monster, dmg: number): number {
    for (const t of Object.values(this.twins)) if (m.entity === t.e) return t.exposed > 0 ? dmg : 0;
    return dmg;
  }

  attacks(_m: Monster): AttackDef[] | null { return null; }
}

// ------------------------------------------------------------------ Lord Vanaduke

const VD = BOSS + "Vanaduke/";
/** The fight's order: bodies, the kneeling transition with its mask, and the last body. */
const VD_ORDER = ["Stage 1", "Mask Stage 1", "Stage 2", "Mask Stage 2", "Stage 3"];
const VD_BODY = /^Character\/NPC\/Monster\/Boss\/Vanaduke\/(?:Ultimate\/)?Stage (\d)$/;
const VD_MASK = /^Character\/NPC\/Monster\/Boss\/Vanaduke\/(?:Ultimate\/)?Mask Stage (\d)$/;
const VD_KNEEL = /^Character\/NPC\/Monster\/Boss\/Vanaduke\/(?:Ultimate\/)?Stage (\d) Complete$/;
const WATER_POT = "Dynamic/Lift Objects/Water Pot";
/** Seconds a doused mask stays wet (and can be hurt). */
const WET = 5;

export class VanadukeFight extends BossFight {
  /** His configs: Darkfire Vanaduke's (Vanaduke/Ultimate/) in the Shadow Lair. */
  private get vd() { return VD + (this.ultimate ? "Ultimate/" : ""); }
  /** Index into VD_ORDER. */
  step = 0;
  private body: Entity | null = null;
  private mask: Entity | null = null;
  private kneel: Entity | null = null;
  private wet = 0;
  private maskLooks: { wet: any; fire: any } | null = null;
  private minionT = 0;
  private debrisT = 0;
  private wait = 0;
  private pots: { at: [number, number]; e: Entity | null; t: number }[] = [];
  douses = 0;

  protected begin() {
    const a = this.arena;
    // water pots by the hall's four corners (the throne room's water to put out the mask); in
    // the game's own throne room, by its four sprite wells
    const wells = this.real ? this.w.props.filter(p => /Sprite Well/.test(p.entity.name)).map(p => {
      const d = Math.hypot(this.cx - p.x, this.cy - p.y) || 1;
      return [p.x + (this.cx - p.x) / d * 1.5, p.y + (this.cy - p.y) / d * 1.5] as [number, number];
    }) : [];
    const spots: [number, number][] = wells.length ? wells
      : [[a.x + 2.5, a.y + 2.5], [a.x + a.w - 2.5, a.y + 2.5], [a.x + 2.5, a.y + a.h - 2.5], [a.x + a.w - 2.5, a.y + a.h - 2.5]];
    for (const [x, y] of spots) this.pots.push({ at: [x, y], e: this.spawn(WATER_POT, x, y), t: 0 });
    // the game's own throne room seats him on its marker ("Vanaduke Start", whose swap to the
    // first stage is server code)
    const seated = this.real ? this.actors(/Vanaduke\/Vanaduke Start$/)[0] : null;
    if (seated) this.w.logic.vanish(seated);
    this.startStep(0, seated?.x ?? this.cx, seated?.y ?? this.cy + 3);
    this.w.say(this.cx, this.cy, "Lord Vanaduke!", "#ff9a5c");
  }

  private startStep(i: number, x: number, y: number) {
    this.step = i;
    const what = VD_ORDER[i];
    this.stage = what.toLowerCase();
    const face = Math.atan2(this.w.knight.y - y, this.w.knight.x - x);
    if (what.startsWith("Mask")) {
      // he kneels (Stage N Complete) and the burning mask leaves his face
      const n = what.slice(-1);
      this.kneel = this.spawn(`${this.vd}Stage ${n} Complete`, x, y, face);
      this.mask = this.spawn(`${this.vd}${what}`, x + Math.cos(face) * 2.5, y + Math.sin(face) * 2.5, face);
      this.wet = 0;
      this.w.say(x, y, "The mask burns!", "#ff9a5c");
    } else {
      // the last stage carries the game's own level's tag: its Actor Removed opens the way out
      const last = i === VD_ORDER.length - 1 && this.real;
      this.body = this.spawn(this.vd + what, x, y, face, last ? [["Wave Tag", "boss_stage5"]] : []);
      this.minionT = 1;
    }
  }

  protected tick(dt: number) {
    // water pots come back to their spot once used
    for (const p of this.pots) {
      if (p.e && !p.e.destroyed) continue;
      p.t += dt;
      if (p.t > 4) { p.e = this.spawn(WATER_POT, p.at[0], p.at[1]); p.t = 0; }
    }
    // falling debris over the hall: a shadow, then the rock (Part/Falling Debri)
    this.debrisT -= dt;
    if (this.debrisT <= 0) {
      this.debrisT = this.step >= 2 ? 1.6 : 2.4;
      const [x, y] = Math.random() < 0.4 ? [this.w.knight.x + (Math.random() - 0.5) * 3, this.w.knight.y + (Math.random() - 0.5) * 3] : this.randomPoint(2);
      this.spawn(VD + "Part/Falling Debri", x, y, 0, [["Fire Tiles", this.step >= 2 ? 2 : 0]]);
    }
    if (this.wait > 0) { this.wait -= dt; if (this.wait <= 0) this.startStep(this.step + 1, this.nextAt[0], this.nextAt[1]); return; }
    const what = VD_ORDER[this.step];
    if (what.startsWith("Mask")) this.tickMask(dt);
    else this.tickBody(dt);
  }

  private nextAt: [number, number] = [0, 0];

  private tickBody(dt: number) {
    const e = this.body;
    if (!e) return;
    if (e.destroyed) {
      if (this.step === VD_ORDER.length - 1) {
        const own = e.handlerConfigs.some(h => /\$Shutdown$/.test(h?.$class ?? "") && JSON.stringify(h).includes("TableSpawn"));
        this.finish(own ? null : "Treasure/Monster/Fiend/Vanaduke Loot", e.x, e.y);
        return;
      }
      // whatever its Shutdown spawned in its place gives way to the director's transition
      for (const x of this.actors(VD_KNEEL)) this.w.logic.destroy(x, this.ke);
      this.nextAt = [e.x, e.y];
      this.wait = 0.8;
      return;
    }
    const m = mon(e);
    if (!m) return;
    if (this.fresh(e)) this.sizeHealth(m, this.step === 4 ? 3 : 2.5);
    // Call Minions: four Slag Walkers (Royal Guards in the last stage), replaced when all fall
    const minionName = this.step === 4 ? "Character/NPC/Monster/Undead/Slag Guard" : VD + "Part/Slag Walker Minion";
    const minions = this.actors(/Slag Walker Minion|Undead\/Slag Guard$/);
    if (!minions.length) {
      this.minionT -= dt;
      if (this.minionT <= 0) {
        this.minionT = 8;
        const count = this.step === 4 ? 2 : 4;
        for (let i = 0; i < count; i++) {
          const ang = (i / count) * Math.PI * 2 + Math.PI / 4;
          this.spawn(minionName, m.x + Math.cos(ang) * 3.5, m.y + Math.sin(ang) * 3.5, ang, [["Loot", "Health Only"]]);
        }
        this.w.say(m.x, m.y, "Call Minions", "#ff9a5c");
      }
    }
  }

  private tickMask(dt: number) {
    const mk = this.mask, kn = this.kneel;
    if (kn) { const km = this.fresh(kn); if (km) km.scripted = true; }
    if (!mk) return;
    if (mk.destroyed) {
      // the mask is broken: he rises for the next stage
      const at: [number, number] = kn ? [kn.x, kn.y] : [mk.x, mk.y];
      if (kn && !kn.destroyed) this.w.logic.destroy(kn, this.ke);
      this.kneel = this.mask = null;
      this.nextAt = at;
      this.wait = 1;
      return;
    }
    const m = mon(mk);
    if (!m) return;
    if (this.fresh(mk)) {
      this.sizeHealth(m, 1);
      const cfg = this.w.data.resolveSync("config/actor.dat", ref(this.vd + VD_ORDER[this.step]), "actor");
      this.maskLooks = { wet: cfg?.sprite?.model, fire: cfg?.sprite?.flagModels?.[0]?.model };
      if (this.maskLooks.fire) void this.w.setModel(m, this.maskLooks.fire);
    }
    if (this.wet > 0) {
      this.wet -= dt;
      if (this.wet <= 0) {
        if (this.maskLooks?.fire) void this.w.setModel(m, this.maskLooks.fire);
        this.w.say(m.x, m.y, "The mask flares up", "#ff9a5c");
      }
    }
  }

  /** A water pot put down by the mask douses it. */
  dropped(p: Prop): boolean {
    if (!/Water Pot/.test(p.entity.name)) return false;
    const m = mon(this.mask);
    this.w.effectAt("particle/fx_watersplash.dat", p.x, p.y, 2);
    if (!m || Math.hypot(m.x - p.x, m.y - p.y) > 3.5) return true;
    this.douse(m);
    return true;
  }

  /** Puts the mask out for a few seconds (it can be hurt while wet). */
  douse(m: Monster) {
    this.wet = WET;
    this.douses++;
    if (this.maskLooks?.wet) void this.w.setModel(m, this.maskLooks.wet);
    this.w.say(m.x, m.y, "Doused!", "#9fd8ff");
  }

  damage(m: Monster, dmg: number): number {
    const name = m.entity?.name ?? "";
    if (VD_MASK.test(name)) return this.wet > 0 ? dmg : 0;
    if (VD_KNEEL.test(name)) return 0;
    return dmg;
  }

  attacks(m: Monster): AttackDef[] | null {
    const name = m.entity?.name ?? "";
    if (VD_BODY.test(name)) return m.def.attacks.filter(a => !/Vanaduke\/(Swap|Spawn Mask|Activate|Monologue|Spawn Minions|Call Minions|Spawn Flame)/.test(a.name));
    return null;
  }
}

/** Starts a boss fight's director in a world playing that boss's arena. */
/**
 * Starts a boss fight's director in a world playing that boss's level: a generated arena, or
 * (`real`) the game's own boss level from the archive.
 */
export function startBossFight(key: BossKey, w: World, real = false, ultimate = false): BossFight {
  const plan = arenaPlan(key);
  const fight = key === "jelly" ? new JellyFight(key, w, plan, real, ultimate) : key === "snarbolax" ? new SnarbolaxFight(key, w, plan, real, ultimate)
    : key === "twins" ? new TwinsFight(key, w, plan, real, ultimate) : new VanadukeFight(key, w, plan, real, ultimate);
  w.boss = fight;
  return fight;
}
