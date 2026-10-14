// The knight's controls and their timing, as the client predicts its own knight (the
// dungeoneer advancer, `dungeon/util/i` in the decompiled client, on top of the knight and
// pawn advancers `util/j`, `tudey/util/k` and `tudey/util/a`). Pure timing logic in
// milliseconds: the world asks it what the knight may do and when its attacks, charges,
// shield and dodge begin and end, and plays them. See docs/research/client-fidelity.md
// section 9. Our own TypeScript, written from reading the client.

/** What the knight is doing (the client's activities). */
export type ActivityKind =
  | "idle"
  /** An attack: a combo step, the charged or incomplete charged attack, a reload, a bash. */
  | "attack"
  /** Holding the attack button to charge (283). */
  | "charge"
  /** Shield raised (284). */
  | "defend"
  /** The dodge (286). */
  | "dodge"
  /** A light hit's flinch (274: 500 ms, walking allowed). */
  | "hurt"
  /** A heavy hit's knockdown (275; the server ends it). */
  | "hurtHard"
  /** Getting up after a heavy hit (276: 400 ms). */
  | "recover"
  /** The shield taking a hit (277: 411 ms). */
  | "shieldHit";

/** Which attack: a combo step (0 to 7), or one of the weapon's or shield's special attacks. */
export type AttackSlot = number | "charged" | "incomplete" | "cooldown" | "bash";

/** An attack config's timing fields (AttackConfig Original). */
export interface AttackTimes {
  land: number; rearm: number; clear: number;
  startSpeed: number; fireSpeed: number; endSpeed: number;
  blended: boolean;
}

/**
 * An attack's activity timing in ms from its start, at an attack speed: it lands (fires) at
 * `land`, is rearmed (the next attack may begin, turning is allowed again) at `rearm`, and
 * ends at `clear`. `moves` lets the knight walk and turn throughout.
 */
export interface AttackTiming { land: number; rearm: number; clear: number; moves: boolean }

/**
 * AttackConfig Original's `Qh`, `Qg` and `Qf` (land, land + rearm, land + rearm + clear, each
 * part over its animation speed, truncated to whole ms) divided by the knight's attack speed,
 * as the dungeoneer advancer's attack activity takes them.
 */
export function attackTiming(a: AttackTimes, attackSpeed: number, weaponMoves: boolean): AttackTiming {
  const land = Math.trunc(a.land / a.startSpeed);
  const rearm = land + Math.trunc(a.rearm / a.fireSpeed);
  const clear = rearm + Math.trunc(a.clear / a.endSpeed);
  const s = attackSpeed > 0 ? attackSpeed : 1;
  return { land: Math.trunc(land / s), rearm: Math.trunc(rearm / s), clear: Math.trunc(clear / s), moves: weaponMoves && a.blended };
}

/** Activity lengths the client fixes (ms). */
export const ACTIVITY_MS = {
  hurt: 500, recover: 400, shieldHit: 411,
  /** The dodge activity; the dodge impulse is 5 units over the same 625 ms (longer when slowed). */
  dodge: 625,
  /** Holding the attack button this long before an activity began starts a charge after it. */
  chargeHold: 350,
};

/** What the controller needs to know about the weapon in hand and the shield. */
export interface WeaponRules {
  /** Combo attacks (at most 8). */
  attacks: number;
  /** Both a charged and an incomplete charged attack: the weapon can charge. */
  charges: boolean;
  /** Charge time in ms after bonuses (Dungeoneer `Rr`). */
  chargeTime: number;
  maxChain: number;
  chainCooldown: number;
  /** The combo loops (`Weapon.Vc`); otherwise it stays on its last attack. */
  cycles: boolean;
  /** A cooldown attack (a gun's reload). */
  cooldown: boolean;
  /** The shield has a bash. */
  bash: boolean;
  /** The knight carries a shield. */
  shield: boolean;
  /** Each attack's timing at the current attack speed. */
  timing(slot: AttackSlot): AttackTiming | null;
}

/** One frame of the knight's input. */
export interface ControlInput {
  /** The attack button is held. */
  attack: boolean;
  /** When the attack button last went down or up (ms). */
  attackChanged: number;
  /** The shield button is held. */
  defend: boolean;
  /** The shield bash button went down this frame. */
  bash: boolean;
  /** The dodge button went down this frame. */
  dodge: boolean;
}

