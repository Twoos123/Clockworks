// Missions (config/mission.dat, MissionConfig): the game's rank missions, prestige missions and
// expansion operations, read from the install and played single-player.
//
// What the data gives: each mission's id, class (Rank / Prestige / Hidden / Expansion), rank and
// subrank, restrictions (rank ranges, day schedules, events, prerequisite missions), what it asks
// for (a conversation, an exchange of items, a gate), its reward spawn tables
// (config/spawn_table.dat), its prestige (config/mission_property.dat) and its card image.
//
// What it does not give: the missions' levels (server-streamed), their dialogue and briefing
// text (message bundles in the code jars), the rank titles and the crown rewards. Dungeon
// missions are played as themed generated floors chosen from the card image (its monster and
// environment), conversations show a summary written here, and crowns are tuning numbers.

import { applyArguments } from "../config/params";
import { rng } from "../gen/layout";
import { BOSSES, FAMILIES, STYLES, type BossKey, type Family, type Floor, type Gate, type LevelStyle, type Stratum, type StratumTheme } from "./clockworks";

export type MissionClass = "Rank" | "Prestige" | "Hidden" | "Expansion";
export type MissionKind = "dungeon" | "conversation" | "exchange" | "gate" | "gate-conversation";
export type PrestigeType = "LOW" | "AVG" | "HIGH" | "MAX";

/** One item an exchange asks for: `count` of a material, or an owned item at `level` or above. */
export interface Ingredient { item: string; count: number; level?: number }

/** Where a dungeon mission is played: its monsters, the look of its floors and its boss. */
export interface MissionSetting { family: Family; tileset: string; boss: BossKey | null; depth: number; floors: number }

export interface Schedule { refTime: number; intervalDays: number }

export interface Mission {
  id: string;
  /** The config's path, e.g. "Rank/01/1.2/Crossing the Chasm". */
  path: string;
  /** Its last path segment, e.g. "Crossing the Chasm". */
  title: string;
  cls: MissionClass;
  kind: MissionKind;
  /** Rank and subrank (prestige missions: the low end of their rank range, subrank 0). */
  rank: number;
  subrank: number;
  /** Prestige missions: the rank range's exclusive top. */
  maxRank: number;
  /** Mission ids that must be complete first (MissionRestriction / needMission). */
  needs: string[];
  /** A day schedule (prestige missions): active one day in every `intervalDays`. */
  schedule: Schedule | null;
  /** An event the mission belongs to (events are run by the game's servers). */
  event: string | null;
  cardImage: string | null;
  /** Reward spawn table names. */
  rewards: string[];
  prestigeType: PrestigeType;
  prestige: number;
  /** Conversations: the NPC model reference and the conversation config name. */
  npcModel: string | null;
  npcVariant: string | null;
  conversation: string | null;
  /** Exchanges: fixed ingredients, or recipe choices (recipe name and count) one ingredient is drawn from. */
  ingredients: Ingredient[];
  choose: { recipe: string; count: number }[][];
  /** Prestige gate missions: the stratum theme to clear. */
  gateTheme: StratumTheme | null;
  setting: MissionSetting | null;
  production: boolean;
  repeatable: boolean;
  onceOnly: boolean;
  daily: boolean;
  /** A short English line about the mission (the game's own text is unavailable). */
  summary: string;
}

/** The knight's mission progress (kept in the save). */
export interface MissionProgress {
  rank: number;
  subrank: number;
  /** Rank and expansion missions done (once each). */
  completed: string[];
  prestige: number;
  /** Prestige missions done, by id: the schedule cycle they were done in. */
  cycles: Record<string, number>;
}

export const freshProgress = (): MissionProgress => ({ rank: 1, subrank: 1, completed: [], prestige: 0, cycles: {} });

/**
 * Rank titles. The game's titles live in its message bundles, which this project does not
 * read; these are the titles as players know them (Knight at rank 4, Defender at 6, Champion
 * at 10), the ones between from memory.
 */
export const RANK_NAMES = ["Wanderer", "Recruit", "Squire", "Knight", "Guardian", "Defender", "Striker", "Vanguard", "Warden", "Champion"];
export const rankName = (rank: number) => RANK_NAMES[Math.max(1, Math.min(10, rank)) - 1];
export const rankLabel = (p: MissionProgress) => `RANK ${p.rank}-${p.subrank}`;

