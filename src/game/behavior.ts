// The monster behaviour engine: Tudey's server-side BehaviorLogic, AgentLogic and ScriptLogic
// (clyde core com.threerings.tudey.server.logic), reimplemented in our own TypeScript, plus
// Spiral Knights' own behaviour kinds, whose config classes the client keeps
// (projectx.dungeon.config.DungeonBehaviorConfig: Targeting, Cascading, Attack, Dodging;
// TargetActionConfig: SimpleAttack, PathAttack, TrackAttack, StraightAttack, ChargeAttack,
// Flee, RandomAction) but whose logic was server code. Field names and defaults follow
// those classes; where the logic is our reconstruction docs/research/monster-ai.md says so.
//
// The engine is pure: an Agent holds the AgentLogic state (rotation, target rotation, turn
// rate, moving, speed) and its behaviour; the world implements BehaviorHost (what the agent
// can see, paths, starting attacks) and applies the movement the agent asks for. Times are
// milliseconds of world time, angles radians, distances world units.

/** A FloatVariable: a constant, or a uniform range [min, max]. */
export type Num = number | [number, number];
const value = (v: Num | undefined, rand: () => number, d = 0) =>
  v === undefined ? d : typeof v === "number" ? v : v[0] + (v[1] - v[0]) * rand();

export type Condition =
  | { type: "Always" }
  | { type: "Never" }
  /** DungeonConditionConfig.Health on the agent: below (or above) a share of its health. */
  | { type: "Health"; below?: boolean; health: number }
  /** The current target within (or beyond) a distance, edge to edge. Ours. */
  | { type: "TargetDistance"; max?: number; min?: number }
  /** A wounded ally (below `below` of its health) within a radius. Ours, for healers. */
  | { type: "AllyHurt"; radius: number; below?: number }
  /** A hostile actor within a radius. Ours. */
  | { type: "FoeNear"; radius: number }
  | { type: "Random"; chance: number }
  | { type: "Not"; condition: Condition }
  | { type: "All"; conditions: Condition[] }
  | { type: "Any"; conditions: Condition[] };

/** TargetActionConfig.Weight: ConstantWeight (a number) or ConditionalWeight. */
export type Weight = number | { condition: Condition; success: number; fail: number };

interface AttackFields {
  /** AttackAction attacks: indices into the monster's attacks (default [0]). */
  attacks?: number[];
  /** SimpleAttack minAttackInterval, ms between attack starts (default 1000). */
  minAttackInterval?: number;
}
interface PathFields extends AttackFields {
  /** PathAttack maxAttackDistance (default 0.85): the gap, edge to edge, to attack within. */
  maxAttackDistance?: number;
  /** PathAttack attackFacesTarget (default true): snap to face the target as an attack starts. */
  attackFacesTarget?: boolean;
  /** PathAttack turnRate (rad/s, 0: the agent's own) while targeting. */
  turnRate?: number;
  /** PathAttack turnSnap (rad): within this of facing, face at once. */
  turnSnap?: number;
}
export type TargetAction =
  | ({ type: "SimpleAttack" } & AttackFields)
  | ({ type: "PathAttack" } & PathFields)
  /** TrackAttack: also keeps at least minAttackDistance away. */
  | ({ type: "TrackAttack"; minAttackDistance?: number } & PathFields)
  /** StraightAttack: runs straight at the target, maxLength ms at attackSpeed (0: speed). */
  | ({ type: "StraightAttack"; maxLength?: number; attackSpeed?: number } & PathFields)
  /**
   * ChargeAttack: winds up (attacks, warmup ms), runs straight maxLength ms at attackSpeed
   * (0: the monster's speed) and ends with one of chargeAttacks.
   */
  | ({ type: "ChargeAttack"; warmup?: number; maxLength?: number; attackSpeed?: number; chargeAttacks?: number[] } & PathFields)
  /** Flee: keep away from the target. `distance` (ours) is how far it runs before turning. */
  | { type: "Flee"; distance?: number; attacks?: number[]; minAttackInterval?: number }
  | { type: "RandomAction"; actions: { weight: Weight; action: TargetAction }[] };

export type TargetKind = "foes" | "hurtAllies" | "allies";

export type Behavior =
  | { type: "Idle" }
  | { type: "Wander"; evaluationInterval?: Num; directionChange?: Num; radius?: number; preRotationPause?: Num; postRotationPause?: Num }
  | { type: "GridWander"; evaluationInterval?: Num; gridTurn?: "REVERSE" | "LEFT" | "RIGHT" | "RANDOM"; evaluationRotate?: boolean; preRotationPause?: Num; postRotationPause?: Num }
  /** Follow the nearest of `target` (allies of these sizes, or foes), keeping min..max away. */
  | { type: "Follow"; target?: { kind: TargetKind; sizes?: string[] }; minimumDistance?: number; maximumDistance?: number; evaluationInterval?: Num; moveFaceRange?: number }
  | { type: "Random"; evaluationInterval?: Num; behaviors: { weight?: number; behavior: Behavior }[] }
  | { type: "Combined"; first?: Behavior; second?: Behavior }
  /** The steps are ScriptConfig objects as the export holds them. */
  | { type: "Scripted"; steps: any[] }
  | {
    type: "Targeting";
    /** What the agent does without a target (DungeonBehaviorConfig.Targeting routine). */
    routine?: Behavior;
    /** The acquire region: a radius around the agent (the configs' regions are stripped). */
    acquireRadius?: number;
    /** Only acquire what the agent can see (ours: the line of sight the wiki describes). */
    sight?: boolean;
    acquireDamagers?: "ALWAYS" | "WHEN_VICTIMLESS" | "NEVER";
    hitWeight?: number; damageWeight?: number; distanceWeight?: number;
    minHitToTarget?: number;
    /** Whom it targets: foes, or (healers) wounded allies. Ours. */
    targets?: TargetKind;
    targetAction?: TargetAction;
    /** Release condition (default Any of nothing: never). */
    release?: Condition;
    /** Ours: a target this far away is let go. */
    leash?: number;
    evaluationInterval?: Num;
    moveFaceRange?: number;
  }
  | { type: "Cascading"; evaluationInterval?: Num; cascades: { condition?: Condition; behavior: Behavior }[] }
  /**
   * Dodging: runs `behavior`, and when a threat comes within `radius` (the intersection
   * shape) dodges with one of `dodges` (direction relative to the threat, rad; attack index),
   * at most every minDodgeInterval ms. `chance` (ours) is the share of threats it reacts to.
   */
  | { type: "Dodging"; behavior: Behavior; minDodgeInterval?: number; radius?: number; dodges: { direction?: number; attack: number }[]; chance?: number }
  /**
   * DungeonBehaviorConfig.Attack: uses its attack whenever it can (stop: standing still).
   * `attacks` and `minAttackInterval` (ours) let it pick among several, now and then.
   */
  | { type: "Attack"; attack?: number; stop?: boolean; attacks?: number[]; minAttackInterval?: number };

