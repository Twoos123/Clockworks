import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { importBinary } from "../src/export/BinaryImport.ts";
import {
  advanceRank, completeMission, daysUntilActive, exchangeNeeds, freshProgress, intervalDays, missionRun, missionSetting,
  missionStatus, parseMissions, rankDepth, rankFloors, rewardItems, scheduleActive, tierLock, weeklyPrestige,
} from "../src/game/missions.ts";
import { nodeInflate, skDir } from "../tools/common.ts";

const M = "com.threerings.projectx.mission.config.MissionConfig";
const REF = "com.threerings.config.ConfigReference";
const PROD = { $enum: "com.threerings.projectx.util.EnabledServers", name: "PRODUCTION" };
const ref = (name: string, args?: [string, unknown][]) => ({ $class: REF, name, ...(args ? { arguments: { $map: "x", entries: args } } : {}) });
const rankMission = (name: string, id: string, rank: number, subrank: number, extra: any = {}) => ({
  $class: M, name, implementation: { $class: `${M}$Rank`, id, deployment: PROD, rank: { $class: `${M}$RankRestriction`, rank, subrank },
    missionProps: ref("Rank/Rank 1"), ...extra },
});
const props = new Map<string, any>([["Rank/Rank 1", { prestigeLow: 5, prestigeAvg: 10, prestigeHigh: 15, prestigeMax: 20 }],
  ["Prestige/Rank 3, Gate", { prestigeLow: 15, prestigeAvg: 30, prestigeHigh: 45, prestigeMax: 60 }]]);

const library = [
  rankMission("Rank/01/1.1/First Contact", "first_contact", 1, 1, {
    cardImage: "ui/mission/images/cards/images/knight-kora_comlink.png", prestige: { $enum: `${M}$PrestigeType`, name: "LOW" },
    requirement: { $class: `${M}$Conversation`, conversation: { model: ref("character/npc/crew/model_kora.dat", [["Variant", "comlink"]]), conversation: ref("Mission/Rank/First Contact") } },
    rewards: [{ $class: `${M}$Reward`, rewards: ref("Mission/Rank/01/1.1/First Contact (Easy)") }],
  }),
  rankMission("Rank/01/1.1/The Abandoned Depot", "abandoned_depot", 1, 1, { cardImage: "ui/mission/images/cards/images/scuttlebot_clockworks.png" }),
  rankMission("Rank/01/1.2/Crossing the Chasm", "crossing_chasm", 1, 2, { cardImage: "ui/mission/images/cards/images/wolver_clocksky.png" }),
  rankMission("Rank/01/1.2/Research", "research", 1, 2, {
    needMission: { $class: `${M}$MissionRestriction`, missionId: "crossing_chasm" },
    requirement: { $class: `${M}$Exchange`, ingredients: [{ $class: "IngredientConfig$Item", item: ref("Material/Gel Drop"), count: 2 }] },
  }),
  rankMission("Rank/02/2.1/Old", "old", 2, 1, { deployment: { $enum: "x", name: "NONE" } }),
  rankMission("Rank/02/2.1/The Sovereign Slime", "sovereign_slime", 2, 1, { cardImage: "ui/mission/images/cards/images/royaljelly_castle.png" }),
  { $class: M, name: "Prestige/Rank 3/Gate/Beast", implementation: { $class: `${M}$Prestige`, id: "p_gate_beast", deployment: PROD,
    missionProps: ref("Prestige/Rank 3, Gate"),
    restrictions: [{ $class: `${M}$RankRange`, rank: 3, maxRank: 4 },
      { $class: `${M}$Schedule`, schedule: { $class: "projectx.config.ScheduleConfig$FixedDayInterval", refTime: Date.UTC(2012, 0, 1, 8), interval: "6d" } }] } },
  { $class: M, name: "Prestige/Rank 3/Exchange/Material 0", implementation: { $class: `${M}$Prestige`, id: "p_mat", deployment: PROD,
    restrictions: [{ $class: `${M}$RankRange`, rank: 3, maxRank: 4 }],
    requirement: { $class: `${M}$RandomChooseExchange`, choose: [{ recipes: [{ ref: ref("Mission/Mat 0", [["Count", 3]]) }] }] } } },
  { $class: M, name: "Examples/First Mission", implementation: { $class: `${M}$Rank`, id: "first_mission", deployment: PROD } },
];

