// Drop rates and loot rules from the Spiral Knights wiki (wiki.spiralknights.com), read in
// October 2026. docs/research/drop-rates.md summarises what each page gives and what is left.
//
// The order of trust: the client's own configs first (config/spawn_table.dat, item.dat and
// item_depth_weight.dat hold the real loot tables, box weights, crown and heat curves and
// material tags, and src/game/spawntable.ts evaluates them as they are); the wiki next, for
// the rules the server applied that the client never saw (the prize wheel, the belt, the
// vitapod's "always better", which minerals a stratum favours, which tags a drop counts);
// and this port's guesses last, only where neither says, each marked GUESS.
//
// The wiki gives almost no percentages. Every number below that came from it says which
// page; every number that did not says GUESS and why.

import type { Prize } from "./prizewheel";

const WIKI = "https://wiki.spiralknights.com/";

/** The wiki pages this module reads, by topic. */
export const SOURCES = {
  materials: WIKI + "Materials",
  minerals: WIKI + "Minerals",
  crowns: WIKI + "Crowns",
  heat: WIKI + "Heat",
  treasureBox: WIKI + "Treasure_box",
  treasureVault: WIKI + "Treasure_Vault",
  treasureTrove: WIKI + "Treasure_Trove",
  dangerRoom: WIKI + "Danger_Room",
  prizeWheel: WIKI + "Prize_Wheel",
  goldenPrizeWheel: WIKI + "Golden_Prize_Wheel",
  pickup: WIKI + "Pickup",
  heart: WIKI + "Heart",
  vitapod: WIKI + "Vitapod",
  fireCrystal: WIKI + "Fire_Crystal",
  orbOfAlchemy: WIKI + "Orb_of_Alchemy",
  sparkOfLife: WIKI + "Spark_of_Life",
  clockworks: WIKI + "Clockworks",
} as const;

// ------------------------------------------------------------------ depth, tier, stratum

/** Clockworks tiers by depth (Clockworks: tier 1 depths 0-7, tier 2 8-17, tier 3 18-28). */
export const TIER_DEPTHS: Record<1 | 2 | 3, [number, number]> = { 1: [0, 7], 2: [8, 17], 3: [18, 28] };

/** The tier of a depth (Clockworks). Depth 29, the Core's terminal, counts as tier 3. */
export function tierOf(depth: number): 1 | 2 | 3 {
  return depth >= TIER_DEPTHS[3][0] ? 3 : depth >= TIER_DEPTHS[2][0] ? 2 : 1;
}

/**
 * The first depth each star rating of general material drops at (Materials, "Star by depth":
 * 0 and 1 star from depth 1, 2 star from 4, 3 star from "8?", 4 star from 13, 5 star from 18).
 * Reference only: the game weights stars by the client's item_depth_weight.dat "Materials"
 * table (start depths 0, 0, 3, 9, 12, 19), which is the real data; the wiki's list is the
 * strata's first depths and marks 3 star as unsure. The two differ by a depth at 2, 3 and 5
 * stars (docs/research/drop-rates.md).
 */
export const WIKI_STAR_START_DEPTH = [1, 1, 4, 8, 13, 18] as const;

// ------------------------------------------------------------------ materials

/** A drop theme: a monster family or a status (gate themes on the Materials and Minerals pages). */
export type Family = "Beast" | "Construct" | "Fiend" | "Gremlin" | "Slime" | "Undead";
export type Status = "Fire" | "Freeze" | "Poison" | "Shock" | "Sleep";
export type Theme = Family | Status;

export const FAMILIES: Family[] = ["Beast", "Construct", "Fiend", "Gremlin", "Slime", "Undead"];
export const STATUSES: Status[] = ["Fire", "Freeze", "Poison", "Shock", "Sleep"];

/**
 * The general materials (Materials, "General Materials"): stars and the themes whose monsters
 * drop them (the page's Gates column; the item.dat tags say the same, fam_<family> and
 * sc_<status>). "A monster's drop table holds materials matching its family and status."
 */