/** Something an agent can see: the knight, a companion, another monster. */
export interface Seen {
  id: number;
  x: number; y: number;
  radius: number;
  health: number; maxHealth: number;
  size?: string;
}

export interface Threat { x: number; y: number }

/** What the world gives the behaviour engine. */
export interface BehaviorHost {
  rand(): number;
  foes(): Seen[];
  allies(): Seen[];
  /** Hits and damage the agent has taken from an actor. */
  damage(id: number): { hits: number; damage: number } | undefined;
  /** Ids of actors that have hurt the agent. */
  damagers(): number[];
  /** Tudey Pathfinder.getPath (partial, shortcut): waypoints after the start, or null. */
  path(ax: number, ay: number, bx: number, by: number, longest: number): [number, number][] | null;
  /** Whether the agent can see / walk straight to a point. */
  sees(ax: number, ay: number, bx: number, by: number): boolean;
  /** Hostile projectiles and swings closing on a point. */
  threats(x: number, y: number, radius: number): Threat[];
  attackCount(): number;
  /** Whether the agent may start an attack now (not attacking, not reacting). */
  canAttack(): boolean;
  /** Whether an attack is under way. */
  attacking(): boolean;
  /** Starts attack `i` at the agent's current rotation. */
  attack(i: number): boolean;
  /** Ends the attack under way (a charge's wind-up loop). */
  stopAttack(): void;
  /** Whether the agent may walk while attacking (DungeonActorConfig moveWhileAttacking). */
  moveWhileAttacking(): boolean;
  /** ScriptConfig Action and Condition steps. */
  action?(action: any): void;
  condition?(condition: any): boolean;
  /** ScriptConfig Move: where its target is. */
  locate?(target: any): { x: number; y: number } | null;
}

const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const normalize = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The agent's movement this tick, for the world to apply. */
export interface Motion { moving: boolean; direction: number; speed: number }

/**
 * AgentLogic: rotation, the rotation it is turning to at its turn rate, whether it is moving,
 * its speed (the Mobile speed, or targetedSpeed while its behaviour has a target), and its
 * behaviour.
 */
export class Agent {
  x = 0; y = 0; rotation = 0;
  targetRotation = 0;
  turnRate: number;
  moving = false;
  /** ScriptConfig SetSpeed (and charges): a speed replacing the configured one. */
  speedOverride: number | null = null;
  /** A straight run (Straight and Charge attacks): no turning, a set speed. */
  run: { speed: number; until: number } | null = null;
  now = 0;
  dt = 0;
  readonly behavior: BehaviorLogic;
  constructor(readonly host: BehaviorHost, cfg: Behavior, readonly speed: number, readonly targetedSpeed: number,
    readonly baseTurnRate: number, readonly radius: number, x = 0, y = 0, rotation = 0) {
    this.turnRate = baseTurnRate;
    this.x = x; this.y = y; this.rotation = this.targetRotation = rotation;
    this.behavior = createBehavior(cfg, this);
    this.behavior.startup();
  }

  get target(): Seen | null { return this.behavior.currentTarget(); }

  /** The speed it moves at: SetSpeed's, a run's, targetedSpeed with a target, else speed. */
  currentSpeed(): number {
    if (this.run) return this.run.speed;
    if (this.speedOverride !== null) return this.speedOverride;
    return this.target ? this.targetedSpeed : this.speed;
  }

  canMove() { return !this.host.attacking() || this.host.moveWhileAttacking() || !!this.run; }
  canRotate() { return !this.host.attacking() && !this.run; }

  setTargetRotation(r: number) {
    this.targetRotation = normalize(r);
    if (Math.abs(angleDiff(this.targetRotation, this.rotation)) < 1e-6) this.behavior.reachedTargetRotation();
  }
  clearTargetRotation() { this.targetRotation = this.rotation; }
  /** AgentLogic.face: turn toward a point, or face it at once when forced. */
  face(x: number, y: number, force = false) {
    const r = Math.atan2(y - this.y, x - this.x);
    if (force) { this.rotation = this.targetRotation = r; return; }
    this.setTargetRotation(r);
  }
  startMoving() { if (this.canMove()) this.moving = true; }
  stopMoving() { this.moving = false; }
  setTurnRate(r: number) { this.turnRate = r > 0 ? r : this.baseTurnRate; }

  /** AgentLogic.tick: the behaviour, then turning toward the target rotation. */
  tick(now: number, x: number, y: number, rotation: number): Motion {
    this.dt = this.now ? Math.max(0, now - this.now) : 0;
    this.now = now;
    this.x = x; this.y = y; this.rotation = rotation;
    if (this.run && now >= this.run.until) this.run = null;
    this.behavior.tick(now);
    if (this.rotation !== this.targetRotation && this.canRotate()) {
      const diff = angleDiff(this.targetRotation, this.rotation), step = this.dt / 1000 * this.turnRate;
      if (Math.abs(diff) - step < 1e-6) {
        this.rotation = this.targetRotation;
        this.behavior.reachedTargetRotation();
      } else {
        this.rotation = normalize(this.rotation + Math.sign(diff) * step);
      }
    }
    // Pathing's move-face rule, checked again after this tick's turn
    const pf = this.behavior.facingLimit();
    const facing = pf === null || Math.abs(angleDiff(this.targetRotation, this.rotation)) <= pf;
    const moving = (this.moving || !!this.run) && this.canMove() && facing;
    return { moving, direction: this.rotation, speed: moving ? this.currentSpeed() : 0 };
  }

  /** The world could not move it (a wall): AgentLogic.penetratedEnvironment. */
  blocked(px: number, py: number) {
    if (this.run) this.run = null;
    this.behavior.penetrated(px, py);
  }

  /** Reach radius for path nodes: what it covers in a tick, at least a little. */
  reachRadius() { return Math.max(0.2, this.currentSpeed() * this.dt / 1000 * 1.5); }
}

