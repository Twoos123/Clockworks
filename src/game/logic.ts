// Tudey's server-side logic (com.threerings.tudey.server.logic), reimplemented after the
// open-source Clyde code: scene entries and actors carry handlers (startup, timers, signals,
// intersection sensors, actor-removed observers...) that run actions (spawn, signal,
// destroy, delayed, conditional...) on targets (tagged, activator...) under conditions.
// See docs/research/tudey-logic.md for the semantics this follows. Game-specific actions
// and handlers (Spiral Knights' own, in closed code) are passed to the host.

import { applyArguments } from "../config/params";
import { centroid, expand, intersects, shapeFromConfig, type Shape } from "./shapes";

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };
const pkg = (o: any) => String(o?.$class ?? "");
const normalize = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** An entry (placeable or area) or an actor: anything with handlers, tags and a place. */
export class Entity {
  tags: string[] = [];
  x = 0; y = 0; rotation = 0;
  handlers: Handler[] = [];
  vars = new Map<string, unknown>();
  /** A fixed world shape (entries), or a shape config placed at the actor's position. */
  fixedShape: Shape | null = null;
  shapeConfig: any = null;
  /** Actors: collision flags (sensor masks test these) and whether they move (trigger sensors). */
  collisionFlags = 0;
  mobile = false;
  destroyed = false;
  removed = false;
  /** Actors: who spawned it and on whose behalf (ActivatorOf). */
  source: Entity | null = null;
  activator: Entity | null = null;
  /** The host's game object for an actor. */
  game: any = null;
  /** Actors: the ActorConfig's handlers, created when the actor starts. */
  handlerConfigs: any[] = [];
  constructor(readonly isActor: boolean, readonly name = "") {}

  shape(): Shape | null {
    if (this.fixedShape) return this.fixedShape;
    return this.shapeConfig ? shapeFromConfig(this.shapeConfig, this.x, this.y, this.rotation) : null;
  }
  hasTag(t: string) { return this.tags.includes(t); }
}

/** What the logic needs from the game. */
export interface LogicHost {
  /** Creates an actor from an ActorConfig reference; the engine starts it. */
  createActor(ref: any, x: number, y: number, rotation: number): Entity | null;
  /** Called when an actor is destroyed (its handlers have shut down). */
  actorDestroyed(e: Entity): void;
  fireEffect(ref: any, x: number, y: number, rotation: number): void;
  /** Game-specific actions; return undefined for unknown ones. */
  gameAction(cfg: any, source: Entity, activator: Entity | null, logic: Logic): boolean | undefined;
  log?(msg: string): void;
}

type Handler = {
  cfg: any; kind: string; source: Entity;
  /** Transition handlers: activators seen this tick. */
  activated?: Map<Entity, boolean>;
  min?: number;
  limit?: number;
  lastCount?: number;
  timer?: Timer | null;
  warnTimer?: Timer | null;
  children?: Handler[];
  /** Sensor shape for intersection handlers. */
  sensor?: Shape | null;
};

interface Timer { at: number; run: () => void; cancelled: boolean; owner: Entity }

export class Logic {
  /** Milliseconds of scene time. */
  ts = 0;
  readonly entries: Entity[] = [];
  readonly actors: Entity[] = [];
  private tagMap = new Map<string, Entity[]>();
  private timers: Timer[] = [];
  private tickers = new Set<Handler>();
  private observers: Handler[] = [];
  private sensors: Handler[] = [];
  private removals: Entity[] = [];
  private limits = new WeakMap<object, number>();
  private cooldowns = new WeakMap<object, number>();
  private started = false;

  constructor(readonly host: LogicHost, private readonly libs: {
    /** Resolves a ParameterizedHandlerConfig reference to its handler configs. */
    handlerRef?: (ref: any) => any[];
  } = {}) {}

  // ------------------------------------------------------------------ entities

  private map(e: Entity) {
    for (const t of e.tags) {
      if (!t) continue;
      let l = this.tagMap.get(t);
      if (!l) this.tagMap.set(t, l = []);
      l.push(e);
    }
  }
  private unmap(e: Entity) {
    for (const t of e.tags) {
      const l = this.tagMap.get(t);
      if (!l) continue;
      const i = l.indexOf(e);
      if (i >= 0) l.splice(i, 1);
      if (!l.length) this.tagMap.delete(t);
    }
  }
  tagged(tag: string): Entity[] { return this.tagMap.get(tag) ?? []; }

  private makeHandlers(cfgs: any[], source: Entity): Handler[] {
    const out: Handler[] = [];
    for (const cfg of cfgs ?? []) {
      if (!cfg?.$class) continue;
      const k = kind(cfg);
      if (k === "None") continue;
      const h: Handler = { cfg, kind: k, source };
      if (k === "Reference") h.children = this.makeHandlers(this.libs.handlerRef?.(cfg.handler) ?? [], source);
      out.push(h);
    }
    return out;
  }

