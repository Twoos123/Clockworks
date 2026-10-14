// Plays the music table (music.ts) as the game goes: the title theme, each floor's track when
// it starts, the boss track once a boss is roused (and the victory fanfare when it falls), the
// arena's boss waves, and stingers for knockouts, revives and the elevator.

import type { AudioSystem } from "../audio";
import type { Environment } from "../environment";
import type { BossKey, Floor } from "./clockworks";
import { BOSS_MUSIC, floorMusic, PLACES, sceneMusic, STINGERS, type Stinger, type Track } from "./music";
import type { World } from "./world";

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

const isBoss = (m: any) => /\/Boss\//.test(m.entity?.name ?? m.def?.name ?? "");

export class MusicPlayer {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** What the floor plays when nothing overrides it. */
  base: Track | null = null;
  /** What plays now (the base or a boss track). */
  playing: Track | null = null;

  constructor(private readonly audio: () => AudioSystem) {}

  private play(t: Track, fadeIn = 1.5) {
    this.playing = t;
    this.audio().playMix(t.files, t.gain, t.crossFade, fadeIn);
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

  /** A floor started: its music, and watchers for bosses, arena boss waves and knockouts. */
  enter(ctx: FloorMusicContext) {
    this.leave();
    const t = MusicPlayer.choose(ctx);
    this.base = t;
    if (t) this.play(t);
    const w = ctx.world;
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
        if (!roused && bosses.some(b => Math.hypot(b.x - k.x, b.y - k.y) < 14 || (b as any).state === "attack")) { roused = true; this.play(fight, 1); }
        else if (seen && gone >= 6) {
          // the boss fell: the victory fanfare, then the level's own music again
          won = true;
          this.stinger("victory");
          this.play(this.base, 4);
        }
      }
      // the arena's every-tenth wave is a boss wave
      const a = w.arena;
      if (a && this.base) {
        const bossWave = a.wave > 0 && a.wave % 10 === 0 && w.liveMonsters.length > 0;
        const want = bossWave ? PLACES.arenaBoss : this.base;
        if (this.playing !== want) this.play(want, 1.5);
      }
    }, 300);
  }

  /** The floor ended (its music fades with the scene). */
  leave() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  stinger(name: Stinger) { void this.audio().stinger(STINGERS[name]); }
}
