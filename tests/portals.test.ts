import assert from "node:assert/strict";
import { test } from "node:test";
import { arrivalPoint, exitsOf, exitTarget, placeKey, sceneForPlace } from "../src/game/portals.ts";
import { cachedHallId } from "../src/game/places.ts";
import type { LogicEntry } from "../src/scene.ts";

const scenes = [{ id: "1", name: "haven town square" }, { id: "2", name: "haven bazaar" }, { id: "23389", name: "hall (The Exceeds)" }];
const entry = (name: string, x: number, y: number, rotation: number, tags: string[], handlers: any[] = []): LogicEntry =>
  ({ id: 0, name, x, y, rotation, shape: null, tags, handlers });

test("a scene move to an archived scene walks there, to the exit's portal", () => {
  const t = exitTarget({ tags: ["to_bazaar_east"], sceneId: 2, portal: "from_town_square_west", area: "Portals/Portal" }, scenes);
  assert.deepEqual(t, { kind: "scene", id: "2", portal: "from_town_square_west" });
});

test("without an archived Arcade its gate board stands in; other places the archive lacks are not available", () => {
  assert.deepEqual(exitTarget({ tags: ["to_arcade_central"], sceneId: 3, portal: "from_town_square_north" }, scenes), { kind: "arcade" });
  assert.deepEqual(exitTarget({ tags: ["to_garrison_west"], sceneId: 445, portal: "from_town_square_east" }, scenes),
    { kind: "missing", place: "%town:m.border_eastside" });
  assert.deepEqual(exitTarget({ tags: [], sceneId: NaN, portal: "from_your_guildhall", townName: "haven", sceneInternalId: "haven_eastside", area: "Portals/Town Portal" }, scenes),
    { kind: "missing", place: "%town:m.border_eastside" });
  assert.deepEqual(exitTarget({ tags: [], sceneId: NaN, portal: "", area: "Portals/To Advanced Training" }, scenes),
    { kind: "missing", place: "%town:m.border_training_hall" });
  assert.equal(placeKey({ tags: [], sceneId: NaN, portal: "", area: "Portals/To Guild Training" }), "%guild:m.border_training_hall");
});

test("an archived scene not yet named is still walked into; an archived Arcade is walked into, not the board", () => {
  const ids = new Set(["3", "445"]);
  assert.deepEqual(exitTarget({ tags: ["to_garrison_west"], sceneId: 445, portal: "from_town_square_east" }, scenes, ids),
    { kind: "scene", id: "445", portal: "from_town_square_east" });
  assert.deepEqual(exitTarget({ tags: ["to_arcade_central"], sceneId: 3, portal: "from_town_square_north" }, scenes, ids),
    { kind: "scene", id: "3", portal: "from_town_square_north" });
});

test("a town move finds its scene by internal name: the live scene of several, else the newest", () => {
  const list = [...scenes, { id: "435", name: "haven eastside" }, { id: "445", name: "haven eastside" }, { id: "137", name: "old place" }, { id: "900", name: "old place" }];
  assert.deepEqual(exitTarget({ tags: [], sceneId: NaN, portal: "p", townName: "haven", sceneInternalId: "haven_bazaar" }, list), { kind: "scene", id: "2", portal: "p" });
  // 435 is Haven's 2012 Garrison (its exits lead to 134 and 136); the town's exits name 445
  assert.equal(sceneForPlace("haven_eastside", list), "445");
  assert.equal(sceneForPlace("haven_eastside", list.filter(s => s.id !== "445")), "435");
  assert.equal(sceneForPlace("%town:m.old_place", list), "900");
  assert.equal(sceneForPlace("nowhere", list), null);
  // a town move naming only the town: the scene holding the portal's door
  assert.deepEqual(exitTarget({ tags: [], sceneId: NaN, portal: "from_town_square_north", townName: "haven", area: "Portals/Town Portal" }, [...list, { id: "3", name: "haven arcade" }]),
    { kind: "scene", id: "3", portal: "from_town_square_north" });
});

