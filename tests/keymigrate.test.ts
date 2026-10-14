import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, migrateKeys } from "../src/ui/settings.ts";

test("old default keys move to the client's, removed actions are dropped", () => {
  const d = defaultSettings().keys;
  const k = migrateKeys(d, { forge: "k", help: "h", dash: " ", cycle: "tab", backpack: "b", arsenal: "i", up: "z" });
  assert.equal(k.forge, "u");
  assert.equal(k.help, "f1");
  assert.equal(k.map, "b");
  assert.equal(k.dash, "");
  assert.equal(k.cycle, " ");
  assert.equal(k.up, "z");
  assert.ok(!("backpack" in k));
});
