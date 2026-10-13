// Every server-side level of Spiral Knights, as a checklist. The official client caches each
// level the servers send it in the install's scenes/ folder; this port plays the levels the
// player has collected that way (server/install.ts keeps them in a private archive). The list
// says where to go in the real game to get each one, and a pattern for the scene's name.
//
// Sources: the public community wiki (wiki.spiralknights.com) for level names and where they
// appear, and the install's own config/mission.dat for the current mission ranks. Notes and
// citations: docs/research/levels.md.
//
// Scene names: a cached scene's name is a message key such as "%dungeon:m.jigsaw_valley_emerald_axis_2"
// or "%town:m.haven_bazaar"; src/scene.ts turns it into "jigsaw valley emerald axis 2". The keys
// seen so far are the region (level set) followed by the level's English name, lower case, with
// numbered variants as digits. Keys of levels not yet seen are guesses on that model: the
// patterns accept the region or mission name as an optional prefix, an optional "the", and
// "2" or "ii" for a numbered variant. `npm run levels` lists any cached name that matches
// nothing, so a wrong guess shows up as soon as the level is cached.

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
 * only be had from an old cache; shipped: ships in the install's rsrc/ and needs no caching.
 */
export type Availability = "regular" | "event" | "purchase" | "removed" | "shipped";

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

const NUMBERS: Record<string, string> = { "1": "(?:1|i)", "2": "(?:2|ii)", "3": "(?:3|iii)", "4": "(?:4|iv)", i: "(?:1|i)", ii: "(?:2|ii)", iii: "(?:3|iii)", iv: "(?:4|iv)" };

