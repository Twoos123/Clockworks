import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIVITY_MS, attackTiming, FREE, KnightControl, type AttackSlot, type ControlInput, type WeaponRules } from "../src/game/knight.ts";

/** A sword-like weapon: three combo steps, land 300 / rearm 500 / clear 900 ms, charges in 3 s. */
function sword(over: Partial<WeaponRules> = {}): WeaponRules {
  return {
    attacks: 3, charges: true, chargeTime: 3000, maxChain: 3, chainCooldown: 0, cycles: true, cooldown: false,
    bash: true, shield: true,
    timing: (s: AttackSlot) => s === "bash" ? { land: 100, rearm: 200, clear: 600, moves: false } : { land: 300, rearm: 500, clear: 900, moves: false },
    ...over,
  };
}

/** A blaster-like gun: three shots, a clip of three, 500 ms chain cooldown, a reload. */
function gun(): WeaponRules {
  return {
    attacks: 3, charges: true, chargeTime: 2500, maxChain: 3, chainCooldown: 500, cycles: false, cooldown: true,
    bash: false, shield: true,
    timing: (s: AttackSlot) => s === "cooldown" ? { land: 600, rearm: 700, clear: 1000, moves: true } : { land: 200, rearm: 350, clear: 700, moves: true },
  };
}

const idle = (): ControlInput => ({ attack: false, attackChanged: -1e6, defend: false, bash: false, dodge: false });

/** Runs one frame at `now`: the activity's own update, then the frame's input. */
function frame(c: KnightControl, now: number, input: ControlInput, w: WeaponRules) {
  return [...c.update(now, input, w), ...c.act(now, input, w, 8000)];
}

test("attack timing: each part over its speed, truncated, then over the attack speed", () => {
  const t = attackTiming({ land: 350, rearm: 83, clear: 833, startSpeed: 1.75, fireSpeed: 1, endSpeed: 0.67, blended: true }, 1, true);
  assert.deepEqual(t, { land: 200, rearm: 283, clear: 283 + Math.trunc(833 / 0.67), moves: true });
  const fast = attackTiming({ land: 350, rearm: 83, clear: 833, startSpeed: 1, fireSpeed: 1, endSpeed: 1, blended: false }, 1.24, true);
  assert.deepEqual(fast, { land: Math.trunc(350 / 1.24), rearm: Math.trunc(433 / 1.24), clear: Math.trunc(1266 / 1.24), moves: false });
});

test("a sword: a press during the swing that is still held at the rearm chains the next step", () => {
  const c = new KnightControl(), w = sword();
  let ev = frame(c, 0, { ...idle(), attack: true, attackChanged: 0 }, w);
  assert.deepEqual(ev, [{ type: "attack", slot: 0, at: 0 }]);
  assert.equal(c.allowsMovement(), false, "swords root the knight");
  assert.equal(c.allowsRotation(100), false, "and fix its facing until the rearm");
  // released, pressed again at 300 and held
  frame(c, 100, { ...idle(), attackChanged: 100 }, w);
  ev = frame(c, 300, { ...idle(), attack: true, attackChanged: 300 }, w);
  assert.deepEqual(ev, [], "not before the rearm");
  ev = frame(c, 500, { ...idle(), attack: true, attackChanged: 300 }, w);
  assert.deepEqual(ev, [{ type: "attack", slot: 1, at: 500 }]);
  assert.equal(c.chain(500), 2);
});

test("a sword: a click released before the rearm is not remembered", () => {
  const c = new KnightControl(), w = sword();
  frame(c, 0, { ...idle(), attack: true, attackChanged: 0 }, w);
  frame(c, 100, { ...idle(), attackChanged: 100 }, w);
  frame(c, 200, { ...idle(), attack: true, attackChanged: 200 }, w);
  frame(c, 300, { ...idle(), attackChanged: 300 }, w);
  assert.deepEqual(frame(c, 520, idle(), w), []);
  assert.equal(c.activity.slot, 0);
});

