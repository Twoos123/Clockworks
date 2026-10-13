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
import { dealt, mainType, TYPE_COLORS } from "./combat";
import { GameData, type ArmorDef, type AttackDef, type MonsterDef, type ProjectileDef, type ShieldDef, type WeaponDef } from "./data";
import { zeroAmounts, type Amounts, type DepthContext, type Difficulty } from "./depth";
import { addItemBonuses, emptyBonuses, forWeapon, resistFactor, STATUS_BITS, type Bonuses } from "./bonus";
import { Entity, Logic, type LogicHost } from "./logic";
import { Prop, propKind } from "./props";
import { intersects } from "./shapes";
import { SpawnTables } from "./spawntable";
import { DEFAULT_LOADOUT, levelMultiplier, POCKET_SLOTS, type Loadout as GearLoadout } from "./save";
import { StatusConditions, type ActiveStatus } from "./status";

// Character/PC/Default: speed 5, circle radius 1/3, collision mask 43
const KNIGHT_SPEED = 5, KNIGHT_RADIUS = 1 / 3, KNIGHT_MASK = 43;
/** Knight health. The game derives it from gear in closed code, so this is a tuning value. */
const KNIGHT_HEALTH = 100;
const MONSTER_MASK = 1 | 2 | 8 | 32;
const AGGRO_RANGE = 10, LEASH_RANGE = 18;
export const STARTER_WEAPONS = ["Weapon/Sword/Proto Sword", "Weapon/Handgun/Proto Gun", "Weapon/Bomb/Proto Bomb"];
const STARTER_SHIELD = "Gear/Shield/Proto Shield";
const STARTER_ARMOR = ["Gear/Armor/Parts/Proto (Base)", "Gear/Helm/Parts/Proto (Base)"];
/**
 * Assumed lunge for knight swings whose AttackConfig omits impulseReceived (the class default
 * lives in game code, not data); the data's explicit combo lunges are 1.25 to 2.5 units.
 */
