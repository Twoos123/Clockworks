// Battle sprites: the companions (Drakon, Maskeraith, Seraphynx and their variants) from
// config/battle_sprite.dat. A sprite floats beside the knight, idles and plays its attack
// animations (character/pet/animation/default), and has three skills with recharge times.
// Each skill is an attack in config/attack.dat ("Sprite/Drakon/Firebolt"...) whose fire
// actions spawn pet bullets, orbitals, lasers and bombs ("Bullet/Pet/..." in actor.dat),
// apply buffs and battle-sprite conditions, or raise a sprite shield.
//
// Progress follows the client's tables (SpriteCodes, sprites/b/a, BattleSprite) and the wiki:
// levels 0 to 99, shown 1 to 100. Feeding sprite food fills the heat bar (a fifth at most per
// feeding, the favoured food counting five times) and takes a fifth of the appetite, which
// refills over an hour; a full bar waits for the required item (the favoured food of the
// sprite's tier, or an evo catalyst before levels 15, 50, 90, 95 and 100) to level up. The
// second skill unlocks at 15 and the third at 50 (each with a new form, the model's tiers);
// skill points come at the levels in SpriteCodes.bGL, 27 in all; each skill has three augments
// (its powers: "focus" shortens the recharge along rechargeSeconds, the other two are the
// skill's Power1 and Power2 arguments) of three ranks at a point each, and with all nine spent
// and level 90, 95 or 100 reached it may take an ultimate form. Food values are tuning.
//
// The runtime (SpriteCompanion) talks to the world through SpriteWorld, which World builds
// from its own internals, so the world needs only a few hooks: update, items, shadows, the
// cloak (monsters lose the knight) and the sprite shield (absorbs hits).

import { CONFIG_REF, getArg } from "../config/params";
import { compose, type Mat4 } from "../math";
import type { AnimationClip, ModelLoader } from "../model";
import type { ModelInstance, Renderer } from "../render/renderer";
import type { GameData } from "./data";
import type { DepthContext } from "./depth";

// ------------------------------------------------------------------ definitions

export interface NamedIcon { name: string; icon: any; desc: string }

export interface SpriteSkillDef {
  /** The skill's attack (with Power1, Power2 arguments) and its two ultimate forms. */
  skill: any;
  ultimateA: any;
  ultimateB: any;
  /** Recharge seconds by focus rank (0 to 3). */
  recharge: number[];
  /** The least recharge seconds by focus rank (0: none). */
  minRecharge: number[];
  /** The sprite stays with the knight while the skill runs (barriers, cloaks, auras). */
  followKnight: boolean;
  label: NamedIcon;
  ultimateLabels: [NamedIcon | null, NamedIcon | null];
  /** The three augments: focus, then the Power1 and Power2 perks. */
  powers: NamedIcon[];
}

export interface SpriteDef {
  name: string;
  /** Message key of the sprite's name ("m.drakon", "m.divine_sprite|m.drakon"). */
  spriteName: string;
  /** Message key of its description in the sprites bundle (BattleSpriteConfig.desc), or "". */
  desc: string;
  /** Models by tier (1 to 3). */
  models: [any, any, any];
  icons: [any, any, any];
  /** Favoured food item names. */
  food: string[];
  skills: SpriteSkillDef[];
  damageType: string;
}

const named = (n: any): NamedIcon | null => n ? { name: String(n.name ?? ""), icon: n.icon ?? null, desc: String(n.desc ?? "") } : null;

/** A BattleSpriteConfig as a definition. */
export function readSpriteDef(cfg: any): SpriteDef {
  return {
    name: String(cfg.name), spriteName: String(cfg.spriteName ?? ""), desc: typeof cfg.desc === "string" ? cfg.desc : "",
    models: [cfg.tier1 ?? null, cfg.tier2 ?? cfg.tier1 ?? null, cfg.tier3 ?? cfg.tier2 ?? cfg.tier1 ?? null],
    icons: [cfg.icon1 ?? null, cfg.icon2 ?? null, cfg.icon3 ?? null],
    food: ((cfg.preferredFood ?? []) as any[]).map(f => f?.ref?.name).filter((n): n is string => !!n),
    skills: ((cfg.skills ?? []) as any[]).map(s => ({
      skill: s.skill ?? null, ultimateA: s.uSkillA ?? null, ultimateB: s.uSkillB ?? null,
      recharge: Array.from((s.rechargeSeconds ?? [20, 18, 16, 14]) as ArrayLike<number>),
      minRecharge: Array.from((s.minRechargeSeconds ?? []) as ArrayLike<number>),
      followKnight: !!s.followKnight,
      label: named(s.name) ?? { name: "", icon: null, desc: "" },
      ultimateLabels: [named(s.ultimateNameA), named(s.ultimateNameB)],
      powers: ((s.powerNames ?? []) as any[]).map(p => named(p)!).filter(Boolean),
    })),
    damageType: String(cfg.restrictDamageType?.name ?? cfg.restrictDamageType ?? "").split(".").pop() ?? "",
  };
}

// ------------------------------------------------------------------ progress (pure)

/**
 * The top level (BattleSprite's _level runs 0 to 99 and shows one more: "01" to "100"). The
 * five perk levels past it are not modelled.
 */
export const MAX_LEVEL = 99;
/** SpriteCodes.bGM: the levels at which the skills unlock and the sprite changes form ("15" and "50" shown). */
export const SKILL_LEVELS = [0, 14, 49];
/** SpriteCodes.bGN: the levels whose skill can take an ultimate form ("90", "95", "100" shown). */
export const ULTIMATE_LEVELS = [89, 94, 99];
export const MAX_RANK = 3;
export type Ultimate = "" | "A" | "B";
/** SpriteCodes.bGL: the levels that bring a skill point (27, enough for every augment). */
const POINT_LEVELS = [1, 3, 5, 7, 9, 11, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 51, 54, 57, 61, 65, 69, 73, 77, 81, 85];
/** SpriteCodes.bGK: the levels where the sprite's food tier (and the knight rank it needs) goes up. */
const FOOD_TIERS = [0, 4, 14, 29, 49, 74];
/** SpriteCodes.bGP: the evo catalysts that take a sprite to these levels instead of its food. */
const CATALYSTS: Record<number, string> = {
  14: "Rarity/Evo Catalyst/Evo Catalyst", 49: "Rarity/Evo Catalyst/Advanced Evo Catalyst",
  89: "Rarity/Evo Catalyst/Ultimate Evo Catalyst", 94: "Rarity/Evo Catalyst/Ultimate Evo Catalyst", 99: "Rarity/Evo Catalyst/Ultimate Evo Catalyst",
};
/** sprites/b/a.bGX: the heat value a level holds (SpriteCodes.bGR's steps, interpolated across each food tier). */
const LEVEL_HEAT = (() => {
  const steps = [300, 500, 700, 900, 1100, 1300, 1500], out: number[] = [];
  let tier = 0, from = 0, to = 0, start = 0, next = 0;
  for (let l = 0; l <= 99; l++) {
    if (l === next && l !== 99) { start = l; tier++; next = tier >= FOOD_TIERS.length ? 99 : FOOD_TIERS[tier]; from = steps[tier - 1]; to = steps[tier]; }
    out.push(10 * Math.round(from + (to - from) * (l - start) / (next - start)));
  }
  return out;
})();
/** An hour of appetite (BattleSprite.ao), and what one feeding takes (sprites/b/a.aC: twelve minutes, a fifth). */
export const APPETITE_MS = 3_600_000;
export const BITE_MS = 720_000;

