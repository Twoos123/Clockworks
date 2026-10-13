import assert from "node:assert/strict";
import { test } from "node:test";
import { Entity, Logic, type LogicHost } from "../src/game/logic.ts";
import { SpawnTables } from "../src/game/spawntable.ts";

const T = "com.threerings.tudey.config.";

/** A host that creates bare actors from refs named "tag:<tag>". */
function host(created: Entity[]): LogicHost {
  return {
    createActor(ref, x, y) {
      const e = new Entity(true, ref.name);
      e.x = x; e.y = y;
      e.tags = String(ref.name).startsWith("tag:") ? [ref.name.slice(4)] : [];
      created.push(e);
      return e;
    },
    actorDestroyed() {},
    fireEffect() {},
    gameAction() { return undefined; },
  };
}

test("signals reach tagged entries; unnamed handlers accept activate", () => {
  const logic = new Logic(host([]));
  const door = new Entity(false, "door");
  door.tags = ["door 1"];
  let opened = 0;
  door.game = { onSignal: (n: string) => { if (n === "open") opened++; } };
  const spawner = new Entity(false, "spawner");
  spawner.tags = ["spawn 1"];
  logic.addEntry(door, []);
  logic.addEntry(spawner, [{ $class: T + "HandlerConfig$SignalStart", action: { $class: T + "ActionConfig$SpawnActor", actor: { name: "tag:wave 1" } } }]);
  logic.startEntries();
  logic.execute({ $class: T + "ActionConfig$Signal", name: "open", target: { $class: T + "TargetConfig$Tagged", tag: "door 1" } }, spawner, null);
  assert.equal(opened, 1);
  // a trigger area wakes the spawner with "activate"
  logic.signal(spawner, door, "activate");
  assert.equal(logic.tagged("wave 1").length, 1);
});

test("ActorRemoved fires once when the last tagged actor is removed (next tick)", () => {
  const created: Entity[] = [];
  const logic = new Logic(host(created));
  const trigger = new Entity(false, "trigger");
  let fired = 0;
  logic.addEntry(trigger, [{
    $class: T + "HandlerConfig$ActorRemoved",
    target: { tag: "wave 1" }, // a parameter-set tag on the implicit default Tagged target
    action: { $class: T + "ActionConfig$ServerLog" },
  }]);
  logic.startEntries();
  (logic as any).host.log = () => {};
  const orig = logic.execute.bind(logic);
  logic.execute = (cfg, s, a) => { if (cfg?.$class?.endsWith("ServerLog")) fired++; return orig(cfg, s, a); };
  const a = logic.spawn({ name: "tag:wave 1" }, 0, 0, 0, null, null)!;
  const b = logic.spawn({ name: "tag:wave 1" }, 1, 0, 0, null, null)!;
  logic.destroy(a, null);
  logic.tick(50);
  assert.equal(fired, 0, "one wave member left");
  logic.destroy(b, null);
  assert.equal(fired, 0, "removal waits for the next tick");
  logic.tick(50);
  assert.equal(fired, 1);
});

test("timers fire after their interval and respect limits", () => {
  const logic = new Logic(host([]));
  const e = new Entity(false, "e");
  let n = 0;
  logic.addEntry(e, [{ $class: T + "HandlerConfig$Timer", interval: 1, limit: 2, action: { $class: T + "ActionConfig$ServerLog" } }]);
  const orig = logic.execute.bind(logic);
  logic.execute = (cfg, s, a) => { if (cfg?.$class?.endsWith("ServerLog")) n++; return orig(cfg, s, a); };
  logic.startEntries();
  logic.tick(900);
  assert.equal(n, 0);
  for (let i = 0; i < 40; i++) logic.tick(100);
  assert.equal(n, 2);
});

test("spawn tables pick tiers, weights and valued coin payouts", () => {
  const S = "com.threerings.projectx.dungeon.config.SpawnTableConfig$";
  const lib = new Map<string, any>([
    ["Tiers", { name: "Tiers", root: { $class: S + "TierSwitchEntry", tier1: { actor: { name: "one" } }, tier2: { $class: S + "ActorEntry", actor: { name: "two" } } } }],
    ["Coins", { name: "Coins", root: { $class: S + "ValueDepthListEntry", entries: [{ minValue: 7, maxValue: 7 }],
      actorEntries: [{ entry: { $class: S + "ActorEntry", actor: { name: "copper" } }, value: 1 }, { entry: { $class: S + "ActorEntry", actor: { name: "silver" } }, value: 5 }] } }],
  ]);
  const t = new SpawnTables(lib);
  assert.deepEqual(t.evaluate({ name: "Tiers" }, { depth: 1, tier: 1, difficulty: "medium" }).map(r => r.actor.name), ["one"]);
  assert.deepEqual(t.evaluate({ name: "Tiers" }, { depth: 9, tier: 2, difficulty: "medium" }).map(r => r.actor.name), ["two"]);
  assert.deepEqual(t.evaluate({ name: "Coins" }, { depth: 1, tier: 1, difficulty: "medium" }).map(r => r.actor.name), ["silver", "copper", "copper"]);
});

test("a monster's unnamed signal handler ignores the triggers' activate; vanish skips shutdown", () => {
  const created: Entity[] = [];
  const logic = new Logic(host(created));
  logic.startEntries();
  let shutdowns = 0;
  const lichen = new Entity(true, "lichen");
  lichen.mobile = true;
  lichen.handlerConfigs = [
    { $class: T + "HandlerConfig$SignalStart", action: { $class: T + "ActionConfig$SpawnActor", actor: { name: "tag:colony" } } },
    { $class: T + "HandlerConfig$Shutdown", action: { $class: T + "ActionConfig$SpawnActor", actor: { name: "tag:loot" } } },
  ];
  logic.startActor(lichen);
  logic.signal(lichen, lichen, "activate");
  assert.equal(logic.tagged("colony").length, 0, "activate does not merge a lichen");
  logic.signal(lichen, lichen, "");
  assert.equal(logic.tagged("colony").length, 1, "the game's own (unnamed) signal does");
  logic.vanish(lichen);
  logic.tick(50);
  shutdowns = logic.tagged("loot").length;
  assert.equal(shutdowns, 0, "a merged lichen drops no loot");
});
