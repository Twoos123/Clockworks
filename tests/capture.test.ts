import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importCaptured } from "../server/install";

test("captured floors import under fresh ids, skipping identical ones", () => {
  const base = mkdtempSync(join(tmpdir(), "capture-"));
  const archive = join(base, "scenes"), captured = join(base, "captured");
  mkdirSync(archive); mkdirSync(captured);
  writeFileSync(join(archive, "1900000000"), "floor A");          // already archived
  writeFileSync(join(captured, "1073741880_20261015-020000"), "floor A");
  writeFileSync(join(captured, "1073741880_20261015-021500"), "floor B"); // same instance id, new floor
  writeFileSync(join(captured, "1073741881_20261015-022000"), "floor C");
  assert.equal(importCaptured(archive), 2);
  assert.deepEqual(readdirSync(archive).sort(), ["1900000000", "1900000001", "1900000002"]);
  assert.equal(readdirSync(captured).filter(n => n !== "imported").length, 0);
  assert.equal(readdirSync(join(captured, "imported")).length, 3);
  assert.equal(importCaptured(archive), 0);
  assert.ok(existsSync(join(archive, "1900000002")));
});