export interface SpriteProgress {
  /** The battle sprite config name ("Drakon", "Seraphynx, Black"). */
  name: string;
  /** 0 to 99 (shown one more). */
  level: number;
  /** The heat bar, 0 to 1 (BattleSprite._heatProgress); full, the sprite waits for its required item. */
  heat: number;
  /** When the sprite was last full (BattleSprite._lastFull, ms), or 0: appetite refills over an hour from it. */
  fullAt: number;
  /** Augment ranks per skill: [focus, power 1, power 2], 0 to 3. */
  ranks: number[][];
  ultimates: Ultimate[];
}

export const newProgress = (name: string): SpriteProgress =>
  ({ name, level: 0, heat: 0, fullAt: 0, ranks: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], ultimates: ["", "", ""] });

/** A saved progress record, repaired. */
export function normalizeProgress(p: Partial<SpriteProgress> | undefined, name: string): SpriteProgress {
  const out = newProgress(name);
  if (!p) return out;
  out.level = clampInt(p.level, 0, MAX_LEVEL);
  const heat = Math.max(0, Number(p.heat) || 0);
  // older saves kept heat in units of 20 + 4 per level
  out.heat = heat <= 1 ? heat : Math.min(0.99, heat / (20 + out.level * 4));
  out.fullAt = Math.max(0, Number(p.fullAt) || 0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) out.ranks[i][j] = clampInt(p.ranks?.[i]?.[j], 0, MAX_RANK);
    const u = p.ultimates?.[i];
    out.ultimates[i] = u === "A" || u === "B" ? u : "";
  }
  return out;
}

const clampInt = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));

/** The model tier (1 to 3): a new form with the second and third skills. */
export const spriteTier = (level: number) => level >= SKILL_LEVELS[2] ? 3 : level >= SKILL_LEVELS[1] ? 2 : 1;
/** Skills usable at a level (1 to 3). */
export const unlockedSkills = (level: number) => SKILL_LEVELS.filter(l => level >= l).length;
/** Skill points a level has brought (sprites/b/a.fL). */
export const skillPoints = (level: number) => POINT_LEVELS.filter(l => l <= clampInt(level, 0, MAX_LEVEL)).length;
export const spentPoints = (p: SpriteProgress) => p.ranks.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0);
/** BattleSprite.YY: points to spend. */
export const freePoints = (p: SpriteProgress) => Math.max(0, skillPoints(p.level) - spentPoints(p));
/** The food tier at a level (BattleSprite.fK, 0 to 5): which favoured food it wants, and the star rank whose knight rank it needs. */
export function foodTier(level: number): number {
  for (let i = FOOD_TIERS.length - 1; i >= 0; i--) if (level >= FOOD_TIERS[i]) return i;
  return 0;
}
/** The heat value a level holds (a feeding fills a fifth of the bar at most). */
export const heatToNext = (level: number) => LEVEL_HEAT[clampInt(level, 0, 99)];
/**
 * A food's heat value by star rating (1 Mote to 5 Star); the favoured food counts five times
 * (SpriteCodes.FoodType PREFERRED). The values are tuning: the server's are not in the client.
 */
const FOOD_VALUE = [0, 600, 1500, 3000, 6000, 12000];
export const foodHeat = (stars: number, favoured: boolean) => FOOD_VALUE[clampInt(stars, 0, 5)] * (favoured ? 5 : 1);
/** Whether the heat bar is full and the sprite waits for its required item (BattleSprite.YW). */
export const readyToLevel = (p: SpriteProgress) => p.heat >= 1 && p.level < MAX_LEVEL;

/**
 * Adds a feeding's heat (sprites/b/a.a): a fifth of the bar at most, in proportion to the
 * food's value against the level's. Returns the bar's new fill.
 */
export function addHeat(p: SpriteProgress, value: number): number {
  if (p.level >= MAX_LEVEL) { p.heat = 1; return 1; }
  p.heat = Math.min(1, Math.max(0, p.heat + 0.2 * Math.min(1, value / heatToNext(p.level))));
  if (p.heat > 0.9999) p.heat = 1;
  return p.heat;
}

/** BattleSprite.ac: the item a full sprite needs (an evo catalyst at its breakpoints), else its favoured food for the tier. */
export function requiredItem(def: SpriteDef, p: SpriteProgress): string | null {
  if (readyToLevel(p) && CATALYSTS[p.level + 1]) return CATALYSTS[p.level + 1];
  if (!def.food.length) return null;
  return def.food[Math.min(Math.max(0, foodTier(p.level) - 1), def.food.length - 1)];
}

/** The star rating whose knight rank the next level needs (BattleSprite.r). */
export const nextLevelRarity = (p: SpriteProgress) => foodTier(p.level + 1);

/** Appetite left (BattleSprite.ao), 0 to 1: a fifth is one feeding. */
export const appetite = (p: SpriteProgress, now: number) => !p.fullAt ? 1 : Math.min(APPETITE_MS, Math.max(0, now - p.fullAt)) / APPETITE_MS;
/** Whether the sprite has room for a feeding (BattleSprite.a: a fifth of the hour left). */
export const canEat = (p: SpriteProgress, now: number) => !p.fullAt || now - p.fullAt >= BITE_MS;
/** A feeding takes a fifth of the appetite. */
export function eat(p: SpriteProgress, now: number) { p.fullAt = Math.max(p.fullAt, now - APPETITE_MS) + BITE_MS; }

/** Takes a full sprite to its next level with its required item. */
export function levelUp(def: SpriteDef, p: SpriteProgress, item: string): boolean {
  if (!readyToLevel(p) || item !== requiredItem(def, p)) return false;
  p.level++;
  p.heat = p.level >= MAX_LEVEL ? 1 : 0;
  return true;
}

/** Raises an augment (skill 0 to 2, power 0 focus, 1 or 2 a perk) by one rank. */
export function spendPoint(p: SpriteProgress, skill: number, power: number): boolean {
  if (skill < 0 || skill > 2 || power < 0 || power > 2) return false;
  if (skill >= unlockedSkills(p.level) || freePoints(p) <= 0 || p.ranks[skill][power] >= MAX_RANK || p.ultimates[skill]) return false;
  p.ranks[skill][power]++;
  return true;
}

