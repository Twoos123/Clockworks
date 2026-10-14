// An alchemy machine's interaction reaches the crafting window: the actor's Interaction handler
// (CraftActionConfig$OpenCrafter, as config/actor.dat gives Shop/Haven/Alchemy) runs through the
// logic to the world's game action and its onOpenCrafter hook, and the item windows' openCrafter
// opens RECIPES with the arsenal docked beside it (and leaves it open when used again). The
// window half builds the install's own interfaces, with the DOM and the 2D canvas stubbed; it
// skips when the game is not installed.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Entity, Logic, type LogicHost } from "../src/game/logic.ts";
import { World } from "../src/game/world.ts";
import { skDir } from "../tools/common.ts";

const PX = "com.threerings.projectx.";
const machineHandlers = (action: string) => [
  { $class: PX + "config.ProjectXHandlerConfig$Interaction", action: { $class: PX + "craft.config.CraftActionConfig$" + action } },
];

/** A logic whose game actions are the world's (gameAction on a world holding only what it reads). */
function rig() {
  const knight = new Entity(true, "knight");
  const opened: string[] = [];
  const world = { knightEntity: knight, onOpenCrafter: (m: string) => opened.push(m) };
  const host: LogicHost = {
    createActor: () => null, actorDestroyed() {}, fireEffect() {},
    gameAction: (cfg, source, activator, logic) => World.prototype.gameAction.call(world, cfg, source, activator, logic),
  };
  return { logic: new Logic(host), knight, opened };
}

test("using an alchemy machine calls the world's onOpenCrafter", () => {
  const { logic, knight, opened } = rig();
  const machine = new Entity(false, "Shop/Haven/Alchemy");
  logic.addEntry(machine, machineHandlers("OpenCrafter"));
  logic.startEntries();
  logic.interact(machine, knight);
  assert.deepEqual(opened, ["Shop/Haven/Alchemy"]);
  // only the knight's use opens it
  logic.interact(machine, new Entity(true, "someone"));
  assert.equal(opened.length, 1);
});

test("the sprite food machine and the obelisks (catalogue crafters) open it too", () => {
  const { logic, knight, opened } = rig();
  for (const [name, action] of [["Shop/Haven/Alchemy, Battle Sprites", "OpenCatalogCrafter"], ["Shop/Guild Hall/Hunter Alchemy", "OpenGuildCatalogCrafter"]]) {
    const m = new Entity(false, name);
    logic.addEntry(m, machineHandlers(action));
    logic.startEntries();
    logic.interact(m, knight);
  }
  assert.deepEqual(opened, ["Shop/Haven/Alchemy, Battle Sprites", "Shop/Guild Hall/Hunter Alchemy"]);
});

const HAVE = existsSync(join(skDir(), "rsrc", "ui", "recipes", "interface.dat"));

test("openCrafter opens RECIPES with the arsenal docked, drawn, and keeps it open", { skip: !HAVE && "no install" }, async () => {
  const noop = () => {};
  const g2d: any = new Proxy({}, {
    get: (t: any, k) => (k in t ? t[k] : k === "measureText" ? (s: string) => ({ width: s.length * 6, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 })
      : k === "createLinearGradient" || k === "createPattern" ? () => ({ addColorStop: noop }) : noop),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const frames: (() => void)[] = [];
  const canvas = () => ({ hidden: true, width: 0, height: 0, clientWidth: 1280, clientHeight: 800, tabIndex: 0, nextElementSibling: null, style: {},
    classList: { contains: () => true }, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0 }), getContext: () => g2d });
  Object.assign(globalThis as any, {
    OffscreenCanvas: class { constructor(public width: number, public height: number) {} getContext() { return g2d; } },
    document: { createElement: canvas, getElementById: () => null, body: { insertBefore: noop }, fonts: { add: noop } },
    requestAnimationFrame: (f: () => void) => { frames.push(f); },
    devicePixelRatio: 1,
    createImageBitmap: async () => ({ width: 16, height: 16 }),
    FontFace: class { load() { return Promise.resolve(); } },
  });
  const rsrc = join(skDir(), "rsrc");
  const vfs: any = { label: "test", read: async (p: string) => new Uint8Array(readFileSync(join(rsrc, p))), blob: async () => ({}),
    messageBundles: async () => [], messageBundle: async () => null };
  const { ModelLoader } = await import("../src/model.ts");
  const { GuiContext } = await import("../src/ui/gui.ts");
  const { GameData } = await import("../src/game/data.ts");
  const { Economy, ECONOMY_FILES } = await import("../src/game/economy.ts");
  const { GameScreens } = await import("../src/ui/screens.ts");
  const { freshSave } = await import("../src/game/save.ts");
  const loader = new ModelLoader(vfs);
  const data = new GameData(loader);
  await data.preload(...ECONOMY_FILES);
  const eco = new Economy(f => data.library_(f));
  const save = freshSave();
  save.recipes = eco.recipes().slice(0, 12).map(r => r.name);
  const screens = new GameScreens({ gui: new GuiContext(loader, vfs, Promise.resolve(null)), colors: Promise.resolve(null), eco: async () => eco,
    data: () => data, save: () => save, sound: noop, write: noop, allClosed: noop, outfit: () => ({}) as any });
  await screens.openCrafter();
  const recipes: any = screens.recipes;
  assert.ok(recipes.isOpen, "the crafting window is open");
  assert.ok(recipes.root, "its interface is built");
  assert.ok(recipes.docked("inventory"), "the arsenal is docked beside it");
  for (const f of frames.splice(0)) f();
  const r = recipes.root.screen;
  assert.ok(r && r.width > 0 && r.height > 0, "the recipe window is drawn");
  assert.equal(r.x, 0, "at the screen's left edge");
  // using the machine again leaves it open
  await screens.openCrafter();
  assert.ok(recipes.isOpen && recipes.docked("inventory"));
});
