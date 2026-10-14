import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReel, CROWN_ITEMS, crownChoices, floorHasWheel, FULL_HEALTH, HEART_ITEMS, reelPosition, rollPrize, wheelTier, type PrizeSource } from "../src/game/prizewheel.ts";
import { ChatLog, shouldReportLoot, wrapText } from "../src/game/lootlog.ts";
import { labelPose, type LabelStyle } from "../src/game/feedback.ts";

const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
const src = (depth: number, material: string | null = "Craft/Bronze Bolt", pickup: string | null = "Pickup/Vial/Fire Vial"): PrizeSource =>
  ({ depth, material: () => material, pickup: () => pickup });

test("the wheel's tier follows the drops' tiers", () => {
  assert.equal(wheelTier(1), 1);
  assert.equal(wheelTier(7), 1);
  assert.equal(wheelTier(8), 2);
  assert.equal(wheelTier(18), 3);
});

test("crowns are always 5, 10, 25 or 50, more deeper", () => {
  for (const t of [1, 2, 3]) for (const n of crownChoices(t)) assert.ok([5, 10, 25, 50].includes(n));
  const p = rollPrize(src(1), seq(0, 0.99));
  assert.deepEqual(p, { kind: "crowns", item: CROWN_ITEMS[10], count: 10 });
  assert.equal(rollPrize(src(20), seq(0, 0)).count, 25);
});

test("prize kinds by the roll: material, heart by tier, pickup, full health", () => {
  assert.equal(rollPrize(src(3), seq(0.5)).kind, "material");
  assert.deepEqual(rollPrize(src(10), seq(0.8)), { kind: "heart", item: HEART_ITEMS[1], count: 1 });
  assert.equal(rollPrize(src(3), seq(0.9)).kind, "pickup");
  assert.equal(rollPrize(src(3), seq(0.99)).item, FULL_HEALTH);
  // nothing in the pools: crowns instead
  assert.equal(rollPrize(src(3, null, null), seq(0.5, 0)).kind, "crowns");
});

test("the reel holds the prize first and has the client's length", () => {
  const reel = buildReel(src(2), seq(0.1, 0.5));
  assert.equal(reel.length, 12);
  assert.equal(reel[0].kind, "crowns");
});

test("the reel eases out over four seconds and lands on the prize", () => {
  assert.equal(reelPosition(0, 12), 0.35);
  assert.equal(reelPosition(4, 12), 11);
  assert.equal(reelPosition(9, 12), 11);
  const half = reelPosition(1, 12), late = reelPosition(3, 12);
  assert.ok(half > 9 && late < 11 && late > half);
});

test("no wheel at lobbies, terminals, subtowns, the Core, or floors without monsters", () => {
  for (const k of ["lobby", "terminal", "subtown", "core"]) assert.equal(floorHasWheel(k, 10), false);
  assert.equal(floorHasWheel("normal", 0), false);
  assert.equal(floorHasWheel("normal", 3), true);
  assert.equal(floorHasWheel(undefined, 3), true);
});

test("loot messages: All, None, and Filtered (LootReportLevel PRO)", () => {
  assert.equal(shouldReportLoot("all", 0, 1, 1), true);
  assert.equal(shouldReportLoot("none", 6, 1, 1), false);
  assert.equal(shouldReportLoot("pro", 0, 1, 1), false);
  assert.equal(shouldReportLoot("pro", 1, 1, 4), true);
  assert.equal(shouldReportLoot("pro", 1, 1, 5), false);
  assert.equal(shouldReportLoot("pro", 6, 6, 1), false);
  assert.equal(shouldReportLoot("pro", 6, 1, 28), true);
});

test("the chat keeps its newest lines and wraps them", () => {
  const log = new ChatLog(3);
  for (let i = 0; i < 5; i++) log.add(`line ${i}`, "grey", i);
  assert.deepEqual(log.lines.map(l => l.text), ["line 2", "line 3", "line 4"]);
  assert.deepEqual(wrapText("You have obtained Material (Bronze Bolt).", 20, s => s.length), ["You have obtained", "Material (Bronze", "Bolt)."]);
});

test("particle labels drift a unit along their direction and shrink away at the end", () => {
  const l: LabelStyle = { color: "#fff", outline: "#000", size: 22, outlineSize: 8, width: 160, rise: -1, life: 2 };
  assert.equal(labelPose(l, 0)!.scale, 0);
  assert.equal(labelPose(l, 0.2)!.scale, 1);
  assert.ok(Math.abs(labelPose(l, 1.8)!.scale - 0.95) < 1e-9);
  assert.ok(labelPose(l, 1.9)!.dz < -0.99);
  assert.equal(labelPose(l, 2), null);
});
