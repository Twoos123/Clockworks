// Knight creation, shown on a fresh save before the knight first plays, over the game's own
// creation scene (rsrc/world/createknight/scene.dat: the crash site), in the game's creation
// window (rsrc/ui/create/interface.dat), filled as the client's creator (client I) fills it:
//
//  - ARMOR: helm, armour and design sliders (the starter styles and the seven designs);
//  - DETAILS: two helm accessories in the knight's design, or none;
//  - PERSONALIZE: height, eyes and the personal colour (a colour picker over the colour
//    class, its arrows stepping through it);
//  - then the name window (ui/create/parts/interface_name.dat) with the START button.
//
// The option lists, labels and defaults are the client's (src/game/creator.ts). The windows open
// one at a time: "Next" opens the next window and collapses the one before to its header (its
// small icons and a check mark; the header's highlight opens it again), and the first time
// the ARMOR window's "You can click on completed stages to revisit them" box shows for 3
// seconds (I.a, helpboxAppear). RANDOMIZE picks at random for the open window's sliders (I.CJ).
// At the start every window is picked at random, then the accessories are set to none, the
// height to normal and the eyes to the default (I.CI). "Back" leaves creation.

import type { SaveData, KnightFace } from "../game/save";
import { dispatch, type Component, type GuiContext } from "./gui";
import { FloatScreen, type Placement } from "./floating";
import {
  ACCESSORY_1, ACCESSORY_2, DESIGNS, EYES, HEIGHTS, accessoryIn, accessoryLabel, designLabel, eyesLabel, heightLabel, noneLabel,
} from "../game/creator";

export interface KnightLook {
  helmet: string;
  armor: string;
  color: number;
  /** Accessory configs on the helm ("Helm/Top/Headband/Headband, Heavy"). */
  accessories: string[];
  face: KnightFace;
}

/** Spiral starter styles from the item names: style -> designs. */
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
  // the client's design order (ItemCodes.bwi), then any others
  const order = (t: string) => { const i = (DESIGNS as readonly string[]).indexOf(t); return i < 0 ? 99 : i; };
  return { helmets, armors, trims: [...trims].sort((a, b) => order(a) - order(b) || a.localeCompare(b)) };
}

const itemName = (slot: "Helm" | "Armor", style: string, trim: string) => `Gear/${slot}/${style} (${trim})`;

export interface CreateHooks {
  gear(): Promise<StarterGear>;
  /** An accessory config's aName ("a.hvy|a.boltedvee"), once the accessory library is loaded. */
  accessoryName(config: string): string | undefined;
  /** An item's display name ("Spiral Sallet"). */
  itemLabel(item: string): string;
  /** Personal colours (prints and swatches), in the picker's order. */
  colors(): { print: number; name: string; rgb: [number, number, number] }[];
  /** Shows the knight in the scene with this look. */
  preview(look: KnightLook): void;
  /** The knight is made; on to its first level. */
  done(name: string, look: KnightLook): void;
  /** Back (the client's BACK button): to the knight select window, or the log-on screen. */
  back(): void;
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

/** Sliders per window (Armor, Details, Personalize): their tags. */
const WINDOW_SLIDERS = [["slider_helm", "slider_armor", "slider_design"], ["slider_acc1", "slider_acc2"], ["slider_height", "slider_eyetype", "slider_personalcolor"]];

/** How long the "click on completed stages" box stays (client N: 3000 ms). */
const REVISIT_HELP_MS = 3000;

/** Every component with a tag, depth first. */
function findAll(c: Component, tag: string, out: Component[] = []): Component[] {
  if (c.tag === tag) out.push(c);
  for (const k of c.children) findAll(k, tag, out);
  return out;
}

/** A slider row of the creation window: the slider, its option label and arrows. */
interface SliderRow { tag: string; slider: Component | null; option: Component | null; count: () => number; get: () => number; set: (i: number) => void; label: (i: number) => string }

const rand = (n: number) => Math.floor(Math.random() * Math.max(1, n));

export class CreateKnight extends FloatScreen {
  private gear: StarterGear | null = null;
  private helm = 0;
  private armor = 0;
  private trim = 0;
  /** Accessory choices: 0 for none, else 1 + the index into ACCESSORY_1 or ACCESSORY_2. */
  private acc1 = 0;
  private acc2 = 0;
  private height = HEIGHTS.indexOf("0");
  private eyes = 0;
  private color = 257;
  private name = "";
  private error = "";
  private rows: SliderRow[] = [];
  private hidden: [HTMLElement, string][] = [];
  /** The creation windows in their order (Armor, Details, Personalize). */
  private steps: Component[] = [];
  private nameWindow: Component | null = null;
  /** How many steps have opened, and the one open now (steps.length for the name window). */
  private opened = 1;
  private active = 0;
  /** The revisit help box has been shown (the first Next), and its timer. */
  private helped = false;
  private helpTimer: ReturnType<typeof setTimeout> | null = null;