const DEFAULT_SWING_IMPULSE = { forward: 1, side: 0, delay: 0, duration: 150 };
/** The body model's default armour and helmet (character/pc/model.dat's own arguments). */
const gearRef = (name: string) => ({ $class: "com.threerings.config.ConfigReference", name,
  arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Colorization", 257], ["Variant", "grey"]] } });
const DEFAULT_GEAR = { armor: gearRef("item/gear/armor/doublebelt/model.dat"), helmet: gearRef("item/gear/helm/pith/model.dat") };

/** The dash: its numbers live in game code, so these are tuning values. */
const DASH = { distance: 3.2, time: 0.25, cooldown: 0.9 };
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
}

export interface Floater { x: number; y: number; z: number; text: string; color: string; age: number }

type Phase = "start" | "fire" | "end";
type Team = "knight" | "monster";

abstract class Actor {
  x = 0; y = 0; z = 0;
  heading = -Math.PI / 2;
  health = 1; maxHealth = 1;
  dead = false;
  /** Knockback velocity, decaying. */
  kx = 0; ky = 0;
  attack: { def: AttackDef; phase: Phase; t: number; hit: boolean; lunged: boolean; overlay: boolean; touched?: Set<Actor> } | null = null;
  /** Lunge from an attack's impulse: velocity and remaining seconds. */
  lunge = { vx: 0, vy: 0, t: 0 };
  /** Nodes animated by the upper-body overlay (knights); null plays attacks whole-body. */
  upperBody: Set<string> | null = null;
  defense: Amounts | null = null;
  /** Active status conditions (fire, freeze, shock...). */
  statuses: ActiveStatus[] = [];
  abstract radius: number;
  abstract readonly team: Team;
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
  readonly team = "knight";
  radius = KNIGHT_RADIUS;
  chain = 0;
  buffered = false;
  invulnerable = 0;
  hurtTime = 0;
  /** Seconds since the last attack started, for a gun's chain cooldown. */
  sinceAttack = 0;
  /** Seconds until a new combo may start (the finished attack's rearm time). */
  rearm = 0;
  weapons: Loadout[] = [];
  slot = 0;
  /** Attacks used from the current weapon's chain (a gun's clip). */
  chainUsed = 0;
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
  /** Health lost recently, shown on the HUD as a damage segment that drains away. */
  recentDamage = 0;
  sinceDamage = 1e9;
  get weapon(): WeaponDef | null { return this.weapons[this.slot]?.def ?? null; }
  get attacks(): AttackDef[] { return this.weapon?.attacks ?? []; }
}

export class Monster extends Actor {
  readonly team = "monster";
  /** Monsters without attacks (traders, wandering townsfolk) are passive and untouchable. */
  get passive() { return this.def.attacks.length === 0; }
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
  /** Called when a shopkeeper opens their shop (the NPC's name says what it sells). */
  onOpenShop: ((keeper: string) => void) | null = null;
  /** True once the level's exit elevator has been used. */
  finished = false;
  /** What the knight has collected on this floor. */
  readonly loot = { crowns: 0, heat: 0, materials: new Map<string, number>() };
  /**
   * The pocket: consumables (DungeonItemConfig Capsule and Vial) by item name and count. The
   * array is the save's own, so what is picked up or used stays with the knight.
   */
  pocket: [string, number][] = [];
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
  /** Camera shake strength from ShakeCamera actions, decaying. */
  shake = 0;

  constructor(private readonly loader: ModelLoader, private readonly renderer: Renderer,
    private readonly scene: LoadedScene, private readonly collision: CollisionMap, opts: WorldOptions = {}) {
    this.data = new GameData(loader);
    this.depth = opts.depth ?? 1;
    this.difficulty = opts.difficulty ?? "medium";
    this.audio = opts.audio ?? null;
    if (opts.arena) this.arena = { wave: 0, timer: 3, family: "" };
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
      ...list.filter(a => a.spawn).map(a => this.projectileDef(a.spawn!.actor)),
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
      arguments: { $map: "com.threerings.config.ArgumentMap", entries: args } };
    return this.renderer.instantiate(await this.loader.load("character/pc/model.dat", ref));
  }

  /** The knight's body model as worn (armour and helmet, no weapon), for the HUD portrait. */
  portraitRef(): any {
    const args: [string, any][] = [["Colorization", this.color]];
    for (const a of this.knight?.armor ?? []) args.push([a.slot === "helmet" ? "Helmet" : "Armor", this.colored(a.model ?? DEFAULT_GEAR[a.slot ?? "armor"])]);
    return { $class: "com.threerings.config.ConfigReference", name: "character/pc/model.dat",
      arguments: { $map: "com.threerings.config.ArgumentMap", entries: args } };
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
    await this.data.preload("config/item.dat");
    for (const n of [gear.armor, gear.helmet, gear.shield, ...(gear.trinkets ?? []), gear.vitapod]) {
      if (n) addItemBonuses(knight.bonuses, this.data.resolveSync("config/item.dat", { name: n }, "item"));
    }
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
      this.preload("character/pc/idle.dat", "character/pc/hurt_soft.dat",
        ...["forward", "backward", "left", "right"].flatMap(d => [`character/pc/run_${d}.dat`, `character/pc/walk_${d}.dat`]),
        ...["001", "002", "003", "004", "005"].map(n => `character/pc/idle/default/${n}.dat`),
        "character/pc/dead.dat", "character/pc/blend_shield.dat", "character/pc/shield_hit.dat", ...Object.values(CHARGE_ANIMS)),
      ...weapons.map(w => this.preloadAttacks([...w.attacks, w.chargedAttack, w.incompleteChargedAttack, w.cooldownAttack])),
      this.preloadAttacks([shield?.bash]),
      this.preload("character/pc/dodge/dodge_fire.dat", "character/pc/dodge/dodge_end.dat"),
    ]);
    this.play(knight, "character/pc/idle.dat");
    await this.startLogic();
  }

  /** Builds the level logic from the scene's entries and starts it (EntryLogic startup). */
  private async startLogic() {
    await this.data.preload("config/actor.dat", "config/spawn_table.dat", "config/parameterized_handler.dat",
      "config/fire_action.dat", "config/item.dat");
    this.tables = new SpawnTables(this.data.library_("config/spawn_table.dat"));
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
    ke.game = { isPawn: true };
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
      void this.spawnProjectileAt(ref, x, y, rotation, "monster", this.ctx(0));
    } else {
      this.createProp(e, cfg);
    }
    return e;
  }

  actorDestroyed(e: Entity) {
    const g = e.game;
    if (g instanceof Prop) this.removeProp(g, true);
    else if (g instanceof Monster && g.state !== "dying") { g.state = "dying"; g.stateTime = 0; }
  }

  fireEffect(_ref: any, _x: number, _y: number, _rotation: number) {
    // EffectConfigs drive client visuals and sounds; not modelled yet
  }

  /** Spiral Knights' own actions (DungeonActionConfig and friends). */
  gameAction(cfg: any, source: Entity, activator: Entity | null, logic: Logic): boolean | undefined {
    const k = String(cfg.$class ?? "").split("$").pop();
    if (cfg.$condition) return true;
    switch (k) {
      case "ActivateMonster": case "TableSpawn": case "TableSpawnPerMember": {
        const table = cfg.spawnTable ?? cfg.table;
        if (!table) return false;
        const at = cfg.location ? logic.resolveTarget(cfg.location, source, activator) : [source];
        let any = false;
        for (const t of at) {
          const results = this.tables.evaluate(table, { depth: this.depth, tier: this.tier(), difficulty: this.difficulty });
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
      case "OpenShop":
        this.onOpenShop?.(source.name);
        return true;
      case "NextFloor":
        this.finishLevel();
        return true;
      case "Heal": case "DepthScaleHeal": case "DepthHeal": {
        const amount = k === "Heal" ? (cfg.current ?? 20) : this.data.depth.evaluate(cfg.depthScale, this.ctx(0)) || 20;
        for (const t of cfg.target ? logic.resolveTarget(cfg.target, source, activator) : [activator]) {
          if (t === this.knightEntity) this.healKnight(amount);
        }
        return true;
      }
      case "DamageTarget": case "DamageTargetFromPoint": case "DamageRegion": case "DamageRegionFromPoint": {
        const amounts = this.amounts(cfg.damage, this.ctx(0));
        const region = /Region/.test(k) && !cfg.target && !cfg.region && source.fixedShape?.k === "circle";
        const fs = source.fixedShape, r = region && fs?.k === "circle" ? fs.r : 0;
        const targets = region
          ? logic.actors.filter(e => e !== activator && !e.destroyed && e.game instanceof Monster && Math.hypot(e.x - source.x, e.y - source.y) <= r + e.game.radius)
          : cfg.target ? logic.resolveTarget(cfg.target, source, activator) : activator ? [activator] : [];
        for (const t of targets) {
          if (t === this.knightEntity) this.damageKnight(amounts, 0.5, source.x, source.y);
          else if (t.game instanceof Monster) this.damageMonster(t.game, amounts, 0.5, source.x, source.y);
          else if (t.game instanceof Prop) this.damageProp(t.game, dealt(amounts, null));
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
    if (this.logic.actors.some(e => e.mobile && e !== ke && !e.destroyed && !(e.game instanceof Monster && e.game.passive))) return;
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
  private tier() { return this.depth >= 18 ? 3 : this.depth >= 9 ? 2 : 1; }

  private healKnight(amount: number) {
    const k = this.knight;
    if (k.dead) return;
    const poison = k.statuses.find(s => s.def.kind === "Poison");
    if (poison) {
      const c = poison.def.cfg;
      amount *= 1 + ((c.minHealModifier ?? -0.1) + ((c.maxHealModifier ?? -0.5) - (c.minHealModifier ?? -0.1)) * poison.def.power);
    }
    k.health = Math.min(k.maxHealth, k.health + amount);
    this.floaters.push({ x: k.x, y: k.y, z: k.z + 1.5, text: `+${Math.round(amount)}`, color: "#7bd88f", age: 0 });
  }

  private finishLevel() {
    if (this.finished) return;
    this.finished = true;
    this.onNextFloor?.();
  }

  // ---------------------------------------------------------------- props

  private createProp(e: Entity, cfg: any) {
    const kind = propKind(cfg);
    const p = new Prop(kind, e, cfg);
    e.game = p;
    p.z = this.collision.groundZ(e.x, e.y);
    if (kind === "door") p.open = !!cfg.open;
    if (kind === "block") {
      // no block config sets health, so the closed code's default applies: counted here in
      // hits (treasure boxes and mineral nodes take a few, crates one)
      const cls = String(cfg.$class).split("$").pop();
      p.health = p.maxHealth = cfg.health ?? (/Treasure|Mineral|Gathering/.test(e.name) ? 3 : 1);
      p.hits = cfg.health === undefined;
      p.breakable = !/Unbreakable|Hedgehog|Echo/i.test(e.name) && cls !== "GhostlinkBlock" && cls !== "DamageMirrorBlock";
    }
    (e.game as any).onSignal = (name: string) => this.propSignal(p, name);
    this.props.push(p);
    this.updatePropCollision(p);
    const model = cfg.sprite?.model ?? cfg.model;
    if (model) void this.loader.loadRef(model).then(async m => {
      if (!m || !this.props.includes(p)) return;
      p.instance = await this.renderer.instantiate(m);
      this.showPropState(p);
    });
  }

  /** Doors and blocks block movement while closed or standing. */
  private updatePropCollision(p: Prop) {
    const solid = (p.kind === "door" && !p.open) || (p.kind === "block" && (p.cfg.collisionFlags ?? 1) !== 0 && String(p.cfg.$class).split("$").pop() !== "GhostlinkBlock")
      || (p.kind === "generic" && ((p.cfg.collisionFlags ?? 1) & 1) !== 0 && !!p.cfg.shape);
    if (solid && p.collisionId === null) {
      const sh = p.cfg.shape;
      const w = (sh?.width ?? (sh?.radius ? sh.radius * 2 : 1)) / 2, h = (sh?.height ?? (sh?.radius ? sh.radius * 2 : 1)) / 2;
      const c = Math.abs(Math.cos(p.entity.rotation)), s2 = Math.abs(Math.sin(p.entity.rotation));
      p.collisionId = this.nextId++;
      this.collision.addBox(p.collisionId, p.x, p.y, w * c + h * s2, w * s2 + h * c, 1);
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
    if (p.kind === "door") {
      anim = changed ? st[p.open ? 2 : 0] : st[p.open ? 3 : 1];
      loop = !changed;
    } else if (p.kind === "switch") anim = st[p.pressed ? 1 : 0];
    else {
      // townsfolk and other animated actors stand in their (weighted) idle animation
      const idles: any[] = p.cfg.sprite?.idles ?? [];
      anim = idles.length ? idles.reduce((a, b) => ((b.weight ?? 1) > (a.weight ?? 1) ? b : a)).animation : null;
    }
    const clip = anim ? this.clip(anim) : null;
    if (clip) p.instance.play(clip, { loop, blend: 0.05 });
    else if (anim) void this.preload(anim).then(() => this.showPropState(p, changed));
  }

  /** Doors open and close on signals; anything else listens through its handlers only. */
  private propSignal(p: Prop, name: string) {
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
    if (/Health|Heart/i.test(name)) this.healKnight(num("health", "amount") ?? this.knight.maxHealth * 0.25);
    else if (/Crown/i.test(name)) {
      const v = num("value", "amount", "crowns") ?? (/Gold/i.test(name) ? 10 : /Silver/i.test(name) ? 5 : 1);
      this.loot.crowns += v;
      this.floaters.push({ x: p.x, y: p.y, z: p.z + 1, text: `+${v} cr`, color: "#ffd84d", age: 0 });
    } else if (/Heat/i.test(name)) this.loot.heat += num("heat", "amount", "value") ?? 1;
    else this.loot.materials.set(name, (this.loot.materials.get(name) ?? 0) + 1);
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

  /** An item from a loot table (materials, gear): added to the floor's tally. */
  private awardItem(item: any, x: number, y: number) {
    const name = String(item.name);
    if (this.pocketItem(name)) {
      const z = this.collision.groundZ(x, y) + 1;
      if (this.pocketAdd(name)) this.floaters.push({ x, y, z, text: name.split("/").pop() ?? name, color: "#9ff0c0", age: 0 });
      return;
    }
    this.loot.materials.set(name, (this.loot.materials.get(name) ?? 0) + 1);
    this.floaters.push({ x, y, z: this.collision.groundZ(x, y) + 1, text: name.split("/").pop() ?? name, color: "#c9e6ff", age: 0 });
  }

  private damageProp(p: Prop, amount: number) {
    if (!p.breakable || p.entity.destroyed) return;
    this.logic.damaged(p.entity, this.knightEntity);
    // each hit runs the block's damage action (treasure boxes spill loot as they are struck)
    if (p.cfg.damageAction) this.logic.execute(p.cfg.damageAction, p.entity, this.knightEntity);
    p.health -= p.hits ? 1 : amount;
    if (p.health <= 0) this.logic.destroy(p.entity, this.knightEntity);
  }

  /** Per-tick prop behaviour: switches pressed underfoot, pickups, carried keys, the elevator. */
  private updateProps(dt: number, interact: boolean) {
    const k = this.knight, ke = this.knightEntity;
    const kshape = { k: "circle" as const, x: k.x, y: k.y, r: KNIGHT_RADIUS };
    const touching = (p: Prop) => { const s = p.entity.shape(); return !!s && intersects(s, kshape); };
    let interacted = false;
    for (const p of [...this.props]) {
      if (p.instance) p.instance.time += dt;
      switch (p.kind) {
        case "switch": {
          const on = touching(p) || this.monsters.some(m => m.state !== "dying" && Math.hypot(m.x - p.x, m.y - p.y) < m.radius + 0.4);
          const oneTime = /One-Time/i.test(p.entity.name);
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
        case "elevator":
          if (!k.dead && touching(p)) {
            p.standTime += dt;
            if (p.standTime > 1.5 && !this.finished) this.finishLevel();
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

  /** Depth-scaled defence and shield health from the knight's gear. */
  private updateKnightStats(k: Knight) {
    const d = zeroAmounts();
    for (const a of k.armor) if (a.defense) this.data.depth.defense(a.defense, this.ctx(a.rarity), d);
    k.defense = d;
    // a heart pip in the game is 40 health; here the knight has 100 for the game's 400
    k.maxHealth = KNIGHT_HEALTH + k.bonuses.health / 4;
    if (k.shield) {
      const sctx = this.ctx(k.shield.rarity);
      k.shieldMax = Math.max(1, this.data.depth.evaluate(k.shield.healthScale, sctx) || 50);
      k.shieldHealth = Math.min(k.shieldHealth, k.shieldMax);
      if (k.shieldHealth <= 1) k.shieldHealth = k.shieldMax;
      k.shieldDefense = k.shield.defense ? this.data.depth.defense(k.shield.defense, sctx) : null;
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
    this.updateKnight(dt, input);
    for (const m of this.monsters) this.updateMonster(m, dt);
    this.updateProps(dt, !!input.interact && !this.knight.dead);
    // the logic sees actors where the game has moved them
    const ke = this.knightEntity;
    ke.x = this.knight.x; ke.y = this.knight.y; ke.rotation = this.knight.heading;
    ke.collisionFlags = this.knight.dead ? 0 : 4;
    for (const m of this.monsters) if (m.entity) { m.entity.x = m.x; m.entity.y = m.y; m.entity.rotation = m.heading; }
    this.logic.tick(dt * 1000);
    for (const d of [...this.delayed]) if ((d.t -= dt) <= 0) { this.delayed.splice(this.delayed.indexOf(d), 1); d.run(); }
    if (this.arena) this.updateArena(dt);
    this.separate();
    this.updateProjectiles(dt);
    this.runEvents();
    this.shake = Math.max(0, this.shake - dt * 2);
    for (const e of this.effects) {
      e.life -= dt;
      const sc = e.script;
      if (sc) {
        sc.t += dt;
        while (sc.next < sc.actions.length && sc.actions[sc.next].time <= sc.t) this.modelAction(sc.actions[sc.next++].action, e.follow ? e.follow.matrix() : e.matrix, e.follow);
        if (sc.next >= sc.actions.length && sc.loop > 0 && sc.t >= sc.loop) { sc.t -= sc.loop; sc.next = 0; }
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) if (this.effects[i].life <= 0) this.effects.splice(i, 1);
    for (const f of this.floaters) f.age += dt;
    for (let i = this.floaters.length - 1; i >= 0; i--) if (this.floaters[i].age > 1.2) this.floaters.splice(i, 1);
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      if (m.state === "dying" && m.stateTime > 0.6) this.monsters.splice(i, 1);
    }
  }

  private move(a: { x: number; y: number; z: number; radius: number }, dx: number, dy: number, mask: number) {
    if (!this.collision.collides(a.x + dx, a.y, a.radius, mask)) a.x += dx;
    if (!this.collision.collides(a.x, a.y + dy, a.radius, mask)) a.y += dy;
    const g = this.collision.groundZ(a.x, a.y);
    a.z += (g - a.z) * 0.25;
  }

  private applyKnockback(a: Actor, dt: number, mask: number) {
    if (Math.abs(a.kx) + Math.abs(a.ky) < 0.01) return;
    this.move(a, a.kx * dt, a.ky * dt, mask);
    const decay = Math.exp(-dt * 10);
    a.kx *= decay; a.ky *= decay;
  }

  /** Switches to a carried weapon: the knight model with that weapon takes over. */
  private switchWeapon(slot: number) {
    const k = this.knight;
    if (slot === k.slot || !k.weapons[slot] || k.attack || k.charge !== null) return;
    const next = k.weapons[slot];
    next.instance.time = k.instance.time;
    k.instance = next.instance;
    k.slot = slot;
    k.chain = 0;
    k.chainUsed = 0;
    k.buffered = false;
    k.rearm = 0.2;
    this.play(k, "character/pc/idle.dat");
  }

  /** The aim angle, snapped to a monster in the weapon's targeting cone when there is one. */
  private autoAim(aimAngle: number): number {
    const k = this.knight, w = k.weapon;
    if (!w || w.targetingDist <= 0) return aimAngle;
    const cone = (w.targetingAngle * Math.PI) / 180;
    let best: number | null = null, bestDist = Infinity;
    for (const m of this.monsters) {
      if (m.state === "dying" || m.state === "spawning") continue;
      const dx = m.x - k.x, dy = m.y - k.y, d = Math.hypot(dx, dy);
      if (d > w.targetingDist + m.radius || d >= bestDist) continue;
      const ang = Math.atan2(dy, dx);
      if (Math.abs(Math.atan2(Math.sin(ang - aimAngle), Math.cos(ang - aimAngle))) > cone) continue;
      best = ang; bestDist = d;
    }
    return best ?? aimAngle;
  }

  /**
   * Knight controls, after Spiral Knights: click to attack (clicks during an attack chain
   * the next one), keep holding to charge and release when full for the weapon's charge
   * attack, hold the shield button to defend, 1 to 3 to switch weapons. Swords root the
   * knight and lunge with each swing; guns and bombs fire from the upper body while the
   * knight walks at the weapon's attacking speed. A gun's chain is its clip: when it runs
   * out, the cooldown attack (the reload) plays.
   */
  private updateKnight(dt: number, input: KnightInput) {
    const k = this.knight;
    k.instance.time += dt;
    if (k.instance.overlay) k.instance.overlay.time += dt;
    k.invulnerable -= dt;
    k.hurtTime -= dt;
    k.sinceAttack += dt;
    this.updateShieldHealth(dt);
    k.sinceDamage += dt;
    if (k.sinceDamage > 0.6) k.recentDamage = Math.max(0, k.recentDamage - dt * 60);
    k.rearm -= dt;
    k.dashCooldown -= dt;
    if (k.dead) { k.instance.overlay = null; this.setShieldEffect(false); return; }
    this.applyKnockback(k, dt, KNIGHT_MASK);
    if (this.tickStatuses(k, dt)) {
      // frozen, asleep or mid-spasm: no moving or attacking
      k.shielding = false;
      this.setShieldEffect(false);
      if (k.hurtTime <= 0) this.play(k, "character/pc/idle.dat");
      return;
    }
    if (input.weaponSlot != null) this.switchWeapon(input.weaponSlot);

    const weapon = k.weapon;
    const aimAngle = this.autoAim(input.aim ? Math.atan2(input.aim[1] - k.y, input.aim[0] - k.x) : k.heading);
    // a gun's partly used clip restores after a pause
    if (weapon && weapon.chainCooldown > 0 && !k.attack && k.chainUsed > 0 && k.sinceAttack * 1000 > weapon.chainCooldown + 300) k.chainUsed = 0;

    // shield: only when not attacking or charging
    k.shielding = input.shield && !k.attack && k.charge === null && !!k.shield;
    this.setShieldEffect(k.shielding);

    // shield bash: attack with the shield up and a full bar; it costs half the bar
    if (input.attackDown && k.shielding && k.shield?.bash && k.shieldBroken <= 0 && k.shieldHealth >= k.shieldMax * 0.98) {
      k.shieldHealth -= k.shieldMax / 2;
      k.sinceShieldHit = 0;
      k.shielding = false;
      this.setShieldEffect(false);
      k.heading = aimAngle;
      this.startAttack(k, k.shield.bash);
      input = { ...input, attackDown: false };
    }
    // dash: a quick dodge along the movement direction (or facing), briefly untouchable
    if (input.dash && !k.attack && k.charge === null && k.dashCooldown <= 0) {
      const [mx0, my0] = input.move;
      const dir = Math.hypot(mx0, my0) > 0.01 ? Math.atan2(my0, mx0) : k.heading;
      k.heading = dir;
      k.dashCooldown = DASH.cooldown;
      k.invulnerable = Math.max(k.invulnerable, DASH.time);
      k.lunge = { vx: Math.cos(dir) * DASH.distance / DASH.time, vy: Math.sin(dir) * DASH.distance / DASH.time, t: DASH.time };
      this.play(k, "character/pc/dodge/dodge_fire.dat", { loop: false, blend: 0.04 });
      k.hurtTime = DASH.time;
      return;
    }
    if (k.lunge.t > 0 && k.dashCooldown > DASH.cooldown - DASH.time) { this.applyLunge(k, dt, KNIGHT_MASK); return; }
    // attack input: bombs (charge-only weapons) start charging on the press
    if (input.attackDown && !k.shielding) {
      if (!k.attack && k.charge === null && k.rearm <= 0) {
        if (weapon && !weapon.attacks.length && weapon.chargedAttack) k.charge = 0;
        else this.knightAttack(0, aimAngle);
      } else if (k.attack) k.buffered = true;
    }

    this.applyLunge(k, dt, KNIGHT_MASK);
    if (k.attack) {
      if (k.attack.overlay) k.turnToward(aimAngle, 20, dt);
      this.advanceAttack(k, dt, () => {
        if (!k.buffered) return false;
        if (weapon && weapon.maxChain > 0 && k.chainUsed >= weapon.maxChain) return false;
        const next = (k.chain + 1) % Math.max(1, k.attacks.length);
        if (next === 0 && weapon?.kind === "Sword") return false;
        this.knightAttack(next, aimAngle);
        return true;
      });
      if (!k.attack) this.afterAttack(k, input);
    } else if (k.charge !== null) {
      k.turnToward(aimAngle, 18, dt);
      if (input.attackHeld) {
        k.charge += dt;
        this.overlay(k, CHARGE_ANIMS[weapon?.kind ?? "Other"], true);
      } else {
        const full = k.charge * 1000 >= (weapon?.chargeTime ?? 2000) * Math.max(0.3, 1 - forWeapon(k.bonuses.charge, weapon?.kind));
        k.charge = null;
        k.instance.overlay = null;
        const def = full ? weapon?.chargedAttack : weapon?.incompleteChargedAttack;
        if (def) { k.heading = aimAngle; k.sinceAttack = 0; this.startAttack(k, def, this.overlayAttacks(weapon)); }
      }
    }

    // swords: no walking during a swing; the swing's own lunge moves the knight. After the
    // clear window (or any time in an interruptable follow-through) moving cancels it.
    // Guns and bombs walk at the weapon's attacking speed.
    const [mx, my] = input.move;
    const len = Math.hypot(mx, my);
    let factor = (k.charge !== null ? 0.5 : k.shielding ? 1 + (k.shield?.defendingSpeed ?? -0.5) : 1) * this.statusSpeed(k) * (1 + k.bonuses.speed);
    if (k.attack) {
      const at = k.attack;
      if (at.overlay) factor = weapon?.attackingSpeed ?? 0.5;
      else {
        const canCancel = at.phase === "end" && (at.def.interruptable || at.t * 1000 >= at.def.clear);
        if (!(canCancel && len > 0.01)) return;
        k.attack = null;
        k.chain = 0;
      }
    }
    const facing = k.attack || k.charge !== null || k.shielding;
    if (len > 0.01 && factor > 0.01) {
      this.move(k, (mx / len) * KNIGHT_SPEED * factor * dt, (my / len) * KNIGHT_SPEED * factor * dt, KNIGHT_MASK);
      if (!facing) k.turnToward(Math.atan2(my, mx), 16, dt);
      else if (!k.attack) k.turnToward(aimAngle, 12, dt);
      this.playMovement(k, Math.atan2(my, mx), KNIGHT_SPEED * factor);
    } else {
      if (k.shielding) k.turnToward(aimAngle, 12, dt);
      if (k.hurtTime <= 0) this.playIdle(k);
    }

    // upper body: shield pose when defending, nothing otherwise
    if (!k.attack && k.charge === null) {
      if (k.shielding) this.overlay(k, "character/pc/blend_shield.dat", true);
      else if (k.instance.overlay && k.hurtTime <= 0) k.instance.overlay = null;
    }
  }

  /**
   * The knight's QuadMovement: forward, backward, left or right by the move direction
   * relative to facing, walking (speed 1) or running (speed 6) by actual speed.
   */
  private playMovement(k: Knight, dir: number, speed: number) {
    const rel = Math.atan2(Math.sin(dir - k.heading), Math.cos(dir - k.heading));
    const side = Math.abs(rel) < Math.PI / 4 ? "forward" : Math.abs(rel) > (3 * Math.PI) / 4 ? "backward" : rel > 0 ? "left" : "right";
    const run = speed > 3.5;
    this.play(k, `character/pc/${run ? "run" : "walk"}_${side}.dat`, { speed: Math.max(0.4, speed / (run ? KNIGHT_SPEED : 2)) });
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

  /** Weapons with an attacking speed fire from the upper body while the knight walks. */
  private overlayAttacks(w: WeaponDef | null) { return w?.attackingSpeed != null; }

  /** After an attack ends: a spent gun reloads; holding the button starts a charge. */
  private afterAttack(k: Knight, input: KnightInput) {
    const w = k.weapon;
    if (!w) return;
    if (w.maxChain > 0 && k.chainUsed >= w.maxChain && w.cooldownAttack) {
      k.chainUsed = 0;
      k.chain = 0;
      this.startAttack(k, w.cooldownAttack, this.overlayAttacks(w));
      return;
    }
    if (input.attackHeld && w.chargedAttack && !k.buffered) k.charge = 0;
  }

  private knightAttack(index: number, aimAngle: number) {
    const k = this.knight, w = k.weapon;
    if (!k.attacks.length || !w) return;
    k.chain = index;
    k.buffered = false;
    k.heading = aimAngle;
    k.sinceAttack = 0;
    // only weapons with a cooldown attack (guns) carry their chain count between combos
    if (index === 0 && !w.cooldownAttack) k.chainUsed = 0;
    k.chainUsed++;
    this.startAttack(k, k.attacks[index], this.overlayAttacks(w));
  }

  /**
   * Shield health after the item data: regeneration starts hitTime ms after the last hit and
   * refills the shield over regenTime ms; a broken shield stays down for breakTime ms.
   */
  private updateShieldHealth(dt: number) {
    const k = this.knight, s = k.shield;
    if (!s) return;
    k.sinceShieldHit += dt;
    if (k.shieldBroken > 0) {
      k.shieldBroken -= dt;
      if (k.shieldBroken <= 0) k.shieldHealth = k.shieldMax;
      return;
    }
    if (k.sinceShieldHit * 1000 >= s.hitTime) k.shieldHealth = Math.min(k.shieldMax, k.shieldHealth + k.shieldMax * dt * 1000 / s.regenTime);
  }

  private shieldFx: Effect | null = null;
  private setShieldEffect(on: boolean) {
    const k = this.knight;
    if (on && !this.shieldFx && k.shield?.effect && !this.shieldLoading) {
      this.shieldLoading = true;
      this.loader.loadRef(k.shield.effect).then(async m => {
        if (m && this.knight.shielding) {
          this.shieldFx = { instance: await this.renderer.instantiate(m), matrix: k.matrix(), life: 1e9, follow: k };
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
    a.attack = { def, phase: "start", t: 0, hit: false, lunged: false, overlay: overlay && !!a.upperBody };
    if (def.start) this.animate(a, def.start, def.startSpeed);
    else this.enterFire(a);
  }

  /** One-shot attack animation: upper body for walking attacks, else whole body. */
  /** The knight's attack rate from attack speed bonuses for the weapon in hand. */
  private attackRate(a: Actor) { return a === this.knight ? 1 + forWeapon(this.knight.bonuses.attackSpeed, this.knight.weapon?.kind) : 1; }

  private animate(a: Actor, path: string | any, speed: number) {
    speed *= this.attackRate(a);
    if (a.attack?.overlay) { this.overlay(a, path, false, speed); return; }
    a.instance.overlay = null;
    this.play(a, path, { loop: false, speed, blend: 0.06 });
  }

  private animDone(a: Actor) {
    return a.attack?.overlay ? a.instance.overlayFinished || !a.instance.overlay : a.instance.finished;
  }

  /** Moves an actor along an active lunge. */
  private applyLunge(a: Actor, dt: number, mask: number) {
    if (a.lunge.t <= 0) return;
    const step = Math.min(dt, a.lunge.t);
    a.lunge.t -= step;
    this.move(a, a.lunge.vx * step, a.lunge.vy * step, mask);
  }

  private enterFire(a: Actor) {
    const at = a.attack!;
    at.phase = "fire";
    at.t = 0;
    if (at.def.fire) this.animate(a, at.def.fire, at.def.fireSpeed);
    if (at.def.swing) {
      const ref = at.def.swing.$class?.endsWith("SpawnTransient") ? at.def.swing.model : at.def.swing;
      this.spawnEffect(ref, a.matrix(), 0.7, a);
    }
  }

  /**
   * Steps an attacker through start, fire (hit or spawn after `delay`) and end. `chain` may
   * start the next attack in a combo when the fire phase completes or in the clear window.
   */
  private advanceAttack(a: Actor, dt: number, chain?: () => boolean) {
    const at = a.attack!;
    dt *= this.attackRate(a);
    at.t += dt;
    if (at.phase === "start" && (this.animDone(a) || !at.def.start || at.t > 1.5)) this.enterFire(a);
    else if (at.phase === "fire") {
      // the attack's impulse carries the attacker (each sword swing is a lunge; some gun
      // charges kick back); knight swings whose config omits it take a short step
      const imp = at.def.impulse ?? (a === this.knight && !at.overlay && at.def.shape ? DEFAULT_SWING_IMPULSE : null);
      if (imp && !at.lunged && at.t * 1000 >= imp.delay) {
        at.lunged = true;
        const dur = Math.max(0.05, imp.duration / 1000), c = Math.cos(a.heading), sn = Math.sin(a.heading);
        a.lunge = { vx: (imp.forward * c - imp.side * sn) / dur, vy: (imp.forward * sn + imp.side * c) / dur, t: dur };
      }
      if (at.def.contact && a.lunge.t > 0) this.contactHits(a, at);
      if (!at.hit && at.t * 1000 >= at.def.delay) {
        at.hit = true;
        if (at.def.spawn) this.spawnProjectile(a, at.def);
        else if (at.def.shape) this.resolveHit(a, at.def);
      }
      if (this.animDone(a) || !at.def.fire || at.t > 1.5) {
        if (chain?.()) return;
        at.phase = "end";
        at.t = 0;
        if (at.def.end) this.animate(a, at.def.end, at.def.endSpeed);
      }
    } else if (at.phase === "end") {
      if (chain && at.t * 1000 < Math.max(at.def.clear, 150) && chain()) return;
      if (this.animDone(a) || !at.def.end || at.t > 1.5) {
        a.attack = null;
        // rearm: the cooldown before a new attack (long after a combo's last swing)
        if (a === this.knight) {
          this.knight.chain = 0;
          if (at.overlay) this.knight.instance.overlay = null;
          this.knight.rearm = at.def.rearm / 1000;
        }
      }
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
    return { ...this.ctx(w?.rarity ?? 0), multiplier: levelMultiplier(this.weaponLevels.get(w?.name ?? "") ?? 1) * this.buffDamage(this.knight)
      * (1 + forWeapon(this.knight.bonuses.damage, w?.kind)), tagged: this.knight.bonuses.tagged };
  }

  /** Applies an attack's damage shape in front of the attacker. */
  private resolveHit(a: Actor, def: AttackDef) {
    const shape = def.shape!;
    const c = Math.cos(a.heading), s = Math.sin(a.heading);
    const hits = (tx: number, ty: number, r: number) => {
      const dx = tx - a.x, dy = ty - a.y;
      const lx = dx * c + dy * s - shape.forward, ly = -dx * s + dy * c - shape.side;
      if (shape.halfWidth > 0) return Math.abs(lx) <= shape.halfLength + r && Math.abs(ly) <= shape.halfWidth + r;
      return Math.hypot(lx, ly) <= shape.radius + r;
    };
    const amounts = this.amounts(def.damage, this.attackerCtx(a));
    if (a === this.knight) {
      for (const m of this.monsters) {
        if (m.state === "dying" || m.state === "spawning" || !hits(m.x, m.y, m.radius)) continue;
        this.damageMonster(m, amounts, def.knockback, a.x, a.y);
      }
      for (const p of [...this.props]) {
        if (p.breakable && hits(p.x, p.y, 0.45)) this.damageProp(p, dealt(amounts, null));
      }
    } else if (!this.knight.dead && hits(this.knight.x, this.knight.y, this.knight.radius)) {
      this.damageKnight(amounts, def.knockback, a.x, a.y);
    }
  }

  /** A DamageConfig as amounts per type; attacks without one deal a small normal hit. */
  private amounts(damage: any, ctx: DepthContext): Amounts {
    const a: Amounts & { statuses?: any[]; ctx?: DepthContext } = damage ? this.data.depth.damage(damage, ctx) : zeroAmounts();
    if (a.NORMAL + a.PIERCING + a.ELEMENTAL + a.SHADOW <= 0) a.NORMAL = 10;
    if (ctx.multiplier) for (const t of ["NORMAL", "PIERCING", "ELEMENTAL", "SHADOW"] as const) a[t] *= ctx.multiplier;
    const statuses: any[] = [];
    const walk = (d: any, depth = 0) => {
      if (!d || depth > 6) return;
      const k = String(d.$class ?? "").split("$").pop();
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
    const st: ActiveStatus = { def, remaining: duration, tick: def.interval, fx: null };
    target.statuses.push(st);
    const sprite = def.cfg.sprite;
    if (sprite?.applicationTransient) this.spawnEffect(sprite.applicationTransient, target.matrix(), 2, target);
    if (sprite?.model) {
      void this.loader.loadRef(sprite.model).then(async m => {
        if (!m || !target.statuses.includes(st)) return;
        const fx: Effect = { instance: await this.renderer.instantiate(m), matrix: target.matrix(), life: 1e9, follow: target };
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
      st.tick -= dt;
      const d = st.def;
      if (st.tick <= 0) {
        st.tick += d.interval;
        if ((d.kind === "Fire" || d.kind === "Curse") && d.tickDamage > 0) this.statusDamage(a, d.tickDamage, d.kind === "Fire" ? "#ff8a3d" : "#b07bff");
        if (d.kind === "Shock") {
          // a spasm interrupts, and an arc jumps to the victim's neighbours
          (st as any).spasm = 0.35 + 0.25 * d.power;
          a.attack = null;
          const arc = d.tickDamage || 5;
          const others = a.team === "monster" ? this.monsters.filter(m => m !== a && m.state !== "dying" && Math.hypot(m.x - a.x, m.y - a.y) < 2) : [];
          for (const o of others) this.statusDamage(o, arc, "#9fe8ff");
        }
      }
      if (d.kind === "Freeze" || d.kind === "Sleep") held = true;
      if (d.kind === "Shock" && ((st as any).spasm ?? 0) > 0) { (st as any).spasm -= dt; held = true; }
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

  /** Movement factor from conditions (stun slows). */
  private statusSpeed(a: Actor): number {
    let f = 1;
    for (const st of a.statuses) {
      if (st.def.kind === "Stun") f *= 1 - Math.min(0.8, (st.def.cfg.minSpeedReduction ?? 0.3) + 0.3 * st.def.power);
      else if (st.def.kind === "Buff") f *= 1 + (st.def.cfg.speedModifier ?? 0);
    }
    return f;
  }

  /** Damage factor from buffs (Damage Modifier and Relative Damage Modifier). */
  private buffDamage(a: Actor): number {
    let f = 1;
    for (const st of a.statuses) if (st.def.kind === "Buff") f *= 1 + (st.def.cfg.damageModifier ?? 0) + (st.def.cfg.relativeDamageModifier ?? 0);
    return f;
  }

  /** Defence after poison's reduction. */
  private effectiveDefense(a: Actor): Amounts | null {
    const p = a.statuses.find(s => s.def.kind === "Poison");
    let f = 1;
    for (const st of a.statuses) if (st.def.kind === "Buff") f *= 1 + (st.def.cfg.defenseModifier ?? 0);
    if ((!p && f === 1) || !a.defense) return a.defense;
    if (p) {
      const c = p.def.cfg;
      f *= 1 - ((c.minDefenseReduction ?? 0.05) + ((c.maxDefenseReduction ?? 0.25) - (c.minDefenseReduction ?? 0.05)) * p.def.power);
    }
    const out = { ...a.defense };
    for (const k of Object.keys(out) as (keyof Amounts)[]) out[k] *= f;
    return out;
  }

  /** Conditions react to a hit: sleepers wake, frozen victims crack sooner. */
  private hitStatuses(a: Actor, amounts: Amounts) {
    for (const st of [...a.statuses]) {
      if (st.def.kind === "Sleep") this.endStatus(a, st);
      else if (st.def.kind === "Freeze") st.remaining -= 0.6;
    }
    const s = (amounts as any).statuses as any[] | undefined;
    if (s) for (const ref of s) this.applyStatus(a, ref, (amounts as any).ctx ?? this.ctx(0));
  }

  // ---------------------------------------------------------------- projectiles

  /** Spawns an attack's bullet or bomb in front of the attacker. */
  private async spawnProjectile(a: Actor, def: AttackDef) {
    const spawn = def.spawn!;
    const loaded = await this.projectileDef(spawn.actor);
    if (!loaded) return;
    const p = loaded.def;
    const heading = a.heading + spawn.rotation + (Math.random() * 2 - 1) * spawn.variance;
    const c = Math.cos(a.heading), s = Math.sin(a.heading);
    let x = a.x + p.offset[0] * c - p.offset[1] * s, y = a.y + p.offset[0] * s + p.offset[1] * c;
    // bombs drop at the knight's feet; a bullet starting inside a wall fizzles at once
    if (p.kind === "Bomb") { x = a.x + c * 0.4; y = a.y + s * 0.4; }
    const instance = loaded.model ? await this.renderer.instantiate(loaded.model) : null;
    const z = this.collision.groundZ(x, y) + p.height;
    const proj = new Projectile(p, instance, a.team, x, y, z, heading, this.attackerCtx(a));
    this.projectiles.push(proj);
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
    const instance = loaded.model ? await this.renderer.instantiate(loaded.model) : null;
    const z = this.collision.groundZ(x, y) + loaded.def.height;
    this.projectiles.push(new Projectile(loaded.def, instance, team, x, y, z, heading, ctx));
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      if (p.done) continue;
      p.age += dt;
      p.instance && (p.instance.time += dt);
      const d = p.def;
      if (d.kind === "Bullet") {
        const steps = Math.max(1, Math.ceil((d.speed * dt) / Math.max(0.1, d.radius)));
        for (let i = 0; i < steps && !p.done; i++) {
          p.x += (Math.cos(p.heading) * d.speed * dt) / steps;
          p.y += (Math.sin(p.heading) * d.speed * dt) / steps;
          const hit = this.projectileTarget(p);
          if (hit) this.detonate(p, true);
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
    if (p.team === "knight") {
      if (this.monsters.some(m => m.state !== "dying" && m.state !== "spawning" && !m.passive && Math.hypot(m.x - p.x, m.y - p.y) < m.radius + r)) return true;
      return this.props.some(b => b.breakable && Math.hypot(b.x - p.x, b.y - p.y) < 0.5 + r);
    }
    const k = this.knight;
    return !k.dead && Math.hypot(k.x - p.x, k.y - p.y) < k.radius + r;
  }

  /** A bullet hits or a bomb goes off: damage everything of the other team in its region. */
  private detonate(p: Projectile, bullet: boolean) {
    p.done = true;
    const d = p.def, r = d.regionRadius;
    const amounts = this.amounts(d.damage, p.ctx);
    if (d.hitFx) this.spawnEffect(d.hitFx, compose([p.x, p.y, bullet ? p.z : this.collision.groundZ(p.x, p.y)], [0, 0, Math.sin(p.heading / 2), Math.cos(p.heading / 2)], 1), 2);
    if (p.team === "knight") {
      for (const m of this.monsters) {
        if (m.state === "dying" || m.state === "spawning" || Math.hypot(m.x - p.x, m.y - p.y) > r + m.radius) continue;
        this.damageMonster(m, amounts, d.knockback * 0.25, p.x - Math.cos(p.heading) * 0.01, p.y - Math.sin(p.heading) * 0.01);
      }
      for (const b of [...this.props]) if (b.breakable && Math.hypot(b.x - p.x, b.y - p.y) <= r + 0.5) this.damageProp(b, dealt(amounts, null));
    } else {
      const k = this.knight;
      if (!k.dead && Math.hypot(k.x - p.x, k.y - p.y) <= r + k.radius) this.damageKnight(amounts, d.knockback * 0.25, p.x, p.y);
    }
  }

  // ---------------------------------------------------------------- damage

  private knock(target: Actor, fx: number, fy: number, strength: number) {
    const d = Math.hypot(target.x - fx, target.y - fy) || 1;
    const v = 3 + strength * 6;
    target.kx = ((target.x - fx) / d) * v;
    target.ky = ((target.y - fy) / d) * v;
  }

  private damageMonster(m: Monster, amounts: Amounts, knockback: number, fx: number, fy: number) {
    if (m.passive) return;
    // gear bonuses against the monster's family (the family is its folder: Monster/Slime/...)
    const fam = /\/Monster\/(Beast|Construct|Fiend|Gremlin|Slime|Undead)\//.exec(m.entity?.name ?? "")?.[1]?.toLowerCase();
    const bonus = fam ? (amounts as any).tagged?.[`fam_${fam}`] ?? 0 : 0;
    const dmg = Math.max(1, Math.round(dealt(amounts, this.effectiveDefense(m)) * (1 + bonus) * (0.95 + Math.random() * 0.1)));
    this.hitStatuses(m, amounts);
    // a big enough hit interrupts the monster (minReactPercent of its health)
    if (dmg >= m.maxHealth * m.def.minReactPercent && m.state !== "spawning") {
      m.attack = null;
      m.reacting = m.def.reactTime / 1000;
    }
    m.health -= dmg;
    this.floaters.push({ x: m.x, y: m.y, z: m.z + 1.2, text: String(dmg), color: TYPE_COLORS[mainType(amounts)], age: 0 });
    this.knock(m, fx, fy, knockback);
    if (m.def.hitFx) this.spawnEffect(m.def.hitFx, compose([m.x, m.y, m.z + 0.5], [0, 0, 0, 1], 1), 0.8);
    if (m.health <= 0) {
      m.state = "dying";
      m.stateTime = 0;
      m.attack = null;
      this.killCount++;
      if (m.entity) this.logic.destroy(m.entity, this.knightEntity);
      for (const st of [...m.statuses]) this.endStatus(m, st);
      if (m.def.deathFx) this.spawnEffect(m.def.deathFx, compose([m.x, m.y, m.z], [0, 0, 0, 1], m.scale), 2);
    } else if (m.state === "idle") {
      m.state = "chase";
    }
  }

  private damageKnight(amounts: Amounts, knockback: number, fx: number, fy: number) {
    const k = this.knight;
    if (k.invulnerable > 0 || k.dead) return;
    // a raised shield takes hits from every direction until it breaks
    if (k.shielding && k.shieldBroken <= 0 && k.shield) {
      const sdmg = Math.max(1, Math.round(dealt(amounts, k.shieldDefense)));
      k.shieldHealth -= sdmg;
      k.sinceShieldHit = 0;
      this.knock(k, fx, fy, knockback * 0.3);
      k.invulnerable = 0.25;
      this.overlay(k, "character/pc/shield_hit.dat");
      if (k.shieldHealth > 0) return;
      k.shieldHealth = 0;
      k.shieldBroken = k.shield.breakTime / 1000;
      if (k.shield.breakEffect) this.spawnEffect(k.shield.breakEffect, k.matrix(), 1.5);
      return;
    }
    const dmg = Math.max(1, Math.round(dealt(amounts, this.effectiveDefense(k)) * (0.95 + Math.random() * 0.1)));
    this.hitStatuses(k, amounts);
    const before = k.health;
    k.health = Math.max(0, k.health - dmg);
    k.recentDamage += before - k.health;
    k.sinceDamage = 0;
    k.invulnerable = 0.5;
    this.floaters.push({ x: k.x, y: k.y, z: k.z + 1.5, text: String(dmg), color: "#ff6b6b", age: 0 });
    this.knock(k, fx, fy, knockback);
    if (k.health <= 0) {
      this.knockOut();
    } else if (!k.attack) {
      k.hurtTime = 0.35;
      k.charge = null;
      this.overlay(k, "character/pc/hurt_soft.dat");
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
    this.play(k, "character/pc/dead.dat", { loop: false, blend: 0.1 });
  }

  revive() {
    const k = this.knight;
    k.dead = false;
    this.defeated = false;
    k.health = k.maxHealth;
    k.invulnerable = 2;
    this.play(k, "character/pc/idle.dat");
  }

  // ---------------------------------------------------------------- monsters

  /** Spawns a monster from a spawn table (or an actor reference) at a point, through the logic. */
  spawnAt(table: any, x: number, y: number, heading = 0) {
    const ref = table?.name?.startsWith("Character/") ? table : this.data.spawnActorSync(table, this.tier());
    if (ref) this.logic.spawn(ref, x, y, heading, this.knightEntity, this.knightEntity);
  }

  /** Loads a monster's definition and model for a logic actor that has been spawned. */
  private async spawnMonster(ref: any, e: Entity) {
    const def = await this.data.monster(ref);
    if (!def || e.destroyed) return;
    const model = await this.loader.loadRef(def.model);
    if (!model || e.destroyed) return;
    await Promise.all([this.preload(def.idle, def.move, def.activation), this.preloadAttacks(def.attacks)]);
    if (e.destroyed) return;
    // health is a percentage of the depth-scaled health table
    const ctx = this.ctx(0);
    const base = def.healthScale ? this.data.depth.evaluate(def.healthScale, ctx) : 100;
    const m = new Monster(await this.renderer.instantiate(model), def, Math.max(1, Math.round((def.health / 100) * (base || 100))));
    m.defense = def.defense ? this.data.depth.defense(def.defense, ctx) : null;
    // the spawn point may sit in a wall or pit; move to the nearest free spot
    const spot = this.collision.collides(e.x, e.y, def.radius, MONSTER_MASK) ? this.collision.findSpawn(e.x, e.y, def.radius, MONSTER_MASK) : null;
    m.x = m.homeX = spot?.[0] ?? e.x; m.y = m.homeY = spot?.[1] ?? e.y;
    m.z = this.collision.groundZ(m.x, m.y);
    m.heading = e.rotation;
    m.entity = e;
    if (def.creationFx) this.spawnEffect(def.creationFx, m.matrix(), 2);
    e.game = m;
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
    m.instance.time += dt;
    m.stateTime += dt;
    m.cooldown -= dt;
    if (m.state === "dying") return;
    this.applyKnockback(m, dt, MONSTER_MASK);
    this.applyLunge(m, dt, MONSTER_MASK);
    if (this.tickStatuses(m, dt)) return;
    if (m.reacting > 0) { m.reacting -= dt; return; }
    if (m.passive) { if (m.state !== "spawning") this.play(m, m.def.idle); m.state = m.state === "spawning" && m.stateTime < 1.2 ? m.state : "idle"; return; }
    const k = this.knight;
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
      this.advanceAttack(m, dt);
      if (!m.attack) m.state = "chase";
      return;
    }
    if (k.dead) { m.state = "idle"; this.play(m, m.def.idle); return; }

    if (m.state === "idle") {
      if (dist < AGGRO_RANGE) m.state = "chase";
      else { this.play(m, m.def.idle); return; }
    }
    if (dist > LEASH_RANGE) { m.state = "idle"; return; }

    const want = Math.atan2(dy, dx);
    m.turnToward(want, turn, dt);
    const facing = Math.abs(Math.atan2(Math.sin(want - m.heading), Math.cos(want - m.heading)));
    const gap = dist - k.radius - m.radius;
    const melee = m.def.attacks.filter(a => a.shape), ranged = m.def.attacks.filter(a => !a.shape);
    const usable = m.def.attacks.filter(a => gap <= this.reach(a));
    // prefer a melee attack in reach, then a ranged one
    const attack = usable.find(a => a.shape) ?? usable[0] ?? null;
    if (attack && m.cooldown <= 0 && facing < (turn < 6 ? 0.25 : 0.6)) {
      if (turn >= 6) m.heading = want;
      m.state = "attack";
      this.startAttack(m, attack);
      m.cooldown = attack.rearm / 1000 + (attack.shape ? 0.6 : 0.9) + Math.random() * 0.8;
      return;
    }
    const sp = m.def.targetedSpeed * this.statusSpeed(m);
    if (sp <= 0) { this.play(m, m.def.idle); return; }
    // ranged-only monsters hold a middle distance; others close to melee range
    const keep = !melee.length && ranged.length ? Math.min(...ranged.map(a => this.reach(a))) * 0.6 : (melee.length ? this.reach(melee[0]) * 0.7 : 1);
    let mx = 0, my = 0;
    if (gap > keep) {
      // straight at the knight when the way is clear, else along an A* path around walls
      m.pathAge -= dt;
      if (this.collision.clearLine(m.x, m.y, k.x, k.y, m.radius * 0.8, MONSTER_MASK)) m.path = null;
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
      this.move(m, mx * sp * dt, my * sp * dt, MONSTER_MASK);
      this.play(m, m.def.move ?? m.def.idle, { speed: sp / Math.max(0.5, m.def.moveSpeed) });
    } else {
      this.play(m, m.def.idle);
    }
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
    // scripted models (alone or inside compounds) have no geometry: they run their timed
    // actions, then end (looping ones live as long as the effect)
    const startScripts = (m: LoadedModel, local: Mat4, depth: number) => {
      if (depth > 6) return;
      if (m.script) {
        const sc = m.script;
        const end = sc.actions.length ? sc.actions[sc.actions.length - 1].time : 0;
        this.effects.push({ instance: null, matrix: multiply(matrix, local), life: sc.loopDuration > 0 ? life : end + 0.1, follow,
          script: { actions: sc.actions, loop: sc.loopDuration, t: 0, next: 0 } });
      }
      for (const a of m.attachments) {
        const t = a.transform;
        startScripts(a.model, multiply(local, t.matrix ?? compose(t.t, t.r, t.s)), depth + 1);
      }
    };
    startScripts(model, compose([0, 0, 0], [0, 0, 0, 1], 1), 0);
    if (model.script) return;
    const instance = await this.renderer.instantiate(model);
    this.effects.push({ instance, matrix, life, follow });
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
      case "ShakeCamera": {
        const d = Math.hypot(matrix[12] - this.knight.x, matrix[13] - this.knight.y);
        this.shake = Math.max(this.shake, (action.amplitude ?? 0.3) / (1 + d * 0.3));
        break;
      }
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
        // shrink away while the death effect plays
        const s = Math.max(0.01, 1 - m.stateTime / 0.5);
        matrix = compose([m.x, m.y, m.z], [0, 0, Math.sin((m.heading + Math.PI / 2) / 2), Math.cos((m.heading + Math.PI / 2) / 2)], m.scale * s);
      }
      out.push({ instance: m.instance, matrix });
    }
    for (const p of this.props) if (p.instance) out.push({ instance: p.instance, matrix: p.matrix() });
    for (const p of this.projectiles) if (p.instance && !p.done) out.push({ instance: p.instance, matrix: p.matrix() });
    for (const e of this.effects) if (e.instance) out.push({ instance: e.instance, matrix: e.follow ? e.follow.matrix() : e.matrix });
    return out;
  }

  /** Round shadows under the knight and monsters: position on the ground and radius. */
  shadows(): { x: number; y: number; z: number; r: number }[] {
    const out = [{ x: this.knight.x, y: this.knight.y, z: this.collision.groundZ(this.knight.x, this.knight.y), r: 0.75 }];
    for (const m of this.monsters) if (m.state !== "dying") out.push({ x: m.x, y: m.y, z: this.collision.groundZ(m.x, m.y), r: m.radius * m.scale * 1.7 });
    return out;
  }

  /** Living monsters, for health bars. */
  get liveMonsters() { return this.monsters.filter(m => m.state !== "dying" && m.state !== "spawning" && !m.passive); }
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