export const MATERIALS: Record<string, { stars: number; themes: Theme[] }> = {
  "Blue Shard": { stars: 0, themes: ["Construct", "Gremlin"] },
  "Dark Shard": { stars: 0, themes: ["Fiend", "Undead"] },
  "Green Shard": { stars: 0, themes: ["Beast", "Slime"] },
  "Light Shard": { stars: 0, themes: ["Construct", "Slime", "Undead"] },
  "Red Shard": { stars: 0, themes: ["Beast", "Fiend", "Gremlin"] },
  "Beast Scale": { stars: 1, themes: ["Beast"] },
  "Brimstone": { stars: 1, themes: ["Fiend"] },
  "Bronze Bolt": { stars: 1, themes: ["Gremlin"] },
  "Ecto Drop": { stars: 1, themes: ["Undead"] },
  "Gel Drop": { stars: 1, themes: ["Slime"] },
  "Scrap Metal": { stars: 1, themes: ["Construct"] },
  "Sharp Fang": { stars: 1, themes: ["Beast", "Slime"] },
  "Spark Plug": { stars: 1, themes: ["Construct", "Gremlin"] },
  "Vile Seal": { stars: 1, themes: ["Fiend", "Undead"] },
  "Blast Powder": { stars: 2, themes: ["Fire"] },
  "Cooling Cell": { stars: 2, themes: ["Freeze"] },
  "Critter Carapace": { stars: 2, themes: ["Beast"] },
  "Driftwood": { stars: 2, themes: ["Slime"] },
  "Forbidden Fruit": { stars: 2, themes: ["Fiend"] },
  "Frayed Fabric": { stars: 2, themes: ["Gremlin"] },
  "Frost Gel": { stars: 2, themes: ["Freeze"] },
  "Fuel Canister": { stars: 2, themes: ["Fire"] },
  "Gel Core": { stars: 2, themes: ["Slime"] },
  "Grave Soil": { stars: 2, themes: ["Undead"] },
  "Gremlin Gizmo": { stars: 2, themes: ["Gremlin"] },
  "Iron Gear": { stars: 2, themes: ["Construct"] },
  "Monster Bone": { stars: 2, themes: ["Beast"] },
  "Nightshade": { stars: 2, themes: ["Poison"] },
  "Owlite Feather": { stars: 2, themes: ["Undead"] },
  "Power Cell": { stars: 2, themes: ["Shock"] },
  "Sinful Brew": { stars: 2, themes: ["Fiend"] },
  "Static Clinger": { stars: 2, themes: ["Shock"] },
  "Swordstone": { stars: 2, themes: ["Construct"] },
  "Waste Module": { stars: 2, themes: ["Poison"] },
  "Brute Core": { stars: 3, themes: ["Slime"] },
  "Bushy Tail": { stars: 3, themes: ["Beast"] },
  "Dead Gold": { stars: 3, themes: ["Undead"] },
  "Drake Scale": { stars: 3, themes: ["Beast"] },
  "Fine Fabric": { stars: 3, themes: ["Gremlin"] },
  "Force Dynamo": { stars: 3, themes: ["Construct"] },
  "Hailstone": { stars: 3, themes: ["Freeze"] },
  "Phial of Phear": { stars: 3, themes: ["Fiend"] },
  "Redwood": { stars: 3, themes: ["Slime"] },
  "Rocket Sprocket": { stars: 3, themes: ["Construct"] },
  "Soul Dust": { stars: 3, themes: ["Undead"] },
  "Torchstone": { stars: 3, themes: ["Fire"] },
  "Toxic Core": { stars: 3, themes: ["Poison"] },
  "Unstable Core": { stars: 3, themes: ["Gremlin"] },
  "Volt Oil": { stars: 3, themes: ["Shock"] },
  "Wicked Idol": { stars: 3, themes: ["Fiend"] },
  "Zee Core": { stars: 3, themes: ["Sleep"] },
  "Blaze Pepper": { stars: 4, themes: ["Fire"] },
  "Blighted Bone": { stars: 4, themes: ["Undead"] },
  "Chroma Tear": { stars: 4, themes: ["Beast"] },
  "Corrosive Acid": { stars: 4, themes: ["Poison"] },
  "Ghost Bell": { stars: 4, themes: ["Undead"] },
  "Heavy Gear": { stars: 4, themes: ["Construct"] },
  "Ironwood": { stars: 4, themes: ["Slime"] },
  "Meteor Mote": { stars: 4, themes: ["Gremlin"] },
  "Miracloth": { stars: 4, themes: ["Gremlin"] },
  "Mug of Misery": { stars: 4, themes: ["Fiend"] },
  "Perfect Snowball": { stars: 4, themes: ["Freeze"] },
  "Rocky Core": { stars: 4, themes: ["Slime"] },
  "Silver Coil": { stars: 4, themes: ["Construct"] },
  "Thunderball": { stars: 4, themes: ["Shock"] },
  "Trojan Horseshoe": { stars: 4, themes: ["Fiend"] },
  "Warp Dust": { stars: 4, themes: ["Beast"] },
  "Crest of Ur": { stars: 5, themes: ["Fiend"] },
  "Dragon Scale": { stars: 5, themes: ["Beast"] },
  "Everfrost": { stars: 5, themes: ["Freeze"] },
  "Flame Soul": { stars: 5, themes: ["Fire"] },
  "Philoso Feather": { stars: 5, themes: ["Undead"] },
  "Plague Essence": { stars: 5, themes: ["Poison"] },
  "Plasma Cell": { stars: 5, themes: ["Construct"] },
  "Primal Ore": { stars: 5, themes: ["Beast"] },
  "Reaper Rib": { stars: 5, themes: ["Undead"] },
  "Royal Core": { stars: 5, themes: ["Slime"] },
  "Royal Skewer": { stars: 5, themes: ["Slime"] },
  "Shadow Steel": { stars: 5, themes: ["Fiend"] },
  "Silverweave": { stars: 5, themes: ["Gremlin"] },
  "Storm Chaser": { stars: 5, themes: ["Shock"] },
  "Sun Silver": { stars: 5, themes: ["Construct"] },
  "Volcanic Iron": { stars: 5, themes: ["Gremlin"] },
};

