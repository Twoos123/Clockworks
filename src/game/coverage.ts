// What the prefab generator needs to build a level type faithfully, and which (type x status)
// pairs the player's captures cover. docs/research/levels.md "Coverage".
//
// The servers build the Clockwork Tunnels, Candlestick Keeps, Wolver Dens, Lichenous Lairs,
// Devilish Drudgery and Graveyards from prefab rooms on every run, so a named level such as
// "Wasteworks: Wild Path" is not a level of its own to collect: it is the tunnels' rooms in the
// poison theme with Beast monsters. What a captured floor gives the generator (src/gen/prefabs.ts,
// src/gen/assemble.ts) is read off the player's 60-odd captures:
//
// - Rooms. A style's rooms are pooled across monster families (archive.ts prefabSources). Their
//   tiles depend on the status only for the tunnels ("Clockworks", "Clockworks Fire", ...); the
//   other styles use one tile set whatever the status (Castle, Sky Islands Day, Sky Islands Night,
//   City, Graveyard), so their rooms serve every status.
// - Environment. Lighting, fog, sky and music are scene globals. Every style but the Keep names
//   them per status in config/scene_global.dat ("Environment/Custom/Wolver's Den/Poison/Light
//   Set"), with "Default" for none; the vanilla tunnels have two family variants as well
//   ("Clockwork Tunnels/Spooky", captured on the Haunted Passage, and "Clockwork Tunnels/Fiendish",
//   which no capture shows: by its name, the Infernal Passage's). The Keep's globals are generic
//   ones with the colours as arguments, so a Keep status's environment exists only in a capture.
//   Some mission floors carry the mission's environment instead ("Missions/Prestige/Heart of
//   Ice", "Compound Wilds" on the floors a mission lays out as a compound): those give rooms but
//   not the style's environment.
// - Monsters. The spawn tables the servers bake into a floor are typed by family, status and role
//   (config/spawn_table.dat); src/game/derive.ts recastSpawns re-resolves them for another family
//   and status by the client's own rule, so the family and status of a floor's monsters do not
//   depend on the floors its rooms came from.
//
// So a (type x status) pair is covered when the generator has rooms with the right tiles and the
// right environment: captured when a capture of that pair has its environment, derived when
// the environment is rebuilt from the client's library on rooms of other statuses, missing when
// neither can be had.

import { classifyCapture, classifyLevel, type Element } from "./archive";
import { type Family } from "./clockworks";
import { recastSpawns, type SpawnTypes } from "./derive";

/** A level type the generator assembles from prefab rooms. */
export interface PrefabType {
  style: string;
  name: string;
  /** The scene-global set its environment is named in (null: generic globals, the Keep's). */
  env: string | null;
  /** Its monster family when the type has one (null: the tunnels, any family). */
  family: Family | null;
  /** Whether its tiles depend on the status (so only the status's own rooms will do). */
  statusTiles: boolean;
}

export const PREFAB_TYPES: PrefabType[] = [
  { style: "tunnels", name: "Clockwork Tunnels", env: "Clockwork Tunnels", family: null, statusTiles: true },
  { style: "keep", name: "Candlestick Keep", env: null, family: "Undead", statusTiles: false },
  { style: "den", name: "Wolver Den", env: "Wolver's Den", family: "Beast", statusTiles: false },
  { style: "lair", name: "Lichenous Lair", env: "Lichenous Lair", family: "Slime", statusTiles: false },
  { style: "drudgery", name: "Devilish Drudgery", env: "Devilish Drudgery", family: "Fiend", statusTiles: false },
  { style: "graveyard", name: "Graveyard", env: "Graveyard", family: "Undead", statusTiles: false },
];
export const prefabType = (style: string) => PREFAB_TYPES.find(t => t.style === style) ?? null;

export const STATUSES: (Element | null)[] = [null, "Fire", "Freeze", "Poison", "Shock"];
export const statusLabel = (s: Element | null) => s ?? "no status";

// ------------------------------------------------------------------------------ rooms

/** Tile groups (the first part of a tile's config name) every style shares. */
const NEUTRAL_TILES = /^(Traps and Hazards|Null.*)$/;
const STYLE_TILES: Record<string, string> = {
  keep: "Castle", den: "Sky Islands, Day", lair: "Sky Islands, Night", drudgery: "City, Base", graveyard: "Graveyard",
};

