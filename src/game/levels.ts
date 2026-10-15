// Every server-side level of Spiral Knights, as a checklist. The official client caches each
// level the servers send it in the install's scenes/ folder; this port plays the levels the
// player has collected that way (server/install.ts keeps them in a private archive). The list
// says where to go in the real game to get each one, and a pattern for the scene's name.
//
// Sources: the public community wiki (wiki.spiralknights.com) for level names and where they
// appear, the install's own config/mission.dat for the current mission ranks, and the install's
// message bundles (rsrc/i18n/dungeon.properties and town.properties), which give each scene key
// its level name. Notes and citations: docs/research/levels.md.
//
// Scene names: a cached scene's name is a message key such as "%dungeon:m.jigsaw_valley_emerald_axis_2"
// or "%town:m.haven_bazaar"; src/scene.ts turns it into "jigsaw valley emerald axis 2". The keys
// are internal names, not the level's English name: an arcade level is "<set>_<level>" or an
// abbreviation ("ct_beast" is the Clockwork Tunnels' Wild Path, "iea_slime" an Iron Edge Arena
// bout), a boss stratum's stage is "<boss>_<stage>" with "_ultimate" for its Shadow Lair copy,
// and a mission floor is usually its arcade level's key with the mission's name appended
// ("jigsaw_valley_emerald_axis_axesofevil"). The patterns below match those keys exactly. The
// few levels whose key is not known keep a guess on the level's English name; `npm run levels`
// lists any cached name that matches nothing.

import { derivedArenas } from "./derive";

export type LevelGroup = "clockworks" | "boss" | "danger" | "missions" | "towns" | "pvp";

export const GROUPS: { id: LevelGroup; title: string }[] = [
  { id: "clockworks", title: "Clockworks levels" },
  { id: "boss", title: "Boss levels" },
  { id: "danger", title: "Danger missions and Shadow Lairs" },
  { id: "missions", title: "Mission levels" },
  { id: "towns", title: "Towns and hubs" },
  { id: "pvp", title: "Coliseum (PvP)" },
];

/**
 * regular: reachable any day; event: only while a seasonal or limited event runs;
 * purchase: needs a bought unlock; removed: gone from the game (or never released), so it can
 * only be had from an old cache; shipped: ships in the install's rsrc/ and needs no caching;
 * unknown: named in the game's text, but where (or whether) the game sends it is not known.
 */
export type Availability = "regular" | "event" | "purchase" | "removed" | "shipped" | "unknown";

export interface Level {
  group: LevelGroup;
  /** The level set, region or mission it belongs to. */
  set: string;
  name: string;
  /** Where and how to reach it in the real game. */
  where: string;
  /** Matched against the scene's display name (lower case, underscores as spaces). */
  pattern: RegExp;
  availability: Availability;
  /** The event, for event levels. */
  event?: string;
  /** For shipped levels: the file under rsrc/. */
  rsrc?: string;
}

// ------------------------------------------------------------------------------ patterns