/** Spends free points round-robin over the unlocked skills (the default build). */
export function autoSpend(p: SpriteProgress) {
  let progress = true;
  while (freePoints(p) > 0 && progress) {
    progress = false;
    for (let power = 0; power < 3; power++) for (let s = 0; s < unlockedSkills(p.level); s++) {
      if (freePoints(p) > 0 && spendPoint(p, s, power)) progress = true;
    }
  }
}

/** Gives back every point and ultimate (the Reset Star). */
export function resetPoints(p: SpriteProgress) { p.ranks = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; p.ultimates = ["", "", ""]; }

/** Whether a skill may take its ultimate form now (BattleSprite.fI: its level reached, all nine points in it, none chosen). */
export const ultimateReady = (p: SpriteProgress, skill: number) =>
  skill >= 0 && skill < 3 && p.level >= ULTIMATE_LEVELS[skill] && !p.ultimates[skill] && p.ranks[skill].reduce((a, b) => a + b, 0) >= 3 * MAX_RANK;

/** Picks a skill's ultimate form (or "" for the normal one), once its level is reached. */
export function chooseUltimate(p: SpriteProgress, skill: number, u: Ultimate): boolean {
  if (skill < 0 || skill > 2 || p.level < ULTIMATE_LEVELS[skill]) return false;
  p.ultimates[skill] = u;
  return true;
}

/** Recharge seconds of a skill at its focus rank (BattleSprite.g: times the harness's modifier, at least the skill's minimum). */
export function rechargeOf(def: SpriteDef, p: SpriteProgress, skill: number, harness = 1): number {
  const s = def.skills[skill], rank = p.ranks[skill]?.[0] ?? 0;
  const r = s?.recharge ?? [20];
  const base = Math.trunc((r[Math.min(r.length - 1, rank)] ?? 20) * 1000 * harness);
  const mins = s?.minRecharge ?? [];
  const min = (mins[Math.min(Math.max(0, mins.length - 1), rank)] ?? 0) * 1000;
  return Math.trunc(Math.max(min || base, base) / 1000);
}

/** The attack reference a skill uses: an ultimate form, or the skill with its perk ranks. */
export function skillAttackRef(def: SpriteDef, p: SpriteProgress, skill: number): any | null {
  const s = def.skills[skill];
  if (!s) return null;
  const u = p.ultimates[skill];
  if (u === "A" && s.ultimateA) return s.ultimateA;
  if (u === "B" && s.ultimateB) return s.ultimateB;
  if (!s.skill?.name) return null;
  const entries: [string, unknown][] = [...(s.skill.arguments?.entries ?? [])].filter(([k]) => k !== "Power1" && k !== "Power2");
  entries.push(["Power1", String(p.ranks[skill][1])], ["Power2", String(p.ranks[skill][2])]);
  return { ...s.skill, arguments: { $map: "com.threerings.config.ArgumentMap", entries } };
}

// ------------------------------------------------------------------ the roster (save)

export interface SpriteSave {
  /** The sprite taken into the field, or "" for none. */
  active: string;
  /** Whether the player has chosen (the "Choose Your Sprite" mission sets it). */
  chosen: boolean;
  sprites: Record<string, SpriteProgress>;
}

/** The dev and default companion until the missions offer the choice. */
export const DEFAULT_SPRITE = "Drakon";
/** The three sprites the "Choose Your Sprite" mission offers. */
export const STARTER_SPRITES = ["Drakon", "Maskeraith", "Seraphynx"];

export function normalizeSpriteSave(s: Partial<SpriteSave> | undefined | null): SpriteSave {
  // a knight has no sprite until one is chosen (the "Choose Your Sprite" missions, rank 2)
  const out: SpriteSave = { active: typeof s?.active === "string" ? s.active : "", chosen: !!s?.chosen, sprites: {} };
  for (const [k, v] of Object.entries(s?.sprites ?? {})) out.sprites[k] = normalizeProgress(v, k);
  if (out.active && !out.sprites[out.active]) out.sprites[out.active] = newProgress(out.active);
  return out;
}

const take = (m: Record<string, number>, item: string) => { m[item]--; if (m[item] <= 0) delete m[item]; };

/** Food item star ratings (Mote 1 to Star 5), by the item's name. */
export function foodStars(item: string): number {
  const m = /\b(Mote|Dust|Stone|Orb|Star)\b/.exec(item);
  return m ? ["Mote", "Dust", "Stone", "Orb", "Star"].indexOf(m[1]) + 1 : 0;
}

/**
 * The player's sprites over the save: choose one (missions call setSprite), feed it, spend
 * its points. UI-independent; `onChange` tells the game to refresh the companion.
 */
export class SpriteRoster {
  onChange: (() => void) | null = null;
  constructor(private readonly save: () => { sprites?: SpriteSave; materials: Record<string, number> },
    private readonly persist: () => void, private readonly defs: () => Map<string, SpriteDef>) {}

  private get state(): SpriteSave {
    const s = this.save();
    s.sprites = normalizeSpriteSave(s.sprites);
    return s.sprites;
  }

  /** The sprite in the field, or null. */
  active(): SpriteProgress | null {
    const st = this.state;
    return st.active ? st.sprites[st.active] ?? null : null;
  }

  /** Every sprite config name. */
  names(): string[] { return [...this.defs().keys()]; }

  /** Chooses the sprite to take along (a battle sprite config name), or "" for none. */
  setSprite(name: string): boolean {
    if (name && !this.defs().has(name)) return false;
    const st = this.state;
    st.active = name;
    st.chosen = true;
    if (name && !st.sprites[name]) st.sprites[name] = newProgress(name);
    this.save().sprites = st;
    this.changed();
    return true;
  }

  private changed() { this.persist(); this.onChange?.(); }

  /**
   * Feeds the active sprite one food item from the materials (LoadoutPanel's FEED SPRITE):
   * "" when it ate, else the projectx bundle's error key (no appetite, a full bar).
   */
  feed(item: string, now = Date.now()): string {
    const p = this.active(), def = p ? this.defs().get(p.name) : null;
    const s = this.save();
    const stars = foodStars(item);
    if (!p || !def || (s.materials[item] ?? 0) <= 0 || !stars) return "e.wrong_level_item";
    if (readyToLevel(p) || p.level >= MAX_LEVEL) return "e.wrong_level_item";
    if (!canEat(p, now)) return "e.not_enough_appetite";
    take(s.materials, item);
    eat(p, now);
    addHeat(p, foodHeat(stars, def.food.includes(item)));
    this.changed();
    return "";
  }

  /** LEVEL UP!: a full sprite eats its required item and goes up a level; false when it cannot. */
  levelUp(item: string): boolean {
    const p = this.active(), def = p ? this.defs().get(p.name) : null;
    const s = this.save();
    if (!p || !def || (s.materials[item] ?? 0) <= 0 || !levelUp(def, p, item)) return false;
    take(s.materials, item);
    this.changed();
    return true;
  }

