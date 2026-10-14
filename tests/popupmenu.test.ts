// A window's popup menu (GuiScreen.popupMenu, the item and sort menus) driven through the
// window's own pointer listeners, with the DOM and the 2D canvas stubbed.
import assert from "node:assert/strict";
import { test } from "node:test";

const noop = () => {};
const g2d: any = new Proxy({}, {
  get: (t: any, k) => (k in t ? t[k] : k === "measureText" ? (s: string) => ({ width: s.length * 6, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 }) : noop),
  set: (t, k, v) => { t[k] = v; return true; },
});
const listeners: Record<string, ((e: any) => void)[]> = {};
const canvas: any = {
  hidden: true, width: 0, height: 0, clientWidth: 800, clientHeight: 600, tabIndex: 0, nextElementSibling: null,
  addEventListener: (t: string, f: (e: any) => void) => (listeners[t] ??= []).push(f),
  getBoundingClientRect: () => ({ left: 0, top: 0 }), getContext: () => g2d,
};
let frame: (() => void) | null = null;
Object.assign(globalThis as any, {
  OffscreenCanvas: class { constructor(public width: number, public height: number) {} getContext() { return g2d; } },
  document: { createElement: () => canvas, getElementById: () => null, body: { insertBefore: noop } },
  requestAnimationFrame: (f: () => void) => { frame = f; },
  devicePixelRatio: 1,
});

const { Component } = await import("../src/ui/gui.ts");
const { GuiScreen } = await import("../src/ui/screen.ts");

const zero = { top: 0, left: 0, bottom: 0, right: 0 };
const style = { color: [1, 1, 1, 1], font: "Arial", fontStyle: "PLAIN", fontSize: 12, textEffect: "NONE", effectSize: 1, effectColor: [1, 1, 1, 1],
  textAlignment: "LEFT", verticalAlignment: "CENTER", lineSpacing: 0, padding: zero, insets: zero, background: null, border: null, icon: null, size: null };
const ctx: any = { resolveStyle: async () => style, font: async () => "sans-serif" };
const fire = (type: string, x: number, y: number) => { for (const f of listeners[type] ?? []) f({ clientX: x, clientY: y, button: 0, preventDefault: noop }); };
const click = (x: number, y: number) => { fire("pointermove", x, y); fire("pointerdown", x, y); fire("pointerup", x, y); };
const settle = () => new Promise(r => setTimeout(r, 0));

test("a click opens its menu at the click, with icons put in as they load, and a choice runs", async () => {
  let icon!: (im: any) => void;
  const pending = new Promise<any>(r => { icon = r; });
  const chosen: string[] = [];
  class Screen extends GuiScreen {
    constructor() { super(ctx, { sound: noop, closed: noop }, "testCanvas"); }
    get top() { return this.root!; }
    protected async build() {
      const pill = new Component("button", null);
      pill.preferredSize = { width: 100, height: 20 };
      pill.onAction = () => void this.popupMenu([{ action: "equip_6", text: "Equip as Weapon 1", icon: pending }, { action: "compare", text: "Compare" }],
        "Proto Gun", a => chosen.push(a));
      return pill;
    }
    protected refresh() {}
  }
  const s = new Screen();
  await s.open();
  frame!();
  const r = s.top.screen!;
  const x = r.x + 10, y = r.y + 10;
  click(x, y);
  // the pointer leaves the window before the menu is built: it still opens where the click was
  for (const f of listeners.pointerleave ?? []) f({});
  await settle();
  const menu = s.top.overlay;
  assert.ok(menu, "the menu is open");
  assert.deepEqual(menu.at && [menu.at.x, menu.at.y], [x, y]);
  assert.deepEqual(menu.children.map(c => c.text), ["Proto Gun", "Equip as Weapon 1", "Compare"]);
  assert.equal(menu.children[1].icon, null, "opened before its icon loaded");
  const im = { source: {}, width: 25, height: 25 };
  icon(im);
  await settle();
  assert.equal(menu.children[1].icon, im);
  frame!();
  const item = menu.children[2].screen!;
  click(item.x + 5, item.y + 5);
  assert.deepEqual(chosen, ["compare"]);
  assert.equal(s.top.overlay, null, "choosing closes the menu");
});