test("missions are read and classified, dev and undeployed ones left out", () => {
  const ms = parseMissions(library, props);
  const by = new Map(ms.map(m => [m.id, m]));
  assert.ok(!by.has("old") && !by.has("first_mission"));
  assert.equal(by.get("first_contact")!.kind, "conversation");
  assert.equal(by.get("first_contact")!.npcModel, "character/npc/crew/model_kora.dat");
  assert.equal(by.get("first_contact")!.npcVariant, "comlink");
  assert.equal(by.get("first_contact")!.prestige, 5);
  assert.equal(by.get("abandoned_depot")!.kind, "dungeon");
  assert.equal(by.get("research")!.kind, "exchange");
  assert.deepEqual(by.get("research")!.needs, ["crossing_chasm"]);
  assert.deepEqual(by.get("research")!.ingredients, [{ item: "Material/Gel Drop", count: 2 }]);
  const gate = by.get("p_gate_beast")!;
  assert.equal(gate.kind, "gate");
  assert.equal(gate.gateTheme, "Beast");
  assert.equal(gate.prestige, 30);
  assert.deepEqual([gate.rank, gate.maxRank, gate.schedule!.intervalDays], [3, 4, 6]);
  assert.equal(by.get("p_mat")!.kind, "exchange");
  assert.deepEqual(by.get("p_mat")!.choose, [[{ recipe: "Mission/Mat 0", count: 3 }]]);
});

test("a dungeon mission's setting comes from its card image", () => {
  const s = (card: string, rank = 1, path = "Rank/x") => missionSetting({ id: card, cardImage: `ui/mission/images/cards/images/${card}.png`, path, rank, subrank: 1, cls: "Rank" });
  assert.deepEqual([s("scuttlebot_clockworks").family, s("scuttlebot_clockworks").tileset], ["Construct", "clockworks"]);
  assert.deepEqual([s("wolver_clocksky").family, s("wolver_clocksky").tileset], ["Beast", "valley"]);
  assert.deepEqual([s("lichen_nightsky").family, s("lichen_nightsky").tileset], ["Slime", "valley-night"]);
  assert.deepEqual([s("spookat_castle").family, s("spookat_castle").tileset], ["Undead", "castle"]);
  assert.equal(s("mechaknight_decon").tileset, "clockworks-white");
  assert.deepEqual([s("mender2_decon-shk").family, s("mender2_decon-shk").tileset], ["Gremlin", "clockworks-shock"]);
  assert.equal(s("wolver3-fre_cooling").tileset, "clockworks-freeze");
  assert.equal(s("toxigel3_poisonsky").tileset, "clockworks-poison");
  assert.equal(s("oiler2_lava").tileset, "clockworks-fire");
  assert.equal(s("devilites_clockworks").family, "Fiend");
  assert.equal(s("gremcon3_decon").family, "Gremlin");
  assert.deepEqual([s("royaljelly_castle", 5).boss, s("snarbolax_gloamwood", 3).boss, s("imf", 6).boss, s("vanaduke_lava", 9).boss], ["jelly", "snarbolax", "twins", "vanaduke"]);
  assert.equal(s("vanaduke_lava", 9).tileset, "castle-fire");
  assert.deepEqual([rankDepth(1), rankDepth(9), rankDepth(10)], [2, 26, 28]);
  assert.deepEqual([rankFloors(1), rankFloors(5), rankFloors(10)], [2, 3, 4]);
});

test("a dungeon mission runs its own floors in order, at the wiki's depths, ending in its boss", () => {
  const ms = parseMissions(library, props);
  const slime = ms.find(m => m.id === "sovereign_slime")!;
  const { gate, floors } = missionRun(slime);
  const list = floors.filter(Boolean);
  assert.equal(gate.id, "mission:sovereign_slime");
  assert.equal(list.length, slime.setting!.floors);
  assert.deepEqual(list.map(f => f.depth), [14, 15, 16]);
  assert.deepEqual(list.map(f => f.mission!.keys[0]), ["royal_jelly_garden", "royal_jelly_court", "royal_jelly_lair"]);
  assert.deepEqual(list.map(f => f.kind), ["level", "level", "boss"]);
  assert.equal(list[list.length - 1].stratum!.boss, "jelly");
  assert.deepEqual(list.map(f => f.tier), [2, 2, 2]);
  for (const f of list) assert.equal(floors[f.depth], f);
  // the Rescue Camp's mission starts in its own party lobby
  assert.equal(missionRun(ms.find(m => m.id === "abandoned_depot")!).gate.lobby, "training_lobby");
});

test("a mission without a floor list plays generated floors at its rank's depth", () => {
  const m = parseMissions([rankMission("Rank/02/2.1/Unlisted", "unlisted", 2, 1, { cardImage: "ui/mission/images/cards/images/royaljelly_castle.png" })], props)[0];
  const list = missionRun(m).floors.filter(Boolean);
  assert.equal(list.length, m.setting!.floors);
  assert.equal(list[0].depth, rankDepth(2));
  assert.equal(list[list.length - 1].kind, "boss");
  assert.ok(list.every(f => !f.mission));
});