  spend(skill: number, power: number): boolean {
    const p = this.active();
    const ok = !!p && spendPoint(p, skill, power);
    if (ok) this.changed();
    return ok;
  }

  ultimate(skill: number, u: Ultimate): boolean {
    const p = this.active();
    const ok = !!p && chooseUltimate(p, skill, u);
    if (ok) this.changed();
    return ok;
  }

  /** Dev: sets the active sprite's level (points spent automatically). */
  setLevel(level: number) {
    const p = this.active();
    if (!p) return;
    p.level = clampInt(level, 0, MAX_LEVEL);
    p.heat = 0;
    resetPoints(p);
    autoSpend(p);
    this.changed();
  }
}

/** Reads every battle sprite definition (config/battle_sprite.dat). */
export async function loadSpriteDefs(loader: ModelLoader): Promise<Map<string, SpriteDef>> {
  const root: any = await loader.importFile("config/battle_sprite.dat");
  const list: any[] = Array.isArray(root) ? root : root?.array ?? [];
  return new Map(list.filter(c => c?.name && c.skills).map(c => [String(c.name), readSpriteDef(c)]));
}

// ------------------------------------------------------------------ runtime

/** What a companion needs from the world. Positions are world units; z is up. */
export interface SpriteWorld {
  data: GameData;
  loader: ModelLoader;
  renderer: Renderer;
  knight(): SpriteTarget & { heading: number; dead: boolean; maxHealth: number; matrix(): Mat4 };
  /** Monsters that can be struck. */
  monsters(): SpriteTarget[];
  clip(ref: any): AnimationClip | null;
  preload(...refs: any[]): Promise<void>;
  groundZ(x: number, y: number): number;
  /** Whether a wall blocks a bullet at a point. */
  blocked(x: number, y: number, r: number): boolean;
  ctx(rarity: number): DepthContext;
  evaluate(depthScale: any, ctx: DepthContext): number;
  /** Deals a DamageConfig (depth-scaled, compound, with statuses) to a monster. */
  damage(target: SpriteTarget, damage: any, ctx: DepthContext, knockback: number, fromX: number, fromY: number): void;
  /** Applies a status condition the world models (fire, poison, buffs...); `chance` overrides the condition's own. */
  applyStatus(target: SpriteTarget, ref: any, ctx: DepthContext, chance?: number): void;
  heal(amount: number): void;
  effect(ref: any, matrix: Mat4, life: number, followKnight?: boolean): void;
  /** Runs an instance's pending frame actions (sounds, transients) at a matrix. */
  events(instance: ModelInstance, matrix: Mat4): void;
  floater(x: number, y: number, z: number, text: string, color: string): void;
}

/** A knight or monster as the sprite sees it. */
export interface SpriteTarget { x: number; y: number; z: number; radius: number; health: number }

const kind = (o: any) => String(o?.$class ?? "").split("$").pop() ?? "";
const IDLE = "character/pet/animation/default/animation_idle-001.dat";
const EAT = "character/pet/animation/default/animation_eatitem.dat";
/** Where the sprite floats relative to the knight (behind and to the left) and how high. */
const OFFSET = { back: 0.6, side: 0.75, height: 0.9 };
/** How close the sprite flies to a target before striking (tuning). */
const STRIKE_RANGE = 2.2;
/** How far from the knight the sprite looks for targets. */
const TARGET_RANGE = 12;
/** Pet bullet speed when the actor config leaves it at the class default (tuning). */
const BULLET_SPEED = 12;

interface SkillRuntime {
  attack: any | null;
  cooldown: number;
  recharge: number;
}

/** A spawned pet actor: bullet, bomb, orbital or laser. */
interface PetActor {
  kind: "Bullet" | "Bomb" | "Orbital" | "Laser";
  cfg: any;
  x: number; y: number; z: number; heading: number;
  age: number;
  /** Seconds to live. */
  life: number;
  instance: ModelInstance | null;
  done: boolean;
  /** Timer handlers: next time, interval, remaining count, action. */
  timers: { at: number; interval: number; left: number; action: any }[];
  /** Orbitals: angle and radius around the knight; lasers: length. */
  angle?: number; radius?: number; length?: number;
  /** Monsters already struck (bullets pass through nothing; orbitals rehit after a pause). */
  struck?: Map<SpriteTarget, number>;
  nextDamage?: number;
}

/** Battle-sprite conditions the world does not model, tracked here. */
interface Mark { target: SpriteTarget; cfg: any; remaining: number; kind: string; lastHealth: number; tick: number }

export class SpriteCompanion {
  x = 0; y = 0; z = 0;
  heading = -Math.PI / 2;
  instance: ModelInstance | null = null;
  readonly skills: SkillRuntime[] = [];
  /** The skill being performed: phase, time, fire refs run. */
  private act: { skill: number; cfg: any; phase: "start" | "fire" | "end"; t: number; fired: boolean; aim: number;
    /** Skills that do not stay with the knight fly the sprite to its target first. */
    target: SpriteTarget | null } | null = null;
  private readonly actors: PetActor[] = [];
  private readonly marks: Mark[] = [];
  private readonly timed: { t: number; run: () => void }[] = [];
  /** Seconds the knight stays cloaked (monsters lose track of it). */
  cloak = 0;
  /** Sprite shield: health left and seconds until it fades. */
  shield = 0;
  shieldTime = 0;
  /** Hotkey labels for the HUD's sprite slots. */
  hotkeys: string[] = ["R", "T", "G"];
  private tier = 0;
  private loading = false;
  private disposed = false;

  constructor(readonly def: SpriteDef, readonly progress: SpriteProgress, private readonly w: SpriteWorld) {
    for (let i = 0; i < 3; i++) this.skills.push({ attack: null, cooldown: 0, recharge: rechargeOf(def, progress, i) });
    const k = w.knight();
    this.placeNear(k, 1);
  }

  /** The status panel's pet portrait (hud/I.Kv): the sprite's model for its form, idling. */
  portrait(): { ref: any; idle: string } | null {
    const ref = this.def.models[spriteTier(this.progress.level) - 1];
    return ref ? { ref, idle: IDLE } : null;
  }

  /** Loads the model for the current tier and the skills' attacks. */
  async load() {
    await Promise.all([this.loadModel(), this.loadSkills()]);
  }

  /** Re-reads the progress (after feeding or spending points): new form, recharges and skills. */
  async refresh() {
    for (let i = 0; i < 3; i++) this.skills[i].recharge = rechargeOf(this.def, this.progress, i);
    await this.load();
  }

  dispose() { this.disposed = true; this.actors.length = 0; this.marks.length = 0; }

