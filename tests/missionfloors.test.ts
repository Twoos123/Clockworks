import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { importBinary } from "../src/export/BinaryImport.ts";
import { matchLevels } from "../src/game/levels.ts";
import { floorStyle, LAIR_DEPTH, LAIR_GATES, lairFloors, MISSION_FLOORS, missionPlan } from "../src/game/missionfloors.ts";
import { lairRun, missionRun, parseMissions } from "../src/game/missions.ts";
import { nodeInflate, skDir } from "../tools/common.ts";

const names = (id: string) => missionPlan(id)!.floors.map(f => f.name);
const keys = (id: string) => missionPlan(id)!.floors.map(f => f.keys[0]);

test("mission floor lists follow the wiki's order", () => {
  assert.deepEqual(names("alien_ooze"), ["Slimeway", "Field Research Site"]);
  assert.deepEqual(names("shadow_beast"), ["Terrilous Trail", "Roarsterous Ruins", "Lair of the Snarbolax"]);
  assert.deepEqual(names("spark_roar"), ["The Cold March", "The Iron Tundra", "The Bitter Battle", "Hidden Hideout"]);
  assert.deepEqual(names("king_of_ashes"), ["Blackstone Bridge", "Charred Court", "Ashen Armory", "Smoldering Steps", "Throne Room", "The Path is Sealed"]);
  assert.deepEqual(names("dreams_and_nightmares"), ["The Path is Revealed", "A Step Beyond", "A Step Beyond", "Descent into Darkness", "Refuge"]);
  assert.deepEqual(names("operation_crimson_hammer_2"), ["Storming the Walls", "Silence the Guns", "Flank the Frontlines", "Clear the Gatehouse", "Engines of War", "Aftermath"]);
  // prestige missions by their id with or without the rank bracket
  assert.deepEqual(names("p_toxic_plant_r6"), ["Outer Facility", "Containment", "Fire Safe Storage"]);
  assert.equal(missionPlan("p_toxic_plant_r9"), MISSION_FLOORS.p_toxic_plant);
  assert.equal(missionPlan("no_such_mission"), null);
});

test("mission floors carry their scene keys", () => {
  assert.deepEqual(keys("alien_ooze"), ["ct_slime", "lichenous_lair_alien_ooze"]);
  assert.deepEqual(keys("axes_of_evil"), ["jigsaw_valley_emerald_axis_axesofevil", "jigsaw_valley_the_jade_tangle_axesofevil"]);
  assert.deepEqual(keys("p_heart_of_ice"), ["dd_freeze_heart_of_ice", "heart_of_ice_1", "heart_of_ice_treasure_vault"]);
  assert.deepEqual(keys("king_of_ashes").slice(-2), ["firestorm_citadel_vanaduke", "terminal_core_mission"]);
  assert.deepEqual(missionPlan("beyond_axes_of_evil")!.floors[2].keys,
    ["jigsaw_valley_perimeter_promenade_beyondaxesofevil", "jigsaw_valley_perimeter_promenade_2_beyondaxesofevil"]);
  // the boss is on the Throne Room, not the floor after it
  assert.deepEqual(missionPlan("king_of_ashes")!.floors.map(f => f.boss ?? null), [null, null, null, null, "vanaduke", null]);
});

test("every mission floor key is a level of the checklist (src/game/levels.ts)", () => {
  for (const [id, plan] of Object.entries(MISSION_FLOORS))
    for (const f of plan.floors) for (const k of f.keys) assert.ok(matchLevels(`%dungeon:m.${k}`).length > 0 || matchLevels(k).length > 0, `${id}: ${f.name} (${k})`);
  for (const b of Object.values(LAIR_GATES))
    for (const f of lairFloors(b)) for (const k of f.keys) assert.ok(matchLevels(k).length > 0, `${b}: ${k}`);
});

