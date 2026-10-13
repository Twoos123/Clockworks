// Shared bits for the HTML windows of the guild, ready room and knight creation: element
// helpers and one stylesheet (in the options menu's colours), added once on first use.

import type { GuiImage } from "./gui";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Draws an inventory icon centred in a canvas. */
export function drawIcon(c: HTMLCanvasElement, im: GuiImage | null) {
  if (!im) return;
  const g = c.getContext("2d")!, s = Math.min(c.width / im.width, c.height / im.height);
  g.drawImage(im.source, (c.width - im.width * s) / 2, (c.height - im.height * s) / 2, im.width * s, im.height * s);
}

const CSS = `
.sk-card { background: #12202e; color: #dbe9f7; border: 2px solid #3c6a8f; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,.6); }
.sk-card h2 { margin: 0; font-style: italic; color: #f3d36b; text-shadow: 0 2px 0 #000; font-size: 20px; }
.sk-card button.active, .sk-card .active > button { background: #f3d36b; color: #111; }
.sk-modal { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(8, 14, 24, 0.55); z-index: 7; }
.furni-window { position: fixed; right: 12px; top: 64px; bottom: 96px; width: 330px; z-index: 6; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; }
.furni-head, .guild-head { display: flex; align-items: center; gap: 10px; }
.furni-head h2, .guild-head h2 { flex: 1; }
.furni-bank { color: #f3d36b; font-size: 13px; }
.furni-tabs, .furni-tools, .guild-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.furni-tools input { flex: 1; min-width: 0; }
.furni-help { margin: 0; font-size: 12px; color: #9fb4c8; }
.furni-status { margin: 0; font-size: 13px; color: #f3d36b; min-height: 1.2em; }
.furni-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 6px; overflow: auto; padding: 2px; }
.furni-item { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 5px 3px; font-size: 11px; line-height: 1.15; background: #0d1824; color: #dbe9f7; border: 1px solid #2d5574; border-radius: 6px; }
.furni-item.held { outline: 2px solid #f3d36b; }
.furni-name { text-align: center; overflow-wrap: anywhere; }
.furni-meta { color: #f3d36b; font-size: 10px; }
body.furni-mode canvas#canvas { cursor: crosshair; }
.guild-card { width: min(760px, calc(100% - 32px)); max-height: calc(100% - 64px); overflow: auto; padding: 14px 18px; display: grid; gap: 10px; }
.guild-emblem { width: 72px; height: 72px; border-radius: 50% 50% 46% 46% / 40% 40% 60% 60%; display: grid; place-items: center; border: 3px solid #f3d36b; flex: none; }
.guild-emblem canvas { width: 52px; height: 52px; filter: drop-shadow(0 2px 0 rgba(0,0,0,.6)); }
.guild-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.guild-symbols { display: grid; grid-template-columns: repeat(auto-fill, 40px); gap: 4px; }
.guild-symbols button { width: 40px; height: 40px; padding: 2px; background: #0d1824; border: 1px solid #2d5574; border-radius: 6px; }
.guild-symbols button.active { border: 2px solid #f3d36b; background: #1d3347; }
.guild-symbols canvas { width: 32px; height: 32px; }
.swatches { display: flex; gap: 4px; flex-wrap: wrap; }
.swatches button { width: 24px; height: 24px; padding: 0; border-radius: 50%; border: 2px solid transparent; }
.swatches button.active { border-color: #f3d36b; }
.vault { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.vault h3 { margin: 0 0 6px; font-size: 14px; color: #9fc4e6; }
.vault-list { display: grid; gap: 4px; max-height: 260px; overflow: auto; }
.vault-row { display: grid; grid-template-columns: 1fr auto auto auto; gap: 6px; align-items: center; font-size: 13px; }
.vault-row span:nth-child(2) { color: #f3d36b; font-variant-numeric: tabular-nums; }
.sk-note { margin: 0; font-size: 12px; color: #9fb4c8; }
.create-card { position: fixed; left: 24px; top: 24px; bottom: 24px; width: 360px; z-index: 7; padding: 14px 18px; display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.create-card label { display: grid; gap: 4px; font-size: 13px; color: #9fc4e6; }
.create-card input[type=text] { font-size: 16px; padding: 6px 8px; }
.create-pick { display: grid; grid-template-columns: 32px 1fr 32px; gap: 6px; align-items: center; }
.create-pick span { text-align: center; color: #dbe9f7; font-size: 14px; }
.create-start { font-size: 18px; padding: 10px; background: #f3d36b; color: #111; font-weight: 700; border-radius: 8px; }
.create-error { color: #ff8a80; font-size: 12px; min-height: 1em; margin: 0; }
body.creating #hudCanvas, body.creating .hint-bar, body.creating #floorDone, body.creating #clockworks, body.creating #arenaBtn { display: none !important; }
.ready-bar { position: fixed; left: 50%; transform: translateX(-50%); top: 16px; z-index: 6; display: flex; gap: 10px; align-items: center; padding: 8px 14px; }
.ready-bar h2 { font-size: 18px; margin-right: 8px; }
`;

let injected = false;
export function injectStyle() {
  if (injected) return;
  injected = true;
  const s = document.createElement("style");
  s.textContent = CSS;
  document.head.append(s);
}
