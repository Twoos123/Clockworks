// The game world for play mode: a knight with a weapon, monsters spawned from the scene's
// spawn markers when the knight walks into their trigger areas, blocks and breakables from
// startup markers, melee combat with the attack data from the install, and transient effects.

import { compose, type Mat4, type Vec3 } from "../math";
import { loadAnimation, type AnimationClip, type LoadedModel, type ModelLoader } from "../model";
import type { ModelInstance, Renderer } from "../render/renderer";
import type { LoadedScene } from "../scene";
import type { CollisionMap } from "./collision";
import { GameData, type AttackDef, type MonsterDef, type ShieldDef, type WeaponDef } from "./data";

// Character/PC/Default: speed 5, circle radius 1/3, collision mask 43
const KNIGHT_SPEED = 5, KNIGHT_RADIUS = 1 / 3, KNIGHT_MASK = 43, KNIGHT_HEALTH = 200;
const MONSTER_MASK = 1 | 2 | 8 | 32;
const AGGRO_RANGE = 10, LEASH_RANGE = 18;
const STARTER_WEAPON = "Weapon/Sword/Proto Sword";
const STARTER_SHIELD = "Gear/Shield/Proto Shield";
/** Shield health; a tuning value (the game scales it by depth and star rating). */
const SHIELD_HEALTH = 100;
/**
 * Assumed lunge for knight swings whose AttackConfig omits impulseReceived (the class default
 * lives in game code, not data); the data's explicit combo lunges are 1.25 to 2.5 units.
 */
const DEFAULT_SWING_IMPULSE = { forward: 1, side: 0, delay: 0, duration: 150 };

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
}

export interface Floater { x: number; y: number; z: number; text: string; color: string; age: number }

type Phase = "start" | "fire" | "end";

abstract class Actor {
  x = 0; y = 0; z = 0;
  heading = -Math.PI / 2;
  health = 1; maxHealth = 1;
  dead = false;
  /** Knockback velocity, decaying. */
  kx = 0; ky = 0;
  attack: { def: AttackDef; phase: Phase; t: number; hit: boolean; lunged: boolean } | null = null;
  /** Lunge from an attack's impulse: velocity and remaining seconds. */
  lunge = { vx: 0, vy: 0, t: 0 };
  /** Nodes animated by the upper-body overlay (knights); null plays attacks whole-body. */
  upperBody: Set<string> | null = null;
  abstract radius: number;
  constructor(readonly instance: ModelInstance, readonly scale = 1) {}

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

export class Knight extends Actor {
  radius = KNIGHT_RADIUS;
  chain = 0;
  buffered = false;
  invulnerable = 0;
  hurtTime = 0;
  sinceAttack = 0;
  /** Seconds until a new combo may start (the finished attack's rearm time). */
  rearm = 0;
  attacks: AttackDef[] = [];
  weapon: WeaponDef | null = null;
  shield: ShieldDef | null = null;
  /** Seconds the attack button has been held for a charge, or null when not charging. */
  charge: number | null = null;
  shielding = false;
  /**
   * Shield health. Its maximum comes from a depth-scaled table in the game data, so this is
   * a tuning value, not the game's own number.
   */
  shieldHealth = SHIELD_HEALTH;
  shieldMax = SHIELD_HEALTH;
  /** Seconds since the shield last took a hit. */
  sinceShieldHit = 1e9;
  /** Seconds left while the shield is broken. */
  shieldBroken = 0;
  /** Health lost recently, shown on the HUD as a damage segment that drains away. */
  recentDamage = 0;
  sinceDamage = 1e9;
}

export class Monster extends Actor {
  radius: number;
  state: "spawning" | "idle" | "chase" | "attack" | "dying" = "spawning";
  stateTime = 0;
  cooldown = 1;
  homeX = 0; homeY = 0;
  constructor(instance: ModelInstance, readonly def: MonsterDef) {
    super(instance, def.scale);
    this.radius = def.radius;
    this.health = this.maxHealth = def.health;
  }
}

class Block {
  constructor(readonly id: number, readonly instance: ModelInstance, readonly x: number, readonly y: number,
    readonly z: number, readonly heading: number, public health: number, readonly breakable: boolean, readonly deathFx?: any) {}
  matrix(): Mat4 {
    return compose([this.x, this.y, this.z], [0, 0, Math.sin(this.heading / 2), Math.cos(this.heading / 2)], 1);
  }
}

interface Effect { instance: ModelInstance; matrix: Mat4; life: number; follow?: Actor }

export class World {
  knight!: Knight;
  readonly monsters: Monster[] = [];
  readonly blocks: Block[] = [];
  readonly effects: Effect[] = [];
  readonly floaters: Floater[] = [];
  readonly data: GameData;
  private readonly clips = new Map<string, Promise<AnimationClip | null>>();
  private readonly ready = new Map<string, AnimationClip | null>();
  private readonly firedTriggers = new Set<number>();
  private readonly activatedTags = new Set<string>();
  private readonly spawned = new Set<number>();
  private nextId = 1;
  killCount = 0;
  defeated = false;

