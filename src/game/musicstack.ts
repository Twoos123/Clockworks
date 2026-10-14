// The levels' own scripted music. A level's logic spawns "Environment/Music" actors
// (config/actor.dat: a Block whose sprite model is world/environment/global_music_stack.dat,
// a viewer affecter playing the sounder "Stream/Default (Gain, Stack)") and later destroys
// them by tag; the actor's sprite plays its Destruction Transient (a model/scripted/
// play_sound_clip.dat, usually the victory fanfare) as it goes.
//
// The stream goes on a named stack the way Clyde's StackedStream does (com.threerings.openal,
// open source): every stream on a stack has a level; pushing with Override (the sounder's
// `push`) fades out the top level's streams over Fade In and starts a level above them, while
// pushing without it joins the top level and plays alongside. Popping (the sounder stopping
// when the actor goes) fades the stream out over Fade Out and, when that empties the top
// level, fades the level below back in over the same time. The floor's own music is the
// bottom of the "default" stack (scene globals are Stream sounders with the default stack and
// no push), so a level's battle music overrides it and gives it back when the wave falls.

/** What an Environment/Music actor plays. */
export interface ScriptedMusic {
  file: string;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  /** The sounder's `push`: displace the stack's top level rather than join it. */
  override: boolean;
  stack: string;
  /** The Destruction Transient's clip (the victory fanfare), if any. */
  transient: { file: string; gain: number; pitch: number } | null;
}

export const MUSIC_STACK_MODEL = "world/environment/global_music_stack.dat";

const args = (ref: any): Map<string, any> => new Map((ref?.arguments?.entries ?? []) as [string, any][]);
const num = (v: any, d: number) => (typeof v === "number" && isFinite(v) ? v : d);

/** The music an actor config (resolved, arguments applied) plays, or null when it is not a music actor. */
export function scriptedMusic(cfg: any): ScriptedMusic | null {
  const model = cfg?.sprite?.model;
  if (model?.name !== MUSIC_STACK_MODEL) return null;
  const a = args(model);
  const file = a.get("File");
  if (typeof file !== "string" || !file) return null;
  const dt = cfg.sprite.destructionTransient;
  const ta = args(dt);
  const tf = ta.get("File");
  return {
    file,
    gain: num(a.get("Gain"), 1),
    fadeIn: num(a.get("Fade In"), 0),
    fadeOut: num(a.get("Fade Out"), 0),
    override: !!a.get("Override"),
    stack: typeof a.get("Stack") === "string" ? a.get("Stack") : "default",
    transient: typeof tf === "string" && tf ? { file: tf, gain: num(ta.get("Gain"), 1), pitch: num(ta.get("Pitch"), 1) } : null,
  };
}

/**
 * Whether a level's logic (its entries' resolved handlers and actors) spawns music actors of its
 * own: a SpawnActor of "Environment/Music" anywhere in it, as every boss lair's fight does.
 */
export function spawnsMusic(logic: readonly { handlers?: any[]; actor?: any }[]): boolean {
  const seen = new WeakSet<object>();
  const walk = (o: any, depth: number): boolean => {
    if (!o || typeof o !== "object" || seen.has(o) || depth > 40) return false;
    seen.add(o);
    if (String(o.$class ?? "").endsWith("SpawnActor") && o.actor?.name === "Environment/Music") return true;
    for (const k in o) if (k !== "$outer" && walk(o[k], depth + 1)) return true;
    return false;
  };
  return logic.some(e => walk(e.handlers, 0) || walk(e.actor, 0));
}

/** One stream on a stack. */
export interface StackedStream<T> { item: T; stack: string; level: number }

/** Clyde's StackedStream levels, kept per stack name. */
export class MusicStacks<T> {
  readonly streams: StackedStream<T>[] = [];

  top(stack: string): number {
    let top = -1;
    for (const s of this.streams) if (s.stack === stack) top = Math.max(top, s.level);
    return top;
  }

  /** The streams that play on a stack (its top level), oldest first. */
  playing(stack: string): T[] {
    const top = this.top(stack);
    return this.streams.filter(s => s.stack === stack && s.level === top).map(s => s.item);
  }

  /**
   * Pushes a stream: with `override` it displaces the top level (returned, to fade out),
   * else it joins it.
   */
  push(item: T, stack: string, override: boolean): T[] {
    const top = this.top(stack);
    const displaced = top > -1 && override ? this.playing(stack) : [];
    this.streams.push({ item, stack, level: top === -1 || override ? top + 1 : top });
    return displaced;
  }

  /** Pops a stream: returns the streams that resume (the level below, when it was the last of the top). */
  pop(item: T): T[] {
    const i = this.streams.findIndex(s => s.item === item);
    if (i < 0) return [];
    const [s] = this.streams.splice(i, 1);
    const top = this.top(s.stack);
    return top > -1 && top < s.level ? this.playing(s.stack) : [];
  }

  has(item: T) { return this.streams.some(s => s.item === item); }

  clear() { this.streams.length = 0; }
}
