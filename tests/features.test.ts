import assert from "node:assert/strict";
import { test } from "node:test";
import { generateLevel } from "../src/gen/level.ts";
import { addFeatures, layoutFor, type FloorStyle } from "../src/gen/features.ts";
import { rng } from "../src/gen/layout.ts";
import { gateFloors, makeGate } from "../src/game/clockworks.ts";
import { prismFaces, traceBeam, type BeamCell } from "../src/game/objects.ts";

// the L bend prism and receiver (actor.dat Block/Prism/L Bend, Receiver): receptor faces
const L_BEND = { receptors: [{ shape: { transform: { translation: { x: 0.5, y: 0 } } } }, { shape: { transform: { translation: { x: 0, y: -0.5 } } } }] };
const RECEIVER = { receptors: [{}] };

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
      const { root, report } = floor(style, seed);
      assert.ok(report.reachable, `${style} ${seed}: exit reachable`);
      // every shut switch gate has its opener: a platform or a start-up button naming its tag
      for (const e of root.entries as any[]) {
        const args: [string, any][] = e.placeable?.arguments?.entries ?? [];
        if (!/\/Door\//.test(e.placeable?.name ?? "") || args.find(([k]) => k === "Open")?.[1] !== false) continue;
        const tag = JSON.stringify(args.find(([k]) => k === "Tag")?.[1]);
        assert.ok((root.entries as any[]).some(o => /Party Platform|Start Up Trigger"?$|Start Up Trigger$|Prism\/Receiver/.test(o.placeable?.name ?? "")
          && JSON.stringify(o.placeable.arguments).includes(tag)), `${style} ${seed}: gate ${tag} has an opener`);
      }
      assert.ok(report.keysReachable, `${style} ${seed}: key reachable`);
      for (const f of report.features) seen.add(f);
    }
  }
  // the features all turn up somewhere in a few dozen floors
  for (const f of ["gold key", "secret room", "spike run", "danger room", "arena hall", "treasure vault", "decoration",
    "crystal gate", "explosive wall", "trap run", "prism gate", "rescue cage", "healing totems", "gun block"]) assert.ok(seen.has(f), `${f} appears`);
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

test("crystal gates have their key on the near side, and prism puzzles solve in a few turns", () => {
  const arg = (e: any, k: string) => (e.placeable?.arguments?.entries as [string, any][] | undefined)?.find(([n]) => n === k)?.[1];
  const at = (e: any) => e.transform.translation;
  // the actor facing of an entry: its rotation less a quarter turn
  const quarter = (e: any) => Math.round(2 * Math.atan2(e.transform.rotation.z, e.transform.rotation.w) / (Math.PI / 2)) - 1;
  let gates = 0, prisms = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const { root, report } = floor("standard", seed);
    const es = root.entries as any[];
    if (report.features.includes("crystal gate")) {
      gates++;
      const key = report.marks.find(m => m.kind === "crystal key")!;
      const keyEntry = es.find(e => /^Dynamic\/Block\/Crystal\/(Blue|Green|Purple|Pink|Gold|Gray)$/.test(e.placeable?.name ?? "") && at(e).x === key.x && at(e).y === key.y);
      assert.ok(keyEntry, `${seed}: key crystal placed`);
      const colour = keyEntry.placeable.name.split("/").pop();
      // it touches an unbreakable crystal of its colour
      assert.ok(es.some(e => e.placeable?.name === `Dynamic/Block/Crystal/Unbreakable/${colour}` && Math.abs(at(e).x - key.x) + Math.abs(at(e).y - key.y) === 1), `${seed}: key touches its wall`);
    }
    if (report.features.includes("prism gate")) {
      prisms++;
      const em = es.find(e => e.placeable?.name === "Dynamic/Block/Prism/Emitter");
      const pr = es.find(e => e.placeable?.name === "Dynamic/Block/Prism/L Bend");
      const rc = es.find(e => e.placeable?.name === "Dynamic/Block/Prism/Receiver");
      assert.ok(em && pr && rc && JSON.stringify(arg(rc, "On Action")).includes('"open"'));
      // the beam reaches the receiver once the prism has been struck one to three times
      const cells = new Map<string, BeamCell>();
      const id = (e: any) => `${Math.floor(at(e).x)},${Math.floor(at(e).y)}`;
      let solvedAfter = -1;
      for (let hits = 0; hits < 4 && solvedAfter < 0; hits++) {
        cells.set(id(pr), { kind: "prism", id: 1, faces: prismFaces(L_BEND), rotation: (quarter(pr) + hits) * Math.PI / 2 });
        cells.set(id(rc), { kind: "prism", id: 2, faces: prismFaces(RECEIVER), rotation: 0 });
        const r = traceBeam(Math.floor(at(em).x), Math.floor(at(em).y), ((quarter(em) % 4) + 4) % 4, "blue", (x, y) => cells.get(`${x},${y}`) ?? { kind: "open" }, () => false);
        if (r.lit.has(2)) solvedAfter = hits;
      }
      assert.ok(solvedAfter >= 1 && solvedAfter <= 3, `${seed}: prism solves after ${solvedAfter} hits`);
    }
  }
  assert.ok(gates > 3 && prisms > 3, `${gates} crystal gates, ${prisms} prism gates`);
});