test("the doors whose actions the data strips lead to their places", () => {
  const list = [...scenes, { id: "445", name: "haven eastside" }, { id: "294", name: "advanced training" }, { id: "83", name: "advanced training" },
    { id: "449", name: "hall of heroes star0" }, { id: "25132", name: "haven laboratory" }, { id: "437", name: "haven laboratory" },
    { id: "446", name: "guild training" }, { id: "447", name: "guild training t2" }, { id: "448", name: "guild training t3" }];
  const at = (area: string, more = {}) => exitTarget({ tags: [], sceneId: NaN, portal: "", area, ...more }, list);
  assert.deepEqual(at("Portals/To Advanced Training"), { kind: "scene", id: "294", portal: "" });
  assert.deepEqual(at("Portals/To Laboratory"), { kind: "scene", id: "25132", portal: "" });
  assert.deepEqual(at("Portals/To Hall of Heroes"), { kind: "scene", id: "449", portal: "" });
  assert.deepEqual(at("Portals/Guild List"), { kind: "guildhall", portal: "" });
  assert.deepEqual(at("Portals/To Guild Training", { floor: 0 }), { kind: "scene", id: "446", portal: "" });
  assert.deepEqual(at("Portals/To Guild Training", { floor: 2, portal: "from_tier_1" }), { kind: "scene", id: "448", portal: "from_tier_1" });
  assert.deepEqual(at("Portals/To Guildhall", { action: "MoveToGuildhall", portal: "from_guild_training" }), { kind: "guildhall", portal: "from_guild_training" });
  // the training hall's way out: the town square's training hall door; a Hall of Heroes level's: the Garrison's
  assert.deepEqual(at("Portals/Leave Party", { action: "LeaveParty" }), { kind: "scene", id: "1", portal: "from_advanced_training" });
  assert.deepEqual(exitTarget({ tags: [], sceneId: NaN, portal: "", area: "Portals/Leave Party", action: "LeaveParty" }, list, new Set(), "hall of heroes star1"),
    { kind: "scene", id: "445", portal: "from_hoh" });
});

test("a scene's exits are read as the logic engine reads them", () => {
  const start = "com.threerings.tudey.config.HandlerConfig$IntersectionStart";
  const logic = [
    entry("Portals/Portal", 0, 0, 0, ["to_bazaar_east"], [{ $class: start, action: { portal: { tag: "from_town_square_west" }, sceneId: 2 } },
      { $class: "com.threerings.projectx.config.ProjectXHandlerConfig$MinimapIcon" }]),
    entry("Portals/To Advanced Training", 1, 1, 0, [], [{ $class: start }]),
    entry("Portals/Leave Party", 2, 2, 0, [], [{ $class: start, action: { $class: "com.threerings.tudey.config.ActionConfig$Compound",
      actions: [{ $class: "com.threerings.projectx.dungeon.config.DungeonActionConfig$LeaveParty" }] } }]),
    entry("Portals/To Guild Training", 3, 3, 0, [], [{ $class: start, action: { floor: 0 } }]),
    entry("Portals/Town Portal", 4, 4, 0, [], [{ $class: start, action: { portal: { tag: "from_lab" }, sceneInternalId: "haven_eastside", townName: "haven" } }]),
    entry("Dynamic/Portal/Destination", 5, 5, 0, ["from_bazaar_east"]),
  ];
  assert.deepEqual(exitsOf(logic).map(e => e.info), [
    { tags: ["to_bazaar_east"], sceneId: 2, portal: "from_town_square_west", area: "Portals/Portal" },
    { tags: [], sceneId: NaN, portal: "", area: "Portals/To Advanced Training" },
    { tags: [], sceneId: NaN, portal: "", area: "Portals/Leave Party", action: "LeaveParty" },
    { tags: [], sceneId: NaN, portal: "", area: "Portals/To Guild Training", floor: 0 },
    { tags: [], sceneId: NaN, portal: "from_lab", area: "Portals/Town Portal", townName: "haven", sceneInternalId: "haven_eastside" },
  ]);
});

test("the guild hall is a guild's hall, never the Hall of Heroes", () => {
  assert.equal(cachedHallId([{ id: "178", name: "hall of heroes star1" }, { id: "450", name: "hall (Casually Addicted)" }]), "450");
  assert.equal(cachedHallId([{ id: "449", name: "hall of heroes star0" }]), null);
});

test("the knight arrives at the destination with the portal's tag, else the default entrance", () => {
  const logic = [
    entry("Dynamic/Portal/Level Start", 1, -30.5, Math.PI / 2, ["(Destination Tag)"]),
    entry("Dynamic/Portal/Destination", -30.5, 0.5, 0, ["from_bazaar_east"]),
    entry("Portals/Portal", -38, 0.5, 0, ["to_bazaar_east"]),
  ];
  assert.deepEqual(arrivalPoint(logic, "from_bazaar_east"), { x: -30.5, y: 0.5, heading: 0 });
  assert.deepEqual(arrivalPoint(logic, "nowhere"), { x: 1, y: -30.5, heading: Math.PI / 2 });
  assert.deepEqual(arrivalPoint(logic, ""), { x: 1, y: -30.5, heading: Math.PI / 2 });
  assert.equal(arrivalPoint([], "x"), null);
});