  /** Adds a scene entry (call startEntries once every entry is added). */
  addEntry(e: Entity, handlerConfigs: any[]) {
    e.handlers = this.makeHandlers(handlerConfigs, e);
    this.entries.push(e);
    this.map(e);
    if (this.started) for (const h of e.handlers) this.startup(h);
  }

  startEntries() {
    this.started = true;
    for (const e of [...this.entries]) for (const h of e.handlers) this.startup(h);
  }

  /** Spawns an actor through the host and starts it (SpawnActor's order). */
  spawn(ref: any, x: number, y: number, rotation: number, source: Entity | null, activator: Entity | null): Entity | null {
    const e = this.host.createActor(ref, x, y, rotation);
    if (!e) return null;
    e.source = source;
    e.activator = activator;
    this.startActor(e);
    return e;
  }

  /** Starts an actor the host created: handlers start, then it is mapped and observed. */
  startActor(e: Entity) {
    e.handlers = this.makeHandlers(e.handlerConfigs, e);
    for (const h of e.handlers) this.startup(h);
    this.actors.push(e);
    this.map(e);
    for (const o of [...this.observers].reverse()) this.observeAdded(o, e);
  }

  /** DestroyActor: shutdown handlers now, removal (and ActorRemoved) on the next tick. */
  destroy(e: Entity, activator: Entity | null, endScene = false) {
    if (!e.isActor || e.destroyed) return;
    e.destroyed = true;
    for (const h of e.handlers) this.shutdown(h, activator ?? e, endScene);
    this.host.actorDestroyed(e);
    this.removals.push(e);
  }

  /**
   * Removes an actor without its shutdown handlers (no loot, no death actions): two lichens
   * that fuse leave the field as one new colony, not as two kills.
   */
  vanish(e: Entity) {
    if (!e.isActor || e.destroyed) return;
    e.destroyed = true;
    this.removals.push(e);
  }

  private remove(e: Entity) {
    if (e.removed) return;
    e.removed = true;
    const i = this.actors.indexOf(e);
    if (i >= 0) this.actors.splice(i, 1);
    this.unmap(e);
    for (const t of this.timers) if (t.owner === e) t.cancelled = true;
    for (const o of [...this.observers].reverse()) this.observeRemoved(o, e);
  }

  // ------------------------------------------------------------------ events from the game

  signal(target: Entity, source: Entity, name: string) {
    if (target.isActor && target.destroyed) return;
    target.game?.onSignal?.(name, source);
    for (const h of [...target.handlers]) this.handleSignal(h, source, name);
  }

  /** ProjectX Interaction handlers: the player used the entity (pressed the action key). */
  interact(target: Entity, activator: Entity) {
    for (const h of target.handlers) if (h.kind === "Interaction") this.run(h.cfg.action, h.source, activator);
  }

  /** ProjectX Damage handlers: the entity took damage from the activator. */
  damaged(target: Entity, activator: Entity | null) {
    for (const h of target.handlers) if (h.kind === "Damage") this.run(h.cfg.action, h.source, activator ?? h.source);
  }

  setVariable(target: Entity, setter: Entity, name: string, value: unknown) {
    target.vars.set(name, value);
    for (const h of target.handlers) if (h.kind === "VariableChanged") this.run(h.cfg.action, h.source, setter);
  }

  // ------------------------------------------------------------------ handlers

  /**
   * A handler's action. The game's triggers (spawn markers, one-time actions, buttons) wrap
   * their action in a Conditional whose condition the export leaves out, yet they fire in the
   * game; a condition-less Conditional directly under a handler runs its action. Deeper
   * ones keep Clyde's default condition (an empty tag, which fails), so optional extras
   * such as pet skills in loot drops stay off.
   */
  private run(action: any, source: Entity, activator: Entity | null): boolean {
    if (action && kind(action) === "Conditional" && action.condition == null) return this.execute(action.action, source, activator);
    return this.execute(action, source, activator);
  }

  private schedule(owner: Entity, delayMs: number, run: () => void): Timer {
    const t: Timer = { at: this.ts + Math.max(0, delayMs), run, cancelled: false, owner };
    this.timers.push(t);
    return t;
  }

  private startup(h: Handler) {
    const cfg = h.cfg, src = h.source;
    switch (h.kind) {
      case "Startup": this.run(cfg.action, src, src); break;
      case "Reference": for (const c of h.children ?? []) this.startup(c); break;
      case "Tick": this.tickers.add(h); break;
      case "Timer": case "WarnTimer": {
        const interval = cfg.interval ?? 1, offset = cfg.offset ?? 0;
        h.limit = (cfg.limit ?? 0) === 0 ? Infinity : cfg.limit;
        const fire = () => {
          if (src.removed) return;
          this.run(cfg.action, src, src);
          if (--h.limit! > 0) h.timer = this.schedule(src, interval * 1000, fire);
        };
        h.timer = this.schedule(src, Math.max(0, interval + offset) * 1000, fire);
        const warn = cfg.warn ?? 0;
        if (h.kind === "WarnTimer" && warn > 0 && warn <= interval && cfg.warnAction) {
          const wfire = () => {
            this.run(cfg.warnAction, src, src);
            if ((h.limit ?? 0) > 1) h.warnTimer = this.schedule(src, interval * 1000, wfire);
          };
          h.warnTimer = this.schedule(src, (interval - warn + offset) * 1000, wfire);
        }
        break;
      }
      case "ActorAdded": case "ActorRemoved":
        h.lastCount = this.resolveTarget(cfg.target ?? { $class: "TargetConfig$Tagged", tag: "" }, src, src).length;
        this.observers.push(h);
        break;
      case "Intersection": case "IntersectionStart": case "IntersectionStop": case "ThresholdIntersectionCount":
      case "PartyIntersection": {
        const shp = cfg.shape;
        if (shp && kind(shp) === "TransformedShape") h.sensor = shapeFromConfig(shp.shape ?? { $class: "Point" }, src.x, src.y, src.rotation);
        else { const s = src.shape(); h.sensor = s ? expand(s, shp?.expansion ?? 0) : null; }
        if (h.sensor || src.isActor) this.sensors.push(h);
        break;
      }
    }
  }

