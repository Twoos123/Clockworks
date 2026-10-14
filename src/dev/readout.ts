// The Test Range's readouts (development only): what one hit did, from the world's probe
// (src/game/world.ts WorldProbe), and an attack's timing from its AttackConfig numbers. Pure
// functions, no DOM, so the sweep (tools/audit/sweep.ts) and the tests share them.

import type { AttackDef } from "../game/data";

/** An attack's timing in ms, as the world steps it (advanceAttack). */
export interface AttackTiming {
  /** Start of the attack to its landing (the fire phase): land / startSpeed. */
  startup: number;
  /** The fire actions' delays after landing: the first and last hit or spawn. */
  activeFrom: number;
  activeTo: number;
  /** Landing to the follow-through (when another attack may start): rearm / fireSpeed. */
  rearm: number;
  /** The follow-through's length: clear / endSpeed. */
  clear: number;
  /** startup + rearm + clear. */
  total: number;
}

export function attackTiming(a: AttackDef): AttackTiming {
  const startup = a.land / (a.startSpeed || 1), rearm = a.rearm / (a.fireSpeed || 1), clear = a.clear / (a.endSpeed || 1);
  const delays = a.fires.length ? a.fires.map(f => f.delay) : [a.delay ?? 0];
  return { startup, activeFrom: Math.min(...delays), activeTo: Math.max(...delays), rearm, clear, total: startup + rearm + clear };
}

export interface StatusRoll { kind: string; chance: number; applied: boolean; duration: number }

/** One hit as the range records it. */
export interface HitRecord {
  /** World seconds when it landed. */
  t: number;
  /** Who struck and who was struck ("knight", or a monster's config name). */
  from: string;
  to: string;
  /** The attack it came from (the striker's attack under way, else its last one started). */
  attack: string | null;
  /** Damage per type before defence, and health taken. */
  amounts: Record<string, number>;
  dealt: number;
  /** Knockback distance (units) and duration (ms), and whether it moved the target. */
  knock: number;
  knockMs: number;
  knockLevel: number;
  moved: boolean;
  /** Interrupted the target (a monster's flinch, the knight's flinch or knockdown). */
  reacted: boolean;
  knockdown?: boolean;
  shielded?: boolean;
  killed: boolean;
  /** Status conditions rolled by the hit (applied or not), with their chance. */
  statuses: StatusRoll[];
  timing: AttackTiming | null;
  /** The weapon's charge time (ms) when the hit came from a charged attack. */
  chargeTime?: number;
  charged?: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** "NORMAL 60% / PIERCING 40%": each damage type's share of the hit before defence. */
export function damageSplit(amounts: Record<string, number>): string {
  const entries = Object.entries(amounts).filter(([, v]) => v > 0);
  const sum = entries.reduce((s, [, v]) => s + v, 0);
  if (!sum) return "none";
  return entries.sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v / sum * 100)}%`).join(" / ");
}

/** A status roll as text: "Fire 25% (applied, 4.0 s)". */
export function statusText(s: StatusRoll): string {
  return `${s.kind} ${Math.round(s.chance * 100)}% (${s.applied ? `applied, ${r1(s.duration / 1000)} s` : "not applied"})`;
}

export function timingText(t: AttackTiming | null, chargeTime?: number): string {
  if (!t) return "-";
  const active = t.activeFrom === t.activeTo ? `${Math.round(t.activeFrom)}` : `${Math.round(t.activeFrom)}-${Math.round(t.activeTo)}`;
  const parts = [`startup ${Math.round(t.startup)} ms`, `active +${active} ms`, `rearm ${Math.round(t.rearm)} ms`, `clear ${Math.round(t.clear)} ms`];
  if (chargeTime) parts.push(`charge ${Math.round(chargeTime)} ms`);
  return parts.join(", ");
}

/** The readout's lines for one hit. */
export function hitLines(h: HitRecord): string[] {
  const raw = Object.values(h.amounts).reduce((s, v) => s + Math.max(0, v), 0);
  return [
    `${h.attack ?? "(unknown attack)"}${h.charged ? " [charged]" : ""}: ${h.from} -> ${h.to}`,
    `damage ${h.dealt}${h.shielded ? " (to the shield)" : ""} of ${Math.round(raw)} raw · ${damageSplit(h.amounts)}`,
    `knockback ${r1(h.knock)} u over ${Math.round(h.knockMs)} ms (level ${h.knockLevel})${h.moved ? "" : " · did not move it"}`,
    `interrupt: ${h.knockdown ? "knockdown" : h.reacted ? "flinch" : "none"}${h.killed ? " · killed" : ""}`,
    `status: ${h.statuses.length ? h.statuses.map(statusText).join("; ") : "none"}`,
    `timing: ${timingText(h.timing, h.charged ? h.chargeTime : undefined)}`,
  ];
}

/** Totals over several hits (a chain, a charge): count, damage, the biggest knockback. */
export function summarize(hits: HitRecord[]): { hits: number; dealt: number; maxKnock: number; reacted: number; statuses: string[] } {
  return {
    hits: hits.length,
    dealt: hits.reduce((s, h) => s + h.dealt, 0),
    maxKnock: r1(Math.max(0, ...hits.map(h => h.knock))),
    reacted: hits.filter(h => h.reacted).length,
    statuses: [...new Set(hits.flatMap(h => h.statuses.filter(s => s.applied).map(s => s.kind)))],
  };
}

// ------------------------------------------------------------------ monster names

/** A monster's family (its folder under Character/NPC/Monster/), species and tier from its config name. */
export function monsterParts(name: string): { family: string; species: string; tier: string } {
  const segs = name.replace(/^Character\/NPC\/Monster\//, "").split("/");
  const family = segs[0] ?? "";
  const last = segs[segs.length - 1] ?? "";
  // "Jelly Cube 3", "Scuttlebot Mk II", "Royal Jelly (Stage 1)"
  const m = /^(.*?)(?:\s+(\d)|\s+(Mk I{1,3}|Mk IV|Mk V))$/.exec(last);
  const tier = m ? (m[2] ?? m[3]) : "";
  const base = m ? m[1] : last;
  const species = [...segs.slice(1, -1), base].filter((s, i, a) => i === a.length - 1 || s !== a[a.length - 1]).join("/");
  return { family, species: species || base, tier };
}

/** Monster config names grouped by family, then species, each with its tiers in order. */
export function monsterTree(names: string[]): Map<string, Map<string, { tier: string; name: string }[]>> {
  const out = new Map<string, Map<string, { tier: string; name: string }[]>>();
  for (const name of names) {
    const p = monsterParts(name);
    let fam = out.get(p.family);
    if (!fam) out.set(p.family, fam = new Map());
    let sp = fam.get(p.species);
    if (!sp) fam.set(p.species, sp = []);
    sp.push({ tier: p.tier, name });
  }
  for (const fam of out.values()) for (const list of fam.values()) list.sort((a, b) => a.tier.localeCompare(b.tier, undefined, { numeric: true }));
  return out;
}
