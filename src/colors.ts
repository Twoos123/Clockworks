// Colorizations: Nenya's palette recoloring (com.threerings.media.image.Colorization and
// ColorPository) and Clyde's ColorizationConfig variants, reimplemented to recolor texture
// images in the browser. Colors near a class's source color (within its HSV range) are
// shifted by the colorization's HSV offsets, as ImageUtil.recolorImage does.

import { AnnotationReader, readJavaObject, type JavaObject } from "./java/serialization";

const f = Math.fround;

/** java.awt.Color.RGBtoHSB, float-exact. */
export function rgbToHsb(r: number, g: number, b: number): [number, number, number] {
  const cmax = Math.max(r, g, b), cmin = Math.min(r, g, b);
  const brightness = f(cmax / f(255));
  const saturation = cmax !== 0 ? f((cmax - cmin) / f(cmax)) : 0;
  let hue = 0;
  if (saturation !== 0) {
    const d = f(cmax - cmin);
    const redc = f((cmax - r) / d), greenc = f((cmax - g) / d), bluec = f((cmax - b) / d);
    if (r === cmax) hue = f(bluec - greenc);
    else if (g === cmax) hue = f(f(2 + redc) - bluec);
    else hue = f(f(4 + greenc) - redc);
    hue = f(hue / 6);
    if (hue < 0) hue = f(hue + 1);
  }
  return [hue, saturation, brightness];
}

/** java.awt.Color.HSBtoRGB, returning [r, g, b]. */
export function hsbToRgb(hue: number, sat: number, bri: number): [number, number, number] {
  const c = (v: number) => Math.trunc(f(f(v * 255) + 0.5));
  if (sat === 0) { const v = c(bri); return [v, v, v]; }
  const h = f(f(hue - Math.floor(hue)) * 6);
  const fr = f(h - Math.floor(h));
  const p = f(bri * f(1 - sat)), q = f(bri * f(1 - f(sat * fr))), t = f(bri * f(1 - f(sat * f(1 - fr))));
  switch (Math.trunc(h)) {
    case 0: return [c(bri), c(t), c(p)];
    case 1: return [c(q), c(bri), c(p)];
    case 2: return [c(p), c(bri), c(t)];
    case 3: return [c(p), c(q), c(bri)];
    case 4: return [c(t), c(p), c(bri)];
    default: return [c(bri), c(p), c(q)];
  }
}

const SHORT_MAX = 32767;
const fixed = (v: number) => Math.trunc(f(v * SHORT_MAX));
const distance = (a: number, b: number, n: number) => (a > b ? Math.min(a - b, b + n - a) : Math.min(b - a, a + n - b));

export interface ClassRecord {
  classId: number;
  name: string;
  source: [number, number, number];
  range: number[];
  colors: Map<number, { colorId: number; name: string; offsets: number[] }>;
}

/** One recoloring rule, as Nenya's Colorization. */
export class Colorization {
  readonly hsv: [number, number, number];
  private readonly fhsv: number[];

  constructor(readonly root: [number, number, number], readonly range: number[], public offsets: number[]) {
    this.hsv = rgbToHsb(root[0], root[1], root[2]);
    this.fhsv = this.hsv.map(fixed);
  }

  matches(hsv: number[]): boolean {
    if (distance(fixed(hsv[0]), this.fhsv[0], SHORT_MAX) > this.range[0] * SHORT_MAX) return false;
    return Math.abs(this.hsv[1] - hsv[1]) <= this.range[1] && Math.abs(this.hsv[2] - hsv[2]) <= this.range[2];
  }

  recolor(hsv: number[]): [number, number, number] {
    const sat = Math.min(Math.max(f(hsv[1] + this.offsets[1]), 0), 1);
    const val = Math.min(Math.max(f(hsv[2] + this.offsets[2]), 0), 1);
    return hsbToRgb(f(hsv[0] + this.offsets[0]), sat, val);
  }

  colorizedRoot(): [number, number, number] { return this.recolor(this.hsv); }
}

/** ColorizationConfig.LumaTint: ramps from shadow tint through the target to highlight tint. */
class LumaTintColorization extends Colorization {
  private readonly target: [number, number, number];
  private readonly rootL: number;
  constructor(region: ClassRecord, source: Colorization, private readonly shadow: number[], private readonly highlight: number[]) {
    super(region.source, region.range, translateOffsets(region, source));
    this.target = source.colorizedRoot();
    this.rootL = this.hsv[2] * (1 - this.hsv[1] / 2);
  }
  override recolor(hsv: number[]): [number, number, number] {
    const l = hsv[2] * (1 - hsv[1] / 2);
    const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
    const [tr, tg, tb] = this.target;
    if (l >= this.rootL) {
      const t = this.rootL < 1 ? (l - this.rootL) / (1 - this.rootL) : 0;
      return [lerp(tr, this.highlight[0], t), lerp(tg, this.highlight[1], t), lerp(tb, this.highlight[2], t)];
    }
    const t = this.rootL > 0 ? 1 - l / this.rootL : 0;
    return [lerp(tr, this.shadow[0], t), lerp(tg, this.shadow[1], t), lerp(tb, this.shadow[2], t)];
  }
}