/** Clockworks tiers and the rank each needs (tier 2 from depth 8, tier 3 from depth 18). */
export const TIER_RANK: Record<number, number> = { 1: 1, 2: 4, 3: 6 };
/** Why the knight cannot enter a tier, or null when it can. */
export function tierLock(tier: number, p: MissionProgress): string | null {
  const need = TIER_RANK[tier] ?? 1;
  if (p.rank >= need) return null;
  return `Tier ${tier} of the Clockworks needs rank ${need} (${rankName(need)}). You are rank ${p.rank}-${p.subrank} (${rankName(p.rank)}): complete missions to rank up.`;
}

// ------------------------------------------------------------------------------ reading

const short = (o: any) => { const c = String(o?.$class ?? ""); return c.substring(c.lastIndexOf("$") + 1); };
const list = (x: any): any[] => (Array.isArray(x) ? x : x?.items ?? x?.array ?? []);
const enumName = (v: any): string | null => (v && typeof v === "object" && "$enum" in v ? String(v.name) : typeof v === "string" ? v.split(".").pop()! : null);
const argsOf = (ref: any): Record<string, unknown> => Object.fromEntries((ref?.arguments?.entries ?? []) as [string, unknown][]);

/** "6d" -> 6, "1w" -> 7, "48h" -> 2 (days). */
export function intervalDays(s: unknown): number {
  const m = /^(\d+)\s*([dwh]?)$/.exec(String(s ?? "").trim());
  if (!m) return 1;
  const n = Number(m[1]);
  return Math.max(1, m[2] === "w" ? n * 7 : m[2] === "h" ? Math.round(n / 24) : n);
}

const DEV = /^(Examples|Dev)\/|TEST|PREVIEW ONLY|\bTest\b/;

/**
 * Reads the mission library. `props` is config/mission_property.dat by name. Missions not
 * deployed to the game's production servers (NONE, PREVIEW, unset) and dev or test ones are
 * left out, as are Hidden missions (the game's own bookkeeping, never shown).
 */
export function parseMissions(configs: any[], props: Map<string, any>): Mission[] {
  const out: Mission[] = [];
  for (const c of configs) {
    const m = parseMission(c, props);
    if (m && m.production && m.cls !== "Hidden" && !DEV.test(m.path)) out.push(m);
  }
  return out.sort((a, b) => a.rank - b.rank || a.subrank - b.subrank || a.path.localeCompare(b.path));
}