  /** The first window again, the rest unopened (a new creation). */
  private restart() {
    this.opened = 1;
    this.active = 0;
    this.helped = false;
    this.revisitHelp(false);
    this.layoutSteps();
  }

  /** The ARMOR window's "You can click on completed stages to revisit them" box. */
  private revisitHelp(on: boolean) {
    if (this.helpTimer) { clearTimeout(this.helpTimer); this.helpTimer = null; }
    const box = this.steps[0]?.find("container_revisit");
    if (box) box.visible = on;
    if (on) this.helpTimer = setTimeout(() => this.revisitHelp(false), REVISIT_HELP_MS);
  }

  /** Opening a window: the first time the revisit box appears, later it goes (I.a, I.CR). */
  private opening() {
    if (!this.helped) { this.helped = true; this.revisitHelp(true); }
    else this.revisitHelp(false);
  }

  /** "Next": the next unopened window, else the name window with the Start button. */
  private next() {
    this.hooks_.sound("sound/feedback/ui_confirm.ogg");
    this.opening();
    this.opened = Math.min(this.steps.length + 1, this.opened + 1);
    this.active = this.opened - 1;
    this.layoutSteps();
  }

  /** A collapsed window's highlight opens it again (the others collapse). */
  private activate(i: number) {
    if (i >= this.opened || i === this.active) return;
    this.hooks_.sound("sound/feedback/ui_dropdown_select.ogg");
    this.opening();
    this.active = i;
    this.layoutSteps();
  }

  /**
   * Shows the windows as the client leaves them: opened ones visible, the active one expanded
   * and the others collapsed to their headers (their choices' small icons, a check mark and
   * the highlight that re-opens them); the name window and Start once every window has been
   * through.
   */
  private layoutSteps() {
    const ui = this.root;
    if (!ui) return;
    this.steps.forEach((w, i) => {
      w.visible = i < this.opened;
      const open = i === this.active;
      for (const c of findAll(w, "icontable")) c.visible = open;
      const randoms = findAll(w, "container_random");
      for (const c of randoms) c.visible = open && c !== randoms[0];
      const b = w.find("expandbutton");
      if (b) b.visible = !open;
      const check = w.find("checkmark");
      if (check) check.visible = !open;
      const small = w.find("smallicons");
      if (small) small.visible = !open;
      const count = WINDOW_SLIDERS[i]?.length ?? 0;
      for (let n = 1; n <= 5; n++) { const s = w.find(`icon${n}Small`); if (s) s.visible = n <= count; }
    });
    const naming = this.opened > this.steps.length;
    if (this.nameWindow) {
      // the name window stays open with its field once reached (the client only dims its
      // header while another window is reopened); its highlight sits beside it, not over it
      this.nameWindow.visible = naming;
      const content = this.nameWindow.find("content");
      if (content) content.visible = naming;
      for (const c of [this.nameWindow.find("namefield"), content?.children[0]]) if (c) c.visible = true;
      const b = this.nameWindow.find("expandbutton");
      if (b) b.visible = false;
    }
    const next = ui.find("button_next"), start = ui.find("button_start");
    if (next) next.visible = !naming;
    if (start) start.visible = naming;
    // the field takes the keyboard as soon as it has been drawn (tick)
    if (naming && this.active === this.steps.length) this.wantFocus = true;
  }

  /** The name field should take the keyboard once it is on the screen. */
  private wantFocus = false;

  constructor(ctx: GuiContext, private readonly hooks_: CreateHooks) {
    super(ctx, "createCanvas");
  }

  protected place(): Placement { return "fill"; }

