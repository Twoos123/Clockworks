// Derived levels: a Battle Arena the archive lacks, built from one it holds.
//
// Every regular Battle Arena floor ("ima_beast", Ice Maul Arena: Beastly Brawl) is the same
// skeleton of prefab rooms the servers assemble: a start elevator, three flights of stairs, three
// battle rooms ("room_battle_1st_NS_5w_01" ...), a break room beside each and the exit
// elevators; the castle tiles are the Arena King set whatever the arena. What differs between the
// thirty arenas is what the servers bake into that skeleton for the level's spawn types (a family
// and a status, LevelSceneConfig.spawnTypes): the spawn table each Class Spawn names (a family's
// monsters and their status variants, "Beast/Wolver/Frostifur" under freeze), the typed mineral
// nodes, and the environment globals ("Environment/Custom/Battle Arena/Freeze/Fog").
//
// So a missing arena is the archived one with its spawns re-cast and its environment re-themed,
// both from the client's own data:
//
// - Spawn types. Every leaf monster table carries its types (config/spawn_table.dat: a family,
//   a status, "vanilla" for none, and a role such as grunt or brute), and the status variants of
//   a monster sit in one list ("Status - Wolver"), a family's monsters of a role in another
//   ("Beast - Grunt", empty lists falling back to another family's: "Beast - Elite" is the
//   Mecha Knights). The client resolves such a list against the level's spawn types
//   (SpawnTableConfig$SpawnTypeListEntry): every leaf scores the number of its types the level
//   has, the best score of at least one wins (ties at random), and with none the list's default
//   is taken. resolveTypes() is that rule.
// - Re-casting. Each baked spawn is re-resolved with that rule for the new level's types: the
//   arena family's own monsters through the new family's list of the same role, other families'
//   monsters (the rooms' supports and turrets) through their own monster's status list. The
//   servers fill the waves with vanilla monsters as well as status ones (an Ice Maul arena has
//   Wolvers beside its Frostifurs), which the client data does not explain, so a spawn keeps
//   that choice: a status monster takes the new status, a vanilla one stays vanilla; from a
//   vanilla arena every spawn takes the new status, as the client rule gives for {family, status}.
//   The spawns of one group (one Spawn Tag and table: a wave) are decided once, as the servers
//   bake them (a wave is all one monster).
// - Environment. The status's own "Battle Arena/<Status>/" globals replace the arena's; where
//   the library has none of that name (Poison has no Light Set or Music Mix, Shock no Music Mix)
//   the arena's "Default" one is used (every arena Music Mix there is the same clockwork_action
//   track). The status's extra globals follow the archived levels of each status: only freeze
//   levels add one (Universal/Freeze/Vision Snow, the snowfall).
//
// The Clockwork Tunnels and the Gremlin Compounds are not like this: each capture of one area and
// family is a different arrangement of prefab rooms, so they are new floors assembled from the
// captured rooms (src/gen/assemble.ts), not derived.

import { rng } from "../gen/layout";

export type Status = "Fire" | "Freeze" | "Poison" | "Shock";
export type FamilyName = "Beast" | "Construct" | "Fiend" | "Gremlin" | "Slime" | "Undead";

