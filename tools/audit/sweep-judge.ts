// The sweep's pure half (tools/audit/sweep.ts): its command line, file names, the anomaly
// rules for each weapon, monster and knight record the page returns (sweep.page.js), and the
// Markdown report. No browser and no files here, so the tests cover it (tests/sweep.test.ts).

import { monsterParts, type HitRecord } from "../../src/dev/readout.ts";

// ------------------------------------------------------------------ command line

export interface SweepArgs {
  /** Name filters (case-insensitive regular expressions), null when that kind is not swept. */
  weapons: RegExp | null;
  monsters: RegExp | null;
  knight: boolean;
  out: string;
  url: string;
  workers: number;
  /** At most this many items of each kind (0: all). */
  limit: number;
  /** Sweep items again even when their record is on disk. */
  redo: boolean;
  /** Sweep again the items whose record on disk ended in a sweep error. */
  redoErrors: boolean;
  /** Only rebuild the contact sheets and the report from the records on disk. */
  reportOnly: boolean;
  /** Start the audit dev server (and stop it at the end). */
  serve: boolean;
  /** Seconds before one item's sweep is abandoned. */
  timeout: number;
}

const ANY = /.*/;

/**
 * `--weapons [regex]`, `--monsters [regex]`, `--knight`: what to sweep (all three when none
 * is named); a flag without a value takes every item of its kind.
 */
export function parseArgs(argv: string[]): SweepArgs {
  const has = (k: string) => argv.includes(`--${k}`);
  const value = (k: string): string | null => {
    const i = argv.indexOf(`--${k}`);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v !== undefined && !v.startsWith("--") ? v : null;
  };
  const filter = (k: string) => (has(k) ? (value(k) ? new RegExp(value(k)!, "i") : ANY) : null);
  let weapons = filter("weapons"), monsters = filter("monsters");
  let knight = has("knight");
  if (!weapons && !monsters && !knight) { weapons = ANY; monsters = ANY; knight = true; }
  return {
    weapons, monsters, knight,
    out: value("out") ?? ".scratch/sweep",
    url: value("url") ?? process.env.SWEEP_URL ?? "http://localhost:5183/",
    workers: Math.max(1, Number(value("workers") ?? 1) || 1),
    limit: Math.max(0, Number(value("limit") ?? 0) || 0),
    redo: has("redo"),
    redoErrors: has("redo-errors"),
    reportOnly: has("report-only"),
    serve: has("serve"),
    timeout: Math.max(20, Number(value("timeout") ?? 150) || 150),
  };
}