/** What the knight's conditions allow (the status modifiers' can-move flags). */
export interface ControlStatus {
  move: boolean; rotate: boolean; attack: boolean; defend: boolean;
  /** Shield health is full (a bash needs it). */
  fullShield: boolean;
}

export const FREE: ControlStatus = { move: true, rotate: true, attack: true, defend: true, fullShield: true };

/** What a frame started: the world plays it. `at` is when it began (ms), maybe earlier this frame. */
export type ControlEvent =
  | { type: "attack"; slot: AttackSlot; at: number }
  | { type: "charge"; at: number }
  | { type: "defend"; at: number }
  | { type: "dodge"; at: number }
  | { type: "recover"; at: number }
  | { type: "idle"; at: number };

export interface Activity {
  kind: ActivityKind;
  /** When it began (ms). */
  started: number;
  /** An attack's slot and timing. */
  slot?: AttackSlot;
  timing?: AttackTiming;
  /** How long it lasts (ms), when fixed. */
  length?: number;
}

/**
 * The dungeoneer advancer's rules: which activity the knight is in, the combo's chain count,
 * and the dodge cooldown.
 */
export class KnightControl {
  activity: Activity = { kind: "idle", started: -1e9 };
  /** Attacks chained so far, and when the count lapses back to 0 (Dungeoneer `aw`/`eE`). */
  chainCount = 0;
  chainReset = 0;
  /** When the next dodge may start (Dungeoneer `_nextDodge`). */
  nextDodge = -1e9;
  /** Events of the current frame. */
  private events: ControlEvent[] = [];

  /** The chain count at a time: 0 once its reset time has passed. */
  chain(now: number): number { return now >= this.chainReset ? 0 : this.chainCount; }

  isAttack(): boolean { return this.activity.kind === "attack"; }

  /** An attack past its rearm time (`i.a.Sk`): the next attack, the shield or turning may begin. */
  rearmed(now: number): boolean {
    const a = this.activity;
    return a.kind === "attack" && !!a.timing && now - a.started >= a.timing.rearm;
  }

  /** The activity lets the knight walk (`ActiveAdvancer.canMove`, before conditions). */
  allowsMovement(): boolean {
    switch (this.activity.kind) {
      case "idle": case "charge": case "defend": case "hurt": return true;
      case "attack": return !!this.activity.timing?.moves;
      default: return false;
    }
  }

  /** The activity lets the knight turn (`canRotate`): attacks once rearmed, unless blended. */
  allowsRotation(now: number): boolean {
    switch (this.activity.kind) {
      case "idle": case "charge": case "defend": case "hurt": return true;
      case "attack": return !!this.activity.timing?.moves || this.rearmed(now);
      default: return false;
    }
  }

  /**
   * Weapon switches apply only while idle or shielding (Knight `Np`, or defending); a switch
   * asked for during an attack waits until it ends.
   */
  canSwitch(): boolean { return this.activity.kind === "idle" || this.activity.kind === "defend"; }

  /** Movement factor the activity gives (Dungeoneer `getSpeed`): charging, attacking, defending. */
  speedFactor(w: { chargingSpeed: number; attackingSpeed: number }, defendingSpeed: number): number {
    const a = this.activity;
    if (a.kind === "charge") return w.chargingSpeed;
    if (a.kind === "attack" && a.slot !== "bash") return w.attackingSpeed;
    if (a.kind === "defend") return 1 + defendingSpeed;
    return 1;
  }

  private set(kind: ActivityKind, at: number, extra: Partial<Activity> = {}) {
    this.activity = { kind, started: at, ...extra };
  }

  private toIdle(at: number) {
    this.set("idle", at);
    this.events.push({ type: "idle", at });
  }

  /** Starts an attack (`eO`): it counts in the chain, which lapses after it clears (or lands plus the chain cooldown). */
  private startAttack(slot: AttackSlot, at: number, w: WeaponRules) {
    const timing = w.timing(slot);
    if (!timing) { this.toIdle(at); return; }
    this.set("attack", at, { slot, timing });
    const lapse = w.chainCooldown === 0 ? timing.clear : timing.land + w.chainCooldown;
    this.chainCount = this.chain(at) + 1;
    this.chainReset = at + lapse;
    this.events.push({ type: "attack", slot, at });
  }

  /** The combo step the chain count picks (`eN`): looping or holding on the last. */
  private nextSlot(now: number, w: WeaponRules): AttackSlot {
    if (w.attacks === 0) return "incomplete";
    const n = this.chain(now);
    return w.cycles ? n % w.attacks : Math.min(n, w.attacks - 1);
  }

