import { test } from "node:test";
import assert from "node:assert/strict";
import { blockHits } from "../src/game/world.ts";

test("block hits as the wiki gives them", () => {
  assert.equal(blockHits("Dynamic/Block/Treasure/Normal"), 1);
  assert.equal(blockHits("Dynamic/Block/Treasure/Rare"), 1);
  assert.equal(blockHits("Dynamic/Block/Stone"), 3);
  assert.equal(blockHits("Dynamic/Block/Mineral/Crimsonite"), 3);
  assert.equal(blockHits("Dynamic/Block/Barbed Hedgehog"), 1);
  assert.equal(blockHits("Dynamic/Breakable Objects/Gremlin/Battlefield/Barricade/Anti-vehicle Hedgehog"), 3);
  assert.equal(blockHits("Dynamic/Breakable Objects/Gravestones/Breakable, small block"), 1);
  assert.equal(blockHits("Dynamic/Block/Crystal/Blue"), 1);
});