export function parseMission(c: any, props: Map<string, any>): Mission | null {
  const i = c?.implementation;
  if (!i?.id) return null;
  const path = String(c.name ?? i.id);
  const title = path.split("/").pop()!;
  const cls = short(i) as MissionClass;
  const restrictions = list(i.restrictions);
  const range = restrictions.find(r => short(r) === "RankRange");
  const sched = restrictions.find(r => short(r) === "Schedule")?.schedule;
  const ev = restrictions.find(r => short(r) === "EventRestriction");
  const needs = [...restrictions.filter(r => short(r) === "MissionRestriction"), ...(i.needMission ? [i.needMission] : [])]
    .map(r => r.missionId).filter((x): x is string => typeof x === "string");
  const req = i.requirement ?? null;
  const reqKind = req ? short(req) : "";
  const tier = /TIER_(\d)/.exec(enumName(i.tier) ?? "")?.[1];
  let rank = i.rank?.rank ?? range?.rank ?? 1;
  const subrank = i.rank?.subrank ?? 0;
  if (cls === "Expansion") rank = TIER_RANK[Number(tier ?? 1)] ?? 1;
  const p = props.get(i.missionProps?.name ?? "") ?? {};
  const prestigeType = (enumName(i.prestige) ?? "AVG") as PrestigeType;
  const prestige = p[`prestige${prestigeType[0]}${prestigeType.slice(1).toLowerCase()}`] ?? 0;
  const conv = reqKind === "Conversation" ? req.conversation : null;
  const ingredients: Ingredient[] = reqKind === "Exchange" ? list(req.ingredients).map(g => ({
    item: String(g.item?.name ?? ""), count: g.count ?? 1, ...(short(g) === "LevelItem" ? { level: g.level ?? 0 } : {}),
  })).filter(g => g.item) : [];
  const choose = reqKind === "RandomChooseExchange" ? list(req.choose).map(ch => list(ch.recipes).map(r => ({
    recipe: String(r.ref?.name ?? ""), count: Number(argsOf(r.ref).Count ?? 1),
  })).filter(r => r.recipe)) : [];
  const gateMatch = /\/Gate\/(\w+)$/.exec(path);
  const gateTheme = cls === "Prestige" && gateMatch && (FAMILIES as readonly string[]).includes(gateMatch[1]) ? gateMatch[1] as Family : null;
  const kind: MissionKind = gateTheme ? "gate"
    : reqKind === "Conversation" ? "conversation"
    : reqKind === "GateConversation" ? "gate-conversation"
    : reqKind === "Exchange" || reqKind === "RandomChooseExchange" ? "exchange"
    : "dungeon";
  const m: Mission = {
    id: String(i.id), path, title, cls, kind, rank, subrank,
    maxRank: range?.maxRank ?? 11, needs,
    schedule: sched && short(sched) === "FixedDayInterval" && typeof sched.refTime === "number"
      ? { refTime: sched.refTime, intervalDays: intervalDays(sched.interval) } : null,
    event: ev ? String(ev.event?.name ?? ev.event ?? ev.name ?? "event") : null,
    cardImage: typeof i.cardImage === "string" ? i.cardImage : null,
    rewards: list(i.rewards).map(r => r?.rewards?.name).filter((x): x is string => typeof x === "string"),
    prestigeType, prestige: typeof prestige === "number" ? prestige : 0,
    npcModel: conv?.model?.name ?? null,
    npcVariant: (argsOf(conv?.model).Variant as string | undefined) ?? null,
    conversation: conv?.conversation?.name ?? null,
    ingredients, choose, gateTheme, setting: null,
    production: enumName(i.deployment) === "PRODUCTION",
    repeatable: i.repeatable === true, onceOnly: i.onceOnly === true, daily: i.daily === true,
    summary: "",
  };
  if (kind === "dungeon") m.setting = missionSetting(m);
  m.summary = summarize(m);
  return m;
}

// ------------------------------------------------------------------------------ settings

/** Monster tokens in card image names and the family they stand for. */
const MONSTERS: [RegExp, Family][] = [
  [/wolver|chromalisk|snarbolax|beast|owlite|maulos/, "Beast"],
  [/scuttlebot|mechaknight|drones?|tortodrone|shufflebot|collector|gpuppy|imf/, "Construct"],
  [/devilite|fiend|creepcake|currentcake/, "Fiend"],
  [/gremcon|thwacker|mender|grinchlin/, "Gremlin"],
  [/lichen|slime|oiler|toxigel|royaljelly|toxicplant/, "Slime"],
  [/zombie|spookat|blackkat|zomnight|lostsoul|silentlegion|bombie|greaver|oldghost|gitm|broken|swordyard|harvester/, "Undead"],
];
/** Environment tokens and the generator tileset they stand for. */
const ENVIRONMENTS: [RegExp, string][] = [
  [/^decon-shk$/, "clockworks-shock"],
  [/^decon$/, "clockworks-white"],
  [/^(clockworks?|traininghall|arcade|comlink)$/, "clockworks"],
  [/^(clocksky|skyislands|skyislandsday)$/, "valley"],
  [/^(nightsky|gloamwood)$/, "valley-night"],
  [/^castle$/, "castle"],
  [/^cooling$/, "clockworks-freeze"],
  [/^poisonsky$/, "clockworks-poison"],
];
const ELEMENT_SUFFIX: Record<string, string> = { fir: "fire", fre: "freeze", poi: "poison", shk: "shock" };
const BOSS_FAMILY: Record<BossKey, Family> = { jelly: "Slime", snarbolax: "Beast", twins: "Construct", vanaduke: "Undead" };
const BOSS_TOKENS: [RegExp, BossKey][] = [[/royaljelly/, "jelly"], [/snarbolax/, "snarbolax"], [/^imf$/, "twins"], [/vanaduke/, "vanaduke"]];
/** Danger missions' cards show no environment; their settings (our reading of the missions). */
const DANGER: [RegExp, Family, string][] = [
  [/Ghosts in the Machine/, "Undead", "clockworks-shock"],
  [/Heart of Ice/, "Beast", "clockworks-freeze"],
  [/Legion of Almire/, "Undead", "castle"],
  [/Toxic Plant/, "Slime", "clockworks-poison"],
];