  private async loadModel() {
    const tier = spriteTier(this.progress.level);
    if (tier === this.tier || this.loading) return;
    this.loading = true;
    try {
      const ref = this.def.models[tier - 1];
      const model = ref ? await this.w.loader.loadRef(ref).catch(() => null) : null;
      if (!model || this.disposed) return;
      const inst = await this.w.renderer.instantiate(model);
      await this.w.preload(IDLE, EAT);
      this.instance = inst;
      this.tier = tier;
      this.playIdle(true);
    } finally { this.loading = false; }
  }

  private async loadSkills() {
    await this.w.data.preload("config/attack.dat", "config/actor.dat", "config/fire_action.dat", "config/status_condition.dat");
    for (let i = 0; i < 3; i++) {
      const ref = skillAttackRef(this.def, this.progress, i);
      const a = ref ? await this.w.data.resolve("config/attack.dat", ref, "attack") : null;
      this.skills[i].attack = a && kind(a) === "Original" ? a : null;
      if (a) await this.w.preload(a.start, a.fire, a.end);
    }
  }

  /** Whether skill i can be used now. */
  ready(i: number) { return i < unlockedSkills(this.progress.level) && !!this.skills[i]?.attack && this.skills[i].cooldown <= 0 && !this.act; }

  /** Uses skill i (0 to 2); false when locked, recharging or busy. */
  use(i: number): boolean {
    const k = this.w.knight();
    if (k.dead || !this.ready(i)) return false;
    const s = this.skills[i];
    const target = this.nearestTarget(k.x, k.y, TARGET_RANGE);
    const aim = target ? Math.atan2(target.y - this.y, target.x - this.x) : k.heading;
    this.act = { skill: i, cfg: s.attack, phase: "start", t: 0, fired: false, aim, target: this.def.skills[i].followKnight ? null : target };
    s.cooldown = s.recharge;
    this.heading = aim;
    if (!this.anim(s.attack.start, s.attack.startSpeed ?? 1)) this.enterFire();
    return true;
  }

  /** The HUD's sprite slots: icon, seconds left, ready, locked, hotkey. */
  hud(): { icon: any; seconds: number; ready: boolean; locked: boolean; hotkey: string }[] {
    return this.def.skills.slice(0, 3).map((s, i) => {
      const u = this.progress.ultimates[i];
      const label = (u === "A" ? s.ultimateLabels[0] : u === "B" ? s.ultimateLabels[1] : null) ?? s.label;
      return { icon: label.icon, seconds: Math.max(0, Math.ceil(this.skills[i].cooldown)), ready: this.ready(i),
        locked: i >= unlockedSkills(this.progress.level), hotkey: this.hotkeys[i] ?? "" };
    });
  }

  /** Plays the eating animation (after feeding). */
  eat() { const c = this.w.clip(EAT); if (c && this.instance && !this.act) this.instance.play(c, { loop: false, blend: 0.1 }); }

  /** Monsters lose track of the knight while cloaked. */
  hidesKnight() { return this.cloak > 0; }

  /** A hit on the knight: the sprite shield takes what it can; returns what gets through. */
  absorb(damage: number): number {
    if (this.shield <= 0) return damage;
    const taken = Math.min(this.shield, damage);
    this.shield -= taken;
    const k = this.w.knight();
    this.w.floater(k.x, k.y, k.z + 1.6, `${Math.round(taken)}`, "#9fe8ff");
    return damage - taken;
  }

  private anim(ref: any, speed: number): boolean {
    const c = ref ? this.w.clip(ref) : null;
    if (!c || !this.instance) return false;
    this.instance.play(c, { loop: false, speed, blend: 0.08 });
    return true;
  }

  private playIdle(force = false) {
    const inst = this.instance;
    if (!inst) return;
    if (!force && inst.clip?.path?.endsWith("animation_idle-001.dat")) return;
    if (!force && inst.clip && !inst.finished) return;
    const c = this.w.clip(IDLE);
    if (c) inst.play(c, { loop: true, blend: 0.2 });
  }

  private placeNear(k: { x: number; y: number; z: number; heading: number }, f: number) {
    const c = Math.cos(k.heading), s = Math.sin(k.heading);
    // behind the knight and to its left (left of facing is +90 degrees)
    const tx = k.x - c * OFFSET.back - s * OFFSET.side, ty = k.y - s * OFFSET.back + c * OFFSET.side;
    this.x += (tx - this.x) * f;
    this.y += (ty - this.y) * f;
    const tz = this.w.groundZ(this.x, this.y) + OFFSET.height;
    this.z += (Math.max(tz, k.z + OFFSET.height * 0.6) - this.z) * f;
  }

