import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyCapture } from "../src/game/archive.ts";
import { coverageRow, coverageSources, envDir, floorHasRooms, envFits, environmentFor, envOrder, levelCoverage, prefabCoverage, prefabType, rethemeEnv,
  roomFits, type CaptureFacts } from "../src/game/coverage.ts";
import { checklist, keys, type Level } from "../src/game/levels.ts";
import { assembleFloor } from "../src/gen/assemble.ts";

// Scene-global names in the client's form (config/scene_global.dat); no game data.
const set = (s: string, dir: string, ...g: string[]) => g.map(x => `Environment/Custom/${s}/${dir}/${x}`);
const TUNNEL = (dir: string) => [...set("Clockwork Tunnels", dir, "Light Set", "Fog", "Music Mix"), "Environment/Shadow Color"];
const DEN = (dir: string) => [...set("Wolver's Den", dir, "Light Set", "Fog"), "Environment/Custom/Wolver's Den/Music Mix"];
const KEEP = ["Environment/Background Color", "Environment/Fog", "Environment/Music", "Camera"];
const LIBRARY = new Set([...["Default", "Fire", "Freeze", "Poison", "Shock", "Spooky"].flatMap(TUNNEL), ...set("Clockwork Tunnels", "Fiendish", "Light Set", "Fog"),
  ...["Default", "Fire", "Freeze", "Poison", "Shock"].flatMap(DEN), "Environment/Custom/Universal/Freeze/Vision Snow"]);
const has = (n: string) => LIBRARY.has(n);

test("captures sort by the status after their area, or vanilla", () => {
  assert.deepEqual(classifyCapture("dd knight camp fire whipping mishandling"), { style: "drudgery", family: null, element: "Fire" });
  assert.deepEqual(classifyCapture("dd office party vanilla"), { style: "drudgery", family: null, element: null });
  assert.deepEqual(classifyCapture("lichenous lair alien ooze"), { style: "lair", family: null, element: null });
  assert.deepEqual(classifyCapture("wolver den freeze"), { style: "den", family: null, element: "Freeze" });
  assert.equal(classifyCapture("graveyard"), null);
  assert.equal(classifyCapture("dark city devilish drudgery 2"), null);
});

test("rooms fit a style and status by their tiles", () => {
  assert.ok(roomFits("tunnels", "Fire", ["Clockworks Fire/Floor/A", "Traps and Hazards/Spikes", "Null, no-walk no-shoot/X"]));
  assert.ok(!roomFits("tunnels", "Fire", ["Clockworks/Floor/A"]));
  assert.ok(!roomFits("tunnels", null, ["Clockworks Freeze/Floor/A"]));
  // a compound room on a mission's tunnel floor
  assert.ok(!roomFits("tunnels", null, ["Clockworks/Floor/A", "Sky Islands, Winter/Grass"]));
  // the other styles' tiles are the same in every status
  for (const s of [null, "Fire", "Shock"] as const) assert.ok(roomFits("keep", s, ["Castle/Wall"]));
  assert.ok(!roomFits("den", "Fire", ["Sky Islands, Autumn/Grass"]));
  // a floor has rooms of its style when some of its tiles are the style's
  assert.ok(floorHasRooms("tunnels", null, ["Clockworks/Floor/A", "Clockworks Shock/Floor/B"]));
  assert.ok(!floorHasRooms("tunnels", null, ["Clockworks Freeze/Floor/A", "Sky Islands, Winter/Grass"]));
});