/** The Clockworks depth that fits a rank: rank 1 about depth 2, rank 9 about 26, rank 10 at 28. */
export const rankDepth = (rank: number) => Math.max(1, Math.min(28, 2 + 3 * (Math.max(1, rank) - 1)));
/** Floors in a dungeon mission: two at the low ranks, up to four at the top. */
export const rankFloors = (rank: number) => Math.min(4, 2 + Math.floor((Math.max(1, rank) - 1) / 3));

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** A dungeon mission's setting, read from its card image name ("mechaknight2-fir_lava.png"). */
export function missionSetting(m: Pick<Mission, "id" | "cardImage" | "path" | "rank" | "subrank" | "cls">): MissionSetting {
  const base = (m.cardImage ?? "").split("/").pop()!.replace(/\.png$/i, "").toLowerCase();
  const cut = base.indexOf("_");
  const subject = cut >= 0 ? base.substring(0, cut) : base;
  const env = cut >= 0 ? base.substring(cut + 1) : "";
  let family: Family | null = MONSTERS.find(([re]) => re.test(subject))?.[1] ?? null;
  let tileset = ENVIRONMENTS.find(([re]) => re.test(env))?.[1] ?? null;
  const boss = BOSS_TOKENS.find(([re]) => re.test(subject))?.[1] ?? null;
  const element = ELEMENT_SUFFIX[/-(fir|fre|poi|shk)\d*$/.exec(subject)?.[1] ?? ""] ?? null;
  if (env === "lava") tileset = family === "Undead" || family === "Fiend" || boss === "vanaduke" ? "castle-fire" : "clockworks-fire";
  const danger = DANGER.find(([re]) => re.test(m.path));
  if (danger) { family ??= danger[1]; tileset = danger[2]; }
  // an element on a plain Clockworks card picks the element's tileset
  if (element && (tileset === null || tileset === "clockworks")) tileset = `clockworks-${element}`;
  if (boss) { family = BOSS_FAMILY[boss]; tileset ??= BOSSES[boss].tileset; }
  family ??= FAMILIES[hash(m.id) % FAMILIES.length];
  tileset ??= family === "Beast" ? "valley" : family === "Undead" || family === "Fiend" ? "castle" : "clockworks";
  const rank = m.rank + (m.cls === "Rank" ? Math.max(0, m.subrank - 1) * 0.25 : 0);
  return { family, tileset, boss, depth: rankDepth(Math.round(rank)), floors: rankFloors(m.rank) + (boss ? 1 : 0) };
}

/**
 * A dungeon mission's run: a one-stratum gate whose floors sit at the mission's depth, the
 * last one its boss's arena when it has one. Floors are indexed by depth, as gateFloors does,
 * so the gate descent plays them in order and rides up to Haven after the last.
 */
export function missionRun(m: Mission, runs = 0): { gate: Gate; floors: Floor[] } {
  const s = m.setting ?? missionSetting(m);
  const n = Math.max(1, s.floors);
  const first = Math.max(1, Math.min(s.depth, 29 - n));
  const last = first + n - 1;
  const tierOf = (d: number) => (d >= 18 ? 3 : d >= 8 ? 2 : 1);
  const style: LevelStyle = { ...(STYLES.find(x => x.tileset === s.tileset) ?? STYLES[0]), key: "mission", name: m.title, tileset: s.tileset, families: [s.family] };
  delete style.cached;
  const stratum: Stratum = { index: 1, tier: tierOf(first), theme: s.family, style, boss: s.boss, first, last };
  const floors: Floor[] = [];
  for (let d = first; d <= last; d++) {
    const boss = s.boss && d === last;
    floors[d] = { depth: d, tier: tierOf(d), stratum, kind: boss ? "boss" : "level",
      name: boss ? BOSSES[s.boss!].level : m.title, tileset: boss ? BOSSES[s.boss!].tileset : s.tileset };
  }
  return { gate: { id: `mission:${m.id}`, name: m.title, seed: (hash(m.id) + runs * 7919) >>> 0, strata: [stratum] }, floors };
}

// ------------------------------------------------------------------------------ schedules