  async open(save: SaveData) {
    this.gear = await this.hooks_.gear();
    this.name = save.knight?.name ?? "";
    const fresh = !this.isOpen;
    if (fresh) this.randomizeAll();
    if (!this.isOpen) {
      document.body.classList.add("creating");
      this.hidden = [];
      for (const sel of HIDDEN) document.querySelectorAll<HTMLElement>(sel).forEach(e => { this.hidden.push([e, e.style.display]); e.style.display = "none"; });
    }
    const field = this.root?.find("namefield");
    if (field) field.text = this.name;
    await this.show();
    if (fresh) this.restart();
    this.hooks_.preview(this.look());
  }

  /**
   * I.CI: every window at random, then no accessories, normal height and the default eyes.
   * (The colour is a random one of the class.)
   */
  private randomizeAll() {
    const g = this.gear!;
    this.helm = rand(g.helmets.size);
    this.armor = rand(g.armors.size);
    this.trim = rand(g.trims.length);
    const cs = this.hooks_.colors();
    if (cs.length) this.color = cs[rand(cs.length)].print;
    this.acc1 = 0;
    this.acc2 = 0;
    this.height = HEIGHTS.indexOf("0");
    this.eyes = 0;
  }

  close() {
    this.hide();
    this.revisitHelp(false);
    document.body.classList.remove("creating");
    for (const [e, d] of this.hidden) e.style.display = d;
    this.hidden = [];
  }

  look(): KnightLook {
    const g = this.gear!;
    const h = [...g.helmets.keys()][this.helm], a = [...g.armors.keys()][this.armor], t = g.trims[this.trim] ?? "Blue";
    const pick = (slot: "Helm" | "Armor", style: string) => {
      const trims = (slot === "Helm" ? g.helmets : g.armors).get(style) ?? [];
      return itemName(slot, style, trims.includes(t) ? t : trims[0]);
    };
    const accessories: string[] = [];
    if (this.acc1 > 0) accessories.push(accessoryIn(ACCESSORY_1[this.acc1 - 1], t));
    if (this.acc2 > 0) accessories.push(accessoryIn(ACCESSORY_2[this.acc2 - 1], t));
    return {
      helmet: h ? pick("Helm", h) : "", armor: a ? pick("Armor", a) : "", color: this.color, accessories,
      face: { height: HEIGHTS[this.height] ?? "0", eyes: EYES[this.eyes] ?? "DEFAULT" },
    };
  }

  private changed() {
    this.hooks_.sound("sound/feedback/ui_confirm.ogg");
    void this.refresh();
    this.hooks_.preview(this.look());
  }

  /** The colour picker's choices and the chosen one's index. */
  private colorIndex() {
    const cs = this.hooks_.colors();
    return { cs, i: Math.max(0, cs.findIndex(c => c.print === this.color)) };
  }

