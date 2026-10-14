import assert from "node:assert/strict";
import { test } from "node:test";
import { vitapodRule } from "../src/ui/shop.ts";

test("one vitapod goes in the cart, more is adjusted to one", () => {
  assert.deepEqual(vitapodRule(1, 3, null, null), { qty: 1, removeCart: false, adjusted: false });
  assert.deepEqual(vitapodRule(10, 3, null, null), { qty: 1, removeCart: false, adjusted: true });
});

test("a better vitapod replaces the cart's; a worse or equal one stays out", () => {
  assert.deepEqual(vitapodRule(1, 4, 3, null), { qty: 1, removeCart: true, adjusted: true });
  assert.deepEqual(vitapodRule(1, 3, 3, null), { qty: 0, removeCart: false, adjusted: true });
});

test("a vitapod no better than the one worn stays out", () => {
  assert.deepEqual(vitapodRule(1, 3, null, 3), { qty: 0, removeCart: false, adjusted: true });
  assert.deepEqual(vitapodRule(1, 4, null, 3), { qty: 1, removeCart: false, adjusted: false });
});