  constructor(private readonly loader: ModelLoader, private readonly renderer: Renderer,
    private readonly scene: LoadedScene, private readonly collision: CollisionMap) {
    this.data = new GameData(loader);
  }

  // ---------------------------------------------------------------- setup

  /** Loads (and caches) an animation clip; returns it synchronously once ready. */
  clip(path?: string): AnimationClip | null {
    if (!path) return null;
    if (!this.clips.has(path)) {
      this.clips.set(path, loadAnimation(this.loader, path).catch(() => null).then(c => { this.ready.set(path, c); return c; }));
    }
    return this.ready.get(path) ?? null;
  }

  private async preload(...paths: (string | undefined)[]) {
    await Promise.all(paths.filter(Boolean).map(p => { this.clip(p); return this.clips.get(p!); }));
  }

  async start(at: [number, number]) {
    const weapon = await this.data.weapon(STARTER_WEAPON);
    const shield = await this.data.shield(STARTER_SHIELD);
    // the knight body takes its gear through parameters: "Weapon" (attachment at bone_weapon_r)
    // and "Shield" (attachment at bone_shield, with quality variants)
    const args: [string, any][] = [];
    if (weapon) args.push(["Weapon", weapon.model]);
    if (shield) args.push(["Shield", shield.model]);
    const ref: any = { $class: "com.threerings.config.ConfigReference", name: "character/pc/model.dat",
      arguments: { $map: "com.threerings.config.ArgumentMap", entries: args } };
    const model = await this.loader.load("character/pc/model.dat", ref);
    const knight = new Knight(await this.renderer.instantiate(model));
    knight.attacks = weapon?.attacks ?? [];
    knight.weapon = weapon;
    knight.shield = shield;
    // the upper body: spine and everything above it (arms, head, weapon and shield bones)
    knight.upperBody = knight.instance.subtree("Bip01 Spine");
    knight.health = knight.maxHealth = KNIGHT_HEALTH;
    [knight.x, knight.y] = at;
    knight.z = this.collision.groundZ(at[0], at[1]);
    this.knight = knight;
    await this.preload("character/pc/idle.dat", "character/pc/run_forward.dat", "character/pc/hurt_soft.dat",
      "character/pc/dead.dat", "character/pc/charge_sword_hold.dat", "character/pc/blend_shield.dat",
      "character/pc/shield_hit.dat",
      ...[...knight.attacks, ...(weapon?.chargedAttack ? [weapon.chargedAttack] : [])].flatMap(a => [a.start, a.fire, a.end]));
    this.play(knight, "character/pc/idle.dat");
    await this.spawnStartupActors();
  }

