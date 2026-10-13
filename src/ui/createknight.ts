// Knight creation, shown on a fresh save before the knight first enters Haven, over the
// game's own creation scene (rsrc/world/createknight/scene.dat: the crash site under the
// moon), in the game's creation window (rsrc/ui/create/interface.dat): the Armor window's
// helm, armour and design sliders (ui/create/parts/interface_icon_slider.dat and
// interface_slider.dat), the Personalize window's colour picker (interface_color.dat), the
// name window (interface_name.dat) and the Start button. The choices are filled in by closed
// code in the game; here they come from the item library: the zero-star "Spiral" helmets and
// armours that new knights wore, each in its seven trims. The Detail window (accessories),
// height and eyes have nothing behind them in single player and are hidden.

import type { SaveData } from "../game/save";
import { dispatch, type Component, type GuiContext } from "./gui";
import { FloatScreen, type Placement } from "./floating";

export interface KnightLook { helmet: string; armor: string; color: number }

/** Spiral starter styles from the item names: style -> trims. */
export interface StarterGear { helmets: Map<string, string[]>; armors: Map<string, string[]>; trims: string[] }

const STARTER = /^Gear\/(Helm|Armor)\/(Spiral [^/(]+?)\s*\((\w+)\)$/;

/** The creation choices: "Gear/Helm/Spiral Hood (Blue)" is style "Spiral Hood", trim "Blue". */
export function starterGear(names: Iterable<string>, rarity: (name: string) => number): StarterGear {
  const helmets = new Map<string, string[]>(), armors = new Map<string, string[]>(), trims = new Set<string>();
  for (const n of names) {
    const m = STARTER.exec(n);
    if (!m || rarity(n) > 0) continue;
    const map = m[1] === "Helm" ? helmets : armors;
    map.set(m[2], [...(map.get(m[2]) ?? []), m[3]]);
    trims.add(m[3]);
  }
  return { helmets, armors, trims: [...trims].sort() };
}

const itemName = (slot: "Helm" | "Armor", style: string, trim: string) => `Gear/${slot}/${style} (${trim})`;

export interface CreateHooks {
  gear(): Promise<StarterGear>;
  /** Personal colours (prints and swatches). */
  colors(): { print: number; name: string; rgb: [number, number, number] }[];
  /** Shows the knight in the scene with this look. */
  preview(look: KnightLook): void;
  /** The knight is made; enter Haven. */
  done(name: string, look: KnightLook): void;
  sound(file: string): void;
}

/** Names: 2 to 20 letters, digits, spaces, apostrophes or hyphens, starting with a letter. */
export function validName(n: string): string | null {
  const t = n.trim().replace(/\s+/g, " ");
  if (t.length < 2) return "A name needs at least two letters.";
  if (t.length > 20) return "Names are at most 20 characters.";
  if (!/^[A-Za-z][A-Za-z0-9 '\-]*$/.test(t)) return "Use letters, digits, spaces, apostrophes and hyphens.";
  return null;
}

/** HUD parts hidden while the knight is made. */
const HIDDEN = ["#hudCanvas", ".hint-bar", "#floorDone", "#clockworks", "#arenaBtn"];

/** Every component with a tag, depth first. */
function findAll(c: Component, tag: string, out: Component[] = []): Component[] {
  if (c.tag === tag) out.push(c);
  for (const k of c.children) findAll(k, tag, out);
  return out;
}

/** The parent of a component in a tree. */
function parentOf(root: Component, c: Component): Component | null {
  for (const k of root.children) {
    if (k === c) return root;
    const p = parentOf(k, c);
    if (p) return p;
  }
  return null;
}

/** A slider row of the creation window: the slider, its option label and arrows. */
interface SliderRow { slider: Component | null; option: Component | null; count: () => number; get: () => number; set: (i: number) => void; label: (i: number) => string }

export class CreateKnight extends FloatScreen {
  private gear: StarterGear | null = null;
  private helm = 0;
  private armor = 0;
  private trim = 0;
  private color = 257;
  private name = "";
  private error = "";
  private rows: SliderRow[] = [];
  private hidden: [HTMLElement, string][] = [];

  constructor(ctx: GuiContext, private readonly hooks_: CreateHooks) {
    super(ctx, "createCanvas");
  }

  protected place(): Placement { return "fill"; }

  async open(save: SaveData) {
    this.gear = await this.hooks_.gear();
    this.color = save.color;
    this.name = save.knight?.name ?? "";
    // start from the current look when it is a starter piece
    const h = [...this.gear.helmets.keys()], a = [...this.gear.armors.keys()];
    const cur = (n: string) => STARTER.exec(n);
    const ch = cur(save.loadout.helmet), ca = cur(save.loadout.armor);
    this.helm = Math.max(0, ch ? h.indexOf(ch[2]) : 0);
    this.armor = Math.max(0, ca ? a.indexOf(ca[2]) : 0);
    this.trim = Math.max(0, this.gear.trims.indexOf(ch?.[3] ?? ca?.[3] ?? "Blue"));
    if (!this.isOpen) {
      document.body.classList.add("creating");
      this.hidden = [];
      for (const sel of HIDDEN) document.querySelectorAll<HTMLElement>(sel).forEach(e => { this.hidden.push([e, e.style.display]); e.style.display = "none"; });
    }
    const field = this.root?.find("namefield");
    if (field) field.text = this.name;
    await this.show();
    this.hooks_.preview(this.look());
  }

  close() {
    this.hide();
    document.body.classList.remove("creating");
    for (const [e, d] of this.hidden) e.style.display = d;
    this.hidden = [];
  }

  look(): KnightLook {
    const g = this.gear!;
    const h = [...g.helmets.keys()][this.helm], a = [...g.armors.keys()][this.armor], t = g.trims[this.trim];
    const pick = (slot: "Helm" | "Armor", style: string) => {
      const trims = (slot === "Helm" ? g.helmets : g.armors).get(style) ?? [];
      return itemName(slot, style, trims.includes(t) ? t : trims[0]);
    };
    return { helmet: h ? pick("Helm", h) : "", armor: a ? pick("Armor", a) : "", color: this.color };
  }

  private changed() {
    this.hooks_.sound("sound/feedback/ui_confirm.ogg");
    void this.refresh();
    this.hooks_.preview(this.look());
  }

  protected async build(): Promise<Component | null> {
    const ui = await this.ui("ui/create/interface.dat");
    if (!ui) return null;
    // single player has nothing behind the step buttons, the server line or the controls
    for (const tag of ["button_next", "back", "server_status", "randomname", "expandbutton"]) for (const c of findAll(ui, tag)) c.visible = false;
    const windows = ui.find("customize_container")?.children ?? [];
    // the Detail window: accessories are not part of a new knight here
    if (windows[1]) windows[1].visible = false;
    // the Personalize window's height and eyes rows
    for (const tag of ["slider_height", "slider_eyetype"]) {
      const s = ui.find(tag), row = s && parentOf(ui, s);
      if (row) row.visible = false;
    }
    const g = () => this.gear!;
    const row = (tag: string, count: () => number, get: () => number, set: (i: number) => void, label: (i: number) => string) => {
      const part = ui.find(tag);
      if (!part) return;
      const r: SliderRow = { slider: part.find("slider"), option: part.find("label_option"), count, get, set, label };
      const step = (d: number) => { const n = count(); if (n) { set((get() + d + n) % n); this.changed(); } };
      this.on(part, "buttonprev", () => step(-1));
      this.on(part, "buttonnext", () => step(1));
      if (r.slider) r.slider.onAction = (c, a) => { if (a === "change" && c.model && c.model.value !== get()) { set(c.model.value); this.changed(); } };
      this.rows.push(r);
    };
    row("slider_helm", () => g().helmets.size, () => this.helm, i => { this.helm = i; }, i => [...g().helmets.keys()][i] ?? "-");
    row("slider_armor", () => g().armors.size, () => this.armor, i => { this.armor = i; }, i => [...g().armors.keys()][i] ?? "-");
    row("slider_design", () => g().trims.length, () => this.trim, i => { this.trim = i; }, i => g().trims[i] ?? "-");
    // the personal colour: the picker shows the colour class's swatches
    const color = ui.find("slider_personalcolor");
    if (color) {
      const step = (d: number) => {
        const cs = this.hooks_.colors();
        if (!cs.length) return;
        const i = Math.max(0, cs.findIndex(c => c.print === this.color));
        this.color = cs[(i + d + cs.length) % cs.length].print;
        this.changed();
      };
      this.on(color, "buttonprev", () => step(-1));
      this.on(color, "buttonnext", () => step(1));
      const picker = color.find("colorpicker");
      if (picker) this.clicks.set(picker, () => {
        const cs = this.hooks_.colors(), r = picker.screen, p = this.pointer;
        if (!cs.length || !r || !p) return;
        const i = Math.max(0, Math.min(cs.length - 1, Math.floor((p.x - r.x) / r.width * cs.length)));
        this.color = cs[i].print;
        this.changed();
      });
    }
    // the randomize buttons: the Armor window's picks a look, the Personalize window's a colour
    const r = (n: number) => Math.floor(Math.random() * n);
    const randomLook = () => {
      const gg = g();
      this.helm = r(gg.helmets.size); this.armor = r(gg.armors.size); this.trim = r(gg.trims.length);
      this.changed();
    };
    const randomColor = () => {
      const cs = this.hooks_.colors();
      if (cs.length) this.color = cs[r(cs.length)].print;
      this.changed();
    };
    windows.forEach((w, i) => { for (const b of findAll(w, "button_random")) b.onAction = i === 2 ? randomColor : randomLook; });
    const field = ui.find("namefield");
    if (field) {
      field.text = this.name;
      field.maxLength = 20;
      field.placeholder = "Your knight's name";
      field.onAction = (c, a) => {
        this.name = String(c.text);
        if (a !== "enter") this.error = "";
        if (a === "enter") this.start(); else void this.refresh();
      };
    }
    this.on(ui, "button_start", () => this.start());
    this.hooks = {
      tagged: {
        colorpicker: (c, gr, x, y, w, h) => {
          const cs = this.hooks_.colors();
          if (!cs.length) return;
          const sw = w / cs.length;
          cs.forEach((s, i) => {
            gr.fillStyle = `rgb(${s.rgb.join(",")})`;
            gr.fillRect(Math.round(x + i * sw), y + 1, Math.ceil(sw), h - 2);
            if (s.print === this.color) {
              gr.strokeStyle = "#fff6c0";
              gr.lineWidth = 2;
              gr.strokeRect(Math.round(x + i * sw) + 1, y, Math.ceil(sw) - 2, h);
            }
          });
        },
      },
    };
    return ui;
  }


  private nameFocused = false;

  /** The knight preview's restart focuses the game canvas: a name being typed keeps the keyboard. */
  protected tick() {
    const f = this.root?.find("namefield");
    if (!f) return;
    if (f.focused) this.nameFocused = true;
    else if (this.nameFocused) {
      if (document.activeElement?.id === "canvas") this.focusName();
      else this.nameFocused = false;
    }
  }

  /** Gives the name field the keyboard again. */
  private focusName() {
    const f = this.root?.find("namefield"), r = f?.screen;
    if (!this.root || !f || !r || f.focused) return;
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    dispatch(this.root, { type: "down", x, y, button: 0 });
    dispatch(this.root, { type: "up", x, y, button: 0 });
  }

  private start() {
    const err = validName(this.name);
    if (err) { this.error = err; this.hooks_.sound("sound/feedback/ui_dismiss.ogg"); void this.refresh(); return; }
    this.error = "";
    this.hooks_.sound("sound/feedback/ui_confirm.ogg");
    this.close();
    this.hooks_.done(this.name.trim().replace(/\s+/g, " "), this.look());
  }

  protected refresh() {
    const ui = this.root;
    if (!ui || !this.gear) return;
    for (const r of this.rows) {
      const n = r.count();
      r.slider?.model?.setRange(0, Math.min(r.get(), Math.max(0, n - 1)), 0, Math.max(0, n - 1));
      if (r.option) r.option.text = r.label(r.get());
    }
    const ok = !validName(this.name);
    const name = ui.find("container_name");
    const check = name?.find("checkmark");
    if (check) check.visible = ok;
    const alert = name?.find("alert");
    if (alert) {
      alert.text = this.error || (this.name ? "" : "Enter your knight's name.");
      alert.visible = !!alert.text;
    }
  }
}
