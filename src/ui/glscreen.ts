// A full-screen game interface with 3D views in it, drawn the way Clyde draws a root interface:
// components in tree order, each RenderableView rendering its models into its own rectangle
// over what lies beneath (only depth cleared), so 2D components below a view are covered by it
// and those above cover it. Used for the log-on screen (ui/logon), the knight select window
// (ui/pick) and the new-knight prologue (ui/prolgue), whose backdrops and comic panels are
// RenderableViews.
//
// The game canvas (WebGL) is the screen: each frame it is cleared, then the 2D components are
// drawn on an offscreen canvas that is laid onto the WebGL canvas whenever a view comes next
// in the tree (and once at the end), and each view renders where it lies. A transparent canvas
// over the game takes the pointer.
//
// Interface scripts play as Clyde's UserInterface does (src/ui/script.ts), with the actions
// these screens need on top: SetConfig (a UserInterface component shows another interface, and
// that one's add action runs), PlayAnimation (a view's model plays an animation) and EmitEvent
// (an action event for the screen, such as the prologue's "end_prologue").

import { invert, multiply, compose, readTransform, type Mat4 } from "../math";
import { loadAnimation, type AnimationClip, type LoadedModel, type ModelLoader } from "../model";
import type { ModelInstance, Renderer, SkyboxItem } from "../render/renderer";
import { VIEWER_ENVIRONMENT, type Environment } from "../environment";
import { buildInterface, dispatch, layout, pack, render, resetInput, type Component, type GuiContext, type RenderHooks } from "./gui";
import { buildUi, uiRef } from "./screen";
import { ScriptRunner } from "./script";
import { orbitView, viewProjection } from "./portrait";

interface ViewModelState { instance: ModelInstance; placement: Mat4 }
interface ViewState {
  models: ViewModelState[] | null;
  loading: boolean;
  /** An animation asked for before the models loaded. */
  pending: AnimationClip | null;
}

const kindOf = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(Math.max(c.lastIndexOf("."), c.lastIndexOf("$")) + 1); };

/** Every component of a tree, depth first. */
export function walk(c: Component, fn: (c: Component) => void) {
  fn(c);
  for (const k of c.children) walk(k, fn);
}

export abstract class GlScreen {
  protected root: Component | null = null;
  /** The transparent canvas over the game that takes the pointer. */
  readonly el: HTMLCanvasElement;
  private readonly layer: HTMLCanvasElement;
  private readonly lg: CanvasRenderingContext2D;
  private runners = new Map<Component, ScriptRunner>();
  private views = new Map<Component, ViewState>();
  private generations = new Map<Component, number>();
  private building: Promise<Component | null> | null = null;
  private shown = false;
  protected hooks: RenderHooks = {};
  /** A modal window over the screen (a confirmation), centred and taking the pointer. */
  protected overlay: Component | null = null;
  protected pointer: { x: number; y: number } | null = null;
  /** Plays a sound file (PlaySound actions, button sounds). */
  sound: (file: string) => void = () => {};

  constructor(protected readonly ctx: GuiContext, protected readonly renderer: Renderer, protected readonly loader: ModelLoader, id: string) {
    const c = this.el = document.createElement("canvas");
    c.id = id;
    c.className = "title-canvas gl-screen";
    c.hidden = true;
    c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:4;background:transparent";
    const anchor = document.getElementById("titleCanvas");
    (anchor?.parentElement ?? document.body).insertBefore(c, anchor ?? null);
    this.layer = document.createElement("canvas");
    this.lg = this.layer.getContext("2d")!;
    const ev = (type: "down" | "up" | "move") => (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      this.pointer = { x, y };
      // a modal prompt takes the pointer from the screen under it
      if (this.overlay) { dispatch(this.overlay, { type, x, y, button: e.button }); return; }
      if (!this.root) return;
      dispatch(this.root, { type, x, y, button: e.button });
      this.pointerEvent(type, x, y, e.button);
    };
    c.addEventListener("pointerdown", ev("down"));
    c.addEventListener("pointerup", ev("up"));
    c.addEventListener("pointermove", ev("move"));
    c.addEventListener("pointerleave", () => { this.pointer = null; if (this.root) dispatch(this.root, { type: "move", x: -1, y: -1 }); });
    c.addEventListener("contextmenu", e => e.preventDefault());
  }

