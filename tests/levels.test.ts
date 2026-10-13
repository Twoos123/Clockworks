import assert from "node:assert/strict";
import { test } from "node:test";
import { checklist, floorOf, inRegion, inSet, LEVELS, matchLevels } from "../src/game/levels.ts";
import { prettySceneName } from "../src/scene.ts";

// the twelve scenes in the reference install's cache, by their raw names
const CACHED: [string, string][] = [
  ["%town:m.haven_town_square", "Town Square"],
  ["%town:m.haven_bazaar", "Bazaar"],
  ["%guild:m.hall|~The Exceeds", "Guild Hall"],
  ["%dungeon:m.dark_halls_lobby", "Dark Halls lobby"],
  ["%dungeon:m.dark_halls_finale", "Dark Halls finale"],
  ["%dungeon:m.mission_lobby", "Mission Lobby"],
  ["%dungeon:m.terminal_core", "Core Terminal"],
  ["%dungeon:m.terminal_1", "Clockwork Terminal (depth 4)"],
  ["%dungeon:m.emberlight", "Emberlight"],
  ["%dungeon:m.jigsaw_valley_emerald_axis_2", "Emerald Axis II"],
  ["%dungeon:m.jigsaw_valley_perimeter_promenade_2", "Perimeter Promenade II"],
  ["%dungeon:m.jigsaw_valley_the_jade_tangle", "Jade Tangle"],
];

test("each cached scene matches exactly its level", () => {
  for (const [raw, level] of CACHED) {
    const m = matchLevels(prettySceneName(raw));
    assert.deepEqual(m.map(l => l.name), [level], raw);
  }
});

test("numbered variants stay apart", () => {
  const p = inSet("Jigsaw Valley", "Emerald Axis");
  assert.ok(p.test("jigsaw valley emerald axis"));
  assert.ok(p.test("jigsaw valley emerald axis 1"));
  assert.ok(!p.test("jigsaw valley emerald axis 2"));
  const p2 = inSet("Jigsaw Valley", "Emerald Axis II");
  assert.ok(p2.test("jigsaw valley emerald axis 2") && p2.test("jigsaw valley emerald axis ii") && p2.test("emerald axis 2"));
  assert.ok(!p2.test("jigsaw valley emerald axis 3"));
});

test("regions, missions and punctuation", () => {
  assert.ok(inRegion("Blast Furnace", "Wild Path").test("blast furnace wild path"));
  assert.ok(!inRegion("Blast Furnace", "Wild Path").test("clockwork tunnels wild path"));
  assert.ok(floorOf("Whipping and Mishandling", "Sol'Fork Skyway").test("solfork skyway"));
  assert.ok(floorOf("The King of Ashes", "The Path is Sealed").test("king of ashes path is sealed"));
  assert.deepEqual(matchLevels("Devilish_Drudgery_Everybody's_Fired").map(l => l.name), ["Everybody's Fired"]);
  // a Shadow Lair stage is not its boss stratum's stage
  assert.deepEqual(matchLevels("shadow lair royal jelly palace battle royale").map(l => l.set), ["Shadow Lair: Royal Jelly Palace"]);
});

test("the checklist counts per group and lists unmatched names", () => {
  const list = checklist([...CACHED.map(([raw]) => prettySceneName(raw)), "some new level"], () => false);
  assert.deepEqual(list.unmatched, ["some new level"]);
  assert.equal(list.have, CACHED.length);
  assert.equal(list.total, LEVELS.length);
  const towns = list.groups.find(g => g.group === "towns")!;
  assert.equal(towns.have.length, 7);
  assert.equal(list.groups.reduce((n, g) => n + g.have.length + g.missing.length, 0), LEVELS.length);
});

test("every level has a unique name within its set", () => {
  const seen = new Set<string>();
  for (const l of LEVELS) {
    const k = `${l.group}/${l.set}/${l.name}`;
    assert.ok(!seen.has(k), k);
    seen.add(k);
  }
});
