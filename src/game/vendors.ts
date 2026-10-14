// Haven's Stranger merchants and their stock, from the public wiki's vendor pages
// (wiki.spiralknights.com Quillion, Ricasso, Greave, Kragen, Vatel and Haven Bazaar; read
// 2026-10-14). The stock was server data (config/catalog.dat ships empty); the wiki lists, per
// merchant, the zero and one star goods that are always in stock and the two and three star
// goods (Vatel: recipes) of which a random few are stocked each day, "unique to each player",
// reset at midnight Pacific time, never more than one of each.
//
// How many random goods a day the wiki does not say: RANDOM_PER_DAY is ours. Names are matched
// to item configs by their last path segment (the English names the configs are filed under).

export interface VendorStock {
  /** Who the wiki says keeps the shop. */
  name: string;
  /** Always in stock. */
  always: string[];
  /** A random few of each list, every day. */
  random: string[][];
  /** The keeper sells recipes: the names are the recipes' outputs. */
  recipes?: boolean;
}

/** Random goods a day from each star's list (ours: the wiki gives no count). */
export const RANDOM_PER_DAY = 4;
/** Vatel's recipes a day from each star's list (ours). */
export const RANDOM_RECIPES_PER_DAY = 6;

export const VENDORS: Record<string, VendorStock> = {
  // Shop/Haven/Swords
  swords: {
    name: "Quillion",
    always: ["Beast Basher", "Hatchet", "Proto Sword", "Robo Wrecker", "Slime Slasher",
      "Big Beast Basher", "Bolted Blade", "Heavy Hatchet", "Hot Edge", "Rugged Robo Wrecker", "Static Edge", "Super Slime Slasher"],
    random: [
      ["Thwack Hammer"],
      ["Brandish", "Cutter", "Flourish", "Searing Edge", "Shocking Edge", "Spur", "Troika", "Wrench Wand"],
      ["Arc Razor", "Cautery Sword", "Iceburst Brandish", "Fireburst Brandish", "Kamarin", "Nightblade", "Striker", "Swift Flourish"],
    ],
  },
  // Shop/Haven/Guns and Bombs
  guns: {
    name: "Ricasso",
    always: ["Punch Gun", "Stun Gun", "Proto Bomb",
      "Frost Gun", "Pummel Gun", "Spitfire", "Super Stun Gun", "Zapper", "Cold Snap", "Firecracker", "Haze Bomb"],
    random: [
      ["Autogun", "Cryotech Alchemer", "Firotech Alchemer", "Prismatech Alchemer", "Shadowtech Alchemer", "Voltech Alchemer",
        "Crystal Bomb", "Dark Matter Bomb", "Fiery Vaporizer", "Freezing Vaporizer", "Shard Bomb", "Splinter Bomb", "Toxic Vaporizer"],
      ["Cryotech Alchemer Mk II", "Firotech Alchemer Mk II", "Magnus", "Needle Shot", "Pepperbox", "Prismatech Alchemer Mk II",
        "Shadowtech Alchemer Mk II", "Voltech Alchemer Mk II", "Deconstructor", "Fiery Vaporizer Mk II", "Freezing Vaporizer Mk II",
        "Graviton Charge", "Rock Salt Bomb", "Sun Shards", "Super Crystal Bomb", "Super Dark Matter Bomb", "Super Shard Bomb",
        "Super Splinter Bomb", "Toxic Vaporizer Mk II"],
    ],
  },
  // Shop/Haven/Armor and Helms
  armor: {
    name: "Greave",
    always: ["Cyclops Cap", "Mining Hat", "Fencing Jacket", "Vitasuit",
      "Circuit Breaker Helm", "Emberbreak Helm", "Frostbreaker Helm", "Ignition Helm", "Padded Cap", "Spiral Scale Helm",
      "Circuit Breaker Armor", "Emberbreak Armor", "Frostbreaker Armor", "Ignition Armor", "Padded Armor", "Spiral Scale Mail"],
    random: [
      ["Magic Hood", "Spiral Plate Helm", "Spiral Demo Helm", "Skelly Mask", "Jelly Helm", "Volt Breaker Helm", "Firebreak Helm",
        "Icebreaker Helm", "Pathfinder Helm", "Sentinel Helm", "Shade Helm",
        "Magic Cloak", "Spiral Plate Mail", "Spiral Demo Suit", "Skelly Suit", "Jelly Mail", "Volt Breaker Armor", "Firebreak Armor",
        "Icebreaker Armor", "Pathfinder Armor", "Sentinel Armor", "Shade Armor", "Vitasuit Plus"],
      ["Drake Scale Helm", "Elemental Hood", "Boosted Plate Helm", "Fused Demo Helm", "Scary Skelly Mask", "Brute Jelly Helm",
        "Surge Breaker Helm", "Blazebreak Helm", "Blizzbreaker Helm",
        "Drake Scale Mail", "Elemental Cloak", "Boosted Plate Mail", "Fused Demo Suit", "Scary Skelly Suit", "Brute Jelly Mail",
        "Surge Breaker Armor", "Blazebreak Armor", "Blizzbreaker Armor"],
    ],
  },
  // Shop/Haven/Shields and Trinkets (the wiki lists Kragen's shields only)
  shields: {
    name: "Kragen",
    always: ["Iron Buckler", "Proto Shield", "Circuit Breaker Shield", "Emberbreak Shield", "Force Buckler", "Frostbreaker Shield", "Scale Shield"],
    random: [
      ["Firebreak Shield", "Icebreaker Shield", "Jelly Shield", "Owlite Shield", "Plate Shield", "Skelly Shield", "Volt Breaker Shield"],
      ["Blazebreak Shield", "Blizzbreaker Shield", "Boosted Plate Shield", "Brute Jelly Shield", "Drake Scale Shield",
        "Horned Owlite Shield", "Scary Skelly Shield", "Surge Breaker Shield"],
    ],
  },
  // Shop/Haven/Recipes (Vatel's recipes; the wiki files a few helmets and armours under each other)
  recipes: {
    name: "Vatel",
    recipes: true,
    always: [],
    random: [
      ["Circuit Breaker Helm", "Emberbreak Helm", "Frostbreaker Helm", "Spiral Scale Helm", "Circuit Breaker Armor", "Emberbreak Armor",
        "Frostbreaker Armor", "Spiral Scale Mail", "Circuit Breaker Shield", "Emberbreak Shield", "Force Buckler", "Frostbreaker Shield",
        "Scale Shield", "Big Beast Basher", "Bolted Blade", "Heavy Hatchet", "Hot Edge", "Rugged Robo Wrecker", "Static Edge",
        "Super Slime Slasher", "Thwack Hammer", "Frost Gun", "Pummel Gun", "Super Stun Gun", "Zapper", "Cold Snap", "Firecracker"],
      ["Firebreak Helm", "Icebreaker Helm", "Jelly Helm", "Magic Hood", "Skelly Mask", "Spiral Demo Helm", "Spiral Plate Helm",
        "Volt Breaker Helm", "Wolver Cap", "Firebreak Armor", "Icebreaker Armor", "Jelly Mail", "Magic Cloak", "Skelly Suit",
        "Spiral Demo Suit", "Spiral Plate Mail", "Vitasuit Plus", "Volt Breaker Armor", "Wolver Coat", "Firebreak Shield",
        "Icebreaker Shield", "Jelly Shield", "Owlite Shield", "Plate Shield", "Skelly Shield", "Volt Breaker Shield", "Brandish",
        "Cutter", "Flourish", "Searing Edge", "Shocking Edge", "Spur", "Troika", "Wrench Wand", "Autogun", "Cryotech Alchemer",
        "Firotech Alchemer", "Prismatech Alchemer", "Shadowtech Alchemer", "Voltech Alchemer", "Blast Bomb", "Crystal Bomb",
        "Fiery Vaporizer", "Freezing Vaporizer", "Haze Bomb", "Toxic Vaporizer"],
    ],
  },
};

