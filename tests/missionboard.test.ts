import assert from "node:assert/strict";
import { test } from "node:test";
import { DIFFICULTIES, difficultyOf, difficultyPref, partyModePref, rewardScale } from "../src/game/difficulty.ts";
import { featuredGoods, featuredMaxStars, promoCountdown } from "../src/game/featured.ts";
import { completedIcon, completeMission, freshProgress, isGateMission, missionDifficulty, rewardTables, type Mission } from "../src/game/missions.ts";
import { SpawnTables } from "../src/game/spawntable.ts";

test("difficulties are the client's three in order, Normal (EASY) and JOIN by default", () => {
  assert.deepEqual(DIFFICULTIES, ["easy", "medium", "hard"]);
  assert.equal(difficultyPref(), "easy");
  assert.equal(partyModePref(), "join");
  assert.equal(rewardScale("easy"), 0.8);
  assert.equal(rewardScale("hard"), 1.2);
  assert.equal(difficultyOf({ $enum: "x", name: "HARD" }), "hard");
  assert.equal(difficultyOf("com.threerings.X.MEDIUM"), "medium");
  assert.equal(difficultyOf(null), null);
});

const mission = (over: Partial<Mission> = {}): Mission => ({
  id: "m1", path: "Rank/x", title: "X", cls: "Rank", kind: "dungeon", rank: 1, subrank: 1, maxRank: 11, needs: [], schedule: null, event: null,
  cardImage: null, rewards: ["a", "b", "c"], rewardTiers: [{ difficulty: "easy", table: "a" }, { difficulty: "medium", table: "b" }, { difficulty: "hard", table: "c" }],
  prestigeType: "AVG", prestige: 50, npcModel: null, npcVariant: null, conversation: null, ingredients: [], choose: [], gateTheme: null, setting: null,
  production: true, repeatable: false, onceOnly: false, daily: false, summary: "", objective: "", ...over,
});

test("a mission's rewards are the tiers up to the difficulty (MissionConfig.a)", () => {
  const m = mission();
  assert.deepEqual(rewardTables(m, null, "easy"), ["a"]);
  assert.deepEqual(rewardTables(m, null, "medium"), ["a", "b"]);
  assert.deepEqual(rewardTables(m, null, "hard"), ["a", "b", "c"]);
  // done at Normal before: Elite gives the tiers above it
  assert.deepEqual(rewardTables(m, "easy", "hard"), ["b", "c"]);
});

test("gate missions use the chosen difficulty, others HARD; the card badge shows it", () => {
  const d = mission(), c = mission({ id: "c1", kind: "conversation" });
  assert.equal(isGateMission(d), true);
  assert.equal(isGateMission(c), false);
  assert.equal(missionDifficulty(d, "easy"), "easy");
  assert.equal(missionDifficulty(c, "easy"), "hard");
  const p = freshProgress();
  completeMission([d, c], d, p, Date.now(), "easy");
  assert.equal(completedIcon(d, p), "ui/icon/difficulty/easy.png");
  // a later completion at a lower difficulty keeps the higher badge
  completeMission([d, c], d, p, Date.now(), "hard");
  completeMission([d, c], d, p, Date.now(), "medium");
  assert.equal(completedIcon(d, p), "ui/icon/difficulty/hard.png");
  assert.equal(completedIcon(c, p), "ui/icon/difficulty/hard.png");
});

test("featured goods: depot-priced gear up to the rank's stars, on sale, the same all day", () => {
  const items: Record<string, { category: string; rarity: number; icon: unknown; cost: number }> = {
    "Weapon/Sword/A": { category: "sword", rarity: 2, icon: {}, cost: 150 },
    "Weapon/Sword/B": { category: "sword", rarity: 5, icon: {}, cost: 3500 },
    "Gear/Armor/C": { category: "armor", rarity: 3, icon: {}, cost: 500 },
    "Gear/Armor/D": { category: "armor", rarity: 4, icon: {}, cost: 0 },
    "Material/E": { category: "material", rarity: 1, icon: {}, cost: 10 },
  };
  const src = { names: () => Object.keys(items), info: (n: string) => items[n] ?? null, depotCost: (n: string) => items[n]?.cost ?? 0 };
  const day = Date.UTC(2026, 9, 14, 22, 0, 0);
  const low = featuredGoods(src, 2, day);
  assert.deepEqual(low.map(g => g.name), ["Weapon/Sword/A"]);
  const high = featuredGoods(src, 10, day);
  assert.deepEqual(high.map(g => g.name).sort(), ["Gear/Armor/C", "Weapon/Sword/A", "Weapon/Sword/B"]);
  for (const g of high) {
    assert.ok(g.price < g.original && g.price >= g.original * 0.95 - 1);
    assert.equal(g.endsAt, Date.UTC(2026, 9, 15));
  }
  assert.deepEqual(featuredGoods(src, 10, day + 3600_000).map(g => g.name), high.map(g => g.name));
  assert.equal(featuredMaxStars(3), 2);
  assert.equal(featuredMaxStars(4), 4);
  assert.equal(featuredMaxStars(7), 5);
});

test("the promo countdown reads hours under 36, else days", () => {
  assert.deepEqual(promoCountdown(2.5 * 3600_000), { key: "m.promo_hours_left", n: 2 });
  assert.deepEqual(promoCountdown(30 * 60_000), { key: "m.promo_hours_left", n: 0 });
  assert.deepEqual(promoCountdown(50 * 3600_000), { key: "m.promo_days_left", n: 3 });
});

test("spawn tables scale modifyForDifficulty chances and values by the reward scale", () => {
  const lib = new Map<string, any>([
    ["T", { root: { $class: "X$OptionalEntry", probability: 1, modifyForDifficulty: true, entry: { $class: "X$ItemEntry", item: { name: "I" } } } }],
  ]);
  const t = new SpawnTables(lib);
  const orig = Math.random;
  try {
    Math.random = () => 0.85; // under 1.0 (medium) and 1.2 (hard), over 0.8 (easy)
    assert.equal(t.evaluate({ name: "T" }, { depth: 1, tier: 1, difficulty: "medium" }).length, 1);
    assert.equal(t.evaluate({ name: "T" }, { depth: 1, tier: 1, difficulty: "easy" }).length, 0);
  } finally { Math.random = orig; }
});