  get visible() { return this.shown; }

  /** Builds the interface tree (once). */
  protected abstract build(): Promise<Component | null>;
  /** Puts the state into the tree (each time the screen shows). */
  protected refresh(): void | Promise<void> {}
  /** A pointer event after the interface's own dispatch. */
  protected pointerEvent(_type: "down" | "up" | "move", _x: number, _y: number, _button: number) {}
  /** An EmitEvent action's event. */
  protected onEvent(_action: string) {}
  /** Per-frame work before drawing. */
  protected tick(_dt: number) {}

  /** The model a view shows for one of its view models (a knight card's preview shows a knight). */
  protected viewModel(_c: Component, vm: any, _index: number): any { return vm?.model ?? null; }
  /** The animation a view's first model idles with, when its config starts none. */
  protected viewIdle(_c: Component): string | null { return null; }
  /** The lights a view's models are drawn under. */
  protected viewEnv(_c: Component): Environment { return VIEWER_ENVIRONMENT; }

  async show() {
    this.shown = true;
    this.el.hidden = false;
    if (!this.root) {
      this.building ??= this.build();
      const root = await this.building;
      if (root && !this.root) {
        this.root = root;
        // every interface in the tree runs its add action (Clyde: when it is added)
        walk(root, c => { if (c.kind === "ui" && c.addAction) this.runner(c).execute(c.addAction); });
        // the views load ahead of showing (the prologue's hidden preload view among them)
        walk(root, c => { if (c.kind === "view" && c.view) this.viewState(c); });
      }
    }
    if (this.root && this.shown) await this.refresh();
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.el.hidden = true;
    this.pointer = null;
    if (this.root) resetInput(this.root);
  }

  /** Forgets the tree (the next show builds it afresh and replays its scripts). */
  protected reset() {
    for (const r of this.runners.values()) r.stop();
    this.runners.clear();
    this.views.clear();
    this.generations.clear();
    this.root = null;
    this.building = null;
  }

  /** The script runner of an interface (a UserInterface component). */
  protected runner(ui: Component): ScriptRunner {
    let r = this.runners.get(ui);
    if (!r) {
      this.runners.set(ui, r = new ScriptRunner(ui));
      r.onSound = f => this.sound(f);
      r.extra = (k, a, run) => this.action(k, a, run);
    }
    return r;
  }

  /** Runs a script of the root interface by name. */
  protected runScript(name: string, ui: Component | null = this.root) {
    if (ui) this.runner(ui).runScript({ name });
  }

  private action(k: string, a: any, run: ScriptRunner): boolean {
    switch (k) {
      case "EmitEvent": this.onEvent(String(a.action ?? "")); return true;
      case "Wait": return true;
      case "SetConfig": {
        const target = a.target ? run.ui.find(a.target) : null;
        if (target?.kind === "ui") void this.setConfig(target, a.userInterface ?? null);
        return true;
      }
      case "PlayAnimation": {
        const target = a.target ? run.ui.find(a.target) : null;
        if (target?.kind === "view" && a.animation) void this.playAnimation(target, a.animation);
        return true;
      }
    }
    return false;
  }

