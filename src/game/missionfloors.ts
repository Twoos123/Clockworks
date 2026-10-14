// Each mission's own floors, in order: names and scene keys only.
//
// Sources: the public wiki's mission lists (wiki.spiralknights.com "List of rank missions",
// "List of prestige missions", the danger mission and event pages, read 2026-10-14) for the
// floors in order and the depths of the rank missions' floors; the install's config/mission.dat
// for the mission ids (the floors themselves are server data, which the client never reads);
// the install's dungeon bundle and the player's archive for the scene keys, matched as in
// src/game/levels.ts and docs/research/levels.md. A floor that is an ordinary arcade level (the
// Slimeway before Alien Ooze's Field Research Site) carries that level's arcade key.
//
// The Shadow Lairs are not missions in the data: the depth-23 Clockwork Terminal's Shadow Lair
// elevators (Dynamic/Elevator/Shadow Lair, one per boss, "Push Gate" sl_wildwoods...) lead to
// them; their floors are the boss stratum's stages in their "_ultimate" versions, then the
// Unknown Passage and the Sanctuary. The terminal places every Shadow Lair elevator with
// "Logical Floor" 26: the depth the lair's floors are scaled at.

import { BOSSES, type BossKey, type Family } from "./clockworks";

/** One floor: its name (the wiki's), its scene keys (alternatives the servers rotate), and the boss it ends with. */
export interface MissionFloorDef { name: string; keys: string[]; boss?: BossKey }

export interface MissionPlan {
  floors: MissionFloorDef[];
  /** The first floor's depth (the wiki's), or null: by the mission's rank (danger and event missions). */
  depth: number | null;
  /** The lobby's scene key: undefined for the shared Mission Lobby, null for none (the mission starts on its first floor). */
  lobby?: string | null;
  /** Fallback monsters for floors whose key names none. */
  family?: Family;
}

const f = (name: string, ...keys: string[]): MissionFloorDef => ({ name, keys });
const boss = (key: BossKey, depth: number, extra: MissionFloorDef[] = []): MissionPlan => ({
  depth, floors: [...stages(key), ...extra],
});
/** A boss stratum's stages by their keys (without "m."), the last its boss's lair. */
export function stages(key: BossKey, ultimate = false): MissionFloorDef[] {
  const names = STAGE_NAMES[key];
  return BOSSES[key].stages.map((k, i, all) => {
    const bare = k.replace(/^m\./, "");
    const keys = ultimate ? [`${bare}_ultimate`, ...(i === all.length - 1 ? [`${bare}_ultimate_alt`] : [])] : [bare];
    return { name: names[i], keys, ...(i === all.length - 1 ? { boss: key } : {}) };
  });
}
const STAGE_NAMES: Record<BossKey, string[]> = {
  snarbolax: ["Terrilous Trail", "Roarsterous Ruins", "Lair of the Snarbolax"],
  jelly: ["Garden of Goo", "Red Carpet Runaround", "Battle Royale"],
  twins: ["Abandoned Assembly", "Warfare Workshop", "The Roarmulus Twins"],
  vanaduke: ["Blackstone Bridge", "Charred Court", "Ashen Armory", "Smoldering Steps", "Throne Room"],
};

