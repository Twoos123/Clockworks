// Interface scripts (InterfaceScriptConfig) and the GUI actions they run (ActionConfig):
// timed alpha fades and offset animations on tagged components, as Clyde's
// UserInterface.ConfigScript plays them. Actions with no visual effect here are ignored.

import { applyArguments } from "../config/params";
import { floatExpr } from "../expr";
import type { Component, Offset } from "./gui";

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(Math.max(c.lastIndexOf("."), c.lastIndexOf("$")) + 1); };

/** Easing.getTime for each easing class. */
function ease(e: any, t: number): number {
  switch (kind(e)) {
    case "QuadraticIn": return t * t;
    case "QuadraticOut": return t * (2 - t);
    case "QuadraticInAndOut": return t <= 0.5 ? 2 * t * t : 2 * t * (2 - t) - 1;
    case "CubicIn": return t * t * t;
    case "CubicOut": { const u = t - 1; return u * u * u + 1; }
    case "CubicInAndOut": { let u = t * 2; if (u < 1) return 0.5 * u * u * u; u -= 2; return 0.5 * (u * u * u + 2); }
    // Easing.CubicOutOvershoot: past the end and back
    case "CubicOutOvershoot": { const o = e.overshoot ?? 1.70158, u = t - 1; return u * u * ((o + 1) * u + o) + 1; }
    default: return t;
  }
}

const offsetOf = (t: any): Offset => ({
  tx: t?.translation?.x ?? 0, ty: t?.translation?.y ?? 0, rotation: t?.rotation ?? 0, scale: t?.scale ?? 1,
});
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A running animation; tick returns false once it has finished. */
type Tick = (dt: number) => boolean;

/** Plays scripts and actions against one interface (a UserInterface component). */
export class ScriptRunner {
  private ticks: Tick[] = [];
  /** Plays a PlaySound action's sound, when set. */
  onSound: ((file: string) => void) | null = null;

  constructor(private readonly ui: Component) {}

  get busy() { return this.ticks.length > 0; }

  /** Starts a script from the interface's own config group, by reference. */
  runScript(ref: any) {
    const base = ref?.name ? this.ui.scripts.get(ref.name) : null;
    if (!base) return;
    const impl = applyArguments(base, ref).implementation;
    if (kind(impl) !== "Original") return;
    const actions: { time: number; action: any }[] = (impl.actions ?? []).map((a: any) => ({ time: a.time ?? 0, action: a.action }));
    const loop: number = impl.loopDuration ?? 0;
    let time = 0, next = 0;
    this.ticks.push(dt => {
      time += dt;
      while (next < actions.length && actions[next].time <= time) this.execute(actions[next++].action);
      if (next < actions.length) return true;
      if (loop > 0 && time >= loop) { time -= loop; next = 0; return true; }
      return loop > 0;
    });
  }

  /** ActionConfig.execute. */
  execute(action: any) {
    const k = kind(action);
    if (k === "Compound") { for (const a of action.actions ?? []) this.execute(a); return; }
    if (k === "RunScript") { this.runScript(action.interfaceScript); return; }
    if (k === "PlaySound") { if (action.sound) this.onSound?.(action.sound); return; }
    const target = action.target ? this.ui.find(action.target) : null;
    if (!target) return;
    const timed = (interval: number, step: (t: number) => void) => {
      let elapsed = 0;
      step(0);
      this.ticks.push(dt => {
        elapsed += dt;
        const t = interval > 0 ? Math.min(1, elapsed / interval) : 1;
        step(ease(action.easing, t));
        if (t >= 1 && action.actionOnComplete) this.execute(action.actionOnComplete);
        return t < 1;
      });
    };
    switch (k) {
      case "SetAlpha": target.setAlpha(action.alpha ?? 1); break;
      case "SetVisible": target.visible = action.visible ?? true; break;
      case "SetEnabled": target.enabled = action.enabled ?? true; break;
      case "SetOffset": target.offset = offsetOf(action.offset); break;
      case "AnimateAlpha": {
        const a = floatExpr(action.value, 1), duration: number = action.duration ?? 0;
        let clock = performance.now() / 1000, elapsed = 0;
        this.ticks.push(dt => {
          clock += dt; elapsed += dt;
          target.setAlpha(Math.max(0, Math.min(1, a(clock))));
          return duration <= 0 || elapsed < duration;
        });
        break;
      }
      case "FadeAlpha": {
        const start = action.start ?? 0, end = action.end ?? 1;
        timed(action.interval ?? 1, t => target.setAlpha(lerp(start, end, t)));
        break;
      }
      case "MoveOffset": {
        const a = offsetOf(action.start), b = offsetOf(action.end);
        timed(action.interval ?? 1, t => {
          target.offset = { tx: lerp(a.tx, b.tx, t), ty: lerp(a.ty, b.ty, t), rotation: lerp(a.rotation, b.rotation, t), scale: lerp(a.scale, b.scale, t) };
        });
        break;
      }
      case "AnimateOffset": {
        // Transform2DExpression: Uniform (translation, rotation, scale) or Constant
        const v = action.value;
        const x = floatExpr(v?.translation?.x), y = floatExpr(v?.translation?.y), r = floatExpr(v?.rotation);
        const s = v?.scale ? floatExpr(v.scale, 1) : () => 1;
        const duration: number = action.duration ?? 0;
        let clock = performance.now() / 1000, elapsed = 0;
        this.ticks.push(dt => {
          clock += dt; elapsed += dt;
          target.offset = { tx: x(clock), ty: y(clock), rotation: r(clock), scale: s(clock) };
          return duration <= 0 || elapsed < duration;
        });
        break;
      }
    }
  }

  /** Stops every running script. */
  stop() { this.ticks = []; }

  tick(dt: number) {
    // animations started while ticking (a script running another) join after this pass
    const current = this.ticks;
    this.ticks = [];
    const kept = current.filter(t => t(dt));
    this.ticks = [...kept, ...this.ticks];
  }
}
