// The game world for play mode: a knight with a loadout of weapons, monsters spawned from the
// scene's spawn markers when the knight walks into their trigger areas, blocks and
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
  attack: { def: AttackDef; phase: Phase; t: number; hit: boolean; lunged: boolean; overlay: boolean } | null = null;
  /** Lunge from an attack's impulse: velocity and remaining seconds. */
  lunge = { vx: 0, vy: 0, t: 0 };
  /** Nodes animated by the upper-body overlay (knights); null plays attacks whole-body. */
  upperBody: Set<string> | null = null;
  defense: Amounts | null = null;
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
  /** Health lost recently, shown on the HUD as a damage segment that drains away. */
  recentDamage = 0;
  sinceDamage = 1e9;
  get weapon(): WeaponDef | null { return this.weapons[this.slot]?.def ?? null; }
  get attacks(): AttackDef[] { return this.weapon?.attacks ?? []; }
}

export class Monster extends Actor {
  readonly team = "monster";
  radius: number;
  state: "spawning" | "idle" | "chase" | "attack" | "dying" = "spawning";
  stateTime = 0;
  cooldown = 1;
  homeX = 0; homeY = 0;
  constructor(instance: ModelInstance, readonly def: MonsterDef, health: number) {
    super(instance, def.scale);
    this.radius = def.radius;
    this.health = this.maxHealth = health;
  }
}

class Block {
  constructor(readonly id: number, readonly instance: ModelInstance, readonly x: number, readonly y: number,
    readonly z: number, readonly heading: number, public health: number, readonly breakable: boolean, readonly deathFx?: any) {}
  matrix(): Mat4 {
    return compose([this.x, this.y, this.z], [0, 0, Math.sin(this.heading / 2), Math.cos(this.heading / 2)], 1);
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
}

export class World {
  knight!: Knight;
  readonly monsters: Monster[] = [];
  readonly blocks: Block[] = [];
  readonly effects: Effect[] = [];
  readonly projectiles: Projectile[] = [];
  readonly floaters: Floater[] = [];
  readonly data: GameData;
  private readonly clips = new Map<string, Promise<AnimationClip | null>>();
  private readonly ready = new Map<string, AnimationClip | null>();
  private readonly firedTriggers = new Set<number>();
  private readonly activatedTags = new Set<string>();
  private readonly spawned = new Set<number>();
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
  }

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
  private async knightInstance(weapon: WeaponDef | null, shield: ShieldDef | null) {
    const args: [string, any][] = [];
    if (weapon) args.push(["Weapon", weapon.model]);
    if (shield) args.push(["Shield", shield.model]);
    const ref: any = { $class: "com.threerings.config.ConfigReference", name: "character/pc/model.dat",
      arguments: { $map: "com.threerings.config.ArgumentMap", entries: args } };
    return this.renderer.instantiate(await this.loader.load("character/pc/model.dat", ref));
  }

  async start(at: [number, number], weaponNames = STARTER_WEAPONS) {
    await this.data.depth.ready();
    const shield = await this.data.shield(STARTER_SHIELD);
    const weapons = (await Promise.all(weaponNames.map(n => this.data.weapon(n)))).filter((w): w is WeaponDef => !!w);
    const loadouts: Loadout[] = await Promise.all(weapons.map(async def => ({ def, instance: await this.knightInstance(def, shield) })));
    const knight = new Knight(loadouts[0]?.instance ?? await this.knightInstance(null, shield));
    knight.weapons = loadouts;
    knight.shield = shield;
    knight.armor = (await Promise.all(STARTER_ARMOR.map(n => this.data.armor(n)))).filter((a): a is ArmorDef => !!a);
    this.updateKnightStats(knight);
    knight.health = knight.maxHealth;
    // the upper body: spine and everything above it (arms, head, weapon and shield bones)
    knight.upperBody = knight.instance.subtree("Bip01 Spine");
    [knight.x, knight.y] = at;
    knight.z = this.collision.groundZ(at[0], at[1]);
    this.knight = knight;
    await Promise.all([
      this.preload("character/pc/idle.dat", "character/pc/run_forward.dat", "character/pc/hurt_soft.dat",
        "character/pc/dead.dat", "character/pc/blend_shield.dat", "character/pc/shield_hit.dat", ...Object.values(CHARGE_ANIMS)),
      ...weapons.map(w => this.preloadAttacks([...w.attacks, w.chargedAttack, w.incompleteChargedAttack, w.cooldownAttack])),
    ]);
    this.play(knight, "character/pc/idle.dat");
    await this.spawnStartupActors();
  }

