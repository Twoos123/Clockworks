// Draws a RenderableView component (the HUD's knight portrait) the way Clyde does: its
// models are placed with their view-model transforms, and the camera sits at the
// model's view node (e.g. "shopview"), or orbits the model when there is none.
// The picture is rendered offscreen with a transparent background and composited into the
// 2D HUD between the backdrop and the gloss.

import { loadAnimation, type ModelLoader } from "../model";
import { compose, invert, lookAt, multiply, perspective, readTransform, type Mat4 } from "../math";
import type { ModelInstance, Renderer } from "../render/renderer";
import type { Component } from "./gui";

/** Re-render the animated portrait at this rate; each render reads pixels back from the GPU. */
const FRAME_INTERVAL = 1 / 15;
/** Supersampling factor (the offscreen buffer has no multisampling). */
const SUPERSAMPLE = 2;

export class PortraitView {
  private instance: ModelInstance | null = null;
  private placement: Mat4 | null = null;
  private loading = false;
  private canvas: OffscreenCanvas | null = null;
  private since = Infinity;
  private configKey = "";

  constructor(private readonly renderer: Renderer, private readonly loader: ModelLoader,
    /** Overrides the view's model reference (e.g. the knight's current gear). */
    private modelRef?: any,
    /** The animation the model idles with (a path or reference), or null for none. */
    private readonly idle: any = "character/pc/idle.dat") {}

  private async load(view: any) {
    this.loading = true;
    try {
      const vm = view.models?.[0];
      const ref = this.modelRef ?? vm?.model;
      if (!ref?.name) return;
      const model = await this.loader.load(ref.name, ref);
      const inst = await this.renderer.instantiate(model);
      const idle = this.idle ? await loadAnimation(this.loader, this.idle).catch(() => null) : null;
      if (idle) inst.play(idle, { loop: true });
      const t = readTransform(vm?.transform);
      this.placement = t.matrix ?? compose(t.t, t.r, t.s);
      this.instance = inst;
    } finally { this.loading = false; }
  }

  private last = performance.now();

  /** Shows another model (the knight redressed): it loads on the next draw. */
  setModelRef(ref: any) { this.modelRef = ref; this.instance = null; }

  draw(c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const view = c.view;
    if (!view || w <= 0 || h <= 0) return;
    const key = JSON.stringify(view.models?.[0]?.model ?? "", (k, v) => (k === "$outer" ? undefined : v));
    if (key !== this.configKey) { this.configKey = key; this.instance = null; }
    if (!this.instance) { if (!this.loading) void this.load(view); return; }
    this.since += dt;
    this.instance.time += dt;
    const scale = Math.min(2, devicePixelRatio || 1) * SUPERSAMPLE;
    const pw = Math.round(w * scale), ph = Math.round(h * scale);
    if (!this.canvas || this.since >= FRAME_INTERVAL || this.canvas.width !== pw || this.canvas.height !== ph) {
      this.since = 0;
      this.canvas = this.renderView(view, pw, ph);
    }
    if (this.canvas) g.drawImage(this.canvas, x, y, w, h);
  }

  private renderView(view: any, pw: number, ph: number): OffscreenCanvas | null {
    const inst = this.instance!, placement = this.placement!;
    inst.update();
    // RenderableView: with a view node, the camera takes that node's world transform (Clyde
    // cameras look down their local -z); otherwise an orbit camera circles the model
    let cam: Mat4;
    if (view.viewNode && inst.world.has(view.viewNode)) {
      cam = invert(multiply(placement, inst.nodeMatrix(view.viewNode)));
    } else {
      // OrbitCameraHandler's target stays at the origin; the view model's transform moves the
      // model, not the camera (the heat flame sits a little left of centre this way)
      const target: [number, number, number] = [0, 0, 0];
      const az = view.azimuth ?? 0, el = view.elevation ?? Math.PI / 4, dist = view.distance ?? 10;
      // OrbitCameraHandler: azimuth 0 puts the camera south of the target, looking north
      const eye: [number, number, number] = [
        target[0] + Math.sin(az) * Math.cos(el) * dist,
        target[1] - Math.cos(az) * Math.cos(el) * dist,
        target[2] + Math.sin(el) * dist,
      ];
      cam = lookAt(eye, target, [0, 0, 1]);
    }
    const proj = perspective(view.fov ?? Math.PI / 3, pw / ph, view.near ?? 1, view.far ?? 100);
    const img = this.renderer.renderToPixels([{ instance: inst, matrix: placement }], proj, cam, pw, ph);
    const canvas = this.canvas && this.canvas.width === pw && this.canvas.height === ph ? this.canvas : new OffscreenCanvas(pw, ph);
    canvas.getContext("2d")!.putImageData(img, 0, 0);
    return canvas;
  }
}