// ---- Haven's real exit map, from the player's level archive (tools/exits.ts)

const { archivePresent, exitMap } = await import("../tools/exits.ts");
const ARCHIVE = archivePresent();
const map = ARCHIVE ? exitMap(["1", "446", "447", "448", "178"]) : null;

/** Whether a point lies in a polygon. */
function inside(pts: [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

test("every exit of Haven and the places past its doors leads to an archived scene and a door there (skipped without the archive)", { skip: !ARCHIVE }, async () => {
  const { rows } = await map!;
  const from = new Set(rows.map(r => r.from));
  for (const id of ["1", "2", "3", "445", "294", "449", "25132", "446", "447", "448"]) assert.ok(from.has(id), `scene ${id} is reached and its exits listed`);
  assert.ok(rows.length >= 25, `${rows.length} exits`);
  for (const r of rows) {
    const what = `${r.from} ${r.fromName}: ${r.area} ${JSON.stringify(r.info)}`;
    assert.ok(r.to, `${what} leads to an archived scene (${r.kind})`);
    assert.ok(r.arrival, `${what} has an arrival point in ${r.to}`);
    // a door the exit names is in its scene (the guild training hall's way back names the
    // hall's training door, which only halls with a training room have)
    if (r.info.action !== "MoveToGuildhall") assert.ok(r.arrival!.exact, `${what}: ${r.to} has the door ${r.arrival!.tag}`);
  }
  const to = (from: string, area: RegExp) => rows.filter(r => r.from === from && area.test(r.area)).map(r => `${r.to}@${r.arrival?.tag}`);
  // the districts, by scene id; the doors with stripped actions, to their places
  assert.deepEqual(to("1", /^Portals\/Portal$/).sort(), ["2@from_town_square_west", "3@from_town_square_north", "445@from_town_square_east"]);
  assert.deepEqual(to("1", /Advanced Training/), ["294@"]);
  assert.deepEqual(to("445", /Laboratory/), ["25132@"]);
  assert.deepEqual(to("445", /Hall of Heroes/), ["449@"]);
  assert.deepEqual(to("294", /Leave Party/), ["1@from_advanced_training"]);
  assert.deepEqual(to("25132", /Town Portal/), ["445@from_lab"]);
  assert.deepEqual(to("449", /Town Portal/), ["445@from_hoh"]);
  assert.deepEqual(to("178", /Leave Party/), ["445@from_hoh"]);
  assert.deepEqual(to("446", /To Guild Training/).sort(), ["447@from_tier_1", "448@from_tier_1"]);
});

test("each exit's way back arrives at the door beside it, facing away from it (skipped without the archive)", { skip: !ARCHIVE }, async () => {
  const { rows, scenes } = await map!;
  for (const r of rows) {
    if (!r.to || r.kind === "guildhall") continue;
    // the training floors' tiers lead on rather than back; the old guild hall is not Haven's
    const back = rows.filter(b => b.from === r.to && b.to === r.from);
    const both = ["1", "2", "3", "445", "294", "449", "25132"];
    if (both.includes(r.from) && both.includes(r.to)) assert.ok(back.length, `${r.from} ${r.area} -> ${r.to} has a way back`);
    if (!back.length) continue;
    const exitArea = scenes.get(r.from)!.logic.find(e => e.name === r.area && e.x === r.at[0] && e.y === r.at[1])!;
    // of the ways back, the one that lands nearest this exit
    const best = back.map(b => ({ b, d: Math.hypot(b.arrival!.x - r.at[0], b.arrival!.y - r.at[1]) })).sort((a, b) => a.d - b.d)[0];
    const what = `${r.from} ${r.area} ${r.info.tags.join("|")} -> ${r.to}, back by ${best.b.area} ${best.b.info.tags.join("|")}`;
    assert.ok(best.d < 20, `${what} arrives ${best.d.toFixed(1)} from the exit`);
    const a = best.b.arrival!;
    if (exitArea.shape?.k === "poly") assert.ok(!inside(exitArea.shape.pts, a.x, a.y), `${what} arrives outside the exit`);
    // facing out: away from the exit just walked out of
    const dot = Math.cos(a.heading) * (a.x - r.at[0]) + Math.sin(a.heading) * (a.y - r.at[1]);
    assert.ok(dot > 0, `${what} arrives facing away from the exit`);
  }
});
