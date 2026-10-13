// Dungeon props: the game's non-monster actors (DungeonActorConfig Door, Switch, Block,
// DungeonLift, Pickup, Elevator and plain actors). Their behaviour lives in closed game code,
// so it is written here from what the data says: doors have open/close states and an
// actionable signal (a carried key with the same signal unlocks them), switches have up and
// down states, blocks have health, lifts are carried, pickups are collected on touch, and the
// elevator ends the level.

import { compose, type Mat4 } from "../math";
import type { ModelInstance } from "../render/renderer";
import type { Entity } from "./logic";

export type PropKind = "door" | "switch" | "block" | "lift" | "pickup" | "elevator" | "generic";

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
    default: return "generic";
  }
}

export class Prop {
  instance: ModelInstance | null = null;
  z = 0;
  /** Collision map shape id while the prop blocks movement. */
  collisionId: number | null = null;
  health = 0;
  maxHealth = 0;
  breakable = false;
  /** Doors. */
  open = false;
  /** Switches: pressed by something standing on them. */
  pressed = false;
  /** Lifts: carried by the knight. */
  carried = false;
  /** Elevator: seconds the knight has stood on it. */
  standTime = 0;
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
