// The player's level archive, sorted for the Clockworks: which archived scenes are the real
// levels of a stratum's style and theme, the boss strata's stages, the terminals and the
// subtowns. Scene names are the display forms of their message keys (src/scene.ts): "ct beast"
// is the Clockwork Tunnels' Wild Path, "wolver den freeze" Frosty Fury, "bf slime" a Blast
// Furnace Slimeway (docs/research/levels.md). Levels the servers generated from prefabs (the
// tunnels, dens, keeps...) were captured one floor at a time; each capture is a real level of
// its own, so all of them are kept. Fixed levels can be archived in several revisions, of
// which the newest (the highest scene id below the instance range) is used.

import { BOSSES, ELEMENTS, FAMILIES, type BossKey, type Family } from "./clockworks";
import { arenaName, deriveId, pickArenaSource } from "./derive";

export type Element = typeof ELEMENTS[number];

/** What a Clockworks level is: its style (clockworks.ts STYLES key), family and status. */
export interface LevelClass { style: string; family: Family | null; element: Element | null }

export interface ArchivedLevel extends LevelClass { id: string; name: string }

const FAM = "(beast|construct|fiend|gremlin|slime|undead)";
const cap = (s: string) => (s[0].toUpperCase() + s.slice(1)) as any;
/** Tunnel and arena area prefixes and their status ("ct" none). */
const TUNNEL: Record<string, Element | null> = { ct: null, bf: "Fire", cc: "Freeze", ww: "Poison", pc: "Shock" };
const ARENA: Record<string, Element | null> = { iea: null, fla: "Fire", ima: "Freeze", vfa: "Poison", tfa: "Shock" };
const COMPOUND: Record<string, Element | null> = { rc: null, cc: "Fire", fc: "Freeze", bc: "Poison", sc: "Shock" };
const THEMED: Record<string, string> = {
  "wolver den": "den", "candlestick keep": "keep", "deconstruction zone": "deconstruction", "devilish drudgery": "drudgery",
  "lichenous lair": "lair", "graveyard": "graveyard",
};
const STATUS: Record<string, Element | null> = { vanilla: null, fire: "Fire", freeze: "Freeze", poison: "Poison", shock: "Shock" };
/** Fixed level sets (their status is part of the level). */
const FIXED: [RegExp, string][] = [
  [/^jigsaw valley (emerald axis|perimeter promenade|the jade tangle)( 2)?$/, "valley"],
  [/^aurora isles (stone grove|the jelly farm|the low gardens)( 2)?$/, "aurora"],
  [/^starlight cradle (meteor mile|shrine of slumber)( [2-4])?$/, "cradle"],
  [/^concrete jungle (blight boulevard|totem trouble)( 2)?$|^concrete jungle green street$/, "jungle"],
  [/^dark city devilish drudgery( [2-6])?$/, "darkcity"],
  [/^lost castle (cravat hall|spiral court)( [23])?$|^lost castle (ascending and descending|unstable plaza|the rambling arcade)$|^scarlet fortress grim gallery$/, "fortress"],
];

/** The style, family and status of an archived Clockworks level, or null for any other scene. */
export function classifyLevel(sceneName: string): LevelClass | null {
  const n = sceneName.toLowerCase().replace(/_/g, " ").trim();
  let m = new RegExp(`^(ct|bf|cc|ww|pc) ${FAM}$`).exec(n);
  if (m) return { style: "tunnels", family: cap(m[2]), element: TUNNEL[m[1]] };
  m = new RegExp(`^(iea|fla|ima|vfa|tfa) ${FAM}$`).exec(n);
  if (m) return { style: "arena", family: cap(m[2]), element: ARENA[m[1]] };
  m = /^(rc|cc|fc|bc|sc) (undead|slime|beast) minis$/.exec(n);
  if (m) return { style: "compound", family: "Gremlin", element: COMPOUND[m[1]] };
  m = /^(wolver den|candlestick keep|deconstruction zone|devilish drudgery|lichenous lair|graveyard) (vanilla|fire|freeze|poison|shock)$/.exec(n);
  if (m) return { style: THEMED[m[1]], family: null, element: STATUS[m[2]] };
  for (const [re, style] of FIXED) if (re.test(n)) return { style, family: null, element: null };
  return null;
}

/**
 * The style and status of a floor the servers generated from prefabs, mission floors included
 * ("ww fiend silent legion" is a Wasteworks floor of a mission, "ck freeze owlite tome" a
 * Candlestick Keep's, "dd" a Devilish Drudgery's): the floors whose prefab rooms the generator
 * reuses (src/gen/prefabs.ts). Null for fixed levels and for layouts it does not rebuild.
 */
export function classifyCapture(sceneName: string): LevelClass | null {
  const n = sceneName.toLowerCase().replace(/_/g, " ").trim();
  let m = new RegExp(`^(ct|bf|cc|ww|pc) ${FAM}\\b`).exec(n);
  if (m && !/ minis\b/.test(n)) return { style: "tunnels", family: cap(m[2]), element: TUNNEL[m[1]] };
  // the status follows the area ("wolver den fire terminal meltdown"), or the mission's set
  // piece first ("dd knight camp fire whipping mishandling", "dd office party vanilla"); a
  // floor without one is vanilla ("lichenous lair alien ooze", "graveyard alone in dark": their
  // globals are their sets' Default ones)
  m = /^(wolver den|candlestick keep|ck|devilish drudgery|dd|lichenous lair|graveyard)\b(.*)$/.exec(n);
  if (m && !/^ (?:\d+)?$/.test(m[2] || " ")) {
    const style = m[1] === "ck" ? "keep" : m[1] === "dd" ? "drudgery" : THEMED[m[1]];
    const s = /\b(vanilla|fire|freeze|poison|shock)\b/.exec(m[2]);
    return { style, family: null, element: s ? STATUS[s[1]] : null };
  }
  return null;
}

