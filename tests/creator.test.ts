import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCESSORY_1, ACCESSORY_2, DESIGNS, EYES, HEIGHTS, accessoryIn, faceArgs } from "../src/game/creator.ts";
import { crashSiteScene, rescueCampScene } from "../src/game/places.ts";
import { balloonOf } from "../src/game/props.ts";
import { normalizeSave } from "../src/game/save.ts";
import { starterGear } from "../src/ui/createknight.ts";

test("the creator's choices are the client's: seven designs, four accessories each, three heights, four eyes", () => {
  assert.deepEqual([...DESIGNS], ["Blue", "Gold", "Green", "Heavy", "Pink", "Purple", "Red"]);
  assert.equal(ACCESSORY_1.length, 4);
  assert.equal(ACCESSORY_2[3], "Helm/Side/Mecha Wings/Mecha Wings");
  assert.deepEqual([...HEIGHTS], ["-1", "0", "+1"]);
  assert.deepEqual([...EYES], ["DEFAULT", "ALMOND", "DETERMINED", "HAPPY"]);
  assert.equal(accessoryIn(ACCESSORY_1[0], "Heavy"), "Helm/Top/Headband/Headband, Heavy");
  // designs in the client's order, whatever order the items come in
  const g = starterGear(["Gear/Helm/Spiral Sallet (Red)", "Gear/Helm/Spiral Sallet (Blue)", "Gear/Helm/Spiral Sallet (Heavy)"], () => 0);
  assert.deepEqual(g.trims, ["Blue", "Heavy", "Red"]);
});

test("height and eyes become the body model's Height and Face Texture arguments", () => {
  assert.deepEqual(faceArgs(null), [["Height", "0"], ["Face Texture", "character/pc/face/eye_default.png"]]);
  assert.deepEqual(faceArgs({ height: "+1", eyes: "HAPPY" }), [["Height", "+1"], ["Face Texture", "character/pc/face/eye_happy.png"]]);
  assert.deepEqual(faceArgs({ height: "0", eyes: "CIRCUIT" })[2], ["Texture - Closed", "character/pc/face/eye_circuit_closed.png"]);
});

test("a save keeps a well-formed face and drops a broken one", () => {
  assert.deepEqual(normalizeSave({ face: { height: "-1", eyes: "ALMOND" } }).face, { height: "-1", eyes: "ALMOND" });
  assert.equal(normalizeSave({ face: { height: 3 } }).face, undefined);
  assert.equal("face" in normalizeSave({}), false);
});

test("a new knight wakes in the newest crash site, then goes on to the Rescue Camp", () => {
  const list = [{ id: "216", name: "tutorial b" }, { id: "398", name: "tutorial b" }, { id: "134377745", name: "tutorial b 1" }, { id: "4", name: "rescue camp central" }];
  assert.equal(crashSiteScene(list)?.id, "398");
  assert.equal(rescueCampScene(list)?.id, "4");
  assert.equal(crashSiteScene([{ id: "1", name: "haven town square" }]), null);
});

test("help bubbles read their balloon from the Balloon sprite", () => {
  const b = balloonOf({ $class: "com.threerings.projectx.config.ProjectXActorSpriteConfig$Balloon", message: "m.tut_clearing", title: "t.tut_clearing",
    titleColor: { r: 0.6, g: 0, b: 0.4, a: 1 }, visibleDistance: 8, width: 200 });
  assert.deepEqual(b, { message: "m.tut_clearing", title: "t.tut_clearing", titleColor: [0.6, 0, 0.4, 1], width: 200, zOffset: 0.5, visibleDistance: 8, on: true });
  assert.equal(balloonOf({ $class: "com.threerings.projectx.config.ProjectXActorSpriteConfig$Named" }), null);
});
