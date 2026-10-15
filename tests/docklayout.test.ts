// The item windows over the game, drawn from the install's own interfaces with the DOM and the
// 2D canvas stubbed (skips when the game is not installed):
// - the arsenal at the right edge and the HUD's energy panel stand as one column whose foot is
//   the HUD's 145 pixels up: the arsenal is shortened by the panel's height and ends where the
//   panel begins, both flush right;
// - no window darkens the game behind it (only a modal dialog has the client's modal shade).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { skDir } from "../tools/common.ts";

const HAVE = existsSync(join(skDir(), "rsrc", "ui", "recipes", "interface.dat"));
const W = 1280, H = 800;

async function rig() {
  const noop = () => {};
  const fills: { style: string; w: number; h: number }[] = [];
  const g2d: any = new Proxy({}, {
    get: (t: any, k) => (k in t ? t[k] : k === "measureText" ? (s: string) => ({ width: s.length * 6, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 })
      : k === "createLinearGradient" || k === "createPattern" ? () => ({ addColorStop: noop })
      : k === "fillRect" ? (_x: number, _y: number, w: number, h: number) => { fills.push({ style: String(t.fillStyle), w, h }); } : noop),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const frames: (() => void)[] = [];
  const canvas = () => ({ hidden: true, width: 0, height: 0, clientWidth: W, clientHeight: H, tabIndex: 0, nextElementSibling: null, style: {},
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
  const screens = new GameScreens({ gui: new GuiContext(loader, vfs, Promise.resolve(null)), colors: Promise.resolve(null), eco: async () => eco,
    data: () => data, save: () => save, sound: noop, write: noop, allClosed: noop, outfit: () => ({}) as any });
  /** Draws until the energy panel has been built and laid out. */
  const draw = async (s: any) => {
    for (let i = 0; i < 50; i++) {
      for (const f of frames.splice(0)) f();
      if (s.energyUi?.screen) { fills.length = 0; for (const f of frames.splice(0)) f(); return; }
      await new Promise(r => setTimeout(r, 20));
    }
    assert.fail("the energy panel was never drawn");
  };
  return { screens, draw, fills };
}

function column(arsenal: any, energy: any) {
  const a = arsenal.screen, e = energy.screen;
  assert.ok(a && e, "both drawn");
  // flush right, the arsenal from the top
  assert.equal(a.x + a.width, W, "the arsenal against the right edge");
  assert.equal(e.x + e.width, W, "the energy panel against the right edge");
  assert.equal(a.y, 0, "the arsenal from the top");
  // the energy panel straight under it, the column's foot the HUD's 145 pixels up
  assert.equal(e.y, a.y + a.height, "the energy panel begins where the arsenal ends");
  assert.equal(e.y + e.height, H - 145, "the column ends 145 pixels above the bottom");
  assert.ok(e.height > 0);
}

const undimmed = (fills: { style: string; w: number; h: number }[]) =>
  assert.deepEqual(fills.filter(f => f.w >= W && f.h >= H), [], "nothing shades the whole screen");

test("the arsenal on its own and the energy panel stand as one column, the game undimmed", { skip: !HAVE && "no install" }, async () => {
  const { screens, draw, fills } = await rig();
  await screens.toggleBackpack();
  const s: any = screens.backpack;
  assert.ok(s.isOpen);
  await draw(s);
  column(s.root, s.energyUi);
  undimmed(fills);
});

test("the crafting window's docked arsenal and the energy panel stand as one column, the game undimmed", { skip: !HAVE && "no install" }, async () => {
  const { screens, draw, fills } = await rig();
  await screens.openCrafter();
  const s: any = screens.recipes;
  assert.ok(s.isOpen && s.docked("inventory"));
  await draw(s);
  const dock = s.docks.find((d: any) => d.key === "inventory");
  column(dock.panel.ui, s.energyUi);
  undimmed(fills);
  // a modal dialog over it has the client's modal shade behind it
  s.pushOverlay(s.root);
  await draw(s);
  assert.deepEqual(fills.filter(f => f.w >= W && f.h >= H).map(f => f.style), ["rgba(0,0,0,0.5)"]);
});