test("a sword: three steps, then the chain must lapse (maxChain) before the combo restarts", () => {
  const c = new KnightControl(), w = sword();
  const press = (t: number) => frame(c, t, { ...idle(), attack: true, attackChanged: t }, w);
  assert.equal(press(0)[0].type, "attack");
  assert.deepEqual(press(500), [{ type: "attack", slot: 1, at: 500 }]);
  assert.deepEqual(press(1000), [{ type: "attack", slot: 2, at: 1000 }]);
  assert.deepEqual(press(1500), [], "the chain is full until the third step clears");
  const ev = press(1900);
  assert.deepEqual(ev, [{ type: "idle", at: 1900 }, { type: "attack", slot: 0, at: 1900 }]);
});

test("holding the button through a swing starts a charge at its rearm; a short charge gives the next step", () => {
  const c = new KnightControl(), w = sword();
  frame(c, 0, { ...idle(), attack: true, attackChanged: 0 }, w);
  const held = { ...idle(), attack: true, attackChanged: 0 };
  assert.deepEqual(frame(c, 516, held, w), [{ type: "charge", at: 500 }]);
  assert.equal(c.activity.kind, "charge");
  assert.equal(c.allowsMovement(), true, "the knight walks while charging");
  // let go before the first swing's chain lapses (at its clear, 900): the combo's next step
  assert.deepEqual(frame(c, 800, { ...idle(), attackChanged: 800 }, w), [{ type: "attack", slot: 1, at: 800 }]);
  // held longer, the chain has lapsed and the release swings the first step again
  const d = new KnightControl();
  frame(d, 0, { ...idle(), attack: true, attackChanged: 0 }, w);
  frame(d, 516, held, w);
  assert.deepEqual(frame(d, 1500, { ...idle(), attackChanged: 1500 }, w), [{ type: "attack", slot: 0, at: 1500 }]);
});

test("a full charge releases the charged attack", () => {
  const c = new KnightControl(), w = sword();
  frame(c, 0, { ...idle(), attack: true, attackChanged: 0 }, w);
  frame(c, 500, { ...idle(), attack: true, attackChanged: 0 }, w);
  assert.deepEqual(frame(c, 3600, { ...idle(), attackChanged: 3600 }, w), [{ type: "attack", slot: "charged", at: 3600 }]);
});

test("holding the button since well before the knight became free starts a charge", () => {
  const c = new KnightControl(), w = sword();
  // a dodge, with the button held from before it
  frame(c, 0, { ...idle(), dodge: true }, w);
  assert.equal(c.activity.kind, "dodge");
  const held = { ...idle(), attack: true, attackChanged: 100 };
  assert.deepEqual(frame(c, 300, held, w), [], "nothing during the dodge");
  assert.deepEqual(frame(c, 700, held, w), [{ type: "idle", at: ACTIVITY_MS.dodge }, { type: "charge", at: 700 }]);
});

test("a bomb (no combo) charges on the press; a short charge drops the incomplete one", () => {
  const c = new KnightControl(), w = sword({ attacks: 0 });
  assert.deepEqual(frame(c, 0, { ...idle(), attack: true, attackChanged: 0 }, w), [{ type: "charge", at: 0 }]);
  assert.deepEqual(frame(c, 400, { ...idle(), attackChanged: 400 }, w), [{ type: "attack", slot: "incomplete", at: 400 }]);
});

test("a gun: shots repeat the last step, the clip's last shot reloads at its rearm, the chain lapses after", () => {
  const c = new KnightControl(), w = gun();
  const press = (t: number) => frame(c, t, { ...idle(), attack: true, attackChanged: t }, w);
  assert.deepEqual(press(0), [{ type: "attack", slot: 0, at: 0 }]);
  assert.equal(c.allowsMovement(), true, "guns fire on the move");
  assert.deepEqual(press(350), [{ type: "attack", slot: 1, at: 350 }]);
  assert.deepEqual(press(700), [{ type: "attack", slot: 2, at: 700 }]);
  // the third shot's rearm: the reload, and the chain held full until its land + chain cooldown
  assert.deepEqual(frame(c, 1060, idle(), w), [{ type: "attack", slot: "cooldown", at: 1050 }]);
  assert.equal(c.chain(1060), 4);
  assert.deepEqual(press(1800), [], "still reloading: the chain is full until 1050 + 600 + 500");
  assert.deepEqual(press(2160), [{ type: "idle", at: 2050 }, { type: "attack", slot: 0, at: 2160 }]);
});

