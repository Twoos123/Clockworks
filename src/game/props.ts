// Dungeon props: the game's non-monster actors (DungeonActorConfig Door, Switch, Block,
// DungeonLift, Pickup, Elevator and plain actors). Their behaviour lives in closed game code,
// so it is written here from what the data says: doors have open/close states and an
// actionable signal (a carried key with the same signal unlocks them), switches have up and
// down states, blocks have health, lifts are carried, pickups are collected on touch, and the
// elevator ends the level.

import { compose, type Mat4 } from "../math";
import type { ModelInstance } from "../render/renderer";
import type { Entity } from "./logic";
import type { ObjectState } from "./objects";

export type PropKind = "door" | "switch" | "block" | "lift" | "pickup" | "elevator" | "trap" | "generic";

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };

export function propKind(cfg: any): PropKind {
  switch (kind(cfg)) {
    case "Door": case "BouncerDoor": return "door";
    case "Switch": case "DumbSwitch": return "switch";
    case "Block": case "TimedBlock": case "StoneBlock": case "GhostlinkBlock": case "StarlinkBlock":
    case "UnbreakableStarlinkBlock": case "PrismBlock": case "DamageMirrorBlock": return "block";
    case "DungeonLift": case "PickupLift": return "lift";
    case "Pickup": return "pickup";
    case "Elevator": case "ShadowLairElevator": return "elevator";
    case "Trap": return "trap";
    default: return "generic";
  }
}

/**
 * Floor traps (DungeonActorConfig$Trap, the spike plates) cycle through their three sprite
 * states, retracted, warning and extended, and their intersection handler strikes whatever
 * stands on them while extended. The cycles are the client's Trap Cycle table: down, warn
 * and up times and an offset, in units of the trap's `interval` (1000 ms by default). UP and
 * DOWN stay put. (Down, then warn, then up is our reading of the state order.)
 */
export const TRAP_CYCLES: Record<string, [number, number, number, number]> = {
  A: [3, 1, 4, 0], A2: [3, 1, 4, 2], B: [3, 1, 4, 4], B2: [3, 1, 4, 6],
  SLOW: [7, 1, 8, 0], QUICK: [1, 1, 2, 0], UP: [0, 0, 0, 0], DOWN: [0, 0, 0, 0],
  A_SLOW: [7, 1, 8, 0], A2_SLOW: [7, 1, 8, 4], B_SLOW: [7, 1, 8, 8], B2_SLOW: [7, 1, 8, 12],
  CROSS_A1: [2, 1, 9, 0], CROSS_A2: [2, 1, 9, 1.5], CROSS_MID3: [2, 1, 3, 3], CROSS_A4: [2, 1, 9, 4.5],
  CROSS_A5: [2, 1, 9, 6], CROSS_B1: [2, 1, 9, 6], CROSS_B2: [2, 1, 9, 7.5], CROSS_B4: [2, 1, 9, 10.5],
  CROSS_B5: [2, 1, 9, 0],
};
export type TrapState = 0 | 1 | 2;
/** A trap's state at a clock time (seconds) for its cycle name and interval (seconds). */
export function trapState(clock: number, cycle = "A", interval = 1): TrapState {
  if (cycle === "UP") return 2;
  if (cycle === "DOWN") return 0;
  const [down, warn, up, offset] = TRAP_CYCLES[cycle] ?? TRAP_CYCLES.A;
  const period = down + warn + up;
  const t = (((clock / interval + offset) % period) + period) % period;
  return t < down ? 0 : t < down + warn ? 1 : 2;
}

/**
 * A help bubble (Dynamic/Help Bubble/Help: a Switch whose sprite is a Balloon): an in-world
 * word balloon (ui/wordballoon/help_interface.dat) with a helptips title and message, shown
 * while its switch has START set (as it starts; the level's "next" signal clears it) and the
 * knight is within its visible distance (client sprite/a).
 */
export interface Balloon {
  /** helptips keys. */
  message: string;
  title: string;
  /** The title's colour (r, g, b, a in 0..1), or null for the style's. */
  titleColor: [number, number, number, number] | null;
  width: number;
  /** Raised this far above the bubble's spot (world units). */
  zOffset: number;
  visibleDistance: number;
  /** The switch's START flag. */
  on: boolean;
}