  /** UserInterface.setConfig: the component shows another interface (none for null). */
  protected async setConfig(target: Component, ref: any) {
    const gen = (this.generations.get(target) ?? 0) + 1;
    this.generations.set(target, gen);
    const host = ref?.name ? await buildInterface(this.ctx, ref, { bundle: target.bundle }) : null;
    if (this.generations.get(target) !== gen) return;
    // the old content's scripts and views go
    walk(target, c => { if (c !== target) { this.runners.get(c)?.stop(); this.runners.delete(c); this.views.delete(c); } });
    this.runners.get(target)?.stop();
    this.runners.delete(target);
    target.children = host?.children ?? [];
    target.local = host?.local ?? new Map();
    target.scripts = host?.scripts ?? new Map();
    target.addAction = host?.addAction ?? null;
    if (host) target.bundle = host.bundle;
    walk(target, c => { if (c.kind === "view" && c.view) this.viewState(c); });
    walk(target, c => { if (c.kind === "ui" && c.addAction) this.runner(c).execute(c.addAction); });
  }

  /** A view's first model plays an animation (ActionConfig.PlayAnimation). */
  protected async playAnimation(c: Component, ref: any) {
    const clip = await loadAnimation(this.loader, ref).catch(() => null);
    if (!clip) return;
    const st = this.viewState(c);
    const first = st.models?.[0];
    if (first) first.instance.play(clip, { loop: clip.loop, blend: 0 });
    else st.pending = clip;
  }

  private viewState(c: Component): ViewState {
    let st = this.views.get(c);
    if (!st) {
      this.views.set(c, st = { models: null, loading: true, pending: null });
      void this.loadView(c, st);
    }
    return st;
  }

  private async loadView(c: Component, st: ViewState) {
    try {
      const vms: any[] = c.view?.models ?? [];
      const out: ViewModelState[] = [];
      for (let i = 0; i < vms.length; i++) {
        const ref = this.viewModel(c, vms[i], i);
        if (!ref?.name) continue;
        const model: LoadedModel = await this.loader.load(ref.name, ref);
        const instance = await this.renderer.instantiate(model);
        // the model's own automatic animation (a skybox's idle, a comic panel's move), as the
        // scene props play theirs; else the screen's idle for it
        const auto = model.autoAnimations[0];
        const clip = auto ? await loadAnimation(this.loader, auto).catch(() => null) : null;
        if (clip) instance.clip = clip;
        else if (i === 0) {
          const idle = this.viewIdle(c);
          const ic = idle ? await loadAnimation(this.loader, idle).catch(() => null) : null;
          if (ic) instance.play(ic, { loop: true });
        }
        const t = readTransform(vms[i].transform);
        out.push({ instance, placement: t.matrix ?? compose(t.t, t.r, t.s) });
      }
      if (st.pending && out[0]) { out[0].instance.play(st.pending, { loop: st.pending.loop, blend: 0 }); st.pending = null; }
      st.models = out;
    } catch (e) {
      console.warn("interface view failed to load", e);
      st.models = [];
    } finally { st.loading = false; }
  }

  /**
   * The game's confirmation window (ui/window/confirm_prompt) over the screen: the accept
   * button (labelled `ok`) runs `accept`; cancel and the dismiss button close it.
   */
  protected async prompt(title: string, text: string, ok: string, accept: () => void) {
    const o = await buildUi(this.ctx, uiRef("ui/window/confirm_prompt/interface.dat"));
    if (!o) return;
    const set = (tag: string, v: string) => { const c = o.find(tag); if (c) c.text = v; };
    set("title", title);
    set("prompt", text);
    const close = () => { if (this.overlay === o) this.overlay = null; };
    const confirm = o.find("confirm"), cancel = o.find("cancel"), yes = o.find("accept"), dismiss = o.find("dismiss");
    if (confirm) confirm.visible = false;
    if (cancel) cancel.onAction = () => { this.sound("sound/feedback/ui_dismiss.ogg"); close(); };
    if (dismiss) dismiss.onAction = () => { this.sound("sound/feedback/ui_dismiss.ogg"); close(); };
    if (yes) { yes.text = ok; yes.onAction = () => { close(); this.sound("sound/feedback/ui_confirm.ogg"); accept(); }; }
    this.sound("sound/feedback/ui_open.ogg");
    if (this.root) resetInput(this.root);
    this.overlay = o;
  }