  private shutdown(h: Handler, activator: Entity, endScene: boolean) {
    switch (h.kind) {
      case "Shutdown": if (!endScene) this.run(h.cfg.action, h.source, activator); break;
      case "Reference": for (const c of h.children ?? []) this.shutdown(c, activator, endScene); break;
      case "Tick": this.tickers.delete(h); break;
      case "Timer": case "WarnTimer":
        if (h.timer) h.timer.cancelled = true;
        if (h.warnTimer) h.warnTimer.cancelled = true;
        break;
      case "ActorAdded": case "ActorRemoved": { const i = this.observers.indexOf(h); if (i >= 0) this.observers.splice(i, 1); break; }
      default: {
        const i = this.sensors.indexOf(h);
        if (i >= 0) this.sensors.splice(i, 1);
        this.tickers.delete(h);
      }
    }
  }

  private handleSignal(h: Handler, source: Entity, name: string) {
    const cfg = h.cfg;
    switch (h.kind) {
      case "Signal":
        if (!nameMatches(cfg.name, name, h.source) || this.ts < (h.min ?? 0)) return;
        this.run(cfg.action, h.source, source);
        h.min = Math.round(this.ts + (cfg.refractoryPeriod ?? 0) * 1000);
        break;
      case "SignalStart": case "SignalStop":
        if (nameMatches(cfg.name, name, h.source)) this.activate(h, source);
        break;
      case "Reference": for (const c of h.children ?? []) this.handleSignal(c, source, name); break;
    }
  }

  /** Transition handlers: start fires on a new activator; stop when one goes quiet for a tick. */
  private activate(h: Handler, a: Entity) {
    h.activated ??= new Map();
    const was = h.activated.has(a);
    h.activated.set(a, true);
    this.tickers.add(h);
    if (!was && (h.kind === "SignalStart" || h.kind === "IntersectionStart" || h.kind === "PartyIntersection")) this.run(h.cfg.action, h.source, a);
  }

  private tickHandler(h: Handler) {
    if (h.kind === "Tick") { this.run(h.cfg.action, h.source, h.source); return; }
    const m = h.activated;
    if (!m) { this.tickers.delete(h); return; }
    for (const [a, on] of [...m]) {
      if (on) { m.set(a, false); continue; }
      if (h.kind === "SignalStop" || h.kind === "IntersectionStop") this.run(h.cfg.action, h.source, a);
      m.delete(a);
    }
    if (h.kind === "ThresholdIntersectionCount") {
      const n = m.size, last = h.lastCount ?? -1, threshold = h.cfg.threshold ?? 0;
      if (n !== last) {
        if (last < threshold && n >= threshold) this.run(h.cfg.action, h.source, h.source);
        else if (h.cfg.underAction && last >= threshold && n < threshold) this.run(h.cfg.underAction, h.source, h.source);
      }
      h.lastCount = n;
      if (n === 0) this.tickers.delete(h);
      return;
    }
    if (!m.size) this.tickers.delete(h);
  }

  private observeAdded(h: Handler, a: Entity) {
    const n = this.resolveTarget(h.cfg.target ?? { $class: "TargetConfig$Tagged", tag: "" }, h.source, a).length;
    if (n > (h.lastCount ?? 0)) {
      if (h.kind === "ActorAdded") this.run(h.cfg.action, h.source, a);
      h.lastCount = n;
    }
  }

  private observeRemoved(h: Handler, a: Entity) {
    if ((h.lastCount ?? 0) <= 0) return;
    const n = this.resolveTarget(h.cfg.target ?? { $class: "TargetConfig$Tagged", tag: "" }, h.source, a).length;
    if (n < (h.lastCount ?? 0)) {
      if (h.kind === "ActorRemoved" && (h.cfg.all === false || h.lastCount === 1)) this.run(h.cfg.action, h.source, a);
      h.lastCount = n;
    }
  }

  // ------------------------------------------------------------------ tick