const DAY = 86400000;
/** Days since the schedule's reference day (its days start at refTime's time of day). */
const dayIndex = (s: Schedule, now: number) => Math.floor((now - s.refTime) / DAY);
const mod = (a: number, n: number) => ((a % n) + n) % n;
/** Days until the schedule is next active (0: today). */
export const daysUntilActive = (s: Schedule, now: number) => mod(-dayIndex(s, now), s.intervalDays);
export const scheduleActive = (s: Schedule, now: number) => daysUntilActive(s, now) === 0;
/** Which run of the schedule `now` falls in (a mission done in one cycle opens again in the next). */
export const scheduleCycle = (s: Schedule, now: number) => Math.floor(dayIndex(s, now) / s.intervalDays);

// ------------------------------------------------------------------------------ progress

export type MissionStatus = "locked" | "available" | "complete" | "upcoming";

const cmpRank = (a: { rank: number; subrank: number }, b: { rank: number; subrank: number }) => a.rank - b.rank || a.subrank - b.subrank;

export function isComplete(m: Mission, p: MissionProgress, now = Date.now()): boolean {
  if (m.cls === "Prestige") {
    const c = p.cycles[m.id];
    return c !== undefined && (!m.schedule || c === scheduleCycle(m.schedule, now) || m.onceOnly);
  }
  return p.completed.includes(m.id);
}

/**
 * A mission's status for the knight: complete; available (its rank reached, its prerequisites
 * done, and for prestige missions the rank in range and the schedule's day today); upcoming
 * (a prestige mission later this week); else locked. Event missions are always locked.
 */
export function missionStatus(m: Mission, p: MissionProgress, now = Date.now()): MissionStatus {
  if (isComplete(m, p, now)) return "complete";
  if (m.event) return "locked";
  if (!m.needs.every(id => p.completed.includes(id) || p.cycles[id] !== undefined)) return "locked";
  if (m.cls === "Prestige") {
    if (p.rank < m.rank || p.rank >= m.maxRank) return "locked";
    if (m.schedule && !scheduleActive(m.schedule, now)) return daysUntilActive(m.schedule, now) < 7 ? "upcoming" : "locked";
    return "available";
  }
  if (m.cls === "Expansion") return p.rank >= m.rank ? "available" : "locked";
  return cmpRank(m, p) <= 0 ? "available" : "locked";
}

/** Prestige missions to show this week: rank in range, no event, active within seven days. */
export function weeklyPrestige(missions: Mission[], p: MissionProgress, now = Date.now()): Mission[] {
  return missions.filter(m => m.cls === "Prestige" && !m.event && p.rank >= m.rank && p.rank < m.maxRank
    && (!m.schedule || daysUntilActive(m.schedule, now) < 7));
}

