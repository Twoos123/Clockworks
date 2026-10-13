import assert from "node:assert/strict";
import { test } from "node:test";
import { arcadeGates, gateFloors, makeGate } from "../src/game/clockworks.ts";

test("a gate runs from the Arcade at depth 0 to the Core's terminal at 29", () => {
  const floors = gateFloors(makeGate(12345));
  assert.equal(floors.length, 30);
  assert.equal(floors[0].kind, "lobby");
  for (const d of [4, 13, 23]) assert.equal(floors[d].kind, "terminal");
  assert.equal(floors[8].name, "Moorcroft Manor");
  assert.equal(floors[18].name, "Emberlight");
  assert.equal(floors[29].kind, "core");
  assert.deepEqual([floors[3].tier, floors[8].tier, floors[17].tier, floors[18].tier, floors[28].tier], [1, 2, 2, 3, 3]);
  for (const f of floors) if (f.kind === "level" || f.kind === "boss") assert.ok(f.stratum && f.tileset, `depth ${f.depth} has a stratum and tileset`);
});

test("strata in one tier never share a theme, and bosses sit at a stratum's last floor", () => {
  for (const g of [...arcadeGates(100), ...arcadeGates(101)]) {
    for (const t of [1, 2, 3]) {
      const themes = g.strata.filter(s => s.tier === t).map(s => s.theme);
      assert.equal(new Set(themes).size, themes.length);
    }
    const floors = gateFloors(g);
    for (const f of floors) if (f.kind === "boss") assert.equal(f.depth, f.stratum!.last);
  }
});
