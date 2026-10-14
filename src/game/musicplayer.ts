// Plays the music table (music.ts) as the game goes: the title theme, each floor's track when
// it starts, the boss track once a boss is roused (and the victory fanfare when it falls), the
// arena's boss waves, and stingers for knockouts, revives and the elevator.
//
// Music runs on stacks (src/game/musicstack.ts, after Clyde's StackedStream): the floor's own
// track is the bottom of the "default" stack, and the level's logic pushes its scripted music
// (Environment/Music actors: battle music for a wave room, the Royal Jelly court's main theme)
// over it, which takes precedence; destroying the actor plays its Destruction Transient (the
// victory fanfare) and gives the floor its track back. The boss and arena rules change the
// floor's track at the bottom of the stack, heard whenever nothing scripted is over it.

import type { AudioSystem } from "../audio";
import type { Environment } from "../environment";
import type { BossKey, Floor } from "./clockworks";
import { BOSS_MUSIC, floorMusic, PLACES, sceneMusic, STINGERS, type Stinger, type Track } from "./music";
import { MusicStacks, type ScriptedMusic } from "./musicstack";
import type { MusicActor, World } from "./world";

export interface FloorMusicContext {
  /** The scene's name (cached or generated). */
  scene: string;
  /** The scene's own music global (generated floors copy their source's). */
  sceneMusic?: Environment["music"];
  /** The gate floor being played, when in a gate. */
  floor?: Floor | null;
  arena?: boolean;
  boss?: BossKey | null;
  world: World;
}

/** What the player needs of the audio system. */
export type MusicAudio = Pick<AudioSystem, "playMix" | "playMusic" | "stinger" | "unlock" | "layer" | "transient" | "stopMusic">;

/** A stream on a music stack: the floor's own track, or a level-scripted one. */
interface Voice { track: Track; scripted?: ScriptedMusic }

const isBoss = (m: any) => /\/Boss\//.test(m.entity?.name ?? m.def?.name ?? "");
const DEFAULT = "default";

export class MusicPlayer {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** What the floor plays when nothing overrides it. */
  base: Track | null = null;
  /** What plays now in the main slot (the floor's track, a boss track or a scripted one). */
  playing: Track | null = null;
  /** The floor's own stream, at the bottom of the default stack. */
  private floor: Voice | null = null;
  readonly stacks = new MusicStacks<Voice>();
  private scripted = new Map<MusicActor, Voice>();
  /** Streams heard alongside the main slot's (scripted music joining a level), and their stops. */
  private layers = new Map<Voice, (fadeOut?: number) => void>();
  private main: Voice | null = null;
  /** When the last Destruction Transient played (ms), so a boss's fall does not fanfare twice. */
  private lastTransient = -Infinity;
  private world: World | null = null;

  constructor(private readonly audio: () => MusicAudio) {}

  private play(t: Track, fadeIn = 1.5, fadeOut = 1.5) {
    this.playing = t;
    this.audio().playMix(t.files, t.gain, t.crossFade, fadeIn, fadeOut);
  }

  /** The title screen's theme. Browsers hold audio until a gesture, so it starts on the first one. */
  title() {
    this.leave();
    this.base = PLACES.title;
    // (ProjectXApp and dK fade it in over half a second; already playing, it plays on)
    this.play(PLACES.title, 0.5);
    const unlock = () => { this.audio().unlock(); removeEventListener("pointerdown", unlock); removeEventListener("keydown", unlock); };
    addEventListener("pointerdown", unlock);
    addEventListener("keydown", unlock);
  }

  /** The new knight's prologue (client dK): its score once through, at 0.45 after a 0.5 s fade. */
  prologue() {
    this.leave();
    this.base = null;
    const t = PLACES.prologue;
    this.playing = t;
    void this.audio().playMusic(t.files[0].file, t.gain, 0.5, false, 0.5);
  }

  /** The track a floor plays (exported for tests and the docs). */
  static choose(ctx: Omit<FloorMusicContext, "world">): Track | null {
    if (ctx.arena) return PLACES.arena;
    if (ctx.floor) return floorMusic(ctx.floor);
    const own = ctx.sceneMusic;
    if (own?.files.length) return { files: own.files, gain: own.gain, crossFade: own.crossFade ?? 0, source: "the scene's music global" };
    return sceneMusic(ctx.scene);
  }

  /** Whether level-scripted music plays over the floor's track now. */
  get scriptedOnTop(): boolean { return !!this.main?.scripted; }