/** The rank missions' subranks in order ([rank, subrank] pairs that have missions). */
export function subranks(missions: Mission[]): [number, number][] {
  const seen = new Map<string, [number, number]>();
  for (const m of missions) if (m.cls === "Rank") seen.set(`${m.rank}-${m.subrank}`, [m.rank, m.subrank]);
  return [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/**
 * Ranks the knight up: while every rank mission of the current subrank is complete (those
 * whose prerequisites are not in the library can never open and are not counted), the
 * knight moves to the next subrank that has missions. Returns true when the rank changed.
 */
export function advanceRank(missions: Mission[], p: MissionProgress): boolean {
  const known = new Set(missions.map(m => m.id));
  const order = subranks(missions);
  let changed = false;
  for (;;) {
    const here = missions.filter(m => m.cls === "Rank" && m.rank === p.rank && m.subrank === p.subrank && m.needs.every(id => known.has(id)));
    if (here.some(m => !p.completed.includes(m.id))) return changed;
    const next = order.find(([r, s]) => cmpRank({ rank: r, subrank: s }, p) > 0);
    if (!next) return changed;
    [p.rank, p.subrank] = next;
    changed = true;
  }
}

/** Marks a mission done, adds its prestige and ranks up. */
export function completeMission(missions: Mission[], m: Mission, p: MissionProgress, now = Date.now()) {
  if (m.cls === "Prestige") p.cycles[m.id] = m.schedule ? scheduleCycle(m.schedule, now) : 0;
  else if (!p.completed.includes(m.id)) p.completed.push(m.id);
  p.prestige += m.prestige;
  advanceRank(missions, p);
}

/** Crowns a mission pays (the game's amounts are server data; tuning numbers). */
export function crownReward(m: Mission): number {
  const r = Math.max(1, m.rank);
  if (m.kind === "dungeon") return 100 * r * Math.max(1, m.setting?.floors ?? 2);
  if (m.kind === "gate") return 150 * r;
  return 25 * r;
}

// ------------------------------------------------------------------------------ exchanges

/**
 * What an exchange asks for. Random-choose exchanges draw one ingredient from each choice's
 * recipes (config/recipe.dat, with its Count argument), seeded by the mission and the
 * schedule cycle so the ask stays fixed for the day.
 */
export function exchangeNeeds(m: Mission, recipes: Map<string, any>, now = Date.now()): Ingredient[] {
  if (!m.choose.length) return m.ingredients;
  const cycle = m.schedule ? scheduleCycle(m.schedule, now) : 0;
  const rand = rng((hash(m.id) ^ Math.imul(cycle + 1, 2654435761)) >>> 0);
  const out: Ingredient[] = [];
  for (const choice of m.choose) {
    const pool: Ingredient[] = [];
    for (const r of choice) {
      const base = recipes.get(r.recipe);
      if (!base) continue;
      const ref = { name: r.recipe, arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Count", r.count]] } };
      const cfg = applyArguments(base, ref);
      for (const g of list(cfg.ingredients)) if (g?.item?.name) pool.push({ item: g.item.name, count: g.count ?? r.count });
    }
    if (pool.length) out.push(pool[Math.floor(rand() * pool.length)]);
  }
  return out;
}

/** Whether the knight has an exchange's items: materials by count, gear owned (at its level). */
export function canExchange(needs: Ingredient[], materials: Record<string, number>, owned: (name: string) => number): boolean {
  return needs.length > 0 && needs.every(g => (g.level !== undefined ? owned(g.item) > 0 && owned(g.item) >= g.level : (materials[g.item] ?? 0) >= g.count));
}

// ------------------------------------------------------------------------------ rewards

/** Every item a reward table can give, with counts (a preview: random entries list all options). */
export function rewardItems(table: string, lib: Map<string, any>): { item: string; count: number }[] {
  const out = new Map<string, number>();
  const seen = new Set<any>();
  const walk = (o: any, depth: number) => {
    if (!o || typeof o !== "object" || depth > 20 || seen.has(o) || ArrayBuffer.isView(o)) return;
    seen.add(o);
    const k = short(o);
    if (/ItemEntry$/.test(k) && o.item?.name) { out.set(o.item.name, (out.get(o.item.name) ?? 0) + (o.count ?? 1)); return; }
    if (k === "TableEntry" && o.spawnTable?.name) { const t = lib.get(o.spawnTable.name); if (t) walk(t.root ?? t, depth + 1); return; }
    if (o.$map) { for (const [, v] of o.entries) walk(v, depth + 1); return; }
    for (const key of Object.keys(o)) if (key !== "$outer" && key !== "$class") walk(o[key], depth + 1);
  };
  const t = lib.get(table);
  if (t) walk(t.root ?? t, 0);
  return [...out].map(([item, count]) => ({ item, count }));
}

/** Gear goes to the arsenal; anything else is a material. */
export const isGear = (name: string) => /^(Weapon\/(Sword|Handgun|Bomb)|Gear\/(Shield|Armor|Helm|Trinket|Dungeon\/Vitapod))\//.test(name);

// ------------------------------------------------------------------------------ text

const NPC_NAMES: Record<string, string> = { kora: "Kora", rendon: "Rhendon", feron: "Feron", hahn: "Hahn", hood: "Hood", bosco: "Bosco",
  morlin: "Morlin", vaelyn: "Vaelyn", bechamel: "Bechamel", desna: "Desna", plume: "Plume", kozma: "Kozma", barrus: "Barrus",
  armorstylist: "the armour stylist", geo: "Geo" };

/** The NPC a conversation is with: from its model, else from the card ("knight-kora_comlink"). */
export function npcName(m: Pick<Mission, "npcModel" | "cardImage">): string | null {
  const fromModel = /model_([a-z]+)\.dat$/.exec(m.npcModel ?? "")?.[1];
  const fromCard = /knight-([a-z]+)/.exec((m.cardImage ?? "").split("/").pop() ?? "")?.[1];
  const key = fromModel ?? fromCard;
  return key ? NPC_NAMES[key] ?? key[0].toUpperCase() + key.slice(1) : null;
}

/** Briefings we write for the conversation missions (the game's dialogue is unavailable). */
const BRIEFINGS: Record<string, string> = {
  first_contact: "Kora calls over the comlink: the Skylark has crashed on Cradle and the crew is scattered. Find your bearings.",
  securing_camp: "Rhendon introduces the camp's missions: help secure the crash site before going further.",
  first_contact_b: "Kora checks in again: the camp is holding, and the way to Haven lies ahead.",
  go_shopping: "Time to gear up. Visit the bazaar in Haven and see what its merchants sell.",
  reporting_duty: "Feron at the Arcade wants every new knight to report in before entering the gates.",
  laboratory_visit: "Morlin invites you to the Spiral Laboratory, where sprites are studied.",
  welcome_to_haven: "Kora welcomes you to Haven, the Spiral Knights' town on Cradle.",
  alchemy_beginners: "Bosco explains alchemy: combine materials and crowns to forge better gear.",
  choose_your_sprite: "Morlin asks you to pick the sprite that will fight at your side.",
  prestigious_opportunity: "Kora tells you about prestige missions: daily tasks that build your standing.",
  minerals_rock: "Hood explains the minerals found in the Clockworks and what they power.",
  pioneers: "Kora shares what the first pioneers learned about the depths.",
  new_chapter: "Kora marks a new chapter: you are a full Knight, and deeper tiers open to you.",
  advanced_alchemy: "Bosco shows you how to forge gear into its stronger forms.",
  shopping_again: "Bechamel has new wares in Haven for a knight of your rank.",
  pierce_of_cake: "Hahn has a lead that should be, as he puts it, a piece of cake.",
  elemental_my_dear: "Hahn explains the elemental strata of the Clockworks: fire, freeze, poison and shock.",
  shadow_knows: "Hahn has found signs of a shadowy force moving in the depths.",
  another_trace: "Kora has picked up another trace of the missing crew.",
  explosive_plot: "Kora uncovers a plot that could blow the Clockworks wide open.",
  target_acquired: "Kora has pinpointed a target deep below. Prepare for the descent.",
  alchemy_mastery: "Bosco teaches the last secrets of alchemy for the finest gear.",
  darkest_depths: "Kora warns of what waits in the darkest depths of the Clockworks.",
  best_of_beast: "A briefing on the fiercest beasts the Clockworks have bred.",
  creators_and_created: "A briefing on the gremlins and the machines they build.",
  darkest_forces: "Hahn reports that the darkest forces below are gathering.",
  becoming_champion: "Feron explains what it takes to become a champion of the Spiral Order.",
  ending_in_fire: "Kora's trail leads to the Firestorm Citadel and its lord.",
  eye_of_needle: "Kora has found a narrow way through to the deepest strata.",
  heart_of_matter: "Vaelyn reveals what lies at the heart of the Clockworks.",
  true_champion: "Kora honours you as a true champion of the Order.",
  honor_duty: "Feron speaks of honour and duty to the knights who come after you.",
  search_continues: "Vaelyn's search for answers about the Core goes on.",
  a_call_to_arms: "Vaelyn calls every champion to arms.",
  delved_too_deep: "Kora fears the Order has delved too deep.",
  the_flickering_flame: "Kora tends a flickering hope for the crew still lost below.",
};

function summarize(m: Mission): string {
  const npc = npcName(m);
  switch (m.kind) {
    case "conversation": case "gate-conversation":
      return BRIEFINGS[m.id] ?? (npc ? `${npc} has a briefing for you: "${m.title}".` : `A briefing: "${m.title}".`);
    case "exchange": return m.choose.length ? "Turn in the materials asked for today." : "Turn in the items asked for.";
    case "gate": return `Clear a ${m.gateTheme} stratum in any Arcade gate today.`;
    default: {
      const s = m.setting!;
      return `${s.floors} floors at depth ${s.depth}: ${s.family} monsters${s.boss ? `, ending with ${BOSSES[s.boss].name}` : ""}.`;
    }
  }
}