/**
 * The item.dat tags a theme's drops are tagged with: fam_<family>, sc_<status>. Zee Core, the
 * one Sleep material, carries a bare "sleep" tag instead of sc_sleep, so Sleep counts both.
 */
export function themeTag(theme: Theme): string[] {
  if (theme === "Sleep") return ["sc_sleep", "sleep"];
  return [(FAMILIES as string[]).includes(theme) ? `fam_${theme.toLowerCase()}` : `sc_${theme.toLowerCase()}`];
}

/** The theme of a stratum's name ("Fire", "Slime"), or null for one with no drop theme. */
export function asTheme(name: string | null | undefined): Theme | null {
  const t = (name ?? "").trim();
  const hit = [...FAMILIES, ...STATUSES].find(x => x.toLowerCase() === t.toLowerCase());
  return hit ?? null;
}

/**
 * The tags a drop's source counts, for materials (Materials: "A monster's drop table holds
 * materials matching its family and status"). A monster: its family and the status tags it
 * carries (the elemental variants are sc_fire, sc_freeze, ... in actor.dat). Anything else
 * (treasure, blocks): the floor's stratum theme.
 */
export function dropTags(family: string | null, actorTags: readonly string[], floorTheme: Theme | null): string[] {
  const own: string[] = [];
  for (const t of actorTags) {
    if (t.startsWith("fam_") || t.startsWith("sc_")) own.push(t);
    if (t === "sc_sleep") own.push("sleep");
  }
  if (family) return [...new Set([`fam_${family.toLowerCase()}`, ...own])];
  if (own.length) return [...new Set(own)];
  return floorTheme ? themeTag(floorTheme) : [];
}

// ------------------------------------------------------------------ minerals

export type Mineral = "Crimsonite" | "Dark Matter" | "Luminite" | "Moonstone" | "Valestone";
export const MINERALS: Mineral[] = ["Crimsonite", "Dark Matter", "Luminite", "Moonstone", "Valestone"];

/** Pieces a mined deposit is worth (Minerals: Small 1, Medium 2, Large 4, Shiny 6). */
export const MINERAL_PIECES = { Small: 1, Medium: 2, Large: 4, Shiny: 6 } as const;

/** Hits to bring a mineral spire down to a carriable piece (Minerals: three). */
export const MINERAL_HITS = 3;

/**
 * The minerals each gate theme turns up "Uncommon" and "Frequented" (Minerals, the theme
 * table). Sleep has no gate and no row.
 */
