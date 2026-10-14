// Dropped crowns and other pickups: the material technique for the default scheme, the near
// level-of-detail case of a distance conditional, and on the install the gold crown's model (the
// 3D gold coin with its sheen pass, unlit, its drop animation and spin).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pickTechnique } from "../src/config/materials.ts";
import { nearCase } from "../src/model.ts";

test("a material draws with its technique for the default scheme, not a Low Detail one listed first", () => {
  const low = { scheme: "Low Detail", n: 1 }, def = { n: 2 }, trans = { scheme: "Translucent", n: 3 };
  assert.equal(pickTechnique([low, def, trans]), def);
  assert.equal(pickTechnique([def, low]), def);
  assert.equal(pickTechnique([low]), low, "a material with only a scheme's technique keeps it");
});

test("a distance conditional's near case holds at the game camera's distance", () => {
  const cond = (d: number) => ({ $class: "com.threerings.expr.BooleanExpression$FloatLess",
    firstOperand: { $class: "com.threerings.expr.FloatExpression$Reference", name: "distance" },
    secondOperand: { $class: "com.threerings.expr.FloatExpression$Constant", value: d } });
  assert.equal(nearCase(cond(25)), true);
  assert.equal(nearCase(cond(20)), true);
  assert.equal(nearCase(cond(5)), false, "a close-up only switch stays on its default");
  assert.equal(nearCase({ ...cond(25), firstOperand: { $class: "x.FloatExpression$Reference", name: "time" } }), false);
});

const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
const haveInstall = existsSync(join(SK, "rsrc", "item", "consumable", "crown", "model.dat"));

test("on the install: a gold crown drops as the bright gold coin, spinning, with its sheen", { skip: !haveInstall }, async () => {
  const { GameData } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const loader = nodeLoader();
  const data = new GameData(loader);
  await data.preload("config/actor.dat");
  const cfg = data.resolveSync("config/actor.dat", { name: "Item/Consumable/Crowns/Gold Crown" }, "actor");
  assert.equal(cfg.vacuumSpeed, 8, "crowns fly to the knight");
  const crown = (await loader.loadRef(cfg.sprite.model))!;
  assert.equal(crown.receivesLights, false, "dropped crowns take no lights (drawn unlit)");
  assert.deepEqual(crown.autoAnimations, ["item/drop/animation.dat"], "it pops up with the drop animation");
  const all: any[] = [];
  const walk = (m: any) => { all.push(m); for (const a of m.attachments) walk(a.model); };
  walk(crown);
  const coin = all.find(m => m.path === "item/consumable/crown/coin-hd.dat");
  assert.ok(coin, "the near (3D) coin, not the flat far stand-in");
  assert.ok(!all.some(m => m.path === "item/consumable/crown/crown-ld.dat"));
  assert.equal(coin.receivesLights, false);
  assert.ok(coin.procedurals.length > 0, "the coin spins (rotate_z)");
  const mat = coin.parts[0].material;
  assert.equal(mat.passes.length, 2, "the coin's base pass and its additive sheen");
  assert.equal(mat.passes[0].units[0].texture, "item/consumable/crown/skin_gold.png", "the gold skin, not copper");
  assert.equal(mat.passes[1].units[0].texture, "particle/texture/sheen.png");
  assert.equal(mat.passes[1].destBlend, "ONE");
});