/** Lower case words of a name, punctuation dropped. */
export function words(s: string): string[] {
  return s.toLowerCase().replace(/['’]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

/** A name as a regular expression body: optional leading "the", flexible spaces, numbered variants. */
function body(name: string, numbered = true): string {
  let w = words(name);
  if (w[0] === "the") w = w.slice(1);
  const last = w[w.length - 1];
  const hasNumber = last in NUMBERS && w.length > 1;
  const parts = w.map((t, i) => (i === w.length - 1 && hasNumber ? NUMBERS[t] : t));
  // an unnumbered level may be keyed with a trailing 1
  return "(?:the ?)?" + parts.join(" ?") + (!hasNumber && numbered ? "(?: ?(?:1|i))?" : "");
}

/** A level of a region: "<region> ... <level>" at the end of the name, region optional. */
export function inSet(region: string, level: string): RegExp {
  return new RegExp(`(?:^|^.* )(?:${body(region, false)} (?:.* )?)?${body(level)}$`);
}

/** A level that must carry its region: "<region> ... <level>". */
export function inRegion(region: string, level: string): RegExp {
  return new RegExp(`(?:^| )${body(region, false)} (?:.* )?${body(level)}$`);
}

/** A mission floor: the floor's name, alone or after the mission's name. */
export function floorOf(mission: string, floor: string): RegExp {
  return new RegExp(`^(?:${body(mission, false)} )?${body(floor)}$`);
}

/** Lower case, underscores as spaces, apostrophes dropped: the form patterns are matched against. */
export function normalizeSceneName(name: string): string {
  return name.toLowerCase().replace(/_/g, " ").replace(/['’]/g, "").replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------------------------ data

const L: Level[] = [];
const add = (group: LevelGroup, set: string, name: string, where: string, pattern: RegExp, availability: Availability = "regular", extra: Partial<Level> = {}) =>
  L.push({ group, set, name, where, pattern, availability, ...extra });

// ---- Clockworks level sets (arcade gates, by stratum theme)

const ELEMENTS = ["normal", "fire", "freeze", "poison", "shock"] as const;

/** A region whose levels are one per status theme (normal, fire, freeze, poison, shock). */
function themed(region: string, family: string, levels: string[], tiers: string, region2 = true) {
  levels.forEach((lv, i) => add("clockworks", region, lv,
    `Arcade gate stratum with ${family} monsters and the ${ELEMENTS[i]} status theme${tiers ? `, ${tiers}` : ""}`,
    region2 ? inSet(region, lv) : inRegion(region, lv)));
}

// Clockwork Tunnels: five status areas, six monster levels in each
const TUNNEL_AREAS: [string, string][] = [["Clockwork Tunnels", "no status"], ["Blast Furnace", "fire"], ["Cooling Chamber", "freeze"],
  ["Wasteworks", "poison"], ["Power Complex", "shock"]];
const TUNNEL_LEVELS: [string, string][] = [["Wild Path", "Beast"], ["Mechanized Mile", "Construct"], ["Infernal Passage", "Fiend"],
  ["Gremlin Grounds", "Gremlin"], ["Slimeway", "Slime"], ["Haunted Passage", "Undead"]];
for (const [area, status] of TUNNEL_AREAS)
  for (const [lv, family] of TUNNEL_LEVELS)
    add("clockworks", "Clockwork Tunnels", `${area}: ${lv}`,
      `Arcade gate, any tier: a ${family} stratum with ${status === "no status" ? "no status theme" : `the ${status} theme`} (the most common level type)`,
      inRegion(area, lv));

// Battle Arenas: five status arenas, six monster bouts in each
const ARENAS: [string, string][] = [["Iron Edge Arena", "no status"], ["Flame Lash Arena", "fire"], ["Ice Maul Arena", "freeze"],
  ["Venom Fang Arena", "poison"], ["Thunder Fist Arena", "shock"]];
const BOUTS: [string, string][] = [["Beastly Brawl", "Beast"], ["Robo Rampage", "Construct"], ["Fiendish Fray", "Fiend"],
  ["Wrench Warfare", "Gremlin"], ["Slimey Showdown", "Slime"], ["Cadaverous Clash", "Undead"]];
for (const [arena, status] of ARENAS)
  for (const [bout, family] of BOUTS)
    add("clockworks", "Battle Arena", `${arena}: ${bout}`,
      `Arcade gate, any tier: an arena depth in a ${family} stratum with ${status === "no status" ? "no status theme" : `the ${status} theme`}`,
      new RegExp(`(?:^| )${body(arena.replace(/ Arena$/, ""), false)} ?(?:arena )?(?:.* )?${body(bout)}$`));

// Gremlin Compounds: five themes, three warrens each (tiers 2 and 3)
const COMPOUNDS: [string, string][] = [["Ruined Compound", "no status"], ["Charred Compound", "fire"], ["Frozen Compound", "freeze"],
  ["Blighted Compound", "poison"], ["Shocked Compound", "shock"]];
for (const [c, status] of COMPOUNDS)
  for (const lv of ["Chittering Burrows", "Creeping Colony", "Ravenous Warrens"])
    add("clockworks", "Compound", `${c}: ${lv}`,
      `Arcade gate, tier 2 or 3 only: a Gremlin stratum with ${status === "no status" ? "no status theme" : `the ${status} theme`}`,
      inRegion(c, lv));

themed("Candlestick Keep", "Undead", ["Fear the Dark", "Burning Blackout", "Cold Shadows", "Noxious Night", "Galvanized Gloom"], "tiers 2 and 3");
themed("Deconstruction Zone", "Gremlin", ["Savage Salvaging", "Molten Mayhem", "Cold Storage", "Radioactive Recycling", "Circuit Breakers"], "");
themed("Devilish Drudgery", "Fiend", ["Overtime, Every Time", "Everybody's Fired", "Hiring Freeze", "Toxic Workplace", "Wired for Synergy"], "");
themed("Lichenous Lair", "Slime", ["Prognosis: Symbiosis", "Fiery Fusion", "Cold Fusion", "Toxic Union", "Shocking Synthesis"], "");
themed("Wolver Den", "Beast", ["Pack Brutality", "Ashes to Ash Tails", "Frosty Fury", "Raving Rabids", "High Voltail"], "");

// Treasure Vaults and Graveyards: the randomized ("?") floors
["Obscurity Through Security", "Burn Rate", "Frozen Assets", "Toxic Debt", "Flash Crash"].forEach((lv, i) =>
  add("clockworks", "Treasure Vault", lv, `A randomized depth of an arcade gate (shown as "?" on the gate)${i ? `, ${ELEMENTS[i]} theme` : ""}; ends with the Treasure Mimic`,
    inSet("Treasure Vault", lv)));
add("clockworks", "Graveyard", "Where Monsters Fear to Tread", 'A randomized depth of an arcade gate (shown as "?" on the gate), Undead and curse', inSet("Graveyard", "Where Monsters Fear to Tread"));
add("clockworks", "Danger Room", "Danger Room", "An optional gated room inside Clockwork Tunnels (and Starlight Cradle) levels; probably part of its level's scene rather than a scene of its own",
  /danger ?room/);

// fixed island and city levels (arcade gates; rotate in pairs or triples at their depth)
const fixed = (region: string, levels: string[], where: string, availability: Availability = "regular") =>
  levels.forEach(lv => add("clockworks", region, lv, where, inSet(region, lv), availability));
fixed("Jigsaw Valley", ["Emerald Axis", "Emerald Axis II", "Jade Tangle", "Jade Tangle II", "Perimeter Promenade", "Perimeter Promenade II"],
  "Arcade gate, Construct or Gremlin stratum (tiers 1 and 2); each level rotates with its II at the same depth");
fixed("Aurora Isles", ["Stone Grove", "The Jelly Farm", "The Jelly Farm II", "The Low Gardens"],
  "Arcade gate only, Beast and Slime strata, mostly tier 1; rotates in groups of four");
add("clockworks", "Aurora Isles", "Sea Petal Pass", "Beta only (the Firefly gate); not in the released game", inSet("Aurora Isles", "Sea Petal Pass"), "removed");
fixed("Starlight Cradle", ["Meteor Mile", "Meteor Mile II", "Meteor Mile III", "Shrine of Slumber", "Shrine of Slumber II", "Shrine of Slumber III", "Shrine of Slumber IV"],
  "Arcade gate, Slime stratum with the sleep theme (tiers 2 and 3)");
add("clockworks", "Starlight Cradle", "Torporal Titan", "Arcade gate, Starlight Cradle miniboss depth (the only level at its depth)", inSet("Starlight Cradle", "Torporal Titan"));
fixed("Concrete Jungle", ["Blight Boulevard", "Blight Boulevard II", "Totem Trouble", "Totem Trouble II"],
  "Arcade gate, Slime and Undead strata with poison, tiers 2 and 3 (not tier 1 since 2011); rotates with its II");
add("clockworks", "Concrete Jungle", "Briar Bone Barrage", "Arcade gate, tier 3 only: Concrete Jungle miniboss depth", inSet("Concrete Jungle", "Briar Bone Barrage"));
fixed("Dark City", ["Sinful Steps", "Sinful Steps II", "Plazamonium"], "Arcade gate, Fiend and Undead strata (tiers 2 and 3)");
add("clockworks", "Dark City", "Stygian Steeds", "Arcade gate, tier 3 only: Dark City miniboss depth", inSet("Dark City", "Stygian Steeds"));
fixed("Dark City", ["Ritual Road", "Ritual Road II", "Ritual Road III"], "Arcade gate only; the three rotate together");
fixed("Scarlet Fortress", ["Cravat Hall", "Cravat Hall II", "Cravat Hall III", "Spiral Court", "Spiral Court II", "Grim Gallery"],
  "Arcade gate, castle strata (Undead and Fiend); Cravat Halls rotate in threes, Spiral Courts in pairs with Grim Gallery");

// ---- boss strata (arcade gate's permanent boss feature, a mission, and the Shadow Lair)

// a Shadow Lair's copy of a stage is its own level (below)
const notShadow = (re: RegExp) => new RegExp(`^(?!.*shadow)(?:${re.source})`);
const boss = (region: string, levels: string[], where: string) => levels.forEach(lv => add("boss", region, lv, where, notShadow(inSet(region, lv))));
boss("Gloaming Wildwoods", ["Terrilous Trail", "Roarsterous Ruins", "Lair of the Snarbolax"],
  "The arcade gate with the green tree icon, second stratum of tier 1 (depths 5 to 7); or rank mission 3-2 Shadow of the Beast");
boss("Royal Jelly Palace", ["Garden of Goo", "Red Carpet Runaround", "Battle Royale"],
  "The arcade gate with the pink rook icon, tier 2; or rank mission 5-2 The Sovereign Slime (depths 14 to 16)");
boss("Ironclaw Munitions Factory", ["Abandoned Assembly", "Warfare Workshop", "The Roarmulus Twins"],
  "The arcade gate with the rocket icon, tier 2; or rank mission 6-2 Built to Destroy (depths 15 to 17)");
boss("Firestorm Citadel", ["Blackstone Bridge", "Charred Court", "Ashen Armory", "Smoldering Steps", "Throne Room"],
  "The arcade gate with the brown rook icon, tier 3 (depths 24 to 28); or rank mission 9-3 The King of Ashes");
add("boss", "Firestorm Citadel", "The Path is Sealed", "Rank mission 9-3 The King of Ashes, its last floor (depth 29, after Lord Vanaduke)",
  floorOf("The King of Ashes", "The Path is Sealed"));

// ---- Shadow Lairs and danger missions

const LAIRS: [string, string[], string][] = [
  ["Gloaming Wildwoods", ["Terrilous Trail", "Roarsterous Ruins", "Lair of the Snarbolax"], "poison miasma, two Rabid Snarbolaxes"],
  ["Royal Jelly Palace", ["Garden of Goo", "Red Carpet Runaround", "Battle Royale"], "frozen over, the Ice Queen"],
  ["Ironclaw Munitions Factory", ["Abandoned Assembly", "Warfare Workshop", "The Roarmulus Twins"], "fire, the Red Roarmulus Twins"],
  ["Firestorm Citadel", ["Blackstone Bridge", "Charred Court", "Ashen Armory", "Smoldering Steps", "Throne Room"], "cursed, Darkfire Vanaduke"],
];
for (const [region, stages, what] of LAIRS)
  for (const st of stages)
    add("danger", `Shadow Lair: ${region}`, st, `Shadow Key on the elevator in the depth-23 Clockwork Terminal of any gate that has this boss (${what})`,
      new RegExp(`(?:^| )shadow (?:lair )?(?:.* )?${body(st)}$`));
add("danger", "Shadow Lair", "Unknown Passage", "After any Shadow Lair's boss: the shared passage to the Sanctuary", inSet("Shadow Lair", "Unknown Passage"));
add("danger", "Shadow Lair", "The Sanctuary", "After the Unknown Passage of any Shadow Lair (rewards, then Haven)", inSet("Shadow Lair", "Sanctuary"));

const DANGER_WHERE = (m: string) => `Danger mission "${m}" from the prestige mission board (daily rotation, every fourth day), rank 4-1 or higher to host; depth by rank`;
const danger = (m: string, floors: string[], availability: Availability = "regular", extra: Partial<Level> = {}, where = DANGER_WHERE(m)) =>
  floors.forEach(f => add("danger", m, f, where, floorOf(m, f), availability, extra));
danger("Legion of Almire", ["Necropolis Grounds", "Inner Sanctum", "Cryptic Cache"]);
danger("Compound 42", ["Outer Facility", "Containment", "Fire Safe Storage"]);
danger("Heart of Ice", ["Frozen Highway", "Amu-Sol", "Everfrost Tower"]);
danger("Ghosts in the Machine", ["Dry Dock", "Iron Hulk", "Cargo Bay"]);
add("danger", "Toxic Plant", "Toxic Plant (its floors)", `${DANGER_WHERE("Toxic Plant")}. In the install's mission data; its floor names are not on the wiki`,
  /toxic ?plant/);
danger("Grinchlin Assault!", ["Base Camp", "Ascent", "Summit"], "event", { event: "Winterfest" },
  "Winterfest danger mission from the prestige board, rank 7-1 or higher (Mount Krampus)");

// ---- mission levels (rank board ranks from the install's config/mission.dat)

const mission = (rank: string, m: string, floors: string[], availability: Availability = "regular", note = "", extra: Partial<Level> = {}) =>
  floors.forEach(f => add("missions", `${rank} ${m}`, f,
    `${availability === "event" ? "Event mission" : availability === "purchase" ? "Expansion mission" : `Rank mission ${rank}`} "${m}"${note ? `; ${note}` : ""}`,
    floorOf(m, f), availability, extra));

mission("1-1", "The Abandoned Depot", ["The Abandoned Depot"], "regular", "the first mission of the current tutorial; its floor names are not on the wiki");
mission("1-2", "The Ancient Generator", ["Restoring Power"]);
mission("1-2", "Crossing the Chasm", ["The Journey to Haven"], "regular", "also 1-4 Crossing the Chasm B");
add("missions", "2-1 Pumping Up", "Training Hall", 'Rank mission 2-1 "Pumping Up" (the training hall); floor name not on the wiki', /training ?hall|pumping up/);
mission("2-2", "Drakon Sprite", ["Sunset Steppes", "Frigid Passage"], "regular", "the sprite mission once called A Revelation in Flames (pick a Drakon)");
mission("2-2", "Seraphynx Sprite", ["Restless Railroad", "End of the Line"], "regular", "the sprite mission once called Angels from Antiquity (pick a Seraphynx)");
mission("2-2", "Maskeraith Sprite", ["Creeping Cavern", "Emergency Outflow"], "regular", "the sprite mission once called The Phantom Mask (pick a Maskeraith)");
mission("2-3", "Collector Mission", ["Camp Crimson"], "regular", "the wiki's The Collector; its first floor is a Mechanized Mile");
mission("3-1", "Alien Ooze", ["Field Research Site"], "regular", "after a Slimeway");
mission("3-1", "Toy Soldiers", ["Factory Floor", "Production Center"]);
mission("3-2", "Faith in Armor", ["The Trap Chamber"]);
mission("3-2", "Strength in Unity", ["Geo Knight Camp"], "regular", "after a Wild Path");
mission("3-2", "Blades of the Fallen", ["Soldier's Graveyard"]);
mission("4-2", "Oilers in the Boilers", ["The Hot Vents", "Smoldering Slime Source"]);
mission("4-2", "Frostifur Fandango", ["On the Hunt", "Den of the Snowclaw Pack"]);
mission("4-3", "Rescues and Recycling", ["Supply Yard", "Deconstruction Site"]);
mission("4-3", "Shocking Sentient Sentries", ["Patrol Path", "Heavy Weapons Facility"]);
mission("5-1", "Chilled to the Bone", ["The Cold Approach"], "regular", "then a Candlestick Keep");
mission("5-1", "Work for Idle Hands", ["Tired of Brimstone"], "regular", "then a Devilish Drudgery");
mission("5-2", "Time Enough at Last", ["Inner Court", "The Rambling Arcade", "Eternal Study"]);
mission("5-2", "Rise or Fall", ["Storm Rising", "Night Falls", "Showdown"]);
mission("6-1", "Axes of Evil", ["Felling Giants", "Chopping Block"]);
mission("6-1", "Plan of Attack", ["Toxic Cavern", "Power Grid"]);
mission("6-1", "High Temperature Hostages", ["Tracking", "Resistance", "Extraction"]);
mission("6-2", "Whipping and Mishandling", ["Darkness Above", "Sol'Fork Skyway", "Sol'Fork Downtown"]);
mission("6-2", "Sewer Stash", ["Wasteworks Access", "Security Outpost", "Weapons Cache"]);
mission("7-2", "In Cold Blood", ["Killer Trail", "Ice Cube Alley", "Lizard Lounge"]);
mission("7-2", "Vicious and Viscous", ["The Creeping Colony", "The Hungry Den", "The Oozing Onslaught"]);
mission("7-3", "Beyond the Axes of Evil", ["Lumbering Doom", "Barking Mad", "Outpost of Tyranny"]);
mission("7-3", "Spark and Roar", ["The Cold March", "The Iron Tundra", "The Bitter Battle", "Hidden Hideout"]);
mission("8-1", "The Return of Ur", ["Dimensional Shift", "The Summoning Circle", "Banishment"]);
mission("8-1", "Weight of Darkness", ["The Forsaken", "Inner Demons", "Eternal Struggle"]);
mission("8-2", "The Vile Engine", ["Forgotten Trail", "Lichen Colony", "Processing Plant"]);
mission("8-2", "The Rotting Metropolis", ["Streets of Decay", "Further Decline", "Citizen Uprising"]);
mission("8-2", "The Great Escape", ["Prison Approach", "The Yard", "Down the Drain"]);
mission("9-1", "An Occurrence at Owlite Keep", ["The Dead March", "The Hall of Remembrance", "The Forgotten Library"]);
mission("9-1", "The Silent Legion", ["Poisoned Minds", "Cold Hearts", "Cryptic Statuary"]);
mission("9-2", "Terminal Meltdown", ["Code Yellow", "Code Orange", "Red Alert"]);
mission("9-2", "Alone in the Dark", ["Pitch Black", "Out in the Cold", "Final Resting Place"]);
mission("9-2", "The Gauntlet", ["Shock and Awe", "Reign of Fire", "Last Stand"]);
mission("10-1", "Breaking in the Recruits", ["Operation Greenhorn", "The Underworks", "The Overworks"]);
mission("10-1", "Crimson Chaos", ["Frost Chamber", "The Frozen Compound", "Complex 357"]);
mission("10-1", "It Came From Below", ["Haunted Halls", "Into the Maw", "A Descent into Darkness"]);
mission("10-2", "Shadowplay", ["Greenstone Bridge", "Overgrown Court", "Throne Room"], "regular", "the overgrown Firestorm Citadel");
mission("10-2", "Dreams and Nightmares", ["The Path is Revealed", "A Step Beyond", "Descent into Darkness", "Refuge"], "regular", "the way into the Core");

// expansion mission (bought once per account; needs 3-2 The Pioneers)
mission("tiers 1-3", "Operation Crimson Hammer", ["Storming the Walls", "Silence the Guns", "Flank the Frontlines", "Clear the Gatehouse", "Engines of War", "Aftermath"],
  "purchase", "bought from the mission board (energy), after rank 3-2 The Pioneers; three tiers");

// event prestige missions
mission("rank 4+", "Shroud of the Apocrea", ["The Obsidian Nexus", "The Grasping Plateau"], "event", "Shroud of the Apocrea event, depths 19 to 25", { event: "Shroud of the Apocrea" });
add("missions", "rank 4+ Shroud of the Apocrea", "Dark Halls lobby", 'Event mission "Shroud of the Apocrea": its lobby (Lost Souls, the Harvester warning)',
  /^dark halls lobby$/, "event", { event: "Shroud of the Apocrea" });
add("missions", "rank 4+ Shroud of the Apocrea", "Dark Halls finale", 'Event mission "Shroud of the Apocrea": its last floor (the wiki\'s Departure; harvested souls)',
  /^dark halls finale$|^(?:shroud of the apocrea )?departure$/, "event", { event: "Shroud of the Apocrea" });
mission("rank 3+", "The Dark Harvest", ["Punkin King's Lair"], "event", "Dark Harvest Festival (Halloween), once a day", { event: "Dark Harvest" });
mission("rank 3+", "Save Winterfest!", ["Alleys of Emberlight", "Silent Emberlight"], "event", "Winterfest; the two alternate by day", { event: "Winterfest" });
mission("rank 3+", "Total Caketastrophe!", ["Chaos in the Kitchen"], "event", "Caketastrophe (the anniversary event)", { event: "Anniversary" });
add("missions", "rank 3+ A Gremlin in Knead", "A Gremlin in Knead (its floors)", "Event mission (the anniversary's shock variant); floor names not on the wiki",
  /gremlin in knead|currentcake/, "event", { event: "Anniversary" });
for (const m of ["That Mold and Black Magic", "Bad Luck and Brimstone", "Purr Terror"])
  add("missions", `rank 4+ ${m}`, `${m} (its floors)`, "Kataclysmic Confrontation event mission (Black Kats, given at Moorcroft Manor); floor names not on the wiki",
    new RegExp(body(m, false)), "event", { event: "Kataclysmic Confrontation" });
add("missions", "March of the Tortodrones", "Mysterious Rooms", "March of the Tortodrones event: special rooms in arcade Infernal Passage, Overtime Every Time and Fiendish Fray levels",
  /mysterious ?room|tortodrone/, "event", { event: "March of the Tortodrones" });

// gone from the game: missions the install no longer deploys, and older prestige missions
mission("prestige", "Assault on Machine Shop 13", ["Munitions Storage"], "removed", "an old daily prestige mission, no longer in the mission data");
for (const m of ["Securing the Camp", "Bazaar Troubles", "Skies Under Cradle", "The Scarlet Fortress"])
  add("missions", `${m}`, `${m} (its floors)`, "In the install's mission data but not deployed (never released, or withdrawn)", new RegExp(`^${body(m, false)}`), "removed");

// ---- towns and hubs

const town = (set: string, name: string, where: string, pattern: RegExp, availability: Availability = "regular", extra: Partial<Level> = {}) =>
  add("towns", set, name, where, pattern, availability, extra);
town("Haven", "Town Square", "Haven, the usual arrival point", /^(?:haven )?town ?square$/);
town("Haven", "Bazaar", "Haven, the west district", /^(?:haven )?bazaar$/);
town("Haven", "Arcade", "Haven, the north district (the Clockworks gates)", /^(?:haven )?arcade$/);
town("Haven", "Garrison", "Haven, the east district", /^(?:haven )?garrison$/);
town("Haven", "Laboratory", "Through the Garrison; the sprite and lab missions (4-2 A New Threat) also use it", /^(?:haven )?(?:the )?(?:spiral )?lab(?:oratory)?$/);
town("Haven", "Hall of Heroes", "Through the Garrison; rank missions 4-1, 5-2, 6-2, 8-2 and 9-4 Hall of Heroes", /^(?:haven )?hall of heroes$/);
town("Haven", "Guild Hall", "Through the Garrison: a guild's own hall (needs a guild); each guild's hall caches as its own scene", /^(?:guild ?)?hall(?: \(.*\))?$/);
town("Clockworks", "Mission Lobby", "The first floor of every Clockworks mission", /^mission ?lobby$/);
town("Clockworks", "Clockwork Terminal (depth 4)", "Depth 4 of any arcade gate (tier 1)", /^(?:clockwork )?terminal ?(?:1|i)$/);
town("Clockworks", "Clockwork Terminal (depth 13)", "Depth 13 of any arcade gate (tier 2)", /^(?:clockwork )?terminal ?(?:2|ii)$/);
town("Clockworks", "Clockwork Terminal (depth 23)", "Depth 23 of any arcade gate (tier 3; the Shadow Lair elevator)", /^(?:clockwork )?terminal ?(?:3|iii)$/);
town("Clockworks", "Core Terminal", "Depth 29: the end of tier 3 (the Core's elevator back to Haven)", /^(?:clockwork )?(?:terminal ?core|core ?terminal)$/);
town("Clockworks", "Moorcroft Manor", "Subtown at depth 8 (start of tier 2); rank 4-2 to pass the Spiral Warden, or its elevator from Haven", /moorcroft/);
town("Clockworks", "Emberlight", "Subtown at depth 18 (start of tier 3); rank 7-1 to pass the Spiral Warden, or its elevator from Haven", /^emberlight$/);
town("Haven", "Ready Room", "Ships with the install (rsrc/world/readyroom)", /^ready ?room$/, "shipped", { rsrc: "world/readyroom/scene.dat" });
town("Haven", "Knight creation", "Ships with the install (rsrc/world/createknight)", /^create ?knight$/, "shipped", { rsrc: "world/createknight/scene.dat" });

// ---- Coliseum (PvP), King Krogmo's

town("Haven", "King Krogmo's Coliseum", "Haven: the Coliseum (Lockdown and Blast Network queues)", /coliseum|krogmo/);
for (const m of ["Forest", "Reactor", "Furnace", "Frostbite", "Gardens", "Mines", "Avenue", "Icebox", "Pipeline", "Fortress",
  "Necropolis", "Ruins", "Facility", "Ramparts", "Downtown", "Stadium"])
  add("pvp", "Lockdown", m, "Lockdown queue in King Krogmo's Coliseum (200 crowns, random or guild team)", new RegExp(`^(?:lockdown )?${body(m)}$`));
for (const m of ["Gridlock", "Gridlock II", "Crystals", "Crystals II", "Backdoor", "Rockets", "Rockets II", "Spikes", "Two Tone", "Islands",
  "Division", "Stone Cross", "Ring"])
  add("pvp", "Blast Network", m, "Blast Network queue in King Krogmo's Coliseum", new RegExp(`^(?:blast (?:network )?)?${body(m)}$`));

export const LEVELS: readonly Level[] = L;

// ------------------------------------------------------------------------------ matching

/** The levels a cached scene's name (its display name from src/scene.ts) stands for. */
export function matchLevels(sceneName: string, levels: readonly Level[] = LEVELS): Level[] {
  const n = normalizeSceneName(sceneName);
  return levels.filter(l => l.pattern.test(n));
}

export interface GroupCount { group: LevelGroup; title: string; have: Level[]; missing: Level[] }

export interface Checklist {
  groups: GroupCount[];
  /** Scene names that match no level. */
  unmatched: string[];
  have: number;
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
  for (const name of sceneNames) {
    const m = matchLevels(name, levels);
    if (m.length === 0) unmatched.push(name);
    for (const l of m) got.add(l);
  }
  for (const l of levels) if (l.rsrc && shipped(l.rsrc)) got.add(l);
  const groups = GROUPS.map(g => {
    const all = levels.filter(l => l.group === g.id);
    return { group: g.id, title: g.title, have: all.filter(l => got.has(l)), missing: all.filter(l => !got.has(l)) };
  });
  return { groups, unmatched, have: got.size, total: levels.length };
}