  /** Advances scene time: removals, sensors, tickers, then due timers. */
  tick(dtMs: number) {
    this.ts += dtMs;
    for (const e of this.removals.splice(0)) this.remove(e);
    // sensors: moving actors trigger intersection handlers whose mask matches their flags
    for (const a of this.actors) {
      if (!a.mobile || a.destroyed || !a.collisionFlags) continue;
      const shape = a.shape();
      if (!shape) continue;
      for (const h of [...this.sensors]) {
        if (h.source === a) continue;
        const sensor = h.source.isActor ? (() => { const s = h.source.shape(); return s ? expand(s, h.cfg.shape?.expansion ?? 0) : null; })() : h.sensor;
        if (!sensor || ((h.cfg.mask ?? 0xffff) & a.collisionFlags) === 0 || !intersects(sensor, shape)) continue;
        this.trigger(h, a);
      }
    }
    for (const h of [...this.tickers]) this.tickHandler(h);
    const due = this.timers.filter(t => t.at <= this.ts);
    this.timers = this.timers.filter(t => t.at > this.ts && !t.cancelled);
    for (const t of due.sort((a, b) => a.at - b.at)) if (!t.cancelled) t.run();
  }

  private trigger(h: Handler, a: Entity) {
    switch (h.kind) {
      case "Intersection":
        if (this.ts < (h.min ?? 0)) return;
        this.run(h.cfg.action, h.source, a);
        h.min = Math.round(this.ts + (h.cfg.refractoryPeriod ?? 0) * 1000);
        break;
      case "IntersectionStart": case "IntersectionStop": case "PartyIntersection": this.activate(h, a); break;
      case "ThresholdIntersectionCount": {
        const cond = h.cfg.condition;
        if (!cond || this.condition(cond, h.source, a)) this.activate(h, a);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ actions

  /** ActionConfig.execute; returns the action's success. */
  execute(cfg: any, source: Entity, activator: Entity | null): boolean {
    // a parameter-built action with no class name but a signal name is a Signal
    if (cfg && !cfg.$class && typeof cfg.name === "string") cfg = { ...cfg, $class: "com.threerings.tudey.config.ActionConfig$Signal" };
    // ...and one with an actor is the default SpawnActor
    else if (cfg && !cfg.$class && cfg.actor?.name) cfg = { ...cfg, $class: "com.threerings.tudey.config.ActionConfig$SpawnActor" };
    if (!cfg?.$class) return true;
    const k = kind(cfg);
    if (!pkg(cfg).includes("tudey.config.ActionConfig")) {
      return this.host.gameAction(cfg, source, activator, this) ?? true;
    }
    switch (k) {
      case "None": case "ServerLog": return true;
      case "Compound": {
        let ok = false;
        for (const a of cfg.actions ?? []) {
          if (!a) continue;
          ok = this.execute(a, source, activator) || ok;
          if (cfg.stopOnFailure && !ok) return false;
        }
        return ok;
      }
      case "Conditional":
        // a missing condition is Clyde's default Tagged{tag: ""}, which no entity satisfies
        if (cfg.condition != null && this.condition(cfg.condition, source, activator)) return this.execute(cfg.action, source, activator);
        return cfg.elseAction ? this.execute(cfg.elseAction, source, activator) : true;
      case "Switch": {
        for (const c of cfg.cases ?? []) if (this.condition(c.condition, source, activator)) return this.execute(c.action, source, activator);
        return cfg.defaultAction ? this.execute(cfg.defaultAction, source, activator) : true;
      }
      case "ExpressionSwitch": {
        const v = this.expression(cfg.value, source, activator);
        const cases: any[] = cfg.cases ?? [];
        // the export drops every case value in some switches (loot sizes and kinds); the
        // parameter options give their order, so match the switch value by position there
        if (cases.length && cases.every(c => c.value === undefined) && typeof v === "string") {
          const vocab = CASE_ORDERS.find(o => o.includes(v.toLowerCase()));
          const i = vocab ? vocab.indexOf(v.toLowerCase()) : -1;
          if (i >= 0 && i < cases.length) return this.execute(cases[i].action, source, activator);
          if (v === "" && cases[0]) return this.execute(cases[0].action, source, activator);
        }
        for (const c of cases) if (valuesEqual(v, this.expression(c.value, source, activator))) return this.execute(c.action, source, activator);
        return cfg.defaultAction ? this.execute(cfg.defaultAction, source, activator) : true;
      }
      case "Random": {
        const list: any[] = cfg.actions ?? [];
        const total = list.reduce((s, w) => s + (w.weight ?? 1), 0);
        if (total <= 0) return true;
        let r = Math.random() * total;
        for (const w of list) { r -= w.weight ?? 1; if (r < 0) return this.execute(w.action, source, activator); }
        return this.execute(list[list.length - 1].action, source, activator);
      }
      case "Delayed": {
        const v = cfg.variance ?? 0;
        const d = v === 0 ? (cfg.delay ?? 0) : Math.max(0, (cfg.delay ?? 0) + Math.floor(Math.random() * 2 * v) - v);
        const act = cfg.action;
        this.schedule(source, d, () => { if (!source.removed) this.execute(act, source, activator); });
        return true;
      }
      case "Signal": {
        for (const t of this.resolveTarget(cfg.target, source, activator)) this.signal(t, source, cfg.name ?? "");
        return true;
      }
      case "TargetedAction": {
        for (const t of this.resolveTarget(cfg.target, source, activator)) this.execute(cfg.action, source, t);
        return true;
      }
      case "DestroyActor": {
        let any = false;
        for (const t of this.resolveTarget(cfg.target, source, activator)) if (t.isActor) { any = true; this.destroy(t, activator, !!cfg.endScene); }
        return any;
      }
      case "SetVariable": {
        for (const t of this.resolveTarget(cfg.target, source, activator)) this.setVariable(t, source, cfg.name ?? "", this.expression(cfg.value, source, activator, t.vars.get(cfg.name ?? "")));
        return true;
      }
      case "FireEffect": {
        if (!cfg.effect) return true;
        for (const t of this.resolveTarget(cfg.location, source, activator)) this.host.fireEffect(cfg.effect, t.x, t.y, t.rotation);
        return true;
      }
      case "RotateActor": {
        let any = false;
        for (const t of this.resolveTarget(cfg.target, source, activator)) {
          if (!t.isActor) continue;
          any = true;
          t.rotation = normalize(t.rotation + floatVariable(cfg.rotation, () => (Math.random() * 2 - 1) * Math.PI));
        }
        return any;
      }
      case "WarpActor": {
        let any = false;
        for (const t of this.resolveTarget(cfg.target, source, activator)) {
          if (!t.isActor) continue;
          const locs = this.resolveTarget(cfg.location ?? { $class: "TargetConfig$Tagged", tag: "" }, source, activator);
          if (!locs.length) continue;
          const l = locs[Math.floor(Math.random() * locs.length)];
          t.x = l.x; t.y = l.y; t.rotation = l.rotation;
          t.game?.warp?.(l.x, l.y, l.rotation);
          any = true;
        }
        return any;
      }
      case "SpawnActor": case "SpawnRotatedActor": case "SpawnTransformedActor": case "SpawnFacingActor": case "SpawnRandomTranslatedActor": {
        if (!cfg.actor) return true;
        const locs = this.resolveTarget(cfg.location, source, activator);
        if (!locs.length) return false;
        let any = false;
        for (const t of locs) {
          let x = t.x, y = t.y, rot = t.rotation;
          if (k === "SpawnRotatedActor" || k === "SpawnTransformedActor") {
            const v = cfg.rotationVariance ?? 0;
            rot = normalize((cfg.relative ? t.rotation : 0) + (cfg.rotation ?? 0) + (v > 0 ? v * (Math.random() - 0.5) : 0));
            if (k === "SpawnTransformedActor") {
              const ox = cfg.translation?.x ?? 0, oy = cfg.translation?.y ?? 0, c = Math.cos(t.rotation), s = Math.sin(t.rotation);
              x += ox * c - oy * s; y += ox * s + oy * c;
            }
          } else if (k === "SpawnFacingActor") {
            const f = this.resolveTarget(cfg.facing, source, activator)[0];
            if (f) rot = Math.atan2(f.y - t.y, f.x - t.x);
          } else if (k === "SpawnRandomTranslatedActor") {
            const used = new Set<string>();
            for (let n = 0; n < (cfg.count ?? 1); n++) {
              for (let tries = 0; tries < 3; tries++) {
                const steps = cfg.steps ?? 1, step = cfg.stepSize ?? 1;
                const ix = Math.floor(Math.random() * (2 * steps + 1)) - steps, iy = Math.floor(Math.random() * (2 * steps + 1)) - steps;
                const key = ix + "," + iy;
                if (used.has(key)) continue;
                used.add(key);
                if (this.spawn(cfg.actor, t.x + ix * step, t.y + iy * step, t.rotation, source, activator)) any = true;
                break;
              }
            }
            continue;
          }
          this.spawn(cfg.actor, x, y, rot, source, activator);
          any = true;
        }
        return any;
      }
      default:
        this.host.log?.(`unhandled action ${k}`);
        return true;
    }
  }

  // ------------------------------------------------------------------ targets

  resolveTarget(cfg: any, source: Entity, activator: Entity | null): Entity[] {
    // a parameter can set a field of a default object the export left out (a Tagged target
    // with only its tag set); such objects carry no class name
    if (!cfg?.$class) return cfg && typeof cfg === "object" && "tag" in cfg ? [...this.tagged(cfg.tag ?? "")] : [source];
    switch (kind(cfg)) {
      case "Source": return [source];
      case "Activator": return activator ? [activator] : [];
      case "ActivatorOf": return this.resolveTarget(cfg.target, source, activator).map(t => t.activator).filter((a): a is Entity => !!a);
      case "Tagged": return [...this.tagged(cfg.tag ?? "")];
      case "InstanceOf": {
        const cls = String(cfg.logicClass ?? "PawnLogic");
        if (/PawnLogic/.test(cls)) return this.actors.filter(a => a.game?.isPawn);
        if (/ActorLogic|MobileLogic|AgentLogic/.test(cls)) return [...this.actors];
        return [...this.entries, ...this.actors];
      }
      case "Intersecting": {
        const shapes = this.region(cfg.region, source, activator);
        const out: Entity[] = [];
        for (const s of shapes) {
          if (cfg.actors !== false) for (const a of this.actors) { const as = a.shape(); if (as && intersects(s, as) && !out.includes(a)) out.push(a); }
          if (cfg.entries) for (const e of this.entries) { const es = e.shape(); if (es && intersects(s, es) && !out.includes(e)) out.push(e); }
        }
        return out;
      }
      case "RandomSubset": {
        const all = this.resolveTarget(cfg.target, source, activator), size = cfg.size ?? 1;
        if (all.length <= size) return all;
        return shuffle(all).slice(0, size);
      }
      case "NearestSubset": case "FarthestSubset": {
        const all = this.resolveTarget(cfg.target, source, activator), size = cfg.size ?? 1;
        if (all.length <= size) return all;
        const locs = this.resolveTarget(cfg.location, source, activator);
        const cx = locs.reduce((s, l) => s + l.x, 0) / Math.max(1, locs.length), cy = locs.reduce((s, l) => s + l.y, 0) / Math.max(1, locs.length);
        const sorted = all.slice().sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
        if (kind(cfg) === "FarthestSubset") sorted.reverse();
        return sorted.slice(0, size);
      }
      case "Conditional": return this.resolveTarget(cfg.target, source, activator).filter(t => this.condition(cfg.condition, source, t));
      case "Compound": return ((cfg.targets ?? []) as any[]).flatMap(t => t ? this.resolveTarget(t, source, activator) : []);
      case "Behavior": return this.resolveTarget(cfg.target, source, activator).map(t => t.game?.behaviorTarget?.()).filter((t): t is Entity => !!t);
      case "Excluding": {
        const all = this.resolveTarget(cfg.target, source, activator);
        if (!all.length) return all;
        const ex = new Set(this.resolveTarget(cfg.excluding, source, activator));
        return all.filter(t => !ex.has(t));
      }
      case "Randomized": return shuffle(this.resolveTarget(cfg.target, source, activator));
      default: return [source];
    }
  }

  private region(cfg: any, source: Entity, activator: Entity | null): Shape[] {
    const k = cfg?.$class ? kind(cfg) : "Default";
    if (k === "Fixed") { const s = shapeFromConfig(cfg.shape ?? { $class: "Point" }, 0, 0, 0); return s ? [s] : []; }
    const locs = this.resolveTarget(cfg?.location, source, activator);
    const out: Shape[] = [];
    for (const l of locs) {
      if (k === "Transformed") { const s = shapeFromConfig(cfg.shape ?? { $class: "Point" }, l.x, l.y, l.rotation); if (s) out.push(s); }
      else { const s = l.shape(); if (s) out.push(cfg?.expansion ? expand(s, cfg.expansion) : s); }
    }
    return out;
  }

  // ------------------------------------------------------------------ conditions

  condition(cfg: any, source: Entity, activator: Entity | null): boolean {
    if (!cfg?.$class) {
      // an implicit default Tagged condition with only its tag set by a parameter
      if (cfg && typeof cfg === "object" && "tag" in cfg) return this.resolveTarget(cfg.target, source, activator).some(t => t.hasTag(cfg.tag ?? ""));
      return true;
    }
    const anyAll = (list: Entity[], all: boolean, pred: (e: Entity) => boolean) => {
      for (const t of list) if (pred(t) !== all) return !all;
      return all;
    };
    switch (kind(cfg)) {
      case "Always": return true;
      case "Not": return !this.condition(cfg.condition, source, activator);
      case "All": return ((cfg.conditions ?? []) as any[]).every(c => this.condition(c, source, activator));
      case "Any": return ((cfg.conditions ?? []) as any[]).some(c => this.condition(c, source, activator));
      case "Tagged": return anyAll(this.resolveTarget(cfg.target, source, activator), !!cfg.all, t => t.hasTag(cfg.tag ?? ""));
      case "InstanceOf": {
        const cls = String(cfg.logicClass ?? "PawnLogic");
        return anyAll(this.resolveTarget(cfg.target, source, activator), !!cfg.all, t => /PawnLogic/.test(cls) ? !!t.game?.isPawn : t.isActor);
      }
      case "Random": return Math.random() < (cfg.probability ?? 0.5);
      case "Limit": { const n = this.limits.get(cfg) ?? 0; this.limits.set(cfg, n + 1); return n < (cfg.limit ?? 1); }
      case "Cooldown": {
        const next = this.cooldowns.get(cfg) ?? -1;
        if (this.ts > next) { this.cooldowns.set(cfg, this.ts + (cfg.time ?? 0)); return true; }
        return false;
      }
      case "FlagSet": {
        const set = cfg.set ?? true;
        const any = this.resolveTarget(cfg.target, source, activator).some(t => t.isActor && !!t.game?.flags?.(cfg.flagName ?? "WARP"));
        return any ? set : !set;
      }
      case "DistanceWithin": {
        const first = this.resolveTarget(cfg.first, source, activator);
        const second = this.resolveTarget(cfg.second ?? { $class: "TargetConfig$Activator" }, source, activator);
        const min = cfg.minimum ?? 0, max = cfg.maximum ?? 0;
        return anyAll(first, !!cfg.allFirst, f => anyAll(second, !!cfg.allSecond, s => { const d = Math.hypot(f.x - s.x, f.y - s.y); return d >= min && d <= max; }));
      }
      case "Intersecting": {
        const a = this.region(cfg.first, source, activator), b = this.region(cfg.second, source, activator);
        const test = (list: Shape[], all: boolean, pred: (s: Shape) => boolean) => { for (const s of list) if (pred(s) !== all) return !all; return all; };
        return test(a, !!cfg.allFirst, x => test(b, !!cfg.allSecond, y => intersects(x, y)));
      }
      case "Is": {
        const s0 = this.resolveTarget(cfg.source, source, activator)[0];
        if (!s0) return false;
        return anyAll(this.resolveTarget(cfg.target ?? { $class: "TargetConfig$Tagged", tag: "" }, source, activator), !!cfg.all, t => t === s0);
      }
      case "Evaluate": return toBool(this.expression(cfg.expression, source, activator));
      case "Action": return this.execute(cfg.action, source, activator);
      case "IntersectsScene": return false;
      case "DateRange": {
        const now = Date.now();
        return (cfg.start == null || now >= cfg.start) && (cfg.end == null || now <= cfg.end);
      }
      default: return this.host.gameAction({ ...cfg, $condition: true }, source, activator, this) ?? true;
    }
  }

  // ------------------------------------------------------------------ expressions

  expression(cfg: any, source: Entity, activator: Entity | null, previous: unknown = null): unknown {
    // a parameter-set value on an implicit default Constant
    if (cfg && !cfg.$class && "value" in cfg) return parseValue(String(cfg.value ?? ""));
    if (!cfg?.$class) return "";
    const ev = (c: any) => this.expression(c, source, activator, previous);
    const num = (c: any) => toNum(ev(c));
    switch (kind(cfg)) {
      case "Constant": return parseValue(cfg.value ?? "");
      case "Reference": {
        for (const t of this.resolveTarget(cfg.target, source, activator)) { const v = t.vars.get(cfg.name ?? ""); if (v != null) return v; }
        return null;
      }
      case "Previous": return previous;
      case "NumTargets": return this.resolveTarget(cfg.target ?? { $class: "TargetConfig$Tagged", tag: "" }, source, activator).length;
      case "Variable": return floatVariable(cfg.variable, () => 0);
      case "Round": return Math.round(num(cfg.operand));
      case "Floor": return Math.floor(num(cfg.operand));
      case "Ceil": return Math.ceil(num(cfg.operand));
      case "Increment": return num(cfg.operand) + 1;
      case "Decrement": return num(cfg.operand) - 1;
      case "Negate": return -num(cfg.operand);
      case "Add": return num(cfg.firstOperand) + num(cfg.secondOperand);
      case "Subtract": return num(cfg.firstOperand) - num(cfg.secondOperand);
      case "Multiply": return num(cfg.firstOperand) * num(cfg.secondOperand);
      case "Divide": return num(cfg.firstOperand) / num(cfg.secondOperand);
      case "Remainder": return num(cfg.firstOperand) % num(cfg.secondOperand);
      case "Power": return Math.pow(num(cfg.firstOperand), num(cfg.secondOperand));
      case "Not": return !toBool(ev(cfg.operand));
      case "And": return toBool(ev(cfg.firstOperand)) && toBool(ev(cfg.secondOperand));
      case "Or": return toBool(ev(cfg.firstOperand)) || toBool(ev(cfg.secondOperand));
      case "Xor": return toBool(ev(cfg.firstOperand)) !== toBool(ev(cfg.secondOperand));
      case "Less": return num(cfg.firstOperand) < num(cfg.secondOperand);
      case "Greater": return num(cfg.firstOperand) > num(cfg.secondOperand);
      case "LessEquals": return num(cfg.firstOperand) <= num(cfg.secondOperand);
      case "GreaterEquals": return num(cfg.firstOperand) >= num(cfg.secondOperand);
      case "Equals": return valuesEqual(ev(cfg.firstOperand), ev(cfg.secondOperand));
      case "IsNull": return ev(cfg.operand) == null;
      case "Parsed": return parseExpression(cfg.expression ?? "", name => {
        if (name === "previous") return previous;
        return source.vars.get(name) ?? null;
      });
      default: return "";
    }
  }
}

/** Case orders for switches whose case values the export dropped (see ExpressionSwitch). */
const CASE_ORDERS = [
  ["mini", "small", "medium", "large"],
  ["primary", "health", "crown", "pickups", "breakable", "tutorial", "horde"],
];

/**
 * Signal handler name matching. Clyde matches exactly, but the game's data leaves the name
 * unset on the handlers its triggers wake with "activate" (spawn markers, one-time actions),
 * so an unset name accepts "activate" and the empty name. Monsters are different: their unnamed
 * handlers answer a signal the game itself sends (a lichen's merge), never the triggers' "activate",
 * so on a mobile actor an unset name accepts only the empty name.
 */
function nameMatches(want: string | undefined, name: string, owner?: Entity) {
  if (want == null && owner?.isActor && owner.mobile) return name === "";
  return want == null ? name === "" || name === "activate" : want === name;
}

function shuffle<T>(a: T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

function floatVariable(v: any, dflt: () => number): number {
  if (v == null) return dflt();
  if (typeof v === "number") return v;
  switch (kind(v)) {
    case "Constant": return v.value ?? 0;
    case "Uniform": { const lo = v.minimum ?? 0, hi = v.maximum ?? lo; return lo + Math.random() * (hi - lo); }
    default: return dflt();
  }
}

function parseValue(s: string): unknown {
  const l = s.toLowerCase();
  if (l === "null") return null;
  if (l === "true") return true;
  if (l === "false") return false;
  if (s.trim() !== "" && !isNaN(Number(s))) return Number(s);
  return s;
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return isNaN(n) || v.trim() === "" ? (v.toLowerCase() === "true" ? 1 : 0) : n; }
  return 0;
}

function toBool(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") { const n = Number(v); return v.trim() !== "" && !isNaN(n) ? n !== 0 : v.toLowerCase() === "true"; }
  return false;
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a === b;
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  const na = typeof a === "number" ? a : typeof a === "string" && a.trim() !== "" && !isNaN(Number(a)) ? Number(a) : null;
  const nb = typeof b === "number" ? b : typeof b === "string" && b.trim() !== "" && !isNaN(Number(b)) ? Number(b) : null;
  if (na != null && nb != null) return na === nb;
  return a === b;
}

/** ExpressionParser subset: numbers, strings, identifiers (variables), unary and binary operators. */
function parseExpression(src: string, lookup: (name: string) => unknown): unknown {
  const toks: string[] = src.match(/\d+\.?\d*|"[^"]*"|'[^']*'|[A-Za-z_][\w]*|\+\+|--|&&|\|\||<=|>=|==|!=|[-+*/%<>!&|^()]/g) ?? [];
  if (toks.includes("!=")) return "";
  let i = 0;
  const prec: Record<string, number> = { "*": 3, "/": 3, "%": 3, "+": 4, "-": 4, "<": 6, "<=": 6, ">": 6, ">=": 6, "==": 7, "&": 8, "^": 9, "|": 10, "&&": 11, "||": 12 };
  const primary = (): unknown => {
    const t = toks[i++];
    if (t === undefined) return "";
    if (t === "(") { const v = binary(13); i++; return v; }
    if (t === "-") return -toNum(primary());
    if (t === "+") return primary();
    if (t === "!") return !toBool(primary());
    if (t === "++") return toNum(primary()) + 1;
    if (t === "--") return toNum(primary()) - 1;
    if (/^["']/.test(t)) return t.slice(1, -1);
    if (/^\d/.test(t)) return Number(t);
    const l = t.toLowerCase();
    if (l === "true") return true;
    if (l === "false") return false;
    if (l === "null") return null;
    return lookup(t);
  };
  const apply = (op: string, a: unknown, b: unknown): unknown => {
    switch (op) {
      case "*": return toNum(a) * toNum(b);
      case "/": return toNum(a) / toNum(b);
      case "%": return toNum(a) % toNum(b);
      case "+": return toNum(a) + toNum(b);
      case "-": return toNum(a) - toNum(b);
      case "<": return toNum(a) < toNum(b);
      case "<=": return toNum(a) <= toNum(b);
      case ">": return toNum(a) > toNum(b);
      case ">=": return toNum(a) >= toNum(b);
      case "==": return valuesEqual(a, b);
      case "&": case "&&": return toBool(a) && toBool(b);
      case "|": case "||": return toBool(a) || toBool(b);
      case "^": return toBool(a) !== toBool(b);
    }
    return "";
  };
  const binary = (maxPrec: number): unknown => {
    let left = primary();
    for (;;) {
      const op = toks[i];
      const p = prec[op];
      if (p === undefined || p > maxPrec) return left;
      i++;
      const right = binary(p - 1);
      left = apply(op, left, right);
    }
  };
  try { return binary(13); } catch { return ""; }
}

/** Applies a ConfigReference's arguments to a config from a library map. */
export function resolveRef(lib: Map<string, any>, ref: any, field: string, depth = 0): any | null {
  if (!ref?.name || depth > 12) return null;
  const base = lib.get(ref.name);
  if (!base) return null;
  const cfg = applyArguments(base, ref);
  if (cfg.$class?.endsWith("DerivedConfig")) return resolveRef(lib, cfg.base, field, depth + 1);
  const impl = cfg.implementation;
  if (impl?.$class?.endsWith("$Derived") && impl[field]) return resolveRef(lib, impl[field], field, depth + 1);
  return impl ?? cfg;
}

export { centroid };
