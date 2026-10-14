// The HUD's client rules that are plain data: the help notice's key for an action description
// (ActionDesc.LD), a description's bundle (DescriptionConfig.BT) and the prestige rank icon
// (ProjectXCodes.PrestigeRank).
import assert from "node:assert/strict";
import { test } from "node:test";
import { actionHint, descriptionBundle } from "../src/game/action.ts";
import { prestigeIcon } from "../src/game/missions.ts";

const AD = "com.threerings.projectx.config.ActionDesc$";
const DC = "com.threerings.projectx.config.DescriptionConfig$";

test("action hints follow the action description's class", () => {
  assert.equal(actionHint({ $class: AD + "Shop" }), "m.shop");
  assert.equal(actionHint({ $class: AD + "Talk" }), "m.talk");
  assert.equal(actionHint({ $class: AD + "UnlockGold" }), "m.unlock_gold");
  assert.equal(actionHint({ $class: AD + "CustomInteract", helpTip: "m.sit" }), "m.sit");
  assert.equal(actionHint({ $class: AD + "Furni" }), "m.interact");
  assert.equal(actionHint(null, "m.talk"), "m.talk");
  assert.equal(actionHint(undefined), "m.interact");
});

test("descriptions read their text from their kind's bundle", () => {
  assert.equal(descriptionBundle(DC + "Shop"), "shop");
  assert.equal(descriptionBundle(DC + "Statue"), "item");
  assert.equal(descriptionBundle(DC + "Monster"), "monster");
  assert.equal(descriptionBundle(DC + "Descriptive"), "projectx");
});

test("prestige ranks: no icon below 5000, then prank_001 to prank_005", () => {
  assert.equal(prestigeIcon(0), null);
  assert.equal(prestigeIcon(4999), null);
  assert.equal(prestigeIcon(5000), "ui/icon/prestige/prank_001.png");
  assert.equal(prestigeIcon(24999), "ui/icon/prestige/prank_003.png");
  assert.equal(prestigeIcon(45000), "ui/icon/prestige/prank_005.png");
});
