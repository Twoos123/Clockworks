// The Event Hub's history (social/client/FeedListPanel, social/data/FeedEvent). The game's
// servers kept a feed of what the player, friends and guildmates did (achievements, bosses
// defeated, ranks earned, clearance gained) and the panel sorted it by age into Today (the
// last day), This Week (the last seven days) and Last Week (older), at most 50 entries, each
// with its icon and an "N minutes ago" line (FeedEvent.an). Here the feed is the knight's own:
// the achievements' unlock times, and a log of bosses defeated and ranks earned kept in the
// save. The texts are the client's compound keys in the social bundle, read through it.

import { compose, qualify, taint } from "../i18n";
import { ACHIEVEMENTS, type AchievementSave } from "./achievements";

/** A deed the save logs for the feed: a boss defeated (social bundle key) or a rank earned. */
export type FeedRecord = { kind: "boss"; key: string; at: number } | { kind: "rank"; rank: number; at: number };

/** SocialCodes.FeedGroup: the group names (social bundle keys), in the panel's order. */
export const FEED_GROUPS = ["g.events", "g.today", "g.this_week", "g.last_week"] as const;
export type FeedGroup = (typeof FEED_GROUPS)[number];

/** The panel lists at most this many history entries (FeedListPanel.A). */
export const FEED_MAX = 50;
/** The save keeps this many logged deeds. */
const LOG_MAX = 100;
const DAY = 86_400_000;

/** BossKey (src/game/clockworks.ts) to the social bundle's boss key (n.<key>, l.<key>). */
export const FEED_BOSS: Record<string, string> = { jelly: "royal_jelly", snarbolax: "snarbolax", twins: "roarmulus", vanaduke: "vanaduke" };

/** A save's feed log, repaired. */
export function normalizeFeed(list: unknown): FeedRecord[] {
  if (!Array.isArray(list)) return [];
  const out: FeedRecord[] = [];
  for (const r of list) {
    const at = Number(r?.at);
    if (!Number.isFinite(at) || at <= 0) continue;
    if (r.kind === "boss" && typeof r.key === "string") out.push({ kind: "boss", key: r.key, at });
    else if (r.kind === "rank" && Number.isFinite(Number(r.rank))) out.push({ kind: "rank", rank: Number(r.rank), at });
  }
  return out.slice(-LOG_MAX);
}

/** Logs a deed (the oldest fall off past the log's size). */
export function logFeed(s: { feed?: FeedRecord[] }, r: FeedRecord) {
  const log = s.feed ??= [];
  log.push(r);
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
}

/** FeedEvent.an: "N minutes ago", then hours, days and weeks (a compound key of the social bundle). */
export function agoKey(now: number, at: number): string {
  let n = Math.trunc((now - at) / 60000 + 1);
  if (n < 60) return compose("m.minutes_ago", taint(n));
  n = Math.trunc(n / 60);
  if (n < 24) return compose("m.hours_ago", taint(n));
  n = Math.trunc(n / 24);
  if (n < 7) return compose("m.days_ago", taint(n));
  return compose("m.weeks_ago", taint(Math.trunc(n / 7)));
}

/** FeedListPanel.a(FeedEvent): Today within a day, This Week within seven, else Last Week. */
export function feedGroup(now: number, at: number): FeedGroup {
  return at > now - DAY ? "g.today" : at > now - 7 * DAY ? "g.this_week" : "g.last_week";
}

/** A history entry: its group, time, icon and texts (compound keys of the social bundle). */
export interface FeedEntry { key: string; group: FeedGroup; at: number; icon: string; description: string; info: string }

/** The achievements FeedEvent.Progress also reports: tier clearance and reaching Haven. */
const PROGRESS: Record<string, string> = { EARNED_TIER_2: "m.progress_tier_2", EARNED_TIER_3: "m.progress_tier_3", REACHED_HAVEN: "m.progress_haven" };
/** The achievement whose icon a boss's entry shows (the client's was the boss's gate icon). */
const BOSS_ICON: Record<string, string> = { royal_jelly: "DEFEATED_ROYAL_JELLY", snarbolax: "DEFEATED_SNARBOLAX", roarmulus: "DEFEATED_ROARMULUS", vanaduke: "DEFEATED_VANADUKE" };

/**
 * The knight's history, newest first: FeedEvent.Achievement for each achievement earned,
 * Progress for clearance and Haven, Boss and RankEarned from the log. Each reads as the
 * panel's own line for the player: m.you ("You have {1}") around the event's description.
 */
export function feedEntries(s: { achievements?: AchievementSave; feed?: FeedRecord[] }, name: string, now = Date.now()): FeedEntry[] {
  const out: Omit<FeedEntry, "group" | "info">[] = [];
  const you = (desc: string) => compose("m.you", taint(name), desc);
  for (const d of ACHIEVEMENTS) {
    const at = s.achievements?.unlocked[d.type];
    if (!at) continue;
    out.push({ key: "a:" + d.type, at, icon: d.icon, description: you(compose("m.achievement", qualify("projectx", d.nameKey))) });
    const p = PROGRESS[d.type];
    if (p) out.push({ key: "p:" + d.type, at, icon: "ui/icon/icon_128.png", description: you(p) });
  }
  for (const r of s.feed ?? []) {
    if (r.kind === "boss") {
      const icon = ACHIEVEMENTS.find(a => a.type === BOSS_ICON[r.key])?.icon ?? "ui/icon/icon_128.png";
      out.push({ key: `b:${r.key}:${r.at}`, at: r.at, icon, description: you(compose("m.boss_desc", "n." + r.key, "l." + r.key)) });
    } else {
      out.push({ key: `r:${r.rank}:${r.at}`, at: r.at, icon: "ui/icon/social/mission-rank.png",
        description: you(compose("m.rank_earned", qualify("mission", `m.rank_title_${r.rank}`))) });
    }
  }
  return out.filter(e => e.at <= now + 60000).sort((a, b) => b.at - a.at).slice(0, FEED_MAX)
    .map(e => ({ ...e, group: feedGroup(now, e.at), info: agoKey(now, e.at) }));
}
