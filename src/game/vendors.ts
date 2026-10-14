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
