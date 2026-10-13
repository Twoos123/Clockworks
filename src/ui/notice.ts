// Short notices over the game (rank locks, mission results), gone after a few seconds: the
// game's alert window (the Window/Alert style, as rsrc/ui/getdown/interface.dat frames its
// status line) drawn near the top of the screen on a canvas that lets clicks through.

import { pack, render, type Component, type GuiContext } from "./gui";
import { buildUi, uiRef } from "./screen";

let ctx: GuiContext | null = null;
let canvas: HTMLCanvasElement | null = null;
let alert: Promise<Component | null> | null = null;
let current: { text: string; until: number } | null = null;
let running = false;

/** Gives the notices the game's interface context (until then they wait). */
export function initNotices(gui: GuiContext) {
  ctx = gui;
  // built ahead of the first notice (the download window loads its backing image)
  alert ??= buildAlert(gui);
  if (current) start();
}

/** Finds the alert frame in the download window and keeps only its status line. */
async function buildAlert(gui: GuiContext): Promise<Component | null> {
  const ui = await buildUi(gui, uiRef("ui/getdown/interface.dat"));
  const find = (c: Component): Component | null => c.styleRef?.name === "Window/Alert" ? c : c.children.map(find).find(Boolean) ?? null;
  const box = ui ? find(ui) : null;
  if (!box) return null;
  box.children = box.children.filter(k => k.tag === "status");
  box.constraints = null;
  return box;
}

/** A short notice over the game, gone after a few seconds. */
export function notice(text: string, seconds = 6) {
  current = { text, until: performance.now() + seconds * 1000 };
  if (ctx) start();
}

/** The notice showing now, if any (for tests). */
export function currentNotice(): string | null {
  return current && current.until > performance.now() ? current.text : null;
}

function start() {
  if (!ctx || typeof document === "undefined") return;
  alert ??= buildAlert(ctx);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "noticeCanvas";
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60";
    document.body.append(canvas);
  }
  canvas.hidden = false;
  if (!running) { running = true; requestAnimationFrame(frame); }
}

function frame() {
  const c = canvas!;
  const now = performance.now();
  if (!current || now > current.until) {
    current = null;
    running = false;
    c.hidden = true;
    return;
  }
  void alert!.then(box => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!box || !current) return;
    const status = box.find("status");
    if (status) status.text = current.text;
    g.scale(dpr, dpr);
    g.globalAlpha = Math.max(0, Math.min(1, (current.until - performance.now()) / 400));
    const s = pack(box);
    render(box, g, Math.round((w / dpr - s.width) / 2), 96 + s.height, {});
    g.globalAlpha = 1;
  });
  requestAnimationFrame(frame);
}