  private nearestTarget(x: number, y: number, range: number): SpriteTarget | null {
    let best: SpriteTarget | null = null, bd = range;
    for (const m of this.w.monsters()) {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  matrix(): Mat4 {
    const a = this.heading + Math.PI / 2;
    return compose([this.x, this.y, this.z], [0, 0, Math.sin(a / 2), Math.cos(a / 2)], 1);
  }

  update(dt: number) {
    const k = this.w.knight();
    for (const s of this.skills) s.cooldown = Math.max(0, s.cooldown - dt);
    this.cloak = Math.max(0, this.cloak - dt);
    if (this.shieldTime > 0 && (this.shieldTime -= dt) <= 0) this.shield = 0;
    // float beside the knight; turn the way it faces (or toward the attack)
    const t = this.act?.target;
    if (t && this.act!.phase !== "end") {
      // close in on the target, stopping short of it, then face it
      const dx = t.x - this.x, dy = t.y - this.y, d = Math.hypot(dx, dy);
      const step = Math.min(Math.max(0, d - STRIKE_RANGE), dt * 9);
      if (d > 1e-3) { this.x += dx / d * step; this.y += dy / d * step; }
      this.z += (this.w.groundZ(this.x, this.y) + OFFSET.height - this.z) * (1 - Math.exp(-dt * 5));
      this.act!.aim = Math.atan2(dy, dx);
    } else this.placeNear(k, 1 - Math.exp(-dt * 5));
    const want = this.act ? this.act.aim : k.heading;
    const d = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
    this.heading += Math.sign(d) * Math.min(Math.abs(d), dt * 8);
    if (this.instance) {
      this.instance.time += dt;
      this.w.events(this.instance, this.matrix());
    }
    this.advance(dt);
    if (!this.act) this.playIdle();
    for (const t of [...this.timed]) if ((t.t -= dt) <= 0) { this.timed.splice(this.timed.indexOf(t), 1); t.run(); }
    this.updateActors(dt);
    this.updateMarks(dt);
  }

  private enterFire() {
    const a = this.act!;
    a.phase = "fire";
    a.t = 0;
    if (!this.anim(a.cfg.fire, a.cfg.fireSpeed ?? 1)) a.t = 0;
  }

  private advance(dt: number) {
    const a = this.act;
    if (!a) return;
    a.t += dt;
    const done = () => !this.instance || this.instance.finished;
    const far = a.target && Math.hypot(a.target.x - this.x, a.target.y - this.y) > STRIKE_RANGE + 0.3 && a.t < 1.5;
    if (a.phase === "start" && !far && (done() || a.t > 2)) this.enterFire();
    else if (a.phase === "fire") {
      if (!a.fired) { a.fired = true; this.fire(a.cfg, a.aim); }
      if (done() || a.t > 2.5) {
        a.phase = "end";
        a.t = 0;
        if (!this.anim(a.cfg.end, a.cfg.endSpeed ?? 1)) this.act = null;
      }
    } else if (a.phase === "end" && (done() || a.t > 2)) this.act = null;
  }

  private ctx(): DepthContext {
    // sprites strike like gear of their form: two stars at first, five at full level (tuning)
    const lv = this.progress.level;
    return this.w.ctx(lv >= MAX_LEVEL ? 5 : 1 + spriteTier(lv));
  }

  /** Runs an attack's fire actions (FireActionReferences). */
  private fire(cfg: any, aim: number) {
    for (const fr of cfg.fireRefs ?? []) {
      const ref = fr?.ref;
      if (!ref?.name) continue;
      const delay = Number(getArg(ref, "Delay") ?? 0) / 1000;
      const run = () => this.fireAction(ref, aim);
      if (delay > 0) this.timed.push({ t: delay, run }); else run();
    }
  }

  private fireAction(ref: any, aim: number) {
    const at = { x: this.x, y: this.y, heading: aim };
    if (ref.name === "Base/Spawn Actor") { const actor = getArg(ref, "Actor"); if (actor) this.spawn(actor, at); return; }
    if (ref.name === "Base/Default") { this.run(getArg(ref, "Action"), at, null); return; }
    const fa = this.w.data.resolveSync("config/fire_action.dat", ref, "action");
    if (!fa?.action) return;
    // looping fire actions (Hexing Haze tries again every refractory period; Angelic Aura
    // pulses while its shield lasts)
    const loops = kind(fa) === "IncreasingLooped" ? Math.max(1, fa.maxLoop ?? 1) : fa.refractory ? Math.ceil(5000 / fa.refractory) : 1;
    const gap = (fa.refractory ?? 200) / 1000;
    for (let i = 0; i < loops; i++) {
      const run = () => this.run(fa.action, { x: this.x, y: this.y, heading: aim }, null);
      if (i === 0) run(); else this.timed.push({ t: gap * i, run });
    }
    if (fa.endAction) this.timed.push({ t: gap * loops, run: () => this.run(fa.endAction, { x: this.x, y: this.y, heading: aim }, null) });
  }

  /**
   * Executes a logic action from a skill or pet actor. `target` is the monster an action on
   * a single target applies to (a condition expiring on it, a bullet's victim).
   */
  private run(action: any, at: { x: number; y: number; heading: number }, target: SpriteTarget | null, depth = 0): boolean {
    if (!action || depth > 8) return false;
    const k = kind(action);
    switch (k) {
      case "Compound": { let any = false; for (const a of action.actions ?? []) any = this.run(a, at, target, depth + 1) || any; return any; }
      case "Conditional": return this.run(action.action ?? action.defaultAction, at, target, depth + 1);
      case "Fail": return false;
      case "Delayed": this.timed.push({ t: (action.delay ?? 0) / 1000, run: () => this.run(action.action, at, target, depth + 1) }); return true;
      case "SpawnActor": case "SpawnRotatedActor": case "SpawnTransformedActor": case "SpawnRandomTranslatedActor": {
        if (!action.actor?.name) return false;
        const j = k === "SpawnRandomTranslatedActor" ? 1.2 : 0;
        this.spawn(action.actor, { x: at.x + (Math.random() - 0.5) * j, y: at.y + (Math.random() - 0.5) * j, heading: at.heading });
        return true;
      }
      case "ApplyStatus": {
        if (!action.condition) return false;
        this.status(this.w.knight(), action.condition);
        return true;
      }
      case "ClearStatus": return true;
      case "DamageRegionFromPoint": case "DamageRegion": case "DamageTargetFromPoint": case "DamageTarget": {
        const single = k === "DamageTarget" || (k === "DamageTargetFromPoint" && !action.area);
        // without a region, an area action reaches around the sprite (Hexing Haze); tuning
        const r = action.region?.shape?.radius ?? action.radius ?? (k === "DamageTargetFromPoint" ? 6 : 2);
        let victims = single ? (target ? [target] : []) : this.w.monsters().filter(m => Math.hypot(m.x - at.x, m.y - at.y) <= r + m.radius);
        if (action.maxSuccessfulTargets) {
          victims = victims.filter(v => !this.marks.some(m => m.target === v && m.kind === "Expires"))
            .sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y)).slice(0, action.maxSuccessfulTargets);
        }
        const kb = (action.impulseDealt?.translation?.x ?? 1) * 0.25;
        for (const v of victims) this.strike(v, action.damage, kb, at.x, at.y);
        return victims.length > 0;
      }
      case "FireEffect": {
        const model = getArg(action.effect, "Model");
        if (model) this.w.effect(model, compose([at.x, at.y, this.w.groundZ(at.x, at.y)], [0, 0, 0, 1], 1), 1.5);
        return true;
      }
      case "StartSpriteShield": {
        // the sprite shield: a shield's worth of health (depth-scaled) over the knight
        const hp = this.w.evaluate(action.healthScale, this.ctx()) || 50;
        this.shield = hp / 4;
        this.shieldTime = 5;
        return true;
      }
      case "EndSpriteShield": this.shield = 0; this.shieldTime = 0; return true;
      case "Heal": this.w.heal(action.current ?? 20); return true;
      default: return false;
    }
  }

  /** A damage config on a monster: the sprite's own conditions here, the rest by the world. */
  private strike(m: SpriteTarget, damage: any, knockback: number, fx: number, fy: number) {
    if (!damage) return;
    const dmg = normalizeDamage(damage);
    let real = false;
    const walk = (d: any, depth = 0) => {
      if (!d || depth > 6) return;
      const k = kind(d);
      if (k === "Compound") { for (const x of d.damages ?? []) walk(x, depth + 1); return; }
      if (k === "Status" || k === "ExclusiveStatus") { if (d.statusCondition) this.status(m, d.statusCondition); return; }
      real = true;
    };
    walk(dmg);
    if (real) this.w.damage(m, stripStatuses(dmg, s => this.ownsStatus(s)), this.ctx(), knockback, fx, fy);
  }

  private statusCfg(ref: any): any | null { return this.w.data.resolveSync("config/status_condition.dat", ref, "statusCondition"); }

  private ownsStatus(ref: any) { return ["Cloak", "SpriteShield", "Generic", "Expires", "Quill"].includes(kind(this.statusCfg(ref))); }

