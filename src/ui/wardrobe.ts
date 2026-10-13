// A temporary dev panel (#dev=1 builds only) for trying battle sprites, accessories and
// costumes until the arsenal, the sprite screens and the missions offer them. Everything it
// does goes through game/outfit.ts, the same functions those screens will call.

import { accessoryItems, costumeItems, loadAccessoryLibraries, type AccessorySlot } from "../game/accessories";
import type { Outfit } from "../game/outfit";
import type { SaveData } from "../game/save";
import { freePoints, MAX_LEVEL } from "../game/sprites";
import type { World } from "../game/world";

let panel: HTMLElement | null = null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  e.append(...kids);
  return e;
};

/** Adds the "Wardrobe" button next to the dev buttons (once) and wires the panel. */
export function openWardrobe(outfit: Outfit, world: () => World | null, save: () => SaveData, persist: () => void) {
  if (document.getElementById("wardrobeBtn")) return;
  const anchor = document.getElementById("spawnJelly");
  const btn = el("button", { id: "wardrobeBtn", textContent: "Wardrobe", title: "Dev: battle sprite, accessories and costumes" });
  anchor?.after(btn);
  btn.onclick = () => {
    if (panel) { panel.remove(); panel = null; return; }
    panel = el("div", { id: "wardrobe" });
    Object.assign(panel.style, { position: "fixed", right: "12px", top: "60px", width: "340px", maxHeight: "80vh", overflow: "auto", zIndex: "50",
      background: "rgba(20,28,36,0.92)", color: "#dde", font: "12px sans-serif", padding: "10px", borderRadius: "6px" });
    document.body.append(panel);
    void fill(panel, outfit, world, save, persist);
  };
}

async function fill(root: HTMLElement, outfit: Outfit, world: () => World | null, save: () => SaveData, persist: () => void) {
  const w = world();
  if (!w) { root.textContent = "Start playing first."; return; }
  await loadAccessoryLibraries(w.data);
  const redraw = () => { root.replaceChildren(); void fill(root, outfit, world, save, persist); };
  // battle sprite
  const names = await outfit.spriteNames();
  const active = outfit.sprites.active();
  const pick = el("select", {}, el("option", { value: "", textContent: "(no sprite)" }), ...names.map(n => el("option", { value: n, textContent: n, selected: n === active?.name })));
  pick.onchange = () => { outfit.setSprite(pick.value); redraw(); };
  const level = el("input", { type: "number", min: "0", max: String(MAX_LEVEL), value: String(active?.level ?? 0), style: "width:50px" });
  const setLv = el("button", { textContent: "Set level", onclick: () => { outfit.sprites.setLevel(Number((level as HTMLInputElement).value)); redraw(); } });
  const foods = [...w.data.library_("config/item.dat").keys()].filter(n => /^Food\/(Power|Shadow|Wild|Divine|Cosmic) /.test(n));
  const food = el("select", {}, ...foods.map(n => el("option", { value: n, textContent: n.slice(5) })));
  const feed = el("button", { textContent: "Feed", onclick: () => {
    const s = save();
    s.materials[food.value] = (s.materials[food.value] ?? 0) + 1; // dev: the food comes free
    persist();
    outfit.sprites.feed(food.value);
    redraw();
  } });
  root.append(el("b", { textContent: "Battle sprite" }), el("br"), pick, " ", level, setLv, el("br"), food, feed,
    el("div", { textContent: active ? `Level ${active.level}, heat ${Math.round(active.heat)}, ${freePoints(active)} free points; ranks ${JSON.stringify(active.ranks)}` : "" }));
  // accessories
  const acc = accessoryItems(w.data);
  const list = el("datalist", { id: "wardrobeAcc" }, ...acc.map(a => el("option", { value: a.name })));
  const accIn = el("input", { placeholder: "Accessory/...", style: "width:250px" });
  accIn.setAttribute("list", "wardrobeAcc");
  const wear = el("button", { textContent: "Wear", onclick: async () => { await outfit.equipAccessory((accIn as HTMLInputElement).value); redraw(); } });
  const worn = Object.entries(outfit.appearance.accessories).map(([slot, n]) =>
    el("div", {}, `${slot}: ${String(n).split("/").pop()} `, el("button", { textContent: "x", onclick: async () => { await outfit.removeAccessory(slot as AccessorySlot); redraw(); } })));
  root.append(el("hr"), el("b", { textContent: `Accessories (${acc.length})` }), list, el("br"), accIn, wear, ...worn);
  // costumes
  const cos = costumeItems(w.data);
  const clist = el("datalist", { id: "wardrobeCos" }, ...cos.map(c => el("option", { value: c.name })));
  const cosIn = el("input", { placeholder: "Costume/...", style: "width:250px" });
  cosIn.setAttribute("list", "wardrobeCos");
  const put = el("button", { textContent: "Wear", onclick: async () => {
    const c = cos.find(x => x.name === (cosIn as HTMLInputElement).value);
    if (c) { await outfit.equipCostume(c.slot, c.name); redraw(); }
  } });
  const costume = outfit.appearance.costume;
  const cur = (["armor", "helmet", "shield"] as const).filter(k => costume[k]).map(k =>
    el("div", {}, `${k}: ${costume[k].split("/").pop()} `, el("button", { textContent: "x", onclick: async () => { await outfit.equipCostume(k, ""); redraw(); } })));
  root.append(el("hr"), el("b", { textContent: `Costumes (${cos.length})` }), clist, el("br"), cosIn, put, ...cur);
}
