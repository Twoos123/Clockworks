import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACHIEVEMENTS, crc32, evaluate, isUnlocked, normalizeAchievements, progressText, recordBoss, recordCraft, recordDepth, recordHaven,
  recordKills, recordPocketUse, recordRevive, recordRunEnd, recordRunStart, type AchievementSource, type ItemLookup,
} from "../src/game/achievements.ts";

const source = (): AchievementSource => ({
  owned: [], gear: {}, bestDepth: 0,
  loadout: { weapons: [], shield: "", trinkets: [], vitapod: "" },
  appearance: { costume: { armor: "", helmet: "", shield: "" } },
  missions: { rank: 1 },
});

// "Weapon/Sword/Thing 3" is a three-star sword, and so on
const look: ItemLookup = n => {
  const m = /^(?:Weapon|Gear)\/(\w+)\/.*?(\d)?$/.exec(n);
  if (!m) return null;
  const cat = ({ Sword: "sword", Handgun: "handgun", Bomb: "bomb", Helm: "helm", Armor: "armor", Shield: "shield" } as Record<string, string>)[m[1]];
  return cat ? { category: cat, rarity: Number(m[2] ?? 1) } : null;
};

test("codes are the CRC-32 of the type's name in hex, as the icons are named", () => {
  assert.equal(crc32("123456789"), 0xcbf43926);
  const find = (t: string) => ACHIEVEMENTS.find(a => a.type === t)!;
  assert.equal(find("REACHED_RESCUE_CAMP").icon, "ui/icon/cheevos/76969053.png");
  assert.equal(find("CASINO_VIP").code, "baa4bd4");
  assert.equal(find("REACHED_HAVEN").nameKey, "m.achievement_" + (crc32("REACHED_HAVEN")).toString(16));
  assert.ok(find("MINERALS_DEPOSITED_1").obsolete && find("MINERALS_DEPOSITED_1").hidden);
  assert.ok(find("CASINO_WHAMMIE").hidden && !find("CASINO_WHAMMIE").obsolete);
  assert.ok(!find("FULL_RUN").hidden);
});

test("crafting counts items and star ratings", () => {
  const s = source();
  for (let i = 0; i < 4; i++) recordCraft(s, 2);
  assert.deepEqual(evaluate(s, look, 1).sort(), ["CRAFTED_RARITY_2"]);
  assert.equal(progressText(s, "ITEMS_CRAFTED_1", look), "4 / 5");
  recordCraft(s, 5);
  assert.deepEqual(evaluate(s, look, 2).sort(), ["CRAFTED_RARITY_5", "ITEMS_CRAFTED_1"]);
  assert.deepEqual(evaluate(s, look, 3), [], "earned once");
  assert.equal(s.achievements!.unlocked.ITEMS_CRAFTED_1, 2);
});

test("gear owned by kind, the five-star set, a level-10 item and every socket filled", () => {
  const s = source();
  s.owned = ["Weapon/Sword/A 1", "Weapon/Sword/B 2", "Weapon/Sword/C 3", "Gear/Helm/H 5", "Gear/Armor/A 5", "Gear/Shield/S 5", "Weapon/Handgun/G 5"];
  let got = evaluate(s, look);
  assert.ok(got.includes("SWORDS_OWNED_1") && !got.includes("SWORDS_OWNED_2"));
  assert.ok(!got.includes("RARITY_SET_1"), "no five-star bomb yet");
  s.owned.push("Weapon/Bomb/Firecracker 5");
  got = evaluate(s, look);
  assert.ok(got.includes("RARITY_SET_1") && got.includes("FIRECRACKER_BOMB_OWNED"));
  s.gear["Weapon/Sword/A 1"] = { level: 10 };
  s.loadout = { weapons: ["a", "b", "c"], shield: "s", trinkets: ["t", "u"], vitapod: "v" };
  got = evaluate(s, look);
  assert.ok(got.includes("LEVELLED_ITEM_1") && !got.includes("SLOTS_FILLED_1"), "costumes are sockets too");
  s.appearance = { costume: { armor: "x", helmet: "y", shield: "z" } };
  assert.deepEqual(evaluate(s, look), ["SLOTS_FILLED_1"]);
});

test("depths, clearance and Haven", () => {
  const s = source();
  assert.deepEqual(recordHaven(s), ["REACHED_RESCUE_CAMP", "REACHED_HAVEN"]);
  assert.deepEqual(recordHaven(s), []);
  s.bestDepth = 8;
  s.missions = { rank: 4 };
  assert.deepEqual(evaluate(s, look).sort(), ["EARNED_TIER_2", "REACHED_SUBTOWN_1", "REACHED_TERMINAL_1"]);
  assert.equal(progressText(s, "REACHED_CORE_TERMINAL", look), "8 / 29");
});

test("capsules, kills, revives and bosses", () => {
  const s = source();
  for (let i = 0; i < 9; i++) recordPocketUse(s, "Pickup/Capsule/Health Capsule");
  recordPocketUse(s, "Pickup/Capsule/Remedy Capsule");
  recordPocketUse(s, "Pickup/Capsule/Buffs/Attack Booster");
  assert.ok(!evaluate(s, look).includes("HEALTH_CAPSULES_USED_1"));
  recordPocketUse(s, "Pickup/Capsule/Ultra Health Capsule");
  assert.ok(evaluate(s, look).includes("HEALTH_CAPSULES_USED_1"));
  assert.equal(s.achievements!.stats.remedyCapsulesUsed, 1);
  recordKills(s, 12); recordKills(s, 3);
  assert.equal(s.achievements!.stats.kills, 15);
  recordRevive(s);
  assert.ok(evaluate(s, look).includes("REVIVE_SELF"));
  assert.deepEqual(recordBoss(s, "twins"), ["DEFEATED_ROARMULUS"]);
  assert.deepEqual(recordBoss(s, "twins"), []);
  assert.deepEqual(recordBoss(s, "nobody"), []);
});

test("runs: tiers without revives and the full Clockworks", () => {
  const s = source();
  recordRunStart(s, 0);
  assert.deepEqual(recordDepth(s, 4), []);
  assert.deepEqual(recordDepth(s, 8), ["REVIVELESS_COMPLETE_TIER_1"]);
  recordRevive(s);
  assert.deepEqual(recordDepth(s, 18), [], "revived during tier 2");
  assert.deepEqual(recordDepth(s, 29), ["FULL_RUN"]);
  assert.ok(!isUnlocked(s, "REVIVELESS_FULL_RUN"));
  recordRunEnd(s);
  assert.deepEqual(recordDepth(s, 29), [], "no run under way");
  // a run setting out from tier 3's town completes tier 3 only
  recordRunStart(s, 18);
  assert.deepEqual(recordDepth(s, 29), ["REVIVELESS_COMPLETE_TIER_3"]);
  assert.equal(s.achievements!.stats.deepest, 29);
});

test("a save's achievements are repaired on load", () => {
  const a = normalizeAchievements({ unlocked: { FULL_RUN: 5, BOGUS: 3, REVIVE_SELF: "x" }, stats: { kills: "7", bad: "q" }, run: { start: 2, revived: 1 } });
  assert.deepEqual(a, { unlocked: { FULL_RUN: 5 }, stats: { kills: 7 }, run: { start: 2, revived: true } });
  assert.deepEqual(normalizeAchievements(null), { unlocked: {}, stats: {}, run: null });
});
