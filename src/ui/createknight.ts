// Knight creation, shown on a fresh save before the knight first enters Haven, over the
// game's own creation scene (rsrc/world/createknight/scene.dat: the crash site under the
// moon). The game's creation window (ui/create/interface.dat) has a name box, a colour
// picker and icon sliders whose choices are filled in by closed code; the choices here come
// from the item library: the zero-star "Spiral" helmets and armours that new knights wore,
// each in its seven trims.

import type { SaveData } from "../game/save";
import { el, injectStyle } from "./panel";

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

export class CreateKnight {
  private readonly root: HTMLElement;
  private gear: StarterGear | null = null;
  private helm = 0;
  private armor = 0;
  private trim = 0;
  private color = 257;
  private name = "";
  private error = "";

  constructor(private readonly hooks: CreateHooks) {
    injectStyle();
    this.root = el("div", "sk-card create-card");
    this.root.hidden = true;
    this.root.addEventListener("pointerdown", e => e.stopPropagation());
    this.root.addEventListener("keydown", e => e.stopPropagation());
    document.body.append(this.root);
  }

  get isOpen() { return !this.root.hidden; }

  async open(save: SaveData) {
    this.gear = await this.hooks.gear();
    this.color = save.color;
    this.name = save.knight?.name ?? "";
    // start from the current look when it is a starter piece
    const h = [...this.gear.helmets.keys()], a = [...this.gear.armors.keys()];
    const cur = (n: string) => STARTER.exec(n);
    const ch = cur(save.loadout.helmet), ca = cur(save.loadout.armor);
    this.helm = Math.max(0, ch ? h.indexOf(ch[2]) : 0);
    this.armor = Math.max(0, ca ? a.indexOf(ca[2]) : 0);
    this.trim = Math.max(0, this.gear.trims.indexOf(ch?.[3] ?? ca?.[3] ?? "Blue"));
    document.body.classList.add("creating");
    this.root.hidden = false;
    this.render();
    this.hooks.preview(this.look());
  }

  close() {
    this.root.hidden = true;
    document.body.classList.remove("creating");
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
    this.hooks.sound("sound/feedback/ui_confirm.ogg");
    this.render();
    this.hooks.preview(this.look());
  }

  private picker(label: string, values: string[], index: number, set: (i: number) => void): HTMLElement {
    const box = el("label");
    box.append(el("span", "", label));
    const row = el("div", "create-pick");
    const prev = el("button", "", "‹"), next = el("button", "", "›");
    prev.onclick = () => { set((index - 1 + values.length) % values.length); this.changed(); };
    next.onclick = () => { set((index + 1) % values.length); this.changed(); };
    row.append(prev, el("span", "", values[index] ?? "-"), next);
    box.append(row);
    return box;
  }

  private render() {
    const g = this.gear!;
    this.root.replaceChildren();
    const name = document.createElement("input");
    name.type = "text"; name.maxLength = 20; name.placeholder = "Your knight's name"; name.value = this.name;
    name.oninput = () => { this.name = name.value; };
    const nameBox = el("label");
    nameBox.append(el("span", "", "Name"), name);
    const colors = el("div", "swatches");
    for (const c of this.hooks.colors()) {
      const b = el("button", c.print === this.color ? "active" : "");
      b.title = c.name;
      b.style.background = `rgb(${c.rgb.join(",")})`;
      b.onclick = () => { this.color = c.print; this.changed(); };
      colors.append(b);
    }
    const colorBox = el("label");
    colorBox.append(el("span", "", "Personal colour"), colors);
    const random = el("button", "", "Random look");
    random.onclick = () => {
      const r = (n: number) => Math.floor(Math.random() * n);
      this.helm = r(g.helmets.size); this.armor = r(g.armors.size); this.trim = r(g.trims.length);
      const cs = this.hooks.colors();
      if (cs.length) this.color = cs[r(cs.length)].print;
      this.changed();
    };
    const start = el("button", "create-start", "Start");
    start.onclick = () => {
      const err = validName(this.name);
      if (err) { this.error = err; this.hooks.sound("sound/feedback/ui_dismiss.ogg"); this.render(); return; }
      this.hooks.sound("sound/feedback/ui_confirm.ogg");
      this.close();
      this.hooks.done(this.name.trim().replace(/\s+/g, " "), this.look());
    };
    this.root.append(el("h2", "", "Create your knight"), nameBox, colorBox,
      this.picker("Helmet", [...g.helmets.keys()], this.helm, i => { this.helm = i; }),
      this.picker("Armour", [...g.armors.keys()], this.armor, i => { this.armor = i; }),
      this.picker("Trim", g.trims, this.trim, i => { this.trim = i; }),
      random, el("p", "create-error", this.error), start,
      el("p", "sk-note", "These are the zero-star Spiral helmets and armours from the item library. Your knight starts with them, a Proto Sword, Proto Gun, Proto Bomb and Proto Shield."));
    this.error = "";
    setTimeout(() => { if (!this.name) name.focus(); });
  }
}
