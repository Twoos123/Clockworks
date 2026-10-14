// Attack movement (AttackConfig impulseReceived, the client's ItemImpulse): each sword swing's
// step from its config, turned by the knight's facing. The install test reads the sword configs
// in place and skips when the game is not installed.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { attackImpulse } from "../src/game/world.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("an attack's impulse is its translation along the facing, over its duration", () => {
  const imp = { forward: 2, side: 0, delay: 100, duration: 150 };
  const east = attackImpulse(imp, 0);
  near(east.dx, 2); near(east.dy, 0); near(east.dur, 0.15);
  const north = attackImpulse(imp, Math.PI / 2);
  near(north.dx, 0); near(north.dy, 2);
  // a sideways component goes to the knight's left; a slowed knight stretches the duration
  const side = attackImpulse({ forward: 0, side: 1, delay: 0, duration: 200 }, 0, 0.5);
  near(side.dx, 0); near(side.dy, 1); near(side.dur, 0.4);
  // gun charges kick back
  near(attackImpulse({ forward: -0.667, side: 0, delay: 286, duration: 300 }, 0).dx, -0.667);
});

const SK = process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
const haveInstall = existsSync(join(SK, "rsrc", "config", "attack.dat"));

test("on the install: a sword combo steps the knight 0, 1.25 and 2 units, and its charge lunges", { skip: !haveInstall }, async () => {
  const { GameData } = await import("../src/game/data.ts");
  const { nodeLoader } = await import("../tools/audit/nodevfs.ts");
  const data = new GameData(nodeLoader());
  await data.preload("config/item.dat", "config/actor.dat", "config/attack.dat", "config/fire_action.dat");
  const sword = (await data.weapon("Weapon/Sword/Proto Sword"))!;
  assert.deepEqual(sword.attacks.map(a => a.impulse?.forward ?? 0), [0, 1.25, 2]);
  const second = sword.attacks[1].impulse!;
  assert.equal(second.delay, 100);
  near(attackImpulse(second, 0).dx, 1.25);
  near(attackImpulse(second, 0).dur, 0.15);
  assert.ok((sword.chargedAttack?.impulse?.forward ?? 0) > 0, "the charge release lunges forward");
  // the five-swing Cutter line steps on every swing but the first
  const cutter = (await data.weapon("Weapon/Sword/Wild Hunting Blade"))!;
  assert.deepEqual(cutter.attacks.map(a => a.impulse?.forward ?? 0), [0, 1.25, 1.25, 1.5, 2.5]);
  // a blaster's swings stand still; its charge kicks the knight back
  const gun = (await data.weapon("Weapon/Handgun/Blaster"))!;
  assert.ok(gun.attacks.every(a => !a.impulse));
  assert.ok((gun.chargedAttack?.impulse?.forward ?? 0) < 0);
});