export function createBehavior(cfg: Behavior | undefined, agent: Agent): BehaviorLogic {
  switch (cfg?.type) {
    case "Wander": return new Wander(cfg, agent);
    case "GridWander": return new GridWander(cfg, agent);
    case "Follow": return new Follow(cfg, agent);
    case "Random": return new RandomB(cfg, agent);
    case "Combined": return new Combined(cfg, agent);
    case "Scripted": return new Scripted(cfg, agent);
    case "Targeting": return new Targeting(cfg, agent);
    case "Cascading": return new Cascading(cfg, agent);
    case "Dodging": return new Dodging(cfg, agent);
    case "Attack": return new AttackB(cfg, agent);
    default: return new Idle(agent);
  }
}

/** BehaviorLogic: started, ticked, told when the agent reaches its rotation or hits a wall. */
export abstract class BehaviorLogic {
  constructor(readonly agent: Agent) {}
  startup() {}
  suspend() {}
  tick(_now: number) {}
  reachedTargetRotation() {}
  penetrated(_px: number, _py: number) {}
  currentTarget(): Seen | null { return null; }
  /** The Pathing moveFaceRange in force, or null (move whatever the facing). */
  facingLimit(): number | null { return null; }
  get host() { return this.agent.host; }
}

/** BehaviorLogic.Idle: stands still. */
class Idle extends BehaviorLogic {
  startup() { this.agent.stopMoving(); this.agent.clearTargetRotation(); }
}

/** BehaviorLogic.Evaluating: evaluates every evaluationInterval seconds (default 2). */
abstract class Evaluating extends BehaviorLogic {
  nextEvaluation = 0;
  constructor(readonly interval: Num | undefined, agent: Agent) { super(agent); }
  startup() { this.nextEvaluation = this.agent.now; }
  tick(now: number) { if (now >= this.nextEvaluation) this.evaluate(); }
  evaluate() { this.schedule(); }
  schedule() { this.nextEvaluation = this.agent.now + value(this.interval, this.host.rand, 2) * 1000; }
  postpone() { this.nextEvaluation = Infinity; }
}

/** BehaviorLogic.BaseWander: turn (after a pause), then walk (after another pause). */
abstract class BaseWander extends Evaluating {
  startRotating = Infinity; startMoving = Infinity; rotation = 0;
  constructor(readonly cfg: { evaluationInterval?: Num; preRotationPause?: Num; postRotationPause?: Num }, agent: Agent) { super(cfg.evaluationInterval, agent); }
  startup() { super.startup(); this.startRotating = this.startMoving = Infinity; }
  tick(now: number) {
    super.tick(now);
    if (this.agent.canRotate() && now >= this.startRotating) {
      this.startRotating = this.startMoving = Infinity;
      this.agent.setTargetRotation(this.rotation);
    }
    if (this.agent.canMove() && now >= this.startMoving) {
      this.schedule();
      this.agent.startMoving();
      this.startMoving = Infinity;
    }
  }
  reachedTargetRotation() {
    const pause = value(this.cfg.postRotationPause, this.host.rand) * 1000;
    if (pause === 0) {
      this.schedule();
      this.agent.startMoving();
      this.startRotating = this.startMoving = Infinity;
    } else {
      this.startMoving = this.agent.now + pause;
      this.startRotating = Infinity;
    }
  }
  setDirectionChange(rotation: number) {
    const pause = value(this.cfg.preRotationPause, this.host.rand) * 1000;
    this.postpone();
    this.rotation = rotation;
    if (pause === 0) {
      this.startRotating = this.startMoving = Infinity;
      this.agent.setTargetRotation(rotation);
    } else {
      this.startRotating = this.agent.now + pause;
      this.startMoving = Infinity;
    }
  }
}

/**
 * BehaviorLogic.Wander: every evaluation turns by directionChange (default uniform -pi..pi)
 * and walks; heads home when past `radius` (default 100) of where it started; bounces off
 * walls by reflecting its direction about the wall.
 */
class Wander extends BaseWander {
  originX: number; originY: number;
  constructor(readonly w: Extract<Behavior, { type: "Wander" }>, agent: Agent) {
    super(w, agent);
    this.originX = agent.x; this.originY = agent.y;
  }
  tick(now: number) {
    super.tick(now);
    const a = this.agent;
    if (a.moving && Math.hypot(a.x - this.originX, a.y - this.originY) > (this.w.radius ?? 100)) {
      const home = Math.atan2(this.originY - a.y, this.originX - a.x);
      if (Math.abs(angleDiff(home, a.rotation)) > Math.PI / 2) this.changeDirection(home);
    }
  }
  penetrated(px: number, py: number) {
    let rotation = normalize(this.agent.rotation + Math.PI);
    if (Math.hypot(px, py) > 1e-6) {
      const angle = Math.atan2(py, px);
      rotation = normalize(angle - angleDiff(rotation, angle));
    }
    this.changeDirection(rotation);
  }
  evaluate() { super.evaluate(); this.changeDirection(this.agent.rotation); }
  changeDirection(base: number) {
    this.agent.stopMoving();
    this.setDirectionChange(normalize(base + value(this.w.directionChange ?? [-Math.PI, Math.PI], this.host.rand)));
  }
}

