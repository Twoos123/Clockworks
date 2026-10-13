import assert from "node:assert/strict";
import { test } from "node:test";
import { generateLevel } from "../src/gen/level.ts";
import { addFeatures, layoutFor, type FloorStyle } from "../src/gen/features.ts";
import { rng } from "../src/gen/layout.ts";
import { gateFloors, makeGate } from "../src/game/clockworks.ts";

// A synthetic source level: a floor ringed by edges, with the start pad, the exit elevator, a
// spawner and a treasure box (the entries generated floors copy).
function source() {
  const refs = [{ name: "T/Floor/Base" }, { name: "T/Edge/Cliff" }, { name: "T/Edge/Corner" }];
  const values = new Int32Array(64).fill(-1);
  const set = (x: number, y: number, tile: number, rot: number) => { values[(y << 3) | x] = (tile << 16) | rot; };
  for (let x = 1; x <= 6; x++) for (let y = 1; y <= 6; y++) set(x, y, 0, 0);
  for (let i = 1; i <= 6; i++) { set(i, 0, 1, 0); set(7, i, 1, 1); set(i, 7, 1, 2); set(0, i, 1, 3); }
  set(0, 0, 2, 0); set(7, 0, 2, 1); set(7, 7, 2, 2); set(0, 7, 2, 3);
  const P = "com.threerings.tudey.data.TudeySceneModel$PlaceableEntry";
  const args = (e: [string, unknown][]) => ({ $map: "com.threerings.config.ArgumentMap", entries: e });
  const entry = (name: string, a?: [string, unknown][]) => ({ $class: P, placeable: { name, arguments: a ? args(a) : undefined }, transform: {} });
  return {
    tileConfigs: refs.map(tile => ({ tile })), tiles: { granularity: 3, empty: -1, cells: { entries: [[{ x: 0, y: 0 }, { values }]] } },
    entries: [entry("Dynamic/Elevator/Start Platform"), entry("Dynamic/Elevator/Next Floor"), entry("Dynamic/Block/Treasure/Normal"),
      entry("Character/Monster/Generic/Single Spawn", [["Spawn Table", { name: "Monster/Class {stc}/Family/Beast/Beast - Grunt", arguments: args([["Wave Tag", "w"]]) }],
        ["Spawn Tag", "s"], ["Wave Number", "1"]])],
  };
}

const info = (r: any) => ({ width: 1, height: 1, walkable: /Floor/.test(r?.name ?? "") });
const floor = (style: FloorStyle, seed: number) => {
  const root = generateLevel([{ id: "src", root: source() }], info, seed, "test", [], { layout: layoutFor(style) });
  const report = addFeatures(root, { style, theme: "clockworks", rand: rng(seed ^ 77), tables: ["Monster/Class {stc}/Family/Beast/Beast - Grunt"] });
  return { root, report };
};
const names = (root: any) => (root.entries as any[]).map(e => e.placeable?.name ?? e.area?.name ?? "");

test("every generated floor reaches its exit with its puzzles solved, and every key with its gate shut", () => {
  const seen = new Set<string>();
  for (const style of ["standard", "danger", "vault", "arena"] as FloorStyle[]) {
    for (let seed = 1; seed <= 40; seed++) {
      const { report } = floor(style, seed);
      assert.ok(report.reachable, `${style} ${seed}: exit reachable`);
      assert.ok(report.keysReachable, `${style} ${seed}: key reachable`);
      for (const f of report.features) seen.add(f);
    }
  }
  // the features all turn up somewhere in a few dozen floors
  for (const f of ["gold key", "secret room", "spike run", "danger room", "arena hall", "treasure vault", "decoration"]) assert.ok(seen.has(f), `${f} appears`);
  assert.ok(seen.has("block wall") || seen.has("crystal wall"), "a block wall appears");
});

test("gold gates are the only way on, and their keys sit on altars", () => {
  let checked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { root, report } = floor("standard", seed);
    if (!report.features.includes("gold key")) continue;
    const n = names(root);
    assert.equal(n.filter(x => x === "Dynamic/Door/Iron Gate/Gold 3").length, 1);
    assert.equal(n.filter(x => x === "Dynamic/Lift Objects/Gold Key").length, 1);
    assert.equal(n.filter(x => x === "Dynamic/Misc/Altar/Gold Key").length, 1);
    checked++;
  }
  assert.ok(checked > 5);
});

test("vaults have no fights; danger rooms and arenas chain their waves to a reward", () => {
  const vault = floor("vault", 3).root;
  assert.ok(!names(vault).some(x => /Single Spawn|Player Enter/.test(x)));
  assert.ok(names(vault).filter(x => /Treasure\/(Vault|Rare)/.test(x)).length >= 4);
  for (const style of ["danger", "arena"] as FloorStyle[]) {
    const { root, report } = floor(style, 5);
    assert.ok(report.features.includes(style === "danger" ? "danger room" : "arena hall"));
    const removed = (root.entries as any[]).filter(e => e.placeable?.name === "Trigger/Actor Removed"
      && String(e.placeable.arguments.entries.find(([k]: [string]) => k === "Actor Tag")?.[1]).startsWith("feat wave"));
    assert.equal(removed.length, style === "danger" ? 4 : 5);
    // the last wave's trigger opens the gate and activates the reward
    const last = JSON.stringify(removed[removed.length - 1].placeable.arguments);
    assert.ok(/"open"/.test(last) && /reward/.test(last));
  }
});

test("some strata of a gate hold a special floor", () => {
  let specials = 0, vaults = 0;
  for (let s = 1; s <= 30; s++) {
    for (const f of gateFloors(makeGate(s * 7919))) {
      if (!f.special) continue;
      specials++;
      assert.equal(f.kind, "level");
      assert.ok(f.depth > f.stratum!.first);
      if (f.special === "vault") { vaults++; assert.equal(f.tileset, "prize-vault"); }
    }
  }
  assert.ok(specials > 30 && vaults > 0);
});