/** CustomOffsetsColorization(target, source): source offsets re-expressed for another class. */
function translateOffsets(target: ClassRecord, source: Colorization): number[] {
  const hsv = rgbToHsb(target.source[0], target.source[1], target.source[2]);
  return [0, 1, 2].map(i => source.offsets[i] + (source.hsv[i] - hsv[i]));
}

export class ColorPository {
  readonly classes = new Map<number, ClassRecord>();

  static fromSerialized(bytes: Uint8Array): ColorPository {
    const root = readJavaObject(bytes) as JavaObject;
    const pos = new ColorPository();
    for (const [, rec] of readHashIntMap(root.fields._classes as JavaObject)) {
      const r = (rec as JavaObject).fields;
      const color = ((r.source as JavaObject).fields.value as number) >>> 0;
      const record: ClassRecord = {
        classId: r.classId as number,
        name: r.name as string,
        source: [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff],
        range: Array.from(r.range as Float32Array),
        colors: new Map(),
      };
      for (const [id, c] of readHashIntMap(r.colors as JavaObject)) {
        const cf = (c as JavaObject).fields;
        record.colors.set(id, { colorId: cf.colorId as number, name: cf.name as string, offsets: Array.from(cf.offsets as Float32Array) });
      }
      pos.classes.set(record.classId, record);
    }
    return pos;
  }

  /** Looks up a colorization by color print ((classId << 8) | colorId). */
  byPrint(print: number): Colorization | null {
    const cls = this.classes.get(print >> 8);
    const color = cls?.colors.get(print & 0xff);
    return cls && color ? new Colorization(cls.source, cls.range, color.offsets) : null;
  }

  /** Resolves one imported ColorizationConfig object (any variant). */
  resolve(cfg: any): Colorization | null {
    if (!cfg?.$class) return null;
    const kind = cfg.$class.substring(cfg.$class.lastIndexOf("$") + 1);
    const color4 = (c: any): [number, number, number] =>
      [Math.round((c?.r ?? 0) * 255), Math.round((c?.g ?? 0) * 255), Math.round((c?.b ?? 0) * 255)];
    const triplet = (t: any) => [t?.hue ?? 0, t?.saturation ?? 0, t?.value ?? 0];
    switch (kind) {
      case "Normal": return this.byPrint(cfg.colorization ?? 0);
      case "CustomOffsets": {
        const cls = this.classes.get(cfg.clazz ?? 0);
        return cls ? new Colorization(cls.source, cls.range, triplet(cfg.offsets)) : null;
      }
      case "FullyCustom": return new Colorization(color4(cfg.source), triplet(cfg.range), triplet(cfg.offsets));
      case "TransNormal": case "Translated": {
        const cls = this.classes.get(cfg.clazz ?? 0);
        const src = kind === "TransNormal" ? this.byPrint(cfg.colorization ?? 0) : this.resolve(cfg.source);
        return cls && src ? new Colorization(cls.source, cls.range, translateOffsets(cls, src)) : null;
      }
      case "LumaTint": {
        const cls = this.classes.get(cfg.clazz ?? 0), src = this.byPrint(cfg.colorization ?? 0);
        if (!cls || !src) return null;
        const shadow = cfg.shadowTint ? color4(cfg.shadowTint) : [0, 0, 0];
        const highlight = cfg.highlightTint ? color4(cfg.highlightTint) : [255, 255, 255];
        return new LumaTintColorization(cls, src, shadow, highlight);
      }
    }
    return null;
  }
}

function readHashIntMap(map: JavaObject): [number, unknown][] {
  const a = map.annotations["com.samskivert.util.HashIntMap"];
  if (!a) return [];
  const r = new AnnotationReader(a);
  r.readInt(); // bucket count
  r.readFloat(); // load factor
  const size = r.readInt();
  const out: [number, unknown][] = [];
  for (let i = 0; i < size; i++) {
    const key = r.readInt();
    out.push([key, r.readObject()]);
  }
  return out;
}

/** Recolors RGBA pixels in place; colors are cached since textures use few distinct ones. */
export function recolorPixels(data: Uint8ClampedArray, zations: (Colorization | null)[]) {
  const active = zations.filter((z): z is Colorization => z !== null);
  if (active.length === 0) return;
  const cache = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let out = cache.get(key);
    if (out === undefined) {
      out = key;
      const hsv = rgbToHsb(data[i], data[i + 1], data[i + 2]);
      for (const z of active) {
        if (z.matches(hsv)) { const [r, g, b] = z.recolor(hsv); out = (r << 16) | (g << 8) | b; break; }
      }
      cache.set(key, out);
    }
    if (out !== key) { data[i] = (out >> 16) & 0xff; data[i + 1] = (out >> 8) & 0xff; data[i + 2] = out & 0xff; }
  }
}