test("rank progression: a subrank's missions complete, the knight ranks up; prerequisites gate missions", () => {
  const ms = parseMissions(library, props);
  const p = freshProgress();
  const get = (id: string) => ms.find(m => m.id === id)!;
  assert.equal(missionStatus(get("crossing_chasm"), p), "locked");
  completeMission(ms, get("first_contact"), p);
  assert.deepEqual([p.rank, p.subrank], [1, 1]);
  completeMission(ms, get("abandoned_depot"), p);
  assert.deepEqual([p.rank, p.subrank], [1, 2]);
  assert.equal(missionStatus(get("crossing_chasm"), p), "available");
  assert.equal(missionStatus(get("research"), p), "locked");
  completeMission(ms, get("crossing_chasm"), p);
  assert.equal(missionStatus(get("research"), p), "available");
  completeMission(ms, get("research"), p);
  assert.deepEqual([p.rank, p.subrank], [2, 1]);
  assert.equal(p.prestige, 5 + 10 * 3);
  assert.equal(advanceRank(ms, p), false);
});

test("tiers need rank 4 and 6", () => {
  const p = freshProgress();
  assert.equal(tierLock(1, p), null);
  assert.match(tierLock(2, p)!, /rank 4/);
  p.rank = 4;
  assert.equal(tierLock(2, p), null);
  assert.match(tierLock(3, p)!, /rank 6/);
  p.rank = 6;
  assert.equal(tierLock(3, p), null);
});

test("prestige schedules: one day in every interval, done once per cycle", () => {
  const ms = parseMissions(library, props);
  const gate = ms.find(m => m.id === "p_gate_beast")!;
  const ref = gate.schedule!.refTime, day = 86400000;
  assert.equal(intervalDays("9d"), 9);
  assert.ok(scheduleActive(gate.schedule!, ref + 6 * day * 100 + 3600000));
  assert.ok(!scheduleActive(gate.schedule!, ref + day));
  assert.equal(daysUntilActive(gate.schedule!, ref + day), 5);
  const p = freshProgress();
  p.rank = 3;
  const today = ref + 6 * day * 50;
  assert.equal(missionStatus(gate, p, today), "available");
  assert.equal(missionStatus(gate, p, today + day), "upcoming");
  assert.ok(weeklyPrestige(ms, p, today + day).includes(gate));
  completeMission(ms, gate, p, today);
  assert.equal(missionStatus(gate, p, today), "complete");
  assert.equal(missionStatus(gate, p, today + 6 * day), "available");
  p.rank = 4;
  assert.equal(missionStatus(gate, p, today + 12 * day), "locked");
});

test("random-choose exchanges draw one ingredient from the recipe with its count", () => {
  const ms = parseMissions(library, props);
  const recipes = new Map([["Mission/Mat 0", { name: "Mission/Mat 0",
    ingredients: [{ item: ref("Material/Red Shard") }, { item: ref("Material/Blue Shard") }],
    parameters: [{ $class: "com.threerings.config.Parameter$Direct", name: "Count", paths: ["ingredients[0].count", "ingredients[1].count"] }] }]]);
  const needs = exchangeNeeds(ms.find(m => m.id === "p_mat")!, recipes, 0);
  assert.equal(needs.length, 1);
  assert.ok(/Shard$/.test(needs[0].item));
  assert.equal(needs[0].count, 3);
});

test("reward previews list a table's items", () => {
  const lib = new Map([["T", { root: { $class: "SpawnTableConfig$CompoundEntry", entries: [
    { $class: "SpawnTableConfig$LockedItemEntry", item: ref("Token/Jelly Token") },
    { $class: "SpawnTableConfig$LockedItemEntry", item: ref("Rarity/Spark of Life"), count: 2 }] } }]]);
  assert.deepEqual(rewardItems("T", lib), [{ item: "Token/Jelly Token", count: 1 }, { item: "Rarity/Spark of Life", count: 2 }]);
});

const MISSIONS = join(skDir(), "rsrc", "config", "mission.dat");
test("the install's missions parse (skipped without the install)", { skip: !existsSync(MISSIONS) }, async () => {
  const load = async (f: string) => {
    const r: any = await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", "config", f))), nodeInflate);
    const list: any[] = Array.isArray(r.root) ? r.root : r.root.array;
    return list;
  };
  const all = await load("mission.dat");
  assert.equal(all.length, 272);
  const ms = parseMissions(all, new Map((await load("mission_property.dat")).map(c => [c.name, c])));
  const rank = ms.filter(m => m.cls === "Rank");
  assert.ok(rank.length >= 95, `${rank.length} rank missions`);
  assert.ok(ms.filter(m => m.cls === "Prestige").length >= 130);
  for (const m of ms) if (m.kind === "dungeon") assert.ok(m.setting && m.setting.floors >= 1 && m.setting.depth >= 1 && m.setting.depth + m.setting.floors <= 30, m.id);
  assert.equal(ms.find(m => m.id === "king_of_ashes")!.setting!.boss, "vanaduke");
  assert.equal(ms.find(m => m.id === "first_contact")!.kind, "conversation");
  // every rank mission can be reached: completing them in rank order walks the knight to rank 10
  const p = freshProgress();
  for (let i = 0; i < 400; i++) {
    const next = rank.find(m => missionStatus(m, p) === "available");
    if (!next) break;
    completeMission(ms, next, p);
  }
  assert.equal(p.rank, 10);
  assert.equal(rank.filter(m => !p.completed.includes(m.id)).length, 0);
});
