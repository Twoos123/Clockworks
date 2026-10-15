import { test } from "node:test";
import assert from "node:assert/strict";
import { namedHolder } from "../src/game/world.ts";

const desc = { $class: "com.threerings.config.ConfigReference", name: "Conversation/Haven/Stranger/Greeter" };
const sprite = (kind: string, extra: object = {}) => ({ $class: `com.threerings.projectx.config.ProjectXActorSpriteConfig$${kind}`, description: desc, ...extra });

test("every named kind of actor sprite carries a label (sprite/g via i, k, f, j)", () => {
  for (const kind of ["Named", "Stranger", "Memorable", "NamedStatefulEntry"]) {
    const s = sprite(kind);
    assert.equal(namedHolder({ $class: "x", sprite: s }), s, kind);
  }
});

test("the default nameOffset is left to the caller (the binary export drops defaults)", () => {
  const s = sprite("Stranger");
  assert.equal((namedHolder({ sprite: s }) as any).nameOffset, undefined);
  assert.equal((namedHolder({ sprite: sprite("Named", { nameOffset: 1.5 }) }) as any).nameOffset, 1.5);
});

test("named placeables carry their own label; other sprites and undescribed ones none", () => {
  const placeable = { $class: "com.threerings.projectx.config.ProjectXPlaceableConfig$Named", description: desc };
  assert.equal(namedHolder(placeable), placeable);
  assert.equal(namedHolder({ $class: "com.threerings.projectx.config.ProjectXPlaceableConfig$Named" }), null);
  assert.equal(namedHolder({ sprite: { $class: "com.threerings.projectx.dungeon.config.DungeonActorSpriteConfig$Monster", description: desc } }), null);
  assert.equal(namedHolder({ sprite: { $class: "com.threerings.projectx.config.ProjectXActorSpriteConfig$Stranger" } }), null);
  assert.equal(namedHolder(null), null);
});