  /** Depth-scaled defence and shield health from the knight's gear. */
  private updateKnightStats(k: Knight) {
    const d = zeroAmounts();
    for (const a of k.armor) if (a.defense) this.data.depth.defense(a.defense, this.ctx(a.rarity), d);
    k.defense = d;
    k.maxHealth = KNIGHT_HEALTH;
    if (k.shield) {
      const sctx = this.ctx(k.shield.rarity);
      k.shieldMax = Math.max(1, this.data.depth.evaluate(k.shield.healthScale, sctx) || 50);
      k.shieldHealth = Math.min(k.shieldHealth, k.shieldMax);
      if (k.shieldHealth <= 1) k.shieldHealth = k.shieldMax;
      k.shieldDefense = k.shield.defense ? this.data.depth.defense(k.shield.defense, sctx) : null;
    }
  }

  private async spawnStartupActors() {
    for (const s of this.scene.startupActors) {
      const def = await this.data.resolve("config/actor.dat", s.actor, "actor").catch(() => null);
      const modelRef = def?.sprite?.model;
      if (!modelRef) continue;
      // doors need trigger logic; keep them open and out of the way for now
      if (String(s.actor.name).startsWith("Door/")) continue;
      const model = await this.loader.loadRef(modelRef);
      if (!model) continue;
      const id = this.nextId++;
      const z = this.collision.groundZ(s.x, s.y);
      const breakable = (def.health ?? 0) > 0 && !/Unbreakable/i.test(s.actor.name);
      const block = new Block(id, await this.renderer.instantiate(model), s.x, s.y, z, s.heading, def.health ?? 100, breakable,
        def.sprite?.destructionTransient);
      this.blocks.push(block);
      const w = (s.shape?.width ?? 1) / 2, h = (s.shape?.height ?? s.shape?.width ?? 1) / 2;
      if ((def.collisionFlags ?? 1) !== 0) this.collision.addBox(id, s.x, s.y, w, h, 1);
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
    this.checkTriggers();
    for (const m of this.monsters) this.updateMonster(m, dt);
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
    if (k.dead) { k.instance.overlay = null; this.setShieldEffect(false); return; }
    this.applyKnockback(k, dt, KNIGHT_MASK);
    if (input.weaponSlot != null) this.switchWeapon(input.weaponSlot);

    const weapon = k.weapon;
    const aimAngle = this.autoAim(input.aim ? Math.atan2(input.aim[1] - k.y, input.aim[0] - k.x) : k.heading);
    // a gun's partly used clip restores after a pause
    if (weapon && weapon.chainCooldown > 0 && !k.attack && k.chainUsed > 0 && k.sinceAttack * 1000 > weapon.chainCooldown + 300) k.chainUsed = 0;

    // shield: only when not attacking or charging
    k.shielding = input.shield && !k.attack && k.charge === null && !!k.shield;
    this.setShieldEffect(k.shielding);

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
        const full = k.charge * 1000 >= (weapon?.chargeTime ?? 2000);
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
    let factor = k.charge !== null ? 0.5 : k.shielding ? 1 + (k.shield?.defendingSpeed ?? -0.5) : 1;
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
      this.play(k, "character/pc/run_forward.dat", { speed: Math.max(0.5, factor) });
    } else {
      if (k.shielding) k.turnToward(aimAngle, 12, dt);
      if (k.hurtTime <= 0) this.play(k, "character/pc/idle.dat");
    }

    // upper body: shield pose when defending, nothing otherwise
    if (!k.attack && k.charge === null) {
      if (k.shielding) this.overlay(k, "character/pc/blend_shield.dat", true);
      else if (k.instance.overlay && k.hurtTime <= 0) k.instance.overlay = null;
    }
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
  private animate(a: Actor, path: string | any, speed: number) {
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

  /** The attacker's depth context: weapons use their star rating. */
  private attackerCtx(a: Actor) {
    return a === this.knight ? this.ctx(this.knight.weapon?.rarity ?? 0) : this.ctx(0);
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
      for (const b of [...this.blocks]) {
        if (b.breakable && hits(b.x, b.y, 0.45)) this.damageBlock(b, dealt(amounts, null));
      }
    } else if (!this.knight.dead && hits(this.knight.x, this.knight.y, this.knight.radius)) {
      this.damageKnight(amounts, def.knockback, a.x, a.y);
    }
  }

  /** A DamageConfig as amounts per type; attacks without one deal a small normal hit. */
  private amounts(damage: any, ctx: DepthContext): Amounts {
    const a = damage ? this.data.depth.damage(damage, ctx) : zeroAmounts();
    if (a.NORMAL + a.PIERCING + a.ELEMENTAL + a.SHADOW <= 0) a.NORMAL = 10;
    return a;
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
      if (this.monsters.some(m => m.state !== "dying" && m.state !== "spawning" && Math.hypot(m.x - p.x, m.y - p.y) < m.radius + r)) return true;
      return this.blocks.some(b => b.breakable && Math.hypot(b.x - p.x, b.y - p.y) < 0.5 + r);
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
      for (const b of [...this.blocks]) if (b.breakable && Math.hypot(b.x - p.x, b.y - p.y) <= r + 0.5) this.damageBlock(b, dealt(amounts, null));
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
    const dmg = Math.max(1, Math.round(dealt(amounts, m.defense) * (0.95 + Math.random() * 0.1)));
    m.health -= dmg;
    this.floaters.push({ x: m.x, y: m.y, z: m.z + 1.2, text: String(dmg), color: TYPE_COLORS[mainType(amounts)], age: 0 });
    this.knock(m, fx, fy, knockback);
    if (m.def.hitFx) this.spawnEffect(m.def.hitFx, compose([m.x, m.y, m.z + 0.5], [0, 0, 0, 1], 1), 0.8);
    if (m.health <= 0) {
      m.state = "dying";
      m.stateTime = 0;
      m.attack = null;
      this.killCount++;
      if (m.def.deathFx) this.spawnEffect(m.def.deathFx, compose([m.x, m.y, m.z], [0, 0, 0, 1], m.scale), 2);
    } else if (m.state === "idle") {
      m.state = "chase";
    }
  }

  private damageBlock(b: Block, amount: number) {
    b.health -= amount;
    if (b.health > 0) return;
    this.collision.remove(b.id);
    this.blocks.splice(this.blocks.indexOf(b), 1);
    const fx = b.deathFx?.name ? b.deathFx : undefined;
    if (fx) this.spawnEffect(fx, b.matrix(), 2);
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
    const dmg = Math.max(1, Math.round(dealt(amounts, k.defense) * (0.95 + Math.random() * 0.1)));
    const before = k.health;
    k.health = Math.max(0, k.health - dmg);
    k.recentDamage += before - k.health;
    k.sinceDamage = 0;
    k.invulnerable = 0.5;
    this.floaters.push({ x: k.x, y: k.y, z: k.z + 1.5, text: String(dmg), color: "#ff6b6b", age: 0 });
    this.knock(k, fx, fy, knockback);
    if (k.health <= 0) {
      k.dead = true;
      k.attack = null;
      k.charge = null;
      this.defeated = true;
      this.play(k, "character/pc/dead.dat", { loop: false, blend: 0.1 });
    } else if (!k.attack) {
      k.hurtTime = 0.35;
      k.charge = null;
      this.overlay(k, "character/pc/hurt_soft.dat");
    }
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

  private checkTriggers() {
    const k = this.knight;
    this.scene.triggers.forEach((t, i) => {
      if (this.firedTriggers.has(i) || !pointInPoly(k.x, k.y, t.poly)) return;
      this.firedTriggers.add(i);
      for (const tag of t.tags) this.activate(tag);
    });
    // spawn points no trigger refers to wake when the knight comes near
    this.scene.spawns.forEach((s, i) => {
      if (this.spawned.has(i)) return;
      const tagged = this.scene.triggers.some(t => t.tags.includes(s.tag));
      if (!tagged && Math.hypot(s.x - k.x, s.y - k.y) < AGGRO_RANGE) { this.spawned.add(i); this.spawnAt(s.table, s.x, s.y, s.heading); }
    });
  }

  private activate(tag: string) {
    if (this.activatedTags.has(tag)) return;
    this.activatedTags.add(tag);
    this.scene.spawns.forEach((s, i) => {
      if (s.tag !== tag || this.spawned.has(i)) return;
      this.spawned.add(i);
      this.spawnAt(s.table, s.x, s.y, s.heading);
    });
  }

  /** Spawns a monster from a spawn table (or an actor reference) at a point. */
  async spawnAt(table: any, x: number, y: number, heading = 0) {
    const actorRef = table?.name?.startsWith("Character/") ? table : await this.data.spawnActor(table);
    if (!actorRef) return;
    const def = await this.data.monster(actorRef);
    if (!def) return;
    const model = await this.loader.loadRef(def.model);
    if (!model) return;
    await Promise.all([this.preload(def.idle, def.move, def.activation), this.preloadAttacks(def.attacks)]);
    // health is a percentage of the depth-scaled health table
    const ctx = this.ctx(0);
    const base = def.healthScale ? this.data.depth.evaluate(def.healthScale, ctx) : 100;
    const m = new Monster(await this.renderer.instantiate(model), def, Math.max(1, Math.round((def.health / 100) * (base || 100))));
    m.defense = def.defense ? this.data.depth.defense(def.defense, ctx) : null;
    m.x = m.homeX = x; m.y = m.homeY = y;
    m.z = this.collision.groundZ(x, y);
    m.heading = heading;
    this.play(m, def.activation ?? def.idle, { loop: !def.activation });
    this.monsters.push(m);
  }

  /** How far an attack reaches: its hit shape, or for a projectile its travel distance. */
  private reach(a: AttackDef): number {
    if (a.shape) return a.shape.forward + Math.max(a.shape.halfLength, a.shape.radius) * 0.8;
    return 6;
  }

  private updateMonster(m: Monster, dt: number) {
    m.instance.time += dt;
    m.stateTime += dt;
    m.cooldown -= dt;
    if (m.state === "dying") return;
    this.applyKnockback(m, dt, MONSTER_MASK);
    this.applyLunge(m, dt, MONSTER_MASK);
    const k = this.knight;
    const dx = k.x - m.x, dy = k.y - m.y, dist = Math.hypot(dx, dy);
    const turn = (m.def.turnRate * Math.PI) / 180;

    if (m.state === "spawning") {
      if (m.instance.finished || m.stateTime > 1.2) { m.state = "idle"; this.play(m, m.def.idle); }
      return;
    }
    if (m.attack) {
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

    // the attack to use: a melee attack in reach, else a ranged one, else the first
    const inReach = m.def.attacks.filter(a => dist - k.radius <= this.reach(a));
    const attack = inReach.find(a => a.shape) ?? inReach[0] ?? m.def.attacks.find(a => a.shape) ?? m.def.attacks[0];
    const reach = attack ? this.reach(attack) : 1;
    const want = Math.atan2(dy, dx);
    m.turnToward(want, turn, dt);
    if (attack && dist - k.radius <= reach && m.cooldown <= 0) {
      m.heading = want;
      m.state = "attack";
      this.startAttack(m, attack);
      m.cooldown = attack.rearm / 1000 + 0.8 + Math.random();
      return;
    }
    if (dist - k.radius > reach * 0.8) {
      const sp = m.def.targetedSpeed;
      this.move(m, (dx / dist) * sp * dt, (dy / dist) * sp * dt, MONSTER_MASK);
      this.play(m, m.def.move ?? m.def.idle, { speed: sp / Math.max(0.5, m.def.moveSpeed) });
    } else {
      this.play(m, m.def.idle);
    }
  }

  /** Keeps actors from overlapping each other. */
  private separate() {
    const actors: Actor[] = [this.knight, ...this.monsters.filter(m => m.state !== "dying")];
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
    for (const b of this.blocks) out.push({ instance: b.instance, matrix: b.matrix() });
    for (const p of this.projectiles) if (p.instance && !p.done) out.push({ instance: p.instance, matrix: p.matrix() });
    for (const e of this.effects) if (e.instance) out.push({ instance: e.instance, matrix: e.follow ? e.follow.matrix() : e.matrix });
    return out;
  }

  /** Living monsters, for health bars. */
  get liveMonsters() { return this.monsters.filter(m => m.state !== "dying" && m.state !== "spawning"); }
}

/** Cache key for an animation path or reference (arguments included). */
function clipKey(p: string | any): string {
  return typeof p === "string" ? p : p.name + JSON.stringify(p.arguments?.entries ?? [], (k, v) => (k === "$outer" ? undefined : v));
}

function pointInPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export type { LoadedModel, Vec3 };