  /** Applies a condition: battle-sprite kinds here, everything else through the world. */
  private status(t: SpriteTarget, ref: any) {
    const cfg = this.statusCfg(ref);
    const k = kind(cfg);
    const knight = this.w.knight();
    const duration = Math.max(cfg?.minDuration ?? 3000, cfg?.maxDuration ?? 0) / 1000;
    const durArg = Number(getArg(ref, "Duration") ?? 0) / 1000;
    const secs = durArg || duration;
    const sprite = cfg?.sprite;
    const fxAt = (life: number) => {
      if (sprite?.applicationTransient) this.w.effect(sprite.applicationTransient, compose([t.x, t.y, t.z], [0, 0, 0, 1], 1), 2);
      if (sprite?.model && t === knight) this.w.effect(sprite.model, knight.matrix(), life, true);
      else if (sprite?.model) this.w.effect(sprite.model, compose([t.x, t.y, t.z], [0, 0, 0, 1], 1), Math.min(life, 3));
    };
    switch (k) {
      case "Cloak":
        if (t !== knight) return;
        this.cloak = Math.max(this.cloak, secs);
        fxAt(secs);
        return;
      case "SpriteShield":
        if (t !== knight) return;
        // the aura keeps the sprite shield up while the knight stands in it
        this.shieldTime = Math.max(this.shieldTime, 1.2);
        if (sprite?.applicationTransient) this.w.effect(sprite.applicationTransient, knight.matrix(), 1.5);
        return;
      case "Generic": case "Expires": case "Quill": {
        if (t === knight) return;
        const existing = this.marks.find(m => m.target === t && m.kind === k);
        if (existing) { existing.remaining = Math.max(existing.remaining, secs); return; }
        this.marks.push({ target: t, cfg, remaining: k === "Quill" ? Math.min(secs, 2) : secs, kind: k, lastHealth: t.health, tick: 0 });
        if (k === "Quill" && cfg.startedAction) this.run(cfg.startedAction, { x: t.x, y: t.y, heading: 0 }, t);
        fxAt(secs);
        return;
      }
      default:
        // conditions a skill puts on the knight (buffs) always take; on monsters they roll
        this.w.applyStatus(t, ref, this.ctx(), t === knight ? 1 : undefined);
    }
  }

  private updateMarks(dt: number) {
    for (const m of [...this.marks]) {
      m.remaining -= dt;
      const t = m.target;
      const alive = t.health > 0;
      if (m.kind === "Generic" && alive && t.health < m.lastHealth) {
        // Heart Attack: a struck victim may give up a heart that heals the knight
        const p = Number(getArg(m.cfg, "Heart Attack Probability") ?? m.cfg.heartProbability ?? 0.25) || 0.25;
        if (Math.random() < p) {
          const k = this.w.knight();
          this.w.heal(k.maxHealth * 0.08);
          this.w.floater(t.x, t.y, t.z + 1.4, "♥", "#ff7bb0");
        }
      }
      m.lastHealth = t.health;
      if (m.remaining > 0 && alive) continue;
      this.marks.splice(this.marks.indexOf(m), 1);
      // Hexing Haze bursts when it expires; quills burst after a moment
      if (alive && m.kind === "Expires" && m.cfg.finishedAction) this.run(m.cfg.finishedAction, { x: t.x, y: t.y, heading: 0 }, t);
      if (alive && m.kind === "Quill" && m.cfg.damageAction) this.run(m.cfg.damageAction, { x: t.x, y: t.y, heading: 0 }, t);
    }
  }

  // ---------------------------------------------------------------- pet actors

  private spawn(ref: any, at: { x: number; y: number; heading: number }) {
    const cfg = this.w.data.resolveSync("config/actor.dat", ref, "actor");
    if (!cfg) return;
    const k = kind(cfg);
    if (k === "Original") {
      // a spawner (the quill spawner): its rotated bullets fan out from the sprite
      const bullet = getArg(ref, "Bullet");
      const count = Number(getArg(ref, "Bullet Count") ?? 5) || 5;
      if (bullet) for (let i = 0; i < count; i++) this.spawn(bullet, { ...at, heading: at.heading + (i - (count - 1) / 2) * 0.18 });
      return;
    }
    if (k !== "Bullet" && k !== "Bomb" && k !== "Orbital" && k !== "Laser") return;
    const c = Math.cos(at.heading), s = Math.sin(at.heading);
    const off = cfg.offset ?? { x: 0, y: 0 };
    const x = at.x + (off.x ?? 0) * c - (off.y ?? 0) * s, y = at.y + (off.x ?? 0) * s + (off.y ?? 0) * c;
    const a: PetActor = { kind: k, cfg, x, y, z: this.w.groundZ(x, y) + (cfg.height ?? (k === "Bullet" ? 0.8 : 0.1)), heading: at.heading,
      age: 0, life: 1, instance: null, done: false, timers: [] };
    if (k === "Bullet") a.life = (cfg.fuse ?? 1000) / 1000;
    else if (k === "Bomb") a.life = (cfg.fuse ?? 2000) / 1000;
    else if (k === "Orbital") {
      const timer = (cfg.handlers ?? []).filter((h: any) => kind(h) === "Timer").pop();
      a.life = timer?.interval ?? 12;
      a.angle = cfg.startingRotation ?? 0;
      a.radius = 1 + (cfg.orbitRadius ?? 0.5);
      a.struck = new Map();
      const k2 = this.w.knight();
      a.x = k2.x + Math.cos(a.angle!) * a.radius!; a.y = k2.y + Math.sin(a.angle!) * a.radius!; a.z = k2.z + 0.8;
    } else {
      a.life = (cfg.duration ?? 2000) / 1000;
      a.length = 6;
      a.nextDamage = 0;
      a.z = this.z;
    }
    for (const h of cfg.handlers ?? []) {
      if (kind(h) !== "Timer" || !h.action) continue;
      const interval = h.interval ?? 1;
      a.timers.push({ at: Math.max(0, interval + (h.offset ?? 0)), interval, left: (h.limit ?? 0) === 0 ? Infinity : h.limit, action: h.action });
    }
    const sp = cfg.sprite;
    if (sp?.creationTransient) this.w.effect(sp.creationTransient, compose([a.x, a.y, a.z], [0, 0, 0, 1], 1), 2);
    let model = sp?.model ?? cfg.model;
    if (k === "Laser" && model) model = withArg(model, "Length", a.length);
    if (model) void this.w.loader.loadRef(model).then(async m => {
      if (m && !a.done) a.instance = await this.w.renderer.instantiate(m);
    }).catch(() => {});
    this.actors.push(a);
  }