export const MINERALS_BY_THEME: Record<Exclude<Theme, "Sleep">, { uncommon: Mineral[]; frequented: Mineral[] }> = {
  Beast: { uncommon: ["Crimsonite", "Valestone"], frequented: ["Dark Matter", "Luminite", "Moonstone"] },
  Slime: { uncommon: ["Luminite", "Valestone"], frequented: ["Crimsonite", "Dark Matter", "Moonstone"] },
  Fiend: { uncommon: ["Crimsonite", "Dark Matter"], frequented: ["Luminite", "Moonstone", "Valestone"] },
  Undead: { uncommon: ["Dark Matter", "Luminite"], frequented: ["Crimsonite", "Moonstone", "Valestone"] },
  Gremlin: { uncommon: ["Crimsonite", "Moonstone"], frequented: ["Dark Matter", "Luminite", "Valestone"] },
  Construct: { uncommon: ["Luminite", "Moonstone"], frequented: ["Crimsonite", "Dark Matter", "Valestone"] },
  Fire: { uncommon: ["Crimsonite", "Luminite"], frequented: ["Dark Matter", "Moonstone", "Valestone"] },
  Freeze: { uncommon: ["Moonstone", "Valestone"], frequented: ["Crimsonite", "Dark Matter", "Luminite"] },
  Poison: { uncommon: ["Dark Matter", "Valestone"], frequented: ["Crimsonite", "Luminite", "Moonstone"] },
  Shock: { uncommon: ["Dark Matter", "Moonstone"], frequented: ["Crimsonite", "Luminite", "Valestone"] },
};

/**
 * GUESS: how much likelier a "Frequented" mineral is than an "Uncommon" one. The wiki names
 * the groups but gives no odds; at 3 to 1 each frequented colour turns up 27% of the time and
 * each uncommon one 9%.
 */
export const FREQUENTED_TO_UNCOMMON = 3;

/** A mineral's weight on a theme's floors (1 with no theme: the client's even pick). */
export function mineralWeight(theme: Theme | null, mineral: Mineral): number {
  const row = theme && theme !== "Sleep" ? MINERALS_BY_THEME[theme] : null;
  if (!row) return 1;
  return row.frequented.includes(mineral) ? FREQUENTED_TO_UNCOMMON : 1;
}

/** The mineral a node or deposit config is for ("Block/Mineral/Typed/Dark Matter Node"), or null. */
export function mineralOf(name: string): Mineral | null {
  return MINERALS.find(m => new RegExp(`(^|/)${m} (Node|Deposit)`).test(name)) ?? null;
}

// ------------------------------------------------------------------ crowns and heat

/** Crown coins and their worth (Crowns: copper 1, copper-silver 5, silver 10, silver-gold 25, gold 50). */
export const CROWN_VALUES = { Copper: 1, "Copper-Silver": 5, Silver: 10, "Silver-Gold": 25, Gold: 50 } as const;

/**
 * Embers come in three sizes, small, medium and large (Heat). The wiki gives no heat values
 * or amounts by depth; the game pays heat and crowns from the client's valued tables
 * (Treasure/Heat/*, Treasure/Crowns/*), whose curves are the real data.
 */
export const EMBER_SIZES = ["small", "medium", "large"] as const;

// ------------------------------------------------------------------ treasure boxes

/** What a box can hold, as the Treasure box page lists it. */
export type BoxContent = "heat" | "crowns" | "pickup" | "vitapod" | "material" | "token" | "gear" | "rarity" | "heart";

/**
 * Treasure box contents (Treasure box): green boxes give heat, crowns, a pickup or a vitapod,
 * sometimes a material or a token, rarely gear, and occasionally a bonus rarity drop; red
 * boxes only heat, crowns or a token, plus the bonus rarity; purple boxes (Treasure Vault
 * only) as red ones, but may turn into a Baby Mimic; heart boxes always hearts or vitapods.
 * The client tables say the same with weights (Treasure/Block/Treasure, Normal | Rare |
 * Vault | Health); the game uses those.
 */
export const BOX_CONTENTS: Record<"green" | "red" | "purple" | "heart", BoxContent[]> = {
  green: ["heat", "crowns", "pickup", "vitapod", "material", "token", "gear", "rarity"],
  red: ["heat", "crowns", "token", "rarity"],
  purple: ["heat", "crowns", "token", "rarity"],
  heart: ["heart", "vitapod"],
};

/** A Danger Room's reward area (Danger Room): 8 red and 4 green boxes, 4 heart boxes. */
export const DANGER_ROOM_REWARD = { red: 8, green: 4, heart: 4 } as const;

/**
 * Rarity drops by stratum (Orb of Alchemy, Fire Crystal): orbs "primarily" from their
 * stratum's treasure boxes, fire crystals likewise; Radiant crystals at depth 25 and deeper.
 * Reference only: the client's Treasure/Rarities tables pick them.
 */
