// The knockout as the client shows it: the low-health frame stays up while the knight is down,
// and the floor's heat spills out as orbs (and flies back on the revive).
import assert from "node:assert/strict";
import { test } from "node:test";
import { heatExpelCount, heatLevel } from "../src/game/feedback.ts";
import { lowHealthFrame } from "../src/ui/hud.ts";

test("the low-health frame is up under 30% of the trailing health, knocked out included", () => {
  assert.equal(lowHealthFrame(0, 300), true);
  assert.equal(lowHealthFrame(89, 300), true);
  assert.equal(lowHealthFrame(90, 300), false);
  assert.equal(lowHealthFrame(300, 300), false);
  assert.equal(lowHealthFrame(0, 0), false);
});

test("heat orbs: three per heat-meter level of the floor's heat (dungeon/client/ab thresholds)", () => {
  assert.equal(heatLevel(0), 0);
  assert.equal(heatExpelCount(0), 0);
  assert.equal(heatLevel(1), 1);
  assert.equal(heatExpelCount(20), 3);
  assert.equal(heatExpelCount(21), 6);
  assert.equal(heatExpelCount(800), 18);
  assert.equal(heatExpelCount(801), 21);
});