  private async spawnStartupActors() {
    for (const s of this.scene.startupActors) {
      const def = await this.data.resolve("config/actor.dat", s.actor, "actor").catch(() => null);
      const modelRef = def?.sprite?.model;
      if (!modelRef) continue;
      // doors need trigger logic (phase D); keep them open and out of the way for now
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

  // ---------------------------------------------------------------- animation helpers

  private play(a: Actor, path: string | undefined, opts: { loop?: boolean; speed?: number; blend?: number } = {}) {
    const c = this.clip(path);
    if (c) a.instance.play(c, opts);
  }

  // ---------------------------------------------------------------- update

  update(dt: number, input: KnightInput) {
    this.updateKnight(dt, input);
    this.checkTriggers();
    for (const m of this.monsters) this.updateMonster(m, dt);
    this.separate();
    for (const e of this.effects) e.life -= dt;
    for (let i = this.effects.length - 1; i >= 0; i--) if (this.effects[i].life <= 0) this.effects.splice(i, 1);
    for (const f of this.floaters) f.age += dt;
    for (let i = this.floaters.length - 1; i >= 0; i--) if (this.floaters[i].age > 1.2) this.floaters.splice(i, 1);
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      if (m.state === "dying" && m.stateTime > 0.6) this.monsters.splice(i, 1);
    }
  }

  private move(a: Actor, dx: number, dy: number, mask: number) {
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

  /**
   * Knight controls, after Spiral Knights: click to swing (clicks during a swing chain the
   * combo), keep holding after a swing to charge and release when full for the weapon's
   * charge attack, hold the shield button to defend. Attacks play on the upper body so the
   * knight keeps moving (slower) while swinging, and face the mouse while attacking.
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
    if (k.sinceDamage > 0.6) k.recentDamage = Math.max(0, k.recentDamage - dt * 120);
    k.rearm -= dt;
    if (k.dead) { k.instance.overlay = null; this.setShieldEffect(false); return; }
    this.applyKnockback(k, dt, KNIGHT_MASK);

    const aimAngle = input.aim ? Math.atan2(input.aim[1] - k.y, input.aim[0] - k.x) : k.heading;
    const weapon = k.weapon;

    // shield: only when not swinging or charging
    k.shielding = input.shield && !k.attack && k.charge === null && !!k.shield;
    this.setShieldEffect(k.shielding);

    // attack input
    if (input.attackDown && !k.shielding) {
      if (!k.attack && k.charge === null && k.rearm <= 0) this.knightSwing(0, aimAngle);
      else if (k.attack) k.buffered = true;
    }

    this.applyLunge(k, dt, KNIGHT_MASK);
    if (k.attack) {
      this.advanceAttack(k, dt, () => {
        if (k.buffered && k.chain + 1 < k.attacks.length) { this.knightSwing(k.chain + 1, aimAngle); return true; }
        return false;
      });
      // holding the button through the follow-through starts a charge instead of idling
      if (!k.attack && input.attackHeld && weapon?.chargedAttack && !k.buffered) k.charge = 0;
    } else if (k.charge !== null) {
      k.turnToward(aimAngle, 18, dt);
      if (input.attackHeld) {
        k.charge += dt;
        this.overlay(k, "character/pc/charge_sword_hold.dat", true);
      } else {
        const full = k.charge * 1000 >= (weapon?.chargeTime ?? 2000);
        k.charge = null;
        if (full && weapon?.chargedAttack) {
          const def = weapon.chargedAttack;
          // the charge is a burst around the knight; its damage args are depth-scaled
          this.startAttack(k, { ...def, damage: Math.max(def.damage, 80),
            shape: { forward: 0.6, side: 0, halfLength: 0, halfWidth: 0, radius: 2.2 }, knockback: 1.2 });
        } else {
          k.instance.overlay = null;
        }
      }
    }

    // no walking during a swing: the swing's own lunge moves the knight. After the clear
    // window (or any time in an interruptable follow-through) moving cancels the swing.
    const [mx, my] = input.move;
    const len = Math.hypot(mx, my);
    if (k.attack) {
      const at = k.attack;
      const canCancel = at.phase === "end" && (at.def.interruptable || at.t * 1000 >= at.def.clear);
      if (!(canCancel && len > 0.01)) return;
      k.attack = null;
      k.chain = 0;
    }
    const factor = k.charge !== null ? 0.5 : k.shielding ? 1 + (k.shield?.defendingSpeed ?? -0.5) : 1;
    if (len > 0.01) {
      this.move(k, (mx / len) * KNIGHT_SPEED * factor * dt, (my / len) * KNIGHT_SPEED * factor * dt, KNIGHT_MASK);
      if (k.charge === null && !k.shielding) k.turnToward(Math.atan2(my, mx), 16, dt);
      else if (k.shielding) k.turnToward(aimAngle, 12, dt);
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

  private knightSwing(index: number, aimAngle: number) {
    const k = this.knight;
    if (!k.attacks.length) return;
    k.chain = index;
    k.buffered = false;
    k.heading = aimAngle;
    k.sinceAttack = 0;
    this.startAttack(k, k.attacks[index]);
  }

  /** Plays a clip on the knight's upper body. */
  private overlay(a: Actor, path: string | undefined, loop = false, speed = 1) {
    const c = this.clip(path);
    if (c && a.upperBody) a.instance.playOverlay(c, a.upperBody, { loop, speed });
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

  private startAttack(a: Actor, def: AttackDef) {
    a.attack = { def, phase: "start", t: 0, hit: false, lunged: false };
    if (def.start) this.animate(a, def.start, def.startSpeed);
    else this.enterFire(a);
  }

  /** One-shot whole-body attack animation (the knight steps into its swings). */
  private animate(a: Actor, path: string, speed: number) {
    a.instance.overlay = null;
    this.play(a, path, { loop: false, speed, blend: 0.06 });
  }

  private animDone(a: Actor) {
    return a.instance.finished;
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
   * Steps an attacker through start, fire (damage after `delay`) and end. `chain` may start
   * the next attack in a combo when the fire phase completes or during the clear window.
   */
  private advanceAttack(a: Actor, dt: number, chain?: () => boolean) {
    const at = a.attack!;
    at.t += dt;
    if (at.phase === "start" && (this.animDone(a) || !at.def.start || at.t > 1.5)) this.enterFire(a);
    else if (at.phase === "fire") {
      // the attack's impulse carries the attacker forward (each combo swing is a lunge);
      // knight swings whose config omits it take a short default step
      const imp = at.def.impulse ?? (a === this.knight ? DEFAULT_SWING_IMPULSE : null);
      if (imp && !at.lunged && at.t * 1000 >= imp.delay) {
        at.lunged = true;
        const dur = Math.max(0.05, imp.duration / 1000), c = Math.cos(a.heading), sn = Math.sin(a.heading);
        a.lunge = { vx: (imp.forward * c - imp.side * sn) / dur, vy: (imp.forward * sn + imp.side * c) / dur, t: dur };
      }
      if (!at.hit && at.t * 1000 >= at.def.delay) { at.hit = true; this.resolveHit(a, at.def); }
      if (this.animDone(a) || !at.def.fire || at.t > 1.5) {
        if (chain?.()) return;
        at.phase = "end";
        at.t = 0;
        if (at.def.end) this.animate(a, at.def.end, at.def.endSpeed);
      }
    } else if (at.phase === "end") {
      if (chain && at.t * 1000 < at.def.clear && chain()) return;
      if (this.animDone(a) || !at.def.end || at.t > 1.5) {
        a.attack = null;
        // rearm: the cooldown before a new attack (long after a combo's last swing)
        if (a === this.knight) { this.knight.chain = 0; this.knight.instance.overlay = null; this.knight.rearm = at.def.rearm / 1000; }
      }
    }
  }

  /** Applies an attack's damage shape in front of the attacker. */
  private resolveHit(a: Actor, def: AttackDef) {
    const c = Math.cos(a.heading), s = Math.sin(a.heading);
    const hits = (tx: number, ty: number, r: number) => {
      const dx = tx - a.x, dy = ty - a.y;
      const lx = dx * c + dy * s - def.shape.forward, ly = -dx * s + dy * c - def.shape.side;
      if (def.shape.halfWidth > 0) return Math.abs(lx) <= def.shape.halfLength + r && Math.abs(ly) <= def.shape.halfWidth + r;
      return Math.hypot(lx, ly) <= def.shape.radius + r;
    };
    if (a === this.knight) {
      for (const m of this.monsters) {
        if (m.state === "dying" || m.state === "spawning" || !hits(m.x, m.y, m.radius)) continue;
        this.damageMonster(m, def.damage, def.knockback, a);
      }
      for (const b of [...this.blocks]) {
        if (b.breakable && hits(b.x, b.y, 0.45)) this.damageBlock(b, def.damage);
      }
    } else if (!this.knight.dead && hits(this.knight.x, this.knight.y, this.knight.radius)) {
      this.damageKnight(def.damage, def.knockback, a);
    }
  }

  private knock(target: Actor, from: Actor, strength: number) {
    const d = Math.hypot(target.x - from.x, target.y - from.y) || 1;
    const v = 3 + strength * 6;
    target.kx = ((target.x - from.x) / d) * v;
    target.ky = ((target.y - from.y) / d) * v;
  }

  private damageMonster(m: Monster, amount: number, knockback: number, from: Actor) {
    const dmg = Math.max(1, Math.round(amount * (0.9 + Math.random() * 0.2)));
    m.health -= dmg;
    this.floaters.push({ x: m.x, y: m.y, z: m.z + 1.2, text: String(dmg), color: "#ffe066", age: 0 });
    this.knock(m, from, knockback);
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

  private damageKnight(amount: number, knockback: number, from: Actor) {
    const k = this.knight;
    if (k.invulnerable > 0 || k.dead) return;
    const dmg = Math.max(1, Math.round(amount * (0.9 + Math.random() * 0.2)));
    // a raised shield takes hits from every direction until it breaks
    if (k.shielding && k.shieldBroken <= 0 && k.shield) {
      k.shieldHealth -= dmg;
      k.sinceShieldHit = 0;
      this.knock(k, from, knockback * 0.3);
      k.invulnerable = 0.25;
      this.overlay(k, "character/pc/shield_hit.dat");
      if (k.shieldHealth > 0) return;
      k.shieldHealth = 0;
      k.shieldBroken = k.shield.breakTime / 1000;
      if (k.shield.breakEffect) this.spawnEffect(k.shield.breakEffect, k.matrix(), 1.5);
      return;
    }
    const before = k.health;
    k.health = Math.max(0, k.health - dmg);
    k.recentDamage += before - k.health;
    k.sinceDamage = 0;
    k.invulnerable = 0.5;
    this.floaters.push({ x: k.x, y: k.y, z: k.z + 1.5, text: String(dmg), color: "#ff6b6b", age: 0 });
    this.knock(k, from, knockback);
    if (k.health <= 0) {
      k.dead = true;
      k.attack = null;
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
    await this.preload(def.idle, def.move, def.activation, ...def.attacks.flatMap(a => [a.start, a.fire, a.end]));
    const m = new Monster(await this.renderer.instantiate(model), def);
    m.x = m.homeX = x; m.y = m.homeY = y;
    m.z = this.collision.groundZ(x, y);
    m.heading = heading;
    this.play(m, def.activation ?? def.idle, { loop: !def.activation });
    this.monsters.push(m);
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

    const attack = m.def.attacks.find(a => a.damage > 0) ?? m.def.attacks[0];
    const reach = attack ? attack.shape.forward + Math.max(attack.shape.halfLength, attack.shape.radius) * 0.8 : 1;
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
    const instance = await this.renderer.instantiate(model);
    this.effects.push({ instance, matrix, life, follow });
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
    for (const e of this.effects) out.push({ instance: e.instance, matrix: e.follow ? e.follow.matrix() : e.matrix });
    return out;
  }

  /** Living monsters, for health bars. */
  get liveMonsters() { return this.monsters.filter(m => m.state !== "dying" && m.state !== "spawning"); }
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
