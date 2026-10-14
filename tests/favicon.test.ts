import assert from "node:assert/strict";
import { test } from "node:test";
import { gateFloors, makeGate, type Gate } from "../src/game/clockworks.ts";
import { bossIcon, bossStageIcon, floorMapLevel, gateEmblem, specialIcon } from "../src/game/gatemap.ts";
import { lairRun } from "../src/game/missions.ts";
import { choosePlace, fitRect, iconKey, type IconSpec } from "../src/ui/favicon.ts";

const file = (i: IconSpec) => (i.kind === "image" ? i.file : i.kind);

test("the log-on, knight select, prologue and creation show the game's app icon", () => {
  assert.deepEqual(choosePlace({ screen: "title" }), { title: "Spiral Knights", icon: { kind: "logo" } });
  assert.equal(choosePlace({ screen: "pick" }).title, "Spiral Knights – Knight Select");
  assert.equal(choosePlace({ screen: "prologue" }).icon.kind, "logo");
  const c = choosePlace({ sceneId: "rsrc:world/createknight/scene.dat", sceneName: "createknight" });
  assert.equal(c.title, "Spiral Knights – Create a Knight");
  assert.equal(c.icon.kind, "logo");
});

test("towns: Haven's map icon in its colours, the Arcade's lobby, the Bazaar, the Ready Room, the guild's emblem", () => {
  const haven = choosePlace({ sceneId: "1", sceneName: "haven town square", town: true });
  assert.equal(haven.title, "Spiral Knights – Haven");
  assert.deepEqual(haven.icon, { kind: "image", ...specialIcon("town", "haven") });
  assert.equal(file(choosePlace({ sceneName: "haven arcade", town: true }).icon), "ui/icon/map/lobby.png");
  assert.equal(file(choosePlace({ sceneName: "haven bazaar", town: true }).icon), "ui/icon/market_32.png");
  assert.equal(choosePlace({ sceneName: "rescue camp central", town: true }).title, "Spiral Knights – Rescue Camp");
  assert.equal(file(choosePlace({ sceneId: "rsrc:world/readyroom/scene.dat", sceneName: "readyroom", town: true }).icon), "ui/icon/social/readyroom.png");
  const hall = choosePlace({ sceneId: "guild:hall", sceneName: "hall", town: true, guild: { name: "Lumen", symbol: "lion", color: "#2f6fde" } });
  assert.equal(hall.title, "Spiral Knights – Lumen Guild Hall");
  assert.deepEqual(hall.icon, { kind: "guild", symbol: "lion", color: "#2f6fde" });
  assert.equal(file(choosePlace({ sceneId: "guild:hall", sceneName: "hall", town: true }).icon), "ui/icon/social/guild.png");
});

test("a gate's floors show their gate map icon, its lobby the gate's emblem", () => {
  const g = makeGate(4242, 0, 2);
  const floors = gateFloors(g);
  const lobby = choosePlace({ gate: g, floor: floors[0], depth: 0 });
  assert.equal(lobby.title, `Spiral Knights – ${g.name}`);
  assert.equal(file(lobby.icon), `ui/adventureboard/gate_icons/icon_${g.emblem}.png`);
  const f = floors.find(x => x.kind === "level")!;
  const p = choosePlace({ gate: g, floor: f, depth: f.depth });
  assert.equal(p.title, `Spiral Knights – Depth ${f.depth}: ${f.name}`);
  const l = floorMapLevel(f);
  assert.deepEqual(p.icon, { kind: "image", file: `ui/icon/map/${l.icon}.png`, colorizations: l.colorizations });
  assert.equal(file(choosePlace({ gate: g, floor: floors[4], depth: 4 }).icon), "ui/icon/map/terminal.png");
  assert.equal(file(choosePlace({ gate: g, floor: floors[8], depth: 8 }).icon), "ui/icon/map/town.png");
  // the Core: the terminal icon the gate map gives it (gatemap.ts fixedLevel), titled without a depth
  const core = choosePlace({ gate: g, floor: floors[29], depth: 29 });
  assert.equal(file(core.icon), "ui/icon/map/terminal.png");
  assert.equal(core.title, `Spiral Knights – ${floors[29].name}`);
  for (const b of floors.filter(x => x.kind === "boss")) assert.equal(file(choosePlace({ gate: g, floor: b, depth: b.depth }).icon), "ui/icon/map/boss.png");
});

test("a real gate's lobby shows its emblem in the gate's colours", () => {
  const g: Gate = { ...makeGate(7), real: { entry: { date: "20260101", colour: "coral", symbol: "king" }, name: "Coral King", themes: [], wheels: [] } };
  const p = choosePlace({ gate: g, floor: gateFloors(makeGate(7))[0], depth: 0 });
  assert.deepEqual(p.icon, { kind: "image", ...gateEmblem("coral", "king") });
});

test("missions show their card, boss floors and Shadow Lairs the boss's icons, a town in a run stays a town", () => {
  const g: Gate = { ...makeGate(1), id: "mission:crossing", name: "Crossing the Chasm" };
  const f = { ...gateFloors(makeGate(1))[2], name: "The Chasm" };
  const card = "ui/mission/images/cards/images/awolver2_clockwork.png";
  const m = choosePlace({ gate: g, floor: f, depth: 2, missionCard: card });
  assert.equal(m.title, "Spiral Knights – Crossing the Chasm · The Chasm");
  assert.deepEqual(m.icon, { kind: "image", file: card, crop: "card" });
  assert.equal(choosePlace({ gate: g, floor: null, missionCard: card }).title, "Spiral Knights – Crossing the Chasm");
  const lair = lairRun("snarbolax");
  const floors = lair.floors.filter(Boolean);
  const first = choosePlace({ gate: lair.gate, floor: floors[0], depth: 26 });
  assert.deepEqual(first.icon, { kind: "image", ...bossStageIcon("snarbolax") });
  const boss = floors.find(x => x.kind === "boss");
  if (boss) assert.deepEqual(choosePlace({ gate: lair.gate, floor: boss, depth: 26 }).icon, { kind: "image", ...bossIcon("snarbolax") });
  // the Rescue Camp, reached from a gate, is a town
  assert.equal(choosePlace({ gate: makeGate(3), floor: gateFloors(makeGate(3))[5], sceneName: "rescue camp central", town: true }).title, "Spiral Knights – Rescue Camp");
});

test("icons letterbox into the square, mission cards crop a square, keys differ by colours", () => {
  assert.deepEqual(fitRect(128, 128, 32), { sx: 0, sy: 0, sw: 128, sh: 128, dx: 0, dy: 0, dw: 32, dh: 32 });
  const r = fitRect(32, 40, 32);
  assert.deepEqual([r.dx, r.dy, r.dw, r.dh], [3, 0, 26, 32]);
  const c = fitRect(240, 340, 32, "card");
  assert.deepEqual([c.sw, c.sh, c.dw, c.dh], [240, 240, 32, 32]);
  assert.ok(c.sy > 0 && c.sy + c.sh <= 340);
  assert.notEqual(iconKey({ kind: "image", ...specialIcon("town", "haven") }), iconKey({ kind: "image", ...specialIcon("town", "brown") }));
});