test("a gun's partly used clip lapses after the shot's land plus the chain cooldown", () => {
  const c = new KnightControl(), w = gun();
  frame(c, 0, { ...idle(), attack: true, attackChanged: 0 }, w);
  assert.equal(c.chain(699), 1);
  assert.equal(c.chain(700), 0);
});

test("the shield goes up when idle or after an attack's rearm, and not during a reload", () => {
  const c = new KnightControl(), w = sword();
  frame(c, 0, { ...idle(), attack: true, attackChanged: 0 }, w);
  assert.deepEqual(frame(c, 100, { ...idle(), defend: true, attackChanged: 50 }, w), []);
  assert.deepEqual(frame(c, 500, { ...idle(), defend: true, attackChanged: 50 }, w), [{ type: "defend", at: 500 }]);
  assert.equal(c.speedFactor({ chargingSpeed: 1, attackingSpeed: 1 }, -0.5), 0.5);
  assert.deepEqual(frame(c, 600, { ...idle(), attackChanged: 50 }, w), [{ type: "idle", at: 600 }]);
  // an attack press while shielding does nothing
  frame(c, 700, { ...idle(), defend: true, attackChanged: 50 }, w);
  assert.deepEqual(c.act(710, { ...idle(), defend: true, attack: true, attackChanged: 710 }, w, 8000), []);
});

test("the bash needs a full shield and a knight free to move; it does not count in the chain", () => {
  const c = new KnightControl(), w = sword();
  assert.deepEqual(c.act(0, { ...idle(), bash: true }, w, 8000, { ...FREE, fullShield: false }), []);
  assert.deepEqual(c.act(0, { ...idle(), bash: true }, w, 8000), [{ type: "attack", slot: "bash", at: 0 }]);
  assert.equal(c.chain(10), 0);
});

test("the dodge: not during attacks or charges; then the cooldown", () => {
  const c = new KnightControl(), w = sword();
  frame(c, 0, { ...idle(), attack: true, attackChanged: 0 }, w);
  assert.deepEqual(c.act(600, { ...idle(), dodge: true }, w, 8000), [], "a rearmed swing still blocks the dodge");
  frame(c, 1000, idle(), w);
  assert.deepEqual(c.act(1000, { ...idle(), dodge: true }, w, 8000), [{ type: "dodge", at: 1000 }]);
  assert.equal(c.allowsMovement(), false);
  frame(c, 1625, idle(), w);
  assert.equal(c.activity.kind, "idle");
  assert.deepEqual(c.act(5000, { ...idle(), dodge: true }, w, 8000), [], "cooldown");
  assert.deepEqual(c.act(9001, { ...idle(), dodge: true }, w, 8000), [{ type: "dodge", at: 9001 }]);
});

test("a flinch interrupts and blocks attacks for 500 ms but lets the knight walk", () => {
  const c = new KnightControl(), w = sword();
  frame(c, 0, { ...idle(), attack: true, attackChanged: 0 }, w);
  c.hurt("hurt", 100);
  assert.equal(c.allowsMovement(), true);
  assert.deepEqual(frame(c, 200, { ...idle(), attack: true, attackChanged: 200 }, w), []);
  assert.deepEqual(frame(c, 600, { ...idle(), attack: true, attackChanged: 200 }, w), [{ type: "idle", at: 600 }, { type: "charge", at: 600 }],
    "a press held through the flinch, from more than 350 ms before it ended, becomes a charge");
  const d = new KnightControl();
  d.hurt("hurt", 0);
  assert.deepEqual(frame(d, 500, { ...idle(), attack: true, attackChanged: 400 }, w), [{ type: "idle", at: 500 }],
    "a press just before the end is neither a new press nor a held charge");
});

test("a knockdown holds for its length, then the knight gets up for 400 ms", () => {
  const c = new KnightControl(), w = sword();
  c.hurt("hurtHard", 0, 1000);
  assert.equal(c.allowsMovement(), false);
  frame(c, 1000, idle(), w);
  assert.equal(c.activity.kind, "recover");
  frame(c, 1400, idle(), w);
  assert.equal(c.activity.kind, "idle");
});
