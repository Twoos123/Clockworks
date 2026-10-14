// Meta particle layers whose particles are scripted models. A MetaParticleSystemConfig layer
// gives every particle a model of its own; when that model is a ScriptedConfig (the bombs'
// area explosion: particle/explosion/part_bomb_areaexplosion.dat emits
// model/scripted/transient_sound.dat particles, one at the centre and eight on the blast
// ring, each spawning a bomb_blast.dat transient and playing the blast sound), the particle
// draws nothing and its script is what shows. The renderer draws meta particles' meshes only,
// so the world steps these layers itself and runs each new particle's script where it is born.

import type { Mat4 } from "../math";
import type { LoadedModel } from "../model";
import { Emitter, type Particle, type ParticleLayer } from "../particles";

/** Whether a model (or one of its attachments) is scripted. */
export function hasScript(m: LoadedModel | null | undefined, depth = 0): boolean {
  if (!m || depth > 6) return false;
  return !!m.script || m.attachments.some(a => hasScript(a.model, depth + 1));
}

/** A particle born on a scripted meta layer: its model, where it is and how long it lives. */
export interface MetaBirth { model: LoadedModel; matrix: Mat4; life: number }

export class MetaScripts {
  private readonly emitter: Emitter;
  private readonly seen = new WeakSet<Particle>();

  private constructor(private readonly layers: ParticleLayer[]) {
    this.emitter = new Emitter(layers);
  }

  /** The scripted meta layers of a model's own particle system, or null when it has none. */
  static of(model: LoadedModel): MetaScripts | null {
    const layers = (model.particles ?? []).filter(l => l.model && l.geometry !== "Meshes" && hasScript(l.model));
    return layers.length ? new MetaScripts(layers) : null;
  }

  /** Whether a layer keeps emitting (its effect then lives as long as its owner says). */
  get endless(): boolean {
    return this.layers.some(l => l.respawn || l.counter.kind === "ConstantRate");
  }

  /** True once every layer has emitted all it will and its particles have died. */
  get done(): boolean {
    return !this.endless && this.emitter.states.every(s => s.spawned >= s.layer.count && s.particles.length === 0);
  }

  /** Steps the layers `dt` seconds at `matrix`; returns the particles born in that time. */
  step(dt: number, matrix: Mat4): MetaBirth[] {
    this.emitter.update(dt, matrix);
    const out: MetaBirth[] = [];
    this.emitter.states.forEach((s, li) => {
      if (!s.particles.some(p => !this.seen.has(p))) return;
      const matrices = this.emitter.meshMatrices(li, matrix);
      s.particles.forEach((p, i) => {
        if (this.seen.has(p)) return;
        this.seen.add(p);
        out.push({ model: s.layer.model!, matrix: matrices[i], life: Math.max(0.01, p.life - p.age) });
      });
    });
    return out;
  }
}
