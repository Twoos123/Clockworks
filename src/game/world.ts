// The game world for play mode: a knight with a loadout of weapons, the level's own logic
// (Tudey handlers on scene entries and actors: spawners, triggers, doors, switches, waves),
// monsters, props (doors, switches, blocks, keys, pickups, the elevator), and
// breakables from startup markers, melee and projectile combat with the attack data from
// the install, depth-scaled damage against defence, and transient effects.

import type { AudioSystem } from "../audio";
import { compose, multiply, readTransform, type Mat4, type Vec3 } from "../math";
import { loadAnimation, type AnimationClip, type LoadedModel, type ModelLoader } from "../model";
import type { ModelInstance, Renderer } from "../render/renderer";
import type { LoadedScene } from "../scene";
import type { CollisionMap } from "./collision";
import { dealt, impulseShare, mainType, modifyDamage, TYPE_COLORS, type Knock } from "./combat";
import { GameData, type ArmorDef, type AttackDef, type FireDef, type MonsterDef, type ProjectileDef, type ShieldDef, type WeaponDef } from "./data";
import { DAMAGE_TYPES, zeroAmounts, type Amounts, type DepthContext, type Difficulty } from "./depth";
import { addItemBonuses, capValue, emptyBonuses, forWeapon, resistFactor, STATUS_BITS, type Bonuses } from "./bonus";
import { Entity, Logic, type LogicHost } from "./logic";
import { Prop, propKind, trapState } from "./props";
import { BEAM_MODELS, DungeonObjects, ENERGY_CROWNS, isAlly, isCaptive, standInModel, type BeamResult } from "./objects";
import { intersects } from "./shapes";
import { SpawnTables } from "./spawntable";
import { DEFAULT_LOADOUT, POCKET_SLOTS, type Loadout as GearLoadout } from "./save";
import { ECONOMY_FILES, Economy, type GearState, type VariantEffect } from "./economy";
import { StatusConditions, type ActiveStatus } from "./status";
import { itemName, monsterName } from "./text";
import { dressArgs, NO_DRESSING, type Dressing } from "./accessories";
import type { SpriteCompanion, SpriteTarget, SpriteWorld } from "./sprites";
import { attackTiming, inTargetWedge, KnightControl, quadMovement, type AttackSlot, type ControlEvent, type ControlInput, type ControlStatus, type WeaponRules } from "./knight";
import { heartCount, HEART_TYPES, hitFlash, numberLength, numberStyle, NUMBER_LAYERS, performanceOf, performanceVariant, readShake, shakeOffset, shakeScale, type NumberStyle, type ShakeSpec } from "./feedback";
import { pickMovement, pickWeighted, startWander, stepWander, wanders, type Wander } from "./townsfolk";
import { actionHint } from "./action";
import { message } from "../i18n";

// Character/PC/Default: speed 5, circle radius 1/3, collision mask 43
const KNIGHT_SPEED = 5, KNIGHT_RADIUS = 1 / 3, KNIGHT_MASK = 43;
/**
 * Knight health before gear: 200, five heart pips of 40 (the client's loadout panel counts
 * starting pips as (gear health bonuses + 200) / 40). Gear adds health only through its
 * HealthBonus level entries and modifiers.
 */
const KNIGHT_HEALTH = 200;
const MONSTER_MASK = 1 | 2 | 8 | 32;
const AGGRO_RANGE = 10, LEASH_RANGE = 18;
export const STARTER_WEAPONS = ["Weapon/Sword/Proto Sword", "Weapon/Handgun/Proto Gun", "Weapon/Bomb/Proto Bomb"];
const STARTER_SHIELD = "Gear/Shield/Proto Shield";
const STARTER_ARMOR = ["Gear/Armor/Parts/Proto (Base)", "Gear/Helm/Parts/Proto (Base)"];
/** The body model's default armour and helmet (character/pc/model.dat's own arguments). */
/** A ConfigReference with arguments. */
const argRef = (name: string, entries: [string, any][]) => ({ $class: "com.threerings.config.ConfigReference", name,
  arguments: { $map: "com.threerings.config.ArgumentMap", entries } });