/** A Balloon sprite config's balloon, or null for other sprites. */
export function balloonOf(sprite: any): Balloon | null {
  if (!/\$Balloon$/.test(String(sprite?.$class ?? ""))) return null;
  const c = sprite.titleColor;
  return {
    message: typeof sprite.message === "string" ? sprite.message : "",
    title: typeof sprite.title === "string" ? sprite.title : "",
    titleColor: c && typeof c.r === "number" ? [c.r, c.g ?? 0, c.b ?? 0, c.a ?? 1] : null,
    width: Number(sprite.width) || 200,
    zOffset: typeof sprite.zOffset === "number" ? sprite.zOffset : 0.5,
    visibleDistance: typeof sprite.visibleDistance === "number" ? sprite.visibleDistance : 7,
    on: true,
  };
}

export class Prop {
  instance: ModelInstance | null = null;
  z = 0;
  /** Collision map shape id while the prop blocks movement. */
  collisionId: number | null = null;
  health = 0;
  maxHealth = 0;
  breakable = false;
  /** Health counts hits rather than damage. */
  hits = false;
  /** Takes hits without breaking (prisms, emitters, gun blocks, cages: src/game/objects.ts). */
  hittable = false;
  /** Dungeon object state (src/game/objects.ts), or null for plain props. */
  obj: ObjectState | null = null;
  /** Whether attacks and blasts strike the prop. */
  get struck() { return this.breakable || this.hittable; }
  /** Doors. */
  open = false;
  /** Switches: pressed by something standing on them. */
  pressed = false;
  /** Lifts: carried by the knight. */
  carried = false;
  /** Elevator: seconds the knight has stood on it. */
  standTime = 0;
  /**
   * Switches rung by a blow rather than stepped on (a Beast Bell: no collision mask, a Damage
   * handler): the world time until the switch can be struck again.
   */
  strikable = false;
  cooldownUntil = 0;
  /** Traps: the cycle state shown, the half-size of the struck square, the cycle. */
  trapState: TrapState = 0;
  trapHalf = 0.5;
  trapB = false;
  trapDamage: any = null;
  /** Traps: whether the plate strikes what stands on it (rocket blocks fire instead). */
  trapStrikes = true;
  /** Traps: seconds per cycle (rocket blocks take three Intervals), and switched off. */
  /** Trap cycle name and interval in seconds (DungeonActorConfig Trap: cycle A, 1000 ms). */
  trapCycle = "A";
  trapInterval = 1;
  trapOff = false;
  /** The actor reference's arguments (a Shadow Lair elevator's "Push Gate"). */
  args: Record<string, unknown> = {};
  /** A help bubble's balloon (ProjectXActorSpriteConfig.Balloon), or null. */
  balloon: Balloon | null = null;
  constructor(readonly kind: PropKind, readonly entity: Entity, readonly cfg: any) {}

  get x() { return this.entity.x; }
  get y() { return this.entity.y; }
  /** Sprites face -y in model space; an actor's rotation is its facing along +x. */
  matrix(): Mat4 {
    const a = this.entity.rotation + Math.PI / 2;
    return compose([this.x, this.y, this.z], [0, 0, Math.sin(a / 2), Math.cos(a / 2)], 1);
  }
  /** The sprite's state animations (doors: close, closed, open, opened; switches: up, down). */
  get states(): any[] { return (this.cfg.sprite?.states ?? []).map((s: any) => s?.animation).filter(Boolean); }
}

/**
 * A gate pillar showing a gate (the client's GateDisplay sprite, town/a/a/a): model_v2 with the
 * six strata's theme icons (ui/icon/theme/<theme>.png, "unk" when unknown), no arrow, and the
 * Launched state while the gate is active (the light beam), else Dormant.
 */
export function gateDisplayModel(themes: readonly string[], active: boolean): any {
  const icon = (i: number) => `ui/icon/theme/${themes[i] ? themes[i].toLowerCase() : "unk"}.png`;
  return {
    $class: "com.threerings.config.ConfigReference", name: "world/dynamic/gates/arcade_pillar/model_v2.dat",
    arguments: { $map: "com.threerings.config.ArgumentMap", entries: [
      ...[0, 1, 2, 3, 4, 5].map(i => [`Icon${i + 1}`, icon(i)]), ["Arrow", "Off"], ["State", active ? "Launched" : "Dormant"]] },
  };
}