  /** Escape: closes the prompt; true when there was one. */
  escape(): boolean {
    if (!this.overlay) return false;
    this.overlay = null;
    return true;
  }

  /** A view's first model, once loaded. */
  protected viewInstance(c: Component): ModelInstance | null { return this.views.get(c)?.models?.[0]?.instance ?? null; }

  /** Reloads a view's models (its model references changed). */
  protected reloadView(c: Component) { this.views.delete(c); this.viewState(c); }

  // ------------------------------------------------------------ drawing

  /** Draws the screen on the game canvas (the viewer calls this instead of drawing a scene). */
  draw(dt: number) {
    if (!this.shown) return;
    const gl = this.renderer.canvas;
    const W = gl.width, H = gl.height, cw = this.el.clientWidth || gl.clientWidth, ch = this.el.clientHeight || gl.clientHeight;
    if (W <= 0 || H <= 0 || cw <= 0 || ch <= 0) return;
    const k = W / cw;
    this.renderer.clearCanvas([0, 0, 0]);
    this.renderer.time += dt;
    if (this.layer.width !== W || this.layer.height !== H) { this.layer.width = W; this.layer.height = H; }
    const g = this.lg;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.setTransform(k, 0, 0, k, 0, 0);
    for (const r of [...this.runners.values()]) r.tick(dt);
    for (const st of this.views.values()) for (const m of st.models ?? []) m.instance.advance(dt);
    this.tick(dt);
    const root = this.root;
    if (root) {
      root.x = 0; root.y = 0; root.width = cw; root.height = ch;
      layout(root);
      render(root, g, 0, ch, { ...this.hooks, view: (c, gg, x, y, w, h) => this.drawView(c, gg, x, y, w, h, W, H) });
    }
    const o = this.overlay;
    if (o) {
      g.fillStyle = "rgba(4,10,18,0.45)";
      g.fillRect(0, 0, cw, ch);
      const s = pack(o);
      render(o, g, Math.round((cw - s.width) / 2), Math.round((ch + s.height) / 2), this.hooks);
    }
    this.flush(W, H);
  }

  /** Lays the 2D components drawn so far onto the game canvas and clears them. */
  private flush(W: number, H: number) {
    this.renderer.drawLayer(this.layer);
    const g = this.lg;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.restore();
  }

  private drawView(c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, W: number, H: number) {
    if (c.alpha <= 0.01 || w <= 0 || h <= 0) return;
    const st = this.viewState(c);
    const models = st.models;
    if (!models?.length) return;
    // the rectangle in canvas pixels (through any offset the components are drawn with)
    const t = g.getTransform();
    const ax = t.a * x + t.c * y + t.e, ay = t.b * x + t.d * y + t.f;
    const bx = t.a * (x + w) + t.c * (y + h) + t.e, by = t.b * (x + w) + t.d * (y + h) + t.f;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx))), x1 = Math.min(W, Math.ceil(Math.max(ax, bx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by))), y1 = Math.min(H, Math.ceil(Math.max(ay, by)));
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    this.flush(W, H);
    const view = c.view;
    const first = models[0];
    let cam: Mat4;
    first.instance.update();
    if (view.viewNode && first.instance.world.has(view.viewNode)) cam = invert(multiply(first.placement, first.instance.nodeMatrix(view.viewNode)));
    else cam = orbitView(view);
    // the view's own lens, for the whole rectangle it fills
    const proj = viewProjection(view, (bx - ax) / Math.max(1e-6, Math.abs(by - ay)) || w / h);
    const sky: SkyboxItem[] = models.map(m => ({ instance: m.instance, scale: [1, 1, 1], origin: [m.placement[12], m.placement[13], m.placement[14]], basis: m.placement }));
    this.renderer.drawAll([], proj, cam, this.viewEnv(c), sky, undefined, { x: x0, y: H - y1, width: x1 - x0, height: y1 - y0 });
  }
}

export { kindOf };
