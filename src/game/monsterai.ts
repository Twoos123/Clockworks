// Which behaviour each monster runs (src/game/behavior.ts). The game's behaviour configs
// (config/behavior.dat, the actors' behavior fields) are stripped from the export, so each
// family's Targeting behaviour is rebuilt here from what survives: the actor's attack list
// (whose order the stripped configs indexed), its speeds and turn rate, the behaviour
// scripts some actors pass as arguments, and the wiki's account of how the family fights.
// Every choice and its source is logged in docs/research/monster-ai.md.
import { applyArguments } from "../config/params";
import type { Behavior, Condition, TargetAction, Weight } from "./behavior";

const isScript = (v: unknown): v is any[] =>
  Array.isArray(v) && v.length > 0 && v.every(s => /ScriptConfig\$/.test(String(s?.$class)));

/**
 * The behaviour script an actor carries (BehaviorConfig.Scripted steps). The behaviour
 * configs themselves are stripped from the export, but some actors pass their script as an
 * argument ("Behavior Script", "Behavior", "Steps") down their Derived chain, and the
 * argument survives: Blastcores, scripted knights and mission NPCs. The deepest reference
 * holding one wins (outer arguments are already applied to it).
 */
export function behaviorScript(ref: any, lookup: (name: string) => any): any[] | null {
  let found: any[] | null = null;
  for (let i = 0; i < 12 && ref?.name; i++) {
    for (const [k, v] of (ref.arguments?.entries ?? []) as [string, unknown][]) {
      if (/behavio|script|steps/i.test(String(k)) && isScript(v)) found = v;
    }
    const base = lookup(ref.name);
    if (!base) break;
    const impl = applyArguments(base, ref).implementation;
    if (impl?.behavior?.steps && isScript(impl.behavior.steps)) return impl.behavior.steps;
    if (!String(impl?.$class ?? "").endsWith("$Derived")) break;
    ref = impl.actor;
  }
  return found;
}