/** BehaviorLogic.GridWander: walks the grid's axes, turning by gridTurn at walls. */
class GridWander extends BaseWander {
  constructor(readonly g: Extract<Behavior, { type: "GridWander" }>, agent: Agent) {
    super(g, agent);
    this.rotation = agent.rotation;
  }
  startup() { super.startup(); if (!this.g.evaluationRotate) this.setDirectionChange(this.rotation); }
  penetrated() { this.changeDirection(); }
  schedule() { if (this.g.evaluationRotate) super.schedule(); else this.postpone(); }
  evaluate() { super.evaluate(); if (this.g.evaluationRotate) this.changeDirection(); }
  changeDirection() {
    this.agent.stopMoving();
    let r = this.rotation;
    switch (this.g.gridTurn ?? "REVERSE") {
      case "REVERSE": r += Math.PI; break;
      case "LEFT": r += Math.PI / 2; break;
      case "RIGHT": r -= Math.PI / 2; break;
      case "RANDOM": r += this.host.rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2; break;
    }
    r = ((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const Q = Math.PI / 4;
    r = r > 2 * Math.PI - Q ? 0 : r > Math.PI + Q ? -Math.PI / 2 : r > Math.PI - Q ? Math.PI : r > Q ? Math.PI / 2 : 0;
    this.setDirectionChange(r);
  }
}

/** BehaviorLogic.Pathing: follows waypoints, turning to each and walking when facing it. */
abstract class Pathing extends Evaluating {
  path: [number, number][] | null = null;
  pidx = 0;
  moveFaceRange: number;
  constructor(interval: Num | undefined, moveFaceRange: number | undefined, agent: Agent) {
    super(interval, agent);
    this.moveFaceRange = moveFaceRange || 0.001;
  }
  tick(now: number) {
    super.tick(now);
    this.followPath();
  }
  followPath() {
    if (!this.path) return;
    const a = this.agent;
    let completed = false;
    while (this.path && Math.hypot(this.path[this.pidx][0] - a.x, this.path[this.pidx][1] - a.y) <= a.reachRadius()) {
      if (++this.pidx === this.path.length) {
        a.stopMoving();
        this.path = null;
        if (completed) return;
        this.completedPath();
        completed = true;
      }
    }
    if (!this.path) return;
    const [nx, ny] = this.path[this.pidx];
    const rot = Math.atan2(ny - a.y, nx - a.x);
    const dist = Math.abs(angleDiff(a.rotation, rot));
    if (dist > 0.0001) a.setTargetRotation(rot);
    a.startMoving();
  }
  facingLimit() { return this.path ? this.moveFaceRange : null; }
  setPath(path: [number, number][] | null) {
    if (!path || !path.length) { this.clearPath(); return; }
    this.path = path;
    this.pidx = 0;
  }
  clearPath() { if (this.path) { this.agent.stopMoving(); this.path = null; } }
  completedPath() {}
}

/** Tudey's MAX_FOLLOW_PATH_LENGTH. */
export const MAX_FOLLOW_PATH_LENGTH = 8;

function candidates(host: BehaviorHost, kind: TargetKind): Seen[] {
  if (kind === "foes") return host.foes();
  const allies = host.allies();
  return kind === "hurtAllies" ? allies.filter(s => s.health < s.maxHealth) : allies;
}

/**
 * BehaviorLogic.Follow: every evaluation, the nearest target; within min..max (default 1..5)
 * it stops and faces it, else paths to it (at most MAX_FOLLOW_PATH_LENGTH, partial).
 */
class Follow extends Pathing {
  current: Seen | null = null;
  constructor(readonly f: Extract<Behavior, { type: "Follow" }>, agent: Agent) { super(f.evaluationInterval, f.moveFaceRange, agent); }
  currentTarget() { return this.current; }
  evaluate() {
    super.evaluate();
    const a = this.agent, kind = this.f.target?.kind ?? "allies", sizes = this.f.target?.sizes;
    let best: Seen | null = null, bd = Infinity;
    for (const s of candidates(this.host, kind)) {
      if (sizes && !sizes.includes(s.size ?? "")) continue;
      const d = Math.hypot(s.x - a.x, s.y - a.y);
      if (d < bd) { bd = d; best = s; }
    }
    this.current = best;
    if (!best) return;
    const min = this.f.minimumDistance ?? 1, max = this.f.maximumDistance ?? 5;
    if (bd >= min && bd <= max) { this.clearPath(); a.face(best.x, best.y); return; }
    const path = this.host.path(a.x, a.y, best.x, best.y, MAX_FOLLOW_PATH_LENGTH);
    if (!path) { this.clearPath(); a.face(best.x, best.y); return; }
    this.setPath(path);
  }
}

/** BehaviorLogic.Random: every evaluation, one of its behaviours by weight. */
class RandomB extends Evaluating {
  logics: { weight: number; logic: BehaviorLogic }[];
  active: BehaviorLogic | null = null;
  constructor(cfg: Extract<Behavior, { type: "Random" }>, agent: Agent) {
    super(cfg.evaluationInterval, agent);
    this.logics = cfg.behaviors.map(b => ({ weight: b.weight ?? 1, logic: createBehavior(b.behavior, agent) }));
  }
  tick(now: number) { super.tick(now); this.active?.tick(now); }
  reachedTargetRotation() { this.active?.reachedTargetRotation(); }
  penetrated(px: number, py: number) { this.active?.penetrated(px, py); }
  currentTarget() { return this.active?.currentTarget() ?? null; }
  facingLimit() { return this.active?.facingLimit() ?? null; }
  evaluate() {
    super.evaluate();
    const next = pickWeighted(this.logics, l => l.weight, this.host.rand)?.logic ?? null;
    if (next === this.active) return;
    if ((this.active = next)) next.startup();
  }
}

/** BehaviorLogic.Combined: two behaviours at once. */
class Combined extends BehaviorLogic {
  first: BehaviorLogic | null; second: BehaviorLogic | null;
  constructor(cfg: Extract<Behavior, { type: "Combined" }>, agent: Agent) {
    super(agent);
    this.first = cfg.first ? createBehavior(cfg.first, agent) : null;
    this.second = cfg.second ? createBehavior(cfg.second, agent) : null;
  }
  startup() { this.first?.startup(); this.second?.startup(); }
  tick(now: number) { this.first?.tick(now); this.second?.tick(now); }
  reachedTargetRotation() { this.first?.reachedTargetRotation(); this.second?.reachedTargetRotation(); }
  penetrated(px: number, py: number) { this.first?.penetrated(px, py); this.second?.penetrated(px, py); }
  currentTarget() { return this.first?.currentTarget() ?? this.second?.currentTarget() ?? null; }
  facingLimit() { return this.first?.facingLimit() ?? this.second?.facingLimit() ?? null; }
}

/** One ScriptLogic step: started, ticked until it says it is done. */
interface Step { start(now: number): void; tick(now: number): boolean; reachedTargetRotation?(): void }

/**
 * BehaviorLogic.Scripted: runs ScriptConfig steps in order (Wait, Move, Rotate, Condition,
 * ConditionalScript, Goto, Action, SetSpeed, ClearSpeed; projectx Attack, Attacks, Noop).
 */
class Scripted extends BehaviorLogic {
  steps: Step[];
  current = 0;
  starting = true;
  constructor(cfg: Extract<Behavior, { type: "Scripted" }>, agent: Agent) {
    super(agent);
    this.steps = cfg.steps.map(s => this.step(s));
  }
  startup() { this.current = 0; this.starting = true; }
  setCurrentStep(step: number, now: number) {
    this.current = Math.min(this.steps.length, step);
    this.steps[this.current]?.start(now);
    this.starting = false;
  }
  tick(now: number) {
    // a run of instant steps (Attack, Attack, Goto) goes through in one tick, as far as a
    // step that takes time; capped so a loop of instant steps cannot hang
    // (a Goto's start moves the script and starts that step; the tick is then the new step's)
    for (let guard = 0; guard < 64 && this.current < this.steps.length; guard++) {
      if (this.starting) this.steps[this.current].start(now);
      if (this.current >= this.steps.length) return;
      this.starting = this.steps[this.current].tick(now);
      if (!this.starting) return;
      this.current++;
    }
  }
  reachedTargetRotation() { this.steps[this.current]?.reachedTargetRotation?.(); }
  step(s: any): Step {
    const a = this.agent, host = this.host;
    const kind = String(s?.$class ?? "").split("$").pop();
    switch (kind) {
      case "Wait": {
        let end = 0;
        return { start: now => { a.stopMoving(); a.clearTargetRotation(); end = now + (s.wait ?? 0); }, tick: now => now > end };
      }
      case "Rotate": {
        let done = false;
        return {
          start: () => {
            a.stopMoving();
            let r = (s.direction ?? 0) + (host.rand() * 2 - 1) * (s.rotationVariance ?? 0);
            if (s.relative) r += a.rotation;
            done = false;
            a.setTargetRotation(r);
            if (Math.abs(angleDiff(a.targetRotation, a.rotation)) < 1e-6) done = true;
          },
          tick: () => done,
          reachedTargetRotation: () => { done = true; },
        };
      }
      case "Move": {
        let path: [number, number][] | null = null, idx = 0, goal: { x: number; y: number } | null = null;
        const plan = () => {
          goal = host.locate?.(s.target) ?? null;
          path = goal ? host.path(a.x, a.y, goal.x, goal.y, s.maxPathLength ?? 10) : null;
          idx = 0;
        };
        return {
          start: plan,
          tick: () => {
            if (!goal || !path || Math.hypot(goal.x - a.x, goal.y - a.y) <= a.reachRadius()) { a.stopMoving(); return true; }
            while (path && Math.hypot(path[idx][0] - a.x, path[idx][1] - a.y) <= a.reachRadius()) {
              if (++idx === path.length) { a.stopMoving(); return true; }
            }
            const [nx, ny] = path[idx], rot = Math.atan2(ny - a.y, nx - a.x);
            if (Math.abs(angleDiff(a.rotation, rot)) > 1e-4) { a.stopMoving(); a.setTargetRotation(rot); } else a.startMoving();
            return false;
          },
        };
      }
      case "Condition":
        return { start: () => { a.stopMoving(); a.clearTargetRotation(); }, tick: () => host.condition?.(s.condition) ?? true };
      case "ConditionalScript": {
        const ok = this.step(s.success ?? { $class: "ScriptConfig$Goto" }), bad = this.step(s.failure ?? { $class: "ScriptConfig$Goto" });
        let sat = false;
        return { start: now => { a.stopMoving(); sat = host.condition?.(s.condition) ?? true; (sat ? ok : bad).start(now); }, tick: now => (sat ? ok : bad).tick(now) };
      }
      case "Goto":
        return { start: now => this.setCurrentStep(s.step ?? 0, now), tick: () => true };
      case "Action":
        return { start: () => {}, tick: () => { host.action?.(s.action); return true; } };
      case "SetSpeed":
        return { start: () => { a.speedOverride = s.speed ?? 0; }, tick: () => true };
      case "ClearSpeed":
        return { start: () => { a.speedOverride = null; }, tick: () => true };
      case "Attack": case "Attacks": {
        // projectx DungeonScriptConfig Attack: the attack runs to its end before the next step
        const list: number[] = kind === "Attacks" ? (s.attacks?.length ? s.attacks : [0]) : [s.attack ?? 0];
        let started = false;
        return {
          start: () => { a.stopMoving(); started = false; },
          tick: () => {
            if (!started) {
              if (!host.canAttack()) return false;
              started = host.attack(list[Math.floor(host.rand() * list.length)]);
              return !started;
            }
            return !host.attacking();
          },
        };
      }
      case "Noop": {
        let end = 0;
        return { start: now => { end = now + (s.delay ?? 0); }, tick: now => now >= end };
      }
      default:
        return { start: () => {}, tick: () => true };
    }
  }
}

/** DungeonBehaviorConfig.Attack: attacks with one attack whenever it can. */
class AttackB extends BehaviorLogic {
  constructor(readonly cfg: Extract<Behavior, { type: "Attack" }>, agent: Agent) { super(agent); }
  next = 0;
  startup() { if (this.cfg.stop !== false) this.agent.stopMoving(); }
  tick(now: number) {
    if (now < this.next || !this.host.canAttack()) return;
    const list = (this.cfg.attacks ?? [this.cfg.attack ?? 0]).filter(i => i < this.host.attackCount());
    if (!list.length) return;
    if (this.host.attack(list[Math.floor(this.host.rand() * list.length)])) this.next = now + (this.cfg.minAttackInterval ?? 0);
  }
}

/** Picks an entry by weight (none when all weigh nothing). */
export function pickWeighted<T>(list: T[], weight: (t: T) => number, rand: () => number): T | null {
  const total = list.reduce((s, t) => s + Math.max(0, weight(t)), 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const t of list) { r -= Math.max(0, weight(t)); if (r < 0) return t; }
  return list[list.length - 1] ?? null;
}

/** Evaluates a condition for an agent (and its current target). */
export function satisfied(c: Condition | undefined, agent: Agent, target: Seen | null, self: { health: number; maxHealth: number }): boolean {
  if (!c) return true;
  switch (c.type) {
    case "Always": return true;
    case "Never": return false;
    case "Health": {
      const share = self.maxHealth > 0 ? self.health / self.maxHealth : 1;
      return (c.below ?? true) ? share < c.health : share >= c.health;
    }
    case "TargetDistance": {
      if (!target) return false;
      const gap = Math.hypot(target.x - agent.x, target.y - agent.y) - target.radius - agent.radius;
      return (c.max === undefined || gap <= c.max) && (c.min === undefined || gap >= c.min);
    }
    case "AllyHurt":
      return agent.host.allies().some(s => s.health < s.maxHealth * (c.below ?? 1) && Math.hypot(s.x - agent.x, s.y - agent.y) <= c.radius);
    case "FoeNear":
      return agent.host.foes().some(s => Math.hypot(s.x - agent.x, s.y - agent.y) - s.radius <= c.radius);
    case "Random": return agent.host.rand() < c.chance;
    case "Not": return !satisfied(c.condition, agent, target, self);
    case "All": return c.conditions.every(x => satisfied(x, agent, target, self));
    case "Any": return c.conditions.some(x => satisfied(x, agent, target, self));
  }
}

/** The agent's own health, which conditions read (the world fills it in). */
export interface SelfHealth { health: number; maxHealth: number }
export const selfHealth = new WeakMap<Agent, SelfHealth>();
const selfOf = (a: Agent) => selfHealth.get(a) ?? { health: 1, maxHealth: 1 };

/**
 * DungeonBehaviorConfig.Targeting: acquires a target (the acquire region, and those who hurt
 * it: acquireDamagers), weighs candidates by hits, damage and distance (hitWeight 10,
 * damageWeight 10, distanceWeight -1), runs its target action on the best, keeps it until the
 * release condition holds, and without one runs its routine.
 */
export class Targeting extends Pathing {
  target: Seen | null = null;
  routine: BehaviorLogic;
  routineRunning = false;
  action: ActionLogic;
  constructor(readonly cfg: Extract<Behavior, { type: "Targeting" }>, agent: Agent) {
    super(cfg.evaluationInterval ?? 0.5, cfg.moveFaceRange, agent);
    this.routine = createBehavior(cfg.routine, agent);
    this.action = createAction(cfg.targetAction ?? { type: "PathAttack" }, this);
  }
  currentTarget() { return this.target; }
  startup() { super.startup(); this.routine.startup(); this.routineRunning = true; }
  tick(now: number) {
    // a target that has gone (died, hidden) is dropped at once
    if (this.target) this.target = this.refresh(this.target);
    if (now >= this.nextEvaluation) this.evaluate();
    if (this.target) {
      if (this.routineRunning) { this.routine.suspend(); this.routineRunning = false; }
      if (this.cfg.targetAction && this.cfg.targetAction.type !== "SimpleAttack" && (this.cfg.targetAction as PathFields).turnRate) {
        this.agent.setTurnRate((this.cfg.targetAction as PathFields).turnRate!);
      }
      this.action.tick(now, this.target);
      this.followPath();
    } else {
      this.agent.setTurnRate(0);
      if (!this.routineRunning) { this.clearPath(); this.routine.startup(); this.routineRunning = true; }
      this.routine.tick(now);
    }
  }
  reachedTargetRotation() { if (!this.target) this.routine.reachedTargetRotation(); }
  penetrated(px: number, py: number) {
    if (!this.target) this.routine.penetrated(px, py);
    else this.action.penetrated?.();
  }
  facingLimit() { return this.target ? super.facingLimit() : this.routine.facingLimit(); }

  /** The target as the world sees it now, or null when it is no longer there. */
  refresh(t: Seen): Seen | null {
    return candidates(this.host, this.cfg.targets ?? "foes").find(s => s.id === t.id) ?? null;
  }

  evaluate() {
    this.schedule();
    const a = this.agent, cfg = this.cfg;
    const self = selfOf(a);
    if (this.target) {
      const d = Math.hypot(this.target.x - a.x, this.target.y - a.y);
      const release = (cfg.release && satisfied(cfg.release, a, this.target, self)) || d > (cfg.leash ?? 18);
      if (release) this.target = null;
    }
    const kind = cfg.targets ?? "foes";
    const all = candidates(this.host, kind);
    const radius = cfg.acquireRadius ?? 10;
    const damagers = new Set(this.host.damagers());
    const acquireDamagers = cfg.acquireDamagers ?? "ALWAYS";
    const useDamagers = kind === "foes" && (acquireDamagers === "ALWAYS" || (acquireDamagers === "WHEN_VICTIMLESS" && !this.target));
    let best: Seen | null = null, bw = -Infinity;
    for (const s of all) {
      const d = Math.hypot(s.x - a.x, s.y - a.y);
      const hurt = this.host.damage(s.id);
      const inRegion = d - s.radius <= radius && (!cfg.sight || this.host.sees(a.x, a.y, s.x, s.y));
      const damager = useDamagers && damagers.has(s.id) && (hurt?.hits ?? 0) >= (cfg.minHitToTarget ?? 0);
      if (!inRegion && !damager && s.id !== this.target?.id) continue;
      const w = (cfg.hitWeight ?? 10) * (hurt?.hits ?? 0) + (cfg.damageWeight ?? 10) * ((hurt?.damage ?? 0) / Math.max(1, self.maxHealth))
        + (cfg.distanceWeight ?? -1) * d;
      if (w > bw) { bw = w; best = s; }
    }
    if (best && best.id !== this.target?.id) this.action.retarget?.();
    this.target = best;
    if (best) this.action.evaluate(best);
  }

  /** Paths toward a point (straight when the way is clear). */
  approach(x: number, y: number) {
    const a = this.agent;
    if (this.host.sees(a.x, a.y, x, y)) { this.setPath([[x, y]]); return; }
    const p = this.host.path(a.x, a.y, x, y, 20);
    if (p) this.setPath(p); else { this.clearPath(); a.face(x, y); }
  }
}

/** A target action's logic, run by a Targeting behaviour on its target. */
interface ActionLogic {
  evaluate(t: Seen): void;
  tick(now: number, t: Seen): void;
  retarget?(): void;
  penetrated?(): void;
}

function createAction(cfg: TargetAction, tb: Targeting): ActionLogic {
  switch (cfg.type) {
    case "SimpleAttack": return new SimpleAttackL(cfg, tb);
    case "PathAttack": return new PathAttackL(cfg, tb);
    case "TrackAttack": return new PathAttackL(cfg, tb);
    case "StraightAttack": return new StraightAttackL(cfg, tb);
    case "ChargeAttack": return new ChargeAttackL(cfg, tb);
    case "Flee": return new FleeL(cfg, tb);
    case "RandomAction": return new RandomActionL(cfg, tb);
  }
}

const gapTo = (a: Agent, t: Seen) => Math.hypot(t.x - a.x, t.y - a.y) - t.radius - a.radius;

/** Attack choice and timing shared by the attack actions. */
class AttackTimer {
  next = 0;
  constructor(readonly cfg: AttackFields, readonly tb: Targeting) {}
  ready(now: number) { return now >= this.next && this.tb.host.canAttack(); }
  pick(): number | null {
    const host = this.tb.host, list = (this.cfg.attacks ?? [0]).filter(i => i < host.attackCount());
    return list.length ? list[Math.floor(host.rand() * list.length)] : null;
  }
  fire(now: number, i: number | null = this.pick()): boolean {
    if (i === null || !this.tb.host.attack(i)) return false;
    this.next = now + (this.cfg.minAttackInterval ?? 1000);
    return true;
  }
}

/**
 * SimpleAttack: stands and turns to its target, attacking (one of `attacks`, at most every
 * minAttackInterval) once it faces it. Turrets: gun puppies, polyps, howlitzers.
 */
class SimpleAttackL implements ActionLogic {
  timer: AttackTimer;
  constructor(readonly cfg: Extract<TargetAction, { type: "SimpleAttack" }>, readonly tb: Targeting) { this.timer = new AttackTimer(cfg, tb); }
  evaluate() { this.tb.clearPath(); }
  tick(now: number, t: Seen) {
    const a = this.tb.agent;
    a.stopMoving();
    a.face(t.x, t.y);
    const off = Math.abs(angleDiff(Math.atan2(t.y - a.y, t.x - a.x), a.rotation));
    if (off < 0.15 && this.timer.ready(now)) this.timer.fire(now);
  }
}

/**
 * PathAttack (and TrackAttack): paths to the target until within maxAttackDistance (edge to
 * edge), then attacks, snapping to face it when attackFacesTarget; TrackAttack also backs away
 * inside minAttackDistance.
 */
class PathAttackL implements ActionLogic {
  timer: AttackTimer;
  constructor(readonly cfg: PathFields & { type: string; minAttackDistance?: number }, readonly tb: Targeting) { this.timer = new AttackTimer(cfg, tb); }
  evaluate(t: Seen) { this.plan(t); }
  plan(t: Seen) {
    const a = this.tb.agent, gap = gapTo(a, t);
    const max = this.cfg.maxAttackDistance ?? 0.85, min = this.cfg.minAttackDistance ?? 0;
    if (gap > max) this.tb.approach(t.x, t.y);
    else if (min > 0 && gap < min) {
      const d = Math.hypot(a.x - t.x, a.y - t.y) || 1, back = min - gap + 1;
      this.tb.approach(a.x + (a.x - t.x) / d * back, a.y + (a.y - t.y) / d * back);
    } else this.tb.clearPath();
  }
  tick(now: number, t: Seen) {
    const a = this.tb.agent, gap = gapTo(a, t);
    const max = this.cfg.maxAttackDistance ?? 0.85, min = this.cfg.minAttackDistance ?? 0;
    const inBand = gap <= max && gap >= min;
    // keep the last waypoint on a target it can walk straight to
    if (!inBand && this.tb.path && this.tb.pidx === this.tb.path.length - 1 && gap > max && this.tb.host.sees(a.x, a.y, t.x, t.y)) {
      this.tb.path[this.tb.pidx] = [t.x, t.y];
    }
    if (gap > max && !this.tb.path) this.plan(t);
    if (min > 0 && gap < min && !this.tb.path) this.plan(t);
    if (!inBand) return;
    this.tb.clearPath();
    const want = Math.atan2(t.y - a.y, t.x - a.x), off = Math.abs(angleDiff(want, a.rotation));
    if (this.cfg.turnSnap && off <= this.cfg.turnSnap) a.face(t.x, t.y, true);
    else a.face(t.x, t.y);
    const faces = this.cfg.attackFacesTarget ?? true;
    if (this.timer.ready(now) && (faces || off < 0.2)) {
      if (faces) a.face(t.x, t.y, true);
      this.timer.fire(now);
    }
  }
}

/**
 * StraightAttack: when it can see its target from beyond attack distance it faces it and runs
 * straight (no turning) at attackSpeed (0: its untargeted speed) for up to maxLength ms,
 * attacking once in reach; otherwise as PathAttack.
 */
class StraightAttackL extends PathAttackL {
  runUntil = 0;
  constructor(readonly s: Extract<TargetAction, { type: "StraightAttack" }>, tb: Targeting) { super(s, tb); }
  tick(now: number, t: Seen) {
    const a = this.tb.agent, gap = gapTo(a, t), max = this.s.maxAttackDistance ?? 0.85;
    if (a.run) {
      if (gap <= max && this.timer.ready(now)) { a.run = null; this.timer.fire(now); }
      return;
    }
    if (gap > max && this.timer.ready(now) && this.tb.host.sees(a.x, a.y, t.x, t.y)) {
      this.tb.clearPath();
      a.face(t.x, t.y, true);
      a.run = { speed: this.s.attackSpeed || a.speed, until: now + (this.s.maxLength ?? 1000) };
      return;
    }
    super.tick(now, t);
  }
  penetrated() { this.tb.agent.run = null; }
}

/**
 * ChargeAttack: in sight of its target and beyond attack distance it faces it and starts one
 * of `attacks` (the wind-up); `warmup` ms in it runs straight at attackSpeed (0: its
 * untargeted speed) for up to maxLength ms, and when the run ends (in reach, a wall, or time)
 * the wind-up stops and one of chargeAttacks follows. In reach it attacks as PathAttack.
 */
class ChargeAttackL extends PathAttackL {
  phase: "none" | "warmup" | "run" = "none";
  at = 0;
  constructor(readonly c: Extract<TargetAction, { type: "ChargeAttack" }>, tb: Targeting) { super({ ...c, attacks: c.chargeAttacks ?? [0] }, tb); }
  tick(now: number, t: Seen) {
    const a = this.tb.agent, host = this.tb.host, gap = gapTo(a, t), max = this.c.maxAttackDistance ?? 0.85;
    if (this.phase === "warmup") {
      if (!host.attacking()) { this.phase = "none"; return; }
      if (now - this.at >= (this.c.warmup ?? 0)) {
        this.phase = "run";
        this.at = now;
        a.run = { speed: this.c.attackSpeed || a.speed, until: now + (this.c.maxLength ?? 1000) };
      }
      return;
    }
    if (this.phase === "run") {
      if (a.run && gap > 0.25 && host.attacking()) return;
      this.finish(now);
      return;
    }
    if (gap > max && host.canAttack() && now >= this.timer.next && host.sees(a.x, a.y, t.x, t.y)) {
      const list = (this.c.attacks ?? [0]).filter(i => i < host.attackCount());
      if (list.length) {
        this.tb.clearPath();
        a.face(t.x, t.y, true);
        if (host.attack(list[Math.floor(host.rand() * list.length)])) { this.phase = "warmup"; this.at = now; return; }
      }
    }
    super.tick(now, t);
  }
  finish(now: number) {
    const a = this.tb.agent, host = this.tb.host;
    a.run = null;
    this.phase = "none";
    if (host.attacking()) host.stopAttack();
    this.timer.fire(now);
  }
  penetrated() { if (this.phase === "run") this.finish(this.tb.agent.now); }
}

/**
 * Flee: keeps away from the target, running to a point `distance` (ours: 5) beyond where
 * it stands, away from the target; with attacks (ours) it uses them when cornered.
 */
class FleeL implements ActionLogic {
  timer: AttackTimer;
  constructor(readonly cfg: Extract<TargetAction, { type: "Flee" }>, readonly tb: Targeting) { this.timer = new AttackTimer({ attacks: cfg.attacks, minAttackInterval: cfg.minAttackInterval }, tb); }
  evaluate(t: Seen) {
    const a = this.tb.agent, d = Math.hypot(a.x - t.x, a.y - t.y) || 1, run = this.cfg.distance ?? 5;
    const p = this.tb.host.path(a.x, a.y, a.x + (a.x - t.x) / d * run, a.y + (a.y - t.y) / d * run, run * 1.5);
    if (p) this.tb.setPath(p); else this.tb.clearPath();
  }
  tick(now: number, t: Seen) {
    if (this.tb.path) return;
    const a = this.tb.agent;
    a.face(t.x, t.y);
    if (this.cfg.attacks?.length && gapTo(a, t) < 1.5 && this.timer.ready(now)) this.timer.fire(now);
  }
}

/** RandomAction: at each evaluation, one of its actions by weight. */
class RandomActionL implements ActionLogic {
  logics: { weight: Weight; logic: ActionLogic }[];
  active: ActionLogic | null = null;
  constructor(cfg: Extract<TargetAction, { type: "RandomAction" }>, readonly tb: Targeting) {
    this.logics = cfg.actions.map(x => ({ weight: x.weight, logic: createAction(x.action, tb) }));
  }
  weightOf(w: Weight, t: Seen) {
    if (typeof w === "number") return w;
    const a = this.tb.agent;
    return satisfied(w.condition, a, t, selfOf(a)) ? w.success : w.fail;
  }
  busy() { return this.tb.agent.run !== null || (this.active as ChargeAttackL | null)?.phase === "warmup"; }
  evaluate(t: Seen) {
    // a charge under way finishes before the next choice
    if (!this.busy()) this.active = pickWeighted(this.logics, l => this.weightOf(l.weight, t), this.tb.host.rand)?.logic ?? null;
    this.active?.evaluate(t);
  }
  tick(now: number, t: Seen) { this.active?.tick(now, t); }
  retarget() { if (!this.busy()) this.active = null; }
  penetrated() { this.active?.penetrated?.(); }
}

/** DungeonBehaviorConfig.Cascading: runs the first behaviour whose condition holds. */
class Cascading extends Evaluating {
  logics: { condition?: Condition; logic: BehaviorLogic }[];
  active: BehaviorLogic | null = null;
  constructor(cfg: Extract<Behavior, { type: "Cascading" }>, agent: Agent) {
    super(cfg.evaluationInterval ?? 0.5, agent);
    this.logics = cfg.cascades.map(c => ({ condition: c.condition, logic: createBehavior(c.behavior, agent) }));
  }
  evaluate() {
    super.evaluate();
    const a = this.agent, target = this.active?.currentTarget() ?? null;
    const next = this.logics.find(l => satisfied(l.condition, a, target, selfOf(a)))?.logic ?? null;
    if (next === this.active) return;
    this.active?.suspend();
    if ((this.active = next)) next.startup();
  }
  tick(now: number) { super.tick(now); this.active?.tick(now); }
  reachedTargetRotation() { this.active?.reachedTargetRotation(); }
  penetrated(px: number, py: number) { this.active?.penetrated(px, py); }
  currentTarget() { return this.active?.currentTarget() ?? null; }
  facingLimit() { return this.active?.facingLimit() ?? null; }
}

/**
 * DungeonBehaviorConfig.Dodging: its behaviour, interrupted by a dodge when a threat (a
 * player's shot or swing: requiredTag faction_player) enters its intersection shape, at most
 * every minDodgeInterval (default 1000) ms: it turns by the entry's direction from the threat
 * and uses the entry's attack (a sidestep, a hop back, a burrow).
 */
class Dodging extends Evaluating {
  inner: BehaviorLogic;
  nextDodge = 0;
  seen = new WeakSet<Threat>();
  constructor(readonly cfg: Extract<Behavior, { type: "Dodging" }>, agent: Agent) {
    super(0, agent);
    this.inner = createBehavior(cfg.behavior, agent);
  }
  startup() { super.startup(); this.inner.startup(); }
  tick(now: number) {
    this.inner.tick(now);
    const a = this.agent, host = this.host;
    if (now < this.nextDodge || !host.canAttack() || a.run) return;
    const threats = host.threats(a.x, a.y, this.cfg.radius ?? a.radius + 1.5).filter(t => !this.seen.has(t));
    if (!threats.length) return;
    for (const t of threats) this.seen.add(t);
    if (host.rand() >= (this.cfg.chance ?? 1)) return;
    const dodges = this.cfg.dodges.filter(d => d.attack < host.attackCount());
    if (!dodges.length) return;
    const d = dodges[Math.floor(host.rand() * dodges.length)], t = threats[0];
    a.rotation = a.targetRotation = normalize(Math.atan2(t.y - a.y, t.x - a.x) + (d.direction ?? 0));
    if (host.attack(d.attack)) this.nextDodge = now + (this.cfg.minDodgeInterval ?? 1000);
  }
  reachedTargetRotation() { this.inner.reachedTargetRotation(); }
  penetrated(px: number, py: number) { this.inner.penetrated(px, py); }
  currentTarget() { return this.inner.currentTarget(); }
  facingLimit() { return this.inner.facingLimit(); }
}