/** The tile group a style's rooms are built of in a status ("Clockworks Fire"). */
export function styleTiles(style: string, status: Element | null): string | null {
  if (style === "tunnels") return status ? `Clockworks ${status}` : "Clockworks";
  return STYLE_TILES[style] ?? null;
}

/**
 * Whether a room's tiles (their config names) belong to a style and status: every tile of the
 * style's group or a shared one. A mission floor laid out as a compound ("ct construct spark
 * roar": Compound Wilds rooms in frozen tiles) gives no tunnel rooms; a casino danger room of
 * another status's tiles is not one of the floor's.
 */
export function roomFits(style: string, status: Element | null, tileNames: Iterable<string>): boolean {
  const want = styleTiles(style, status);
  if (!want) return true;
  for (const n of tileNames) {
    const group = n.split("/")[0];
    if (group !== want && !NEUTRAL_TILES.test(group)) return false;
  }
  return true;
}

/**
 * Whether a captured floor has rooms of a style and status at all: some of its tiles are the
 * style's (a whole floor may hold a casino danger room in another status's tiles, left out
 * room by room; a mission floor laid out as a compound has none of them).
 */
export function floorHasRooms(style: string, status: Element | null, tileNames: Iterable<string>): boolean {
  const want = styleTiles(style, status);
  if (!want) return true;
  for (const n of tileNames) if (n.split("/")[0] === want) return true;
  return false;
}

// ------------------------------------------------------------------------------ environment

/**
 * The scene-global directory a level's environment is in: its status, else "Default"; the
 * vanilla tunnels' Undead and Fiend levels have their own ("Spooky", "Fiendish").
 */
export function envDir(style: string, status: Element | null, family: Family | null): string {
  if (status) return status;
  if (style === "tunnels" && family === "Undead") return "Spooky";
  if (style === "tunnels" && family === "Fiend") return "Fiendish";
  return "Default";
}

/** Directories an environment can be in, statuses and the tunnels' family variants. */
const ENV_DIRS = ["Default", "Fire", "Freeze", "Poison", "Shock", "Spooky", "Fiendish"];

/**
 * Whether a floor's globals (their config names) are its style's own environment for a status
 * (and family variant): the style's Light Set of that directory, and nothing of a mission's.
 * The Keep's are generic globals with no Light Set of a named set.
 */
