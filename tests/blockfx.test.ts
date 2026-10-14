// Block feedback (the client's BlockSprite): each hit's transient, the stateful blocks' states
// by hits taken, and the destruction transient with what its script spawns. The install tests
// read config/actor.dat and the effect files in place and skip when the game is not installed.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { blockState, spawnedModels } from "../src/game/world.ts";
import { Prop } from "../src/game/props.ts";

const ref = (name: string, entries: [string, unknown][] = []) =>
  ({ $class: "com.threerings.config.ConfigReference", name, arguments: { $map: "com.threerings.config.ArgumentMap", entries } });

test("a stateful block's state is the hits it has taken", () => {
  const stone = { hits: true, maxHealth: 3, health: 3 };
  assert.equal(blockState(stone), 0);
  assert.equal(blockState({ ...stone, health: 2 }), 1);
  assert.equal(blockState({ ...stone, health: 1 }), 2);
  assert.equal(blockState({ hits: true, maxHealth: 0, health: 0 }), 0);
});

test("a scripted transient's spawned models are found through compound actions and attachments", () => {
  const fx = ref("particle/fx_breakable_break_cwt.dat", [["Texture", "a.png"]]);
  const snd = { $class: "com.threerings.opengl.model.config.ActionConfig$PlaySound" };
  const m: any = { attachments: [], script: { loopDuration: 0, actions: [
    { time: 0, action: { $class: "com.threerings.opengl.model.config.ActionConfig$SpawnTransient", model: fx } },
    { time: 0, action: snd },
    { time: 0.2, action: { $class: "x.ActionConfig$Compound", actions: [{ $class: "x.ActionConfig$SpawnTransient", model: ref("particle/b.dat") }] } },
  ] } };
  const outer: any = { attachments: [{ model: m }] };
  assert.deepEqual(spawnedModels(outer).map(r => r.name), ["particle/fx_breakable_break_cwt.dat", "particle/b.dat"]);
});

test("the stone's state models and a mineral node's state animations keep their state indices", () => {
  const stone = new Prop("block", {} as any, { sprite: { $class: "x.DungeonActorSpriteConfig$StatefulModelBlock",
    states: [{ model: ref("m.dat", [["Model", "mesh_block00"]]) }, { model: ref("m.dat", [["Model", "mesh_block01"]]) }] } });
  assert.equal(stone.stateModels.length, 2);
  assert.equal(stone.stateAnims.every(a => a === null), true);
  const timed = new Prop("block", {} as any, { sprite: { $class: "x.DungeonActorSpriteConfig$StatefulBlock", states: [{}, { animation: ref("countdown.dat") }] } });
  assert.equal(timed.stateAnims[0], null);
  assert.equal(timed.stateAnims[1].name, "countdown.dat");
  assert.equal(timed.stateModels.length, 0);
});

const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
const haveInstall = existsSync(join(SK, "rsrc", "config", "actor.dat"));

test("on the install: a breakable block's destruction spawns its fragments and a stone cracks by state", { skip: !haveInstall }, async () => {
  const { GameData } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const loader = nodeLoader();
  const data = new GameData(loader);
  await data.preload("config/actor.dat");
  // as the Clockworks breakable placeable spawns it, with its texture
  const tex = "world/dynamic/block/breakable/clockworks/base.png";
  const cfg = data.resolveSync("config/actor.dat", ref("Block/Breakable/Parts/Clockworks (base)", [["Texture", tex]]), "actor");
  assert.equal(cfg.sprite.hitTransient.name, "particle/fx_gethit_block.dat");
  const fx = cfg.sprite.destructionTransient;
  assert.equal(fx.name, "model/scripted/transient_sound.dat");
  const script = (await loader.loadRef(fx))!;
  assert.ok(script.script, "the destruction transient is a scripted model");
  const spawned = spawnedModels(script);
  assert.deepEqual(spawned.map(r => r.name), ["particle/fx_breakable_break_cwt.dat"]);
  const pieces = (await loader.loadRef(spawned[0]))!;
  const layers = pieces.particles ?? [];
  assert.equal(layers.length, 5, "five fragments fly off");
  for (const l of layers) {
    assert.equal(l.geometry, "Meshes");
    assert.ok(l.model?.parts.length, `${l.name} has its fragment mesh`);
    assert.equal(l.material.passes[0].units[0]?.texture, tex, "the fragments wear the block's texture");
  }
  // the stone: three hits, a cracked model for each of the first two
  const stoneCfg = data.resolveSync("config/actor.dat", { name: "Block/Stone" }, "actor");
  const stone = new Prop("block", {} as any, stoneCfg);
  assert.deepEqual(stone.stateModels.map(m => m.arguments.entries.find((e: any) => e[0] === "Model")[1]), ["mesh_block00", "mesh_block01", "mesh_block02"]);
  // a mineral node: hit animations for states 0 to 2
  const node = new Prop("block", {} as any, data.resolveSync("config/actor.dat", { name: "Block/Mineral/Crimsonite Node" }, "actor"));
  assert.deepEqual(node.stateAnims.map(a => a.name.split("/").pop()), ["animation_hit0.dat", "animation_hit1.dat", "animation_hit2.dat"]);
});