/** The five arenas by scene key prefix, and their status (Iron Edge none). */
export const ARENA_AREAS: Record<string, Status | null> = { iea: null, fla: "Fire", ima: "Freeze", vfa: "Poison", tfa: "Shock" };
const FAMILY_KEYS = ["beast", "construct", "fiend", "gremlin", "slime", "undead"];
const STATUS_TAGS = ["vanilla", "fire", "freeze", "poison", "shock"];
const ROLES = ["grunt", "brute", "elite", "giant", "mini", "support", "turret"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** A status's spawn type ("vanilla" for none). */
export const statusTag = (s: Status | null) => (s ? s.toLowerCase() : "vanilla");

/** A regular arena by its scene name ("ima beast"); null for any other scene (mission floors included). */
export function arenaOf(sceneName: string): { area: string; family: FamilyName; status: Status | null } | null {
  const m = /^(iea|fla|ima|vfa|tfa) (beast|construct|fiend|gremlin|slime|undead)$/.exec(sceneName.toLowerCase().replace(/_/g, " ").trim());
  return m ? { area: m[1], family: cap(m[2]) as FamilyName, status: ARENA_AREAS[m[1]] } : null;
}

/** The arena area for a status ("ima" for Freeze). */
export const arenaArea = (s: Status | null) => Object.keys(ARENA_AREAS).find(k => ARENA_AREAS[k] === s)!;

/** The scene name of an arena ("fla fiend"). */
export const arenaName = (family: FamilyName, status: Status | null) => `${arenaArea(status)} ${family.toLowerCase()}`;

/**
 * The source an arena is derived from among the archived ones: the same status first (only the
 * monsters change), then the same family (only the environment), then any; the newest scene of
 * those. Null when none is archived (or the arena itself is).
 */
export function pickArenaSource<T extends { id: string; name: string }>(sources: readonly T[], family: FamilyName, status: Status | null): T | null {
  const rated = sources.map(s => ({ s, a: arenaOf(s.name) })).filter(x => x.a);
  if (rated.some(x => x.a!.family === family && x.a!.status === status)) return null;
  const score = (a: NonNullable<ReturnType<typeof arenaOf>>) => (a.status === status ? 2 : 0) + (a.family === family ? 1 : 0);
  rated.sort((x, y) => score(y.a!) - score(x.a!) || Number(y.s.id) - Number(x.s.id));
  return rated[0]?.s ?? null;
}

/**
 * The arenas the given scene names let us derive: every regular arena not among them, when one
 * is, by scene key ("fla_fiend") with the scene it would be derived from.
 */
export function derivedArenas(sceneNames: Iterable<string>): Map<string, string> {
  const sources = [...sceneNames].map((name, i) => ({ id: String(i), name }));
  const out = new Map<string, string>();
  for (const area of Object.keys(ARENA_AREAS))
    for (const fam of FAMILY_KEYS) {
      const src = pickArenaSource(sources, cap(fam) as FamilyName, ARENA_AREAS[area]);
      if (src) out.set(`${area}_${fam}`, src.name);
    }
  return out;
}

/** Derived scene ids: "derive:<source scene id>:<family>:<status or none>:<seed>". */
export const DERIVE = /^derive:(\d+):([a-z]+):([a-z]+):(\d+)$/;
export const deriveId = (source: string, family: FamilyName, status: Status | null, seed: number) =>
  `derive:${source}:${family.toLowerCase()}:${status ? status.toLowerCase() : "none"}:${seed >>> 0}`;
export function parseDeriveId(id: string): { source: string; family: FamilyName; status: Status | null; seed: number } | null {
  const m = DERIVE.exec(id);
  if (!m || !FAMILY_KEYS.includes(m[2]) || !(m[3] === "none" || STATUS_TAGS.includes(m[3]))) return null;
  return { source: m[1], family: cap(m[2]) as FamilyName, status: m[3] === "none" ? null : cap(m[3]) as Status, seed: Number(m[4]) };
}

// ------------------------------------------------------------------------------ spawn types

const kind = (c: any) => { const k: string = c?.$class ?? ""; return k.substring(k.lastIndexOf("$") + 1); };
const argOf = (ref: any, key: string) => (ref?.arguments?.entries as [string, any][] | undefined)?.find(([k]) => k === key)?.[1];

/** config/spawn_table.dat by name, read for spawn types and the type lists. */
export class SpawnTypes {
  private parents = new Map<string, string[]>();
  private typeCache = new Map<string, string[]>();

  constructor(private readonly lib: Map<string, any>) {
    for (const [name, c] of lib) {
      if (!this.isList(c)) continue;
      for (const e of c.root.entries ?? []) {
        const child = e?.spawnTable?.name;
        if (typeof child !== "string") continue;
        const p = this.parents.get(child);
        if (p) p.push(name); else this.parents.set(child, [name]);
      }
    }
  }

  has(name: string) { return this.lib.has(name); }

  /** A SpawnTableConfig$Prefab: its root is a SpawnTypeListEntry (the only root a Prefab has). */
  private isList(c: any) { return kind(c) === "Prefab" && kind(c.root) === "SpawnTypeListEntry"; }

  /**
   * A table's spawn types: a Typed table's own, a derived one's "Spawn Types" argument (the
   * Depth Scale base's parameter), following derived bases.
   */
  types(name: string, depth = 0): string[] {
    const hit = this.typeCache.get(name);
    if (hit) return hit;
    const c = this.lib.get(name);
    let out: string[] = [];
    if (c && depth < 8) {
      if (Array.isArray(c.spawnTypes)) out = c.spawnTypes.filter((t: unknown) => typeof t === "string");
      else if (c.base) {
        const st = argOf(c.base, "Spawn Types");
        out = Array.isArray(st) ? st.filter((t: unknown) => typeof t === "string") : this.types(c.base.name, depth + 1);
      }
    }
    this.typeCache.set(name, out);
    return out;
  }

  /** The smallest type list naming a table as one of its entries ("Status - Wolver" for a Wolver). */
  listOf(name: string): string | null {
    const ps = this.parents.get(name);
    if (!ps?.length) return null;
    return [...ps].sort((a, b) => (this.lib.get(a).root.entries.length - this.lib.get(b).root.entries.length) || a.localeCompare(b))[0];
  }

  /**
   * The table a type list resolves to for a level's spawn types, by the client's rule
   * (SpawnTableConfig$SpawnTypeListEntry.c): its leaves (nested lists flattened) score the
   * number of their types the level has; the best score of at least one wins, ties at random;
   * with no leaf scoring, the list's default; a list picked in turn is resolved the same way.
   * A table that is not a list is itself.
   */
  resolve(name: string, levelTypes: readonly string[], rand: () => number, depth = 0): string {
    const c = this.lib.get(name);
    if (!c || !this.isList(c) || depth > 8) return name;
    const want = new Set(levelTypes);
    let best = 1;
    let set: string[] = [];
    const visit = (entries: any[], d: number) => {
      for (const e of entries ?? []) {
        const n = e?.spawnTable?.name;
        const cfg = typeof n === "string" ? this.lib.get(n) : null;
        if (!cfg) continue;
        if (kind(cfg) === "Prefab") { if (d < 8) visit(cfg.root?.entries, d + 1); continue; }
        const score = this.types(n).filter(t => want.has(t)).length;
        if (score > best) { best = score; set = []; }
        if (score === best && !set.includes(n)) set.push(n);
      }
    };
    visit(c.root.entries, 0);
    const pick = set.length ? set[Math.floor(rand() * set.length)] : c.root.spawnTable?.name;
    return typeof pick === "string" ? this.resolve(pick, levelTypes, rand, depth + 1) : name;
  }
}

// ------------------------------------------------------------------------------ re-casting

export interface LevelTheme { family: FamilyName; status: Status | null }

export interface RecastReport {
  /** Each re-cast table: old name to new, with how many references. */
  changes: Map<string, Map<string, number>>;
  kept: number;
}

/** A deep copy of plain config data (typed arrays kept as they are, outer links dropped). */
function copy<T>(v: T): T {
  if (!v || typeof v !== "object" || ArrayBuffer.isView(v)) return v;
  if (Array.isArray(v)) return v.map(copy) as T;
  const out: any = {};
  for (const k of Object.keys(v)) if (k !== "$outer") out[k] = copy((v as any)[k]);
  return out;
}

/** Recursively visits the config references (objects with a string name) under a value. */
function refsUnder(v: any, fn: (ref: any) => void, seen = new Set<any>()) {
  if (!v || typeof v !== "object" || seen.has(v) || ArrayBuffer.isView(v)) return;
  seen.add(v);
  if (typeof v.name === "string" && (v.$class === undefined || String(v.$class).endsWith("ConfigReference"))) fn(v);
  for (const k of Object.keys(v)) if (k !== "$outer") refsUnder(v[k], fn, seen);
}

/**
 * Re-casts a level's baked spawns from one family and status to another (see the top of the
 * file): every reference to a typed spawn table under its entries' arguments (Class Spawns'
 * spawn tables, mineral nodes' loot tables, themed blocks) is resolved again for the new spawn
 * types, keeping its arguments. Changes the root in place.
 */
export function recastSpawns(root: any, from: LevelTheme, to: LevelTheme, types: SpawnTypes, seed: number): RecastReport {
  const rand = rng(seed ^ 0x2f6b1d35);
  const fromFam = from.family.toLowerCase(), toFam = to.family.toLowerCase();
  const fromTag = statusTag(from.status), toTag = statusTag(to.status);
  const decided = new Map<string, string>();
  const report: RecastReport = { changes: new Map(), kept: 0 };
  const recast = (name: string): string | null => {
    const t = types.types(name);
    if (!t.length) return null;
    const status = t.find(x => STATUS_TAGS.includes(x)) ?? "vanilla";
    const fam = t.find(x => FAMILY_KEYS.includes(x));
    const role = t.find(x => ROLES.includes(x));
    // a status spawn takes the new status; a vanilla one stays vanilla unless the arena was vanilla
    const tag = status === fromTag ? toTag : status === "vanilla" ? (fromTag === "vanilla" ? toTag : "vanilla") : status;
    const levelTypes = [toFam, tag];
    // the arena family's own monsters: the new family's monsters of that role
    if (fam === fromFam && role && toFam !== fromFam) {
      const roleList = `Monster/Class {stc}/Family/${to.family}/${to.family} - ${cap(role)}`;
      if (types.has(roleList)) return types.resolve(roleList, levelTypes, rand);
    }
    const list = types.listOf(name);
    return list ? types.resolve(list, levelTypes, rand) : null;
  };
  for (const e of root.entries ?? []) {
    if (String(e?.$class ?? "").endsWith("GlobalEntry")) continue;
    const holder = e.placeable ? "placeable" : e.area ? "area" : e.path ? "path" : null;
    if (!holder || !e[holder].arguments) continue;
    // (the scene format shares equal objects between entries: each entry gets its own copy)
    e[holder] = { ...e[holder], arguments: copy(e[holder].arguments) };
    const args = e[holder].arguments;
    const group = String(argOf(e[holder], "Spawn Tag") ?? "");
    refsUnder(args, ref => {
      if (!types.has(ref.name) || !types.types(ref.name).length) return;
      const key = `${group}|${ref.name}`;
      const name: string = ref.name;
      const next: string = decided.get(key) ?? recast(name) ?? name;
      decided.set(key, next);
      if (next === name) { report.kept++; return; }
      const m = report.changes.get(name) ?? new Map<string, number>();
      m.set(next, (m.get(next) ?? 0) + 1);
      report.changes.set(name, m);
      ref.name = next;
    });
  }
  return report;
}

// ------------------------------------------------------------------------------ environment

const GLOBAL_ENTRY = "com.threerings.tudey.data.TudeySceneModel$GlobalEntry";
const STATUS_DIRS = ["Default", "Fire", "Freeze", "Poison", "Shock"];
/** The globals a status adds, from the archived levels of each status (only freeze levels carry one). */
export const STATUS_EXTRAS: Record<Status, string[]> = {
  Fire: [], Freeze: ["Environment/Custom/Universal/Freeze/Vision Snow"], Poison: [], Shock: [],
};

/**
 * Re-themes a level's environment globals from one status to another (see the top of the file):
 * "Environment/Custom/<Set>/<Status>/<Global>" to the new status's global of that name, else
 * the set's "Default" one; the old status's extra globals go and the new one's come. Returns
 * the globals it could not re-theme. Changes the root in place.
 */
export function rethemeGlobals(root: any, from: Status | null, to: Status | null, has: (name: string) => boolean): string[] {
  const missing: string[] = [];
  if (from === to) return missing;
  const src = from ?? "Default", dst = to ?? "Default";
  const extrasFrom = new Set(from ? STATUS_EXTRAS[from] : []);
  const entries: any[] = root.entries ?? [];
  root.entries = entries.filter(e => !(String(e?.$class).endsWith("GlobalEntry") && extrasFrom.has(e.sceneGlobal?.name)));
  for (const e of root.entries as any[]) {
    if (!String(e?.$class).endsWith("GlobalEntry") || typeof e.sceneGlobal?.name !== "string") continue;
    const m = /^(Environment\/Custom\/([^/]+)\/)([^/]+)\/(.+)$/.exec(e.sceneGlobal.name);
    if (!m || m[2] === "Universal" || !STATUS_DIRS.includes(m[3]) || m[3] !== src) continue;
    const own = `${m[1]}${dst}/${m[4]}`, fallback = `${m[1]}Default/${m[4]}`;
    if (has(own)) e.sceneGlobal.name = own;
    else if (has(fallback)) e.sceneGlobal.name = fallback;
    else missing.push(e.sceneGlobal.name);
  }
  let id = Math.max(0, ...(root.entries as any[]).map(e => Number(e?.id) || 0));
  for (const name of to ? STATUS_EXTRAS[to] : []) {
    if ((root.entries as any[]).some(e => e.sceneGlobal?.name === name) || !has(name)) continue;
    root.entries.push({ $class: GLOBAL_ENTRY, id: ++id, sceneGlobal: { $class: "com.threerings.config.ConfigReference", name } });
  }
  return missing;
}

/**
 * An arena derived from an archived one: the source's root with its spawns re-cast and its
 * environment re-themed for the new family and status, named as the arena it stands for.
 */
export function deriveArena(root: any, to: LevelTheme, spawnTypes: SpawnTypes, hasGlobal: (name: string) => boolean, seed: number):
  { root: any; report: RecastReport; missingGlobals: string[] } {
  const from = arenaOf(String(root.name ?? "").replace(/^%dungeon:m\./, ""));
  if (!from) throw new Error(`not a Battle Arena: ${root.name}`);
  const report = recastSpawns(root, from, to, spawnTypes, seed);
  const missingGlobals = rethemeGlobals(root, from.status, to.status, hasGlobal);
  root.name = `%dungeon:m.${arenaArea(to.status)}_${to.family.toLowerCase()}`;
  return { root, report, missingGlobals };
}
