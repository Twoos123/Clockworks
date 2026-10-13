// Status conditions: the client's chance and power levels, difficulty mapping and the
// conditions resolved from the install's status_condition.dat (skipped without the game).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { importBinary } from "../src/export/BinaryImport.ts";
import { CHANCE, difficultyChance, POWER, StatusConditions } from "../src/game/status.ts";
import { DepthScales } from "../src/game/depth.ts";
import { nodeInflate, skDir } from "../tools/common.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("StatusChance and StatusPower levels", () => {
  assert.deepEqual(CHANCE, { LOW: 0.05, MEDIUM: 0.1, HIGH: 0.25, VERY_HIGH: 0.5, ULTRA: 0.65, MAXIMUM: 0.9 });
  assert.deepEqual(POWER, { MINOR: 20, MODERATE: 40, STRONG: 60, DEADLY: 80, ULTIMATE: 100 });
});

test("difficulty maps a chance between the level steps", () => {
  near(difficultyChance(0.25, "medium"), 0.25);
  near(difficultyChance(0.25, "easy"), 0.1);
  near(difficultyChance(0.25, "hard"), 0.5);
  // halfway between HIGH (0.25) and VERY_HIGH (0.5) on hard: halfway between 0.5 and 0.65
  near(difficultyChance(0.375, "hard"), 0.575);
  near(difficultyChance(0.9, "hard"), 0.9);
  near(difficultyChance(1, "easy"), 1);
});

const have = existsSync(join(skDir(), "rsrc", "config", "status_condition.dat"));
test("conditions resolve with their levels and class defaults", { skip: !have }, async () => {
  const read = async (f: string) => {
    const r: any = await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", f))), nodeInflate);
    const list: any[] = Array.isArray(r.root) ? r.root : r.root?.array ?? [];
    return new Map(list.map(c => [c.name as string, c]));
  };
  const lib = await read("config/status_condition.dat");
  const scales = await read("config/depth_scale.dat");
  const depth = new DepthScales({ importFile: async () => [...scales.values()] } as any);
  await depth.ready();
  const conds = new StatusConditions(lib, depth);
  const ctx = { depth: 10, rarity: 0, difficulty: "medium" as const };
  let seen = 0;
  for (const name of lib.keys()) {
    const got = conds.get({ name }, ctx);
    if (!got) continue;
    seen++;
    const d = got.def;
    assert.ok(got.chance >= 0 && got.chance <= 1, name);
    assert.ok(d.power >= 0 && d.power <= 1, name);
    assert.ok(d.duration >= 0 && Number.isFinite(d.duration), `${name}: ${d.duration}`);
    if (d.kind === "Poison") assert.ok(d.attack < 1 && d.defense < 1 && d.heal < 1, name);
    if (d.kind === "Stun" || d.kind === "Slow") assert.ok(d.speed >= 0 && d.speed <= 1, `${name}: ${d.speed}`);
    if (d.kind === "Fire") assert.ok(d.interval > 0, name);
  }
  assert.ok(seen > 10, String(seen));
});