test("a floor's environment is its style's own for its status and family variant", () => {
  assert.equal(envDir("tunnels", null, "Undead"), "Spooky");
  assert.equal(envDir("tunnels", null, "Fiend"), "Fiendish");
  assert.equal(envDir("tunnels", "Fire", "Undead"), "Fire");
  assert.equal(envDir("den", null, "Beast"), "Default");
  assert.ok(envFits("tunnels", null, "Beast", TUNNEL("Default")));
  assert.ok(!envFits("tunnels", null, "Undead", TUNNEL("Default")));
  assert.ok(envFits("tunnels", null, "Undead", TUNNEL("Spooky")));
  assert.ok(!envFits("tunnels", "Fire", null, TUNNEL("Default")));
  // a mission's own environment, or another style's
  assert.ok(!envFits("tunnels", null, null, ["Environment/Custom/Compound Wilds/Freeze/Light Set"]));
  assert.ok(!envFits("drudgery", "Freeze", null, ["Environment/Custom/Missions/Prestige/Heart of Ice/Light Set"]));
  assert.ok(envFits("keep", "Shock", null, KEEP));
  assert.ok(!envFits("keep", null, null, TUNNEL("Default")));
});

test("an environment re-themed from the client's library", () => {
  const out = rethemeEnv("den", [...DEN("Freeze"), "Environment/Custom/Universal/Freeze/Vision Snow", "Environment/Shadow Color"],
    { status: "Poison", family: null }, has)!;
  assert.deepEqual(out, [...DEN("Poison"), null, "Environment/Shadow Color"]);
  // a global the status lacks falls back to the set's Default one; the Fiendish set has no music
  const f = rethemeEnv("tunnels", TUNNEL("Default"), { status: null, family: "Fiend" }, has)!;
  assert.deepEqual(f, [...set("Clockwork Tunnels", "Fiendish", "Light Set", "Fog"), ...set("Clockwork Tunnels", "Default", "Music Mix"), "Environment/Shadow Color"]);
  // the Keep's environment is not named per status
  assert.equal(rethemeEnv("keep", KEEP, { status: "Fire", family: null }, has), null);
});

test("the generator's environment: a capture's own, else derived, else none", () => {
  const g = (names: string[]) => names.map(name => ({ $class: "GlobalEntry", sceneGlobal: { name } }));
  const cands = [
    { id: "3", name: "wolver den fire x", element: "Fire" as const, family: null, globals: g(DEN("Fire")) },
    { id: "2", name: "wolver den vanilla", element: null, family: null, globals: g(DEN("Default")) },
  ];
  const own = environmentFor("den", "Fire", "Beast", cands, has)!;
  assert.equal(own.derived, false);
  assert.equal(own.source, "wolver den fire x");
  const d = environmentFor("den", "Poison", "Beast", envOrder("Poison", cands), has)!;
  assert.equal(d.derived, true);
  assert.equal(d.source, "wolver den vanilla");
  assert.deepEqual(d.globals.map(x => x.sceneGlobal.name), DEN("Poison"));
  assert.equal(environmentFor("keep", "Fire", null, [{ id: "1", name: "candlestick keep vanilla", element: null, family: null, globals: g(KEEP) }], has), null);
  // the status's own plain level first, newest first
  assert.deepEqual(envOrder(null, [{ id: "1", name: "ct beast", element: null }, { id: "5", name: "ct beast x y", element: null },
    { id: "9", name: "bf beast", element: "Fire" }, { id: "4", name: "ct slime", element: null }]).map(c => c.id), ["4", "1", "5", "9"]);
});