/** A parameter path into an actor's behaviour (not its script, which behaviorScript reads). */
const BEHAVIOR_PATH = /(^|\.)behavior(\[|\.|$)|\["Behavior"\]/;
const SCRIPT_PATH = /Script|Steps/;
const toBehavior = (paths: string[] | undefined) => (paths ?? []).some(p => BEHAVIOR_PATH.test(p) && !SCRIPT_PATH.test(p));

/**
 * The values an actor's Derived chain passes to the parameters that point into its stripped
 * behaviour. The behaviour configs are gone, but the actors' parameters naming their fields
 * survive, and so do the arguments the tiers pass: devilites' "Aquire Range" (6, 9, 12) and
 * "Attack Interval", mortafires' "Turn Rate", deadnaughts' "Charge - Movement Speed", mecha
 * knights' "Shield" and "Shock Chance", retrodes' "Swing Interval" and "Eye Beam"... A Choice
 * parameter (a lichen colony's "Size") gives its chosen option's values for the directs that
 * point into the behaviour. The outermost value wins, as arguments override inward.
 */
export function behaviorArgs(ref: any, lookup: (name: string) => any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => { if (v !== undefined && !(k in out)) out[k] = v; };
  for (let i = 0; i < 12 && ref?.name; i++) {
    const base = lookup(ref.name);
    if (!base) break;
    const args = new Map<string, unknown>((ref.arguments?.entries ?? []) as [string, unknown][]);
    for (const p of (base.parameters ?? []) as any[]) {
      if (p?.options) {
        const directs = ((p.directs ?? []) as any[]).filter(d => toBehavior(d.paths));
        if (!directs.length) continue;
        const chosen = args.has(p.name) ? args.get(p.name) : p.choice;
        put(p.name, chosen);
        const opt = (p.options as any[]).find(o => o?.name === chosen);
        const vals = new Map<string, unknown>((opt?.arguments?.entries ?? []) as [string, unknown][]);
        for (const d of directs) if (vals.has(d.name)) put(d.name, vals.get(d.name));
      } else if (toBehavior(p?.paths) && args.has(p.name)) put(p.name, args.get(p.name));
    }
    const impl = applyArguments(base, ref).implementation;
    if (!String(impl?.$class ?? "").endsWith("$Derived")) break;
    ref = impl.actor;
  }
  return out;
}

/** What the family table reads about a monster. */
export interface MonsterInfo {
  /** The actor config's name ("Character/NPC/Monster/Beast/Wolver/Wolver/Wolver 2"). */
  name: string;
  /** Its attacks' config names, in the config's order (the stripped behaviours index them). */
  attacks: string[];
  speed: number;
  targetedSpeed: number;
  /** Whether each attack strikes directly (a hit shape) rather than spawning something. */
  melee: boolean[];
  /** Each attack's reach, edge to edge (melee) or its projectile's range. */
  reach: number[];
  script?: any[] | null;
  /** Values passed to its behaviour's parameters (behaviorArgs). */
  args?: Record<string, unknown>;
}

/** Attacks that move or posture rather than strike (used by Dodging, never as attacks). */
export const DODGE = /Dodge|Dive Away|Close Ground|Cower|Warp \(Instant\)|Soldier Dodge/;
/** Attacks that support rather than strike: chosen by name, not as an attack on the target. */
export const SUPPORT = /Heal|Raise|Promote|Overtime|Sip Coffee|Buff|Use Potion|Bark|Aura|Talk|Taunt|Speech|Defend|Deflect|Spaz|Camoflage|Panic|Expose|Hide|Signal|Recover|Twitch|Monologue|Merge|Cloak|Self Destruct|Writhe|Cower|Stunned|Charge - (Start|Finish|Wait|Stop|End)|Charge (Loop|Outro)|Ready Sword|Spawn|Swap|Activate|Call Minions|Kill Minions|Consume|Pulse/;

/** The monster's tier from its name (" 2", "Mk III"), 1 when it says none. */
export function tierOf(name: string): number {
  const m = /\b([123])\)?$/.exec(name) ?? /(?:Mk|Stage) ?(I{1,3}|[123])\b/.exec(name);
  if (!m) return 1;
  const t = m[1];
  return t === "III" ? 3 : t === "II" ? 2 : t === "I" ? 1 : Number(t);
}

const near = (max: number): Condition => ({ type: "TargetDistance", max });
const far = (min: number): Condition => ({ type: "TargetDistance", min });
const when = (condition: Condition, success: number, fail = 0): Weight => ({ condition, success, fail });

