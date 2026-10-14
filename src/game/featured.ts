// The mission board's Featured Items (exchange/client/p: ui/supplydepot/interface_mini.dat),
// docked to the board's left from rank 2 on (mission/client/r.wasAdded).
//
// What the client does: it asks the mission service for the knight's rank goods (RankGood:
// a Supply Depot GoodConfig, whether it is special, its promo header and detail), then fills
// up to three cards, specials first, each picked at random from those left, while the panel
// still fits the screen (the display's height less 25). A card (supplydepot/parts/
// preview_maker.dat) shows the item's icon, name, star rank, the energy price and, on sale,
// the original price struck out with "SALE" down its sides; a promo frame (parts/
// promo_frame.dat) can put a header over it and a detail under it, the countdown to the end
// of the offer (RankGood.PromoType.formatCountdown: m.promo_hours_left under 36 hours, else
// m.promo_days_left). Under the cards: the knight's energy and "Show Full Supply Depot".
//
// What is server data and guessed here: the goods themselves (config/depot_catalog.dat is
// empty in the install), which are on sale, by how much, and for how long. Here the
// featured goods are gear the install prices in energy (item_property.dat depotCost by star),
// up to the stars the knight's rank opens (tier 2 from rank 4, tier 3 from rank 7: the
// board bundle's i.tier_2 and i.tier_3), all on sale: a few percent off (the recording
// shows 500 -> 485 and 3,500 -> 3,363), the pick turning over each day at midnight UTC so the
// countdown runs down to it.

import { rng } from "../gen/layout";

const hash32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const seeded = rng;

export interface FeaturedGood {
  /** The item's config name. */
  name: string;
  rarity: number;
  /** The sale price and the depot's own price, in energy. */
  price: number;
  original: number;
  /** When the offer ends (ms). */
  endsAt: number;
}

export interface FeaturedSource {
  /** Every item config name. */
  names(): Iterable<string>;
  /** An item's category and stars, or null. */
  info(name: string): { category: string; rarity: number; icon?: unknown } | null;
  /** The energy the Supply Depot asks for it (0 when it is not sold there). */
  depotCost(name: string): number;
}

const DAY = 86_400_000;
const GEAR = new Set(["sword", "handgun", "bomb", "shield", "armor", "helm"]);

/** The most stars of gear the depot features for a rank (tier 2 from rank 4, tier 3 from rank 7). */
export const featuredMaxStars = (rank: number) => (rank >= 7 ? 5 : rank >= 4 ? 4 : 2);

/** The featured offers for a rank at a time: up to `count`, the same all day. */
export function featuredGoods(src: FeaturedSource, rank: number, now = Date.now(), count = 3): FeaturedGood[] {
  const day = Math.floor(now / DAY);
  const max = featuredMaxStars(rank);
  const pool: { name: string; rarity: number; cost: number }[] = [];
  for (const name of src.names()) {
    if (!/^(Weapon|Gear)\//.test(name) || /(Dev|Test|Example|Prototype|Unused)/i.test(name)) continue;
    const it = src.info(name);
    if (!it || !GEAR.has(it.category) || it.rarity < 1 || it.rarity > max || !it.icon) continue;
    const cost = src.depotCost(name);
    if (cost > 0) pool.push({ name, rarity: it.rarity, cost });
  }
  pool.sort((a, b) => a.name.localeCompare(b.name));
  const rand = seeded(hash32(`featured:${day}:${rank}`));
  const out: FeaturedGood[] = [];
  while (out.length < count && pool.length) {
    const g = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    const off = 0.03 + rand() * 0.02;
    out.push({ name: g.name, rarity: g.rarity, original: g.cost, price: Math.max(1, Math.round(g.cost * (1 - off))), endsAt: (day + 1) * DAY });
  }
  return out;
}

/**
 * RankGood.PromoType.DEFAULT's countdown as the mission bundle words it: whole hours left
 * (m.promo_hours_left: "Ends soon!", "1 more hour", "{0} hours left") under 36 hours, else
 * days (m.promo_days_left, one more than the whole days left).
 */
export function promoCountdown(ms: number): { key: string; n: number } {
  const hours = Math.floor(Math.max(0, ms) / 3_600_000);
  if (hours < 36) return { key: "m.promo_hours_left", n: hours };
  return { key: "m.promo_days_left", n: Math.floor(ms / DAY) + 1 };
}