/** Which wiki stock a Haven keeper (its actor config name) has, or null. */
export function vendorKey(keeper: string): string | null {
  const k = keeper.toLowerCase();
  if (!/^shop\/haven\//.test(k)) return null;
  if (/swords/.test(k)) return "swords";
  if (/guns and bombs/.test(k)) return "guns";
  if (/armor and helms/.test(k)) return "armor";
  if (/shields and trinkets/.test(k)) return "shields";
  if (/\/recipes$/.test(k)) return "recipes";
  return null;
}

/** The day the stock is for: days since the epoch at midnight Pacific time (UTC-8). */
export const vendorDay = (now = Date.now()) => Math.floor((now - 8 * 3600_000) / 86400_000);

/** A seed for a player's stock on a day (each player saw their own). */
export function vendorSeed(day: number, player: string): number {
  let h = 2166136261 ^ day;
  for (let i = 0; i < player.length; i++) h = Math.imul(h ^ player.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The names a vendor stocks today: everything always in stock and a random few of each list. */
export function vendorNames(v: VendorStock, rand: () => number): string[] {
  const per = v.recipes ? RANDOM_RECIPES_PER_DAY : RANDOM_PER_DAY;
  const out = [...v.always];
  for (const list of v.random) {
    const pool = [...new Set(list)];
    // a one-item list (Quillion's Thwack Hammer) is in stock on half the days
    if (pool.length === 1) { if (rand() < 0.5) out.push(pool[0]); continue; }
    for (let i = 0; i < per && pool.length; i++) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return out;
}

/** "Weapon/Sword/Fireburst Brandish" -> "fireburst brandish": how vendor names match configs. */
export const vendorMatch = (configName: string) => (configName.split("/").pop() ?? "").toLowerCase().trim();

// ------------------------------------------------------------------ Basil in the mission lobby
//
// Basil (Shop/Mission/Items 0-1 to 5, Shop - Name m.traveler_1) keeps a fixed stock in each
// mission's lobby. The recipes are the wiki's (Basil page, "Mission Lobbies", read 2026-10-14:
// "a totally predictable selection of recipes relevant to that mission"), listed here by the
// mission's title. The supplies come from the recording of a rank 10 mission's lobby
// (docs/research/real-ui-reference.md, Basil): Remedy Capsule 100, Ultra Health Capsule 500,
// the four Ultra vials 250 and Vitapod +12 3,000 crowns. What Basil stocked in lower lobbies
// is not recorded; the same supplies are offered in every lobby (ours).

/** The supplies Basil sells in a mission lobby (config names' last segments). */
export const LOBBY_SUPPLIES = ["Remedy Capsule", "Ultra Health Capsule", "Ultra Fire Vial", "Ultra Freeze Vial", "Ultra Poison Vial",
  "Ultra Shock Vial", "Health +12"];

/** Basil's recipes by mission title (the recipes' outputs), from the wiki. */
export const LOBBY_RECIPES: Record<string, string[]> = {
  "alien ooze": ["Force Buckler", "Pummel Gun", "Super Slime Slasher"],
  "toy soldiers": ["Force Buckler", "Heavy Hatchet", "Pummel Gun"],
  "faith in armor": ["Force Buckler", "Heavy Hatchet", "Pummel Gun"],
  "strength in unity": ["Big Beast Basher", "Force Buckler", "Pummel Gun"],
  "blades of the fallen": ["Bolted Blade", "Cold Snap", "Force Buckler", "Frost Gun", "Spiral Scale Helm", "Spiral Scale Mail"],
  "shadow of the beast": ["Big Beast Basher", "Firecracker", "Force Buckler", "Spiral Scale Helm", "Spiral Scale Mail", "Super Stun Gun"],
  "oilers in the boilers": ["Dark Matter Bomb", "Freezing Vaporizer", "Jelly Helm", "Jelly Mail", "Jelly Shield", "Shadowtech Alchemer", "Troika"],
  "frostifur fandango": ["Flourish", "Jelly Helm", "Jelly Mail", "Jelly Shield", "Splinter Bomb", "Magnus"],
  "rescues and recycling": ["Dark Matter Bomb", "Freezing Vaporizer", "Magic Cloak", "Magic Hood", "Owlite Shield", "Shadowtech Alchemer", "Wrench Wand"],
  "shocking sentient sentries": ["Crystal Bomb", "Freezing Vaporizer", "Magic Cloak", "Magic Hood", "Owlite Shield", "Voltech Alchemer", "Wrench Wand"],
  "chilled to the bone": ["Crystal Bomb", "Fiery Vaporizer", "Firotech Alchemer", "Skelly Mask", "Skelly Shield", "Skelly Suit", "Fireburst Brandish"],
  "work for idle hands": ["Flourish", "Skelly Mask", "Skelly Shield", "Skelly Suit", "Splinter Bomb", "Magnus"],
  "time enough at last": ["Crystal Bomb", "Haze Bomb", "Skelly Mask", "Skelly Shield", "Skelly Suit", "Voltech Alchemer", "Fireburst Brandish"],
  "rise or fall": ["Dark Matter Bomb", "Fiery Vaporizer", "Jelly Shield", "Shadowtech Alchemer", "Wolver Cap", "Wolver Coat", "Nightblade"],
  "the sovereign slime": ["Brute Jelly Shield", "Chroma Mask", "Chroma Suit", "Graviton Charge", "Nightblade", "Rock Salt Bomb", "Shadowtech Alchemer Mk II"],
  "axes of evil": ["Elemental Cloak", "Elemental Hood", "Fiery Vaporizer Mk II", "Fireburst Brandish", "Horned Owlite Shield", "Super Crystal Bomb", "Voltech Alchemer Mk II"],
  "plan of attack": ["Brute Jelly Shield", "Dusker Cap", "Dusker Coat", "Magnus", "Rigadoon", "Super Splinter Bomb", "Toxic Vaporizer Mk II"],
  "high temperature hostages": ["Blazebreak Armor", "Blazebreak Helm", "Blazebreak Shield", "Nightblade", "Shadowtech Alchemer Mk II", "Super Dark Matter Bomb", "Toxic Vaporizer Mk II"],
  "whipping and mishandling": ["Scary Skelly Mask", "Scary Skelly Shield", "Scary Skelly Suit", "Sun Shards", "Swift Flourish", "Voltech Alchemer Mk II"],
  "sewer stash": ["Drake Scale Helm", "Drake Scale Mail", "Drake Scale Shield", "Graviton Charge", "Nightblade", "Shadowtech Alchemer Mk II"],
  "built to destroy!": ["Deconstructor", "Elemental Cloak", "Elemental Hood", "Horned Owlite Shield", "Iceburst Brandish", "Voltech Alchemer Mk II"],
  "in cold blood": ["Heavy Splinter Bomb", "Rock Jelly Helm", "Rock Jelly Mail", "Rock Jelly Shield", "Shadow Driver", "Silent Nightblade"],
  "vicious and viscous": ["Charged Quicksilver Helm", "Charged Quicksilver Mail", "Fiery Atomizer", "Heavy Dark Matter Bomb", "Shadow Driver", "Silent Nightblade", "Wise Owlite Shield"],
  "beyond the axes of evil": ["Blazebrand", "Fiery Atomizer", "Heavy Crystal Bomb", "Miracle Cloak", "Miracle Hood", "Volt Driver", "Wise Owlite Shield"],
  "spark and roar": ["Heavy Deconstructor", "Miracle Cloak", "Miracle Hood", "Shadow Driver", "Silent Nightblade", "Wise Owlite Shield"],
  "the return of ur": ["Daring Rigadoon", "Mega Magnus", "Radiant Sun Shards", "Seraphic Helm", "Seraphic Mail", "Sinister Skelly Shield"],
  "weight of darkness": ["Daring Rigadoon", "Radiant Sun Shards", "Seraphic Helm", "Seraphic Mail", "Sinister Skelly Shield", "Volt Driver"],
  "the vile engine": ["Ash Tail Cap", "Ash Tail Coat", "Fiery Atomizer", "Ionized Salt Bomb", "Rock Jelly Shield", "Shadow Driver", "Silent Nightblade"],
  "the rotting metropolis": ["Blazebrand", "Fiery Atomizer", "Firo Driver", "Rock Jelly Shield", "Silvermail", "Virulisk Mask"],
  "the great escape": ["Freezing Atomizer", "Khorovod", "Sinister Skelly Mask", "Sinister Skelly Shield", "Sinister Skelly Suit", "Volcanic Pepperbox"],
  "an occurrence at owlite keep": ["Ash of Agni", "Combuster", "Dread Skelly Mask", "Dread Skelly Shield", "Dread Skelly Suit", "Storm Driver"],
  "the silent legion": ["Callahan", "Deadly Splinter Bomb", "Dread Skelly Mask", "Dread Skelly Shield", "Dread Skelly Suit", "Fearless Rigadoon"],
  "terminal meltdown": ["Acheron", "Deadly Dark Matter Bomb", "Deadly Virulisk Mask", "Deadly Virulisk Suit", "Dragon Scale Shield", "Shocking Salt Bomb", "Umbra Driver", "Venom Veiler"],
  "alone in the dark": ["Combuster", "Deadly Crystal Bomb", "Dread Skelly Mask", "Dread Skelly Shield", "Dread Skelly Suit", "Storm Driver"],
  "the gauntlet": ["Callahan", "Divine Mantle", "Divine Veil", "Final Flourish", "Grey Owlite Shield", "Scintillating Sun Shards"],
  "the king of ashes": ["Armor of the Fallen", "Blitz Needle", "Crown of the Fallen", "Glacius", "Grey Owlite Shield", "Scintillating Sun Shards"],
  "breaking in the recruits": ["Ash of Agni", "Combuster", "Grey Feather Cowl", "Grey Feather Mantle", "Grey Owlite Shield", "Magma Driver"],
  "crimson chaos": ["Bombastic Demo Helm", "Bombastic Demo Suit", "Glacius", "Hail Driver", "Heater Shield", "Shivermist Buster"],
  "it came from below": ["Ironmight Plate Shield", "Irontech Destroyer", "Sudaruska", "Valkyrie Helm", "Valkyrie Mail", "Volcanic Pepperbox"],
  "shadowplay": ["Armor of the Fallen", "Blitz Needle", "Crown of the Fallen", "Glacius", "Grey Owlite Shield", "Scintillating Sun Shards"],
  "dreams and nightmares": ["Callahan", "Divine Mantle", "Divine Veil", "Final Flourish", "Grey Owlite Shield", "Scintillating Sun Shards"],
};

/** Whether a keeper (its actor config name) is Basil in a mission lobby. */
export const isLobbyBasil = (keeper: string) => /^shop\/mission\/items\b/i.test(keeper);

/** What Basil sells in a mission's lobby: its recipes (by output) and the supplies, matched as vendorMatch. */
export function lobbyStock(missionTitle: string | null | undefined): { recipes: Set<string>; supplies: Set<string> } {
  const key = (missionTitle ?? "").toLowerCase().replace(/^\s*\d+-\d+\s*/, "").trim();
  return { recipes: new Set((LOBBY_RECIPES[key] ?? []).map(n => n.toLowerCase())), supplies: new Set(LOBBY_SUPPLIES.map(n => n.toLowerCase())) };
}

// ------------------------------------------------------------------ Basil in the Clockwork Terminals
//
// The wiki (Basil, "Clockwork Terminals"): at depth 4 one and two star recipes, at depth 13
// two to four stars, at depth 23 four and five, each list with at least one of its top star;
// six to twenty-five recipes chosen at random, the same for the whole party.

/** The star range Basil's terminal recipes take at a Clockworks tier (1 to 3). */
export function terminalStars(tier: number): [number, number] {
  return tier <= 1 ? [1, 2] : tier === 2 ? [2, 4] : [4, 5];
}
/** How many recipes Basil offers at a terminal: six to twenty-five, by the visit's seed. */
export const terminalCount = (rand: () => number) => 6 + Math.floor(rand() * 20);
