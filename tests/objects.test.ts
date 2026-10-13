import assert from "node:assert/strict";
import { test } from "node:test";
import { blockColor, linked, objectKind, prismFaces, quadrant, traceBeam, type BeamCell } from "../src/game/objects.ts";

const D = "com.threerings.projectx.dungeon.config.DungeonActorConfig$";
const ref = (name: string, args: Record<string, unknown> = {}) => ({ name, arguments: { $map: "x", entries: Object.entries(args) } });
const receptor = (x: number, y: number) => ({ shape: { $class: "ShapeConfig$Transformed", transform: { translation: { x, y } } }, action: { $class: "SpawnPrismLaser" } });
const L_BEND = { $class: D + "PrismBlock", receptors: [receptor(0.5, 0), receptor(0, -0.5)] };
const PASS = { $class: D + "PrismBlock", receptors: [receptor(0.5, 0)] };
const RECEIVER = { $class: D + "PrismBlock", receptors: [{ action: { name: "open" }, offAction: { name: "close" } }] };

test("dungeon objects are told apart by their configs", () => {
  assert.equal(objectKind({ $class: D + "StarlinkBlock" }, "Block/Crystal/Blue"), "starlink");
  assert.equal(objectKind({ $class: D + "UnbreakableStarlinkBlock" }, "Block/Crystal/Unbreakable/Blue"), "starlinkFixed");
  assert.equal(objectKind({ $class: D + "GhostlinkBlock" }, "Block/Ghost"), "ghost");
  assert.equal(objectKind({ $class: D + "TimedBlock", fuse: 4000 }, "Block/Explosive Timed"), "timed");
  assert.equal(objectKind(L_BEND, "Block/Prism/L Bend"), "prism");
  assert.equal(objectKind({ $class: D + "Switch", sprite: { model: { name: "world/dynamic/prism_puzzle/emitter/model.dat" } } }, "Block/Prism/Emitter (Damage)"), "emitter");
  assert.equal(objectKind({ $class: D + "Switch" }, "Dynamic/Traps and Hazards/Gun Block/Gun Block"), "gunBlock");
  assert.equal(objectKind({ $class: D + "DumbSwitch", states: 3 }, "Dynamic/Rescue/Prisoner Cage/Parts/Base"), "cage");
  assert.equal(objectKind({ $class: D + "Block" }, "Dynamic/Monster Objects/Healing Totem/Parts/Base"), "totem");
  // the mortar shell's last stage: a Startup Delayed whose action the export lost, then a Shutdown blast
  assert.equal(objectKind({ $class: "ActorConfig$Original", handlers: [{ $class: "HandlerConfig$Startup", action: { $class: "ActionConfig$Delayed" } },
    { $class: "HandlerConfig$Shutdown" }] }, "Mortar Shell (active, stage 3)"), "fuseActor");
  // a barricade: a Damage handler and a destruction transient
  assert.equal(objectKind({ $class: "ActorConfig$Original", handlers: [{ $class: "DungeonHandlerConfig$Damage" }], sprite: { destructionTransient: {} } }, "Barricade"), "hitReplace");
  assert.equal(objectKind({ $class: D + "Block" }, "Block/Breakable/Clockworks, base"), null);
  assert.equal(blockColor({ sprite: { model: ref("world/dynamic/block/starlink/model.dat", { Color: "Blue" }) } }), "blue");
});

test("crystals link to touching crystals of their colour, four ways", () => {
  const c = (x: number, y: number, color: string) => ({ x: x + 0.5, y: y + 0.5, color });
  const a = c(0, 0, "green"), wall = [a, c(1, 0, "green"), c(2, 0, "green"), c(2, 1, "green"), c(3, 3, "green"), c(0, 1, "blue"), c(1, 1, "green")];
  const got = linked(a, wall, o => o.color === "green");
  assert.equal(got.length, 5);
  assert.ok(!got.some(o => o.color === "blue"));
  assert.ok(!got.some(o => o.x === 3.5)); // diagonal and distant crystals stay
});

test("a beam bends at L prisms, passes straight prisms and lights a receiver", () => {
  assert.equal(quadrant(Math.PI / 2), 1);
  assert.equal(quadrant(-Math.PI / 2), 3);
  const faces = prismFaces(L_BEND);
  assert.deepEqual(faces.map(f => f.angle === null ? null : quadrant(f.angle)), [0, 3]);
  // emitter at (0,0) facing +x; an L bend at (3,0) turned so its faces look -x and +y;
  // a passthrough at (3,2) passing +y beams; the receiver at (3,4)
  const grid = new Map<string, BeamCell>([
    ["3,0", { kind: "prism", id: 1, faces: prismFaces(L_BEND), rotation: Math.PI }],
    ["3,2", { kind: "prism", id: 2, faces: prismFaces(PASS), rotation: -Math.PI / 2 }],
    ["3,4", { kind: "prism", id: 3, faces: prismFaces(RECEIVER), rotation: 0 }],
  ]);
  const cell = (x: number, y: number) => grid.get(`${x},${y}`) ?? { kind: "open" as const };
  const r = traceBeam(0, 0, 0, "blue", cell, () => false);
  assert.deepEqual([...r.lit].sort(), [1, 2, 3]);
  assert.equal(r.segments.length, 3);
  assert.deepEqual(r.segments[0], { x0: 0.5, y0: 0.5, x1: 3.5, y1: 0.5, dir: 0 });
  // turned a quarter, the L bend no longer takes the beam: it stops there
  grid.set("3,0", { kind: "prism", id: 1, faces: prismFaces(L_BEND), rotation: Math.PI / 2 });
  const r2 = traceBeam(0, 0, 0, "blue", cell, () => false);
  assert.equal(r2.lit.size, 0);
  // walls and solid blocks stop it; a beam runs at most its length
  const r3 = traceBeam(0, 0, 0, "blue", () => ({ kind: "open" }), x => x === 4);
  assert.equal(r3.segments[0].x1, 4);
  const r4 = traceBeam(0, 0, 0, "blue", () => ({ kind: "open" }), () => false, 10);
  assert.equal(r4.segments[0].x1, 10.5);
  // a coloured receiver takes only its colour
  grid.set("3,0", { kind: "prism", id: 1, faces: prismFaces(L_BEND), rotation: Math.PI });
  grid.set("3,4", { kind: "prism", id: 3, faces: prismFaces({ receptors: [{ color: { name: "RED" } }] }), rotation: 0 });
  assert.ok(!traceBeam(0, 0, 0, "blue", cell, () => false).lit.has(3));
  assert.ok(traceBeam(0, 0, 0, "red", cell, () => false).lit.has(3));
});
