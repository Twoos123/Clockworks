import assert from "node:assert/strict";
import { test } from "node:test";
import { isMessageKey, messageText, RangeModel } from "../src/ui/gui.ts";

test("message keys read as English", () => {
  assert.equal(messageText("m.music_volume"), "Music Volume");
  assert.equal(messageText("b.disp_apply"), "Apply");
  assert.equal(messageText("l.ui_scale"), "UI Scale");
  assert.equal(messageText("%town:m.border_guildhall"), "Guild Hall");
  assert.equal(messageText("t.activities"), "Activities");
  assert.equal(messageText("m.party_found.1"), "Party Found");
  assert.equal(messageText("m.party_with_any"), "Party with Anyone");
  assert.equal(messageText("m.display_npc_names"), "Display NPC Names");
  assert.equal(messageText("m.welcome|Bob"), "Welcome");
  assert.ok(isMessageKey("m.general") && isMessageKey("%town:m.border_bazaar"));
  assert.ok(!isMessageKey("Enter item name...") && !isMessageKey("x0") && !isMessageKey("100%"));
});

test("range model clamps values like BoundedRangeModel", () => {
  const m = new RangeModel(0, 0, 0, 100);
  assert.equal(m.setValue(150), true);
  assert.equal(m.value, 100);
  assert.equal(m.setValue(100), false);
  m.setRange(0, 40, 220, 781);
  assert.equal(m.extent, 220);
  m.setValue(700);
  assert.equal(m.value, 561); // max - extent
  assert.equal(m.scrollIncrement, 110);
  const s = new RangeModel(0, 0, 10, 100);
  s.snap = 25;
  s.setValue(60);
  assert.equal(s.value, 50);
  assert.equal(s.scrollIncrement, 25);
});