/** Mission plans by mission id; prestige missions by their id without the rank bracket ("p_toxic_plant" for p_toxic_plant_r4). */
export const MISSION_FLOORS: Record<string, MissionPlan> = {
  // ---- rank 1 and 2 (the Rescue Camp, Haven's training hall, the sprite missions)
  abandoned_depot: { depth: 1, lobby: "training_lobby", floors: [f("Training Grounds", "training_grounds_1"), f("New Challenges", "training_grounds_2"), f("Powering Up", "training_grounds_3")] },
  ancient_generator: { depth: 1, floors: [f("Restoring Power", "training_grounds_generator")] },
  crossing_chasm: { depth: 1, lobby: "finaltest_lobby", floors: [f("The Journey to Haven", "final_test")] },
  crossing_chasm_b: { depth: 1, lobby: "finaltest_lobby", floors: [f("The Journey to Haven", "final_test")] },
  pumping_up: { depth: 1, lobby: null, floors: [f("Advanced Training Hall", "advanced_training")] },
  mission_sprite_1: { depth: 1, floors: [f("Sunset Steppes", "mission_drakon_1"), f("Frigid Passage", "mission_drakon_2")] },
  mission_sprite_2: { depth: 1, floors: [f("Restless Railroad", "mission_seraphynx_1"), f("End of the Line", "mission_seraphynx_2")] },
  mission_sprite_3: { depth: 1, floors: [f("Creeping Cavern", "mission_maskewraith_1"), f("Emergency Outflow", "mission_maskewraith_2")] },
  the_collector: { depth: 2, floors: [f("Mechanized Mile", "ct_construct"), f("Camp Crimson", "mission_collector")] },
  // ---- rank 3
  alien_ooze: { depth: 2, floors: [f("Slimeway", "ct_slime"), f("Field Research Site", "lichenous_lair_alien_ooze")] },
  toy_soldiers: { depth: 2, floors: [f("Factory Floor", "ct_construct_toy_soldiers"), f("Production Center", "bp_construct_toy_soldiers")] },
  faith_armor: { depth: 4, floors: [f("The Trap Chamber", "trap_chamber")] },
  strength_unity: { depth: 4, floors: [f("Wild Path", "ct_beast"), f("Geo Knight Camp", "geo_knight_camp")] },
  blades_fallen: { depth: 4, floors: [f("Soldier's Graveyard", "soldiers_graveyard")] },
  shadow_beast: boss("snarbolax", 5),
  // ---- rank 4
  new_threat: { depth: 9, lobby: null, floors: [f("The Lab", "haven_laboratory")] },
  oilers_in_boilers: { depth: 9, floors: [f("The Hot Vents", "bf_slime_oilers_in_boilers"), f("Smoldering Slime Source", "lichenous_lair_fire_oilers_in_boilers")] },
  frostifur_fandango: { depth: 9, floors: [f("On the Hunt", "cc_beast_frostifur_fandango"), f("Den of the Snowclaw Pack", "wolver_den_freeze_frostifur_fandango")] },
  rescues_and_recycling: { depth: 9, floors: [f("Supply Yard", "ct_gremlin_rescues_and_recycling"), f("Deconstruction Site", "dz_knight_rescue_vanilla_rescues_and_recycling")] },
  shocking_sentient_sentries: { depth: 9, floors: [f("Patrol Path", "pc_construct_shocking_sentient_sentries"), f("Heavy Weapons Facility", "bp_construct_shocking_sentient_sentries")] },
  // ---- rank 5
  chilled_to_bone: { depth: 11, floors: [f("The Cold Approach", "cc_undead_chilled_to_bone"), f("Candlestick Keep", "candlestick_keep_vanilla_chilled_to_bone")] },
  work_idle_hands: { depth: 11, floors: [f("Tired of Brimstone", "bf_fiend_work_idle_hands"), f("Devilish Drudgery", "dd_office_party_vanilla")] },
  time_enough_at_last: { depth: 11, floors: [f("Inner Court", "lost_castle_spiral_court_2_timeenoughatlast"), f("The Rambling Arcade", "lost_castle_cravat_hall_2_timeenoughatlast"),
    f("Eternal Study", "scarlet_fortress_grim_gallery_eternalstudy")] },
  rise_or_fall: { depth: 11, floors: [f("Storm Rising", "wolver_den_shock_rise_or_fall"), f("Night Falls", "lichenous_lair_shock_rise_or_fall"), f("Showdown", "iea_slime_noexit_rise_or_fall")] },
  sovereign_slime: boss("jelly", 14),
  // ---- rank 6
  axes_of_evil: { depth: 14, floors: [f("Felling Giants", "jigsaw_valley_emerald_axis_axesofevil"), f("Chopping Block", "jigsaw_valley_the_jade_tangle_axesofevil")] },
  plan_of_attack: { depth: 14, floors: [f("Toxic Cavern", "ww_fiend_plan_of_attack"), f("Power Grid", "pc_gremlin_plan_o_attack")] },
  high_temperature_hostages: { depth: 14, floors: [f("Tracking", "wolver_den_fire_high_temperature_hostages"), f("Resistance", "bf_construct_high_temperature_hostages"),
    f("Extraction", "dz_bp_knight_rescue_fire")] },
  whipping_mishandling: { depth: 14, floors: [f("Darkness Above", "candlestick_keep_vanilla_whipping_mishandling"), f("Sol'Fork Skyway", "ct_fiend_whipping_mishandling"),
    f("Sol'Fork Downtown", "dd_knight_camp_fire_whipping_mishandling")] },
  sewer_stash: { depth: 14, floors: [f("Wasteworks Access", "lichenous_lair_poison_sewer_stash"), f("Security Outpost", "ww_construct_sewer_stash"), f("Weapons Cache", "bp_ww_gremlin_sewer_stash")] },
  built_to_destroy: boss("twins", 15),
  // ---- rank 7
  in_cold_blood: { depth: 19, floors: [f("Killer Trail", "ct_beast_in_cold_blood"), f("Ice Cube Alley", "cc_slime_in_cold_blood"), f("Lizard Lounge", "starlight_cradle_the_chroma_gardens")] },
  vicious_viscous: { depth: 19, floors: [f("The Creeping Colony", "lichenous_lair_shock_vicious_viscous"), f("The Hungry Den", "wolver_den_shock_vicious_viscous"),
    f("The Oozing Onslaught", "tfa_slime_vicious_viscous")] },
  beyond_axes_of_evil: { depth: 19, floors: [f("Lumbering Doom", "jigsaw_valley_emerald_axis_2_beyondaxesofevil"), f("Barking Mad", "jigsaw_valley_the_jade_tangle_2_beyondaxesofevil"),
    f("Outpost of Tyranny", "jigsaw_valley_perimeter_promenade_beyondaxesofevil", "jigsaw_valley_perimeter_promenade_2_beyondaxesofevil")] },
  spark_roar: { depth: 19, floors: [f("The Cold March", "ct_construct_spark_roar"), f("The Iron Tundra", "dz_freeze_spark_roar"), f("The Bitter Battle", "ima_construct_spark_roar"),
    f("Hidden Hideout", "spark_roar_finale")] },
  // ---- rank 8
  return_of_ur: { depth: 19, floors: [f("Dimensional Shift", "dark_city_devilish_drudgery_4_returnofur", "dark_city_devilish_drudgery_5_returnofur"),
    f("The Summoning Circle", "dark_city_devilish_drudgery_6_returnofur"), f("Banishment", "dark_city_miniboss_returnofur")] },
  weight_of_darkness: { depth: 19, floors: [f("The Forsaken", "candlestick_keep_poison_weight_of_darkness"), f("Inner Demons", "devilish_drudgery_poison_weight_of_darkness"),
    f("Eternal Struggle", "vfa_undead_weight_of_darkness")] },
  vile_engine: { depth: 20, floors: [f("Forgotten Trail", "ct_beast_vile_engine"), f("Lichen Colony", "lichenous_lair_poison_vile_engine"), f("Processing Plant", "bp_pc_slime_vile_engine")] },
  rotting_metropolis: { depth: 20, floors: [f("Streets of Decay", "concrete_jungle_blight_boulevard_rottingmetropolis", "concrete_jungle_blight_boulevard_2_rottingmetropolis"),
    f("Further Decline", "concrete_jungle_totem_trouble_rottingmetropolis", "concrete_jungle_totem_trouble_2_rottingmetropolis"), f("Citizen Uprising", "concrete_jungle_miniboss_deadsquad")] },
  great_escape: { depth: 20, floors: [f("Prison Approach", "pc_construct_great_escape"), f("The Yard", "bp_cc_gremlin_great_escape"), f("Down the Drain", "ww_undead_great_escape")] },
  // ---- rank 9
  occurance_at_owlite_keep: { depth: 24, floors: [f("The Dead March", "graveyard_occurance_at_owlite_keep"), f("The Hall of Remembrance", "lost_castle_cravat_hall_3_occuranceatowlitekeep"),
    f("The Forgotten Library", "ck_freeze_owlite_tome")] },
  silent_legion: { depth: 24, floors: [f("Poisoned Minds", "ww_fiend_silent_legion"), f("Cold Hearts", "dd_freeze_silent_legion"), f("Cryptic Statuary", "scarlet_fortress_trojan_graveyard")] },
  terminal_meltdown: { depth: 24, floors: [f("Code Yellow", "lichenous_lair_fire_terminal_meltdown"), f("Code Orange", "wolver_den_fire_terminal_meltdown"), f("Red Alert", "bf_slime_fuel_depot")] },
  alone_in_dark: { depth: 24, floors: [f("Pitch Black", "candlestick_keep_shock_alone_in_dark"), f("Out in the Cold", "cc_undead_alone_in_dark"), f("Final Resting Place", "graveyard_alone_in_dark")] },
  the_gauntlet: { depth: 24, floors: [f("Shock and Awe", "devilish_drudgery_shock_the_gauntlet"), f("Reign of Fire", "deconstruction_zone_fire_the_gauntlet"), f("Last Stand", "ba_gauntlet")] },
  king_of_ashes: boss("vanaduke", 24, [f("The Path is Sealed", "terminal_core_mission")]),
  // ---- rank 10
  breaking_in_recruits: { depth: 24, floors: [f("Operation Greenhorn", "breakingin_recruits"), f("The Underworks", "ct_construct_breakingin_recruits"), f("The Overworks", "breakingin_recruits_finale")] },
  crimson_chaos: { depth: 24, floors: [f("Frost Chamber", "cc_construct_crimson_chaos"), f("The Frozen Compound", "compound_freeze_crimson_chaos"), f("Complex 357", "crimson_chaos_compound")] },
  // the wiki's third floor is "A Descent into Darkness": the Unknown Passage's subtitle in the dungeon bundle
  from_below: { depth: 24, floors: [f("Haunted Halls", "candlestick_keep_shock_from_below"), f("Into the Maw", "cc_fiend_frombelow"), f("A Descent into Darkness", "ultimate_swarm_trap")] },
  shadowplay: { depth: 24, floors: [f("Greenstone Bridge", "firestorm_citadel_greenstone_bridge"), f("Overgrown Court", "firestorm_citadel_overgrown_court"), f("Throne Room", "firestorm_citadel_throne_room")] },
  dreams_and_nightmares: { depth: 24, floors: [f("The Path is Revealed", "terminal_core_camefrombelow"), f("A Step Beyond", "core_1"), f("A Step Beyond", "core_1"),
    f("Descent into Darkness", "core_dreamsandnightmares_finale"), f("Refuge", "core_treasure_vault")] },
  // ---- the Hall of Heroes (one level per star, in Haven)
  hall_of_heroes_1: { depth: null, lobby: null, floors: [f("Becoming a Soldier", "hall_of_heroes_star1")] },
  hall_of_heroes_2: { depth: null, lobby: null, floors: [f("The Knight Elite", "hall_of_heroes_star2")] },
  hall_of_heroes_3: { depth: null, lobby: null, floors: [f("The Defenders", "hall_of_heroes_star3")] },
  hall_of_heroes_4: { depth: null, lobby: null, floors: [f("The Champions", "hall_of_heroes_star4")] },
  hall_of_heroes_5: { depth: null, lobby: null, floors: [f("The Vanguard", "hall_of_heroes_star5")] },
  // ---- expansion: one mission per tier; the tiers' depths are ours (the wiki gives none)
  operation_crimson_hammer_1: { depth: 2, floors: crimsonHammer() },
  operation_crimson_hammer_2: { depth: 9, floors: crimsonHammer() },
  operation_crimson_hammer_3: { depth: 19, floors: crimsonHammer() },
  // ---- danger missions (prestige board): three floors after the lobby, depth by rank
  p_legion_almire: { depth: null, family: "Undead", floors: [f("Necropolis Grounds", "graveyard_legion_danger"), f("Inner Sanctum", "legion_almire_necropolis"), f("Cryptic Cache", "legion_almire_treasure_vault")] },
  p_toxic_plant: { depth: null, family: "Slime", floors: [f("Outer Facility", "p_toxic_plant_slime"), f("Containment", "toxic_plant_compound"), f("Fire Safe Storage", "toxic_plant_treasure_vault")] },
  p_heart_of_ice: { depth: null, family: "Beast", floors: [f("Frozen Highway", "dd_freeze_heart_of_ice"), f("Amu-Sol", "heart_of_ice_1"), f("Everfrost Tower", "heart_of_ice_treasure_vault")] },
  p_ghost_machine: { depth: null, family: "Undead", floors: [f("Dry Dock", "deconstruction_zone_ghost_machine"), f("Iron Hulk", "ghost_machine_compound"), f("Cargo Bay", "ghost_machine_treasure_vault")] },
  p_winterfest_danger: { depth: null, lobby: "mission_lobby_grinchlin", family: "Gremlin", floors: [f("Ascent", "mt_grinchlin_ascent"), f("Summit", "mt_grinchlin_summit")] },
  // ---- event missions
  // the Dark Harvest's first floor rotates between a Graveyard, a Candlestick Keep and a Haunted Passage
  p_halloween: { depth: null, family: "Undead", floors: [f("Graveyard", "graveyard_vanilla", "candlestick_keep_vanilla", "ct_undead"), f("Punkin King's Lair", "punkin_king")] },
  p_anniversary: { depth: null, family: "Fiend", floors: [f("Chaos in the Kitchen", "spiral_kitchen")] },
  p_anniversary_shock: { depth: null, family: "Fiend", floors: [f("Moonstone Mixup", "anniversary_gremlin_kitchen")] },
  p_winterfest: { depth: null, family: "Gremlin", floors: [f("Alleys of Emberlight", "winterfest")] },
  p_winterfest2: { depth: null, family: "Gremlin", floors: [f("Silent Emberlight", "winterfest_2")] },
  // the Kataclysmic Confrontation (Moorcroft 1 to 3): arcade levels
  p_moorcroft1: { depth: null, family: "Undead", floors: [f("Haunted Passage", "ct_undead"), f("Where Monsters Fear to Tread", "graveyard_vanilla"), f("Haunted Passage", "ww_undead")] },
  p_moorcroft2: { depth: null, family: "Undead", floors: [f("Haunted Passage", "bf_undead"), f("Where Monsters Fear to Tread", "graveyard_vanilla"), f("Burning Blackout", "candlestick_keep_fire")] },
  p_moorcroft3: { depth: null, family: "Undead", floors: [f("Noxious Night", "candlestick_keep_poison"), f("Cadaverous Clash", "tfa_undead"), f("Haunted Passage", "ct_undead")] },
  // Shroud of the Apocrea, depths 19 to 25: three of its floors rotate among fiend and undead levels the wiki does not name
  p_apocrea: { depth: 19, family: "Undead", floors: [f("Haunted Passage", "ct_undead"), f("The Obsidian Nexus", "dark_halls_lobby"),
    f("Fiend and undead levels", "candlestick_keep_vanilla", "devilish_drudgery_vanilla", "dark_city_devilish_drudgery_4", "dark_city_devilish_drudgery_5"),
    f("Fiend and undead levels", "graveyard_vanilla", "ct_fiend", "lost_castle_cravat_hall"),
    f("Fiend and undead levels", "dark_city_devilish_drudgery_6", "candlestick_keep_fire", "devilish_drudgery_fire", "lost_castle_spiral_court"),
    f("The Grasping Plateau", "spirits_graveyard"), f("Departure", "dark_halls_finale")] },
  p_tortodrone: { depth: null, lobby: "mission_lobby_torto", family: "Construct", floors: [f("Call of the Colossi", "torto_garden")] },
};