  protected async build(): Promise<Component | null> {
    const ui = await this.ui("ui/create/interface.dat");
    if (!ui) return null;
    // single player has no server line, and no random names (the client's are hidden too)
    for (const tag of ["server_status", "randomname"]) for (const c of findAll(ui, tag)) c.visible = false;
    this.steps = ui.find("customize_container")?.children ?? [];
    this.nameWindow = ui.find("container_name");
    this.steps.forEach((w, i) => { const b = w.find("expandbutton"); if (b) b.onAction = () => this.activate(i); });
    const nameExpand = this.nameWindow?.find("expandbutton");
    if (nameExpand) nameExpand.onAction = () => this.activate(this.steps.length);
    this.on(ui, "button_next", () => this.next());
    this.on(ui, "back", () => { this.hooks_.sound("sound/feedback/ui_dismiss.ogg"); this.hooks_.back(); });
    const g = () => this.gear!;
    this.rows = [];
    const row = (tag: string, count: () => number, get: () => number, set: (i: number) => void, label: (i: number) => string) => {
      const part = ui.find(tag);
      if (!part) return;
      const r: SliderRow = { tag, slider: part.find("slider"), option: part.find("label_option"), count, get, set, label };
      // the arrows stop at the ends (I.a's listener: max(0, v - 1), min(max, v + 1))
      const step = (d: number) => {
        const n = count(), v = Math.max(0, Math.min(n - 1, get() + d));
        if (n && v !== get()) { set(v); this.changed(); }
      };
      this.on(part, "buttonprev", () => step(-1));
      this.on(part, "buttonnext", () => step(1));
      if (r.slider) r.slider.onAction = (c, a) => { if (a === "change" && c.model && c.model.value !== get()) { set(c.model.value); this.changed(); } };
      this.rows.push(r);
    };
    // labels (client I.g): an item's name, the design's colour word, an accessory's name
    const styleLabel = (slot: "Helm" | "Armor", style: string | undefined) =>
      style ? this.hooks_.itemLabel(itemName(slot, style, DESIGNS[0])).replace(/\s*\(\w+\)$/, "") || style : "-";
    const accLabel = (list: string[], i: number) => i === 0 ? noneLabel()
      : accessoryLabel(this.hooks_.accessoryName(accessoryIn(list[i - 1], DESIGNS[0])), list[i - 1].replace(/^.*\//, ""));
    row("slider_helm", () => g().helmets.size, () => this.helm, i => { this.helm = i; }, i => styleLabel("Helm", [...g().helmets.keys()][i]));
    row("slider_armor", () => g().armors.size, () => this.armor, i => { this.armor = i; }, i => styleLabel("Armor", [...g().armors.keys()][i]));
    row("slider_design", () => g().trims.length, () => this.trim, i => { this.trim = i; },
      i => designLabel(this.hooks_.accessoryName(accessoryIn(ACCESSORY_1[1], g().trims[i] ?? "")), g().trims[i] ?? "-"));
    row("slider_acc1", () => ACCESSORY_1.length + 1, () => this.acc1, i => { this.acc1 = i; }, i => accLabel(ACCESSORY_1, i));
    row("slider_acc2", () => ACCESSORY_2.length + 1, () => this.acc2, i => { this.acc2 = i; }, i => accLabel(ACCESSORY_2, i));
    row("slider_height", () => HEIGHTS.length, () => this.height, i => { this.height = i; }, i => heightLabel(HEIGHTS[i] ?? "0"));
    row("slider_eyetype", () => EYES.length, () => this.eyes, i => { this.eyes = i; }, i => eyesLabel(EYES[i] ?? "DEFAULT"));
    // the personal colour: the picker shows the colour class's colours as a rainbow; its arrows
    // step through them (I.a: setSelectedIndex(index -/+ 1)) and a click picks one
    const color = ui.find("slider_personalcolor");
    if (color) {
      const step = (d: number) => {
        const { cs, i } = this.colorIndex();
        if (!cs.length) return;
        const n = Math.max(0, Math.min(cs.length - 1, i + d));
        if (n === i) return;
        this.color = cs[n].print;
        this.changed();
      };
      this.on(color, "buttonprev", () => step(-1));
      this.on(color, "buttonnext", () => step(1));
      const picker = color.find("colorpicker");
      if (picker) this.clicks.set(picker, () => {
        const cs = this.hooks_.colors(), r = picker.screen, p = this.pointer;
        if (!cs.length || !r || !p) return;
        const i = Math.max(0, Math.min(cs.length - 1, Math.floor((p.x - r.x) / r.width * cs.length)));
        if (cs[i].print === this.color) return;
        this.color = cs[i].print;
        this.changed();
      });
    }
    // RANDOMIZE: the open window's sliders at random (I.CJ: I.b on the active window)
    this.steps.forEach((w, i) => { for (const b of findAll(w, "button_random")) b.onAction = () => this.randomize(i); });
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
            gr.fillRect(x + i * sw, y + 1, sw + 0.5, h - 2);
          });
          // the picker's thumb over the chosen colour
          const { i } = this.colorIndex();
          const cx = Math.round(x + (i + 0.5) * sw);
          gr.fillStyle = "#f4f4f4";
          gr.strokeStyle = "#3a3a3a";
          gr.lineWidth = 1;
          gr.fillRect(cx - 2, y - 2, 5, h + 4);
          gr.strokeRect(cx - 2.5, y - 2.5, 5, h + 4);
        },
      },
    };
    return ui;
  }

  /** RANDOMIZE in window `w` (I.b): each slider at random; the colour picker a random colour. */
  private randomize(w: number) {
    for (const tag of WINDOW_SLIDERS[w] ?? []) {
      if (tag === "slider_personalcolor") {
        const cs = this.hooks_.colors();
        if (cs.length) this.color = cs[rand(cs.length)].print;
        continue;
      }
      const r = this.rows.find(x => x.tag === tag);
      if (r) r.set(rand(r.count()));
    }
    this.changed();
  }

  private nameFocused = false;

  /** The knight preview's restart focuses the game canvas: a name being typed keeps the keyboard. */
  protected tick() {
    const f = this.root?.find("namefield");
    if (!f) return;
    if (this.wantFocus && f.screen && f.screen.width > 0) {
      this.wantFocus = false;
      this.focusName();
    }
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
