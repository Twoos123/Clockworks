import assert from "node:assert/strict";
import { test } from "node:test";
import { activeGates, decodeLevel, displayOrder, ELEVATOR_UNKNOWN, elevatorScreen, withScreen, expandLines, gateOpens, lockNext, nextLevel, parseGateFile, parseGateList, predictedPath, readGate, type GateFile } from "../src/game/gatemap.ts";

// a made-up gate in the site's format (no real gate data is kept in the repository)
const LINES = [
  "r, tunnel beast freeze, arena beast x", "aurora jly, aurora jly2", "rand, den fire",
  "l, csk x, tunnel undead x", "compound gremlin freeze slime", "dd fire",
  "s_rjp", "concrete bb",
  "tunnel slime x", "lichen x", "decon shock", "tunnel gremlin x",
  "r, tunnel fiend x, dd x", "arena fiend fire", "tunnel construct poison", "jigsaw ax, jigsaw ax2",
  "s_fsc",
];
const T0 = 1791849600000;
const rot = (n: number, velocity: number) => ({ n, data: { velocity, num_entries: n, lengths: Array(n).fill(6.2831855 / n), start: T0 } });
const file: GateFile = { levels: LINES, themes: ["Beast", "Undead", "Slime", "Gremlin", "Fiend", "Fire"],
  rotations: Array.from({ length: 30 }, (_, d) => d === 1 ? rot(2, 0.0034906587) : d === 2 ? rot(2, -0.0034906587) : d === 3 ? { n: 3, data: null } : rot(1, 0)) };
const entry = { date: "20261013", colour: "coral", symbol: "king" };

test("level lines expand to one depth each, with directions alternating and keywords spelled out", () => {
  const l = expandLines(LINES);
  assert.equal(l.length, 23);
  assert.deepEqual(l.slice(0, 3).map(x => x.dir), ["r", "l", "?"]);
  assert.deepEqual(l[2].codes, ["graveyard", "den fire", "tv"]);
  assert.deepEqual(l.slice(6, 9).map(x => x.codes[0]), ["rjp d1", "rjp d2", "jk"]);
  assert.deepEqual(l.slice(18).map(x => x.codes[0]), ["fsc d1", "fsc d2", "fsc d3", "fsc d4", "vana"]);
});

test("level codes decode to the game's level keys, icons and colours", () => {
  const t = decodeLevel("tunnel beast freeze")!;
  assert.equal(t.key, "m.cc_beast");
  assert.equal(t.icon, "clockwork");
  // the glyph in the beast colour (class 2), the field in the freeze colour (class 3)
  assert.deepEqual(t.colorizations.map(c => [c.clazz, c.offsets.hue]), [[2, 0.277], [3, 0.567]]);
  assert.equal(decodeLevel("compound gremlin freeze slime")!.key, "m.fc_slime_minis");
  assert.equal(decodeLevel("csk x")!.key, "m.candlestick_keep_vanilla");
  assert.equal(decodeLevel("scarlet gg")!.key, "m.scarlet_fortress_grim_gallery");
  assert.equal(decodeLevel("jk")!.boss, "jelly");
  assert.equal(decodeLevel("arena slime shock")!.key, "m.tfa_slime");
  assert.equal(decodeLevel("nonsense"), null);
});

test("a gate reads into thirty wheels with the fixed floors in place", () => {
  const g = readGate(entry, file);
  assert.equal(g.name, "Coral King");
  assert.equal(g.wheels.length, 30);
  assert.equal(g.wheels[0].options[0].kind, "lobby");
  assert.equal(g.wheels[8].options[0].key, "m.moorcroft");
  assert.equal(g.wheels[29].options[0].kind, "core");
  assert.equal(g.wheels[3].random, true);
  assert.equal(g.wheels[11].options[0].boss, "jelly");
  assert.equal(g.wheels[28].options[0].boss, "vanaduke");
});

test("the next level follows the two wheels' rotation and changes on time", () => {
  const g = readGate(entry, file);
  const a = nextLevel(g, 1, 0, T0)!;
  assert.ok(a.seconds > 0 && a.seconds < 1800);
  // just past the change the other level is next
  const b = nextLevel(g, 1, 0, T0 + (a.seconds + 1) * 1000)!;
  assert.notEqual(b.wedge, a.wedge);
  // a randomised depth is not foretold, and a lock picks one of its levels
  assert.equal(nextLevel(g, 2, 0, T0), null);
  const w = lockNext(g, 2, 0, T0, () => 0.7);
  assert.equal(w, 2);
  const path = predictedPath(g, 0, 0, T0);
  assert.equal(path.length, 30);
  assert.equal(path[3], -1);
  assert.equal(path[4], 0);
  assert.equal(displayOrder(g.wheels[1], T0).length, 2);
});

test("an exit elevator's screen shows the level it leads to, turning with the wheels", () => {
  const g = readGate(entry, file);
  const at = (depth: number, t: number, more: { dissolve?: boolean } = {}) =>
    elevatorScreen({ real: g, depth, wedge: 0, next: null, dissolve: !!more.dissolve, t });
  // the lobby's elevator: depth 1's level now, then the other once the wheels have turned
  const a = nextLevel(g, 0, 0, T0)!;
  const s1 = at(0, T0), s2 = at(0, T0 + (a.seconds + 1) * 1000);
  assert.equal(s1.file, `ui/icon/map/${g.wheels[1].options[a.wedge].icon}.png`);
  assert.equal(s1.colorizations, g.wheels[1].options[a.wedge].colorizations);
  assert.equal(s2.colorizations, g.wheels[1].options[1 - a.wedge].colorizations);
  // a randomised depth is "?"; the Core's terminal and the Haven elevators lead home
  assert.equal(at(2, T0), ELEVATOR_UNKNOWN);
  assert.equal(at(7, T0).file, "ui/icon/map/town.png");
  assert.equal(at(29, T0).file, "ui/icon/map/town.png");
  assert.equal(at(5, T0, { dissolve: true }).file, "ui/icon/map/town.png");
  // a gate without wheels: the run's next floor as the map shows it
  assert.equal(elevatorScreen({ real: null, depth: 3, wedge: 0, next: null, dissolve: false, t: T0 }).file, "ui/icon/map/town.png");
  // the model reference takes the screen as its arguments, the others kept
  const ref = withScreen({ name: "m.dat", arguments: { $map: "x", entries: [["Icon", "a.png"], ["Other", 1]] } }, s1);
  assert.deepEqual(ref.arguments.entries.map((e: [string, unknown]) => e[0]), ["Other", "Colorizations", "Icon"]);
  assert.equal(ref.arguments.entries[2][1], s1.file);
});

test("the list's newest four opened gates are the active ones", () => {
  const list = parseGateList(JSON.stringify([["20261007", "diamond", "bishop"], ["20261009", "dark", "serpent"], ["20261011", "sapphire", "queen"],
    ["20261013", "coral", "king"], ["20261015", "jade", "pawn"]]));
  // the 20261013 gate opens at 22:00 Chicago time (03:00 UTC) on the 13th
  assert.equal(new Date(gateOpens(list[3])).toISOString(), "2026-10-13T03:00:00.000Z");
  assert.deepEqual(activeGates(list, Date.UTC(2026, 9, 13, 12)).map(e => e.symbol), ["king", "queen", "serpent", "bishop"]);
  assert.equal(parseGateFile("nope"), null);
  assert.deepEqual(parseGateFile('##JSON\n{"levels":["jk"]}')?.levels, ["jk"]);
});