function crimsonHammer(): MissionFloorDef[] {
  return [f("Storming the Walls", "cogmaster_castle_1"), f("Silence the Guns", "cogmaster_castle_2"), f("Flank the Frontlines", "cogmaster_castle_3"),
    f("Clear the Gatehouse", "cogmaster_castle_4"), f("Engines of War", "cogmaster_castle_5"), f("Aftermath", "cogmaster_castle_6")];
}

/** A mission's floor plan by its id (prestige ids with or without their "_r4" bracket), or null. */
export function missionPlan(id: string): MissionPlan | null {
  return MISSION_FLOORS[id] ?? MISSION_FLOORS[id.replace(/_r\d+$/, "")] ?? null;
}

// ------------------------------------------------------------------ Shadow Lairs

/** The terminal's Shadow Lair elevators ("Push Gate") and the boss each leads to. */
export const LAIR_GATES: Record<string, BossKey> = { sl_wildwoods: "snarbolax", sl_royaljelly: "jelly", sl_munitions: "twins", sl_firestorm: "vanaduke" };
/** The depth a Shadow Lair's floors are scaled at (the terminal's elevators: "Logical Floor" 26). */
export const LAIR_DEPTH = 26;
/** The Shadow Lair the terminal elevator leads to: the stages "_ultimate", then the Unknown Passage and the Sanctuary. */
export function lairFloors(key: BossKey): MissionFloorDef[] {
  return [...stages(key, true), f("Unknown Passage", "ultimate_swarm_trap"), f("The Sanctuary", "sleeper_sanctuary")];
}

