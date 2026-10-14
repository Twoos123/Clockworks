// Townsfolk: how the game's NPCs idle and wander.
//
// Idling is the client's own (Clyde's ActorSprite for a Moving sprite config): while an idle
// animation plays it keeps playing; when it ends, the next idle is drawn at random by the
// sprite config's weights (a Stranger's standing_idle mostly, now and then idle2 or idle3).
// Moving, the sprite plays the movement whose speed is nearest the actor's (over the sprite's
// scale), sped up or slowed to match.
//
// Wandering is the server's (BehaviorConfig.Wander: walk, turn by a random angle now and then,
// pause, keep within a radius of home); the behaviours are stripped from the client data, so
// actors whose names say they wander ("Character/NPC/Emberlight/Gremlin (Wander)") get a
// Wander with our own timings. Everyone else stands where the level puts them.

/** A weighted animation (ActorSpriteConfig.WeightedAnimation; weight defaults to 1). */
export interface WeightedAnim { animation: any; weight?: number }
/** A movement (ActorSpriteConfig.SingleMovement): its animation and the speed it is made for. */
export interface Movement { animation: any; speed: number }

/** RandomUtil.getWeightedIndex: an index drawn by weight (null for an empty list). */
export function pickWeighted(list: { weight?: number }[], rand: () => number = Math.random): number | null {
  if (!list.length) return null;
  const total = list.reduce((t, w) => t + Math.max(0, w.weight ?? 1), 0);
  if (total <= 0) return 0;
  let r = rand() * total;
  for (let i = 0; i < list.length; i++) {
    r -= Math.max(0, list[i].weight ?? 1);
    if (r < 0) return i;
  }
  return list.length - 1;
}

/** The movement for a speed, and the rate to play it at (ActorSprite's movement choice). */
export function pickMovement(movements: Movement[], speed: number, scale = 1): { animation: any; rate: number } | null {
  if (!movements.length) return null;
  const s = speed / (scale || 1);
  let best = 0;
  for (let i = 1; i < movements.length; i++) if (Math.abs(s - movements[i].speed) < Math.abs(s - movements[best].speed)) best = i;
  const m = movements[best];
  return { animation: m.animation, rate: m.speed > 0 ? s / m.speed : 1 };
}

/** Wander timings (seconds) and the radius kept around home (world units): ours. */
export const WANDER = { walk: [2, 5] as const, pause: [2, 6] as const, radius: 6 };

/** A wanderer's state. */
export interface Wander {
  homeX: number; homeY: number;
  walking: boolean;
  /** Seconds left in this walk or pause. */
  left: number;
  /** The direction walked (radians, +x at 0). */
  dir: number;
}

export function startWander(x: number, y: number, rand: () => number = Math.random): Wander {
  return { homeX: x, homeY: y, walking: false, left: WANDER.pause[0] + rand() * (WANDER.pause[1] - WANDER.pause[0]), dir: rand() * Math.PI * 2 };
}

/**
 * Advances a wanderer: whether it walks this tick and which way. A walk that was blocked last
 * tick turns about; one that strays past the radius heads home.
 */
export function stepWander(w: Wander, x: number, y: number, dt: number, blocked: boolean, rand: () => number = Math.random): { walk: boolean; dir: number } {
  w.left -= dt;
  if (w.walking && blocked) w.dir += Math.PI * (0.5 + rand());
  if (w.left <= 0) {
    w.walking = !w.walking;
    const [lo, hi] = w.walking ? WANDER.walk : WANDER.pause;
    w.left = lo + rand() * (hi - lo);
    // a new heading: the Wander's random direction change, or home when far from it
    if (w.walking) w.dir += (rand() * 2 - 1) * Math.PI;
  }
  if (w.walking && Math.hypot(x - w.homeX, y - w.homeY) > WANDER.radius) w.dir = Math.atan2(w.homeY - y, w.homeX - x);
  return { walk: w.walking, dir: w.dir };
}

/** Whether an actor wanders (its name says so: the behaviour itself is server data). */
export const wanders = (name: string, speed: number) => /\(Wander\)|Wander(er|ing)\b/i.test(name) && speed > 0;