/** Builds a monster's behaviour. */
export function monsterBehavior(m: MonsterInfo): Behavior {
  const n = m.name, tier = tierOf(n);
  const idx = (re: RegExp) => m.attacks.flatMap((a, i) => (re.test(a) ? [i] : []));
  const first = (re: RegExp) => idx(re)[0];
  // the tiers' arguments to the stripped behaviour (behaviorArgs): config values where they survive
  const args = m.args ?? {};
  const num = (k: string): number | undefined => (typeof args[k] === "number" ? args[k] as number : undefined);
  const flag = (k: string): boolean | undefined => {
    const v = args[k];
    return v === undefined || v === null ? undefined : v === true || v === "True" || v === "On" || v === "Always Target";
  };
  // bosses fight across their arenas: a wide region, never let go (ours)
  const boss = /\/Boss\//.test(n) ? { acquireRadius: 16, leash: 60 } : {};
  const offensive = m.attacks.flatMap((a, i) => (a && !DODGE.test(a) && !SUPPORT.test(a) ? [i] : []));
  const dodges = (re: RegExp, chance: number, direction = 0, minDodgeInterval = 1000) => {
    const list = idx(re);
    return list.length ? { dodges: list.map(attack => ({ attack, direction })), chance, minDodgeInterval } : null;
  };
  const dodging = (inner: Behavior, d: ReturnType<typeof dodges>): Behavior =>
    d ? { type: "Dodging", behavior: inner, ...d } : inner;
  const wander: Behavior = m.speed > 0 ? { type: "Wander", evaluationInterval: [2, 4], radius: 4 } : { type: "Idle" };
  const target = (targetAction: TargetAction, extra: Partial<Extract<Behavior, { type: "Targeting" }>> = {}): Behavior =>
    ({ type: "Targeting", routine: wander, acquireRadius: 10, targetAction, ...boss, ...extra });
  const path = (attacks: number[], maxAttackDistance = 0.85, more: object = {}): TargetAction =>
    ({ type: "PathAttack", attacks, maxAttackDistance, ...more });
  const track = (attacks: number[], minAttackDistance: number, maxAttackDistance: number, more: object = {}): TargetAction =>
    ({ type: "TrackAttack", attacks, minAttackDistance, maxAttackDistance, ...more });
  /** A config value for minAttackInterval, when the tier passes one. */
  const every = (k: string): object => (num(k) !== undefined ? { minAttackInterval: num(k) } : {});
  const random = (...actions: [Weight, TargetAction | null][]): TargetAction => {
    const ok = actions.filter((x): x is [Weight, TargetAction] => !!x[1] && hasAttacks(x[1]));
    if (!ok.length) return path(offensive);
    return ok.length === 1 ? ok[0][1] : { type: "RandomAction", actions: ok.map(([weight, action]) => ({ weight, action })) };
  };

  // a behaviour script that survived in the actor's arguments is the real behaviour
  if (m.script?.length) return { type: "Scripted", steps: m.script };

  // ---- Slimes
  if (/\/Slime\/(Polyp)\//.test(n))
    // Polyps are turrets that see in every direction (wiki: Polyp)
    return target({ type: "SimpleAttack", attacks: offensive }, { acquireRadius: 9, routine: { type: "Idle" } });
  if (/Lichen Colony/.test(n))
    // the tackle's reach is the colony size's "Max Attack Distance" (0.8 for one core to 2 for
    // a giant colony)
    return target(random([1, path(idx(/^.*\/Lichen$/), num("Max Attack Distance") ?? 0.85)], [when(near(2.5), 1, 0.2), path(idx(/Spin|Impale/), 1.5)]), { acquireRadius: 8 });
  if (/\/(Oiler)/.test(n))
    // Oilers dash across the floor leaving slicks, and punch close up
    return target(random([when(far(2), 2, 0), path(idx(/Oiler Dash/), 6)], [when(near(1.5), 2, 0.2), path(idx(/Punch|Spin/))],
      [0.5, path(idx(/Oiler Place/), 8)]), { acquireRadius: 9 });
  if (/Quicksilver/.test(n))
    return target(random([2, path(idx(/Punch/))], [when(far(2), 1, 0), path(idx(/Quicksilver Charge/), 4)]));
  if (/Glop Drop|\/Drop\//.test(n))
    // drops roll at the knight and become a puddle under it (wiki: Drop)
    return target(path(offensive.length ? offensive : [0], 0.3), { acquireRadius: 8 });
  if (/\/Slime\//.test(n) || /Creep Cake|Void Gel|Royal Mini|Jelly Cube/.test(n)) {
    // jellies close in and tackle; higher tiers raise thorns under the knight (wiki: Jelly)
    const melee = idx(/Roundhouse|Punch|Lichen$/);
    return target(random([3, path(melee.length ? melee : offensive)],
      [when(far(1), 1, 0.3), path(idx(/Impale/), 3)],
      [when(near(1.5), 1, 0), path(idx(/Spin/), 0.85)]), { acquireRadius: 8 });
  }

  // ---- Constructs
  if (/Gun Puppy|Rocket Puppy|Love Puppy|Plasma Dog|Red Rover|Howlizter|Howlitzer/.test(n))
    // stationary, turning slowly, firing at what it sees or what shot it (wiki: Gun Puppy)
    return target({ type: "SimpleAttack", attacks: offensive }, { acquireRadius: 10, sight: true, routine: { type: "Idle" } });
  if (/Retrode|Cake Bot/.test(n)) {
    // zombie-like: a swipe close up, an eye beam along a line from tier 2 (wiki: Retrode); the
    // tiers pass "Eye Beam" (off at tier 1), "Swing Interval" (4000/3000/2000 ms) and "Beam
    // Interval" (6000/6000/4000 ms)
    const beam = flag("Eye Beam") ?? tier >= 2;
    return target(random([3, path(idx(/Swipe/), 0.85, every("Swing Interval"))],
      [when(far(1.5), 1.5, 0), beam ? path(idx(/Eye Beam/), 6, every("Beam Interval")) : null]));
  }
  if (/Mecha Knight|Mega Knight/.test(n)) {
    // advance and slash; the shield goes up against shots from tier 2 (the tiers' "Shield"
    // argument: False, True, True; wiki: Mecha Knight). "Shock Chance" (0.333, 0.222, 0.111)
    // is read as the share of its choices that are a malfunction, at most every 5 s.
    const shock = num("Shock Chance") ?? 0.15 / 4.15;
    const inner = target(random([3, path(idx(/\(Charge\)|Charge \(/), 0.85)], [1, path(idx(/Swing/), 1.2)],
      [4 * shock / Math.max(0.05, 1 - shock), path(idx(/Spaz/), 99, { minAttackInterval: 5000 })]));
    const shield = flag("Shield") ?? (tier >= 2 || /Mk II|Mega/.test(n));
    return shield ? dodging(inner, dodges(/Defend/, 0.6)) : inner;
  }
  if (/Lumber|Ironwood|Sentinel|Electreant|Redward|Silversap|Vilewood/.test(n))
    // slow, swinging at anything close, then idle "for a few seconds before he strikes
    // again" (wiki: Lumber): 3 s between smashes
    return target(path(offensive, 0.85, { minAttackInterval: 3000 }), { acquireRadius: 8 });
  if (/Scuttlebot|Brumabot|Cinderbot|Hazbot|Surgebot/.test(n))
    // a short-range spread of three bullets (wiki: Scuttlebot)
    return target(track(offensive, 0, 3), { acquireRadius: 9 });
  if (/Tortodrone/.test(n)) {
    // patrols ignoring knights unless provoked; the corrupted one attacks (wiki: Tortodrone)
    // the tiers' "Acquire" argument: "Default" for the plain one, "Always Target" for the hostile
    const provoked = (flag("Acquire") ?? /hostile|corrupted/.test(n)) ? 10 : 0;
    return target(random(
      [when(far(4), 1.5, 0), { type: "ChargeAttack", attacks: idx(/Charge Loop/), chargeAttacks: idx(/Charge Outro/), warmup: 900, maxLength: 2000, maxAttackDistance: 1 }],
      [when(far(3), 1, 0.2), track(idx(/Missle|Missile/), 3, 10)],
      [when(near(2), 2, 0), path(idx(/Punch$/), 1.5)],
      [when(near(2.5), 1, 0), path(idx(/Fist Pound/), 2)]), { acquireRadius: provoked });
  }
  if (/Blastcore/.test(n))
    return target({ type: "SimpleAttack", attacks: offensive }, { routine: { type: "Idle" } });

  // ---- Beasts
  if (/Snarbolax/.test(n))
    // the wolver pattern, bigger: tail-whips close up, charges from afar, barks (its director
    // runs the bell stuns and burrows; Snarbolax/Stun and Warp To are its)
    return target(random([3, path(idx(/Tail-Whip/), 1)],
      [when(far(4), 1.5, 0), { type: "ChargeAttack", attacks: idx(/Charge - Start/), chargeAttacks: idx(/Charge - End/), warmup: 1000, maxLength: 2500, maxAttackDistance: 1 }],
      [when(far(3), 0.3, 0), path(idx(/Snarbolax\/Bark/), 99)]), { acquireRadius: 16, leash: 40 });
  if (/Wolver|Vog Cub/.test(n)) {
    // close in and bite; bark now and then; sidestep or hop back from shots, burrowing away
    // at tier 3 (wiki: Wolver)
    const bite = idx(/Bite/);
    // vog cubs have no bite: their attack is the burrow that leaves flames behind
    if (!bite.length) return target(random([3, path(idx(/Warp/), 2)], [when(far(3), 0.4, 0.1), path(idx(/Bark/), 99)]), { acquireRadius: 12 });
    const inner = target(random([4, path(bite, 1.2)], [when(far(3), 0.4, 0.1), path(idx(/Bark/), 99)]), { acquireRadius: 12 });
    // wiki Wolver: at tier 2 alphas can burrow; at tier 3 all wolvers burrow and dodge projectiles
    if (tier >= 3) return dodging(inner, dodges(/Dodge|Warp/, 0.5));
    if (tier === 2 && /Alpha/.test(n)) return dodging(inner, dodges(/Warp/, 0.3));
    return inner;
  }
  if (/Chromalisk|Electrolisk|Salamander|Tundralisk|Virulisk|Kleptolisk/.test(n)) {
    // licks close up or spits from range; dodges projectiles (wiki: Chromalisk)
    const lick = idx(/Chromalisk$|Chromalisk Whelp$|Kleptolisk$/), spit = idx(/Spew/);
    const inner = target(spit.length ? track(spit, 1.5, 5) : path(lick, 1.5));
    return dodging(inner, dodges(/Dodge/, 0.5));
  }
  if (/Dust Bunny|Bunny/.test(n))
    return target(path(offensive, 1), { acquireRadius: 10 });
  if (/Lizardman/.test(n))
    return dodging(target(path(idx(/Thrust/), 4)), dodges(/Dodge/, 0.5));

  // ---- Fiends
  if (/Devilite|Firebrander|Layoafer|Blarful|Devil-IT/.test(n) && !/Pit Boss|Yesman/.test(n)) {
    // hold their spot and throw; overtimers charge and swing; all dodge projectiles; dive away
    // from a knight on top of them (wiki: Devilite)
    // The tiers pass their behaviour "Aquire Range" (6/9/12; overtimers 8/10/12), "Attack
    // Interval" (5000/4200/2600 ms; overtimers 5000/3500/2000), "Dodges" (Off at tier 1) and
    // "Min Dodge Interval" (15000/4500/3000 ms; overtimers 6000/3000/1500).
    const throws = idx(/(^|\/)(Office Supplies|Junk|Electronics|Throw|Weapons)\//);
    const inner = target(random(
      [2, track(throws, 2, 6, every("Attack Interval"))],
      [when(near(1.5), 2, 0.6), path(idx(/Swing Weapon/), 0.85, every("Attack Interval"))],
      [when(near(0.6), 0.5, 0), path(idx(/Dive Away/), 99)]), { acquireRadius: num("Aquire Range") ?? 10 });
    if (flag("Dodges") === false) return inner;
    return dodging(inner, dodges(/Devilite\/Dodge$/, 0.7, Math.PI / 2, num("Min Dodge Interval") ?? 1000));
  }
  if (/Pit Boss/.test(n)) {
    // keeps away from knights and works its staff (wiki: Devilite: Pit Boss); the tiers pass
    // "Aquire Range" (12/14/18) and the weights of its staff work: "Coffee Weight" (10/10/5),
    // "Overtime Weight" (6/9/20), "Promote Weight" (5)
    const staff: [RegExp, string, number][] = [[/Sip Coffee/, "Coffee Weight", 10], [/Overtime/, "Overtime Weight", 6], [/Promote/, "Promote Weight", 5]];
    const works = staff.flatMap(([re, k, w]) => idx(re).length ? [{ weight: num(k) ?? w, behavior: { type: "Attack", attacks: idx(re), minAttackInterval: 6000, stop: false } as Behavior }] : []);
    return { type: "Combined", first: target({ type: "Flee", distance: 4 }, { acquireRadius: num("Aquire Range") ?? 10 }),
      second: works.length ? { type: "Random", evaluationInterval: 6, behaviors: works } : { type: "Attack", attacks: offensive, minAttackInterval: 6000, stop: false } };
  }
  if (/Yesman/.test(n))
    return { type: "Follow", target: { kind: "allies" }, minimumDistance: 1, maximumDistance: 3 };
  // (Slag Guard (2) derives from the deadnaughts and fights as one, below)
  if (/Trojan|Slag Guard/.test(n) && !/\/Deadnaught\//.test(n)) {
    // turns to face whoever hurt it most; charges from afar, slams close up, pushes back
    // knights at its feet (wiki: Trojan)
    const slam = idx(/Sword Slam/);
    const inner = target(random(
      [when(far(3), 2, 0), { type: "StraightAttack", attacks: slam, maxAttackDistance: 1.2, maxLength: 1500 }],
      [when(near(3), 3, 0), path(slam, 1.2)],
      [when(near(1.5), 1, 0), path(idx(/Push Back/), 1.5)]), { damageWeight: 30, acquireRadius: 10 });
    return dodging(inner, dodges(/Shield Deflect/, 0.4));
  }
  if (/Deadnaught|Deadnought|Almire Knight|Beast Master/.test(n)) {
    // charges with its spear on its own timer, and raises the dead (wiki: Deadnaught: "act on
    // a timer"); the tiers pass "Charge - Min Attack Interval" (7200/6400/6000 ms; Almire
    // knights, beast masters and Vanaduke's 6000) and "Charge - Movement Speed" (6/7/8)
    const chargeSpeed = num("Charge - Movement Speed");
    const inner = target(random(
      [3, { type: "ChargeAttack", attacks: idx(/Charge - Start/), chargeAttacks: idx(/Charge - Finish/), warmup: 700, maxLength: 2500, maxAttackDistance: 1,
        minAttackInterval: num("Charge - Min Attack Interval") ?? 6000, ...(chargeSpeed ? { attackSpeed: chargeSpeed } : {}) }],
      [0.5, path(idx(/Raise Dead/), 99)]), { acquireRadius: 14 });
    return dodging(inner, dodges(/Shield Deflect/, 0.4));
  }
  if (/Soldier of Almire/.test(n))
    return dodging(target(path(idx(/Charge \(Swipe\)/), 3)), dodges(/Soldier Dodge/, 0.4));
  if (/Gorgo|Firegut|Guster|Storm Belly|Waster/.test(n))
    // hover until a knight is in sight, then lunge in and chomp (wiki: Gorgo)
    return target(path(idx(/Bite/), 2), { acquireRadius: 9, sight: true });
  if (/Greaver/.test(n))
    // follows its knight and swoops in after a moment (wiki: Greaver: "hugging their target's
    // behind closely for a few moments before hitting"); the tiers' "Attack Interval" is the
    // target action's minAttackInterval: 6000/5000/4000 ms
    return target(path(offensive, 4, { minAttackInterval: num("Attack Interval") ?? 5000 }), { acquireRadius: 10 });
  if (/Silkwing/.test(n)) {
    // no attack: it heals the wounded it touches (its timer's heal), follows big monsters,
    // and darts away from shots (wiki: Silkwing)
    return dodging({ type: "Cascading", cascades: [
      { condition: { type: "AllyHurt", radius: 12 }, behavior: { type: "Follow", target: { kind: "hurtAllies" }, minimumDistance: 0, maximumDistance: 0.6, evaluationInterval: 0.5 } },
      { condition: { type: "Always" }, behavior: { type: "Random", evaluationInterval: 3, behaviors: [
        { weight: 2, behavior: { type: "Follow", target: { kind: "allies", sizes: ["LARGE", "MEDIUM"] }, minimumDistance: 1, maximumDistance: 3, evaluationInterval: 1 } },
        { weight: 1, behavior: { type: "Wander", evaluationInterval: [1, 3], radius: 4 } }] } }] }, dodges(/Silkwing 1/, 0.5));
  }

  // ---- Gremlins
  if (/Mender/.test(n)) {
    // heals wounded allies; otherwise keeps away from knights; dodgy (wiki: Gremlin)
    const heals = idx(/Heal \((Target|Renew)\)/), omni = idx(/Heal \(Omni\)/);
    return dodging({ type: "Cascading", cascades: [
      { condition: { type: "AllyHurt", radius: 10 }, behavior: { type: "Targeting", targets: "hurtAllies", acquireRadius: 10, routine: wander,
        targetAction: random([2, path(heals, 3, { minAttackInterval: 2500 })], [1, path(omni, 2, { minAttackInterval: 2500 })]) } },
      { condition: { type: "Always" }, behavior: target({ type: "Flee", distance: 5 }) }] }, dodges(/Dodge/, 0.6));
  }
  if (/Demo/.test(n))
    // runs about throwing and placing bombs (wiki: Gremlin: Demo)
    return dodging(target(random([3, track(idx(/Throw/), 3, 7)], [1, path(idx(/Place Bomb/), 8)]), { acquireRadius: 11 }),
      dodges(/Dodge Back/, /Tenderfoot/.test(n) ? 0.3 : 0.5));
  if (/Scorcher/.test(n))
    // flames close up, bullets when the flames cannot reach (wiki: Gremlin: Scorcher)
    return target(random(
      [when(near(3), 3, 0), path(idx(/Torch/), 2.5)],
      [when(far(3), 2, 0.3), track(idx(/Fire Bullet/), 2.5, 7)],
      [0.5, path(idx(/FlameWall/), 5)],
      [when({ type: "Health", health: 0.25 }, 2, 0), path(idx(/Self Destruct/), 99)],
      [when({ type: "Health", health: 0.4 }, 1, 0), path(idx(/Use Potion/), 99, { minAttackInterval: 10000 })]), { acquireRadius: 10 });
  if (/Thwacker|Gremlin Chef|Void Gremlin/.test(n)) {
    // hammer swings close up; tenderfoots throw when out of reach; ironclaws close the gap;
    // all "dodge guns and projectile-like attacks" (wiki: Thwacker), tenderfoots less
    const inner = target(random(
      [when(near(2), 3, 0.3), path(idx(/Hammer (Swing|Thwack|Pushaway)/), 1)],
      [when(far(2.5), 1.5, 0), track(idx(/Hammer Throw/), 2.5, 6)],
      [when(far(2), 1, 0), path(idx(/Close Ground/), 5)],
      [when({ type: "Health", health: 0.4 }, 1, 0), path(idx(/Use Potion/), 99, { minAttackInterval: 10000 })]), { acquireRadius: 10 });
    return dodging(inner, dodges(/Dodge Back/, /Tenderfoot/.test(n) ? 0.25 : 0.4));
  }
  if (/Knocker|Choker|Cooler|Jumper|Lighter/.test(n))
    return target(path(offensive, 1));
  if (/Mortafire/.test(n)) {
    // shells on the tiers' "Attack Interval" (6000/5000/4000 ms), turning at their "Turn Rate"
    // (200/240/280 degrees a second) while aiming
    const turn = num("Turn Rate");
    return target(track(idx(/Artillery/), 3, 9, { ...every("Attack Interval"), ...(turn ? { turnRate: turn } : {}) }), { acquireRadius: 12 });
  }
  if (/Stalker|Herex/.test(n))
    // strikes out of its cloak, dodges, cloaks again
    return dodging(target(random([3, path(idx(/Uncloak/), 1)], [when(far(3), 0.5, 0), path(idx(/^.*\/Cloak$/), 99)])), dodges(/Generic\/Dodge$/, 0.4));

  // ---- Undead
  if (/Bombie/.test(n))
    // runs at a knight and blows up on contact (wiki: Bombie)
    return target(path(offensive.length ? offensive : idx(/Destroy/), 0.2), { acquireRadius: 9 });
  if (/Zombie|Droul|Frankenzom|Carnavon|Shamber|Slag Walker|Gourdling|Slag Curser/.test(n)) {
    // shamble in and swipe; leap on knights a little way off; breathe from tier 2 (wiki: Zombie)
    const grapple = first(/Grapple/), breath = first(/Breath$/);
    return target(random([3, path(idx(/Swipe/))],
      [when({ type: "All", conditions: [far(1.2), near(4)] }, 2, 0), grapple === undefined ? null : path([grapple], 3.5)],
      [when(near(2.5), 1, 0), breath === undefined ? null : path([breath], 2)]), { acquireRadius: 10 });
  }
  if (/Spookat|Kat|Bloogato|Dybbuk|Barlok/.test(n)) {
    // fly at a knight and bite; spit hairballs from tier 2; black kats summon (wiki: Kat);
    // black kats' tiers pass "Attack Interval" (4000/3500 ms) and "Pre-Rotation Pause" (2/1.5 s)
    const pause = num("Pre-Rotation Pause");
    const routine: Behavior | undefined = pause !== undefined && m.speed > 0
      ? { type: "Wander", evaluationInterval: [2, 4], radius: 4, preRotationPause: pause } : undefined;
    return target(random([3, path(idx(/Bite|Undead\/Spookat$/), 1.5, every("Attack Interval"))],
      [when(far(2), 1.5, 0), track(idx(/Spit/), 2, 6, every("Attack Interval"))],
      [0.3, path(idx(/Spookat Aura/), 99, { minAttackInterval: 8000 })]), { acquireRadius: 10, ...(routine ? { routine } : {}) });
  }
  if (/Scarab/.test(n))
    // swarms, homing in with flying tackles (wiki: Scarab)
    return target(path(offensive, 1.5), { acquireRadius: 10 });
  if (/Phantom/.test(n))
    return target(random([3, path(offensive, 1)]), { acquireRadius: 10 });

  // ---- Drones: they ride their own rails and never target (wiki: Shankle)
  if (/\/Drone\//.test(n))
    return { type: "Attack", attacks: idx(/Peek$|Flip/), stop: false, minAttackInterval: 0 };

  return { ...generic(m, offensive, wander), ...boss } as Behavior;
}

/** Anything else, from its data: a turret, a ranged keeper of distance, or a brawler. */
function generic(m: MonsterInfo, offensive: number[], wander: Behavior): Behavior {
  const attacks = offensive.length ? offensive : m.attacks.map((_, i) => i).filter(i => !DODGE.test(m.attacks[i]));
  const routine = wander;
  if (m.targetedSpeed <= 0) return { type: "Targeting", routine: { type: "Idle" }, targetAction: { type: "SimpleAttack", attacks } };
  const melee = attacks.filter(i => m.melee[i]), ranged = attacks.filter(i => !m.melee[i]);
  if (!melee.length && ranged.length) {
    const range = Math.min(...ranged.map(i => m.reach[i] || 6));
    return { type: "Targeting", routine, targetAction: { type: "TrackAttack", attacks: ranged, minAttackDistance: range * 0.3, maxAttackDistance: Math.max(range * 0.8, range * 0.3 + 1) } };
  }
  const reach = melee.length ? Math.max(0.6, Math.min(...melee.map(i => m.reach[i] || 0.85))) : 0.85;
  const action: TargetAction = ranged.length
    ? { type: "RandomAction", actions: [
      { weight: { condition: { type: "TargetDistance", max: reach + 0.5 }, success: 3, fail: 0.5 }, action: { type: "PathAttack", attacks: melee, maxAttackDistance: reach } },
      { weight: { condition: { type: "TargetDistance", min: reach + 0.5 }, success: 1.5, fail: 0 }, action: { type: "TrackAttack", attacks: ranged, minAttackDistance: reach, maxAttackDistance: Math.max(reach + 1, Math.min(...ranged.map(i => m.reach[i] || 6)) * 0.8) } }] }
    : { type: "PathAttack", attacks: melee, maxAttackDistance: reach };
  return { type: "Targeting", routine, targetAction: action };
}

/** Whether a target action names any attack (empty ones are dropped from random choices). */
function hasAttacks(a: TargetAction): boolean {
  if (a.type === "Flee") return true;
  if (a.type === "RandomAction") return a.actions.length > 0;
  return (a.attacks?.length ?? 1) > 0;
}