/** A dungeon bundle key's scene name ("m.royal_jelly_court" is "royal jelly court"). */
export const keyScene = (key: string) => key.replace(/^m\./, "").replace(/_/g, " ");

/** Scene ids at and above this are instances the servers made (generated floors), not revisions. */
export const INSTANCE_IDS = 1073741824;

export class LevelArchive {
  /** Every archived Clockworks level (one per fixed level, every captured instance). */
  readonly levels: ArchivedLevel[] = [];
  private byName = new Map<string, { id: string; name: string }>();

  constructor(scenes: readonly { id: string; name: string }[]) {
    // fixed scenes: the newest revision of each name
    for (const s of scenes) {
      const n = s.name.toLowerCase();
      const id = Number(s.id);
      if (id >= INSTANCE_IDS) continue;
      const had = this.byName.get(n);
      if (!had || Number(had.id) < id) this.byName.set(n, s);
    }
    for (const s of scenes) {
      if (Number(s.id) < INSTANCE_IDS) continue;
      const n = s.name.toLowerCase(), list = this.instances.get(n);
      if (list) list.push(s); else this.instances.set(n, [s]);
    }
    const seen = new Set<string>();
    for (const s of scenes) {
      const cap = Number(s.id) >= INSTANCE_IDS ? classifyCapture(s.name) : null;
      if (cap) this.captures.push({ ...cap, id: s.id, name: s.name });
    }
    for (const s of scenes) {
      const c = classifyLevel(s.name);
      if (!c) continue;
      const id = Number(s.id);
      if (id < INSTANCE_IDS) {
        const newest = this.byName.get(s.name.toLowerCase())!;
        if (seen.has(newest.id)) continue;
        seen.add(newest.id);
        this.levels.push({ ...c, id: newest.id, name: newest.name });
      } else this.levels.push({ ...c, id: s.id, name: s.name });
    }
  }

  /** The newest revision of a fixed scene by its display name. */
  scene(name: string): { id: string; name: string } | null { return this.byName.get(name.toLowerCase()) ?? null; }

  /**
   * The real levels for a stratum: its style, and its theme (a monster family, or a status
   * for which any family's level of that status counts). Fixed level sets carry their own
   * monsters and status and serve any theme.
   */
  forStratum(style: string, theme: string): ArchivedLevel[] {
    const fam = (FAMILIES as readonly string[]).includes(theme) ? theme : null;
    const el = (ELEMENTS as readonly string[]).includes(theme) ? theme : null;
    return this.levels.filter(l => {
      if (l.style !== style) return false;
      if (FIXED.some(([, s]) => s === style)) return true;
      if (el) return l.element === el;
      // a family stratum: that family's plain level (sets without families: their plain one)
      return l.element === null && (l.family === null || l.family === fam);
    });
  }

  /** A boss stratum's stage scenes in order (null where the archive lacks one). */
  bossStages(key: BossKey): ({ id: string; name: string } | null)[] { return BOSSES[key].stages.map(k => this.scene(keyScene(k))); }

  /** The newest revision of the game's level with a dungeon bundle key ("m.terminal_1"). */
  level(key: string): { id: string; name: string } | null { return this.scene(keyScene(key)); }

  /**
   * Every archived copy of the game's level with a dungeon bundle key: its newest fixed revision,
   * and each floor of it the servers generated and the client cached ("m.ct_beast": every
   * captured Wild Path).
   */
  copies(key: string): { id: string; name: string }[] {
    const n = keyScene(key).toLowerCase(), fixed = this.byName.get(n);
    return [...(fixed ? [fixed] : []), ...(this.instances.get(n) ?? [])];
  }
  private instances = new Map<string, { id: string; name: string }[]>();

  /**
   * A Battle Arena the archive lacks, derived from one it holds (src/game/derive.ts): its scene
   * id ("derive:..."), the arena's scene name ("fla fiend") and the source's; null when the
   * archive holds that arena itself or no arena at all.
   */
  deriveArena(family: Family, element: Element | null, seed: number): { id: string; name: string; source: { id: string; name: string } } | null {
    const src = pickArenaSource(this.levels.filter(l => l.style === "arena"), family, element);
    return src ? { id: deriveId(src.id, family, element, seed), name: arenaName(family, element), source: { id: src.id, name: src.name } } : null;
  }

  /** Styles with at least one archived level. */
  styles(): Set<string> { return new Set(this.levels.map(l => l.style)); }

  /** Every captured generated floor whose prefabs the generator can reuse. */
  readonly captures: ArchivedLevel[] = [];

  /**
   * The captured floors of a style whose rooms a new floor of that style and status is built
   * from: those of the status first, then (`any`) the style's others.
   */
  prefabSources(style: string, element: Element | null, any = false): ArchivedLevel[] {
    const all = this.captures.filter(c => c.style === style);
    return any ? all : all.filter(c => c.element === element);
  }
}