export const ORB_STRATA: Record<string, number[]> = {
  "Flawed Orb of Alchemy": [1], "Simple Orb of Alchemy": [2], "Advanced Orb of Alchemy": [3],
  "Elite Orb of Alchemy": [4], "Eternal Orb of Alchemy": [5, 6],
};
export const FIRE_CRYSTAL_STRATA: Record<string, number[] | { fromDepth: number }> = {
  "Warm Fire Crystal": [3], "Glowing Fire Crystal": [3, 4], "Shining Fire Crystal": [5, 6],
  "Radiant Fire Crystal": { fromDepth: 25 },
};

// ------------------------------------------------------------------ hearts, pickups, vitapods

/** Health pips a heart refills (Heart: small 1, medium 2, large 3). A pip is 40 health. */
export const HEART_PIPS = { small: 1, medium: 2, large: 3 } as const;
export const PIP_HEALTH = 40;

/** Seconds a dropped heart stays on the ground (Heart: "disappears after 120 seconds"). */
export const HEART_LIFETIME = 120;

/** Pickups a belt slot stacks (Pickup: "Each belt slot holds 3 pickups of the same item"). */
export const BELT_STACK = 3;

/** Health capsule bars (Pickup: standard 3, super 6, ultra 12). */
export const CAPSULE_BARS = { standard: 3, super: 6, ultra: 12 } as const;

/** The capsules (pips) a vitapod item gives: "Gear/Dungeon/Vitapod/Health +12" is 12. */
export function vitapodPips(name: string): number {
  const m = /Vitapod\/Health \+(\d+)/.exec(name);
  return m ? Number(m[1]) : 0;
}

/**
 * Whether a dropped vitapod is kept (Vitapod: "Pods of the same or lower capacity than one
 * you already have don't drop"). The client's "Vitapods: Always Better" tables say the same
 * (AlwaysBetterDungeonItem, with a fallback table for a pod that is no better).
 */
export function vitapodBetter(pips: number, held: number): boolean {
  return pips > held;
}

/**
 * The max health a held pod adds (Vitapod: it "adds empty health pips. It raises capacity but
 * does not fill health"), a pip being 40 health (the item's Health argument: +12 is 480).
 */
export function vitapodHealth(pips: number): number {
  return Math.max(0, pips) * PIP_HEALTH;
}

// ------------------------------------------------------------------ the prize wheel

/** The crowns the wheel ever gives (Prize Wheel: "always be quantities of 5, 10, 25 or 50"). */
export const WHEEL_CROWNS = [5, 10, 25, 50] as const;

/** GUESS: which of those a tier's wheel gives. The wiki says only "depends on depth". */
export const WHEEL_CROWNS_BY_TIER: Record<1 | 2 | 3, number[]> = { 1: [5, 10], 2: [10, 25], 3: [25, 50] };

/** Pips a wheel heart heals: the wheel's tier (Prize Wheel). */
export const wheelHeartPips = (tier: 1 | 2 | 3) => tier;

/**
 * GUESS: the odds of each kind of prize. The wiki gives none; it says only that Full Health is
 * "much less common" than a heart. Lockboxes and the Kleptolisk (events) are left out.
 */
export const WHEEL_ODDS: [Prize["kind"] | "full", number][] = [
  ["crowns", 0.45], ["material", 0.3], ["heart", 0.12], ["pickup", 0.1], ["full", 0.03],
];

/**
 * GUESS: the chance the wheel offers another of a partly filled stack's pickup. The wiki says
 * only that the knight "has a chance to get another of that type".
 */
export const WHEEL_RESTACK_CHANCE = 0.5;

/** One belt slot: an item and how many. */
export type BeltSlot = readonly [string, number];

/**
 * The pickup the wheel gives for a belt (Prize Wheel, Pickups): with nothing on the belt, one
 * at random; with a stack that is not full, a chance of another of that type, else one at
 * random; with no slot free, only a top-up of a stack that is not full (it never replaces what
 * is there). Null when nothing fits.
 */
export function wheelPickup(belt: readonly BeltSlot[], slots: number, random: () => string | null, rand: () => number = Math.random): string | null {
  const open = belt.filter(([, n]) => n < BELT_STACK);
  const full = belt.length >= slots;
  if (open.length && (full || rand() < WHEEL_RESTACK_CHANCE)) return open[Math.min(open.length - 1, Math.floor(rand() * open.length))][0];
  if (full) return null;
  return random();
}