/** A file-safe, readable and unique name for a config path. */
export function slug(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
  const base = name.replace(/^(Weapon|Character\/NPC\/Monster)\//, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return `${base || "item"}-${h.toString(36)}`;
}

/** The contact sheet a record goes on: a weapon's class, a monster's family. */
export function groupOf(kind: "weapons" | "monsters", name: string): string {
  if (kind === "weapons") return (name.split("/")[1] ?? "Other").toLowerCase();
  return (monsterParts(name).family || "Other").toLowerCase();
}

// ------------------------------------------------------------------ records

export interface Pose { clip: string | null; overlay?: string | null; targets: number; matched: number; overlayMatched?: number; overlayTargets?: number }
export interface Shot { label: string; file?: string; thumb?: string; pose: Pose | null; t?: number }
export interface RunLog {
  attacks: string[];
  projectiles: string[];
  /** Effects spawned, " (failed)" when the model did not load. */
  effects: string[];
  sounds: string[];
  hits: HitRecord[];
}

export interface WeaponRecord {
  name: string;
  error?: string;
  kind?: string;
  rarity?: number;
  chargeTime?: number;
  attackNames?: string[];
  chargedName?: string | null;
  chain?: RunLog | null;
  charge?: (RunLog & { full: boolean; pose: string | null }) | null;
  shots: Shot[];
  console: string[];
  problems: string[];
}

export interface MonsterRecord {
  name: string;
  error?: string;
  passive?: boolean;
  speed?: number;
  attackNames?: string[];
  idle?: string | null;
  move?: string | null;
  react?: string | null;
  dying?: string | null;
  reactTime?: number;
  minReact?: number;
  /** The forced attack: its name, whether it hit the knight or fired anything. */
  forced?: { name: string; hits: HitRecord[]; projectiles: string[]; effects: string[] } | null;
  /** Left to its own behaviour for a few seconds. */
  live?: { attacked: boolean; moved: number };
  reacted?: boolean;
  died?: boolean;
  removedAfter?: number | null;
  deathEffects?: string[];
  shots: Shot[];
  console: string[];
  problems: string[];
}

export interface KnightRecord {
  error?: string;
  actions: { label: string; playing: string; dead?: boolean }[];
  shots: Shot[];
  console: string[];
  problems: string[];
}

// ------------------------------------------------------------------ anomalies

/** The game's own "no animation" clip (on placeholder nodes): not a bind pose. */
const BLANK = /common\/blank\.dat/;

/** A shot whose model shows its bind pose: nothing playing, or a clip that moves none of its nodes. */
export function bindPose(p: Pose | null): string | null {
  if (!p) return null;
  if (!p.clip) return "no animation (bind pose)";
  if (p.targets > 0 && p.matched === 0 && !BLANK.test(p.clip)) return `${p.clip} moves none of the model's nodes (bind pose)`;
  if (p.overlay && (p.overlayTargets ?? 0) > 0 && p.overlayMatched === 0) return `upper-body ${p.overlay} moves none of the model's nodes`;
  return null;
}

const consoleProblems = (lines: string[]) => [...new Set(lines)].slice(0, 5).map(l => `console: ${l.slice(0, 160)}`);
const failedEffects = (fx: string[]) => [...new Set(fx.filter(e => /\(failed\)/.test(e)))].map(e => `missing effect ${e.replace(/ \(failed\)$/, "")}`);

export function judgeWeapon(r: WeaponRecord): string[] {
  const p: string[] = [];
  if (r.error) p.push(`sweep error: ${r.error}`);
  for (const s of r.shots) { const b = bindPose(s.pose); if (b) p.push(`${s.label}: ${b}`); }
  const run = (label: string, x: RunLog | null | undefined) => {
    if (!x) return;
    if (!x.attacks.length) p.push(`${label}: no attack started`);
    if (r.kind !== "Sword" && !x.projectiles.length) p.push(`${label}: no projectile`);
    if (!x.hits.length) p.push(`${label}: no hit on the dummy`);
    else if (x.hits.every(h => h.dealt <= 0)) p.push(`${label}: zero damage`);
    p.push(...failedEffects(x.effects).map(e => `${label}: ${e}`));
  };
  run("chain", r.chain);
  if (r.chargedName) {
    run("charge", r.charge);
    if (r.charge && !r.charge.full) p.push("charge: never reached full charge");
    if (r.charge && !r.charge.pose) p.push("charge: no charging pose");
    if (r.charge && !r.charge.attacks.some(a => a.startsWith(r.chargedName!))) p.push("charge: the charged attack never fired");
  }
  p.push(...consoleProblems(r.console));
  return [...new Set(p)];
}

export function judgeMonster(r: MonsterRecord): string[] {
  const p: string[] = [];
  if (r.error) p.push(`sweep error: ${r.error}`);
  if (r.error && !r.shots.length) return [...new Set([...p, ...consoleProblems(r.console)])];
  for (const s of r.shots) { const b = bindPose(s.pose); if (b) p.push(`${s.label}: ${b}`); }
  if (!r.idle) p.push("no idle animation");
  if ((r.speed ?? 0) > 0 && !r.move) p.push("moves but has no movement animation");
  if (!r.passive) {
    const f = r.forced;
    // an "attack" that is only a state change (a Glop Drop's Idle, a spawner's pause) strikes nothing by design
    if (f && !f.hits.length && !f.projectiles.length && !/(^|[\/, ])Idle$/i.test(f.name)) p.push(`attack ${f.name}: no hit and no projectile`);
    if (f && f.hits.length && f.hits.every(h => h.dealt <= 0)) p.push(`attack ${f.name}: zero damage`);
    if (f) p.push(...failedEffects(f.effects).map(e => `attack ${f.name}: ${e}`));
    if (r.live && !r.live.attacked) p.push("never attacks (left to its own behaviour)");
    const reacts = (r.reactTime ?? 1) > 0 && (r.minReact ?? 0) < 1;
    if (reacts && r.reacted === false) p.push("no hit reaction");
    if (r.died === false) p.push("never dies");
    else if (r.died && r.removedAfter == null) p.push("its body stays after death");
    if (r.died && !(r.deathEffects ?? []).length) p.push("no death effect");
    p.push(...failedEffects(r.deathEffects ?? []).map(e => `death: ${e}`));
  }
  p.push(...consoleProblems(r.console));
  return [...new Set(p)];
}

export function judgeKnight(r: KnightRecord): string[] {
  const p: string[] = [];
  if (r.error) p.push(`sweep error: ${r.error}`);
  for (const s of r.shots) { const b = bindPose(s.pose); if (b) p.push(`${s.label}: ${b}`); }
  const death = r.actions.find(a => a.label === "death");
  if (death && !death.dead) p.push("death: the knight did not fall");
  const revive = r.actions.find(a => a.label === "revive");
  if (revive && revive.dead) p.push("revive: the knight stayed down");
  p.push(...consoleProblems(r.console));
  return [...new Set(p)];
}

// ------------------------------------------------------------------ report

/** Problems counted by kind (names and numbers folded together). */
export function tally(problems: string[][]): [string, number][] {
  const t = new Map<string, number>();
  for (const list of problems) for (const pr of new Set(list.map(x => x.replace(/[A-Za-z]:?[^ ]*\/[^ ]*(\.dat)?/g, "…").replace(/\d+/g, "#")))) t.set(pr, (t.get(pr) ?? 0) + 1);
  return [...t].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const short = (n: string) => n.replace(/^Weapon\//, "").replace(/^Character\/NPC\/Monster\//, "");

function damageCell(x: RunLog | null | undefined): string {
  if (!x) return "-";
  if (!x.hits.length) return "no hits";
  const dmg = x.hits.map(h => h.dealt).join("/");
  const kb = Math.max(...x.hits.map(h => h.knock)).toFixed(1);
  const st = [...new Set(x.hits.flatMap(h => h.statuses.filter(s => s.applied).map(s => s.kind)))];
  return `${dmg} · kb ${kb}${st.length ? ` · ${st.join(",")}` : ""}`;
}

export function reportMarkdown(data: { weapons: WeaponRecord[]; monsters: MonsterRecord[]; knight: KnightRecord | null; sheets: string[]; generated: string }): string {
  const L: string[] = ["# Test Range sweep", "",
    `Generated ${data.generated} by \`tools/audit/sweep.ts\` (Playwright, SwiftShader, muted) in the Test Range (docs/research/test-range.md).`,
    "Each weapon is equipped and put through its basic chain and a full charge against the frozen, undying dummy; each monster is",
    "spawned frozen, posed walking, made to attack, left to its own behaviour, struck and killed; the knight runs through its core actions.", ""];
  const section = (title: string, recs: { name: string; problems: string[] }[]) => {
    const bad = recs.filter(r => r.problems.length);
    L.push(`## ${title}`, "", `${recs.length - bad.length} clean, ${bad.length} flagged (of ${recs.length})`, "");
    const t = tally(recs.map(r => r.problems));
    if (t.length) L.push("Flags by kind:", "", ...t.map(([k, n]) => `- ${n} × ${k}`), "");
  };
  if (data.weapons.length) {
    section("Weapons", data.weapons);
    L.push("| Weapon | Chain (damage · knockback · statuses) | Charge | Flags |", "|---|---|---|---|",
      ...data.weapons.map(r => `| ${esc(short(r.name))} | ${esc(damageCell(r.chain))} | ${esc(r.chargedName ? damageCell(r.charge) : "-")} | ${esc(r.problems.join("; ") || "OK")} |`), "");
  }
  if (data.monsters.length) {
    section("Monsters", data.monsters);
    L.push("| Monster | Forced attack on the knight | Attacks on its own | Reacts | Dies | Flags |", "|---|---|---|---|---|---|",
      ...data.monsters.map(r => {
        const f = r.forced;
        const fc = !f ? (r.passive ? "passive" : "-") : f.hits.length ? `${f.name}: ${f.hits.map(h => h.dealt).join("/")}` : `${f.name}: ${f.projectiles.length ? "fired, missed" : "nothing"}`;
        return `| ${esc(short(r.name))} | ${esc(fc)} | ${r.live ? (r.live.attacked ? "yes" : "no") : "-"} | ${r.reacted == null ? "-" : r.reacted ? "yes" : "no"} | ${r.died == null ? "-" : r.died ? "yes" : "no"} | ${esc(r.problems.join("; ") || "OK")} |`;
      }), "");
  }
  if (data.knight) {
    L.push("## Knight", "", "| Action | Playing |", "|---|---|", ...data.knight.actions.map(a => `| ${a.label} | ${esc(a.playing)} |`), "",
      data.knight.problems.length ? `Flags: ${data.knight.problems.join("; ")}` : "No flags.", "");
  }
  if (data.sheets.length) L.push("## Contact sheets", "", ...data.sheets.map(s => `- [${s}](sheets/${s})`), "");
  return L.join("\n");
}