export function envFits(style: string, status: Element | null, family: Family | null, globals: readonly string[]): boolean {
  const t = prefabType(style);
  if (!t) return false;
  if (globals.some(g => /\/Missions\//.test(g))) return false;
  const lights = globals.filter(g => /^Environment\/Custom\/.+\/Light Set$/.test(g));
  if (!t.env) return lights.length === 0 && globals.includes("Environment/Fog");
  return lights.length > 0 && lights.every(g => g === `Environment/Custom/${t.env}/${envDir(style, status, family)}/Light Set`);
}

/** The directory a fitting environment of a style is in (null when it is not the style's own). */
export function envDirOf(style: string, globals: readonly string[]): string | null {
  const t = prefabType(style);
  if (!t?.env) return null;
  const re = new RegExp(`^Environment/Custom/${t.env.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^/]+)/Light Set$`);
  for (const g of globals) { const m = re.exec(g); if (m && ENV_DIRS.includes(m[1])) return m[1]; }
  return null;
}

/**
 * A style's environment for another status (or family variant), from one of its own in the
 * client's library: each "Environment/Custom/<set>/<dir>/<global>" of the style's set becomes
 * the target directory's global of that name, else the set's "Default" one; the source status's
 * own extras ("Universal/Freeze/Vision Snow") go (null in their place). The target status's own
 * extras are not known for a pair no capture shows, so none are added. Null for a style whose
 * environment is not named per status (the Keep) or globals that are not the style's.
 */
export function rethemeEnv(style: string, globals: readonly string[], to: { status: Element | null; family: Family | null },
  has: (name: string) => boolean): (string | null)[] | null {
  const t = prefabType(style);
  const from = envDirOf(style, globals);
  if (!t?.env || !from) return null;
  const dst = envDir(style, to.status, to.family);
  const prefix = `Environment/Custom/${t.env}/`;
  return globals.map(g => {
    const u = /^Environment\/Custom\/Universal\/([^/]+)\//.exec(g);
    if (u && ENV_DIRS.includes(u[1]) && u[1] !== to.status) return null;
    if (!g.startsWith(prefix)) return g;
    const rest = g.slice(prefix.length), slash = rest.indexOf("/");
    const dir = slash > 0 ? rest.slice(0, slash) : "";
    if (!ENV_DIRS.includes(dir)) return g;
    const name = rest.slice(slash + 1), own = `${prefix}${dst}/${name}`, def = `${prefix}Default/${name}`;
    return has(own) ? own : has(def) ? def : null;
  });
}

/** A capture offered as a floor's environment: its status, family and global entries. */
export interface EnvCandidate { id: string; name: string; element: Element | null; family: Family | null; plain?: boolean; globals: any[] }

/**
 * The order captures are tried in for a floor's environment: the status's own first, plain
 * levels before mission floors, newest first; then the style's others (the Default ones first),
 * to derive it from.
 */
export function envOrder<T extends { id: string; name: string; element: Element | null }>(status: Element | null, caps: readonly T[]): T[] {
  const rank = (c: T) => (c.element === status ? 0 : c.element === null ? 2 : 4) + (classifyLevel(c.name) ? 0 : 1);
  return [...caps].sort((a, b) => rank(a) - rank(b) || Number(b.id) - Number(a.id));
}

/**
 * A floor's environment globals (the GlobalEntries of the scene): a capture's of its style,
 * status and family variant as they are; else one of the style's own for another status,
 * re-themed from the client's library (`derived`); null when neither can be had (a Keep status
 * no capture shows).
 */
export function environmentFor(style: string, status: Element | null, family: Family | null, cands: readonly EnvCandidate[],
  has: (name: string) => boolean): { globals: any[]; source: string; derived: boolean } | null {
  const names = (c: EnvCandidate) => c.globals.map(g => String(g?.sceneGlobal?.name ?? ""));
  for (const c of cands) if (c.element === status && envFits(style, status, family, names(c))) return { globals: c.globals, source: c.name, derived: false };
  for (const c of cands) {
    const n = names(c);
    if (!envFits(style, c.element, c.family, n)) continue;
    const to = rethemeEnv(style, n, { status, family }, has);
    if (!to) continue;
    const globals = c.globals.flatMap((g, i) => (to[i] === null ? [] : [to[i] === n[i] ? g : { ...g, sceneGlobal: { ...g.sceneGlobal, name: to[i] } }]));
    return { globals, source: c.name, derived: true };
  }
  return null;
}

// ------------------------------------------------------------------------------ monsters

/**
 * A floor's placed rooms with their spawns re-cast (src/game/derive.ts recastSpawns: the
 * client's spawn-type rule) from the family and status of the capture each came from to the
 * floor's: the source family's own monsters become the floor family's of the same role, every
 * status monster takes the floor's status. `family` null keeps each room's family (a status
 * stratum); a type with a family of its own (the Den's Beasts) is that family's. Rooms already
 * of the floor's family and status are left as they are.
 */
export function recastRooms<P extends { piece: { source: string; entries: any[] } }>(placed: P[],
  captures: ReadonlyMap<string, { family: Family | null; element: Element | null }>, style: string, family: Family | null,
  status: Element | null, types: SpawnTypes, seed: number): P[] {
  const natural = prefabType(style)?.family ?? null;
  return placed.map((p, i) => {
    const c = captures.get(p.piece.source);
    const from = c?.family ?? natural ?? family, to = family ?? natural ?? from, fromStatus = c?.element ?? null;
    if (!from || !to || (from === to && fromStatus === status)) return p;
    const r = { entries: p.piece.entries.map(e => ({ ...e })) };
    recastSpawns(r, { family: from, status: fromStatus }, { family: to, status }, types, (seed + i * 7919) >>> 0);
    return { ...p, piece: { ...p.piece, entries: r.entries } };
  });
}

// ------------------------------------------------------------------------------ captures

/** A capture's facts read from its scene (tools/coverage.ts): its tile groups and globals. */
export interface CaptureFacts { tiles: string[]; globals: string[] }

/** A captured prefab floor as the coverage sees it. */
export interface CoverageSource { name: string; style: string; element: Element | null; family: Family | null;
  /** A plain level (its own level's key), not a mission floor. */
  plain: boolean;
  /** Whether its rooms are the style's (from its tiles; true when unknown). */
  rooms: boolean;
  /**
   * Whether it carries the style's environment for its status: true or false when read from the
   * scene; by name alone, true for a plain level and null (assumed, unverified) for a mission
   * floor, which may carry the mission's own instead.
   */
  env: boolean | null }

/** The captured prefab floors among scene names, with their facts where known. */
export function coverageSources(names: Iterable<string>, facts?: ReadonlyMap<string, CaptureFacts>): CoverageSource[] {
  const out: CoverageSource[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const c = classifyCapture(name);
    const key = name.toLowerCase();
    if (!c || !prefabType(c.style) || seen.has(key)) continue;
    seen.add(key);
    const f = facts?.get(key);
    const plain = !!classifyLevel(name);
    out.push({ name, style: c.style, element: c.element, family: c.family, plain,
      rooms: f ? floorHasRooms(c.style, c.element, f.tiles) : true,
      env: f ? envFits(c.style, c.element, c.family, f.globals) : plain ? true : null });
  }
  return out;
}

export type CoverageState = "captured" | "derived" | "missing";

export interface CoverageRow {
  type: PrefabType;
  status: Element | null;
  state: CoverageState;
  /** Captures of this type and status (rooms or environment). */
  captures: CoverageSource[];
  /** Captures whose rooms a floor of it is built from (for the tunnels, its status's only). */
  rooms: CoverageSource[];
  /** The capture whose environment it uses, when one has it. */
  env: CoverageSource | null;
  /** Why it is derived or missing. */
  note: string;
}

/** Whether the type has rooms for a status, and which captures give them. */
function roomSources(t: PrefabType, status: Element | null, src: CoverageSource[]) {
  return src.filter(s => s.style === t.style && s.rooms && (!t.statusTiles || s.element === status));
}

/**
 * A capture whose environment a floor of the type, status and (tunnels) family uses: one of
 * them that carries the style's own environment (a plain level, or a mission floor whose
 * globals were read and found the style's).
 */
export function envSource(t: PrefabType, status: Element | null, family: Family | null, src: CoverageSource[]): CoverageSource | null {
  const dir = envDir(t.style, status, family);
  const fits = src.filter(s => s.style === t.style && s.element === status && s.env !== false && envDir(t.style, s.element, s.family) === dir);
  // a capture whose environment was read first; one known only by name (a mission floor) is assumed
  return fits.find(s => s.env === true) ?? fits[0] ?? null;
}

/** One (type x status) pair's coverage. */
export function coverageRow(t: PrefabType, status: Element | null, src: CoverageSource[]): CoverageRow {
  const captures = src.filter(s => s.style === t.style && s.element === status);
  const rooms = roomSources(t, status, src);
  // the plain environment of the pair (the tunnels' family variants are counted on their levels)
  const env = envSource(t, status, null, src);
  const base = { type: t, status, captures, rooms, env };
  if (!rooms.length)
    return { ...base, state: "missing", note: t.statusTiles ? `no capture of its ${statusLabel(status)} rooms (its tiles are the status's own)` : "no captured rooms of the type" };
  if (env) return { ...base, state: "captured", note: env.env === null ? `environment assumed from the mission floor "${env.name}" (only its name is known here; \`npm run levels\` reads it)` : "" };
  const ownRooms = rooms.some(r => r.element === status);
  const roomsNote = ownRooms ? "" : ` on rooms of other statuses (${t.name} rooms are the same in every status)`;
  if (!t.env) return { ...base, state: "missing", note: `its environment is in no capture: the ${t.name}'s globals carry their colours, not a status's name${roomsNote ? "; rooms of other statuses would do" : ""}` };
  return { ...base, state: "derived", note: `environment from the client's "${t.env}/${envDir(t.style, status, null)}" globals${roomsNote}` };
}

/** Every (type x status) pair's coverage. */
export function prefabCoverage(src: CoverageSource[]): CoverageRow[] {
  return PREFAB_TYPES.flatMap(t => STATUSES.map(s => coverageRow(t, s, src)));
}

/**
 * How a named level of a covered pair stands: "captured" when its pair's environment is in a
 * capture that fits it (for the vanilla tunnels' Undead and Fiend levels, a capture of that
 * family), else "derived" (its environment from the client's library), "missing" with its pair.
 */
export function levelCoverage(row: CoverageRow, family: Family | null, src: CoverageSource[]): CoverageState {
  if (row.state === "missing") return "missing";
  const dir = envDir(row.type.style, row.status, family);
  if (dir === envDir(row.type.style, row.status, null)) return row.state;
  return envSource(row.type, row.status, family, src) ? "captured" : "derived";
}
