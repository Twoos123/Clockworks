// Orbiting projectiles: the diskgun and mixer families' disks (DungeonActorConfig
// OrbitalBullet and CompoundOrbitalBullet) and the mixer cores' satellites
// (DungeonActorConfig Orbital, following the core that spawned them).
//
// Reimplemented from how the client predicts these actors (its orbital and orbital-bullet
// actor classes and their movement predictor), with the config fields' meanings:
//
// - An orbit turns `speed` revolutions per second (negative: the other way); the period is
//   whole milliseconds, 1000 / speed, as the client counts it. A plain orbital's angle starts
//   at `startingRotation`; a relative orbital and an orbital bullet add the rotation they
//   were spawned with; an orbital bullet with `alternateSpin` turns backwards when its
//   creation stamp is odd (a multi-spawn's disks alternate).
// - A compound orbital bullet adds a second orbit (`secondOrbitRadius`, `secondSpeed`,
//   `secondStartingRotation`) on top of the first.
// - An orbital bullet's centre flies straight out from where it was spawned at
//   `flightSpeed` units per second for `outDuration` ms, then turns home ("RETURNING") and
//   flies back to its shooter at the same speed, sitting on the shooter once there. At
//   `lifespan` ms it fizzles.
// - A plain orbital is centred on the actor it follows (its source); when that actor is
//   gone, so is the orbital.
// - `relativeRadius` adds the followed actor's radius to `orbitRadius`.

export type Follow = "NONE" | "SOURCE" | "ACTIVATOR" | "ULTIMATE";

export interface OrbitDef {
  /** Revolutions per second. */
  speed: number;
  orbitRadius: number;
  startingRotation: number;
  relativeRadius: boolean;
  follow: Follow;
  /** Orbital bullets only. */
  bullet?: { flightSpeed: number; outDuration: number; lifespan: number; alternateSpin: boolean };
  /** Compound orbital bullets: the second orbit. */
  second?: { orbitRadius: number; speed: number; startingRotation: number };
  /** RelativeOrbital and the bullets add their spawn rotation to the angle. */
  relative: boolean;
}

/** Reads a DungeonActorConfig Orbital-family config (class defaults where the export omits fields). */
export function readOrbit(cfg: any, kind: string): OrbitDef {
  const bullet = kind === "OrbitalBullet" || kind === "CompoundOrbitalBullet";
  const follow = (cfg.follow?.name ?? (bullet ? "NONE" : "SOURCE")) as Follow;
  return {
    // Orbital: speed 0.33, orbitRadius 1, startingRotation 0, follow SOURCE; OrbitalBullet:
    // flightSpeed 8, outDuration 750, lifespan 1700, follow NONE
    speed: cfg.speed ?? 0.33,
    orbitRadius: cfg.orbitRadius ?? 1,
    startingRotation: cfg.startingRotation ?? 0,
    relativeRadius: !!cfg.relativeRadius,
    follow,
    relative: bullet || kind === "RelativeOrbital",
    bullet: bullet ? {
      flightSpeed: cfg.flightSpeed ?? 8, outDuration: cfg.outDuration ?? 750,
      lifespan: cfg.lifespan ?? 1700, alternateSpin: !!cfg.alternateSpin,
    } : undefined,
    second: kind === "CompoundOrbitalBullet" ? {
      orbitRadius: cfg.secondOrbitRadius ?? 0.667, speed: cfg.secondSpeed ?? -1.5,
      startingRotation: cfg.secondStartingRotation ?? 0,
    } : undefined,
  };
}

/** The angle a spin of `speed` revolutions per second has turned `ms` after creation. */
export function spinAngle(speed: number, ms: number): number {
  const period = speed === 0 ? 0 : Math.trunc(1000 / speed);
  if (period === 0) return 0;
  // Java's remainder keeps the dividend's sign, so a negative period turns backwards
  const t = Math.trunc(ms) % period;
  return (Math.PI * 2 * t) / period;
}

/** The orbit's offset from its centre `ms` after creation. */
export function orbitOffset(o: OrbitDef, ms: number, radius: number, spawnRotation: number, flip: boolean): [number, number] {
  let spin = spinAngle(o.speed, ms);
  if (o.bullet?.alternateSpin && flip) spin = -spin;
  const a = o.startingRotation + (o.relative ? spawnRotation : 0) + spin;
  let x = Math.cos(a) * radius, y = Math.sin(a) * radius;
  if (o.second) {
    let s2 = spinAngle(o.second.speed, ms);
    if (o.bullet?.alternateSpin && flip) s2 = -s2;
    const b = o.second.startingRotation + spawnRotation + s2;
    x += Math.cos(b) * o.second.orbitRadius;
    y += Math.sin(b) * o.second.orbitRadius;
  }
  return [x, y];
}

export type OrbitEnd = "fizzle" | "lost" | null;

/**
 * One orbiting projectile's motion. `step` advances it; `x`, `y` are its position (the
 * centre plus the orbit offset), `cx`, `cy` the centre.
 */
export class OrbitMotion {
  /** Milliseconds since creation. */
  t = 0;
  cx: number;
  cy: number;
  x: number;
  y: number;
  returning = false;
  readonly radius: number;
  private readonly sx: number;
  private readonly sy: number;

  constructor(readonly o: OrbitDef, x: number, y: number, readonly rotation: number, readonly flip: boolean, sourceRadius = 0) {
    this.cx = this.sx = x;
    this.cy = this.sy = y;
    this.radius = o.orbitRadius + (o.relativeRadius ? sourceRadius : 0);
    [this.x, this.y] = this.place();
  }

  private place(): [number, number] {
    const [ox, oy] = orbitOffset(this.o, this.t, this.radius, this.rotation, this.flip);
    return [this.cx + ox, this.cy + oy];
  }

  /**
   * Advances `dt` seconds. `follow` is where the followed actor (a plain orbital's source,
   * a returning bullet's shooter) stands, or null when it is gone. Returns how it ended.
   */
  step(dt: number, follow: { x: number; y: number } | null): OrbitEnd {
    this.t += dt * 1000;
    const b = this.o.bullet;
    if (b) {
      if (this.t <= b.outDuration) {
        const d = (b.flightSpeed * this.t) / 1000;
        this.cx = this.sx + Math.cos(this.rotation) * d;
        this.cy = this.sy + Math.sin(this.rotation) * d;
      } else {
        this.returning = true;
        if (follow) {
          const dx = follow.x - this.cx, dy = follow.y - this.cy, dist = Math.hypot(dx, dy);
          const move = b.flightSpeed * dt;
          if (dist <= move) { this.cx = follow.x; this.cy = follow.y; }
          else { this.cx += (dx / dist) * move; this.cy += (dy / dist) * move; }
        }
      }
      [this.x, this.y] = this.place();
      return this.t >= b.lifespan ? "fizzle" : null;
    }
    if (this.o.follow !== "NONE") {
      if (!follow) return "lost";
      this.cx = follow.x; this.cy = follow.y;
    }
    [this.x, this.y] = this.place();
    return null;
  }
}