  /** Brings the audio in line with the stacks' top levels: the oldest in the main slot, others layered. */
  private render(fadeIn: number, fadeOut: number) {
    const heard: Voice[] = [];
    const stacks = new Set(this.stacks.streams.map(s => s.stack));
    const def = this.stacks.playing(DEFAULT);
    const main = def[0] ?? null;
    heard.push(...def.slice(1));
    for (const st of stacks) if (st !== DEFAULT) heard.push(...this.stacks.playing(st));
    if (main && main !== this.main) this.play(main.track, fadeIn, fadeOut);
    else if (!main && this.main) { this.playing = null; this.audio().stopMusic(Math.max(0.05, fadeOut)); }
    this.main = main;
    for (const [v, stop] of this.layers) if (!heard.includes(v)) { stop(fadeOut); this.layers.delete(v); }
    for (const v of heard) {
      if (this.layers.has(v)) continue;
      const f = v.track.files[0];
      if (f) this.layers.set(v, this.audio().layer(f.file, v.track.gain, Math.max(0.05, fadeIn)));
    }
  }

  /** The floor's own track changed (a boss roused, an arena boss wave): heard unless scripted music is over it. */
  private setFloorTrack(t: Track, fade: number) {
    if (!this.floor) return;
    if (this.floor.track === t) return;
    this.floor.track = t;
    if (this.main === this.floor) this.play(t, fade);
  }

  /** A level's music actor spawned: its stream goes on its stack. */
  pushScripted(m: MusicActor) {
    if (this.scripted.has(m)) return;
    const s = m.music;
    const v: Voice = { track: { files: [{ file: s.file, weight: 1 }], gain: s.gain, crossFade: 0, source: `level logic: Environment/Music (${m.entity.tags.join(", ")})` }, scripted: s };
    this.scripted.set(m, v);
    this.stacks.push(v, s.stack, s.override);
    // the displaced level fades out over the new stream's Fade In
    this.render(s.fadeIn, s.fadeIn);
  }

  /** A level's music actor was destroyed: its Destruction Transient plays and its stream leaves the stack. */
  popScripted(m: MusicActor) {
    const v = this.scripted.get(m);
    if (!v) return;
    this.scripted.delete(m);
    const s = m.music;
    if (s.transient) {
      this.lastTransient = Date.now();
      this.audio().transient(s.transient.file, s.transient.gain, s.transient.pitch);
    }
    this.stacks.pop(v);
    this.render(s.fadeOut, s.fadeOut);
  }

  /** A floor started: its music, and watchers for bosses, arena boss waves and knockouts. */
  enter(ctx: FloorMusicContext) {
    this.leave();
    const t = MusicPlayer.choose(ctx);
    this.base = t;
    if (t) {
      this.floor = { track: t };
      this.stacks.push(this.floor, DEFAULT, false);
      this.render(1.5, 1.5);
    }
    const w = ctx.world;
    this.world = w;
    // the level's scripted music: what its logic spawned while starting, then what it spawns
    for (const m of w.musicActors ?? []) this.pushScripted(m);
    w.onMusic = (ev, m) => ev === "spawn" ? this.pushScripted(m) : this.popScripted(m);
    const fight = ctx.boss ? BOSS_MUSIC[ctx.boss].fight : null;
    let roused = false, seen = false, won = false, gone = 0, down = w.defeated;
    this.timer = setInterval(() => {
      // knocked out and revived
      if (w.defeated !== down) { down = w.defeated; this.stinger(down ? "failure" : "resurrect"); }
      if (fight && !won && this.base && w.knight) {
        const k = w.knight;
        // the bosses' logic actors (their monster bodies may still be loading); a boss between
        // phases (one stage gone, the next spawning) is still a boss
        const bosses = [...w.monsters.filter(m => isBoss(m) && m.state !== "dying"),
          ...w.logic.actors.filter(e => !e.destroyed && e.mobile && !e.game && /\/Boss\//.test(e.name))];
        if (bosses.length) seen = true;
        gone = bosses.length ? 0 : gone + 1;
        if (!roused && bosses.some(b => Math.hypot(b.x - k.x, b.y - k.y) < 14 || (b as any).state === "attack")) { roused = true; this.setFloorTrack(fight, 1); }
        else if (seen && gone >= 6) {
          // the boss fell: the victory fanfare (unless the level's own music just played it),
          // then the level's own music again
          won = true;
          if (Date.now() - this.lastTransient > 8000) this.stinger("victory");
          this.setFloorTrack(this.base, 4);
        }
      }
      // the arena's every-tenth wave is a boss wave
      const a = w.arena;
      if (a && this.base) {
        const bossWave = a.wave > 0 && a.wave % 10 === 0 && w.liveMonsters.length > 0;
        this.setFloorTrack(bossWave ? PLACES.arenaBoss : this.base, 1.5);
      }
    }, 300);
  }

  /** The floor ended (its music fades with the scene). */
  leave() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.world?.onMusic) this.world.onMusic = null;
    this.world = null;
    for (const stop of this.layers.values()) stop(1);
    this.layers.clear();
    this.scripted.clear();
    this.stacks.clear();
    this.floor = null;
    this.main = null;
  }

  stinger(name: Stinger) { void this.audio().stinger(STINGERS[name]); }
}