  /**
   * Time passes: activities end at their lengths, a spent clip starts the reload, and the
   * activity's own input (charge release, holding into a charge, lowering the shield) is read.
   * Returns what began.
   */
  update(now: number, input: ControlInput, w: WeaponRules | null, status: ControlStatus = FREE): ControlEvent[] {
    this.events = [];
    const a = this.activity;
    if (a.kind === "attack" && a.timing) {
      const t = a.timing;
      const rearmAt = a.started + t.rearm;
      // the last shot of a clip: at its rearm the reload starts (`i.a.aw`)
      if (w && w.cooldown && w.maxChain > 0 && now >= rearmAt && this.chain(now) === w.maxChain && a.slot !== "cooldown") {
        const ct = w.timing("cooldown");
        if (ct) {
          this.set("attack", rearmAt, { slot: "cooldown", timing: ct });
          this.chainCount = w.maxChain + 1;
          this.chainReset = rearmAt + ct.land + w.chainCooldown;
          this.events.push({ type: "attack", slot: "cooldown", at: rearmAt });
        }
      } else if (now - a.started >= t.clear) {
        this.toIdle(a.started + t.clear);
      } else if (w && w.charges && now >= rearmAt && input.attack && input.attackChanged <= a.started) {
        // the button held since before this attack: a charge begins at its rearm (`i.a.NO`)
        this.set("charge", rearmAt);
        this.events.push({ type: "charge", at: rearmAt });
      }
    } else if (a.length !== undefined && now - a.started >= a.length) {
      const end = a.started + a.length;
      if (a.kind === "hurtHard") { this.set("recover", end, { length: ACTIVITY_MS.recover }); this.events.push({ type: "recover", at: end }); }
      else this.toIdle(end);
    }
    const b = this.activity;
    if (b.kind === "charge" && !input.attack) {
      // released: full charge gives the charged attack, else the next combo step (or a
      // bomb's incomplete charge)
      if (!w) this.toIdle(now);
      else this.startAttack(now - b.started >= w.chargeTime ? "charged" : this.nextSlot(now, w), now, w);
    } else if (b.kind === "defend" && (!input.defend || !this.canDefend(true, now, w, status))) {
      this.toIdle(now);
    }
    return this.events;
  }

  /** The knight may begin an attack (`RX`): idle, or an attack past its rearm. */
  canBeginAttack(now: number, status: ControlStatus): boolean {
    if (!status.attack) return false;
    return this.activity.kind === "idle" || this.rearmed(now);
  }

  /** The shield may go up (`bV`): idle, already defending, or an attack past its rearm (not a reload). */
  canDefend(already: boolean, now: number, w: WeaponRules | null, status: ControlStatus): boolean {
    if (!w?.shield || !status.defend) return false;
    const a = this.activity;
    return (already && a.kind === "defend") || a.kind === "idle" || (this.rearmed(now) && a.slot !== "cooldown");
  }

  /** A dodge may start (`OK`): not mid-attack, charge, bash or hurt; the knight can move; the cooldown is over. */
  canDodge(now: number, status: ControlStatus): boolean {
    const k = this.activity.kind;
    if (k === "attack" || k === "charge" || k === "hurt" || k === "hurtHard") return false;
    return status.move && this.allowsMovement() && this.nextDodge < now;
  }

  /**
   * The frame's main input (`i.NO`), after turning and targeting: the dodge, the attack (a
   * new press starts the next combo step; a button held since well before the activity
   * began starts a charge), the shield and the bash.
   */
  act(now: number, input: ControlInput, w: WeaponRules | null, dodgeCooldown: number, status: ControlStatus = FREE): ControlEvent[] {
    this.events = [];
    if (input.dodge && this.canDodge(now, status)) {
      this.nextDodge = now + dodgeCooldown;
      this.set("dodge", now, { length: ACTIVITY_MS.dodge });
      this.events.push({ type: "dodge", at: now });
    }
    if (input.attack && w && (w.attacks > 0 || w.charges) && (w.maxChain === 0 || this.chain(now) < w.maxChain) && this.canBeginAttack(now, status)) {
      const start = this.activity.started;
      if (input.attackChanged >= start) {
        if (w.attacks === 0) {
          if (w.charges) { this.set("charge", now); this.events.push({ type: "charge", at: now }); }
        } else {
          const a = this.activity;
          const combo = a.kind === "attack" && typeof a.slot === "number";
          this.startAttack(combo ? this.nextSlot(now, w) : 0, now, w);
        }
      } else if (w.charges && input.attackChanged + ACTIVITY_MS.chargeHold < start) {
        this.set("charge", now);
        this.events.push({ type: "charge", at: now });
      }
    }
    if (input.defend && this.activity.kind !== "defend" && this.canDefend(false, now, w, status)) {
      this.set("defend", now);
      this.events.push({ type: "defend", at: now });
    }
    // the bash (`RY`): the shield could go up, the knight can move, the shield is full
    if (input.bash && w?.bash && status.move && this.allowsMovement() && status.fullShield && this.canDefend(true, now, w, status)) {
      this.startBash(now, w);
    }
    return this.events;
  }

