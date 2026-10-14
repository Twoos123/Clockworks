import assert from "node:assert/strict";
import { test } from "node:test";
import { agoKey, feedEntries, feedGroup, logFeed, normalizeFeed, FEED_MAX, type FeedRecord } from "../src/game/feed.ts";
import { ACHIEVEMENTS, freshAchievements } from "../src/game/achievements.ts";
import { hubMissions, freshProgress, type Mission } from "../src/game/missions.ts";
import { messages, parseProperties } from "../src/i18n.ts";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 14, 12);

messages.add("social", parseProperties([
  "m.minutes_ago.1={0} minute ago", "m.minutes_ago.n={0} minutes ago", "m.hours_ago.1={0} hour ago", "m.hours_ago.n={0} hours ago",
  "m.days_ago.1={0} day ago", "m.days_ago.n={0} days ago", "m.weeks_ago.1={0} week ago", "m.weeks_ago.n={0} weeks ago",
  "m.you=You have {1}", "m.achievement=unlocked the achievement\\: {0}", "m.boss_desc=defeated {0} in the {1}",
  "m.rank_earned=reached the {0} rank", "m.progress_haven=reached Haven.", "n.snarbolax=the Snarbolax", "l.snarbolax=Gloaming Wildwoods",
].join("\n")));
const haven = ACHIEVEMENTS.find(a => a.type === "REACHED_HAVEN")!;
messages.add("projectx", parseProperties(`${haven.nameKey}=Welcome to Haven`));
messages.add("mission", parseProperties("m.rank_title_2=Recruit"));
const say = (k: string) => messages.getBundle("social").xlate(k);

test("FeedEvent.an: minutes from one, then hours, days and weeks", () => {
  assert.equal(say(agoKey(NOW, NOW)), "1 minute ago");
  assert.equal(say(agoKey(NOW, NOW - 17 * MIN)), "18 minutes ago");
  assert.equal(say(agoKey(NOW, NOW - 3 * HOUR)), "3 hours ago");
  assert.equal(say(agoKey(NOW, NOW - DAY - HOUR)), "1 day ago");
  assert.equal(say(agoKey(NOW, NOW - 20 * DAY)), "2 weeks ago");
});

test("the groups: a day for Today, seven for This Week, then Last Week", () => {
  assert.equal(feedGroup(NOW, NOW - 23 * HOUR), "g.today");
  assert.equal(feedGroup(NOW, NOW - 2 * DAY), "g.this_week");
  assert.equal(feedGroup(NOW, NOW - 8 * DAY), "g.last_week");
});

test("the knight's history: achievements, Haven, bosses and ranks, newest first, in the client's words", () => {
  const a = freshAchievements();
  a.unlocked.REACHED_HAVEN = NOW - 3 * DAY;
  const s = { achievements: a, feed: [] as FeedRecord[] };
  logFeed(s, { kind: "boss", key: "snarbolax", at: NOW - 10 * MIN });
  logFeed(s, { kind: "rank", rank: 2, at: NOW - 9 * DAY });
  const e = feedEntries(s, "Asad", NOW);
  assert.deepEqual(e.map(x => say(x.description)), [
    "You have defeated the Snarbolax in the Gloaming Wildwoods",
    "You have unlocked the achievement: Welcome to Haven",
    "You have reached Haven.",
    "You have reached the Recruit rank",
  ]);
  assert.deepEqual(e.map(x => x.group), ["g.today", "g.this_week", "g.this_week", "g.last_week"]);
  assert.equal(e[1].icon, haven.icon);
  assert.equal(e[3].icon, "ui/icon/social/mission-rank.png");
});

test("at most fifty entries; the log is repaired on load", () => {
  const s = { feed: [] as FeedRecord[] };
  for (let i = 0; i < 80; i++) logFeed(s, { kind: "rank", rank: 2, at: NOW - i * MIN });
  assert.equal(feedEntries(s, "K", NOW).length, FEED_MAX);
  assert.deepEqual(normalizeFeed([{ kind: "boss", key: "jelly", at: 5 }, { kind: "boss", at: 5 }, { kind: "rank", rank: "3", at: 6 }, null, "x"]),
    [{ kind: "boss", key: "jelly", at: 5 }, { kind: "rank", rank: 3, at: 6 }]);
});

test("the Events group: the client's suggested mission first, then the open event missions", () => {
  const m = (id: string, cls: Mission["cls"], extra: Partial<Mission> = {}) => ({
    id, path: `${cls}/${id}`, title: id, cls, rank: 1, subrank: 1, maxRank: 11, needs: [], schedule: null, event: null, ...extra,
  }) as Mission;
  const p = freshProgress();
  const list = [m("r2", "Rank"), m("r1", "Rank"), m("later", "Rank", { subrank: 2 }), m("torto", "Prestige", { event: "Tortodrone" }),
    m("locked_event", "Prestige", { event: "Anniversary", rank: 5 }), m("plain", "Prestige")];
  assert.deepEqual(hubMissions(list, p, NOW).map(x => x.id), ["r1", "torto"]);
  p.completed.push("r1", "r2");
  assert.deepEqual(hubMissions(list, p, NOW).map(x => x.id), ["plain", "torto"]);
});