  private updateActors(dt: number) {
    const knight = this.w.knight();
    for (const a of this.actors) {
      if (a.done) continue;
      a.age += dt;
      if (a.instance) a.instance.time += dt;
      for (const t of a.timers) {
        while (t.left > 0 && a.age >= t.at) { t.at += t.interval; t.left--; this.run(t.action, { x: a.x, y: a.y, heading: a.heading }, null); }
      }
      switch (a.kind) {
        case "Bullet": {
          const speed = a.cfg.speed ?? BULLET_SPEED, r = a.cfg.shape?.radius ?? 0.3;
          const steps = Math.max(1, Math.ceil(speed * dt / 0.2));
          for (let i = 0; i < steps && !a.done; i++) {
            a.x += Math.cos(a.heading) * speed * dt / steps;
            a.y += Math.sin(a.heading) * speed * dt / steps;
            const hit = this.w.monsters().find(m => Math.hypot(m.x - a.x, m.y - a.y) < m.radius + r);
            if (hit) this.detonate(a, hit);
            else if (this.w.blocked(a.x, a.y, r * 0.5)) this.detonate(a, null);
          }
          if (!a.done && a.age >= a.life) this.detonate(a, null);
          break;
        }
        case "Bomb":
          if (a.age >= a.life) this.detonate(a, null);
          break;
        case "Orbital": {
          a.angle! += dt * Math.PI * 2 * (a.cfg.speed ?? 0.3) * 2;
          a.x = knight.x + Math.cos(a.angle!) * a.radius!;
          a.y = knight.y + Math.sin(a.angle!) * a.radius!;
          a.z = knight.z + 0.8;
          a.heading = a.angle! + Math.PI / 2;
          const r = a.cfg.shape?.radius ?? 0.2;
          for (const m of this.w.monsters()) {
            if (Math.hypot(m.x - a.x, m.y - a.y) > m.radius + r + 0.2) continue;
            if ((a.struck!.get(m) ?? -1) > a.age) continue;
            a.struck!.set(m, a.age + 0.6);
            this.strike(m, orbitalDamage(a.cfg), 0.3, knight.x, knight.y);
            const sig = (a.cfg.handlers ?? []).find((h: any) => kind(h) === "Signal")?.action;
            if (sig) this.run(sig, { x: a.x, y: a.y, heading: 0 }, m);
          }
          if (a.age >= a.life) this.finish(a);
          break;
        }
        case "Laser": {
          // a beam from the sprite along its aim, striking what stands in it every interval
          a.x = this.x; a.y = this.y; a.z = this.z;
          a.heading = this.heading;
          if (a.age >= a.nextDamage!) {
            a.nextDamage! += (a.cfg.damageInterval ?? 333) / 1000;
            const c = Math.cos(a.heading), s = Math.sin(a.heading);
            for (const m of this.w.monsters()) {
              const dx = m.x - a.x, dy = m.y - a.y, along = dx * c + dy * s, across = Math.abs(-dx * s + dy * c);
              if (along < 0 || along > a.length! + m.radius || across > 0.6 + m.radius) continue;
              const act = a.cfg.damageAction;
              if (act?.damage) this.strike(m, act.damage, (act.impulseDealt?.translation?.x ?? 0.5) * 0.25, a.x, a.y);
            }
          }
          if (a.age >= a.life) this.finish(a);
          break;
        }
      }
    }
    for (let i = this.actors.length - 1; i >= 0; i--) if (this.actors[i].done) this.actors.splice(i, 1);
  }

  private detonate(a: PetActor, hit: SpriteTarget | null) {
    if (a.done) return;
    this.finish(a);
    const det = a.cfg.detonationAction;
    if (det) this.run(det, { x: a.x, y: a.y, heading: a.heading }, hit);
  }

  private finish(a: PetActor) {
    a.done = true;
    const fx = a.cfg.sprite?.destructionTransient;
    if (fx) this.w.effect(fx, compose([a.x, a.y, a.kind === "Bullet" ? a.z : this.w.groundZ(a.x, a.y)], [0, 0, 0, 1], 1), 2);
  }

  /** What to draw: the sprite and its live pet actors. */
  items(): { instance: ModelInstance; matrix: Mat4 }[] {
    const out: { instance: ModelInstance; matrix: Mat4 }[] = [];
    if (this.instance) out.push({ instance: this.instance, matrix: this.matrix() });
    for (const a of this.actors) {
      if (!a.instance || a.done) continue;
      out.push({ instance: a.instance, matrix: compose([a.x, a.y, a.z], [0, 0, Math.sin(a.heading / 2), Math.cos(a.heading / 2)], 1) });
    }
    return out;
  }

  /** The sprite's round shadow on the ground. */
  shadow(): { x: number; y: number; z: number; r: number } { return { x: this.x, y: this.y, z: this.w.groundZ(this.x, this.y), r: 0.45 }; }
}

// ------------------------------------------------------------------ damage helpers

const DAMAGE = "projectx.dungeon.config.DamageConfig$";

/**
 * Damage configs built from parameter paths into fields the export omitted have no class;
 * this names them after what they hold (a depth scale, a status, a list of damages).
 */
export function normalizeDamage(d: any): any {
  if (!d || typeof d !== "object") return d;
  if (d.$class) return kind(d) === "Compound" ? { ...d, damages: (d.damages ?? []).map(normalizeDamage) } : d;
  if (Array.isArray(d.damages)) return { $class: DAMAGE + "Compound", damages: d.damages.filter(Boolean).map(normalizeDamage) };
  if (d.depthScale) return { $class: DAMAGE + "DepthScale", ...d };
  if (d.statusCondition) return { $class: DAMAGE + "Status", ...d };
  return d;
}

/** A compound damage without the statuses `owned` claims (the companion applies those). */
function stripStatuses(d: any, owned: (ref: any) => boolean): any {
  const k = kind(d);
  if (k === "Compound") return { ...d, damages: (d.damages ?? []).map((x: any) => stripStatuses(x, owned)).filter(Boolean) };
  if ((k === "Status" || k === "ExclusiveStatus") && d.statusCondition && owned(d.statusCondition)) return null;
  return d;
}

/** An orbital's contact damage (its collision action's damage, from the parameter paths). */
function orbitalDamage(cfg: any): any {
  const acts = cfg.collisionAction?.action?.actions ?? [];
  for (const a of acts) if (a?.damage) return normalizeDamage(a.damage);
  return { $class: DAMAGE + "DepthScale", depthScale: { $class: CONFIG_REF, name: "PC/Damage/Handgun/Handgun Base -20" } };
}

function withArg(ref: any, name: string, value: unknown) {
  const entries: [string, unknown][] = [...(ref.arguments?.entries ?? [])].filter(([k]) => k !== name);
  entries.push([name, value]);
  return { ...ref, arguments: { $map: "com.threerings.config.ArgumentMap", entries } };
}

/** Builds a companion for the save's active sprite, loaded and ready to place in a world. */
export async function createCompanion(defs: Map<string, SpriteDef>, progress: SpriteProgress | null, w: SpriteWorld): Promise<SpriteCompanion | null> {
  const def = progress ? defs.get(progress.name) : null;
  if (!def || !progress) return null;
  const c = new SpriteCompanion(def, progress, w);
  await c.load();
  return c;
}