test("coverage per (type x status): captured, derived, missing", () => {
  const facts = new Map<string, CaptureFacts>([
    ["ct beast", { tiles: ["Clockworks/Floor"], globals: TUNNEL("Default") }],
    ["ct undead", { tiles: ["Clockworks/Floor"], globals: TUNNEL("Spooky") }],
    ["ct fiend some mission", { tiles: ["Clockworks/Floor"], globals: ["Environment/Custom/Devilish Drudgery/Default/Light Set"] }],
    ["cc construct some mission", { tiles: ["Sky Islands, Winter/Grass"], globals: ["Environment/Custom/Compound Wilds/Freeze/Light Set"] }],
    ["wolver den vanilla", { tiles: ["Sky Islands, Day/Grass"], globals: DEN("Default") }],
    ["candlestick keep shock some mission", { tiles: ["Castle/Wall"], globals: KEEP }],
  ]);
  const src = coverageSources([...facts.keys(), "ct beast"], facts);
  assert.equal(src.length, 6);
  const rows = prefabCoverage(src);
  const row = (style: string, status: any) => rows.find(r => r.type.style === style && r.status === status)!;
  assert.equal(row("tunnels", null).state, "captured");
  // tunnel rooms of another status do not serve: their tiles are the status's
  assert.equal(row("tunnels", "Fire").state, "missing");
  // a compound-laid mission floor gives freeze tunnels neither rooms nor environment
  assert.equal(row("tunnels", "Freeze").state, "missing");
  assert.equal(row("den", null).state, "captured");
  assert.equal(row("den", "Poison").state, "derived");
  assert.equal(row("keep", "Shock").state, "captured");
  // the Keep's environment cannot be derived
  assert.equal(row("keep", "Fire").state, "missing");
  assert.equal(row("lair", null).state, "missing");
  // the vanilla tunnels' family variants: the Haunted Passage's environment is captured, the
  // Infernal Passage's (Fiendish) is in no capture: a mission floor's other environment does not count
  assert.equal(levelCoverage(row("tunnels", null), "Undead", src), "captured");
  assert.equal(levelCoverage(row("tunnels", null), "Fiend", src), "derived");
  assert.equal(levelCoverage(row("tunnels", null), "Beast", src), "captured");
  assert.equal(levelCoverage(row("tunnels", "Fire"), "Beast", src), "missing");
  // by name alone a mission floor's environment is assumed (and said so)
  const byName = coverageRow(prefabType("keep")!, "Shock", coverageSources(["candlestick keep shock some mission"]));
  assert.equal(byName.state, "captured");
  assert.match(byName.note, /assumed/);
});

test("the checklist: named prefab levels are generated from their covered pair", () => {
  const lv = (name: string, key: string, prefab?: Level["prefab"]): Level => ({ group: "clockworks", set: "Synth", name, where: "-", pattern: keys(key), availability: "regular", prefab });
  const SYNTH = [
    lv("Wild", "ct_beast", { style: "tunnels", element: null, family: "Beast" }),
    lv("Slimy", "ct_slime", { style: "tunnels", element: null, family: "Slime" }),
    lv("Infernal", "ct_fiend", { style: "tunnels", element: null, family: "Fiend" }),
    lv("Hot Slimy", "bf_slime", { style: "tunnels", element: "Fire", family: "Slime" }),
    lv("Den Poison", "wolver_den_poison", { style: "den", element: "Poison", family: "Beast" }),
    lv("Fixed", "foo_vale_bar"),
  ];
  const c = checklist(["ct beast", "wolver den fire hot mission", "foo vale bar"], () => true, SYNTH);
  const g = c.groups.find(x => x.group === "clockworks")!;
  assert.deepEqual(g.have.map(l => l.name), ["Wild", "Fixed"]);
  assert.deepEqual(g.derived.map(l => l.name), ["Slimy", "Infernal", "Den Poison"]);
  assert.deepEqual(g.missing.map(l => l.name), ["Hot Slimy"]);
  assert.equal(c.have + c.derived + c.missing, c.total);
  assert.match(c.how.get(SYNTH[1])!, /^generated from the rooms of 1 captured floor$/);
  assert.match(c.how.get(SYNTH[2])!, /^derived: .*Fiendish/);
  assert.match(c.how.get(SYNTH[4])!, /^derived: environment from the client's "Wolver's Den\/Poison"/);
  assert.equal(c.generated.get(SYNTH[1])?.state, "captured");
  assert.equal(c.coverage.length, 30);
});

test("assembly tries a few seeds, and other statuses' rooms only where they are shared", () => {
  let calls = 0;
  const none = assembleFloor([], () => { calls++; return []; }, 1, false);
  assert.equal(none, null);
  assert.equal(calls, 0);
  assert.equal(assembleFloor([], () => { calls++; return []; }, 1, true), null);
  assert.equal(calls, 1);
});
