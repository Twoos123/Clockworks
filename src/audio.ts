// Sound through Web Audio, driven by the game's sounder configs (config/sounder.dat and
// SounderConfig references), after Clyde's com.threerings.openal: clips and meta clips with
// gain and pitch, random and weighted choices, compound, sequential and scripted sounders,
// and streams for music. Sounds attenuate with distance from the listener the way OpenAL's
// inverse-distance-clamped model does, using each sounder's reference distance and rolloff.

import { applyArguments } from "./config/params";
import type { ModelLoader } from "./model";
import type { Vfs } from "./vfs";

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };
type Vec3 = [number, number, number];

/** probs.FloatVariable: Constant or Uniform. */
function variable(v: any, d: number): number {
  if (v == null) return d;
  if (typeof v === "number") return v;
  switch (kind(v)) {
    case "Constant": return v.value ?? d;
    case "Uniform": { const lo = v.minimum ?? d, hi = v.maximum ?? lo; return lo + Math.random() * (hi - lo); }
    default: return v.value ?? d;
  }
}

function weighted<T extends { weight?: number }>(list: T[]): T | null {
  const total = list.reduce((s, x) => s + (x.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const x of list) { r -= x.weight ?? 1; if (r <= 0) return x; }
  return list[list.length - 1] ?? null;
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private sounders: Promise<Map<string, any>>;
  private listener: Vec3 = [0, 0, 0];
  private music: { key: string; source: AudioBufferSourceNode; gain: GainNode; loop: boolean; duration: number } | null = null;
  /** Looping ambient sources, stopped together when leaving a scene. */
  private loops: AudioBufferSourceNode[] = [];
  /** Limits how many copies of one file may start within a short window (bullet storms). */
  private recent = new Map<string, number>();
  volume = 0.8;
  musicVolume = 0.45;
  /** Sound effects and menu sounds, relative to the master volume. */
  effectsVolume = 1;
  uiVolume = 1;
  muted = false;

  constructor(private readonly vfs: Vfs, loader: ModelLoader) {
    this.sounders = loader.importFile("config/sounder.dat").then(root => {
      const list: any[] = Array.isArray(root) ? root : (root as any)?.array ?? [];
      return new Map(list.map(c => [c.name as string, c]));
    }).catch(() => new Map());
  }

  /** Browsers start audio only after a user gesture; call from one. */
  unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.connect(this.master);
      this.applyVolumes();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  applyVolumes() {
    if (!this.master || !this.musicBus) return;
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.musicBus.gain.value = this.musicVolume;
    if (this.sfx) this.sfx.gain.value = this.effectsVolume;
  }

  setListener(p: Vec3) { this.listener = p; }

  private buffer(file: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(file);
    if (!p) {
      p = (async () => {
        try {
          const bytes = await this.vfs.read(file);
          return await this.ctx!.decodeAudioData(bytes.slice().buffer);
        } catch { return null; }
      })();
      this.buffers.set(file, p);
    }
    return p;
  }

  /** Resolves a SounderConfig reference (library name or derived) to a config with arguments applied. */
  private async resolve(ref: any, depth = 0): Promise<any | null> {
    if (!ref?.name || depth > 10) return null;
    const lib = await this.sounders;
    const base = lib.get(ref.name);
    if (!base) return null;
    const cfg = applyArguments(base, ref);
    if (cfg.$class?.endsWith("DerivedConfig")) return this.resolve(cfg.base, depth + 1);
    return cfg;
  }

  /** Plays a sounder reference at a world position (null plays it without attenuation). */
  play(ref: any, pos: Vec3 | null = null) {
    if (!this.ctx || this.muted || !ref) return;
    void this.resolve(ref).then(cfg => cfg && this.start(cfg, pos, 0));
  }

  private start(cfg: any, pos: Vec3 | null, delay: number, depth = 0) {
    if (depth > 8) return;
    switch (kind(cfg)) {
      case "Clip": void this.clip(cfg.file, cfg.gain ?? 1, cfg.pitch ?? 1, !!cfg.loop, cfg, pos, delay); break;
      case "VariableClip": void this.clip(cfg.file, variable(cfg.gain, 1), variable(cfg.pitch, 1), !!cfg.loop, cfg, pos, delay); break;
      case "MetaClip": {
        const f = weighted<any>(cfg.files ?? []);
        if (f) void this.clip(f.file, (cfg.gain ?? 1) * (f.gain ?? 1), (cfg.pitch ?? 1) * (f.pitch ?? 1), !!cfg.loop, cfg, pos, delay);
        break;
      }
      case "Random": {
        const s = weighted<any>(cfg.sounders ?? []);
        if (s?.sounder) void this.resolve(s.sounder).then(c => c && this.start(c, pos, delay, depth + 1));
        break;
      }
      case "Compound":
        for (const s of cfg.sounders ?? []) if (s?.sounder) void this.resolve(s.sounder).then(c => c && this.start(c, pos, delay, depth + 1));
        break;
      case "Scripted":
        for (const s of cfg.sounders ?? []) if (s?.sounder) void this.resolve(s.sounder).then(c => c && this.start(c, pos, delay + (s.time ?? 0), depth + 1));
        break;
      case "Sequential": {
        // approximated by starting each component after the previous one's length
        void (async () => {
          let at = delay;
          for (const s of cfg.sounders ?? []) {
            const c = s?.sounder ? await this.resolve(s.sounder) : null;
            if (!c) continue;
            this.start(c, pos, at, depth + 1);
            const file = c.file ?? c.files?.[0]?.file;
            const b = file ? await this.buffer(file) : null;
            at += b?.duration ?? 0.5;
          }
        })();
        break;
      }
      case "Conditional":
        if (cfg.defaultSounder) void this.resolve(cfg.defaultSounder).then(c => c && this.start(c, pos, delay, depth + 1));
        break;
      case "Stream": case "MetaStream": this.stream(cfg); break;
    }
  }

  /** OpenAL's inverse distance clamped model. */
  private attenuation(cfg: any, pos: Vec3 | null): number {
    if (!pos || cfg.sourceRelative) return 1;
    const ref = cfg.referenceDistance ?? 1, roll = cfg.rolloffFactor ?? 1, max = cfg.maxDistance ?? Infinity;
    const [x, y, z] = this.listener;
    let d = Math.hypot(pos[0] - x, pos[1] - y, (pos[2] - z) * 0.5);
    d = Math.max(ref, Math.min(d, max));
    const g = ref / (ref + roll * (d - ref));
    return Math.max(cfg.minGain ?? 0, Math.min(cfg.maxGain ?? 1, g));
  }

  /**
   * Plays a clip sounder until the returned function stops it (a weapon's charging hum and its
   * looping "ready" tone).
   */
  hold(ref: any, pos: Vec3 | null = null): () => void {
    let stopped = false;
    const sources: AudioBufferSourceNode[] = [];
    if (this.ctx && !this.muted && ref) {
      void this.resolve(ref).then(cfg => {
        if (!cfg || stopped) return;
        const k = kind(cfg);
        if (k === "Clip" || k === "VariableClip") {
          void this.clip(cfg.file, variable(cfg.gain, 1), variable(cfg.pitch, 1), !!cfg.loop, cfg, pos, 0, false,
            s => { if (stopped) { try { s.stop(); } catch { /* not started */ } } else sources.push(s); });
        }
      });
    }
    return () => {
      stopped = true;
      for (const s of sources.splice(0)) { try { s.stop(); } catch { /* already stopped */ } }
    };
  }

  private async clip(file: string | undefined, gain: number, pitch: number, loop: boolean, cfg: any, pos: Vec3 | null, delay: number, ambient = false,
    onSource?: (s: AudioBufferSourceNode) => void) {
    if (!file || !this.ctx || !this.sfx) return;
    const att = this.attenuation(cfg, pos);
    if (att * gain < 0.01) return;
    const now = this.ctx.currentTime;
    if ((this.recent.get(file) ?? -1) > now - 0.03) return;
    this.recent.set(file, now);
    const buf = await this.buffer(file);
    if (!buf || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    src.loop = loop;
    const g = this.ctx.createGain();
    g.gain.value = Math.min(2, gain * att);
    src.connect(g).connect(this.sfx);
    src.start(this.ctx.currentTime + delay);
    // a looping clip from a one-shot trigger would never stop; cap it unless it is ambience or held
    if (ambient) this.loops.push(src);
    else if (loop && !onSource) src.stop(this.ctx.currentTime + delay + 8);
    onSource?.(src);
  }

  /** A UI feedback sound (StyleConfig feedbackSound files such as sound/feedback/ui_confirm.ogg). */
  ui(file: string, gain = 0.8) { void this.clip(file, gain * this.uiVolume / Math.max(0.01, this.effectsVolume), 1, false, {}, null, 0); }

  /** Starts a looping ambient sounder (wind, rain) that plays until stopAmbience. */
  ambient(ref: any) {
    if (!this.ctx || !ref) return;
    void this.resolve(ref).then(cfg => {
      if (!cfg) return;
      const k = kind(cfg);
      if (k === "Clip" || k === "VariableClip") void this.clip(cfg.file, variable(cfg.gain, 1), variable(cfg.pitch, 1), true, { sourceRelative: true }, null, 0, true);
    });
  }

  stopAmbience() {
    for (const s of this.loops.splice(0)) { try { s.stop(); } catch { /* already stopped */ } }
  }

  /** Music: one stream at a time, cross-faded. A Meta Stream plays as a mix (playMix). */
  private stream(cfg: any) {
    if (kind(cfg) === "MetaStream") {
      const files = (cfg.files ?? []).filter((f: any) => f?.file).map((f: any) => ({ file: f.file as string, weight: f.weight ?? 1 }));
      this.playMix(files, cfg.gain ?? 1, cfg.crossFade ?? 0, cfg.fadeIn ?? 1);
      return;
    }
    const files: { file: string; loop: boolean }[] = (cfg.queue ?? []).map((q: any) => ({ file: q.file, loop: !!q.loop }));
    const pick = files.find(f => f.loop) ?? files[files.length - 1];
    if (pick?.file) void this.playMusic(pick.file, cfg.gain ?? 1, cfg.fadeIn ?? 1);
  }

  /** The music file playing (or last asked for), for tests and the docs. */
  nowPlaying: string | null = null;
  /** The last stinger started. */
  lastStinger: string | null = null;
  private musicToken = 0;
  private mixState: { key: string; files: { file: string; weight: number }[]; gain: number; crossFade: number; last: string; timer: ReturnType<typeof setTimeout> | null } | null = null;

  /**
   * Plays one music file, cross-fading from whatever plays now. A looping file repeats until
   * replaced, and asking for it again keeps it playing. Concurrent requests resolve to the
   * last one: a slow decode never starts over a newer track.
   */
  async playMusic(file: string, gain = 1, fadeIn = 1.5, loop = true, fadeOut = 1.5) {
    if (!this.ctx || !this.musicBus) return;
    if (loop) this.clearMix();
    if (loop && this.music?.key === file && this.music.loop) { this.musicToken++; this.setMusicGain(gain, fadeIn); return; }
    const token = ++this.musicToken;
    this.nowPlaying = file;
    const buf = await this.buffer(file);
    if (!buf || !this.ctx || token !== this.musicToken) return;
    this.fadeOutMusic(fadeOut);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.max(0.05, fadeIn));
    src.connect(g).connect(this.musicBus);
    src.start();
    this.music = { key: file, source: src, gain: g, loop, duration: buf.duration };
  }

  /**
   * A Meta Stream: plays a weighted pick from the files through, then another (not the same
   * one twice running when there is a choice), cross-fading over `crossFade` seconds. A single
   * file loops. Asking for the mix that already plays keeps it going.
   */
  playMix(files: { file: string; weight: number }[], gain = 1, crossFade = 0, fadeIn = 1.5) {
    if (!files.length) return;
    if (files.length === 1) { void this.playMusic(files[0].file, gain, fadeIn); return; }
    const key = files.map(f => f.file).join("|");
    if (this.mixState?.key === key) { this.mixState.gain = gain; this.setMusicGain(gain, fadeIn); return; }
    this.clearMix();
    this.mixState = { key, files, gain, crossFade, last: "", timer: null };
    void this.nextInMix(fadeIn);
  }

  private async nextInMix(fadeIn: number) {
    const m = this.mixState;
    if (!m) return;
    const choices = m.files.length > 1 ? m.files.filter(f => f.file !== m.last) : m.files;
    const pick = weighted(choices) ?? m.files[0];
    m.last = pick.file;
    await this.playMusic(pick.file, m.gain, fadeIn, false, Math.max(0.05, m.crossFade));
    const cur = this.music;
    if (this.mixState !== m || cur?.key !== pick.file) return;
    const lead = Math.min(m.crossFade, cur.duration / 2);
    m.timer = setTimeout(() => { if (this.mixState === m) void this.nextInMix(Math.max(0.05, m.crossFade)); },
      Math.max(1000, (cur.duration - lead) * 1000));
  }

  private clearMix() {
    if (this.mixState?.timer) clearTimeout(this.mixState.timer);
    this.mixState = null;
  }

  /** Ramps the playing track to a new level (the same track asked for at another gain). */
  private setMusicGain(gain: number, time: number) {
    const m = this.music;
    if (!m || !this.ctx) return;
    const t = this.ctx.currentTime;
    m.gain.gain.cancelScheduledValues(t);
    m.gain.gain.setValueAtTime(m.gain.gain.value, t);
    m.gain.gain.linearRampToValueAtTime(gain, t + Math.max(0.05, time));
  }

  /** A one-shot stinger (a fanfare) over the music, which ducks under it. */
  async stinger(file: string, gain = 0.8, duck = 0.3) {
    if (!this.ctx || !this.musicBus || !this.master) return;
    this.lastStinger = file;
    const buf = await this.buffer(file);
    if (!buf || !this.ctx || !this.musicBus || !this.master) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain * this.musicVolume / 0.45;
    src.connect(g).connect(this.master);
    const t = this.ctx.currentTime, bus = this.musicBus.gain, full = this.musicVolume;
    bus.cancelScheduledValues(t);
    bus.setValueAtTime(bus.value, t);
    bus.linearRampToValueAtTime(full * duck, t + 0.3);
    bus.setValueAtTime(full * duck, t + Math.max(0.3, buf.duration - 0.5));
    bus.linearRampToValueAtTime(full, t + buf.duration + 0.5);
    src.start();
  }

  /** Fades the current track out; it stops once silent. */
  private fadeOutMusic(fadeOut: number) {
    const m = this.music;
    if (!m || !this.ctx) return;
    const t = this.ctx.currentTime;
    m.gain.gain.cancelScheduledValues(t);
    m.gain.gain.setValueAtTime(m.gain.gain.value, t);
    m.gain.gain.linearRampToValueAtTime(0, t + fadeOut);
    m.source.stop(t + fadeOut + 0.05);
    this.music = null;
  }

  stopMusic(fadeOut = 1) {
    this.clearMix();
    this.musicToken++;
    this.nowPlaying = null;
    this.fadeOutMusic(fadeOut);
  }
}