// ------------------------------------------------------------------ styles of the floors

/** A floor's look and monsters, read from its scene key, for a floor generated when the archive lacks its level. */
export interface FloorStyle { style: string; family: Family | null; element: "Fire" | "Freeze" | "Poison" | "Shock" | null; boss: BossKey | null }

const FAM: Record<string, Family> = { beast: "Beast", construct: "Construct", fiend: "Fiend", gremlin: "Gremlin", slime: "Slime", undead: "Undead" };
const AREA: Record<string, FloorStyle["element"]> = { ct: null, bf: "Fire", cc: "Freeze", ww: "Poison", pc: "Shock", iea: null, fla: "Fire", ima: "Freeze", vfa: "Poison", tfa: "Shock" };
const THEME: Record<string, FloorStyle["element"]> = { vanilla: null, fire: "Fire", freeze: "Freeze", poison: "Poison", shock: "Shock" };
const THEMED: [RegExp, string][] = [[/^wolver_den/, "den"], [/^(candlestick_keep|ck)_/, "keep"], [/^lichenous_lair/, "lair"], [/^(devilish_drudgery|dd)_/, "drudgery"],
  [/^(deconstruction_zone|dz)_/, "deconstruction"], [/^graveyard/, "graveyard"]];
const FIXED: [RegExp, string][] = [[/^jigsaw_valley/, "valley"], [/^(lost_castle|scarlet_fortress)/, "fortress"], [/^dark_city/, "darkcity"], [/^concrete_jungle/, "jungle"],
  [/^starlight_cradle/, "cradle"], [/^aurora_isles/, "aurora"], [/compound|_minis\b/, "compound"], [/^dark_halls|^spirits_graveyard/, "halls"], [/^mt_grinchlin|^winterfest/, "frostwood"],
  [/^torto/, "grove"], [/^cogmaster/, "fortress"]];

