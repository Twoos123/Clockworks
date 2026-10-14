// Meta particle layers whose particles are scripted models (src/game/metascripts.ts): a bomb's
// area explosion is a meta particle system of transient_sound.dat particles, one at the centre
// and eight on the blast ring, each of which spawns a bomb_blast.dat and plays the blast sound.
// Nothing of it is drawn by the renderer, so the world runs each particle's script as it is
// born. Also: a following transient keeps its offset on its actor (a gun's muzzle flash).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compose, invert, multiply } from "../src/math.ts";
import { skDir } from "../tools/common.ts";

const SK_RSRC = join(skDir(), "rsrc");

test("on the install: the Proto Bomb's blast bears its centre and ring blasts, each a scripted blast with its sound",
  { skip: !existsSync(join(SK_RSRC, "config", "actor.dat")) }, async () => {
  const { GameData } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const { MetaScripts, hasScript } = await import("../src/game/metascripts.ts");
  const loader = nodeLoader();
  const data = new GameData(loader);
  await data.preload("config/item.dat", "config/actor.dat", "config/attack.dat", "config/fire_action.dat");
  const w = (await data.weapon("Weapon/Bomb/Proto Bomb"))!;
  const bomb = (await data.projectile(w.chargedAttack!.fires.find(f => f.spawn)!.spawn!.actor))!;
  // the detonation: a script whose first action spawns the area explosion
  const area = (await loader.loadRef(bomb.hitFx))!;
  assert.ok(area.script, "the area explosion is scripted");
  const spawn = area.script!.actions.find(a => /SpawnTransient$/.test(a.action.$class))!.action;
  const meta = (await loader.loadRef(spawn.model))!;
  assert.ok(meta.particles?.length, "it spawns a meta particle system");
  const runner = MetaScripts.of(meta);
  assert.ok(runner, "whose layers' particles are scripted");
  // the bomb on the ground at (10, 4)
  const at = compose([10, 4, 0], [0, 0, 0, 1], 1);
  const first = runner!.step(0, at);
  assert.equal(first.length, 1, "the centre blast is born at once");
  assert.ok(Math.hypot(first[0].matrix[12] - 10, first[0].matrix[13] - 4) < 1e-4, "at the bomb");
  const births = [...first];
  // (the particles live 3 s, as the transients they carry)
  for (let t = 0; t < 4 && !runner!.done; t += 1 / 60) births.push(...runner!.step(1 / 60, at));
  assert.equal(births.length, 9, "the centre and eight around the ring");
  for (const b of births.slice(1)) {
    const r = Math.hypot(b.matrix[12] - 10, b.matrix[13] - 4);
    assert.ok(r <= 2.45 + 1e-3, `on the blast's radius (${r})`);
  }
  assert.ok(runner!.done, "then it ends");
  // each particle's model is the blast transient with its sound
  for (const b of births) {
    assert.ok(hasScript(b.model));
    const kinds = b.model.script!.actions.map(a => String(a.action.$class).split("$").pop());
    assert.ok(kinds.includes("SpawnTransient") && kinds.includes("PlaySound"), kinds.join(","));
    const blast = b.model.script!.actions.find(a => /SpawnTransient$/.test(a.action.$class))!.action.model;
    assert.equal(blast.name, "particle/explosion/bomb_blast.dat");
  }
  // the bomb's own model (its expanding mesh, fuse rings and drop sound) has no scripted meta layer
  const body = (await loader.loadRef(bomb.model))!;
  assert.equal(body.attachments.map(a => MetaScripts.of(a.model)).filter(Boolean).length, 0);
});

test("a following transient keeps its offset on its actor as the actor moves and turns", () => {
  // the knight at (2, 3) facing +x (its sprite turned a quarter past its heading)
  const actor = (x: number, y: number, h: number) => compose([x, y, 0], [0, 0, Math.sin((h + Math.PI / 2) / 2), Math.cos((h + Math.PI / 2) / 2)], 1);
  const k0 = actor(2, 3, 0);
  // the muzzle flash's frame action: 1.2 ahead (model -y), 1.05 up
  const muzzle = multiply(k0, compose([-0.1, -1.2, 1.05], [0, 0, 0, 1], 1));
  assert.ok(Math.abs(muzzle[12] - 3.2) < 1e-5 && Math.abs(muzzle[14] - 1.05) < 1e-5, "ahead of the knight, at the gun's height");
  const local = multiply(invert(k0), muzzle);
  // the knight walks to (5, 5) and turns to face +y: the flash stays at the barrel
  const now = multiply(actor(5, 5, Math.PI / 2), local);
  assert.ok(Math.abs(now[12] - 5.1) < 1e-5 && Math.abs(now[13] - 6.2) < 1e-5 && Math.abs(now[14] - 1.05) < 1e-5,
    `at the barrel (${now[12]}, ${now[13]}, ${now[14]})`);
});