  private startBash(now: number, w: WeaponRules) {
    const timing = w.timing("bash");
    if (!timing) return;
    this.set("attack", now, { slot: "bash", timing });
    this.events.push({ type: "attack", slot: "bash", at: now });
  }

  /**
   * A hit's reaction (the server sets these activities): a flinch, a knockdown (held until
   * `hardLength`, then getting up) or the shield's recoil. Each replaces the current activity.
   */
  hurt(kind: "hurt" | "hurtHard" | "shieldHit", now: number, hardLength = 0) {
    const length = kind === "hurt" ? ACTIVITY_MS.hurt : kind === "shieldHit" ? ACTIVITY_MS.shieldHit : hardLength;
    this.set(kind, now, { length });
  }

  /** Back to idle at once (knocked out, frozen, a level change). */
  reset(now: number) { this.set("idle", now); }
}

/** The knight's movement sets (Character/PC/Default's QuadMovements): walking at 1, running at 6. */
export const KNIGHT_MOVEMENTS = [{ set: "walk", speed: 1 }, { set: "run", speed: 6 }] as const;

/**
 * Which movement animation plays and how fast (ActorSprite `getMovement`): the set whose
 * speed is nearest the knight's (the first on a tie), at speed / its speed; the side from the
 * movement direction against the facing, measured in quarter turns with a bias toward the
 * lateral sides so that diagonals use them.
 */
export function quadMovement(direction: number, rotation: number, speed: number): { set: "walk" | "run"; side: "forward" | "left" | "backward" | "right"; rate: number } {
  let best = 0;
  for (let i = 1; i < KNIGHT_MOVEMENTS.length; i++) {
    if (Math.abs(speed - KNIGHT_MOVEMENTS[i].speed) < Math.abs(speed - KNIGHT_MOVEMENTS[best].speed)) best = i;
  }
  const diff = Math.atan2(Math.sin(direction - rotation), Math.cos(direction - rotation));
  const q = (((diff / (Math.PI / 2) + 2.5) % 4) + 4) % 4;
  // QuadMovement resolves to [backward, right, forward, left]
  const side = q <= 0.01 || q >= 2.99 ? "left" : q < 0.99 ? "backward" : q <= 2.01 ? "right" : "forward";
  const m = KNIGHT_MOVEMENTS[best];
  return { set: m.set, side, rate: speed / m.speed };
}

/**
 * Whether a circle (a monster's shape) meets the auto-target triangle (`dungeon/util/b`):
 * from the knight to two points `dist` away at `angleDeg / 2` either side of the facing.
 */
export function inTargetWedge(x: number, y: number, facing: number, dist: number, angleDeg: number, cx: number, cy: number, r: number): boolean {
  if (dist <= 0 || angleDeg <= 0) return false;
  const h = (angleDeg / 2) * Math.PI / 180;
  const ax = x + dist * Math.cos(facing - h), ay = y + dist * Math.sin(facing - h);
  const bx = x + dist * Math.cos(facing + h), by = y + dist * Math.sin(facing + h);
  // centre inside: the same side of all three edges
  const side = (px: number, py: number, qx: number, qy: number) => (qx - px) * (cy - py) - (qy - py) * (cx - px);
  const s1 = side(x, y, ax, ay), s2 = side(ax, ay, bx, by), s3 = side(bx, by, x, y);
  if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return true;
  const near = (px: number, py: number, qx: number, qy: number) => {
    const dx = qx - px, dy = qy - py, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((cx - px) * dx + (cy - py) * dy) / l2)) : 0;
    return Math.hypot(px + dx * t - cx, py + dy * t - cy) <= r;
  };
  return near(x, y, ax, ay) || near(ax, ay, bx, by) || near(bx, by, x, y);
}