test("a floor's key names the style, monsters and status generated in its place", () => {
  assert.deepEqual(floorStyle("ct_slime"), { style: "tunnels", family: "Slime", element: null, boss: null });
  assert.deepEqual(floorStyle("bf_slime_oilers_in_boilers"), { style: "tunnels", family: "Slime", element: "Fire", boss: null });
  assert.deepEqual(floorStyle("bp_ww_gremlin_sewer_stash"), { style: "tunnels", family: "Gremlin", element: "Poison", boss: null });
  assert.deepEqual(floorStyle("tfa_slime_vicious_viscous"), { style: "arena", family: "Slime", element: "Shock", boss: null });
  assert.equal(floorStyle("wolver_den_freeze_frostifur_fandango").style, "den");
  assert.equal(floorStyle("wolver_den_freeze_frostifur_fandango").element, "Freeze");
  assert.equal(floorStyle("ck_freeze_owlite_tome").style, "keep");
  assert.equal(floorStyle("dd_office_party_vanilla").style, "drudgery");
  assert.equal(floorStyle("lost_castle_cravat_hall_3_occuranceatowlitekeep").style, "fortress");
  assert.equal(floorStyle("royal_jelly_lair_ultimate").boss, "jelly");
  assert.equal(floorStyle("firestorm_citadel_ash_armory").boss, "vanaduke");
});

test("a mission run plays its floors in order from its depth, one depth each", () => {
  const m = { id: "in_cold_blood", title: "In Cold Blood", path: "Rank/07/7.2/In Cold Blood", cls: "Rank", kind: "dungeon", rank: 7, subrank: 2,
    cardImage: "ui/mission/images/cards/images/chromalisk3_clocksky.png", setting: null } as any;
  const { gate, floors } = missionRun(m);
  const list = floors.filter(Boolean);
  assert.equal(gate.id, "mission:in_cold_blood");
  assert.equal(gate.lobby, undefined);
  assert.deepEqual(list.map(f => [f.depth, f.mission!.keys[0], f.tier]),
    [[19, "ct_beast_in_cold_blood", 3], [20, "cc_slime_in_cold_blood", 3], [21, "starlight_cradle_the_chroma_gardens", 3]]);
  assert.equal(list[1].tileset, "clockworks-freeze");
  assert.deepEqual(list.map(f => f.kind), ["level", "level", "level"]);
});

test("a Shadow Lair: the _ultimate stages, the Unknown Passage and the Sanctuary, at Logical Floor 26", () => {
  const { gate, floors } = lairRun("snarbolax");
  const list = floors.filter(Boolean);
  assert.equal(gate.id, "lair:snarbolax");
  assert.equal(gate.lobby, null);
  assert.deepEqual(list.map(f => f.mission!.keys[0]), ["gloaming_wildwoods_path_ultimate", "gloaming_wildwoods_ruins_ultimate",
    "gloaming_wildwoods_snarbolax_ultimate", "ultimate_swarm_trap", "sleeper_sanctuary"]);
  assert.deepEqual(list.map(f => f.kind), ["level", "level", "boss", "level", "level"]);
  assert.equal(list[2].mission!.ultimate, true);
  assert.equal(list[2].stratum!.boss, "snarbolax");
  for (const f of list) { assert.equal(f.scaleDepth, LAIR_DEPTH); assert.equal(f.tier, 3); }
  // Battle Royale has an alternative Shadow Lair layout
  assert.deepEqual(lairRun("jelly").floors.filter(Boolean)[2].mission!.keys, ["royal_jelly_lair_ultimate", "royal_jelly_lair_ultimate_alt"]);
  assert.equal(lairRun("vanaduke").floors.filter(Boolean).length, 7);
  assert.deepEqual(Object.values(LAIR_GATES).sort(), ["jelly", "snarbolax", "twins", "vanaduke"]);
});

const MISSIONS = join(skDir(), "rsrc", "config", "mission.dat");
test("every deployed dungeon mission in the install has its floors (skipped without the install)", { skip: !existsSync(MISSIONS) }, async () => {
  const load = async (f: string) => {
    const r: any = await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", "config", f))), nodeInflate);
    return (Array.isArray(r.root) ? r.root : r.root.array) as any[];
  };
  const ms = parseMissions(await load("mission.dat"), new Map((await load("mission_property.dat")).map(c => [c.name, c])));
  const missing = ms.filter(m => m.kind === "dungeon" && !missionPlan(m.id)).map(m => m.id);
  assert.deepEqual(missing, []);
  // every plan is a mission of the install's data
  const ids = new Set(ms.map(m => m.id.replace(/_r\d+$/, "")));
  for (const id of Object.keys(MISSION_FLOORS)) assert.ok(ids.has(id) || ms.some(m => m.id === id), id);
});