const gearRef = (name: string) => ({ $class: "com.threerings.config.ConfigReference", name,
  arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Colorization", 257], ["Variant", "grey"]] } });
const DEFAULT_GEAR = { armor: gearRef("item/gear/armor/doublebelt/model.dat"), helmet: gearRef("item/gear/helm/pith/model.dat") };

/**
 * The knight's dash (Shift + right click), the client's dodge: an impulse of 5 units over
 * 625 ms (longer when slowed), easing out, along the movement direction or the facing; no
 * moving or turning meanwhile. The cooldown is Character/PC/Level's dodgeCooldown (8 s).
 * The moment of immunity at its end is ours (invulnerability is server code).
 */
export const DASH = { distance: 5, time: 0.625, cooldown: 8, guard: 0.4 };
const CHARGE_ANIMS: Record<string, string> = {
  Sword: "character/pc/charge_sword_hold.dat", Handgun: "character/pc/charge_pistol_hold.dat",
  Bomb: "character/pc/charge_bomb_hold.dat", Other: "character/pc/charge_sword_hold.dat",
};

export interface KnightInput {
  /** Desired movement direction in world space. */
  move: [number, number];
  /** The attack button went down this frame. */
  attackDown: boolean;
  /** The attack button is held. */
  attackHeld: boolean;
  /** The shield button is held. */
  shield: boolean;
  /** World point under the mouse, for aiming. */
  aim: [number, number] | null;
  /** A weapon slot to switch to this frame, or null. */
  weaponSlot?: number | null;
  /** The action key went down this frame (pick up, drop, use, talk). */
  interact?: boolean;
  /** The dash key went down this frame. */
  dash?: boolean;
  /** The shield bash key went down this frame. */
  bash?: boolean;
}

export interface Floater {
  x: number; y: number; z: number; text: string; color: string; age: number;
  /** A damage or heal number in the game's style (src/game/feedback.ts), and its random pick. */
  style?: NumberStyle; seed?: number;
}

type Phase = "start" | "fire" | "end";
/** Hazard bullets (gun blocks, rocket blocks) strike the knight, monsters and blocks alike. */
type Team = "knight" | "monster" | "hazard";

abstract class Actor {
  x = 0; y = 0; z = 0;
  heading = -Math.PI / 2;
  health = 1; maxHealth = 1;
  dead = false;
  /**
   * Knockback or dodge impulse (the client's Impulse): a displacement spread over `dur`
   * seconds, fast at first and easing to a stop.
   */
  impulse: { dx: number; dy: number; t: number; dur: number } | null = null;
  /**
   * The attack under way: its phase and time in it, seconds since it fired (its fire actions
   * go off at their delays, a burst running on into the follow-through), which have fired,
   * whether the lunge started, and whether it plays on the upper body only.
   */
  attack: { def: AttackDef; phase: Phase; t: number; ft: number; total?: number; fired: Set<number>; lunged: boolean; overlay: boolean; touched?: Set<Actor> } | null = null;
  /** Lunge from an attack's impulse: its displacement, seconds into it and its length. */
  lunge = { dx: 0, dy: 0, t: 0, dur: 0 };
  /** Nodes animated by the upper-body overlay (knights); null plays attacks whole-body. */
  upperBody: Set<string> | null = null;
  defense: Amounts | null = null;
  /** Active status conditions (fire, freeze, shock...). */
  statuses: ActiveStatus[] = [];
  /** When it was last struck (world clock, seconds), for its colour flash. */
  flashAt = -1e9;
  abstract radius: number;
  abstract get team(): Team;
  constructor(public instance: ModelInstance, readonly scale = 1) {}

  /** Actor sprites face -y in model space (as the knight's face mesh shows). */
  matrix(): Mat4 {
    const a = this.heading + Math.PI / 2;
    return compose([this.x, this.y, this.z], [0, 0, Math.sin(a / 2), Math.cos(a / 2)], this.scale);
  }

  turnToward(angle: number, rate: number, dt: number) {
    const d = Math.atan2(Math.sin(angle - this.heading), Math.cos(angle - this.heading));
    this.heading += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  }
}

/** One carried weapon with its knight model (the weapon is part of the knight's model). */
export interface Loadout { def: WeaponDef; instance: ModelInstance }

export class Knight extends Actor {
  get team(): Team { return "knight"; }
  radius = KNIGHT_RADIUS;
  /** The client's control rules: the activity, the combo's chain count, the dodge cooldown. */
  control = new KnightControl();
  /** The action button as the controller last saw it, and when it last changed (ms). */
  attackFlag = false;
  attackChanged = -1e9;
  /** The monster auto-targeting picked this frame. */
  target: Monster | null = null;
  /** A weapon switch waiting for the knight to be idle or shielding. */
  pendingSlot: number | null = null;
  invulnerable = 0;
  hurtTime = 0;
  /** Seconds since the last attack started, for a gun's chain cooldown. */
  sinceAttack = 0;
  weapons: Loadout[] = [];
  slot = 0;
  shield: ShieldDef | null = null;
  armor: ArmorDef[] = [];
  /** Bonuses from armour, helmet, shield and trinkets. */
  bonuses: Bonuses = emptyBonuses();
  /** Seconds the attack button has been held for a charge, or null when not charging. */
  charge: number | null = null;
  shielding = false;
  shieldHealth = 1;
  shieldMax = 1;
  shieldDefense: Amounts | null = null;
  /** Seconds since the shield last took a hit. */
  sinceShieldHit = 1e9;
  /** Seconds left while the shield is broken. */
  shieldBroken = 0;
  /** Seconds until the next dash. */
  dashCooldown = 0;
  /** Mid-dash (the lunge carries the knight). */
  dashing = false;
  /** Health lost recently, shown on the HUD as a damage segment that drains away. */
  recentDamage = 0;
  sinceDamage = 1e9;
  get weapon(): WeaponDef | null { return this.weapons[this.slot]?.def ?? null; }
  get attacks(): AttackDef[] { return this.weapon?.attacks ?? []; }
}

export class Monster extends Actor {
  /** Allies fight for the knight (freed companions, energy turrets: objects.ts isAlly). */
  ally = false;
  /** Allies in a cage stand still, untouchable, until released. */
  captive = false;
  get team(): Team { return this.ally ? "knight" : "monster"; }
  /** Monsters without attacks (traders, wandering townsfolk) are passive and untouchable. */
  get passive() { return this.captive || this.def.attacks.length === 0; }
  /** The monster's logic actor (tags such as its wave, handlers). */
  entity: Entity | null = null;
  radius: number;
  state: "spawning" | "idle" | "chase" | "attack" | "dying" = "spawning";
  stateTime = 0;
  cooldown = 1;
  /** Seconds left in a hit reaction (interrupted, not acting). */
  reacting = 0;
  /** Waypoints around walls toward the knight, and seconds until they are recomputed. */
  path: [number, number][] | null = null;
  pathAge = 0;
  homeX = 0; homeY = 0;
  /** Seconds left following a path after getting stuck on the straight line. */
  stuck = 0;
  /** A lichen colony's size (its "Size" argument, 1 to 21), or 0 for anything else. */
  size = 0;
  /** The lichen this one is merging with. */
  mergeWith: Monster | null = null;
  /** Moved and made to attack by a boss director rather than the AI. */
  scripted = false;
  constructor(instance: ModelInstance, readonly def: MonsterDef, health: number) {
    super(instance, def.scale);
    this.radius = def.radius;
    this.health = this.maxHealth = health;
  }
}

/** A bullet in flight or a bomb on its fuse. */
class Projectile {
  age = 0;
  done = false;
  /** The monster that fired it, if any. */
  owner: Monster | null = null;
  constructor(readonly def: ProjectileDef, readonly instance: ModelInstance | null, readonly team: Team,
    public x: number, public y: number, public z: number, readonly heading: number, readonly ctx: DepthContext) {}
  matrix(): Mat4 {
    const a = this.heading;
    return compose([this.x, this.y, this.z], [0, 0, Math.sin(a / 2), Math.cos(a / 2)], 1);
  }
}

interface Effect {
  /** The drawn model, or null for a scripted model (timed actions only). */
  instance: ModelInstance | null;
  matrix: Mat4;
  life: number;
  follow?: Actor;
  /** ScriptedConfig: its actions, the time so far and the next action to run. */
  script?: { actions: { time: number; action: any }[]; loop: number; t: number; next: number };
}

/**
 * A scripted boss fight (src/game/bosses.ts). The bosses' own fight logic is server code the
 * client data leaves out, so a director runs it: the world asks it each tick and when
 * something is hit.
 */
export interface BossDirector {
  update(dt: number): void;
  /** Damage about to be dealt to a monster; returns what it takes (0: immune). */
  damage?(m: Monster, dmg: number): number;
  /** The attacks the AI may choose for a monster (null: all of them). */
  attacks?(m: Monster): AttackDef[] | null;
  /** A knight's blow or shot struck a prop that answers to damage (a bell). */
  struck?(p: Prop): void;
  /** A monster's bullet moved; true destroys it there. */
  bullet?(x: number, y: number, heading: number, owner: Monster | null): boolean;
  /** The knight put down a carried object; true when the fight used it up. */
  dropped?(p: Prop): boolean;
}

export interface WorldOptions {
  /** Dungeon depth, which scales damage, health and defence. */
  depth?: number;
  difficulty?: Difficulty;
  audio?: AudioSystem | null;
  /** Arena: the level's own spawners and triggers are off; waves come instead. */
  arena?: boolean;
}

export class World implements LogicHost {
  knight!: Knight;
  readonly monsters: Monster[] = [];
  readonly props: Prop[] = [];
  logic!: Logic;
  knightEntity!: Entity;
  private tables!: SpawnTables;
  private conditions!: StatusConditions;
  /** Called when the knight takes the elevator at the end of the level. */
  onNextFloor: (() => void) | null = null;
  /**
   * Called when a shopkeeper opens their shop (the NPC's name says what it sells), with the
   * keeper's model and the animation it plays while the shop is open (the vendor portrait).
   */
  onOpenShop: ((keeper: string, portrait: { ref: any; idle: any } | null) => void) | null = null;
  /** The knight talked to a townsperson: its actor name, the StartConversation action and its entity. */
  onConversation: ((actor: string, action: any, source: Entity) => void) | null = null;
  /** The knight walked into a scene exit: its tags, the scene it leads to and the portal tag there. */
  onPortal: ((tags: string[], sceneId: number, portal: string, more: { area: string; townName?: string; sceneInternalId?: string }) => void) | null = null;
  /** True once the level's exit elevator has been used. */
  finished = false;
  /**
   * What the knight has collected on this floor: crowns, heat, materials and minerals, and
   * gear found (with the unique variants it rolled).
   */
  readonly loot = { crowns: 0, heat: 0, materials: new Map<string, number>(), items: [] as { name: string; variants: string[] }[] };
  /** Prices, levels, variants and drops (src/game/economy.ts), once the configs are loaded. */
  economy: Economy | null = null;
  /** The save's per-item state (heat, level, variants), by item name. */
  gear: Record<string, GearState> = {};
  /** Monster family tags of the floor's theme, for treasure that has no monster to name one. */
  themeTags: string[] = [];
  /** Per weapon: its level's and variants' damage, charge, attack speed and family damage. */
  private weaponBonus = new Map<string, { damage: number; uncapped: number; charge: number; attackSpeed: number; tagged: Record<string, number> }>();
  /** Per armour piece and shield: its level's defence increase (percent). */
  private defenseLevel = new Map<string, number>();
  /** Defence from damage type variants on worn gear, evaluated at that item's stars. */
  private variantDefense: { def: NonNullable<VariantEffect["defense"]>; rarity: number }[] = [];
  /**
   * The pocket: consumables (DungeonItemConfig Capsule and Vial) by item name and count. The
   * array is the save's own, so what is picked up or used stays with the knight.
   */
  pocket: [string, number][] = [];
  /**
   * Items gained, for the HUD's item-acquire icons (client hud/t): each item's icon, how many,
   * and its pocket slot when it went to the quickbar. The HUD takes them off the front.
   */
  readonly acquired: { icon: string; colorizations: unknown[]; count: number; slot: number | null }[] = [];

  /** Queues an item's acquire icon; false when the item has no icon (a floater is shown instead). */
  private acquire(name: string, count = 1, slot: number | null = null): boolean {
    const icon = this.economy?.info(name)?.icon;
    if (!icon?.file) return false;
    this.acquired.push({ icon: icon.file, colorizations: icon.colorizations ?? [], count, slot });
    return true;
  }
  /** The equipped vitapod for the HUD: its icon and capsule count. */
  vitapod: { icon: any; count: number } | null = null;
  /** Actions waiting on an item's action delay. */
  private delayed: { t: number; run: () => void }[] = [];
  readonly effects: Effect[] = [];
  readonly projectiles: Projectile[] = [];
  readonly floaters: Floater[] = [];
  readonly data: GameData;
  private readonly clips = new Map<string, Promise<AnimationClip | null>>();
  private readonly ready = new Map<string, AnimationClip | null>();
  private readonly projectileDefs = new Map<string, Promise<{ def: ProjectileDef; model: LoadedModel | null } | null>>();
  private nextId = 1;
  killCount = 0;
  defeated = false;
  depth: number;
  difficulty: Difficulty;
  readonly audio: AudioSystem | null;
  /** Camera shakes under way (ShakeCamera actions): each one's spec, strength and start (clock seconds). */
  private shakes: { spec: ShakeSpec; scale: number; at: number }[] = [];
  /** The camera's offset from the shakes under way (world units), as Clyde's camera offsets add up. */
  cameraShake(): [number, number, number] {
    const o: [number, number, number] = [0, 0, 0];
    for (const s of this.shakes) {
      const d = shakeOffset(s.spec, s.scale, this.clock - s.at);
      o[0] += d[0]; o[1] += d[1]; o[2] += d[2];
    }
    return o;
  }
  /** Starts a ShakeCamera felt by its distance from the camera's target (the knight, 1 up). */
  private addShake(action: any, x: number, y: number, z: number) {
    const spec = readShake(action), k = this.knight;
    const scale = k ? shakeScale(spec, Math.hypot(x - k.x, y - k.y, z - (k.z + 1))) : 1;
    if (scale > 0) this.shakes.push({ spec, scale, at: this.clock });
  }
  /** A damage or heal number over an actor in the game's style (fx_damagenumber.dat). */
  private numberAt(a: Actor, text: string, style: NumberStyle, color: string) {
    // the layer's launch point, anywhere within its placer around its offset
    const l = NUMBER_LAYERS[style];
    const r = l.spread * Math.cbrt(Math.random()), th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    this.floaters.push({ x: a.x + l.offset[0] + r * Math.sin(ph) * Math.cos(th), y: a.y + l.offset[1] + r * Math.sin(ph) * Math.sin(th),
      z: a.z + l.offset[2] + r * Math.cos(ph), text, color, age: 0, style, seed: Math.random() });
  }
  /** Dungeon objects: crystals, ghost blocks, explosives, prisms, gun blocks, cages (objects.ts). */
  readonly objects: DungeonObjects;
  /**
   * Pays crowns from the bank for energy uses (energy gates, crates); true when paid. Unset,
   * the floor's crowns pay.
   */
  spendCrowns: ((n: number) => boolean) | null = null;
  /** Prism beams drawn (model instances along each segment). */
  private beamItems: { instance: ModelInstance; matrix: Mat4 }[] = [];
  private beamGen = 0;
  /** The boss fight being played, if any. */
  boss: BossDirector | null = null;

  constructor(private readonly loader: ModelLoader, private readonly renderer: Renderer,
    private readonly scene: LoadedScene, private readonly collision: CollisionMap, opts: WorldOptions = {}) {
    this.data = new GameData(loader);
    this.depth = opts.depth ?? 1;
    this.difficulty = opts.difficulty ?? "medium";
    this.audio = opts.audio ?? null;
    if (opts.arena) this.arena = { wave: 0, timer: 3, family: "" };
    const world = this;
    this.objects = new DungeonObjects({
      get logic() { return world.logic; },
      get knightEntity() { return world.knightEntity; },
      props: this.props,
      knight: () => this.knight,
      destroy: p => this.logic.destroy(p.entity, this.knightEntity),
      playState: (p, i, loop = true) => { if (p.obj) { p.obj.state = i; p.obj.loop = loop; } this.showPropState(p); },
      blast: (x, y, r, action, source) => {
        const at = new Entity(false, source.name);
        at.x = x; at.y = y; at.rotation = source.rotation;
        at.fixedShape = { k: "circle", x, y, r };
        this.logic.execute(action, at, source);
        this.addShake({ amplitude: { x: 0, y: 0, z: 0.25 }, duration: 0.6, innerRadius: 4, outerRadius: 12 }, x, y, this.collision.groundZ(x, y));
      },
      spawn: (ref, x, y, rot, source) => { this.logic.spawn(ref, x, y, rot, source, source); },
      heal: n => this.healKnight(n),
      wall: (x, y) => { const c = this.collision.cell(x, y); return !c || (c.flags & 1) !== 0; },
      beams: segs => void this.showBeams(segs),
      release: (x, y, r) => {
        for (const m of this.monsters) if (m.captive && m.entity && Math.hypot(m.x - x, m.y - y) <= r) this.logic.destroy(m.entity, this.knightEntity);
      },
    });
  }

  /** Lays the prism beam model along each beam segment. */
  private async showBeams(segs: BeamResult["segments"] | null) {
    const gen = ++this.beamGen;
    const items: { instance: ModelInstance; matrix: Mat4 }[] = [];
    // the beam model is a one-unit beam along its -y (its Length is a procedural bone
    // offset); one piece per unit of the segment
    let model: LoadedModel | null = null;
    for (const name of BEAM_MODELS) {
      model ??= await this.loader.loadRef({ $class: "com.threerings.config.ConfigReference", name,
        arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Length", 1], ["Variant", "Shock"]] } }).catch(() => null);
    }
    if (!model || gen !== this.beamGen) return;
    for (const s of segs ?? []) {
      const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
      const a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0), r = a + Math.PI / 2;
      for (let d = 0; d < len - 0.05; d += 1) {
        const x = s.x0 + Math.cos(a) * d, y = s.y0 + Math.sin(a) * d;
        const z = this.collision.groundZ(x, y) + 0.5;
        items.push({ instance: await this.renderer.instantiate(model), matrix: compose([x, y, z], [0, 0, Math.sin(r / 2), Math.cos(r / 2)], 1) });
      }
    }
    if (gen === this.beamGen) this.beamItems = items;
  }

  /** Pays for an energy use in crowns (ENERGY_CROWNS each); a floater says when it cannot. */
  private payEnergy(amount: number): boolean {
    const cost = Math.max(0, Math.round(amount * ENERGY_CROWNS));
    const k = this.knight;
    const paid = this.spendCrowns ? this.spendCrowns(cost) : this.loot.crowns >= cost && ((this.loot.crowns -= cost), true);
    this.floaters.push({ x: k.x, y: k.y, z: k.z + 2, text: paid ? `-${cost} cr (energy)` : `Needs ${cost} crowns`, color: paid ? "#9fd8ff" : "#ff9a9a", age: 0 });
    return paid;
  }

  /** Arena state: the current wave, the pause before the next, and its monster family. */
  arena: { wave: number; timer: number; family: string } | null = null;
  /** Called every fifth arena wave cleared (a checkpoint to bank or carry on). */
  onArenaCheckpoint: ((wave: number) => void) | null = null;

  /** The level's collision cells (for the minimap). */
  get collisionMap() { return this.collision; }

  ctx(rarity = 0): DepthContext { return { depth: this.depth, rarity, difficulty: this.difficulty }; }

  // ---------------------------------------------------------------- setup

  /**
   * Loads (and caches) an animation clip from a path or a ConfigReference (whose arguments,
   * such as an attack's sound, apply); returns it synchronously once ready.
   */
  clip(p?: string | any): AnimationClip | null {
    if (!p) return null;
    const key = clipKey(p);
    if (!this.clips.has(key)) {
      this.clips.set(key, loadAnimation(this.loader, p).catch(() => null).then(c => { this.ready.set(key, c); return c; }));
    }
    return this.ready.get(key) ?? null;
  }

  private async preload(...paths: (string | any | undefined)[]) {
    await Promise.all(paths.filter(Boolean).map(p => { this.clip(p); return this.clips.get(clipKey(p)); }));
  }

  private async preloadAttacks(attacks: (AttackDef | null | undefined)[]) {
    const list = attacks.filter((a): a is AttackDef => !!a);
    await Promise.all([
      this.preload(...list.flatMap(a => [a.start, a.fire, a.end])),
      ...list.flatMap(a => a.fires).filter(f => f.spawn).map(f => this.projectileDef(f.spawn!.actor)),
    ]);
  }

  /** The knight's body with one weapon in hand ("Weapon" attaches at bone_weapon_r). */
  /** The knight's personal colour (a colour print for the body model's "Colorization"). */
  color = 257;
  /** Weapon levels from banked heat, by item name. */
  weaponLevels = new Map<string, number>();

  /** A gear model reference recoloured to the knight's colour, where it takes one. */
  private colored(ref: any): any {
    if (!ref?.arguments?.entries?.some(([k]: [string]) => k === "Colorization")) return ref;
    return { ...ref, arguments: { ...ref.arguments, entries: ref.arguments.entries.map(([k, v]: [string, unknown]) => [k, k === "Colorization" ? this.color : v]) } };
  }

  private async knightInstance(weapon: WeaponDef | null, shield: ShieldDef | null, armor: ArmorDef[] = []) {
    const args: [string, any][] = [["Colorization", this.color]];
    if (weapon) args.push(["Weapon", weapon.model]);
    if (shield) args.push(["Shield", shield.model]);
    // armour and helmet attach through the body model's "Armor" and "Helmet" parameters;
    // without equipped ones, the body's own defaults, so they take the personal colour too
    for (const a of armor) args.push([a.slot === "helmet" ? "Helmet" : "Armor", this.colored(a.model ?? DEFAULT_GEAR[a.slot ?? "armor"])]);
    const ref: any = { $class: "com.threerings.config.ConfigReference", name: "character/pc/model.dat",
      arguments: { $map: "com.threerings.config.ArgumentMap", entries: dressArgs(args, this.dressing, this.color) } };
    return this.instantiate(await this.loader.load("character/pc/model.dat", ref), false);
  }

  /** Costumes and accessories the knight shows (accessories.ts); set before start or through redress. */
  dressing: Dressing = NO_DRESSING;

  /** Shows a new dressing: the knight's models are rebuilt with it. */
  async redress(d: Dressing) {
    this.dressing = d;
    const k = this.knight;
    if (!k) return;
    const fresh = await Promise.all(k.weapons.map(l => this.knightInstance(l.def, k.shield, k.armor)));
    fresh.forEach((inst, i) => { k.weapons[i].instance = inst; });
    const cur = k.weapons[k.slot]?.instance ?? await this.knightInstance(null, k.shield, k.armor);
    cur.time = k.instance.time;
    k.instance = cur;
    k.upperBody = cur.subtree("Bip01 Spine");
    this.play(k, "character/pc/idle.dat");
  }

  /** The battle sprite following the knight (sprites.ts), or null. */
  companion: SpriteCompanion | null = null;

  /** What a battle sprite needs from the world. */
  spriteWorld(): SpriteWorld {
    const actor = (t: SpriteTarget) => t as unknown as Actor;
    return {
      data: this.data, loader: this.loader, renderer: this.renderer,
      knight: () => this.knight,
      monsters: () => this.monsters.filter(m => m.state !== "dying" && m.state !== "spawning" && !m.passive && !m.ally),
      clip: r => this.clip(r),
      preload: (...r) => this.preload(...r),
      groundZ: (x, y) => this.collision.groundZ(x, y),
      blocked: (x, y, r) => this.collision.collides(x, y, r, 0x81, false),
      ctx: rarity => this.ctx(rarity),
      evaluate: (ref, ctx) => this.data.depth.evaluate(ref, ctx),
      damage: (t, damage, ctx, kb, fx, fy) => { if (t instanceof Monster) this.damageMonster(t, this.amounts(damage, ctx), kb, fx, fy); },
      applyStatus: (t, ref, ctx, chance) => this.applyStatus(actor(t), ref, ctx, chance),
      heal: n => this.healKnight(n),
      effect: (ref, matrix, life, follow) => void this.spawnEffect(ref, matrix, life, follow ? this.knight : undefined),
      events: (inst, matrix) => { if (inst.events.length) for (const a of inst.events.splice(0)) this.modelAction(a, matrix); },
      floater: (x, y, z, text, color) => this.floaters.push({ x, y, z, text, color, age: 0 }),
    };
  }

  /** The knight's body model as worn (armour and helmet, no weapon), for the HUD portrait. */
  portraitRef(): any {
    const args: [string, any][] = [["Colorization", this.color]];
    for (const a of this.knight?.armor ?? []) args.push([a.slot === "helmet" ? "Helmet" : "Armor", this.colored(a.model ?? DEFAULT_GEAR[a.slot ?? "armor"])]);
    return { $class: "com.threerings.config.ConfigReference", name: "character/pc/model.dat",
      arguments: { $map: "com.threerings.config.ArgumentMap", entries: dressArgs(args, this.dressing, this.color) } };
  }

  async start(at: [number, number], gear: GearLoadout = DEFAULT_LOADOUT) {
    await this.data.depth.ready();
    const shield = await this.data.shield(gear.shield || STARTER_SHIELD);
    const weapons = (await Promise.all((gear.weapons.length ? gear.weapons : STARTER_WEAPONS).map(n => this.data.weapon(n))))
      .filter((w): w is WeaponDef => !!w);
    // armour and helmet: the equipped items, else the proto parts (the body model's defaults)
    const armorNames = [gear.armor || STARTER_ARMOR[0], gear.helmet || STARTER_ARMOR[1]];
    const armor = (await Promise.all(armorNames.map(n => this.data.armor(n)))).filter((a): a is ArmorDef => !!a);
    armor.forEach((a, i) => { a.slot = i === 0 ? "armor" : "helmet"; if (!(i === 0 ? gear.armor : gear.helmet)) a.model = null; });
    const loadouts: Loadout[] = await Promise.all(weapons.map(async def => ({ def, instance: await this.knightInstance(def, shield, armor) })));
    const knight = new Knight(loadouts[0]?.instance ?? await this.knightInstance(null, shield, armor));
    knight.weapons = loadouts;
    knight.shield = shield;
    knight.armor = armor;
    // gear bonuses (global modifiers and status resists) from everything worn
    await this.data.preload("config/item.dat", ...ECONOMY_FILES);
    this.economy ??= new Economy(f => this.data.library_(f));
    for (const n of [gear.armor, gear.helmet, gear.shield, ...(gear.trinkets ?? []), gear.vitapod]) {
      if (n) addItemBonuses(knight.bonuses, this.data.resolveSync("config/item.dat", { name: n }, "item"));
    }
    this.applyGearState(knight, weapons, [gear.armor, gear.helmet, gear.shield, ...(gear.trinkets ?? []), gear.vitapod]);
    const vita = gear.vitapod ? this.data.resolveSync("config/item.dat", { name: gear.vitapod }, "item") : null;
    this.vitapod = vita ? { icon: vita.icon ?? null, count: Number(vita.count ?? 1) } : null;
    this.updateKnightStats(knight);
    knight.health = knight.maxHealth;
    // the upper body: spine and everything above it (arms, head, weapon and shield bones)
    knight.upperBody = knight.instance.subtree("Bip01 Spine");
    [knight.x, knight.y] = at;
    knight.z = this.collision.groundZ(at[0], at[1]);
    this.knight = knight;
    await Promise.all([
      this.preload("character/pc/idle.dat", "character/pc/hurt_soft.dat", "character/pc/hurt_hard.dat", "character/pc/hurt_recover.dat",
        ...["forward", "backward", "left", "right"].flatMap(d => [`character/pc/run_${d}.dat`, `character/pc/walk_${d}.dat`]),
        ...["001", "002", "003", "004", "005"].map(n => `character/pc/idle/default/${n}.dat`),
        "character/pc/dead.dat", "character/pc/death.dat", "character/pc/blend_shield.dat", "character/pc/shield_hit.dat", ...Object.values(CHARGE_ANIMS)),
      ...weapons.map(w => this.preloadAttacks([...w.attacks, w.chargedAttack, w.incompleteChargedAttack, w.cooldownAttack])),
      this.preloadAttacks([shield?.bash]),
      this.preload("character/pc/dodge/dodge_fire.dat", "character/pc/dodge/dodge_end.dat"),
    ]);
    this.play(knight, "character/pc/idle.dat");
    // the hit feedback models, loaded ahead so the first hit shows (and shakes) at once
    for (const kind of ["Crap", "Normal", "Effective"]) for (const size of ["Small", "Medium", "Large"]) {
      void this.loader.loadRef(argRef("particle/fx_gethit_monster-scaled.dat", [["variant", `${kind} (${size})`]])).catch(() => null);
    }
    void this.loader.loadRef(argRef("particle/fx_gethit_player.dat", [["Color", "Red"]])).catch(() => null);
    for (const name of ["particle/charging.dat", "particle/charging_ready.dat"]) void this.loader.loadRef({ name }).catch(() => null);
    await this.startLogic();
  }

  /** Builds the level logic from the scene's entries and starts it (EntryLogic startup). */
  private async startLogic() {
    await this.data.preload("config/actor.dat", "config/spawn_table.dat", "config/parameterized_handler.dat",
      "config/fire_action.dat", "config/item.dat", "config/effect.dat");
    const eco = this.economy;
    this.tables = new SpawnTables(this.data.library_("config/spawn_table.dat"), eco ? {
      autoItem: (type, dw, ctx) => eco.autoItem(type, dw, ctx),
      rarity: name => eco.info(name)?.rarity ?? 0,
      depthWeight: (dw, r, d) => eco.depthWeight(dw, r, d),
    } : null);
    // the drop pools are built once, before the first drop
    if (eco) for (const t of ["MATERIAL", "GEAR"]) eco.autoItems(t);
    await this.data.preload("config/status_condition.dat");
    this.conditions = new StatusConditions(this.data.library_("config/status_condition.dat"), this.data.depth);
    this.logic = new Logic(this, {
      handlerRef: ref => this.data.resolveSync("config/parameterized_handler.dat", ref, "handler")?.handlers ?? [],
    });
    const k = this.knight;
    const ke = new Entity(true, "knight");
    ke.collisionFlags = 4;
    ke.mobile = true;
    ke.shapeConfig = { $class: "ShapeConfig$Circle", radius: KNIGHT_RADIUS };
    // WarpActor on the knight (a boss level's platform warps the party into the hall)
    ke.game = { isPawn: true, warp: (x: number, y: number) => { k.x = x; k.y = y; } };
    ke.x = k.x; ke.y = k.y;
    this.knightEntity = ke;
    this.logic.startActor(ke);
    const props: [Entity, any][] = [];
    for (const le of this.scene.logic) {
      // in the arena the level's spawners and wave triggers stay quiet
      if (this.arena && /Spawn|Player Enter|Actor Removed|One Time Action|Trigger\//.test(le.name)) continue;
      const e = new Entity(false, le.name);
      e.x = le.x; e.y = le.y; e.rotation = le.rotation;
      e.fixedShape = le.shape;
      e.tags = le.tags;
      this.logic.addEntry(e, le.handlers);
      if (le.actor) props.push([e, le.actor]);
    }
    this.logic.startEntries();
    // stateful and elevator props spawn their actors after their own handlers start
    for (const [e, actor] of props) this.logic.spawn(actor, e.x, e.y, e.rotation, e, e);
  }

  // ---------------------------------------------------------------- logic host

  /** LogicHost: creates the game object for an actor config (monster, prop, projectile). */
  createActor(ref: any, x: number, y: number, rotation: number): Entity | null {
    const cfg = this.data.resolveSync("config/actor.dat", ref, "actor");
    if (!cfg) return null;
    const e = new Entity(true, ref?.name ?? "");
    e.x = x; e.y = y; e.rotation = rotation;
    e.tags = tagList(cfg.tags);
    e.handlerConfigs = cfg.handlers ?? [];
    e.shapeConfig = cfg.shape ?? null;
    e.collisionFlags = cfg.collisionFlags ?? 1;
    const k = String(cfg.$class ?? "").split("$").pop();
    // inert monsters (corpses such as a dead gremlin: no collision, effectively unkillable)
    // are scenery; they do not hold their wave open
    if (k === "Monster" && cfg.collisionFlags === 0 && (cfg.health ?? 0) >= 99999) {
      e.tags = [];
      e.handlerConfigs = [];
      this.createProp(e, { ...cfg, $class: "generic", model: cfg.sprite?.model });
      return e;
    }
    if (k === "Monster" || k === "ZMonster" || k === "Agent") {
      e.mobile = true;
      void this.spawnMonster(ref, e);
    } else if (k === "Bullet" || k === "Bomb") {
      // trap and gun block bullets strike everything; monsters' strike the knight
      const hazard = /^Bullet\/Dynamic Objects\/(?!Energy)|Traps and Hazards/.test(String(ref?.name ?? ""));
      void this.spawnProjectileAt(ref, x, y, rotation, hazard ? "hazard" : "monster", this.ctx(0));
    } else if (k === "PrismLaser") {
      // beams are traced by the prism system (objects.ts), not run as actors
      return null;
    } else {
      this.createProp(e, cfg);
    }
    return e;
  }

  actorDestroyed(e: Entity) {
    const g = e.game;
    if (g instanceof Prop) this.removeProp(g, true);
    else if (g instanceof Monster && g.state !== "dying") this.startDying(g);
  }

  /**
   * An EffectConfig (config/effect.dat): its sprite model plays at the spot, and its action (a
   * healing totem's pulse, a mortar shell's blast) runs over its shape.
   */
  fireEffect(ref: any, x: number, y: number, rotation: number) {
    const cfg = this.data.resolveSync("config/effect.dat", ref, "effect");
    if (!cfg) return;
    const z = this.collision.groundZ(x, y);
    const model = cfg.sprite?.model;
    if (model) void this.spawnEffect(model, compose([x, y, z], [0, 0, Math.sin(rotation / 2), Math.cos(rotation / 2)], 1), Math.max(0.5, (cfg.lifespan ?? 1500) / 1000));
    if (cfg.action) {
      const at = new Entity(false, ref?.name ?? "effect");
      at.x = x; at.y = y; at.rotation = rotation;
      const r = cfg.shape?.radius;
      at.fixedShape = typeof r === "number" ? { k: "circle", x, y, r } : { k: "point", x, y };
      this.logic.execute(cfg.action, at, at);
    }
  }

  /** Spiral Knights' own actions (DungeonActionConfig and friends). */
  gameAction(cfg: any, source: Entity, activator: Entity | null, logic: Logic): boolean | undefined {
    const k = String(cfg.$class ?? "").split("$").pop();
    if (cfg.$condition) return true;
    switch (k) {
      case "ScenePortal":
        // a town exit the knight walked into: the game decides where it leads
        if (activator === this.knightEntity && !this.knight.dead) this.onPortal?.(source.tags ?? [], Number(cfg.sceneId), String(cfg.portal?.tag ?? ""),
          { area: source.name, townName: cfg.townName, sceneInternalId: cfg.sceneInternalId });
        return true;
      case "ActivateMonster": case "TableSpawn": case "TableSpawnPerMember": {
        const table = cfg.spawnTable ?? cfg.table;
        if (!table) return false;
        const at = cfg.location ? logic.resolveTarget(cfg.location, source, activator) : [source];
        let any = false;
        for (const t of at) {
          const results = this.tables.evaluate(table, { depth: this.depth, tier: this.tier(), difficulty: this.difficulty, tags: this.sourceTags(source) });
          for (const r of results) {
            for (let n = 0; n < r.count; n++) {
              // several results scatter a little around the spawn point
              const j = results.length > 1 || r.count > 1 ? 0.7 : 0;
              const x = t.x + (Math.random() - 0.5) * j, y = t.y + (Math.random() - 0.5) * j;
              if (r.actor) { logic.spawn(r.actor, x, y, t.rotation, source, activator); any = true; }
              else if (r.item) { this.awardItem(r.item, x, y); any = true; }
            }
          }
        }
        return any;
      }
      case "FireAction": {
        // a named FireActionConfig wraps a logic action (loot drops are built this way)
        const fa = cfg.fireAction ? this.data.resolveSync("config/fire_action.dat", cfg.fireAction, "action") : null;
        let act = fa?.action ?? fa;
        // a monster's loot drop opens with a switch on a value the export lost (it reads as
        // "no loot"); go straight to the loot-kind switch inside it
        if (/\/Loot Drop$/.test(cfg.fireAction?.name ?? "") && act?.actions?.[0]?.defaultAction) {
          act = { ...act, actions: [act.actions[0].defaultAction, ...act.actions.slice(1)] };
        }
        return act?.$class ? logic.execute(act, source, activator) : true;
      }
      case "SpawnPrespawned": case "TaggedSpawnActor":
        if (cfg.actor) logic.spawn(cfg.actor, source.x, source.y, source.rotation, source, activator);
        return true;
      case "ApplyStatus": {
        const ref = cfg.condition ?? cfg.statusCondition;
        const targets = cfg.target ? logic.resolveTarget(cfg.target, source, activator) : activator ? [activator] : [];
        for (const t of targets) {
          const a = t === this.knightEntity ? this.knight : t.game instanceof Monster ? t.game : null;
          if (a && ref) this.applyStatus(a, ref, this.ctx(0), 1);
        }
        return true;
      }
      case "ClearStatus": {
        const targets = cfg.target ? logic.resolveTarget(cfg.target, source, activator) : activator ? [activator] : [];
        for (const t of targets) {
          const a = t === this.knightEntity ? this.knight : t.game instanceof Monster ? t.game : null;
          if (a) for (const st of [...a.statuses]) this.endStatus(a, st);
        }
        return true;
      }
      case "StartConversation":
        // a townsperson talks (src/ui/conversation.ts); the knight is the activator
        if (activator === this.knightEntity) this.onConversation?.(source.name, cfg, source);
        return true;
      case "OpenShop": {
        // the keeper's look: its actor's sprite model, playing the shop's animation (or its idle)
        const actor = source.isActor ? this.data.resolveSync("config/actor.dat", { name: source.name }, "actor") : null;
        const model = actor?.sprite?.model ?? null;
        const idle = cfg.animation ?? actor?.sprite?.idles?.[0]?.animation ?? null;
        this.onOpenShop?.(source.name, model?.name ? { ref: model, idle } : null);
        return true;
      }
      case "NextFloor":
        this.finishLevel();
        return true;
      case "Heal": case "DepthScaleHeal": case "DepthHeal": {
        const amount = k === "Heal" ? (cfg.current ?? 20) : this.data.depth.evaluate(cfg.depthScale, this.ctx(0)) || 20;
        const fs = source.fixedShape;
        if (!cfg.target && fs?.k === "circle") {
          // an area heal (a healing totem's pulse) mends the monsters inside it
          for (const m of this.monsters) {
            if (m.state === "dying" || m.passive || m.ally || Math.hypot(m.x - fs.x, m.y - fs.y) > fs.r + m.radius || m.health >= m.maxHealth) continue;
            const h = Math.max(1, Math.min(amount, m.maxHealth * 0.1));
            m.health = Math.min(m.maxHealth, m.health + h);
            this.numberAt(m, `+${Math.round(h)}`, "Heal", "#7bd88f");
          }
          return true;
        }
        for (const t of cfg.target ? logic.resolveTarget(cfg.target, source, activator) : [activator]) {
          if (t === this.knightEntity) this.healKnight(amount);
        }
        return true;
      }
      case "UseEnergy": {
        // energy is not modelled: crowns pay instead (ENERGY_CROWNS a point)
        if (!this.payEnergy(cfg.amount ?? cfg.actionDesc?.amount ?? 5)) return false;
        return cfg.action ? logic.execute(cfg.action, source, activator) : true;
      }
      case "DamageTarget": case "DamageTargetFromPoint": case "DamageRegion": case "DamageRegionFromPoint": {
        const amounts = this.amounts(cfg.damage, this.ctx(0));
        const region = /Region/.test(k) && !cfg.target && !cfg.region && source.fixedShape?.k === "circle";
        const fs = source.fixedShape, r = region && fs?.k === "circle" ? fs.r : 0;
        // a region (a vial's splash, a blast, a mortar shell's explosion) strikes the monsters,
        // the knight (unless the knight threw it) and the blocks inside it
        const targets = region
          ? logic.actors.filter(e => e !== activator && !e.destroyed && (e.game instanceof Monster || e.game instanceof Prop || e === this.knightEntity)
            && Math.hypot(e.x - source.x, e.y - source.y) <= r + (e.game instanceof Monster ? e.game.radius : e === this.knightEntity ? KNIGHT_RADIUS : 0.5))
          : cfg.target ? logic.resolveTarget(cfg.target, source, activator) : activator ? [activator] : [];
        for (const t of targets) {
          if (t === this.knightEntity) this.damageKnight(amounts, 0.5, source.x, source.y);
          else if (t.game instanceof Monster) this.damageMonster(t.game, amounts, 0.5, source.x, source.y);
          else if (t.game instanceof Prop && t.game.struck) this.damageProp(t.game, dealt(amounts, null), 1);
        }
        return true;
      }
      default:
        return undefined;
    }
  }

  /**
   * Arena waves: when the field is clear, a short pause, then a bigger wave from a random
   * monster family (the game's single-family spawn tables), one depth deeper every two waves.
   */
  private updateArena(dt: number) {
    const a = this.arena!;
    if (this.knight.dead) return;
    // count spawned actors (monsters load asynchronously after their logic actor exists)
    const ke = this.knightEntity;
    if (this.logic.actors.some(e => e.mobile && e !== ke && !e.destroyed && !(e.game instanceof Monster && (e.game.passive || e.game.ally)))) return;
    if (a.wave > 0 && a.timer === 3) {
      // a wave was just cleared
      this.loot.crowns += 10 * a.wave;
      this.floaters.push({ x: this.knight.x, y: this.knight.y, z: this.knight.z + 2, text: `Wave ${a.wave} cleared  +${10 * a.wave} cr`, color: "#ffd84d", age: 0 });
      if (a.wave % 5 === 0) { a.timer = 2.99; this.onArenaCheckpoint?.(a.wave); return; }
    }
    a.timer -= dt;
    if (a.timer > 0) return;
    a.wave++;
    a.timer = 3;
    this.depth = Math.min(29, 1 + Math.floor((a.wave - 1) / 2));
    const families = [...this.data.library_("config/spawn_table.dat").keys()]
      .filter(n => /^Monster\/Single Family\/.*Scaled - /.test(n) && !/Friendly|Snarbolax|Pit Boss|Giant|Trojan|Overtimer/.test(n));
    a.family = families[Math.floor(Math.random() * families.length)] ?? "Monster/Single Family/Slime/Scaled - Jelly Cube";
    const k = this.knight;
    // every tenth wave is a boss: a tiered boss or mini-boss with its own handlers (Royal
    // Jelly heals and splits into its next phase), plus a couple of its family
    if (a.wave % 10 === 0) {
      const t = this.tier();
      const bosses = [`Character/NPC/Monster/Boss/Royal Jelly/Royal Jelly ${t}`, `Character/NPC/Monster/Beast/Alpha Wolver/Alpha Wolver/Alpha Wolver ${t}`,
        "Character/NPC/Monster/Boss/Mega Knight/Mega Knight Mini boss", "Character/NPC/Monster/Boss/Scorcher Mini Boss/Scorcher Mini Boss"];
      const name = bosses[(a.wave / 10 - 1) % bosses.length];
      const ang = Math.random() * Math.PI * 2;
      const spot = this.collision.findSpawn(k.x + Math.cos(ang) * 6, k.y + Math.sin(ang) * 6, 1.5, MONSTER_MASK);
      if (spot) this.logic.spawn({ name }, spot[0], spot[1], ang + Math.PI, this.knightEntity, this.knightEntity);
      a.family = name;
      this.floaters.push({ x: k.x, y: k.y, z: k.z + 2.5, text: `Boss: ${name.split("/").pop()}`, color: "#ff6b6b", age: 0 });
      return;
    }
    const count = Math.min(12, 2 + a.wave);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2, d = 5 + Math.random() * 3;
      const spot = this.collision.findSpawn(k.x + Math.cos(ang) * d, k.y + Math.sin(ang) * d, 0.5, MONSTER_MASK);
      if (!spot) continue;
      const results = this.tables.evaluate({ name: a.family }, { depth: this.depth, tier: this.tier(), difficulty: this.difficulty });
      for (const r of results) if (r.actor) this.logic.spawn(r.actor, spot[0], spot[1], ang + Math.PI, this.knightEntity, this.knightEntity);
    }
  }

  /** Resumes the arena after a checkpoint. */
  continueArena() { if (this.arena) this.arena.timer = 2; }

  /** Spawn tables have tiers by depth (1 to 8, 9 to 17, 18 and below). */
  /** The Clockworks tier of the current depth (tier 2 starts at Moorcroft Manor, depth 8). */
  private tier() { return this.depth >= 18 ? 3 : this.depth >= 8 ? 2 : 1; }

  /**
   * Tags a drop's source carries: a monster's family (its config folder, Monster/Slime/...,
   * as fam_slime) and its actor tags; other sources (treasure, blocks) take the floor's theme.
   */
  private sourceTags(source: Entity): string[] {
    const fam = /\/Monster\/(Beast|Construct|Fiend|Gremlin|Slime|Undead)\//.exec(source.name ?? "")?.[1]?.toLowerCase();
    const own = (source.tags ?? []).filter(t => t.startsWith("fam_"));
    if (fam) return [...new Set([`fam_${fam}`, ...own])];
    return own.length ? own : this.themeTags;
  }

  private healKnight(amount: number) {
    const k = this.knight;
    if (k.dead) return;
    // poison's heal modifier
    for (const s of k.statuses) amount *= s.def.heal;
    k.health = Math.min(k.maxHealth, k.health + amount);
    this.floaters.push({ x: k.x, y: k.y, z: k.z + 1.5, text: `+${Math.round(amount)}`, color: "#7bd88f", age: 0 });
  }

  /** While true the exit elevator does not run (a boss floor until the boss falls). */
  exitLocked: (() => boolean) | null = null;
  private lockNotice = -10;

  private finishLevel(elevator?: Prop) {
    if (this.finished) return;
    if (this.exitLocked?.()) {
      if (this.clock - this.lockNotice > 3) {
        this.lockNotice = this.clock;
        const k = this.knight;
        this.floaters.push({ x: k.x, y: k.y, z: k.z + 2.2, text: "Defeat the boss to use the elevator", color: "#ff9a9a", age: 0 });
      }
      return;
    }
    this.finished = true;
    const model = elevator ? elevator.instance ?? this.rideModel?.(elevator.x, elevator.y) ?? null : null;
    if (elevator && model) this.startRide(elevator, model);
    else this.onNextFloor?.();
  }

  /**
   * The exit elevator's ride: the platform plays its activate state, then its going-down state
   * (Elevator sprite states 2 and 3), with the knight standing on it and sinking with it; the
   * floor ends when the ride does.
   */
  private ride: { p: Prop; inst: ModelInstance; t: number; stage: 0 | 1 | 2; z0: number; base: number | null; at: number } | null = null;
  /**
   * The model an elevator actor animates: its sprite is a StatefulEntry, which drives the
   * scene's own elevator model placed where the actor stands (the game supplies it).
   */
  rideModel: ((x: number, y: number) => ModelInstance | null) | null = null;
  /** True while the knight rides the exit elevator down. */
  get riding() { return !!this.ride; }

  private startRide(p: Prop, inst: ModelInstance) {
    const st = p.states;
    void this.preload(st[2], st[3]);
    this.ride = { p, inst, t: 0, stage: 0, z0: this.knight.z, base: null, at: 0 };
    const k = this.knight;
    k.shielding = false;
    this.setShieldEffect(false);
    this.play(k, "character/pc/idle.dat");
  }

  private updateRide(dt: number) {
    const r = this.ride!, k = this.knight, p = r.p, inst = r.inst;
    r.t += dt;
    k.instance.time += dt;
    k.invulnerable = Math.max(k.invulnerable, 0.5);
    // onto the middle of the platform
    const f = 1 - Math.exp(-dt * 6);
    k.x += (p.x - k.x) * f; k.y += (p.y - k.y) * f;
    const st = p.states;
    if (r.stage === 0) {
      const clip = this.clip(st[2]);
      if (clip || r.t > 2) { if (clip) inst.play(clip, { loop: false, blend: 0.05 }); r.stage = 1; r.at = r.t; }
    } else if (r.stage === 1) {
      if (inst.finished || r.t - r.at > 1.5) {
        const clip = this.clip(st[3]);
        if (clip || r.t - r.at > 3) { if (clip) inst.play(clip, { loop: false, blend: 0.05 }); r.stage = 2; r.at = r.t; }
      }
    } else {
      // the knight goes down with the platform
      inst.update();
      const node = inst.world.has("mesh_platform") ? inst.nodeMatrix("mesh_platform")[14] : null;
      if (node !== null) { r.base ??= node; k.z = r.z0 + (node - r.base); }
      else k.z = r.z0 - 2 * (r.t - r.at);
      if (inst.finished || r.t - r.at > 6) {
        this.ride = null;
        this.onNextFloor?.();
      }
    }
  }

  // ---------------------------------------------------------------- props

  private createProp(e: Entity, cfg: any) {
    const kind = propKind(cfg);
    const p = new Prop(kind, e, cfg);
    e.game = p;
    p.z = this.collision.groundZ(e.x, e.y);
    if (kind === "door") p.open = !!cfg.open;
    if (kind === "switch" && cfg.collisionMask === 0 && (cfg.handlers ?? []).some((h: any) => /\$Damage$/.test(h?.$class ?? ""))) p.strikable = true;
    if (kind === "block") {
      // no block config sets health, so the closed code's default applies: counted here in
      // hits (treasure boxes and mineral nodes take a few, crates one)
      const cls = String(cfg.$class).split("$").pop();
      // (stone blocks give their hits: a mortar shell's 2)
      p.health = p.maxHealth = cfg.health ?? cfg.hits ?? (/Treasure|Mineral|Gathering|Stone/.test(e.name) ? 3 : 1);
      p.hits = cfg.health === undefined;
      p.breakable = !/Unbreakable|Hedgehog|Echo/i.test(e.name) && cls !== "DamageMirrorBlock";
    }
    if (kind === "trap") {
      // the intersection handler fires "Traps and Hazards/Trap, floor" with the plate's size;
      // its damage is the first tier's (the tiers are picked by closed conditions)
      const fire = (cfg.handlers ?? []).map((h: any) => h?.action?.action?.fireAction ?? h?.action?.fireAction).find(Boolean);
      const size = String((fire?.arguments?.entries as [string, any][] | undefined)?.find(([k]) => k === "Damage Size")?.[1] ?? "1x1");
      const [w, h] = size.split("x").map(Number);
      p.trapHalf = Math.max(w || 1, h || 1) / 2;
      p.trapB = cfg.cycle?.name === "B" || /"B"/.test(JSON.stringify(cfg.cycle ?? ""));
      p.trapCycle = cfg.cycle?.name ?? "A";
      const fa = fire ? this.data.resolveSync("config/fire_action.dat", fire, "action") : null;
      // the tiers' damage (and status infliction) by the floor's tier
      const tiers = (fa?.action ?? fa)?.actions ?? [];
      const first = (tiers[this.tier() - 1] ?? tiers[0])?.action?.actions?.[0];
      p.trapDamage = first?.damage ?? null;
      // rocket and fire blocks fire from their TrapState handler instead of striking the plate
      p.trapStrikes = !!fire;
      p.trapInterval = (cfg.interval ?? 1000) / 1000;
    }
    // dungeon objects (objects.ts) take their hits themselves, gun blocks included
    if (this.objects.setup(p)) p.strikable = false;
    (e.game as any).onSignal = (name: string) => this.propSignal(p, name);
    this.props.push(p);
    this.updatePropCollision(p);
    const model = cfg.sprite?.model ?? cfg.model;
    if (model) void this.loader.loadRef(model).catch(() => null).then(async m => {
      // models the install lacks (the prism puzzle's) get stand-ins
      const alt = m ? null : standInModel(p);
      if (alt) m = await this.loader.loadRef(alt).catch(() => null);
      if (!m || !this.props.includes(p)) return;
      p.instance = await this.instantiate(m);
      this.showPropState(p);
    });
  }

  /** Doors and blocks block movement while closed or standing. */
  private updatePropCollision(p: Prop) {
    const flags = p.cfg.collisionFlags ?? 1;
    const solid = (p.kind === "door" && !p.open) || (p.kind === "block" && flags !== 0)
      || (p.kind === "generic" && (flags & 1) !== 0 && !!p.cfg.shape)
      // hit switches (emitters, gun blocks, cages) stand like blocks; rocket blocks too
      || (p.kind === "switch" && !!p.obj && (flags & 1) !== 0)
      || (p.kind === "trap" && !!p.cfg.shape && (flags & 3) !== 0);
    if (solid && p.collisionId === null) {
      const sh = p.cfg.shape;
      let w = (sh?.width ?? (sh?.radius ? sh.radius * 2 : 1)) / 2, h = (sh?.height ?? (sh?.radius ? sh.radius * 2 : 1)) / 2;
      if (/Compound$/.test(sh?.$class ?? "")) {
        // a cage's bars: the box around its pieces
        let mx = 0.5, my = 0.5;
        for (const t of sh.shapes ?? []) {
          const tr = t?.transform?.translation, s = t?.shape;
          mx = Math.max(mx, Math.abs(tr?.x ?? 0) + (s?.width ?? 1) / 2);
          my = Math.max(my, Math.abs(tr?.y ?? 0) + (s?.height ?? 1) / 2);
        }
        w = mx; h = my;
      }
      const c = Math.abs(Math.cos(p.entity.rotation)), s2 = Math.abs(Math.sin(p.entity.rotation));
      p.collisionId = this.nextId++;
      this.collision.addBox(p.collisionId, p.x, p.y, w * c + h * s2, w * s2 + h * c, p.kind === "trap" ? (flags & 3) : 1);
    } else if (!solid && p.collisionId !== null) {
      this.collision.remove(p.collisionId);
      p.collisionId = null;
    }
  }

  /** Plays the prop's state animation (door open or closed, switch up or down). */
  private showPropState(p: Prop, changed = false) {
    if (!p.instance) return;
    const st = p.states;
    let anim: any = null, loop = true;
    if (p.obj && st.length) {
      // dungeon objects pick their state (objects.ts)
      anim = st[p.obj.state ?? 0] ?? null;
      loop = p.obj.loop ?? true;
    } else if (p.kind === "door") {
      anim = changed ? st[p.open ? 2 : 0] : st[p.open ? 3 : 1];
      loop = !changed;
    } else if (p.kind === "switch") anim = st[p.pressed ? 1 : 0];
    else if (p.kind === "trap") {
      anim = st[p.trapState] ?? null;
      loop = false;
    } else {
      // townsfolk and other animated actors play their idles, the next drawn by weight when
      // one ends (src/game/townsfolk.ts); a looping idle plays on
      const idles: any[] = p.cfg.sprite?.idles ?? [];
      const i = pickWeighted(idles);
      anim = i === null ? null : idles[i].animation;
      const c = anim ? this.clip(anim) : null;
      if (c) loop = idles.length > 1 ? c.loop : true;
    }
    const clip = anim ? this.clip(anim) : null;
    if (clip) p.instance.play(clip, { loop, blend: 0.05 });
    // wait for the clip once (a clip that failed to load stays null: no retry)
    else if (anim && !this.ready.has(clipKey(anim))) void this.preload(anim).then(() => { if (this.ready.get(clipKey(anim))) this.showPropState(p, changed); });
  }

  /** Doors open and close on signals; anything else listens through its handlers only. */
  private propSignal(p: Prop, name: string) {
    if (this.objects.signal(p, name)) return;
    if (p.kind === "trap") {
      // rocket block controls switch their blocks off
      if (/^(deactivate|off|close|stop|disable)$/i.test(name)) p.trapOff = true;
      else if (/^(activate|on|open|start|enable)$/i.test(name)) p.trapOff = false;
      return;
    }
    if (p.kind !== "door") return;
    const open = name === "open" ? true : name === "close" ? false : name === "toggle" ? !p.open : p.open;
    if (open === p.open) return;
    p.open = open;
    this.updatePropCollision(p);
    this.showPropState(p, true);
  }

  private removeProp(p: Prop, effect: boolean) {
    const i = this.props.indexOf(p);
    if (i < 0) return;
    this.props.splice(i, 1);
    if (p.collisionId !== null) { this.collision.remove(p.collisionId); p.collisionId = null; }
    const fx = p.cfg.sprite?.destructionTransient;
    if (effect && fx?.name) this.spawnEffect(fx, p.matrix(), 2);
    // crystal and ghost chains go with it; a cage frees its prisoner
    if (effect) this.objects.destroyed(p);
  }

  /**
   * A pickup's item: health heals, crowns and heat add up, anything else goes to the
   * materials tally. The amounts come from the item config's arguments where it has them.
   */
  private collect(p: Prop) {
    const ref = p.cfg.pickupAction?.item;
    const name = String(ref?.name ?? p.entity.name);
    const item = ref ? this.data.resolveSync("config/item.dat", ref, "item") : null;
    const num = (...keys: string[]) => { for (const k of keys) if (typeof item?.[k] === "number") return item[k]; return null; };
    // coins and embers are worth their denomination in the valued tables (Treasure/Crowns/Value/Base)
    const coin = this.tables?.coinValue(p.entity.name) ?? 0;
    if (/Health|Heart/i.test(name)) this.healKnight(num("health", "amount") ?? this.knight.maxHealth * 0.25);
    else if (/Crown|Slime Coin/i.test(name)) {
      const v = coin || num("value", "amount", "crowns") || 1;
      this.loot.crowns += v;
      this.floaters.push({ x: p.x, y: p.y, z: p.z + 1, text: `+${v} cr`, color: "#ffd84d", age: 0 });
    } else if (/Heat|Ember/i.test(name)) {
      const v = coin || num("heat", "amount", "value") || 1;
      this.loot.heat += v;
      this.floaters.push({ x: p.x, y: p.y, z: p.z + 1, text: `+${v} heat`, color: "#ff9a4d", age: 0 });
    } else if (ref) this.awardItem(ref, p.x, p.y);
    // boost orbs are instant buffs (not modelled), not items to bank
    else if (!/\/Orbs\//.test(name)) this.loot.materials.set(name, (this.loot.materials.get(name) ?? 0) + 1);
  }

  /** The item config for a pocket item (capsule or vial), or null for anything else. */
  pocketItem(name: string): any | null {
    const it = this.data.resolveSync("config/item.dat", { name }, "item");
    return /\$(Capsule|Vial)$/.test(String(it?.$class ?? "")) ? it : null;
  }

  /** Puts a consumable in the pocket; false when every slot holds something else. */
  private pocketAdd(name: string): boolean {
    const slot = this.pocket.find(p => p[0] === name);
    if (slot) { slot[1]++; return true; }
    if (this.pocket.length >= POCKET_SLOTS) return false;
    this.pocket.push([name, 1]);
    return true;
  }

  /**
   * Uses the item in pocket slot `i`. Capsules act on the knight after their action delay
   * (healing, buffs, remedies, barriers); vials are thrown a few metres ahead and shatter,
   * their action striking what stands around the point.
   */
  useItem(i: number): boolean {
    const k = this.knight, slot = this.pocket[i];
    if (k.dead || !slot) return false;
    const it = this.pocketItem(slot[0]);
    if (!it?.action) return false;
    if (--slot[1] <= 0) this.pocket.splice(i, 1);
    const ke = this.knightEntity;
    if (/\$Vial$/.test(it.$class)) {
      const d = 3.5, x = k.x + Math.cos(k.heading) * d, y = k.y + Math.sin(k.heading) * d;
      const at = new Entity(false, "vial");
      at.x = x; at.y = y; at.rotation = k.heading;
      at.fixedShape = { k: "circle", x, y, r: 2 };
      const z = this.collision.groundZ(x, y);
      if (it.destructionTransient) void this.spawnEffect(it.destructionTransient, compose([x, y, z], [0, 0, 0, 1], 1), 3);
      this.logic.execute(it.action, at, ke);
    } else {
      this.delayed.push({ t: (it.actionDelay ?? 0) / 1000, run: () => { if (!k.dead) this.logic.execute(it.action, ke, ke); } });
    }
    return true;
  }

  /**
   * An item from a loot table: capsules and vials go to the pocket, mineral deposits count
   * their minerals (1, 2, 4 or 6), gear joins the floor's finds with any unique variants it
   * rolls, and materials add to the tally.
   */
  private awardItem(item: any, x: number, y: number) {
    const name = String(item.name);
    const z = this.collision.groundZ(x, y) + 1;
    const label = itemName(name);
    if (this.pocketItem(name)) {
      if (this.pocketAdd(name)) {
        const slot = this.pocket.findIndex(p => p[0] === name);
        if (!this.acquire(name, 1, slot)) this.floaters.push({ x, y, z, text: label, color: "#9ff0c0", age: 0 });
      }
      return;
    }
    // dungeon vitapod drops ("Always Better") heal a pip per level on the spot
    const pod = /^Gear\/Dungeon\/Vitapod\/Health \+(\d+)/.exec(name);
    if (pod) { this.healKnight(10 * Number(pod[1])); this.floaters.push({ x, y, z, text: `+${pod[1]} health`, color: "#ff8a8a", age: 0 }); return; }
    const eco = this.economy, info = eco?.info(name);
    const dep = info?.category === "deposit" ? eco!.deposit(name) : null;
    if (dep) {
      this.loot.materials.set(dep.mineral, (this.loot.materials.get(dep.mineral) ?? 0) + dep.count);
      if (!this.acquire(dep.mineral, dep.count)) this.floaters.push({ x, y, z, text: `+${dep.count} ${itemName(dep.mineral)}`, color: "#e0a8ff", age: 0 });
      return;
    }
    if (eco && info && (info.heatable || info.category === "trinket")) {
      const variants = eco.rollVariants(name);
      this.loot.items.push({ name, variants });
      if (!this.acquire(name)) this.floaters.push({ x, y, z, text: eco.displayName(name, { heat: 0, level: 1, variants }), color: "#ffe9a0", age: 0 });
      return;
    }
    this.loot.materials.set(name, (this.loot.materials.get(name) ?? 0) + 1);
    if (!this.acquire(name)) this.floaters.push({ x, y, z, text: label, color: "#c9e6ff", age: 0 });
  }

  /** A hit on a prop from a knight (by 2) or a hazard, bullet or blast (by 1). */
  private damageProp(p: Prop, amount: number, by = 2) {
    if (p.entity.destroyed) return;
    if (this.objects.hit(p, by)) return;
    if (!p.breakable) return;
    this.logic.damaged(p.entity, this.knightEntity);
    // each hit runs the block's damage action (treasure boxes spill loot as they are struck)
    if (p.cfg.damageAction) this.logic.execute(p.cfg.damageAction, p.entity, this.knightEntity);
    p.health -= p.hits ? 1 : amount;
    if (p.health <= 0) this.logic.destroy(p.entity, this.knightEntity);
  }

  /**
   * A blow rings a strikable switch (a Beast Bell): its Damage handler runs, and unless it is
   * cooling down (the Cooldown parameter its handler's condition carries) it swings into its
   * second state, running that state's action, and settles back once the cooldown passes.
   */
  strikeProp(p: Prop) {
    if (p.entity.destroyed) return;
    this.logic.damaged(p.entity, this.knightEntity);
    if (this.clock < p.cooldownUntil) return;
    const cooldown = Number(p.cfg.handlers?.find((h: any) => /\$Damage$/.test(h?.$class ?? ""))?.action?.condition?.time ?? 8000);
    p.cooldownUntil = this.clock + cooldown / 1000;
    p.pressed = true;
    this.showPropState(p);
    const act = p.cfg.stateActions?.[1];
    if (act) this.logic.execute(act, p.entity, this.knightEntity);
    this.boss?.struck?.(p);
  }

  /** Per-tick prop behaviour: switches pressed underfoot, pickups, carried keys, the elevator. */
  private updateProps(dt: number, interact: boolean) {
    const k = this.knight, ke = this.knightEntity;
    const kshape = { k: "circle" as const, x: k.x, y: k.y, r: KNIGHT_RADIUS };
    const touching = (p: Prop) => { const s = p.entity.shape(); return !!s && intersects(s, kshape); };
    let interacted = false;
    for (const p of [...this.props]) {
      if (p.instance) p.instance.advance(dt);
      // a townsperson's idle ended: the next one
      if (p.kind === "generic" && !p.obj && p.instance?.finished && (p.cfg.sprite?.idles?.length ?? 0) > 1) this.showPropState(p);
      switch (p.kind) {
        case "switch": {
          // hit switches (emitters, gun blocks, cages) are not stood on
          if (p.obj) break;
          if (p.strikable) {
            if (p.pressed && this.clock >= p.cooldownUntil) { p.pressed = false; this.showPropState(p); }
            break;
          }
          // party platforms answer to the party (knights) only, and stay down once pressed
          const party = /Party Platform/i.test(p.entity.name);
          const on = touching(p) || (!party && this.monsters.some(m => m.state !== "dying" && Math.hypot(m.x - p.x, m.y - p.y) < m.radius + 0.4));
          const oneTime = party || /One-Time/i.test(p.entity.name);
          if (on !== p.pressed && (!oneTime || on)) {
            p.pressed = on;
            this.showPropState(p);
            // a switch runs the action for the state it enters (Switch stateActions)
            const act = p.cfg.stateActions?.[on ? 1 : 0];
            if (act) this.logic.execute(act, p.entity, ke);
          }
          break;
        }
        case "pickup":
          if (!k.dead && touching(p)) {
            this.collect(p);
            const fx = p.cfg.sprite?.pickupTransient;
            if (fx?.name) this.spawnEffect(fx, p.matrix(), 2);
            this.logic.destroy(p.entity, ke);
          }
          break;
        case "lift":
          if (p.carried) {
            p.entity.x = k.x; p.entity.y = k.y; p.z = k.z + 1.9;
          } else if (interact && !interacted && !this.props.some(o => o.carried) && Math.hypot(p.x - k.x, p.y - k.y) < 1.2) {
            p.carried = true;
            interacted = true;
          }
          break;
        case "trap": {
          const st = p.trapOff ? 0 : trapState(this.clock, p.trapCycle, p.trapInterval);
          if (st !== p.trapState) {
            p.trapState = st;
            this.showPropState(p);
            // rocket and fire blocks launch from their TrapState handler as they fire
            if (st === 2) for (const h of p.entity.handlers) if (h.kind === "TrapState") this.logic.execute(h.cfg.action, p.entity, p.entity);
          }
          // extended spikes strike a knight standing on the plate
          if (st === 2 && p.trapStrikes && !k.dead && Math.abs(k.x - p.x) < p.trapHalf + KNIGHT_RADIUS * 0.5 && Math.abs(k.y - p.y) < p.trapHalf + KNIGHT_RADIUS * 0.5) {
            this.damageKnight(this.amounts(p.trapDamage, this.ctx(0)), 0.5, p.x, p.y);
          }
          break;
        }
        case "elevator":
          if (!k.dead && touching(p)) {
            p.standTime += dt;
            if (p.standTime > 1.5 && !this.finished) this.finishLevel(p);
          } else p.standTime = 0;
          break;
      }
    }
    if (!interact || interacted) return;
    // the action key: use a door with a carried key, drop a carried object, or interact
    const carried = this.props.find(p => p.carried);
    const near = this.props.filter(p => p !== carried && Math.hypot(p.x - (k.x + Math.cos(k.heading) * 0.7), p.y - (k.y + Math.sin(k.heading) * 0.7)) < 1.6)
      .sort((a, b) => Math.hypot(a.x - k.x, a.y - k.y) - Math.hypot(b.x - k.x, b.y - k.y));
    const door = near.find(p => p.kind === "door" && !p.open);
    if (door && /\$Energy$/.test(door.cfg.actionDesc?.$class ?? "") && !carried) {
      // an energy gate opens for its energy (paid in crowns here)
      if (this.payEnergy(door.cfg.actionDesc.amount ?? 5)) this.propSignal(door, "open");
      return;
    }
    if (door && carried && carried.cfg.actionableSignal && carried.cfg.actionableSignal === door.cfg.actionableSignal) {
      // a carried key with the door's signal unlocks it and is used up
      this.logic.signal(door.entity, carried.entity, door.cfg.actionableSignal);
      this.propSignal(door, "open");
      carried.carried = false;
      this.logic.destroy(carried.entity, ke);
      return;
    }
    if (carried) {
      carried.carried = false;
      carried.entity.x = k.x + Math.cos(k.heading) * 0.8;
      carried.entity.y = k.y + Math.sin(k.heading) * 0.8;
      carried.z = this.collision.groundZ(carried.x, carried.y);
      if (this.boss?.dropped?.(carried)) this.logic.destroy(carried.entity, ke);
      return;
    }
    const target = near.find(p => p.entity.handlers.some(h => h.kind === "Interaction"));
    if (target) { this.logic.interact(target.entity, ke); return; }
    // traders and townsfolk that are actors with interactions (gremlin merchants)
    const fx = k.x + Math.cos(k.heading) * 0.7, fy = k.y + Math.sin(k.heading) * 0.7;
    const npc = this.monsters.filter(m => m.passive && m.entity?.handlers.some(h => h.kind === "Interaction") && Math.hypot(m.x - fx, m.y - fy) < 1.8)
      .sort((a, b) => Math.hypot(a.x - k.x, a.y - k.y) - Math.hypot(b.x - k.x, b.y - k.y))[0];
    if (npc?.entity) this.logic.interact(npc.entity, ke);
  }

  /**
   * Item levels and unique variants of the worn gear: weapons gain their level's damage and
   * charge time reduction and their variants' family damage, attack speed and charge;
   * armour, helmets and shields gain their level's defence and health, and their variants'
   * defences and resistances apply to the knight.
   */
  private applyGearState(k: Knight, weapons: WeaponDef[], worn: (string | undefined)[]) {
    const eco = this.economy;
    this.weaponBonus.clear();
    this.defenseLevel.clear();
    this.variantDefense = [];
    this.weaponLevels.clear();
    if (!eco) return;
    const level = (n: string) => this.gear[n]?.level ?? 1;
    for (const w of weapons) {
      const lv = level(w.name), st = eco.levelStats(w.name, lv, this.depth);
      const b = { damage: st.damage, uncapped: st.uncapped, charge: st.charge, attackSpeed: 0, tagged: {} as Record<string, number> };
      for (const v of eco.variantEffects(this.gear[w.name]?.variants ?? [])) {
        if (v.tagged) b.tagged[v.tagged.tag] = (b.tagged[v.tagged.tag] ?? 0) + v.tagged.damage;
        b.attackSpeed += v.attackSpeed ?? 0;
        b.charge += v.charge ?? 0;
        b.damage += v.damage ?? 0;
      }
      this.weaponBonus.set(w.name, b);
      this.weaponLevels.set(w.name, lv);
    }
    for (const n of worn) {
      if (!n) continue;
      const info = eco.info(n), lv = level(n);
      if (info?.heatable) {
        const st = eco.levelStats(n, lv, this.depth);
        this.defenseLevel.set(n, st.defense);
        k.bonuses.health += st.health;
      }
      for (const v of eco.variantEffects(this.gear[n]?.variants ?? [])) {
        if (v.defense) this.variantDefense.push({ def: v.defense, rarity: info?.rarity ?? 0 });
        if (v.resist) for (let bit = 1; bit <= v.resist.mask; bit <<= 1) if (v.resist.mask & bit) {
          const held = k.bonuses.resist[bit] ?? 0;
          k.bonuses.resist[bit] = held + (v.resist.scaled ? Math.round(Math.min(1, 1 - held / 100) * v.resist.points) : v.resist.points);
        }
        if (v.tagged) k.bonuses.tagged[v.tagged.tag] = (k.bonuses.tagged[v.tagged.tag] ?? 0) + v.tagged.damage;
        k.bonuses.health += v.health ?? 0;
        k.bonuses.speed += v.speed ?? 0;
      }
    }
  }

  /** Depth-scaled defence and shield health from the knight's gear. */
  private updateKnightStats(k: Knight) {
    const d = zeroAmounts();
    for (const a of k.armor) {
      if (!a.defense) continue;
      const own = this.data.depth.defense(a.defense, this.ctx(a.rarity));
      const add = this.defenseLevel.get(a.name) ?? 0;
      for (const t of DAMAGE_TYPES) d[t] += own[t] > 0 ? own[t] + add : 0;
    }
    for (const { def, rarity } of this.variantDefense) {
      const t = def.type as keyof Amounts;
      // VariantConfig DefenseTypeBonus: its depth scale, rounded up (no scale, no bonus)
      if (t in d) d[t] += def.depthScale ? Math.ceil(this.data.depth.evaluate(def.depthScale, this.ctx(rarity))) : 0;
    }
    k.defense = d;
    k.maxHealth = KNIGHT_HEALTH + k.bonuses.health;
    if (k.shield) {
      const sctx = this.ctx(k.shield.rarity);
      k.shieldMax = Math.max(1, this.data.depth.evaluate(k.shield.healthScale, sctx) || 50);
      k.shieldHealth = Math.min(k.shieldHealth, k.shieldMax);
      if (k.shieldHealth <= 1) k.shieldHealth = k.shieldMax;
      k.shieldDefense = k.shield.defense ? this.data.depth.defense(k.shield.defense, sctx) : null;
      const add = this.defenseLevel.get(k.shield.name) ?? 0;
      if (k.shieldDefense && add) for (const t of DAMAGE_TYPES) if (k.shieldDefense[t] > 0) k.shieldDefense[t] += add;
    }
  }

  /** A projectile definition and model, loaded once per actor reference. */
  private projectileDef(ref: any) {
    const key = JSON.stringify(ref, (k, v) => (k === "$outer" ? undefined : v));
    let p = this.projectileDefs.get(key);
    if (!p) {
      p = this.data.projectile(ref).then(async def => def
        ? { def, model: def.model ? await this.loader.loadRef(def.model).catch(() => null) : null } : null).catch(() => null);
      this.projectileDefs.set(key, p);
    }
    return p;
  }

  // ---------------------------------------------------------------- animation helpers

  /**
   * Makes a model instance and starts the automatic animations of its parts (a weapon's idle
   * spin, a bomb's wobble, a flag on a prop); `self` includes the instance's own, which an
   * actor's idle replaces anyway.
   */
  private async instantiate(model: LoadedModel, self = true): Promise<ModelInstance> {
    const inst = await this.renderer.instantiate(model);
    for (const d of inst.descendants()) {
      if ((d === inst && !self) || !d.model.root || d.clip) continue;
      const auto = d.model.autoAnimations[0];
      if (!auto) continue;
      this.clip(auto);
      const c = await this.clips.get(clipKey(auto));
      if (c && !d.clip) d.play(c, { loop: c.loop, blend: 0 });
    }
    return inst;
  }

  /** The weapon's own model inside the knight's (where its "ks_" animations play). */
  private weaponModel(k: Knight): ModelInstance | null {
    for (const d of k.instance.descendants()) {
      const a = d.model.animations;
      if (d !== k.instance && d.model.root && (a.ks_attack || a.ks_charge || a.ks_default)) return d;
    }
    return null;
  }

  /** Plays one of the weapon model's named animations (ks_attack, ks_charge, ks_default). */
  private weaponAnim(k: Knight, name: string, loop = false): boolean {
    const w = this.weaponModel(k);
    const ref = w?.model.animations[name];
    if (!w || !ref) return false;
    const c = this.clip(ref);
    if (c) w.play(c, { loop, blend: 0.05 });
    else void this.preload(ref);
    return true;
  }

  private play(a: Actor, path: string | any | undefined, opts: { loop?: boolean; speed?: number; blend?: number } = {}) {
    const c = this.clip(path);
    if (c) a.instance.play(c, opts);
  }

  /** Plays a clip on the knight's upper body. */
  private overlay(a: Actor, path: string | any | undefined, loop = false, speed = 1) {
    const c = this.clip(path);
    if (c && a.upperBody) a.instance.playOverlay(c, a.upperBody, { loop, speed });
  }

  // ---------------------------------------------------------------- update

  update(dt: number, input: KnightInput) {
    this.clock += dt;
    // the action button acts while the knight has something to act on and is not mid-attack
    // (Knight.Nu: an action description, and an activity that allows it): "Press ATTACK to..."
    if (input.attackDown && !this.ride && !this.knight.attack && !this.knight.dead && this.actionTarget()) {
      input = { ...input, attackDown: false, attackHeld: false, interact: true };
    }
    if (this.ride) this.updateRide(dt); else this.updateKnight(dt, input);
    this.companion?.update(dt);
    for (const m of this.monsters) this.updateMonster(m, dt);
    this.updateProps(dt, !!input.interact && !this.knight.dead);
    this.objects.update(dt);
    // the logic sees actors where the game has moved them
    const ke = this.knightEntity;
    ke.x = this.knight.x; ke.y = this.knight.y; ke.rotation = this.knight.heading;
    ke.collisionFlags = this.knight.dead ? 0 : 4;
    for (const m of this.monsters) if (m.entity) { m.entity.x = m.x; m.entity.y = m.y; m.entity.rotation = m.heading; }
    this.logic.tick(dt * 1000);
    for (const d of [...this.delayed]) if ((d.t -= dt) <= 0) { this.delayed.splice(this.delayed.indexOf(d), 1); d.run(); }
    if (this.arena) this.updateArena(dt);
    this.boss?.update(dt);
    this.separate();
    this.updateProjectiles(dt);
    this.runEvents();
    for (const e of this.effects) {
      e.life -= dt;
      e.instance?.advance(dt);
      const sc = e.script;
      if (sc) {
        sc.t += dt;
        while (sc.next < sc.actions.length && sc.actions[sc.next].time <= sc.t) this.modelAction(sc.actions[sc.next++].action, e.follow ? e.follow.matrix() : e.matrix, e.follow);
        if (sc.next >= sc.actions.length && sc.loop > 0 && sc.t >= sc.loop) { sc.t -= sc.loop; sc.next = 0; }
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) if (this.effects[i].life <= 0) this.effects.splice(i, 1);
    for (const f of this.floaters) f.age += dt;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      if (f.age > (f.style ? numberLength(f.style) : 1.2)) this.floaters.splice(i, 1);
    }
    // struck actors' colour flash
    this.knight.instance.tint = hitFlash((this.clock - this.knight.flashAt) * 1000);
    for (const m of this.monsters) m.instance.tint = hitFlash((this.clock - m.flashAt) * 1000);
    for (let i = this.shakes.length - 1; i >= 0; i--) if (this.clock - this.shakes[i].at >= this.shakes[i].spec.duration) this.shakes.splice(i, 1);
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      if (m.state === "dying" && m.stateTime > this.deathLength(m)) this.monsters.splice(i, 1);
    }
  }

  private move(a: { x: number; y: number; z: number; radius: number }, dx: number, dy: number, mask: number) {
    if (!this.collision.collides(a.x + dx, a.y, a.radius, mask)) a.x += dx;
    if (!this.collision.collides(a.x, a.y + dy, a.radius, mask)) a.y += dy;
    const g = this.collision.groundZ(a.x, a.y);
    a.z += (g - a.z) * 0.25;
  }

  /** Moves an actor along its impulse; one that cannot move (frozen, asleep, in a spasm) loses it. */
  private applyKnockback(a: Actor, dt: number, mask: number) {
    const imp = a.impulse;
    if (!imp) return;
    if (a.statuses.some(s => s.def.kind === "Freeze" || s.def.kind === "Sleep" || (s.spasm ?? 0) > 0)) { a.impulse = null; return; }
    const u0 = imp.t / imp.dur;
    imp.t = Math.min(imp.dur, imp.t + dt);
    const f = impulseShare(u0, imp.t / imp.dur);
    this.move(a, imp.dx * f, imp.dy * f, mask);
    if (imp.t >= imp.dur) a.impulse = null;
  }

  /**
   * Starts an impulse. One still under way merges in: what it had left to move is added, and
   * the new one lasts until the later of the two ends.
   */
  private addImpulse(a: Actor, dx: number, dy: number, dur: number) {
    dur = Math.max(0.001, dur);
    const old = a.impulse;
    if (old) {
      const left = 1 - impulseShare(0, old.t / old.dur);
      dx += old.dx * left;
      dy += old.dy * left;
      dur = Math.max(dur, old.dur - old.t);
    }
    a.impulse = { dx, dy, t: 0, dur };
  }

  /**
   * Switches to a carried weapon: the knight model with that weapon takes over. The client
   * applies a switch only while the knight is idle or shielding; one asked for meanwhile
   * waits (Dungeoneer advancer: the weapon index is read when `Np()` or defending).
   */
  private switchWeapon(slot: number) {
    const k = this.knight;
    if (slot === k.slot || !k.weapons[slot]) { k.pendingSlot = null; return; }
    if (!k.control.canSwitch()) { k.pendingSlot = slot; return; }
    k.pendingSlot = null;
    const next = k.weapons[slot];
    next.instance.time = k.instance.time;
    next.instance.overlay = k.instance.overlay;
    k.instance = next.instance;
    k.slot = slot;
    if (!k.shielding) this.play(k, "character/pc/idle.dat");
  }

  /** Auto-targeting (the options menu can turn it off; the client's own preference, on by default). */
  autoAimOn = true;

  /**
   * The client's auto-target (`dungeon/util/b`): the nearest monster whose shape meets the
   * triangle from the knight out `targetingDist` at `targetingAngle / 2` either side of its
   * facing. Swords, guns and bombs all have one (3 units, 90 degrees by default).
   */
  private findTarget(): Monster | null {
    const k = this.knight, w = k.weapon;
    if (!this.autoAimOn || !w) return null;
    const fair = (m: Monster) => m.state !== "dying" && m.state !== "spawning" && !m.passive && !m.ally;
    // the target held stays while it is within twice the wedge's angle (dungeon/util/i.Sc)
    const held = k.target;
    if (held && fair(held) && this.monsters.includes(held)
      && inTargetWedge(k.x, k.y, k.heading, w.targetingDist, w.targetingAngle * 2, held.x, held.y, held.radius)) return held;
    let best: Monster | null = null, bestD = Infinity;
    for (const m of this.monsters) {
      if (!fair(m)) continue;
      if (!inTargetWedge(k.x, k.y, k.heading, w.targetingDist, w.targetingAngle, m.x, m.y, m.radius)) continue;
      const d = (m.x - k.x) ** 2 + (m.y - k.y) ** 2;
      if (d < bestD) { best = m; bestD = d; }
    }
    return best;
  }

  /** The controller's view of the weapon in hand and the shield. */
  private knightRules(): WeaponRules {
    const k = this.knight, w = k.weapon;
    const speed = this.attackRate(k);
    const own = this.weaponBonus.get(w?.name ?? "")?.charge ?? 0;
    return {
      attacks: Math.min(8, w?.attacks.length ?? 0),
      charges: !!w?.chargedAttack && !!w?.incompleteChargedAttack,
      // Dungeoneer Rr: the charge time less the capped charge bonuses
      chargeTime: Math.trunc((w?.chargeTime ?? 2000) * (1 - capValue("CHARGE", forWeapon(k.bonuses.charge, w?.kind) + own))),
      maxChain: w?.maxChain ?? 0, chainCooldown: w?.chainCooldown ?? 0, cycles: w?.cycles ?? true,
      cooldown: !!w?.cooldownAttack, bash: !!k.shield?.bash, shield: !!k.shield,
      timing: slot => {
        const d = this.slotDef(slot);
        return d ? attackTiming(d, speed, slot !== "bash" && (w?.moves ?? true)) : null;
      },
    };
  }

  private slotDef(slot: AttackSlot): AttackDef | null {
    const k = this.knight, w = k.weapon;
    if (slot === "bash") return k.shield?.bash ?? null;
    if (slot === "charged") return w?.chargedAttack ?? null;
    if (slot === "incomplete") return w?.incompleteChargedAttack ?? null;
    if (slot === "cooldown") return w?.cooldownAttack ?? null;
    return w?.attacks[slot] ?? null;
  }

  /**
   * Knight controls as the client predicts them (src/game/knight.ts): the knight always faces
   * the pointer (when its activity lets it turn); a press starts an attack, and a press made
   * during a swing chains the next step at the swing's rearm if the button is still down;
   * holding through a swing charges from its rearm, and the release gives the charged attack
   * when full (else the next step). Swords root the knight for the whole swing; guns and bombs
   * fire on the move at the weapon's attacking speed. A gun's last shot in its clip starts the
   * reload at its rearm. The shield goes up when idle or once an attack has rearmed; the bash
   * (Shift + left click) needs a full shield; the dodge (Shift + right click) cannot break an
   * attack or a charge.
   */
  private updateKnight(dt: number, input: KnightInput) {
    const k = this.knight;
    k.instance.advance(dt);
    if (k.instance.overlay) k.instance.overlay.time += dt;
    k.invulnerable -= dt;
    k.hurtTime -= dt;
    k.sinceAttack += dt;
    this.updateShieldHealth(dt);
    k.sinceDamage += dt;
    if (k.sinceDamage > 0.6) k.recentDamage = Math.max(0, k.recentDamage - dt * 60);
    k.dashCooldown -= dt;
    const now = this.clock * 1000;
    const c = k.control;
    if (k.dead) { k.instance.overlay = null; this.setShieldEffect(false); this.endKnightActivity(); c.reset(now); return; }
    this.applyKnockback(k, dt, KNIGHT_MASK);
    if (this.tickStatuses(k, dt)) {
      // frozen, asleep or mid-spasm: no moving, turning or acting
      this.endKnightActivity();
      c.reset(now);
      if (k.hurtTime <= 0) this.play(k, "character/pc/idle.dat");
      return;
    }
    if (input.weaponSlot != null) this.switchWeapon(input.weaponSlot);

    // the action flag and when it last changed (ProjectXInputFrame `_actionChanged`); a click
    // shorter than a frame still reads as down for the frame it began
    const held = input.attackHeld || input.attackDown;
    if (held !== k.attackFlag) { k.attackFlag = held; k.attackChanged = now; }
    else if (input.attackDown) k.attackChanged = now;
    const ci: ControlInput = { attack: held, attackChanged: k.attackChanged, defend: input.shield, bash: !!input.bash, dodge: !!input.dash };
    const status: ControlStatus = {
      move: true, rotate: true, attack: true,
      defend: !!k.shield && k.shieldBroken <= 0,
      fullShield: !!k.shield && k.shieldBroken <= 0 && Math.round(k.shieldHealth) >= Math.round(k.shieldMax),
    };
    const rules = this.knightRules();
    const weapon = k.weapon;
    this.applyControl(c.update(now, ci, rules, status), now);

    // facing: the pointer's direction (TudeySceneController's rotation) whenever the activity
    // allows turning; a blended attack before its rearm keeps to its target
    const [mx, my] = input.move;
    const len = Math.hypot(mx, my);
    const moving = len > 0.01;
    if (c.allowsRotation(now)) {
      const t = k.target;
      if (c.isAttack() && !c.rearmed(now) && t && t.state !== "dying") k.heading = Math.atan2(t.y - k.y, t.x - k.x);
      else if (input.aim) k.heading = Math.atan2(input.aim[1] - k.y, input.aim[0] - k.x);
      else if (moving) k.heading = Math.atan2(my, mx);
    }
    // auto-target (`Sc`): picked each frame in the wedge ahead, not while walking for weapons
    // that target only standing still
    k.target = weapon && (weapon.targetingMoving || !moving) ? this.findTarget() : null;

    this.applyControl(c.act(now, ci, rules, DASH.cooldown * 1000, status), now, input);
    if (k.pendingSlot != null) this.switchWeapon(k.pendingSlot);

    // the activity under way
    const act = c.activity;
    if (k.attack) this.advanceAttack(k, dt, false);
    if (act.kind === "charge") {
      k.charge = (now - act.started) / 1000;
      this.overlay(k, CHARGE_ANIMS[weapon?.kind ?? "Other"], true);
      this.updateChargeFx(now - act.started > rules.chargeTime);
    }
    k.shielding = act.kind === "defend";
    this.setShieldEffect(k.shielding || act.kind === "shieldHit");

    // walking: the Dungeoneer's speed (status x capped speed bonus x the activity's factor)
    const factor = c.speedFactor({ chargingSpeed: weapon?.chargingSpeed ?? 1, attackingSpeed: weapon?.attackingSpeed ?? 1 }, k.shield?.defendingSpeed ?? 0)
      * this.statusSpeed(k) * (1 + capValue("SPEED", k.bonuses.speed));
    const whole = (k.attack && !k.attack.overlay) || act.kind === "dodge" || act.kind === "hurtHard" || act.kind === "recover" || act.kind === "shieldHit";
    if (moving && c.allowsMovement() && factor > 0.01) {
      const sp = KNIGHT_SPEED * factor;
      this.move(k, (mx / len) * sp * dt, (my / len) * sp * dt, KNIGHT_MASK);
      if (!whole) this.playMovement(k, Math.atan2(my, mx), sp);
    } else if (!whole && k.hurtTime <= 0 && act.kind !== "attack") this.playIdle(k);

    // upper body: the shield pose while defending
    if (!k.attack && k.charge === null) {
      const o = k.instance.overlay;
      const hit = o?.clip.path === "character/pc/shield_hit.dat" && !k.instance.overlayFinished;
      if (k.shielding && !hit) this.overlay(k, "character/pc/blend_shield.dat", true);
      else if (!k.shielding && k.instance.overlay && k.hurtTime <= 0) k.instance.overlay = null;
    }
  }

  /**
   * The charge's own effects (the knight sprite's charge activity): particle/charging.dat with
   * the charging sound for the weapon's charge time (the 2, 3 or 5 second clip), then, once
   * held past the charge time, particle/charging_ready.dat with the completion chime and the
   * looping ready hum.
   */
  private chargeFx: { full: boolean; effect: Effect | null; stops: (() => void)[]; gen: number } | null = null;
  private chargeGen = 0;
  private updateChargeFx(full: boolean) {
    const k = this.knight, fx = this.chargeFx;
    if (fx && fx.full === full) return;
    this.endChargeFx();
    const gen = ++this.chargeGen;
    const pos: Vec3 = [k.x, k.y, k.z];
    const clip = (file: string, gain: number, looping = false) => argRef(looping ? "Clip/Looping (Gain)" : "Clip/Default (Gain)",
      [["File", file], ["Gain", gain], ["Range", "Medium"]]);
    const stops: (() => void)[] = [];
    if (!full) {
      const secs = Math.trunc(this.knightRules().chargeTime / 1000);
      const len = secs <= 2 ? 2 : secs <= 3 ? 3 : 5;
      if (this.audio) stops.push(this.audio.hold(clip(`sound/effect/weapon/charging_${len}second_mono_01.ogg`, 1), pos));
    } else {
      this.audio?.play(clip("sound/effect/weapon/charge_complete_01.ogg", 0.3), pos);
      if (this.audio) stops.push(this.audio.hold(clip("sound/effect/weapon/charging_idle_01.ogg", 1, true), pos));
    }
    this.chargeFx = { full, effect: null, stops, gen };
    void this.attachEffect({ name: full ? "particle/charging_ready.dat" : "particle/charging.dat" }, k).then(e => {
      if (!e) return;
      if (this.chargeFx?.gen === gen) this.chargeFx.effect = e;
      else e.life = 0;
    });
  }
  private endChargeFx() {
    const fx = this.chargeFx;
    if (!fx) return;
    this.chargeFx = null;
    if (fx.effect) fx.effect.life = 0;
    for (const s of fx.stops) s();
  }

  /** A transient model kept on an actor until its effect's life is set to 0. */
  private async attachEffect(ref: any, follow: Actor): Promise<Effect | null> {
    const model = await this.loader.loadRef(ref).catch(() => null);
    if (!model) return null;
    const e: Effect = { instance: await this.instantiate(model), matrix: follow.matrix(), life: 1e9, follow };
    this.effects.push(e);
    return e;
  }

  /** How far the knight's charge is (0 to 1 at the charge time, more when held past it), or null when not charging. */
  chargeProgress(): number | null {
    const a = this.knight?.control.activity;
    if (!a || a.kind !== "charge") return null;
    return (this.clock * 1000 - a.started) / Math.max(1, this.knightRules().chargeTime);
  }

  /** Stops whatever the knight was playing for its activity (an attack, a charge, the shield). */
  private endKnightActivity() {
    const k = this.knight;
    this.endChargeFx();
    if (k.attack) {
      if (k.attack.overlay) k.instance.overlay = null;
      this.weaponAnim(k, "ks_default", true);
    }
    k.attack = null;
    if (k.charge !== null) k.instance.overlay = null;
    k.charge = null;
    if (k.shielding) { k.shielding = false; this.setShieldEffect(false); }
  }

  /** Plays what the controller started this frame, each from the moment it began. */
  private applyControl(events: ControlEvent[], now: number, input?: KnightInput) {
    const k = this.knight;
    for (const e of events) {
      const late = Math.max(0, now - e.at) / 1000;
      if (e.type === "idle") {
        const wasDodge = k.dashing;
        this.endKnightActivity();
        if (wasDodge) {
          // the landing: the end pose, and a moment the monsters cannot touch the knight (ours)
          k.dashing = false;
          k.invulnerable = Math.max(k.invulnerable, DASH.guard);
          this.play(k, "character/pc/dodge/dodge_end.dat", { loop: false, blend: 0.05 });
          k.hurtTime = 0.15;
        }
      } else if (e.type === "attack") {
        const def = this.slotDef(e.slot);
        this.endKnightActivity();
        if (!def) continue;
        if (e.slot === "bash") {
          // the bash costs bashHealthPct of the shield (its cost is server code; the client needs it full)
          k.shieldHealth -= k.shieldMax * (k.shield?.bash?.bashHealthPct ?? 0.5);
          k.sinceShieldHit = 0;
        } else if (e.slot !== "cooldown") {
          // an attack faces its target (`eO`)
          const t = k.target;
          if (t && t.state !== "dying") k.heading = Math.atan2(t.y - k.y, t.x - k.x);
        }
        k.sinceAttack = 0;
        const timing = k.control.activity.timing;
        this.startAttack(k, def, !!timing?.moves);
        if (late > 0 && k.attack) this.advanceAttack(k, late, false);
      } else if (e.type === "charge") {
        this.endKnightActivity();
        k.charge = late;
        this.overlay(k, CHARGE_ANIMS[k.weapon?.kind ?? "Other"], true);
      } else if (e.type === "defend") {
        this.endKnightActivity();
        k.shielding = true;
        this.setShieldEffect(true);
      } else if (e.type === "recover") {
        this.play(k, "character/pc/hurt_recover.dat", { loop: false, blend: 0.05 });
        k.hurtTime = 0.4 - late;
      } else if (e.type === "dodge") {
        // a quick dodge along the movement direction, or the facing (`Se`); the knight keeps
        // facing where it faced
        this.endKnightActivity();
        const [mx0, my0] = input?.move ?? [0, 0];
        const dir = Math.hypot(mx0, my0) > 0.01 ? Math.atan2(my0, mx0) : k.heading;
        k.dashCooldown = DASH.cooldown;
        k.impulse = null;
        this.addImpulse(k, Math.cos(dir) * DASH.distance, Math.sin(dir) * DASH.distance, DASH.time / Math.max(0.05, this.statusSpeed(k)));
        this.play(k, "character/pc/dodge/dodge_fire.dat", { loop: false, blend: 0.04 });
        void this.spawnEffect({ name: "character/pc/dodge/part_dodge_fire.dat" }, k.matrix(), 1, k);
        k.hurtTime = DASH.time;
        k.dashing = true;
      }
    }
  }

  /**
   * The knight's QuadMovement (Character/PC/Default): walking at speed 1 or running at speed
   * 6, whichever is nearer the actual speed, played at speed / that; forward, left, backward or
   * right by the movement direction against the facing, the side ones taking a little more than
   * their quarter (ActorSprite `getMovement`).
   */
  private playMovement(k: Knight, dir: number, speed: number) {
    const m = quadMovement(dir, k.heading, speed);
    this.play(k, `character/pc/${m.set}_${m.side}.dat`, { speed: m.rate });
  }

  /** Weighted idle variations (Character/PC/Default idles): mostly 001, now and then another. */
  private playIdle(k: Knight) {
    const cur = k.instance.clip, path = cur?.path ?? "";
    if (path.endsWith("idle/default/001.dat")) {
      // after a while in the main idle, now and then play a variation (weights 2:1:1:2)
      if (k.instance.time < 7 || Math.random() > 0.01) return;
      const r = Math.random() * 0.75;
      const pick = r < 0.25 ? "002" : r < 0.375 ? "003" : r < 0.5 ? "004" : "005";
      this.play(k, `character/pc/idle/default/${pick}.dat`, { loop: false, blend: 0.2 });
      return;
    }
    if (path.startsWith("character/pc/idle/default/") && !k.instance.finished) return;
    this.play(k, "character/pc/idle/default/001.dat", { loop: true, blend: 0.2 });
  }

  /**
   * Shield health as the client computes it: regeneration starts hitTime ms after the last
   * hit and refills an empty shield in regenTime ms (linearly); a broken shield stays down
   * for breakTime ms, then regenerates from empty.
   */
  private updateShieldHealth(dt: number) {
    const k = this.knight, s = k.shield;
    if (!s) return;
    k.sinceShieldHit += dt;
    if (k.shieldBroken > 0) {
      k.shieldBroken -= dt;
      if (k.shieldBroken <= 0) { k.shieldHealth = 0; k.sinceShieldHit = s.hitTime / 1000; }
      return;
    }
    if (k.sinceShieldHit * 1000 >= s.hitTime) k.shieldHealth = Math.min(k.shieldMax, k.shieldHealth + k.shieldMax * dt * 1000 / s.regenTime);
  }

  private shieldFx: Effect | null = null;
  /** The bubble's "Power" in quarters of the shield's health (the knight sprite's `bio`). */
  private shieldPower = -1;
  /**
   * The shield bubble while defending: the shield's effect with "Power" set to its health in
   * quarters (25, 50, 75, 100), remade when the quarter changes, as the knight sprite does.
   */
  private setShieldEffect(on: boolean) {
    const k = this.knight;
    const level = k.shield ? Math.round(4 * Math.max(0, k.shieldHealth) / Math.max(1, k.shieldMax)) : 4;
    if (on && this.shieldFx && level !== this.shieldPower) { this.shieldFx.life = 0; this.shieldFx = null; }
    if (on && !this.shieldFx && k.shield?.effect && !this.shieldLoading) {
      this.shieldLoading = true;
      this.shieldPower = level;
      const base = k.shield.effect;
      const entries = ((base.arguments?.entries ?? []) as [string, any][]).filter(([n]) => n !== "Power");
      const ref = { ...base, arguments: { $map: "com.threerings.config.ArgumentMap", entries: [...entries, ["Power", String(level * 25)]] } };
      this.loader.loadRef(ref).then(async m => {
        if (m && this.knight.shielding) {
          this.shieldFx = { instance: await this.instantiate(m), matrix: k.matrix(), life: 1e9, follow: k };
          this.effects.push(this.shieldFx);
        }
      }).finally(() => { this.shieldLoading = false; });
    } else if (!on && this.shieldFx) {
      this.shieldFx.life = 0;
      this.shieldFx = null;
    }
  }
  private shieldLoading = false;

  private startAttack(a: Actor, def: AttackDef, overlay = false) {
    // an attack the config marks as not blended (a gun's charged shot, a sword swing) plays on
    // the whole body even for a weapon that otherwise fires on the move
    a.attack = { def, phase: "start", t: 0, ft: 0, fired: new Set(), lunged: false, overlay: overlay && def.blended && !!a.upperBody };
    if (def.start) this.animate(a, def.start, def.startSpeed);
    else this.enterFire(a);
  }

  /** One-shot attack animation: upper body for walking attacks, else whole body. */
  /** The knight's attack rate from attack speed bonuses for the weapon in hand. */
  private attackRate(a: Actor) {
    if (a !== this.knight) return 1;
    const w = this.knight.weapon;
    return 1 + capValue("SPEED", forWeapon(this.knight.bonuses.attackSpeed, w?.kind) + (this.weaponBonus.get(w?.name ?? "")?.attackSpeed ?? 0));
  }

  private animate(a: Actor, path: string | any, speed: number) {
    speed *= this.attackRate(a);
    if (a.attack?.overlay) { this.overlay(a, path, false, speed); return; }
    a.instance.overlay = null;
    this.play(a, path, { loop: false, speed, blend: 0.06 });
  }

  /** Moves an actor along an active lunge (the same easing curve as an impulse). */
  private applyLunge(a: Actor, dt: number, mask: number) {
    const l = a.lunge;
    if (l.t >= l.dur) return;
    const u0 = l.t / l.dur;
    l.t = Math.min(l.dur, l.t + dt);
    const f = impulseShare(u0, l.t / l.dur);
    this.move(a, l.dx * f, l.dy * f, mask);
  }

  private enterFire(a: Actor) {
    const at = a.attack!;
    at.phase = "fire";
    at.t = 0;
    at.ft = 0;
    if (at.def.fire) this.animate(a, at.def.fire, at.def.fireSpeed);
    // the weapon's own model plays its attack (a flintlock's hammer, a diskgun's claws)
    if (a === this.knight) {
      const k = this.knight;
      const charged = at.def === k.weapon?.chargedAttack;
      if (!(charged && this.weaponAnim(k, "ks_charge_attack"))) this.weaponAnim(k, "ks_attack");
    }
    if (at.def.swing) {
      const ref = at.def.swing.$class?.endsWith("SpawnTransient") ? at.def.swing.model : at.def.swing;
      this.spawnEffect(ref, a.matrix(), 0.7, a);
    }
  }

  /**
   * Steps an attacker through the AttackConfig's timing: it lands (fires) `land / startSpeed`
   * after it starts, is rearmed `rearm / fireSpeed` after that, and clears `clear /
   * endSpeed` later, all faster with attack speed. A monster's attack ends there; the
   * knight's ends when its controller says so (`ends` false), which keeps the same times.
   */
  private advanceAttack(a: Actor, dt: number, ends = true) {
    const at = a.attack!;
    dt *= this.attackRate(a);
    at.t += dt;
    at.total = (at.total ?? 0) + dt;
    if (at.phase !== "start") { at.ft += dt; this.runFires(a, at); }
    // the attack's impulse (each sword swing is a lunge; some gun charges kick back) starts
    // `delay` into the attack; a speed-modified one stretches with the status speed
    const imp = at.def.impulse, d = at.def;
    if (imp && !at.lunged && at.total * 1000 >= imp.delay) {
      at.lunged = true;
      const c = Math.cos(a.heading), sn = Math.sin(a.heading);
      const dur = imp.duration / 1000 / (imp.speedModified ? Math.max(0.05, this.statusSpeed(a)) : 1);
      a.lunge = { dx: imp.forward * c - imp.side * sn, dy: imp.forward * sn + imp.side * c, t: 0, dur: Math.max(0.001, dur) };
    }
    if (d.contact && a.lunge.t < a.lunge.dur) this.contactHits(a, at);
    if (at.phase === "start") {
      if (at.t * 1000 >= d.land / d.startSpeed) this.enterFire(a);
    } else if (at.phase === "fire") {
      if (at.t * 1000 >= d.rearm / d.fireSpeed) {
        at.phase = "end";
        at.t = 0;
        if (d.end) this.animate(a, d.end, d.endSpeed);
      }
    } else if (at.phase === "end" && ends && at.t * 1000 >= d.clear / d.endSpeed) {
      a.attack = null;
    }
  }

  /** Fires each of the attack's fire actions whose delay has passed: a hit or a spawn. */
  private runFires(a: Actor, at: NonNullable<Actor["attack"]>) {
    const fires = at.def.fires;
    for (let i = 0; i < fires.length; i++) {
      const f = fires[i];
      if (at.fired.has(i) || at.ft * 1000 < f.delay) continue;
      at.fired.add(i);
      if (f.spawn) void this.spawnProjectile(a, f.spawn);
      else if (f.shape) this.resolveHit(a, f);
      else if (/Merge$/.test(f.name ?? "") && a instanceof Monster && a.mergeWith) this.mergeLichens(a, a.mergeWith);
    }
  }

  /** A shield bash's one-time hit on every enemy the charging knight touches. */
  private contactHits(a: Actor, at: NonNullable<Actor["attack"]>) {
    const c = at.def.contact!;
    at.touched ??= new Set();
    if (a !== this.knight) return;
    for (const m of this.monsters) {
      if (m.state === "dying" || m.state === "spawning" || at.touched.has(m)) continue;
      if (Math.hypot(m.x - a.x, m.y - a.y) > m.radius + a.radius + 0.5) continue;
      at.touched.add(m);
      this.damageMonster(m, this.amounts(c.damage, this.ctx(this.knight.shield?.rarity ?? 0)), c.knockback, a.x, a.y);
    }
  }

  /** The attacker's depth context: weapons use their star rating and level. */
  private attackerCtx(a: Actor): DepthContext {
    if (a !== this.knight) return this.ctx(0);
    const w = this.knight.weapon;
    // the weapon's level (level_table.dat) and variants, on top of gear and buffs
    const own = this.weaponBonus.get(w?.name ?? "");
    const tagged = { ...this.knight.bonuses.tagged };
    for (const [t, v] of Object.entries(own?.tagged ?? {})) tagged[t] = (tagged[t] ?? 0) + v;
    return { ...this.ctx(w?.rarity ?? 0), multiplier: this.buffDamage(this.knight), uncapped: own?.uncapped ?? 0,
      bonus: (own?.damage ?? 0) + forWeapon(this.knight.bonuses.damage, w?.kind), tagged };
  }

  /** Applies an attack's damage shape in front of the attacker. */
  private resolveHit(a: Actor, def: FireDef) {
    const shape = def.shape!;
    const c = Math.cos(a.heading), s = Math.sin(a.heading);
    const hits = (tx: number, ty: number, r: number) => {
      const dx = tx - a.x, dy = ty - a.y;
      const lx = dx * c + dy * s - shape.forward, ly = -dx * s + dy * c - shape.side;
      if (shape.halfWidth > 0) return Math.abs(lx) <= shape.halfLength + r && Math.abs(ly) <= shape.halfWidth + r;
      return Math.hypot(lx, ly) <= shape.radius + r;
    };
    const amounts = this.amounts(def.damage, this.attackerCtx(a));
    if (a.team === "knight") {
      for (const m of this.monsters) {
        if (m.state === "dying" || m.state === "spawning" || m.ally || !hits(m.x, m.y, m.radius)) continue;
        this.damageMonster(m, amounts, def.knockback, a.x, a.y);
      }
      if (a === this.knight) for (const p of [...this.props]) {
        if (p.struck && hits(p.x, p.y, 0.45)) this.damageProp(p, dealt(amounts, null));
        else if (p.strikable && hits(p.x, p.y, 0.6)) this.strikeProp(p);
      }
    } else if (!this.knight.dead && hits(this.knight.x, this.knight.y, this.knight.radius)) {
      this.damageKnight(amounts, def.knockback, a.x, a.y);
    }
  }

  /** A DamageConfig as amounts per type; attacks without one deal a small normal hit. */
  private amounts(damage: any, ctx: DepthContext): Amounts {
    const a: Amounts & { statuses?: any[]; ctx?: DepthContext } = damage ? this.data.depth.damage(damage, ctx) : zeroAmounts();
    if (a.NORMAL + a.PIERCING + a.ELEMENTAL + a.SHADOW + (a.UNBLOCKABLE ?? 0) <= 0) a.NORMAL = 10;
    // an uncapped level bonus scales damage the game's way; buffs multiply
    if (ctx.uncapped) for (const t of DAMAGE_TYPES) a[t] = modifyDamage(a[t], 1 + ctx.uncapped);
    if (ctx.multiplier) for (const t of DAMAGE_TYPES) a[t] *= ctx.multiplier;
    if (ctx.bonus) (a as any).bonus = ctx.bonus;
    const statuses: any[] = [];
    const walk = (d: any, depth = 0) => {
      if (!d || depth > 6) return;
      const k = String(d.$class ?? "").split("$").pop();
      // a "major react" hit (charged attacks, heavy blows) knocks a knight off its feet
      if (d.majorReact) (a as any).major = true;
      if ((k === "Status" || k === "ExclusiveStatus") && d.statusCondition) statuses.push(d.statusCondition);
      else if (k === "Compound") for (const x of d.damages ?? []) walk(x, depth + 1);
    };
    walk(damage);
    if (statuses.length) { a.statuses = statuses; a.ctx = ctx; }
    if (ctx.tagged && Object.keys(ctx.tagged).length) (a as any).tagged = ctx.tagged;
    return a;
  }

  // ---------------------------------------------------------------- status conditions

  /** Rolls and applies a status condition (refreshing one of the same kind). */
  applyStatus(target: Actor, ref: any, ctx: DepthContext, chance?: number) {
    if (target.dead || !this.conditions) return;
    const got = this.conditions.get(ref, ctx);
    if (!got) return;
    // gear resists cut a condition's chance and length on the knight
    const resist = target instanceof Knight ? resistFactor(target.bonuses.resist[STATUS_BITS[got.def.kind] ?? 0] ?? 0) : 1;
    if (Math.random() >= (chance ?? got.chance) * resist) return;
    const def = resist < 1 ? { ...got.def, duration: got.def.duration * resist } : got.def;
    // buffs of different kinds (attack, defence, speed) stack; the same one refreshes
    const same = target.statuses.find(s => s.def.kind === def.kind && (def.kind !== "Buff" || s.def.icon === def.icon));
    // monsters stay frozen longer (monsterDurationMultiplier)
    const duration = def.duration * (target.team === "monster" ? (def.cfg.monsterDurationMultiplier ?? 1) : 1);
    if (same) { same.remaining = Math.max(same.remaining, duration); same.def = def; return; }
    const st: ActiveStatus = { def, remaining: duration, tick: def.interval, fx: null, ice: def.ice, nextSpasm: def.spasmInterval, asleep: 0 };
    target.statuses.push(st);
    const sprite = def.cfg.sprite;
    if (sprite?.applicationTransient) this.spawnEffect(sprite.applicationTransient, target.matrix(), 2, target);
    if (sprite?.model) {
      void this.loader.loadRef(sprite.model).then(async m => {
        if (!m || !target.statuses.includes(st)) return;
        const fx: Effect = { instance: await this.instantiate(m), matrix: target.matrix(), life: 1e9, follow: target };
        st.fx = fx;
        this.effects.push(fx);
      });
    }
    if (def.kind === "Freeze" || def.kind === "Sleep") { target.attack = null; if (target instanceof Knight) target.charge = null; }
  }

  private endStatus(a: Actor, st: ActiveStatus) {
    const i = a.statuses.indexOf(st);
    if (i >= 0) a.statuses.splice(i, 1);
    if (st.fx) st.fx.life = 0;
    const rt = st.def.cfg.sprite?.removalTransient;
    if (rt) this.spawnEffect(rt, a.matrix(), 1.5);
  }

  /**
   * Ticks an actor's conditions. Returns true while the actor cannot act (frozen, asleep, or
   * in a shock spasm).
   */
  private tickStatuses(a: Actor, dt: number): boolean {
    let held = false;
    for (const st of [...a.statuses]) {
      st.remaining -= dt;
      if (st.remaining <= 0 || a.dead) { this.endStatus(a, st); continue; }
      const d = st.def;
      if (d.kind === "Fire" || d.kind === "Curse") {
        st.tick -= dt;
        if (st.tick <= 0) {
          st.tick += d.interval;
          if (d.tickDamage > 0) this.statusDamage(a, d.tickDamage, d.kind === "Fire" ? "#ff8a3d" : "#b07bff");
        }
      } else if (d.kind === "Shock") {
        // a spasm every spasm interval: the victim cannot act, and an arc jumps to the
        // neighbours inside the arc shape (a circle, radius 1 by default, times arcExpand)
        st.nextSpasm = (st.nextSpasm ?? d.spasmInterval) - dt;
        if (st.nextSpasm <= 0) {
          st.nextSpasm += d.spasmInterval;
          st.spasm = d.spasmDuration;
          a.attack = null;
          const reach = (d.cfg.arcShape?.radius ?? 1) * (d.cfg.arcExpand ?? 1) + a.radius;
          const others = a.team === "monster" ? this.monsters.filter(m => m !== a && m.state !== "dying" && Math.hypot(m.x - a.x, m.y - a.y) < reach) : [];
          if (d.tickDamage > 0) for (const o of others) this.statusDamage(o, d.tickDamage, "#9fe8ff");
        }
        if ((st.spasm ?? 0) > 0) { st.spasm! -= dt; held = true; }
      } else if (d.kind === "Sleep") {
        // asleep: regeneration every interval once the delay has passed
        held = true;
        st.asleep = (st.asleep ?? 0) + dt;
        if (st.asleep >= d.regenDelay) {
          st.tick -= dt;
          if (st.tick <= 0) {
            st.tick += d.interval;
            const amount = a instanceof Knight ? d.playerRegen : d.regen;
            if (a instanceof Knight) this.healKnight(amount);
            else if (a instanceof Monster) this.healMonster(a, amount);
          }
        }
      } else if (d.kind === "Freeze") held = true;
    }
    return held;
  }

  /** Damage from a condition: no knockback, no flinch. */
  private statusDamage(a: Actor, amount: number, color: string) {
    const dmg = Math.max(1, Math.round(amount));
    if (a instanceof Knight) {
      if (a.dead) return;
      const before = a.health;
      a.health = Math.max(0, a.health - dmg);
      a.recentDamage += before - a.health;
      a.sinceDamage = 0;
      if (a.health <= 0) this.knockOut();
    } else if (a instanceof Monster) {
      a.health -= dmg;
      if (a.health <= 0 && a.state !== "dying") { this.damageMonster(a, { NORMAL: 1, PIERCING: 0, ELEMENTAL: 0, SHADOW: 0 }, 0, a.x, a.y); return; }
    }
    this.floaters.push({ x: a.x, y: a.y, z: a.z + 1.3, text: String(dmg), color, age: 0 });
  }

  /** Movement factor from conditions (stun and slow, speed buffs). */
  private statusSpeed(a: Actor): number {
    let f = 1;
    for (const st of a.statuses) f *= st.def.speed;
    return f;
  }

  /** Damage factor from buffs (Damage Modifier and Relative Damage Modifier) and poison. */
  private buffDamage(a: Actor): number {
    let f = 1;
    for (const st of a.statuses) {
      if (st.def.kind === "Buff") f *= 1 + (st.def.cfg.damageModifier ?? 0) + (st.def.cfg.relativeDamageModifier ?? 0);
      f *= st.def.attack;
    }
    return f;
  }

  /** Defence after poison's and shock's reductions and defence buffs. */
  private effectiveDefense(a: Actor): Amounts | null {
    let f = 1;
    for (const st of a.statuses) f *= st.def.defense;
    if (f === 1 || !a.defense) return a.defense;
    const out = { ...a.defense };
    for (const t of DAMAGE_TYPES) out[t] *= f;
    return out;
  }

  /** Conditions react to a hit: sleepers wake, a hit wears down a frozen victim's ice. */
  private hitStatuses(a: Actor, amounts: Amounts, dmg = 0) {
    for (const st of [...a.statuses]) {
      if (st.def.kind === "Sleep") this.endStatus(a, st);
      else if (st.def.kind === "Freeze") {
        st.ice = (st.ice ?? st.def.ice) - dmg;
        if (st.ice <= 0) this.endStatus(a, st);
      }
    }
    const s = (amounts as any).statuses as any[] | undefined;
    if (s) for (const ref of s) this.applyStatus(a, ref, (amounts as any).ctx ?? this.ctx(0));
  }

  // ---------------------------------------------------------------- projectiles

  /** Spawns an attack's bullet or bomb in front of the attacker. */
  private async spawnProjectile(a: Actor, spawn: NonNullable<FireDef["spawn"]>) {
    const loaded = await this.projectileDef(spawn.actor);
    if (!loaded) return;
    const p = loaded.def;
    const heading = a.heading + spawn.rotation + (Math.random() * 2 - 1) * spawn.variance;
    const c = Math.cos(a.heading), s = Math.sin(a.heading);
    let x = a.x + p.offset[0] * c - p.offset[1] * s, y = a.y + p.offset[0] * s + p.offset[1] * c;
    // bombs drop at the knight's feet; a bullet starting inside a wall fizzles at once
    if (p.kind === "Bomb") { x = a.x + c * 0.4; y = a.y + s * 0.4; }
    const instance = loaded.model ? await this.instantiate(loaded.model) : null;
    const z = this.collision.groundZ(x, y) + p.height;
    const proj = new Projectile(p, instance, a.team, x, y, z, heading, this.attackerCtx(a));
    if (a instanceof Monster) proj.owner = a;
    this.projectiles.push(proj);
    if (loaded.model) this.startScripts(loaded.model, proj.matrix(), p.fuse / 1000);
    // point blank: a target between the attacker and the muzzle is hit at once
    if (p.kind === "Bullet") {
      for (let i = 1; i <= 4 && !proj.done; i++) {
        proj.x = a.x + (x - a.x) * i / 4; proj.y = a.y + (y - a.y) * i / 4;
        if (this.projectileTarget(proj)) this.detonate(proj, true);
      }
      if (!proj.done) { proj.x = x; proj.y = y; }
    }
  }

  /** A bullet or bomb a logic action spawns at a point (monster bullets, traps). */
  private async spawnProjectileAt(ref: any, x: number, y: number, heading: number, team: Team, ctx: DepthContext) {
    const loaded = await this.projectileDef(ref);
    if (!loaded) return;
    const instance = loaded.model ? await this.instantiate(loaded.model) : null;
    const z = this.collision.groundZ(x, y) + loaded.def.height;
    const proj = new Projectile(loaded.def, instance, team, x, y, z, heading, ctx);
    this.projectiles.push(proj);
    if (loaded.model) this.startScripts(loaded.model, proj.matrix(), loaded.def.fuse / 1000);
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      if (p.done) continue;
      p.age += dt;
      p.instance?.advance(dt);
      const d = p.def;
      if (d.kind === "Bullet") {
        const steps = Math.max(1, Math.ceil((d.speed * dt) / Math.max(0.1, d.radius)));
        for (let i = 0; i < steps && !p.done; i++) {
          p.x += (Math.cos(p.heading) * d.speed * dt) / steps;
          p.y += (Math.sin(p.heading) * d.speed * dt) / steps;
          const hit = this.projectileTarget(p);
          if (hit) this.detonate(p, true);
          else if (p.team === "monster" && this.boss?.bullet?.(p.x, p.y, p.heading, p.owner)) this.detonate(p, true);
          // walls only (tile flag 1 and 128 in the bullet's mask); pits (flag 2) are flown over
          else if (this.collision.collides(p.x, p.y, d.radius * 0.5, (d.collisionMask & 0x81) || 1, false)) this.detonate(p, true);
        }
        if (!p.done && p.age * 1000 >= d.fuse) {
          p.done = true;
          if (d.fizzleFx) this.spawnEffect(d.fizzleFx, compose([p.x, p.y, p.z], [0, 0, 0, 1], 1), 1);
        }
      } else if (p.age * 1000 >= d.fuse) this.detonate(p, false);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (this.projectiles[i].done) this.projectiles.splice(i, 1);
  }

  /** Whether a bullet touches something it can hit. */
  private projectileTarget(p: Projectile): boolean {
    const r = p.def.radius;

    const k = this.knight;
    if (p.team === "knight" || p.team === "hazard") {
      if (this.monsters.some(m => m.state !== "dying" && m.state !== "spawning" && !m.passive && !m.ally && Math.hypot(m.x - p.x, m.y - p.y) < m.radius + r)) return true;
      if (p.team === "hazard" && p.age > 0.05 && !k.dead && Math.hypot(k.x - p.x, k.y - p.y) < k.radius + r) return true;
      return this.props.some(b => b.struck && Math.hypot(b.x - p.x, b.y - p.y) < 0.5 + r);
    }
    return !k.dead && Math.hypot(k.x - p.x, k.y - p.y) < k.radius + r;
  }

  /** A bullet hits or a bomb goes off: damage everything of the other team in its region. */
  private detonate(p: Projectile, bullet: boolean) {
    p.done = true;
    const d = p.def, r = d.regionRadius;
    if (d.actions.length) {
      const at = new Entity(false, d.name);
      at.x = p.x; at.y = p.y; at.rotation = p.heading;
      at.fixedShape = { k: "circle", x: p.x, y: p.y, r };
      // the logic's damage actions strike monsters, so a monster's bomb leaves them out (its
      // region below is what hurts the knight)
      for (const act of d.actions) {
        if (p.team !== "knight" && /\$Damage[A-Za-z]*$/.test(String(act.$class))) continue;
        this.logic.execute(act, at, p.team === "knight" ? this.knightEntity : at);
      }
    }
    if (d.harmless) {
      if (d.hitFx) this.spawnEffect(d.hitFx, compose([p.x, p.y, this.collision.groundZ(p.x, p.y)], [0, 0, 0, 1], 1), 2);
      return;
    }
    const amounts = this.amounts(d.damage, p.ctx);
    if (d.hitFx) this.spawnEffect(d.hitFx, compose([p.x, p.y, bullet ? p.z : this.collision.groundZ(p.x, p.y)], [0, 0, Math.sin(p.heading / 2), Math.cos(p.heading / 2)], 1), 2);
    if (p.team === "knight" || p.team === "hazard") {
      for (const m of this.monsters) {
        if (m.state === "dying" || m.state === "spawning" || Math.hypot(m.x - p.x, m.y - p.y) > r + m.radius) continue;
        this.damageMonster(m, amounts, d.knockback, p.x - Math.cos(p.heading) * 0.01, p.y - Math.sin(p.heading) * 0.01);
      }
      for (const b of [...this.props]) {
        if (b.struck && Math.hypot(b.x - p.x, b.y - p.y) <= r + 0.5) this.damageProp(b, dealt(amounts, null), p.team === "hazard" ? 1 : 2);
        else if (b.strikable && Math.hypot(b.x - p.x, b.y - p.y) <= r + 0.6) this.strikeProp(b);
      }
      const k = this.knight;
      if (p.team === "hazard" && !k.dead && Math.hypot(k.x - p.x, k.y - p.y) <= r + k.radius) this.damageKnight(amounts, d.knockback, p.x, p.y);
    } else {
      const k = this.knight;
      if (!k.dead && Math.hypot(k.x - p.x, k.y - p.y) <= r + k.radius) this.damageKnight(amounts, d.knockback, p.x, p.y);
    }
  }

  // ---------------------------------------------------------------- damage

  /**
   * Knocks an actor away from a point by a damage impulse (its distance, duration and level).
   * An impulse below the target's impulse level does not move it (heavy monsters and turrets
   * have high levels). A bare number is a distance over 250 ms.
   */
  private knock(target: Actor, fx: number, fy: number, k: Knock, scale = 1) {
    const kn = typeof k === "number" ? { distance: k, duration: 250, level: 1 } : k;
    if (!kn || kn.distance * scale <= 0) return;
    if (kn.level < (target instanceof Monster ? target.def.impulseLevel ?? 1 : 1)) return;
    const d = Math.hypot(target.x - fx, target.y - fy) || 1;
    const dist = kn.distance * scale;
    this.addImpulse(target, ((target.x - fx) / d) * dist, ((target.y - fy) / d) * dist, kn.duration / 1000);
  }

  private clock = 0;
  private hudKeys = 0;

  /**
   * The target panel's monster: the knight's current target (the knight sprite's PO(): the
   * auto-target picked in the wedge ahead), none while the knight is down or has something
   * to act on.
   */
  hudTarget(): import("../ui/hud").HudTarget | null {
    const k = this.knight, m = k?.target;
    if (!m || k.dead || this.actionTarget()) return null;
    const name = monsterName(m.def, (m.entity?.name ?? "").split("/").pop()!.replace(/\s+\d+(\.\d+)?$/, ""));
    const fam = /\/Monster\/(Beast|Construct|Fiend|Gremlin|Slime|Undead)\//.exec(m.entity?.name ?? "")?.[1]?.toLowerCase() ?? "";
    const key = ((m as any).hudKey ??= ++this.hudKeys);
    return { key: key + name, name, health: m.health, maxHealth: m.maxHealth, family: fam, model: m.def.model, idle: m.def.idle ?? null,
      icon: m.def.descIcon ?? null, weakness: m.def.weakness ?? "NORMAL", attack: m.def.attackType ?? "NORMAL" };
  }

  /** Descriptions of things the knight can act on, by actor name (loaded once; null for none). */
  private actionDescs = new Map<string, import("../ui/hud").HudDescription | null>();

  /**
   * What the knight can act on now (the server's Knight action description and description):
   * the thing the action key would use, its helptips hint (ActionDesc.LD) and its
   * DescriptionConfig for the target panel. Null while carrying something or with nothing near.
   */
  actionTarget(): { hint: string; desc: import("../ui/hud").HudDescription | null } | null {
    const k = this.knight;
    if (!k || k.dead) return null;
    const carried = this.props.find(p => p.carried);
    const fx = k.x + Math.cos(k.heading) * 0.7, fy = k.y + Math.sin(k.heading) * 0.7;
    const near = this.props.filter(p => p !== carried && Math.hypot(p.x - fx, p.y - fy) < 1.6)
      .sort((a, b) => Math.hypot(a.x - k.x, a.y - k.y) - Math.hypot(b.x - k.x, b.y - k.y));
    const door = near.find(p => p.kind === "door" && !p.open);
    const target = (p: Prop | Monster, cfg: any, fallback: string) =>
      ({ hint: actionHint(cfg?.actionDesc, fallback), desc: this.describe(p.entity?.name ?? "", cfg) });
    if (door && /\$Energy$/.test(door.cfg.actionDesc?.$class ?? "") && !carried) return target(door, door.cfg, "m.energy");
    if (door && carried?.cfg.actionableSignal && carried.cfg.actionableSignal === door.cfg.actionableSignal) return target(door, door.cfg, "m.unlock");
    if (carried) return null;
    if (this.props.some(p => p.kind === "lift" && Math.hypot(p.x - k.x, p.y - k.y) < 1.2)) return { hint: "m.lift", desc: null };
    const prop = near.find(p => p.entity.handlers.some(h => h.kind === "Interaction"));
    if (prop) return target(prop, prop.cfg, "m.interact");
    const npc = this.monsters.filter(m => m.passive && m.entity?.handlers.some(h => h.kind === "Interaction") && Math.hypot(m.x - fx, m.y - fy) < 1.8)
      .sort((a, b) => Math.hypot(a.x - k.x, a.y - k.y) - Math.hypot(b.x - k.x, b.y - k.y))[0];
    if (npc?.entity) return target(npc, this.data.resolveSync("config/actor.dat", { name: npc.entity.name }, "actor"), "m.talk");
    return null;
  }

  /** The knight stands on the exit elevator, waiting for it to go (the party status the client shows m.elevator for). */
  get onElevator(): boolean { return this.props.some(p => p.kind === "elevator" && p.standTime > 0) && !this.finished; }

  /** A thing's DescriptionConfig for the target panel, loaded in the background on first ask. */
  private describe(name: string, cfg: any): import("../ui/hud").HudDescription | null {
    if (!name) return null;
    if (!this.actionDescs.has(name)) {
      this.actionDescs.set(name, null);
      const ref = cfg?.description ?? cfg?.sprite?.description ?? null;
      void ((ref ? this.data.description(ref) : this.data.actorDescription(name)) as Promise<any>)
        .then(d => {
          if (!d || !d.dname) return;
          const tr = (key: string) => key ? (key.startsWith("~") ? key.slice(1) : message(d.bundle, key) || key) : "";
          this.actionDescs.set(name, { key: name, name: tr(d.dname), title: tr(d.title), info: tr(d.description), icon: d.icon });
        }).catch(() => undefined);
    }
    return this.actionDescs.get(name) ?? null;
  }

  private damageMonster(m: Monster, amounts: Amounts, knockback: Knock, fx: number, fy: number) {
    // allies are immortal companions here (the game's rest and recover when worn down)
    if (m.passive || m.ally) return;
    // the summed damage bonus: the attacker's pool plus its tag bonuses for this monster's
    // tags (its family, fam_slime, from its folder when the config gives none); capped in dealt
    const fam = /\/Monster\/(Beast|Construct|Fiend|Gremlin|Slime|Undead)\//.exec(m.entity?.name ?? "")?.[1]?.toLowerCase();
    const tags = new Set([...(m.entity?.tags ?? []), ...(fam ? [`fam_${fam}`] : [])]);
    const tagged: Record<string, number> = (amounts as any).tagged ?? {};
    let bonus = (amounts as any).bonus ?? 0;
    for (const t of tags) bonus += tagged[t] ?? 0;
    let dmg = Math.max(1, Math.round(dealt(amounts, this.effectiveDefense(m), bonus)));
    if (this.boss?.damage) {
      dmg = Math.round(this.boss.damage(m, dmg));
      if (dmg <= 0) {
        // shrugged off: a grey tick and barely a nudge
        this.floaters.push({ x: m.x, y: m.y, z: m.z + 1.2, text: "0", color: "#9aa0a6", age: 0 });
        this.knock(m, fx, fy, knockback, 0.2);
        return;
      }
    }
    this.hitStatuses(m, amounts, dmg);
    // a big enough hit interrupts the monster (minReactPercent of its health)
    if (dmg >= m.maxHealth * m.def.minReactPercent && m.state !== "spawning" && m.health > dmg) {
      m.attack = null;
      m.reacting = m.def.reactTime / 1000;
      if (m.def.react) this.play(m, m.def.react, { loop: false, blend: 0.05 });
    }
    m.health -= dmg;
    // the client's hit feedback: the hit particle for how the hit performed (with its camera
    // shake), the damage number in that style, and a red flash
    const perf = performanceOf(dmg, Math.max(1, Math.round(dealt(amounts, null, bonus))), m.maxHealth);
    this.numberAt(m, "-" + dmg, numberStyle(perf), TYPE_COLORS[mainType(amounts)]);
    m.flashAt = this.clock;
    void this.spawnEffect(argRef("particle/fx_gethit_monster-scaled.dat", [["variant", performanceVariant(perf)]]), compose([m.x, m.y, m.z], [0, 0, 0, 1], 1), 1);
    this.knock(m, fx, fy, knockback);
    if (m.def.hitFx) this.spawnEffect(m.def.hitFx, compose([m.x, m.y, m.z + 0.5], [0, 0, 0, 1], 1), 0.8);
    if (m.health <= 0) {
      this.startDying(m);
      this.killCount++;
      if (m.entity) this.logic.destroy(m.entity, this.knightEntity);
      for (const st of [...m.statuses]) this.endStatus(m, st);
      if (m.def.deathFx) this.spawnEffect(m.def.deathFx, compose([m.x, m.y, m.z], [0, 0, 0, 1], m.scale), 2);
    } else if (m.state === "idle") {
      m.state = "chase";
    }
  }

  /** A monster's death: its model's dying animation, held for the config's death time. */
  private startDying(m: Monster) {
    m.state = "dying";
    m.stateTime = 0;
    m.attack = null;
    m.reacting = 0;
    if (m.def.dying) this.play(m, m.def.dying, { loop: false, blend: 0.05 });
  }

  /** Seconds a dead monster stays: its dying animation's time, or a short shrink. */
  private deathLength(m: Monster) {
    return m.def.dying ? Math.max(0.5, Math.min(4, m.def.deathTime / 1000)) : 0.6;
  }

  private damageKnight(amounts: Amounts, knockback: Knock, fx: number, fy: number) {
    const k = this.knight;
    if (k.invulnerable > 0 || k.dead) return;
    const now = this.clock * 1000, c = k.control;
    // a raised shield (or one recoiling from a hit) takes hits from every direction until it breaks
    if ((k.shielding || c.activity.kind === "shieldHit") && k.shieldBroken <= 0 && k.shield) {
      const sdmg = Math.max(1, Math.round(dealt(amounts, k.shieldDefense)));
      k.shieldHealth -= sdmg;
      k.sinceShieldHit = 0;
      this.knock(k, fx, fy, knockback, 0.3);
      k.invulnerable = 0.25;
      // the shield's recoil (activity 277: 411 ms, no walking), then back up if still held
      this.endKnightActivity();
      c.hurt("shieldHit", now);
      this.overlay(k, "character/pc/shield_hit.dat");
      if (k.shieldHealth > 0) return;
      k.shieldHealth = 0;
      k.shieldBroken = k.shield.breakTime / 1000;
      if (k.shield.breakEffect) this.spawnEffect(k.shield.breakEffect, k.matrix(), 1.5);
      return;
    }
    let dmg = Math.max(1, Math.round(dealt(amounts, this.effectiveDefense(k))));
    // a sprite shield (the Seraphynx's Angelic Aura) takes the hit first
    if (this.companion) { dmg = Math.round(this.companion.absorb(dmg)); if (dmg <= 0) { k.invulnerable = 0.25; return; } }
    this.hitStatuses(k, amounts, dmg);
    const before = k.health;
    k.health = Math.max(0, k.health - dmg);
    k.recentDamage += before - k.health;
    k.sinceDamage = 0;
    k.invulnerable = 0.5;
    this.knightHitFeedback(amounts, dmg);
    this.knock(k, fx, fy, knockback);
    if (k.health <= 0) {
      this.knockOut();
      return;
    }
    // the hit reactions the client plays (the server picks them): a heavy hit knocks the
    // knight down (275, no walking) and it gets up (276, 400 ms); any other hit is a flinch
    // (274, 500 ms) that walks but cannot attack, shield or dodge. Either breaks off an
    // attack or a charge.
    this.endKnightActivity();
    k.dashing = false;
    const hard = (amounts as any).major ? this.clip("character/pc/hurt_hard.dat") : null;
    if (hard) {
      k.instance.overlay = null;
      this.play(k, "character/pc/hurt_hard.dat", { loop: false, blend: 0.05 });
      const len = hard.frames.length > 1 ? (hard.frames.length - 1) / hard.rate : 0.5;
      k.hurtTime = len;
      c.hurt("hurtHard", now, len * 1000);
    } else {
      k.hurtTime = 0.5;
      this.overlay(k, "character/pc/hurt_soft.dat");
      c.hurt("hurt", now);
    }
  }

  /**
   * The knight's side of a hit (the knight sprite): its hit transient (fx_gethit_player, red),
   * a red flash, and hearts bursting out per damage type in that type's colour
   * (fx_damagenumber-pc.dat) instead of a number.
   */
  private knightHitFeedback(amounts: Amounts, dmg: number) {
    const k = this.knight;
    k.flashAt = this.clock;
    void this.spawnEffect(argRef("particle/fx_gethit_player.dat", [["Color", "Red"]]), k.matrix(), 1.2, k);
    let raw = 0;
    for (const t of DAMAGE_TYPES) raw += Math.max(0, amounts[t]);
    raw += Math.max(0, amounts.UNBLOCKABLE ?? 0);
    if (raw <= 0) return;
    for (const t of [...DAMAGE_TYPES, "UNBLOCKABLE"] as const) {
      const a = Math.max(0, (amounts as any)[t] ?? 0);
      if (a <= 0) continue;
      void this.spawnEffect(argRef("particle/fx_damagenumber-pc.dat", [["number", heartCount(dmg * a / raw)], ["type", HEART_TYPES[t] ?? "Normal"]]),
        k.matrix(), 1.5, k);
    }
  }

  private knockOut() {
    const k = this.knight;
    if (k.dead) return;
    k.dead = true;
    k.attack = null;
    k.charge = null;
    this.defeated = true;
    for (const st of [...k.statuses]) this.endStatus(k, st);
    // the fall (death.dat ends lying down, and holds there)
    this.play(k, this.clip("character/pc/death.dat") ? "character/pc/death.dat" : "character/pc/dead.dat", { loop: false, blend: 0.1 });
  }

  revive() {
    const k = this.knight;
    k.dead = false;
    this.defeated = false;
    k.health = k.maxHealth;
    k.invulnerable = 2;
    this.play(k, "character/pc/idle.dat");
  }

  // ---------------------------------------------------------------- for boss directors

  /** Makes a monster start one of its attacks now (facing as it is). */
  monsterAttack(m: Monster, def: AttackDef) {
    if (m.state === "dying") return;
    m.state = "attack";
    this.startAttack(m, def);
  }

  /** Plays an animation on a monster (a reference or path). */
  playOn(m: Monster, anim: any, loop = false, speed = 1) {
    void this.preload(anim).then(() => { if (m.state !== "dying") this.play(m, anim, { loop, speed, blend: 0.1 }); });
  }

  /** Swaps a monster's model (a sprite flag model: shielded, wet, exposed). */
  async setModel(m: Monster, ref: any) {
    const model = await this.loader.loadRef(ref).catch(() => null);
    if (!model || m.state === "dying") return;
    const inst = await this.renderer.instantiate(model);
    if ((m.state as string) === "dying") return;
    m.instance = inst;
    this.play(m, m.def.idle, { loop: true });
  }

  /** Heals a monster (absorbed minions), with the heal floater. */
  healMonster(m: Monster, amount: number) {
    if (m.state === "dying" || amount <= 0) return;
    for (const s of m.statuses) amount *= s.def.heal;
    const before = m.health;
    m.health = Math.min(m.maxHealth, m.health + amount);
    if (m.health > before) this.numberAt(m, `+${Math.round(m.health - before)}`, "Heal", "#7bd88f");
  }

  /** Deals a DamageConfig to the knight from a point (beams and hazards a director runs). */
  hurtKnight(damage: any, fromX: number, fromY: number, knockback: Knock = 0.5) {
    this.damageKnight(this.amounts(damage, this.ctx(0)), knockback, fromX, fromY);
  }

  /** Depth-scaled value of a table (health, heal) at this floor's depth. */
  depthValue(ref: any): number { return this.data.depth.evaluate(ref, this.ctx(0)); }

  /** A transient model at a point (a ConfigReference or path). */
  effectAt(ref: any, x: number, y: number, life = 2, scale = 1) {
    void this.spawnEffect(typeof ref === "string" ? { name: ref } : ref, compose([x, y, this.collision.groundZ(x, y)], [0, 0, 0, 1], scale), life);
  }

  /** A line of text over a point. */
  say(x: number, y: number, text: string, color = "#ffd84d") {
    this.floaters.push({ x, y, z: this.collision.groundZ(x, y) + 2.5, text, color, age: 0 });
  }

  /** Spawns a spawn table's results (loot, minions) at a point, through the logic. */
  tableSpawn(table: any, x: number, y: number) {
    const at = new Entity(false, "loot");
    at.x = x; at.y = y;
    this.gameAction({ $class: "projectx.dungeon.config.DungeonActionConfig$TableSpawn", spawnTable: table }, at, this.knightEntity, this.logic);
  }

  /** World seconds so far. */
  get time() { return this.clock; }

  // ---------------------------------------------------------------- monsters

  /** Spawns a monster from a spawn table (or an actor reference) at a point, through the logic. */
  spawnAt(table: any, x: number, y: number, heading = 0) {
    const ref = table?.name?.startsWith("Character/") ? table : this.data.spawnActorSync(table, this.tier());
    if (ref) this.logic.spawn(ref, x, y, heading, this.knightEntity, this.knightEntity);
  }

  /** Townsfolk among the monsters: their actor config, wander state and the idle playing. */
  private readonly npcs = new Map<Monster, { cfg: any; wander: Wander | null; blocked: boolean; idle: any }>();

  /** A townsperson's tick: wandering with its movement animation, else its weighted idles. */
  private updateNpc(m: Monster, dt: number): boolean {
    const n = this.npcs.get(m);
    if (!n) return false;
    m.state = "idle";
    const sprite = n.cfg.sprite, speed = n.cfg.speed ?? 0;
    if (n.wander) {
      const s = stepWander(n.wander, m.x, m.y, dt, n.blocked);
      if (s.walk) {
        m.turnToward(s.dir, n.cfg.turnRate ?? 6, dt);
        const ox = m.x, oy = m.y;
        this.move(m, Math.cos(m.heading) * speed * dt, Math.sin(m.heading) * speed * dt, MONSTER_MASK);
        n.blocked = Math.hypot(m.x - ox, m.y - oy) < speed * dt * 0.3;
        const mv = pickMovement(sprite.movements ?? [], speed, sprite.scale ?? 1);
        if (mv) this.play(m, mv.animation, { speed: mv.rate, blend: 0.2 });
        n.idle = null;
        return true;
      }
    }
    if (!n.idle || m.instance.finished) {
      const i = pickWeighted(sprite.idles);
      const anim = i === null ? null : sprite.idles[i].animation;
      const clip = this.clip(anim);
      if (clip) { m.instance.play(clip, { loop: clip.loop, blend: 0.2 }); n.idle = anim; }
      else if (anim) void this.preload(anim);
    }
    return true;
  }

  /** Loads a monster's definition and model for a logic actor that has been spawned. */
  private async spawnMonster(ref: any, e: Entity) {
    const def = await this.data.monster(ref);
    if (!def || e.destroyed) return;
    const model = await this.loader.loadRef(def.model);
    if (!model || e.destroyed) return;
    // hit reactions and deaths are the model's own "reacting" and "dying" animations
    const anims = model.animations;
    def.react = anims.reacting ?? anims.reacting_knockback ?? anims.Reacting;
    def.dying = anims.dying ?? anims.Dying ?? anims.death;
    await Promise.all([this.preload(def.idle, def.move, def.activation, def.react, def.dying), this.preloadAttacks(def.attacks)]);
    if (e.destroyed) return;
    // DungeonActorConfig Monster: the depth-scaled health table when it has one (its flat
    // health is then ignored), else the flat health; times the difficulty's monster health
    // scale (DungeonCodes Difficulty: easy 0.8, hard 1.25)
    const ctx = this.ctx(0);
    const base = def.healthScale ? this.data.depth.evaluate(def.healthScale, ctx) : def.health;
    const scale = this.difficulty === "easy" ? 0.8 : this.difficulty === "hard" ? 1.25 : 1;
    const m = new Monster(await this.instantiate(model, false), def, Math.max(1, Math.round((base || 100) * scale)));
    m.defense = def.defense ? this.data.depth.defense(def.defense, ctx) : null;
    // the spawn point may sit in a wall or pit; move to the nearest free spot
    // (a prisoner stays in its cage)
    const spot = !isCaptive(e.name) && this.collision.collides(e.x, e.y, def.radius, MONSTER_MASK) ? this.collision.findSpawn(e.x, e.y, def.radius, MONSTER_MASK) : null;
    m.x = m.homeX = spot?.[0] ?? e.x; m.y = m.homeY = spot?.[1] ?? e.y;
    m.z = this.collision.groundZ(m.x, m.y);
    m.heading = e.rotation;
    m.entity = e;
    m.ally = isAlly(e.name);
    m.captive = m.ally && isCaptive(e.name);
    if (def.creationFx) this.spawnEffect(def.creationFx, m.matrix(), 2);
    e.game = m;
    m.size = lichenSize(ref);
    // townsfolk (traders, wandering gremlins) idle and wander as src/game/townsfolk.ts says
    if (m.passive && !m.captive) {
      const cfg = this.data.resolveSync("config/actor.dat", ref, "actor");
      if (cfg?.sprite?.idles?.length) this.npcs.set(m, { cfg, wander: wanders(e.name, cfg.speed ?? 0) ? startWander(m.x, m.y) : null, blocked: false, idle: null });
    }
    this.play(m, def.activation ?? def.idle, { loop: !def.activation });
    this.monsters.push(m);
  }

  /** Bullet ranges (speed times fuse), filled in as projectile definitions load. */
  private ranges = new Map<any, number>();

  /** How far an attack reaches: its hit shape, or for a projectile its travel distance. */
  private reach(a: AttackDef): number {
    if (a.shape) return a.shape.forward + Math.max(a.shape.halfLength, a.shape.radius) * 0.8;
    const known = this.ranges.get(a);
    if (known !== undefined) return known;
    this.ranges.set(a, 6);
    if (a.spawn) void this.projectileDef(a.spawn.actor).then(l => {
      if (l) this.ranges.set(a, l.def.kind === "Bomb" ? Math.max(1.5, l.def.regionRadius) : Math.max(2, (l.def.speed * l.def.fuse) / 1000 * 0.85));
    });
    return 6;
  }

  /**
   * Monster AI. The game's own AI lives in closed code and configs this port does not read,
   * so this one follows the data: a monster with no speed is a turret that turns at its
   * turn rate and fires once it faces the knight; one whose attacks are all ranged keeps
   * its distance and fires; anything else closes in and uses whichever attack reaches.
   */
  private updateMonster(m: Monster, dt: number) {
    m.instance.advance(dt);
    m.stateTime += dt;
    m.cooldown -= dt;
    if (m.state === "dying") return;
    this.applyKnockback(m, dt, MONSTER_MASK);
    this.applyLunge(m, dt, MONSTER_MASK);
    if (this.tickStatuses(m, dt)) return;
    if (m.reacting > 0) { m.reacting -= dt; return; }
    if (m.passive && m.state !== "spawning" && this.updateNpc(m, dt)) return;
    if (m.passive) { if (m.state !== "spawning") this.play(m, m.def.idle); m.state = m.state === "spawning" && m.stateTime < 1.2 ? m.state : "idle"; return; }
    if (m.scripted) {
      if (m.state === "spawning" && (m.instance.finished || m.stateTime > 1.2)) m.state = "idle";
      if (m.attack) { this.advanceAttack(m, dt); if (!m.attack) { m.state = "idle"; this.play(m, m.def.idle); } }
      return;
    }
    // allies fight the nearest monster, else follow the knight
    const k: Actor = m.ally ? (this.allyTarget(m) ?? this.knight) : this.knight;
    const follow = m.ally && k === this.knight;
    const dx = k.x - m.x, dy = k.y - m.y, dist = Math.hypot(dx, dy) || 1e-3;
    // turnRate is radians per second (a jelly's 174.5 is 10,000 degrees: instant)
    const turn = m.def.turnRate;

    if (m.state === "spawning") {
      if (m.instance.finished || m.stateTime > 1.2) { m.state = "idle"; this.play(m, m.def.idle); }
      return;
    }
    if (m.attack) {
      // slow turners keep tracking the knight while winding up
      if (m.attack.phase === "start" && turn < 6) m.turnToward(Math.atan2(dy, dx), turn, dt);
      const was = m.attack.def;
      this.advanceAttack(m, dt);
      if (!m.attack) {
        m.state = "chase";
        // a Chain attack leads straight into another of the monster's attacks
        const next = was.chainTo !== null ? m.def.attacks[was.chainTo] : null;
        if (next && next !== was) { m.state = "attack"; this.startAttack(m, next); }
        else if (was.chainTo !== null && next === was) m.cooldown = Math.max(m.cooldown, 0.5);
      }
      return;
    }
    // a cloaked knight (the Maskeraith's Shadow Cloak) is lost to the monsters
    if (!m.ally && (k.dead || this.companion?.hidesKnight())) { m.state = "idle"; this.play(m, m.def.idle); return; }
    if (m.size && this.lichenMerge(m)) return;

    if (m.state === "idle") {
      if (dist < AGGRO_RANGE) m.state = "chase";
      else { this.play(m, m.def.idle); return; }
    }
    if (dist > LEASH_RANGE && !m.ally) { m.state = "idle"; return; }

    const want = Math.atan2(dy, dx);
    m.turnToward(want, turn, dt);
    const facing = Math.abs(Math.atan2(Math.sin(want - m.heading), Math.cos(want - m.heading)));
    const gap = dist - k.radius - m.radius;
    // attacks on the knight (a boss director may choose them; a lichen's merge is for its own
    // kind; a chain's later links follow the first)
    const pool = this.boss?.attacks?.(m) ?? m.def.attacks;
    const free = pool.filter(a => !/Merge$/.test(a.name)), linked = chainedTo(m.def.attacks);
    const own = free.some(a => !linked.has(a)) ? free.filter(a => !linked.has(a)) : free;
    const melee = own.filter(a => a.shape), ranged = own.filter(a => !a.shape);
    const usable = own.filter(a => gap <= this.reach(a));
    // prefer a melee attack in reach, then a ranged one
    const attack = usable.find(a => a.shape) ?? usable[0] ?? null;
    if (!follow && attack && m.cooldown <= 0 && facing < (turn < 6 ? 0.25 : 0.6)) {
      if (turn >= 6) m.heading = want;
      m.state = "attack";
      this.startAttack(m, attack);
      // TargetActionConfig SimpleAttack: minAttackInterval 1000 ms between attack starts (the
      // class default; the monsters' behaviour configs are stripped from the export)
      m.cooldown = 1;
      return;
    }
    const sp = m.def.targetedSpeed * this.statusSpeed(m);
    if (sp <= 0) { this.play(m, m.def.idle); return; }
    // ranged-only monsters hold a middle distance; others close to melee range
    const keep = follow ? 2 : !melee.length && ranged.length ? Math.min(...ranged.map(a => this.reach(a))) * 0.6 : (melee.length ? this.reach(melee[0]) * 0.7 : 1);
    let mx = 0, my = 0;
    if (gap > keep) {
      // straight at the knight when the way is clear, else along an A* path around walls
      m.pathAge -= dt;
      m.stuck -= dt;
      if (m.stuck <= 0 && this.collision.clearLine(m.x, m.y, k.x, k.y, m.radius * 0.8, MONSTER_MASK)) m.path = null;
      else if (!m.path || m.pathAge <= 0) {
        m.path = this.collision.findPath(m.x, m.y, k.x, k.y, m.radius * 0.8, MONSTER_MASK);
        m.pathAge = 0.6 + Math.random() * 0.4;
      }
      while (m.path?.length && Math.hypot(m.path[0][0] - m.x, m.path[0][1] - m.y) < 0.35) m.path.shift();
      const [tx, ty] = m.path?.length ? m.path[0] : [k.x, k.y];
      const tdx = tx - m.x, tdy = ty - m.y, td = Math.hypot(tdx, tdy) || 1;
      mx = tdx / td; my = tdy / td;
      if (m.path?.length) m.turnToward(Math.atan2(my, mx), turn, dt);
    }
    else if (!melee.length && gap < keep * 0.5) { mx = -dx / dist; my = -dy / dist; }
    if (mx || my) {
      const ox = m.x, oy = m.y;
      this.move(m, mx * sp * dt, my * sp * dt, MONSTER_MASK);
      // blocked (a ledge or rail the straight line slips past): path around it for a while
      if (Math.hypot(m.x - ox, m.y - oy) < sp * dt * 0.25 && m.stuck <= 0) {
        m.path = this.collision.findPath(m.x, m.y, k.x, k.y, m.radius, MONSTER_MASK);
        m.pathAge = 1;
        m.stuck = 1.5;
      }
      this.play(m, m.def.move ?? m.def.idle, { speed: sp / Math.max(0.5, m.def.moveSpeed) });
    } else {
      this.play(m, m.def.idle);
    }
  }

  /** An ally's foe: the nearest fighting monster near it and the knight. */
  private allyTarget(m: Monster): Monster | null {
    let best: Monster | null = null, bd = 9;
    for (const o of this.monsters) {
      if (o.ally || o.passive || o.state === "dying" || o.state === "spawning") continue;
      const d = Math.hypot(o.x - m.x, o.y - m.y);
      if (d < bd && Math.hypot(o.x - this.knight.x, o.y - this.knight.y) < 14) { bd = d; best = o; }
    }
    return best;
  }

  /**
   * Lichens fuse: two colonies side by side, neither busy, and one turns to the other and
   * plays its merge attack while the other waits. Returns true while this one is merging.
   */
  private lichenMerge(m: Monster): boolean {
    const o = m.mergeWith;
    if (o) {
      // the partner waits for the initiator's merge; anything interrupting it calls it off
      const busy = (x: Monster) => x.attack && /Merge$/.test(x.attack.def.name);
      if (o.state === "dying" || !this.monsters.includes(o) || o.mergeWith !== m || (!busy(m) && !busy(o))) {
        m.mergeWith = null;
        if (o.mergeWith === m) o.mergeWith = null;
        return false;
      }
      this.play(m, m.def.idle);
      return true;
    }
    if (m.cooldown > 0 || m.reacting > 0 || m.size >= 21) return false;
    const merge = m.def.attacks.find(a => /Merge$/.test(a.name));
    if (!merge) return false;
    const other = this.monsters.find(x => x !== m && x.size && x.size < 21 && !x.mergeWith && !x.attack && x.reacting <= 0
      && x.state !== "dying" && x.state !== "spawning" && x.statuses.length === 0
      && Math.hypot(x.x - m.x, x.y - m.y) < m.radius + x.radius + 0.5);
    if (!other) return false;
    m.mergeWith = other; other.mergeWith = m;
    m.heading = Math.atan2(other.y - m.y, other.x - m.x);
    m.state = "attack";
    this.startAttack(m, merge);
    m.cooldown = merge.rearm / 1000 + 1;
    return true;
  }

  /**
   * The merge lands: both colonies leave without a death (no loot), and the survivor's merge
   * handler (its SignalStart action, Spawn Lichen Colony) runs at the midpoint for the
   * combined size, capped at the largest; the case for a size is matched by position, since
   * the export dropped the switch's case values (sizes 2 to 21 in order).
   */
  private mergeLichens(m: Monster, o: Monster) {
    m.mergeWith = o.mergeWith = null;
    if (o.state === "dying" || !this.monsters.includes(o)) return;
    const size = Math.min(21, m.size + o.size);
    const handler = (m.def.handlers ?? []).find(h => /\$SignalStart$/.test(String(h?.$class)) && !h.name);
    const fireRef = findFireAction(handler?.action);
    const fa = fireRef ? this.data.resolveSync("config/fire_action.dat", fireRef, "action") : null;
    const sw = findSwitch(fa?.action);
    const act = sw ? (sw.cases?.[size - 2]?.action ?? sw.defaultAction) : null;
    const at = new Entity(false, "lichen merge");
    at.x = (m.x + o.x) / 2; at.y = (m.y + o.y) / 2; at.rotation = m.heading;
    for (const x of [m, o]) {
      const i = this.monsters.indexOf(x);
      if (i >= 0) this.monsters.splice(i, 1);
      if (x.entity) this.logic.vanish(x.entity);
    }
    if (act) this.logic.execute(act, at, m.entity ?? at);
  }

  /** Keeps actors from overlapping each other. */
  private separate() {
    // stationary monsters (turrets) are not pushed around
    const actors: Actor[] = [this.knight, ...this.monsters.filter(m => m.state !== "dying" && m.def.targetedSpeed > 0)];
    for (let i = 0; i < actors.length; i++) {
      for (let j = i + 1; j < actors.length; j++) {
        const a = actors[i], b = actors[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.radius + b.radius;
        if (d >= min || d < 1e-4) continue;
        const push = (min - d) / 2, nx = dx / d, ny = dy / d;
        if (!this.collision.collides(a.x - nx * push, a.y - ny * push, a.radius, MONSTER_MASK)) { a.x -= nx * push; a.y -= ny * push; }
        if (!this.collision.collides(b.x + nx * push, b.y + ny * push, b.radius, MONSTER_MASK)) { b.x += nx * push; b.y += ny * push; }
      }
    }
  }

  // ---------------------------------------------------------------- effects and drawing

  private async spawnEffect(ref: any, matrix: Mat4, life: number, follow?: Actor) {
    const model = await this.loader.loadRef(ref).catch(() => null);
    if (!model) return;
    this.startScripts(model, matrix, life, follow);
    if (model.script) return;
    const instance = await this.instantiate(model);
    this.effects.push({ instance, matrix, life, follow });
  }

  /**
   * Scripted models (alone or inside compounds: a bomb's drop sound, an explosion's blasts
   * and camera shake) have no geometry: they run their timed actions, then end (looping
   * ones live as long as the effect).
   */
  private startScripts(model: LoadedModel, matrix: Mat4, life: number, follow?: Actor) {
    const start = (m: LoadedModel, local: Mat4, depth: number) => {
      if (depth > 6) return;
      if (m.script) {
        const sc = m.script;
        const end = sc.actions.length ? sc.actions[sc.actions.length - 1].time : 0;
        this.effects.push({ instance: null, matrix: multiply(matrix, local), life: sc.loopDuration > 0 ? life : end + 0.1, follow,
          script: { actions: sc.actions, loop: sc.loopDuration, t: 0, next: 0 } });
      }
      for (const a of m.attachments) {
        const t = a.transform;
        start(a.model, multiply(local, t.matrix ?? compose(t.t, t.r, t.s)), depth + 1);
      }
    };
    start(model, compose([0, 0, 0], [0, 0, 0, 1], 1), 0);
  }

  /**
   * Executes a model action (opengl.model.config.ActionConfig) from a scripted model or an
   * animation frame: spawn a transient model, play a sound, or shake the camera.
   */
  private modelAction(action: any, matrix: Mat4, follow?: Actor, depth = 0) {
    if (!action || depth > 6) return;
    const k = String(action.$class ?? "").split("$").pop();
    switch (k) {
      case "SpawnTransient": {
        if (!action.model) break;
        const t = readTransform(action.transform);
        const local = t.matrix ?? compose(t.t, t.r, t.s);
        this.spawnEffect(action.model, multiply(matrix, local), 2.5, action.moveWithOrigin ? follow : undefined);
        break;
      }
      case "PlaySound":
        this.audio?.play(action.sounder, [matrix[12], matrix[13], matrix[14]]);
        break;
      case "ShakeCamera": this.addShake(action, matrix[12], matrix[13], matrix[14]); break;
      case "Compound": for (const a of action.actions ?? []) this.modelAction(a, matrix, follow, depth + 1); break;
      case "Random": {
        const list: any[] = action.actions ?? [];
        const total = list.reduce((s, w) => s + (w.weight ?? 1), 0);
        let r = Math.random() * total;
        for (const w of list) { r -= w.weight ?? 1; if (r <= 0) { this.modelAction(w.action, matrix, follow, depth + 1); break; } }
        break;
      }
      case "Conditional": this.modelAction(action.defaultAction, matrix, follow, depth + 1); break;
    }
  }

  /** Runs the frame actions the knight's, monsters' and effects' animations have reached. */
  private runEvents() {
    const drain = (inst: ModelInstance, matrix: () => Mat4, follow?: Actor) => {
      if (!inst.events.length) return;
      const m = matrix();
      for (const a of inst.events.splice(0)) this.modelAction(a, m, follow);
    };
    const k = this.knight;
    drain(k.instance, () => k.matrix(), k);
    for (const m of this.monsters) drain(m.instance, () => m.matrix(), m);
    for (const e of this.effects) if (e.instance) drain(e.instance, () => e.follow ? e.follow.matrix() : e.matrix, e.follow);
  }

  items(): { instance: ModelInstance; matrix: Mat4 }[] {
    const out: { instance: ModelInstance; matrix: Mat4 }[] = [];
    out.push({ instance: this.knight.instance, matrix: this.knight.matrix() });
    for (const m of this.monsters) {
      let matrix = m.matrix();
      if (m.state === "dying") {
        // shrink away while the death effect plays (after the dying animation, when it has one)
        const len = this.deathLength(m), fade = m.def.dying ? 0.3 : 0.5;
        const s = Math.max(0.01, Math.min(1, (len - m.stateTime) / fade));
        matrix = compose([m.x, m.y, m.z], [0, 0, Math.sin((m.heading + Math.PI / 2) / 2), Math.cos((m.heading + Math.PI / 2) / 2)], m.scale * s);
      }
      out.push({ instance: m.instance, matrix });
    }
    for (const p of this.props) if (p.instance) out.push({ instance: p.instance, matrix: p.matrix() });
    out.push(...this.beamItems);
    if (this.companion) out.push(...this.companion.items());
    for (const p of this.projectiles) if (p.instance && !p.done) out.push({ instance: p.instance, matrix: p.matrix() });
    for (const e of this.effects) if (e.instance) out.push({ instance: e.instance, matrix: e.follow ? e.follow.matrix() : e.matrix });
    return out;
  }

  /** Round shadows under the knight and monsters: position on the ground and radius. */
  shadows(): { x: number; y: number; z: number; r: number }[] {
    const out = [{ x: this.knight.x, y: this.knight.y, z: this.collision.groundZ(this.knight.x, this.knight.y), r: 0.75 }];
    for (const m of this.monsters) if (m.state !== "dying") out.push({ x: m.x, y: m.y, z: this.collision.groundZ(m.x, m.y), r: m.radius * m.scale * 1.7 });
    if (this.companion) out.push(this.companion.shadow());
    return out;
  }

  /** Living monsters, for health bars. */
  get liveMonsters() { return this.monsters.filter(m => m.state !== "dying" && m.state !== "spawning" && !m.passive && !m.ally); }
}

/** Attacks that only follow another (the later links of Chain attacks). */
function chainedTo(list: AttackDef[]): Set<AttackDef> {
  const out = new Set<AttackDef>();
  for (const a of list) { const n = a.chainTo !== null ? list[a.chainTo] : undefined; if (n && n !== a) out.add(n); }
  return out;
}

/** The first FireAction reference inside an action tree. */
function findFireAction(a: any, depth = 0): any | null {
  if (!a || depth > 8) return null;
  if (String(a.$class).endsWith("$FireAction")) return a.fireAction ?? null;
  for (const x of [a.action, ...(a.actions ?? [])]) { const r = findFireAction(x, depth + 1); if (r) return r; }
  return null;
}

/** The first ExpressionSwitch inside an action tree. */
function findSwitch(a: any, depth = 0): any | null {
  if (!a || depth > 8) return null;
  if (String(a.$class).endsWith("$ExpressionSwitch")) return a;
  for (const x of [a.action, ...(a.actions ?? [])]) { const r = findSwitch(x, depth + 1); if (r) return r; }
  return null;
}

/**
 * A lichen colony's size: its reference's "Size" argument, else the smallest of its kind
 * (Lichen Colony sizes 1 to 9, Large 10 to 15, Giant 16 to 21). Zero for other monsters.
 */
function lichenSize(ref: any): number {
  const name = String(ref?.name ?? "");
  if (!/Lichen Colony$/.test(name)) return 0;
  const arg = (ref?.arguments?.entries as [string, unknown][] | undefined)?.find(([k]) => k === "Size")?.[1];
  const n = Number(arg);
  return Number.isFinite(n) && n > 0 ? n : /Giant/.test(name) ? 16 : /Large/.test(name) ? 10 : 1;
}

/** TagConfig: its tags plus the chain of derived tag configs. */
function tagList(t: any, depth = 0): string[] {
  if (!t || depth > 8) return [];
  return [...((t.tags ?? []) as any[]).filter((x): x is string => typeof x === "string" && x !== ""), ...tagList(t.derived, depth + 1)];
}

/** Cache key for an animation path or reference (arguments included). */
function clipKey(p: string | any): string {
  return typeof p === "string" ? p : p.name + JSON.stringify(p.arguments?.entries ?? [], (k, v) => (k === "$outer" ? undefined : v));
}


export type { LoadedModel, Vec3 };