export function floorStyle(key: string): FloorStyle {
  const famOf = (s: string) => FAM[/(beast|construct|fiend|gremlin|slime|undead)/.exec(s)?.[1] ?? ""] ?? null;
  const bossOf = (Object.keys(BOSSES) as BossKey[]).find(b => BOSSES[b].stages.some(s => key.startsWith(s.replace(/^m\./, "")))) ?? null;
  if (bossOf) return { style: "boss", family: null, element: null, boss: bossOf };
  let m = /^(?:p_)?(?:bp_)?(ct|bf|cc|ww|pc)_(beast|construct|fiend|gremlin|slime|undead)/.exec(key);
  if (m) return { style: "tunnels", family: FAM[m[2]], element: AREA[m[1]], boss: null };
  m = /^bp_(beast|construct|fiend|gremlin|slime|undead)/.exec(key);
  if (m) return { style: "tunnels", family: FAM[m[1]], element: null, boss: null };
  m = /^(iea|fla|ima|vfa|tfa)_(beast|construct|fiend|gremlin|slime|undead)/.exec(key);
  if (m) return { style: "arena", family: FAM[m[2]], element: AREA[m[1]], boss: null };
  for (const [re, style] of THEMED) if (re.test(key)) {
    const t = /_(vanilla|fire|freeze|poison|shock)(?:_|$)/.exec(key)?.[1];
    return { style, family: famOf(key), element: t ? THEME[t] : null, boss: null };
  }
  for (const [re, style] of FIXED) if (re.test(key)) {
    const t = /_(fire|freeze|poison|shock)(?:_|$)/.exec(key)?.[1];
    return { style, family: famOf(key), element: t ? THEME[t] : null, boss: null };
  }
  return { style: "tunnels", family: famOf(key), element: null, boss: null };
}
