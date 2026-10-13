import assert from "node:assert/strict";
import { test } from "node:test";
import { checklist, guess, GUILD_HALL, keys, type Level, LEVELS, matchLevels, normalizeSceneName, NOT_LEVEL } from "../src/game/levels.ts";
import { prettySceneName } from "../src/scene.ts";

// Synthetic levels and scene keys in the real formats (no game text): "<set>_<level>" with
// numbered variants as digits, an abbreviated area and family, "_ultimate" for a lair's copy,
// and a mission's name appended to the level it reuses.
const lv = (set: string, name: string, pattern: RegExp, extra: Partial<Level> = {}): Level =>
  ({ group: "clockworks", set, name, where: "", pattern, availability: "regular", ...extra });
const SYNTH: Level[] = [
  lv("Foo Vale", "Bar Walk", keys("foo_vale_bar_walk")),
  lv("Foo Vale", "Bar Walk II", keys("foo_vale_bar_walk_2")),
  lv("Qux Tunnels", "Beast", keys("qx_beast")),
  lv("Grue Keep", "Gate", keys("grue_keep_gate", "grue_keep_gate_alt"), { group: "boss" }),
  lv("Shadow Lair: Grue Keep", "Gate", keys("grue_keep_gate_ultimate"), { group: "danger" }),
  lv("Mission X", "Floor One", keys("foo_vale_bar_walk_missionx", "foo_vale_bar_walk_2_missionx"), { group: "missions" }),
  lv("Town", "Plaza", keys("town_plaza"), { group: "towns" }),
  lv("Town", "Shipped Room", /^shipped room$/, { group: "towns", availability: "shipped", rsrc: "world/shipped/scene.dat" }),
];

test("display names from raw keys", () => {
  assert.equal(prettySceneName("%dungeon:m.foo_vale_bar_walk_2"), "foo vale bar walk 2");
  assert.equal(prettySceneName("%guild:m.hall|~Some Guild"), "hall (Some Guild)");
  // a key naming another bundle's key
  assert.equal(prettySceneName("%dungeon:%town:m.town_plaza"), "town plaza");
  assert.equal(normalizeSceneName("Foo_Vale_Bar's  Walk"), "foo vale bars walk");
});

test("keys match whole names only", () => {
  const n = (raw: string) => matchLevels(prettySceneName(raw), SYNTH).map(l => `${l.set}: ${l.name}`);
  assert.deepEqual(n("%dungeon:m.foo_vale_bar_walk"), ["Foo Vale: Bar Walk"]);
  assert.deepEqual(n("%dungeon:m.foo_vale_bar_walk_2"), ["Foo Vale: Bar Walk II"]);
  // a mission floor that reuses an arcade level is the mission's, not the level's
  assert.deepEqual(n("%dungeon:m.foo_vale_bar_walk_2_missionx"), ["Mission X: Floor One"]);
  // the lair's copy and an alternate layout
  assert.deepEqual(n("%dungeon:m.grue_keep_gate_ultimate"), ["Shadow Lair: Grue Keep: Gate"]);
  assert.deepEqual(n("%dungeon:m.grue_keep_gate_alt"), ["Grue Keep: Gate"]);
  assert.deepEqual(n("%dungeon:m.qx_beast"), ["Qux Tunnels: Beast"]);
  assert.deepEqual(n("%dungeon:m.qx_beast_missionx"), []);
  // regex characters in a key are literal
  assert.ok(keys("a.b").test("a.b") && !keys("a.b").test("axb"));
});

test("guesses for levels whose key is not known", () => {
  assert.ok(guess("The Foo Bar").test("foo bar") && guess("The Foo Bar").test("the foobar"));
  assert.ok(!guess("Foo Bar").test("foo bar walk"));
  assert.ok(guess("Foo & Bar", true).test("x foo and bar 2"));
});

test("the checklist counts per group, guild halls and other scenes apart", () => {
  const names = ["foo vale bar walk", "foo vale bar walk", "qx beast", "grue keep gate ultimate", "town plaza",
    "hall (Guild One)", "hall (Guild Two)", "design (Guild One)", "test lobby", "demo something", "some new level"];
  const list = checklist(names, rsrc => rsrc === "world/shipped/scene.dat", SYNTH);
  assert.deepEqual(list.unmatched, ["some new level"]);
  assert.equal(list.guildHalls, 3);
  assert.equal(list.other, 2);
  assert.equal(list.have, 5);
  assert.equal(list.total, SYNTH.length);
  const g = (id: string) => list.groups.find(x => x.group === id)!;
  assert.equal(g("clockworks").have.length, 2);
  assert.equal(g("clockworks").missing.length, 1);
  assert.equal(g("danger").have.length, 1);
  assert.equal(g("towns").have.length, 2);
  assert.equal(list.groups.reduce((n, x) => n + x.have.length + x.missing.length, 0), SYNTH.length);
  // without the shipped file, the shipped level is missing
  assert.equal(checklist([], () => false, SYNTH).have, 0);
});

test("guild halls and non-level scenes", () => {
  for (const n of ["hall (A Guild)", "design (A Guild)", "guildhall"]) assert.ok(GUILD_HALL.test(n), n);
  assert.ok(!GUILD_HALL.test("hall of something"));
  for (const n of ["test lobby", "demo foo", "world map 7", "playground"]) assert.ok(NOT_LEVEL.test(n), n);
  assert.ok(!NOT_LEVEL.test("foo vale bar walk"));
});

test("the level list: unique names, one level per scene key", () => {
  const seen = new Set<string>();
  for (const l of LEVELS) {
    const k = `${l.group}/${l.set}/${l.name}`;
    assert.ok(!seen.has(k), k);
    seen.add(k);
    assert.ok(l.where, k);
    if (l.availability === "event") assert.ok(l.event, k);
  }
  // no exact-key pattern of one level matches another level's keys
  for (const l of LEVELS) {
    const m = /^\^\(\?:(.*)\)\$$/.exec(l.pattern.source);
    if (!m) continue;
    for (const key of m[1].split("|").map(s => s.replace(/\\(.)/g, "$1"))) {
      const hits = matchLevels(key);
      assert.deepEqual(hits, [l], `${key}: ${hits.map(h => h.name).join(", ")}`);
    }
  }
  // guild halls and dev scenes are not levels
  assert.deepEqual(matchLevels("hall (A Guild)"), []);
  assert.deepEqual(matchLevels("test lobby"), []);
});
