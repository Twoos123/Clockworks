// A controllable knight: the Character/PC/Default actor's body, armour and helmet, moving at
// the actor's speed with its collision circle and mask, animated with its idle and run clips.

import { compose, type Mat4 } from "../math";
import { loadAnimation, type AnimationClip, type ModelLoader } from "../model";
import type { ModelInstance, Renderer } from "../render/renderer";
import type { CollisionMap } from "./collision";

// from config/actor.dat, Character/PC/Default (ProjectXActorConfig$Knight)
const SPEED = 5;
const RADIUS = 1 / 3;
const COLLISION_MASK = 43;
const TURN_RATE = 14; // radians per second toward the movement direction

export interface MoveInput {
  /** Desired direction in world space; zero when standing still. */
  x: number;
  y: number;
}

export class Player {
  x = 0;
  y = 0;
  z = 0;
  /** Facing, radians about +z, 0 = facing +x as Tudey actors do. */
  heading = -Math.PI / 2;
  moving = false;
  private idle: AnimationClip | null = null;
  private run: AnimationClip | null = null;

  private constructor(readonly instance: ModelInstance, private readonly collision: CollisionMap) {}

  static async create(loader: ModelLoader, renderer: Renderer, collision: CollisionMap, at: [number, number]): Promise<Player> {
    const model = await loader.load("character/pc/model.dat");
    const instance = await renderer.instantiate(model);
    const p = new Player(instance, collision);
    p.idle = await loadAnimation(loader, "character/pc/idle.dat").catch(() => null)
      ?? await loadAnimation(loader, "character/pc/idle/default/001.dat").catch(() => null);
    p.run = await loadAnimation(loader, "character/pc/run_forward.dat").catch(() => null);
    [p.x, p.y] = at;
    p.z = collision.groundZ(p.x, p.y);
    p.setClip(p.idle);
    return p;
  }

  private setClip(clip: AnimationClip | null) {
    if (!clip || this.instance.clip?.path === clip.path) return;
    this.instance.clip = { ...clip, loop: true };
    this.instance.time = 0;
  }

  update(dt: number, input: MoveInput) {
    const len = Math.hypot(input.x, input.y);
    this.moving = len > 0.01;
    if (this.moving) {
      const dx = (input.x / len) * SPEED * dt, dy = (input.y / len) * SPEED * dt;
      // move each axis separately so the knight slides along walls instead of sticking
      if (!this.collision.collides(this.x + dx, this.y, RADIUS, COLLISION_MASK)) this.x += dx;
      if (!this.collision.collides(this.x, this.y + dy, RADIUS, COLLISION_MASK)) this.y += dy;
      // turn smoothly toward the input direction
      const target = Math.atan2(input.y, input.x);
      let diff = target - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt);
    }
    // ease toward the ground height (stairs and ramps change elevation in half-unit steps)
    const ground = this.collision.groundZ(this.x, this.y);
    this.z += (ground - this.z) * Math.min(1, dt * 12);
    this.setClip(this.moving ? this.run : this.idle);
    this.instance.time += dt;
  }

  /**
   * World placement. The knight model faces -y (its face mesh sits on that side of the head
   * bone), so it is turned a quarter forward from heading.
   */
  matrix(): Mat4 {
    const a = this.heading + Math.PI / 2;
    return compose([this.x, this.y, this.z], [0, 0, Math.sin(a / 2), Math.cos(a / 2)], 1);
  }
}