/** Lower case, underscores as spaces, apostrophes dropped: the form patterns are matched against. */
export function normalizeSceneName(name: string): string {
  return name.toLowerCase().replace(/_/g, " ").replace(/['’]/g, "").replace(/\s+/g, " ").trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Exactly one of these scene keys ("jigsaw_valley_emerald_axis", underscores or spaces). */
export function keys(...k: string[]): RegExp {
  return new RegExp(`^(?:${k.map(x => escape(normalizeSceneName(x))).join("|")})$`);
}

/**
 * A guess for a level whose key is not known: its English name in key form ("purr_terror"),
 * the whole key or (`within`) anywhere in it.
 */
export function guess(name: string, within = false): RegExp {
  const w = normalizeSceneName(name).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "")
    .split(" ").map(escape).join(" ?");
  return new RegExp(within ? w : `^(?:the )?${w}$`);
}

/** Guild halls: thousands of player halls (and their design mode), counted as one line. */
export const GUILD_HALL = /^(?:hall|design) \(.*\)$|^guildhall$/;

/**
 * Scenes that are not game levels: developer, test and demo scenes, and scenes the game's
 * text gives no name (unreleased or leftovers). Counted, not listed as unmatched.
 */
export const NOT_LEVEL = new RegExp("^(?:" + [
  "demo .*", "test .*", "test", "playground", "placeholder level", "lift obj test", "world map .*", "guildhall mockup",
  "mission test", "pseudoplayer test", "sound test", "test room", "castle domination .*", "fast heat",
  "jellycube arena", "haven street mission", "treasure vault end rainbow", "snarbolax fight", "snarbolax pursuit", "wildwoods 2", "%building:~",
].join("|") + ")$");

// ------------------------------------------------------------------------------ data

const L: Level[] = [];
const add = (group: LevelGroup, set: string, name: string, where: string, pattern: RegExp, availability: Availability = "regular", extra: Partial<Level> = {}) =>
  L.push({ group, set, name, where, pattern, availability, ...extra });

// ---- Clockworks level sets (arcade gates, by stratum theme)

const ELEMENTS = ["normal", "fire", "freeze", "poison", "shock"] as const;
/** Status themes as the keys spell them. */
const THEMES = ["vanilla", "fire", "freeze", "poison", "shock"] as const;
const FAMILIES = ["beast", "construct", "fiend", "gremlin", "slime", "undead"] as const;
const FAMILY_NAMES = ["Beast", "Construct", "Fiend", "Gremlin", "Slime", "Undead"];
const theme = (status: string) => status === "no status" ? "no status theme" : `the ${status} theme`;

// Clockwork Tunnels: five status areas, six monster levels in each ("ct_beast", "bf_slime")
const TUNNEL_AREAS: [string, string, string][] = [["Clockwork Tunnels", "ct", "no status"], ["Blast Furnace", "bf", "fire"],
  ["Cooling Chamber", "cc", "freeze"], ["Wasteworks", "ww", "poison"], ["Power Complex", "pc", "shock"]];
const TUNNEL_LEVELS = ["Wild Path", "Mechanized Mile", "Infernal Passage", "Gremlin Grounds", "Slimeway", "Haunted Passage"];
for (const [area, k, status] of TUNNEL_AREAS)
  TUNNEL_LEVELS.forEach((lv, i) => add("clockworks", "Clockwork Tunnels", `${area}: ${lv}`,
    `Arcade gate, any tier: a ${FAMILY_NAMES[i]} stratum with ${theme(status)} (the most common level type)`, keys(`${k}_${FAMILIES[i]}`)));

// Battle Arenas: five status arenas, six monster bouts in each ("iea_beast")
const ARENAS: [string, string, string][] = [["Iron Edge Arena", "iea", "no status"], ["Flame Lash Arena", "fla", "fire"],
  ["Ice Maul Arena", "ima", "freeze"], ["Venom Fang Arena", "vfa", "poison"], ["Thunder Fist Arena", "tfa", "shock"]];
const BOUTS = ["Beastly Brawl", "Robo Rampage", "Fiendish Fray", "Wrench Warfare", "Slimey Showdown", "Cadaverous Clash"];
for (const [arena, k, status] of ARENAS)
  BOUTS.forEach((bout, i) => add("clockworks", "Battle Arena", `${arena}: ${bout}`,
    `Arcade gate, any tier: an arena depth in a ${FAMILY_NAMES[i]} stratum with ${theme(status)}`, keys(`${k}_${FAMILIES[i]}`)));
add("clockworks", "Battle Arena", "Fight for Glory, Fight for Treasure", "A Battle Arena level in the game's text (\"battle_arena_1\"), not on the wiki; probably the arenas' older form",
  keys("battle_arena_1"), "unknown");

// Gremlin Compounds: five themes, three warrens each (tiers 2 and 3), "rc_undead_minis"
const COMPOUNDS: [string, string, string][] = [["Ruined Compound", "rc", "no status"], ["Charred Compound", "cc", "fire"],
  ["Frozen Compound", "fc", "freeze"], ["Blighted Compound", "bc", "poison"], ["Shocked Compound", "sc", "shock"]];
const WARRENS: [string, string][] = [["Chittering Burrows", "undead"], ["Creeping Colony", "slime"], ["Ravenous Warrens", "beast"]];
for (const [c, k, status] of COMPOUNDS)
  for (const [lv, fam] of WARRENS)
    add("clockworks", "Compound", `${c}: ${lv}`, `Arcade gate, tier 2 or 3 only: a Gremlin stratum with ${theme(status)}`, keys(`${k}_${fam}_minis`));

/** A set whose levels are one per status theme ("wolver_den_freeze"). */
function themed(region: string, family: string, levels: string[], tiers: string) {
  const k = region.toLowerCase().replace(/ /g, "_");
  levels.forEach((lv, i) => add("clockworks", region, lv,
    `Arcade gate stratum with ${family} monsters and the ${ELEMENTS[i]} status theme${tiers ? `, ${tiers}` : ""}`, keys(`${k}_${THEMES[i]}`)));
}
themed("Candlestick Keep", "Undead", ["Fear the Dark", "Burning Blackout", "Cold Shadows", "Noxious Night", "Galvanized Gloom"], "tiers 2 and 3");
themed("Deconstruction Zone", "Gremlin", ["Savage Salvaging", "Molten Mayhem", "Cold Storage", "Radioactive Recycling", "Circuit Breakers"], "");
themed("Devilish Drudgery", "Fiend", ["Overtime, Every Time", "Everybody's Fired", "Hiring Freeze", "Toxic Workplace", "Wired for Synergy"], "");
themed("Lichenous Lair", "Slime", ["Prognosis: Symbiosis", "Fiery Fusion", "Cold Fusion", "Toxic Union", "Shocking Synthesis"], "");
themed("Wolver Den", "Beast", ["Pack Brutality", "Ashes to Ash Tails", "Frosty Fury", "Raving Rabids", "High Voltail"], "");

// Treasure Vaults and Graveyards: the randomized ("?") floors
["Obscurity Through Security", "Burn Rate", "Frozen Assets", "Toxic Debt", "Flash Crash"].forEach((lv, i) =>
  add("clockworks", "Treasure Vault", lv, `A randomized depth of an arcade gate (shown as "?" on the gate)${i ? `, ${ELEMENTS[i]} theme` : ""}; ends with the Treasure Mimic`,
    keys(`tvault_${THEMES[i]}`)));
add("clockworks", "Treasure Vault", "Treasure Trove: Fortune Smiles on the Greedy", 'A "Treasure Trove" in the game\'s text ("treasure_vault_1"), not on the wiki; probably the vaults\' older form',
  keys("treasure_vault_1"), "unknown");
add("clockworks", "Graveyard", "Where Monsters Fear to Tread", 'A randomized depth of an arcade gate (shown as "?" on the gate), Undead and curse', keys("graveyard_vanilla"));
for (const t of THEMES.slice(1))
  add("clockworks", "Graveyard", `Graveyard (${t})`, `A ${t} Graveyard in the game's text, named only by its theme and not on the wiki`, keys(`graveyard_${t}`), "unknown");
add("clockworks", "Danger Room", "Danger Room", "An optional gated room inside Clockwork Tunnels (and Starlight Cradle) levels; probably part of its level's scene rather than a scene of its own",
  /danger ?room/);
add("clockworks", "Battlepod", "Battlepod (30 variants)", 'Named "Battlepod" in the game\'s text, one for each tunnel area and monster family ("bp_cc_slime"); not on the wiki, so where it appears is unknown (perhaps the Danger Rooms)',
  new RegExp(`^bp (?:(?:bf|cc|pc|ww) )?(?:${FAMILIES.join("|")})$`), "unknown");

// fixed island, city and castle levels (arcade gates; rotate in pairs or triples at their depth)
const fixed = (region: string, levels: [string, string][], where: string, availability: Availability = "regular") =>
  levels.forEach(([lv, k]) => add("clockworks", region, lv, where, keys(k), availability));
fixed("Jigsaw Valley", [["Emerald Axis", "jigsaw_valley_emerald_axis"], ["Emerald Axis II", "jigsaw_valley_emerald_axis_2"],
  ["Jade Tangle", "jigsaw_valley_the_jade_tangle"], ["Jade Tangle II", "jigsaw_valley_the_jade_tangle_2"],
  ["Perimeter Promenade", "jigsaw_valley_perimeter_promenade"], ["Perimeter Promenade II", "jigsaw_valley_perimeter_promenade_2"]],
  "Arcade gate, Construct or Gremlin stratum (tiers 1 and 2); each level rotates with its II at the same depth");
fixed("Aurora Isles", [["Stone Grove", "aurora_isles_stone_grove"], ["Stone Grove II", "aurora_isles_stone_grove_2"],
  ["The Jelly Farm", "aurora_isles_the_jelly_farm"], ["The Jelly Farm II", "aurora_isles_the_jelly_farm_2"], ["The Low Gardens", "aurora_isles_the_low_gardens"]],
  "Arcade gate only, Beast and Slime strata, mostly tier 1; rotates in groups of four");
add("clockworks", "Aurora Isles", "Sea Petal Pass", "Beta only (the Firefly gate); not in the released game", keys("aurora_isles_sea_petal_pass"), "removed");
fixed("Starlight Cradle", [["Meteor Mile", "starlight_cradle_meteor_mile"], ["Meteor Mile II", "starlight_cradle_meteor_mile_2"],
  ["Meteor Mile III", "starlight_cradle_meteor_mile_3"], ["Shrine of Slumber", "starlight_cradle_shrine_of_slumber"],
  ["Shrine of Slumber II", "starlight_cradle_shrine_of_slumber_2"], ["Shrine of Slumber III", "starlight_cradle_shrine_of_slumber_3"],
  ["Shrine of Slumber IV", "starlight_cradle_shrine_of_slumber_4"]],
  "Arcade gate, Slime stratum with the sleep theme (tiers 2 and 3)");
add("clockworks", "Starlight Cradle", "Torporal Titan", "Arcade gate, Starlight Cradle miniboss depth (the only level at its depth)", keys("starlight_cradle_miniboss"));
fixed("Concrete Jungle", [["Blight Boulevard", "concrete_jungle_blight_boulevard"], ["Blight Boulevard II", "concrete_jungle_blight_boulevard_2"],
  ["Totem Trouble", "concrete_jungle_totem_trouble"], ["Totem Trouble II", "concrete_jungle_totem_trouble_2"]],
  "Arcade gate, Slime and Undead strata with poison, tiers 2 and 3 (not tier 1 since 2011); rotates with its II");
add("clockworks", "Concrete Jungle", "Briar Bone Barrage", "Arcade gate, tier 3 only: Concrete Jungle miniboss depth", keys("concrete_jungle_miniboss"));
add("clockworks", "Concrete Jungle", "Green Street", "A Concrete Jungle level that is not on the wiki's list; it has been cached, so the servers have sent it, but how often is unknown",
  keys("concrete_jungle_green_street"));
add("clockworks", "Concrete Jungle", "Corruption Junction", "A Concrete Jungle level in the game's text, not on the wiki", keys("concrete_jungle_corruption_junction"), "unknown");
// Dark City's levels are keyed as Devilish Drudgery variants: none and 2 to 6
fixed("Dark City", [["Sinful Steps", "dark_city_devilish_drudgery_4"], ["Sinful Steps II", "dark_city_devilish_drudgery_5"],
  ["Plazamonium", "dark_city_devilish_drudgery_6"]], "Arcade gate, Fiend and Undead strata (tiers 2 and 3)");
add("clockworks", "Dark City", "Stygian Steeds", "Arcade gate, tier 3 only: Dark City miniboss depth", keys("dark_city_miniboss"));
fixed("Dark City", [["Ritual Road", "dark_city_devilish_drudgery"], ["Ritual Road II", "dark_city_devilish_drudgery_2"],
  ["Ritual Road III", "dark_city_devilish_drudgery_3"]], "Arcade gate only; the three rotate together");
// the Scarlet Fortress is keyed "lost_castle"
fixed("Scarlet Fortress", [["Cravat Hall", "lost_castle_cravat_hall"], ["Cravat Hall II", "lost_castle_cravat_hall_2"],
  ["Cravat Hall III", "lost_castle_cravat_hall_3"], ["Spiral Court", "lost_castle_spiral_court"], ["Spiral Court II", "lost_castle_spiral_court_2"],
  ["Grim Gallery", "scarlet_fortress_grim_gallery"]],
  "Arcade gate, castle strata (Undead and Fiend); Cravat Halls rotate in threes, Spiral Courts in pairs with Grim Gallery");
fixed("Scarlet Fortress", [["Ascending and Descending", "lost_castle_ascending_and_descending"], ["Unstable Plaza", "lost_castle_unstable_plaza"],
  ["The Rambling Arcade", "lost_castle_the_rambling_arcade"]],
  "Arcade gate, castle strata; not on the wiki's Scarlet Fortress list. Cached, so the servers have sent it, but how often is unknown");
fixed("Silent Metropolis", [["Strip Maul", "silent_metropolis_strip_maul"], ["Strip Maul II", "silent_metropolis_strip_maul_2"],
  ["Strip Maul III", "silent_metropolis_strip_maul_3"]], "A level set in the game's text that is not on the wiki (perhaps never released)", "unknown");

// ---- boss strata (arcade gate's permanent boss feature, a mission, and the Shadow Lair)

// each stage's key; the Shadow Lair's copy is the key with "_ultimate" (below)
const BOSSES: [string, [string, string][], string, string][] = [
  ["Gloaming Wildwoods", [["Terrilous Trail", "gloaming_wildwoods_path"], ["Roarsterous Ruins", "gloaming_wildwoods_ruins"],
    ["Lair of the Snarbolax", "gloaming_wildwoods_snarbolax"]],
  "The arcade gate with the green tree icon, second stratum of tier 1 (depths 5 to 7); or rank mission 3-2 Shadow of the Beast",
  "poison miasma, two Rabid Snarbolaxes"],
  ["Royal Jelly Palace", [["Garden of Goo", "royal_jelly_garden"], ["Red Carpet Runaround", "royal_jelly_court"], ["Battle Royale", "royal_jelly_lair"]],
  "The arcade gate with the pink rook icon, tier 2; or rank mission 5-2 The Sovereign Slime (depths 14 to 16)",
  "frozen over, the Ice Queen"],
  ["Ironclaw Munitions Factory", [["Abandoned Assembly", "ironclaw_munitions_factory_assembly"], ["Warfare Workshop", "ironclaw_munitions_factory_workshop"],
    ["The Roarmulus Twins", "ironclaw_munitions_factory_twins"]],
  "The arcade gate with the rocket icon, tier 2; or rank mission 6-2 Built to Destroy (depths 15 to 17)",
  "fire, the Red Roarmulus Twins"],
  ["Firestorm Citadel", [["Blackstone Bridge", "firestorm_citadel_blackstone_bridge"], ["Charred Court", "firestorm_citadel_charred_court"],
    ["Ashen Armory", "firestorm_citadel_ash_armory"], ["Smoldering Steps", "firestorm_citadel_smoldering_steps"], ["Throne Room", "firestorm_citadel_vanaduke"]],
  "The arcade gate with the brown rook icon, tier 3 (depths 24 to 28); or rank mission 9-3 The King of Ashes",
  "cursed, Darkfire Vanaduke"],
];
// a stage may also come in an "_alt" layout (seen for Battle Royale)
for (const [region, stages, where] of BOSSES)
  for (const [st, k] of stages) add("boss", region, st, where, keys(k, `${k}_alt`));
add("boss", "Firestorm Citadel", "The Path is Sealed", "Rank mission 9-3 The King of Ashes, its last floor (depth 29, after Lord Vanaduke)",
  keys("terminal_core_mission"));

// ---- Shadow Lairs and danger missions

for (const [region, stages, , what] of BOSSES)
  for (const [st, k] of stages)
    add("danger", `Shadow Lair: ${region}`, st, `Shadow Key on the elevator in the depth-23 Clockwork Terminal of any gate that has this boss (${what})`,
      keys(`${k}_ultimate`, `${k}_ultimate_alt`));
add("danger", "Shadow Lair", "Unknown Passage", "After any Shadow Lair's boss: the shared passage to the Sanctuary (its subtitle is A Descent into Darkness)",
  keys("ultimate_swarm_trap"));
add("danger", "Shadow Lair", "The Sanctuary", "After the Unknown Passage of any Shadow Lair (rewards, then Haven)", keys("sleeper_sanctuary"));

const DANGER_WHERE = (m: string) => `Danger mission "${m}" from the prestige mission board (daily rotation, every fourth day), rank 4-1 or higher to host; depth by rank`;
const danger = (m: string, floors: [string, string][], availability: Availability = "regular", extra: Partial<Level> = {}, where = DANGER_WHERE(m)) =>
  floors.forEach(([f, k]) => add("danger", m, f, where, keys(k), availability, extra));
danger("Legion of Almire", [["Necropolis Grounds", "graveyard_legion_danger"], ["Inner Sanctum", "legion_almire_necropolis"],
  ["Cryptic Cache", "legion_almire_treasure_vault"]]);
// "Toxic Plant" in the mission data and the keys
danger("Compound 42", [["Outer Facility", "p_toxic_plant_slime"], ["Containment", "toxic_plant_compound"], ["Fire Safe Storage", "toxic_plant_treasure_vault"]],
  "regular", {}, `${DANGER_WHERE("Compound 42")}. The mission data calls it Toxic Plant`);
danger("Heart of Ice", [["Frozen Highway", "dd_freeze_heart_of_ice"], ["Amu-Sol", "heart_of_ice_1"], ["Everfrost Tower", "heart_of_ice_treasure_vault"]]);
danger("Ghosts in the Machine", [["Dry Dock", "deconstruction_zone_ghost_machine"], ["Iron Hulk", "ghost_machine_compound"],
  ["Cargo Bay", "ghost_machine_treasure_vault"]]);
danger("Grinchlin Assault!", [["Base Camp", "mission_lobby_grinchlin"], ["Ascent", "mt_grinchlin_ascent"], ["Summit", "mt_grinchlin_summit"]],
  "event", { event: "Winterfest" }, "Winterfest danger mission from the prestige board, rank 7-1 or higher (Mount Krampus)");

// ---- mission levels (rank board ranks from the install's config/mission.dat)

const mission = (rank: string, m: string, floors: [string, string | string[]][], availability: Availability = "regular", note = "", extra: Partial<Level> = {}) =>
  floors.forEach(([f, k]) => add("missions", `${rank} ${m}`, f,
    `${availability === "event" ? "Event mission" : availability === "purchase" ? "Expansion mission" : availability === "removed" ? "Old mission" : `Rank mission ${rank}`} "${m}"${note ? `; ${note}` : ""}`,
    keys(...(Array.isArray(k) ? k : [k])), availability, extra));

mission("tutorial", "The Crash Site", [["Waking in a New World", ["tutorial_b", "tutorial_b_1", "tutorial_b_2", "tutorial", "tutorial_test"]]], "regular",
  "a new knight's first level, before the Rescue Camp (\"tutorial\" and \"tutorial_b_1\"/\"_2\" are unnamed variants, probably older)");
mission("1-1", "The Abandoned Depot", [["Party Lobby", "training_lobby"], ["Training Grounds", "training_grounds_1"], ["New Challenges", "training_grounds_2"],
  ["Powering Up", "training_grounds_3"]], "regular", "the Rescue Camp's Training Grounds (its first floor has no name in the game's text)");
mission("1-2", "The Ancient Generator", [["Restoring Power", "training_grounds_generator"]]);
mission("1-2", "Crossing the Chasm", [["Party Lobby", "finaltest_lobby"], ["The Journey to Haven", "final_test"]], "regular", "also 1-4 Crossing the Chasm B");
mission("2-1", "Pumping Up", [["Advanced Training Hall", "advanced_training"]], "regular", "the training hall in Haven, open any time after");
mission("2-2", "Drakon Sprite", [["Sunset Steppes", "mission_drakon_1"], ["Frigid Passage", "mission_drakon_2"]], "regular",
  "the sprite mission once called A Revelation in Flames (pick a Drakon)");
mission("2-2", "Seraphynx Sprite", [["Restless Railroad", "mission_seraphynx_1"], ["End of the Line", "mission_seraphynx_2"]], "regular",
  "the sprite mission once called Angels from Antiquity (pick a Seraphynx)");
mission("2-2", "Maskeraith Sprite", [["Creeping Cavern", "mission_maskewraith_1"], ["Emergency Outflow", "mission_maskewraith_2"]], "regular",
  "the sprite mission once called The Phantom Mask (pick a Maskeraith)");
mission("2-3", "Collector Mission", [["Camp Crimson", "mission_collector"]], "regular", "the wiki's The Collector; its first floor is a Mechanized Mile");
mission("3-1", "Alien Ooze", [["Field Research Site", "lichenous_lair_alien_ooze"]], "regular", "after a Slimeway");
mission("3-1", "Toy Soldiers", [["Factory Floor", "ct_construct_toy_soldiers"], ["Production Center", "bp_construct_toy_soldiers"]]);
mission("3-2", "Faith in Armor", [["The Trap Chamber", "trap_chamber"]]);
mission("3-2", "Strength in Unity", [["Geo Knight Camp", "geo_knight_camp"]], "regular", "after a Wild Path");
mission("3-2", "Blades of the Fallen", [["Soldier's Graveyard", "soldiers_graveyard"]]);
mission("4-2", "Oilers in the Boilers", [["The Hot Vents", "bf_slime_oilers_in_boilers"], ["Smoldering Slime Source", "lichenous_lair_fire_oilers_in_boilers"]]);
mission("4-2", "Frostifur Fandango", [["On the Hunt", "cc_beast_frostifur_fandango"], ["Den of the Snowclaw Pack", "wolver_den_freeze_frostifur_fandango"]]);
mission("4-3", "Rescues and Recycling", [["Supply Yard", "ct_gremlin_rescues_and_recycling"], ["Deconstruction Site", "dz_knight_rescue_vanilla_rescues_and_recycling"]]);
mission("4-3", "Shocking Sentient Sentries", [["Patrol Path", "pc_construct_shocking_sentient_sentries"], ["Heavy Weapons Facility", "bp_construct_shocking_sentient_sentries"]]);
mission("5-1", "Chilled to the Bone", [["The Cold Approach", "cc_undead_chilled_to_bone"], ["Candlestick Keep", "candlestick_keep_vanilla_chilled_to_bone"]]);
mission("5-1", "Work for Idle Hands", [["Tired of Brimstone", "bf_fiend_work_idle_hands"], ["Devilish Drudgery", "dd_office_party_vanilla"]]);
mission("5-2", "Time Enough at Last", [["Inner Court", "lost_castle_spiral_court_2_timeenoughatlast"], ["The Rambling Arcade", "lost_castle_cravat_hall_2_timeenoughatlast"],
  ["Eternal Study", "scarlet_fortress_grim_gallery_eternalstudy"]]);
mission("5-2", "Rise or Fall", [["Storm Rising", "wolver_den_shock_rise_or_fall"], ["Night Falls", "lichenous_lair_shock_rise_or_fall"],
  ["Showdown", "iea_slime_noexit_rise_or_fall"]]);
mission("6-1", "Axes of Evil", [["Felling Giants", "jigsaw_valley_emerald_axis_axesofevil"], ["Chopping Block", "jigsaw_valley_the_jade_tangle_axesofevil"]]);
mission("6-1", "Plan of Attack", [["Toxic Cavern", "ww_fiend_plan_of_attack"], ["Power Grid", "pc_gremlin_plan_o_attack"]]);
mission("6-1", "High Temperature Hostages", [["Tracking", "wolver_den_fire_high_temperature_hostages"], ["Resistance", "bf_construct_high_temperature_hostages"],
  ["Extraction", "dz_bp_knight_rescue_fire"]]);
mission("6-2", "Whipping and Mishandling", [["Darkness Above", "candlestick_keep_vanilla_whipping_mishandling"], ["Sol'Fork Skyway", "ct_fiend_whipping_mishandling"],
  ["Sol'Fork Downtown", "dd_knight_camp_fire_whipping_mishandling"]]);
mission("6-2", "Sewer Stash", [["Wasteworks Access", "lichenous_lair_poison_sewer_stash"], ["Security Outpost", "ww_construct_sewer_stash"],
  ["Weapons Cache", "bp_ww_gremlin_sewer_stash"]]);
mission("7-2", "In Cold Blood", [["Killer Trail", "ct_beast_in_cold_blood"], ["Ice Cube Alley", "cc_slime_in_cold_blood"], ["Lizard Lounge", "starlight_cradle_the_chroma_gardens"]]);
mission("7-2", "Vicious and Viscous", [["The Creeping Colony", "lichenous_lair_shock_vicious_viscous"], ["The Hungry Den", "wolver_den_shock_vicious_viscous"],
  ["The Oozing Onslaught", "tfa_slime_vicious_viscous"]]);
mission("7-3", "Beyond the Axes of Evil", [["Lumbering Doom", "jigsaw_valley_emerald_axis_2_beyondaxesofevil"], ["Barking Mad", "jigsaw_valley_the_jade_tangle_2_beyondaxesofevil"],
  ["Outpost of Tyranny", ["jigsaw_valley_perimeter_promenade_beyondaxesofevil", "jigsaw_valley_perimeter_promenade_2_beyondaxesofevil"]]]);
mission("7-3", "Spark and Roar", [["The Cold March", "ct_construct_spark_roar"], ["The Iron Tundra", "dz_freeze_spark_roar"], ["The Bitter Battle", "ima_construct_spark_roar"],
  ["Hidden Hideout", "spark_roar_finale"]]);
mission("8-1", "The Return of Ur", [["Dimensional Shift", ["dark_city_devilish_drudgery_4_returnofur", "dark_city_devilish_drudgery_5_returnofur"]],
  ["The Summoning Circle", "dark_city_devilish_drudgery_6_returnofur"], ["Banishment", "dark_city_miniboss_returnofur"]]);
mission("8-1", "Weight of Darkness", [["The Forsaken", "candlestick_keep_poison_weight_of_darkness"], ["Inner Demons", "devilish_drudgery_poison_weight_of_darkness"],
  ["Eternal Struggle", "vfa_undead_weight_of_darkness"]]);
mission("8-2", "The Vile Engine", [["Forgotten Trail", "ct_beast_vile_engine"], ["Lichen Colony", "lichenous_lair_poison_vile_engine"], ["Processing Plant", "bp_pc_slime_vile_engine"]]);
mission("8-2", "The Rotting Metropolis", [["Streets of Decay", ["concrete_jungle_blight_boulevard_rottingmetropolis", "concrete_jungle_blight_boulevard_2_rottingmetropolis"]],
  ["Further Decline", ["concrete_jungle_totem_trouble_rottingmetropolis", "concrete_jungle_totem_trouble_2_rottingmetropolis"]],
  ["Citizen Uprising", "concrete_jungle_miniboss_deadsquad"]]);
mission("8-2", "The Great Escape", [["Prison Approach", "pc_construct_great_escape"], ["The Yard", "bp_cc_gremlin_great_escape"], ["Down the Drain", "ww_undead_great_escape"]]);
mission("9-1", "An Occurrence at Owlite Keep", [["The Dead March", "graveyard_occurance_at_owlite_keep"],
  ["The Hall of Remembrance", "lost_castle_cravat_hall_3_occuranceatowlitekeep"], ["The Forgotten Library", "ck_freeze_owlite_tome"]]);
mission("9-1", "The Silent Legion", [["Poisoned Minds", "ww_fiend_silent_legion"], ["Cold Hearts", "dd_freeze_silent_legion"], ["Cryptic Statuary", "scarlet_fortress_trojan_graveyard"]]);
mission("9-2", "Terminal Meltdown", [["Code Yellow", "lichenous_lair_fire_terminal_meltdown"], ["Code Orange", "wolver_den_fire_terminal_meltdown"], ["Red Alert", "bf_slime_fuel_depot"]]);
mission("9-2", "Alone in the Dark", [["Pitch Black", "candlestick_keep_shock_alone_in_dark"], ["Out in the Cold", "cc_undead_alone_in_dark"],
  ["Final Resting Place", "graveyard_alone_in_dark"]]);
mission("9-2", "The Gauntlet", [["Shock and Awe", "devilish_drudgery_shock_the_gauntlet"], ["Reign of Fire", "deconstruction_zone_fire_the_gauntlet"], ["Last Stand", "ba_gauntlet"]]);
mission("10-1", "Breaking in the Recruits", [["Operation Greenhorn", "breakingin_recruits"], ["The Underworks", "ct_construct_breakingin_recruits"],
  ["The Overworks", "breakingin_recruits_finale"]]);
mission("10-1", "Crimson Chaos", [["Frost Chamber", "cc_construct_crimson_chaos"], ["The Frozen Compound", "compound_freeze_crimson_chaos"], ["Complex 357", "crimson_chaos_compound"]]);
mission("10-1", "It Came From Below", [["Haunted Halls", "candlestick_keep_shock_from_below"], ["Into the Maw", "cc_fiend_frombelow"]], "regular",
  "its last floor, A Descent into Darkness, is the Shadow Lairs' Unknown Passage (counted there)");
mission("10-2", "Shadowplay", [["Greenstone Bridge", "firestorm_citadel_greenstone_bridge"], ["Overgrown Court", "firestorm_citadel_overgrown_court"],
  ["Throne Room", "firestorm_citadel_throne_room"]], "regular", "the overgrown Firestorm Citadel");
mission("10-2", "Dreams and Nightmares", [["The Path is Revealed", "terminal_core_camefrombelow"], ["A Step Beyond", "core_1"],
  ["Descent into Darkness", "core_dreamsandnightmares_finale"], ["Refuge", "core_treasure_vault"]], "regular", "the way into the Core (A Step Beyond twice)");
add("missions", "The Core", "Stormchasing", 'A Core level in the game\'s text (keyed like It Came From Below\'s The Path is Revealed), not on the wiki', keys("teminal_core_camefrombelow"), "unknown");

// the Hall of Heroes: the hall itself (star 0) is under towns; one level per star
[["Becoming a Soldier", "4-1"], ["The Knight Elite", "5-2"], ["The Defenders", "6-2"], ["The Champions", "8-2"], ["The Vanguard", "9-4"]].forEach(([f, rank], i) =>
  add("missions", "Hall of Heroes", f, `Rank mission ${rank} in Haven's Hall of Heroes (star ${i + 1}; which star goes with which rank is our reading of their order)`,
    keys(`hall_of_heroes_star${i + 1}`)));

// expansion mission (bought once per account; needs 3-2 The Pioneers), keyed "cogmaster_castle_1" to 6
mission("tiers 1-3", "Operation Crimson Hammer", ["Storming the Walls", "Silence the Guns", "Flank the Frontlines", "Clear the Gatehouse", "Engines of War", "Aftermath"]
  .map((f, i) => [f, `cogmaster_castle_${i + 1}`] as [string, string]),
  "purchase", "bought from the mission board (energy), after rank 3-2 The Pioneers; three tiers");

// event prestige missions
mission("rank 4+", "Shroud of the Apocrea", [["The Obsidian Nexus", "dark_halls_lobby"], ["The Grasping Plateau", "spirits_graveyard"], ["Departure", "dark_halls_finale"]],
  "event", "Shroud of the Apocrea event, depths 19 to 25 (the Nexus is its lobby, Departure its last floor)", { event: "Shroud of the Apocrea" });
mission("rank 3+", "The Dark Harvest", [["Punkin King's Lair", "punkin_king"]], "event", "Dark Harvest Festival (Halloween), once a day", { event: "Dark Harvest" });
mission("rank 3+", "Save Winterfest!", [["Alleys of Emberlight", "winterfest"], ["Silent Emberlight", "winterfest_2"]], "event", "Winterfest; the two alternate by day", { event: "Winterfest" });
mission("rank 3+", "Total Caketastrophe!", [["Chaos in the Kitchen", "spiral_kitchen"]], "event", "Caketastrophe (the anniversary event)", { event: "Anniversary" });
mission("rank 3+", "A Gremlin in Knead", [["Moonstone Mixup", "anniversary_gremlin_kitchen"]], "event", "the anniversary's shock variant", { event: "Anniversary" });
for (const m of ["That Mold and Black Magic", "Bad Luck and Brimstone", "Purr Terror"])
  add("missions", `rank 4+ ${m}`, `${m} (its floors)`, "Kataclysmic Confrontation event mission (Black Kats, given at Moorcroft Manor); floor names and keys not known",
    guess(m, true), "event", { event: "Kataclysmic Confrontation" });
mission("rank 3+", "March of the Tortodrones", [["Ancient Grove", "mission_lobby_torto"], ["Call of the Colossi", "torto_garden"]], "event",
  "the Ancient Grove is its lobby", { event: "March of the Tortodrones" });

// gone from the game: missions the install no longer deploys, and older prestige missions
mission("removed", "Securing the Camp", [["Bombs Away!", "rc_bomb_training"]], "removed",
  "the Rescue Camp's old bomb tutorial; in the install's mission data but not deployed");
for (const m of ["Bazaar Troubles", "Skies Under Cradle", "The Scarlet Fortress"])
  add("missions", `${m}`, `${m} (its floors)`, "In the install's mission data but not deployed (never released, or withdrawn); floor keys not known",
    guess(m), "removed");
// the old named prestige missions: a tunnel level and a themed level each, keyed "p_ct_beast", "p_wd_vanilla" (which
// mission each pair belongs to is our reading of the keys' monster families)
const OLD_PRESTIGE: [string, [string, string[]][]][] = [
  ["Nature of the Beast", [["A Path Less Traveled", ["p_ct_beast"]], ["Howlers Habitat", ["p_wd_vanilla"]]]],
  ["Assault on Machine Shop 13", [["Assembly Floor", ["p_ct_construct"]], ["Munitions Storage", ["p_bp_construct", "p_bp_bf_construct", "p_bp_cc_construct", "p_bp_pc_construct", "p_bp_ww_construct"]]]],
  ["White Collar Captives", [["The Commute", ["p_ct_fiend"]], ["The Office", ["p_dd_vanilla"]]]],
  ["Hazardous Heist", [["Gremlin Grounds", ["p_ct_gremlin"]], ["Construction Site", ["p_dz_vanilla"]]]],
  ["A Pinch of Salt", [["Slimeway", ["p_ct_slime"]], ["Research Site", ["p_ll_vanilla"]]]],
  ["Scared to Death", [["The Iron Courtyard", ["p_ct_undead"]], ["Retchwell Manor", ["p_ck_vanilla"]]]],
];
for (const [m, floors] of OLD_PRESTIGE)
  mission("prestige", m, floors, "removed", "an old daily prestige mission, no longer in the mission data");
mission("prestige", "Teaser Mission", [["Demo Gate", "p_teasermission_1"]], "removed", "a teaser mission's level, no longer in the mission data");

// ---- towns and hubs

const town = (set: string, name: string, where: string, pattern: RegExp, availability: Availability = "regular", extra: Partial<Level> = {}) =>
  add("towns", set, name, where, pattern, availability, extra);
town("Haven", "Town Square", "Haven, the usual arrival point", keys("haven_town_square"));
town("Haven", "Bazaar", "Haven, the west district", keys("haven_bazaar"));
town("Haven", "Arcade", "Haven, the north district (the Clockworks gates)", keys("haven_arcade"));
town("Haven", "Garrison", "Haven, the east district", keys("haven_eastside"));
town("Haven", "Laboratory", "Through the Garrison; the sprite and lab missions (4-2 A New Threat) also use it", keys("haven_laboratory", "choose_your_sprite", "laboratory_visit"));
town("Haven", "Hall of Heroes", "Through the Garrison; the hall itself, before a Hall of Heroes mission's level", keys("hall_of_heroes_star0"));
town("Haven", "Haven (one scene)", "A one-scene Haven filed as a level (\"%dungeon:%town:m.haven\"); when the game sends it is not known",
  keys("haven", "%dungeon:%town:m.haven"), "unknown");
town("Guild Hall", "Guild Training Hall", "A guild hall's training gate (needs a guild); three tiers (\"guild_training\", \"_t2\", \"_t3\")",
  keys("guild_training", "guild_training_t2", "guild_training_t3"));
town("Rescue Camp", "Pod Town", "The camp a new knight reaches after the Crash Site (the tutorial)", keys("rescue_camp_central"));
town("Rescue Camp", "Before Night Falls", "The Rescue Camp during the tutorial, before the attack (a new knight)", keys("rescue_camp_state_1"));
town("Rescue Camp", "Light in the Darkness", "The Rescue Camp during the tutorial, after the attack (a new knight)", keys("rescue_camp_state_2"));
town("Rescue Camp", "Training Grounds", "The Rescue Camp's gate area (a new knight)", keys("rescue_camp_arcade"));
town("Clockworks", "Mission Lobby", "The first floor of every Clockworks mission", keys("mission_lobby"));
town("Clockworks", "Party Lobby", "A gate's party lobby, before its first depth", keys("arcade_lobby", "lobby_general"));
town("Clockworks", "Clockwork Terminal", "Depths 4, 13 and 23 of any arcade gate (one key for all three; the Shadow Lair elevator at 23)", keys("terminal_1"));
town("Clockworks", "Clockwork Terminal: The End of a Journey", "A return-only terminal, where a run that goes no deeper ends", keys("terminal_return"));
town("Clockworks", "Core Terminal", "Depth 29: the end of tier 3 (the Core's elevator back to Haven)", keys("terminal_core"));
town("Clockworks", "The Core: A Work in Progress", "The Core's old placeholder level, before the Core missions", keys("temp_core"), "removed");
town("Clockworks", "Moorcroft Manor", "Subtown at depth 8 (start of tier 2); rank 4-2 to pass the Spiral Warden, or its elevator from Haven", keys("moorcroft"));
town("Clockworks", "Emberlight", "Subtown at depth 18 (start of tier 3); rank 7-1 to pass the Spiral Warden, or its elevator from Haven", keys("emberlight"));
town("Haven", "Ready Room", "Ships with the install (rsrc/world/readyroom)", /^ready ?room$/, "shipped", { rsrc: "world/readyroom/scene.dat" });
town("Haven", "Knight creation", "Ships with the install (rsrc/world/createknight)", /^create ?knight$/, "shipped", { rsrc: "world/createknight/scene.dat" });

// ---- Coliseum (PvP), King Krogmo's

town("Haven", "King Krogmo's Coliseum", "Haven: the Coliseum (Lockdown and Blast Network queues)", keys("pvp", "pvp_lockdown", "pvp_blast_network", "pvp_super_brawl"));
const LOCKDOWN: [string, number][] = [["Forest", 8], ["Reactor", 7], ["Furnace", 11], ["Frostbite", 16], ["Gardens", 18], ["Mines", 20], ["Avenue", 21],
  ["Icebox", 15], ["Pipeline", 14], ["Fortress", 22], ["Necropolis", 10], ["Ruins", 2], ["Facility", 4], ["Ramparts", 12], ["Downtown", 13], ["Stadium", 17]];
for (const [m, n] of LOCKDOWN)
  add("pvp", "Lockdown", m, "Lockdown queue in King Krogmo's Coliseum (200 crowns, random or guild team)", keys(`lock_${String(n).padStart(2, "0")}`));
add("pvp", "Lockdown", "Sanctuary", "A Lockdown map marked beta in the game's text; not in the queues", keys("lock_23"), "removed");
["Gridlock", "Rockets", "Gridlock II", "Rockets II", "Two Tone", "Division", "Stone Cross", "Spikes", "Ring", "Crystals", "Islands", "Backdoor", "Crystals II"]
  .forEach((m, i) => add("pvp", "Blast Network", m, "Blast Network queue in King Krogmo's Coliseum", keys(`castle_blast_${String(i + 1).padStart(2, "0")}`)));
const SUPER_BRAWL: [string, string][] = [["Clover Arena", "castle_arena_01"], ["Twelve Points Arena", "castle_arena_02"], ["Twelve Points Arena 2", "castle_arena_03"],
  ["Linked Arena", "castle_arena_04"], ["Cloudy Archipelago", "super_brawl_archipelago"], ["Whitestone Courtyard", "super_brawl_courtyard"],
  ["Firestone Circle", "super_brawl_firestone_circle"], ["Misty Crescent", "super_brawl_misty_crescent"], ["Old Town", "super_brawl_old_town"]];
for (const [m, k] of SUPER_BRAWL)
  add("pvp", "Super Brawl", m, "Super Brawl, a Coliseum mode in the game's text that is no longer in the queues", keys(k), "removed");

export const LEVELS: readonly Level[] = L;

// ------------------------------------------------------------------------------ matching

/** The levels a cached scene's name (its display name from src/scene.ts) stands for. */
export function matchLevels(sceneName: string, levels: readonly Level[] = LEVELS): Level[] {
  const n = normalizeSceneName(sceneName);
  return levels.filter(l => l.pattern.test(n));
}

/**
 * A group's levels: those collected (cached by the real client), those not collected that this
 * port derives from a collected one (src/game/derive.ts: a Battle Arena re-cast from another),
 * and the rest. A derived level is playable but not the game's own: it is still to be captured.
 */
export interface GroupCount { group: LevelGroup; title: string; have: Level[]; derived: Level[]; missing: Level[] }

export interface Checklist {
  groups: GroupCount[];
  /** Scene names that match no level (and are neither guild halls nor dev scenes). */
  unmatched: string[];
  /** Archived guild halls (one scene per guild), counted as one line. */
  guildHalls: number;
  /** Developer, test and unnamed scenes (NOT_LEVEL). */
  other: number;
  have: number;
  /** Levels not collected but derived from a collected one, and the scene each derives from. */
  derived: number;
  derivedFrom: Map<Level, string>;
  total: number;
}

/**
 * The checklist for a set of cached scene names. Shipped levels count as had when `shipped`
 * says their file is present (by default, always: every install ships them).
 */
export function checklist(sceneNames: Iterable<string>, shipped: (rsrc: string) => boolean = () => true,
  levels: readonly Level[] = LEVELS): Checklist {
  const got = new Set<Level>();
  const unmatched: string[] = [];
  let guildHalls = 0, other = 0;
  const names = [...sceneNames];
  for (const name of names) {
    const m = matchLevels(name, levels);
    for (const l of m) got.add(l);
    if (m.length) continue;
    const n = normalizeSceneName(name);
    if (GUILD_HALL.test(n)) guildHalls++;
    else if (NOT_LEVEL.test(n)) other++;
    else unmatched.push(name);
  }
  for (const l of levels) if (l.rsrc && shipped(l.rsrc)) got.add(l);
  // levels this port derives from a collected one: counted apart, never as collected
  const derivedFrom = new Map<Level, string>();
  for (const [key, from] of derivedArenas(names)) {
    for (const l of matchLevels(key, levels)) if (!got.has(l) && !derivedFrom.has(l)) derivedFrom.set(l, from);
  }
  const groups = GROUPS.map(g => {
    const all = levels.filter(l => l.group === g.id);
    return { group: g.id, title: g.title, have: all.filter(l => got.has(l)), derived: all.filter(l => derivedFrom.has(l)),
      missing: all.filter(l => !got.has(l) && !derivedFrom.has(l)) };
  });
  return { groups, unmatched, guildHalls, other, have: got.size, derived: derivedFrom.size, derivedFrom, total: levels.length };
}
