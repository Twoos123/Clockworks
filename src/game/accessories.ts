// Accessories and costumes: how the knight looks, apart from what it wears for stats.
//
// Accessories (config/accessory.dat, sold as "Accessory/..." tickets in config/item.dat) are
// models with a location: helmet top, back, brow, side and front; armour front, arms, back,
// rear, ankle and aura. The knight's body model (character/pc/model.dat) has one parameter
// per location ("helm_top", "armor_back"...), each an attachment at its own node (the head
// for helmet locations, the spine and root for armour ones), so an accessory goes on by
// passing its model as that argument. Multi-slot accessories take a second location too;
// footstep auras also set the body's "Step Effect".
//
// Costumes ("Costume/Armor/...", "Costume/Helm/...", "Costume/Shield/...") replace the model
// of the armour, helmet or shield the knight shows, while the equipped gear keeps its stats.
//
// Everything here is independent of any UI: the arsenal calls equipAccessory, removeAccessory
// and equipCostume on the save's Appearance and then asks the world to redress the knight.

import { CONFIG_REF } from "../config/params";
import type { GameData } from "./data";

export const ACCESSORY_SLOTS = ["helm_top", "helm_back", "helm_brow", "helm_side", "helm_front",
  "armor_front", "armor_arms", "armor_back", "armor_rear", "armor_ankle", "armor_aura"] as const;
export type AccessorySlot = (typeof ACCESSORY_SLOTS)[number];
export type CostumeSlot = "armor" | "helmet" | "shield";

/** What the knight shows: accessory item names by slot, and costume item names. */
export interface Appearance {
  accessories: Partial<Record<AccessorySlot, string>>;
  costume: Record<CostumeSlot, string>;
}

export const emptyAppearance = (): Appearance => ({ accessories: {}, costume: { armor: "", helmet: "", shield: "" } });

/** A save's appearance, repaired (unknown slots dropped, missing fields filled). */
export function normalizeAppearance(a: Partial<Appearance> | undefined | null): Appearance {
  const out = emptyAppearance();
  for (const s of ACCESSORY_SLOTS) {
    const v = a?.accessories?.[s];
    if (typeof v === "string" && v) out.accessories[s] = v;
  }
  for (const k of ["armor", "helmet", "shield"] as const) {
    const v = a?.costume?.[k];
    if (typeof v === "string") out.costume[k] = v;
  }
  return out;
}

/** ItemCodes$AccessoryLocation to the body model's parameter. HELM_TOP is the class default. */
export function slotOfLocation(location: unknown): AccessorySlot {
  // an imported enum is { $enum, name }; dumps print it as "ItemCodes$AccessoryLocation.ARMOR_BACK"
  const s = typeof location === "object" && location ? String((location as any).name ?? "") : String(location ?? "").split(".").pop() ?? "";
  const slot = s.toLowerCase() as AccessorySlot;
  return (ACCESSORY_SLOTS as readonly string[]).includes(slot) ? slot : "helm_top";
}

export interface AccessoryDef {
  /** The item ("Accessory/Armor/Back/Wings/Wings, Amethyst"). */
  item: string;
  /** The accessory config in config/accessory.dat. */
  config: string;
  slot: AccessorySlot;
  /** A multi-slot accessory's second location, kept free while it is worn. */
  also: AccessorySlot | null;
  model: any;
  /** A footstep aura's particle effect, or null. */
  footstep: any;
  icon: any;
}

const kind = (o: any) => String(o?.$class ?? "").split("$").pop();

/**
 * The accessory an item stands for (an "Accessory/..." item, or an accessory config name).
 * The item and accessory libraries must be preloaded (loadAccessoryLibraries).
 */
export function accessoryDef(data: GameData, name: string): AccessoryDef | null {
  let configRef: any = null, icon: any = null;
  const item = data.config("config/item.dat", name) ? data.resolveSync("config/item.dat", { name }, "item") : null;
  if (item) {
    if (kind(item) !== "AccessoryTicket" || !item.accessory?.name) return null;
    configRef = item.accessory;
    icon = item.icon ?? null;
  } else configRef = { name };
  const acc = data.resolveSync("config/accessory.dat", configRef, "accessory");
  if (!acc || kind(acc) === "Remove" || !acc.model) return null;
  return {
    item: item ? name : "", config: configRef.name, slot: slotOfLocation(acc.location),
    also: kind(acc) === "MultiSlot" && acc.location2 ? slotOfLocation(acc.location2) : null,
    model: acc.model, footstep: acc.footstepEffect ?? null, icon,
  };
}

export async function loadAccessoryLibraries(data: GameData) {
  await data.preload("config/item.dat", "config/accessory.dat");
}

/**
 * Puts accessory `name` (an item or accessory config name) on: it takes its slot (and a multi-slot accessory's second one),
 * replacing whatever was there. `defs` looks up the accessories already worn (for their
 * second slots). Returns the slots it emptied.
 */
export function equipAccessory(app: Appearance, name: string, def: Pick<AccessoryDef, "slot" | "also">,
  defs: (name: string) => Pick<AccessoryDef, "slot" | "also"> | null = () => null): AccessorySlot[] {
  const taken = new Set<AccessorySlot>([def.slot, ...(def.also ? [def.also] : [])]);
  const freed: AccessorySlot[] = [];
  for (const s of ACCESSORY_SLOTS) {
    const worn = app.accessories[s];
    if (!worn) continue;
    const d = defs(worn);
    const uses = [s, ...(d?.also ? [d.also] : [])];
    if (uses.some(u => taken.has(u))) { delete app.accessories[s]; freed.push(s); }
  }
  app.accessories[def.slot] = name;
  return freed;
}

export function removeAccessory(app: Appearance, slot: AccessorySlot) { delete app.accessories[slot]; }

/** Sets (or clears, with "") a costume. */
export function equipCostume(app: Appearance, slot: CostumeSlot, item: string) { app.costume[slot] = item; }

/** The slot a costume item goes in, or null when the name is not a costume. */
export function costumeSlot(item: string): CostumeSlot | null {
  const m = /^Costume\/(Armor|Helm|Shield)\//.exec(item);
  return m ? (m[1] === "Armor" ? "armor" : m[1] === "Helm" ? "helmet" : "shield") : null;
}

/** An appearance with its models looked up: what the body model's arguments need. */
export interface Dressing {
  armor: any | null;
  helmet: any | null;
  shield: any | null;
  /** Body model parameter and accessory model. */
  attachments: [AccessorySlot, any][];
  step: any | null;
}

export const NO_DRESSING: Dressing = { armor: null, helmet: null, shield: null, attachments: [], step: null };

/** Looks up an appearance's costume and accessory models. */
export async function resolveDressing(data: GameData, app: Appearance): Promise<Dressing> {
  await loadAccessoryLibraries(data);
  const costume = (n: string) => {
    if (!n) return null;
    const it = data.resolveSync("config/item.dat", { name: n }, "item");
    return /Costume$/.test(kind(it) ?? "") && it.model ? it.model : null;
  };
  const out: Dressing = { armor: costume(app.costume.armor), helmet: costume(app.costume.helmet), shield: costume(app.costume.shield), attachments: [], step: null };
  for (const s of ACCESSORY_SLOTS) {
    const n = app.accessories[s];
    const def = n ? accessoryDef(data, n) : null;
    if (!def) continue;
    out.attachments.push([s, def.model]);
    if (def.footstep) out.step = def.footstep;
  }
  return out;
}

/** A model reference with its "Colorization" argument (the personal colour slot) set. */
export function recolor(ref: any, color: number): any {
  const entries: [string, unknown][] | undefined = ref?.arguments?.entries;
  if (!entries?.some(([k]) => k === "Colorization")) return ref;
  return { ...ref, arguments: { ...ref.arguments, entries: entries.map(([k, v]) => [k, k === "Colorization" ? color : v]) } };
}

/**
 * Applies a dressing to the body model's arguments (name and value pairs): costumes replace
 * the Armor, Helmet and Shield models (an absent Shield argument stays absent: the knight
 * is not holding one), accessories add their location parameters.
 */
export function dressArgs(args: [string, any][], d: Dressing, color: number): [string, any][] {
  const out = args.map(([k, v]): [string, any] => {
    if (k === "Armor" && d.armor) return [k, recolor(d.armor, color)];
    if (k === "Helmet" && d.helmet) return [k, recolor(d.helmet, color)];
    if (k === "Shield" && d.shield) return [k, recolor(d.shield, color)];
    return [k, v];
  });
  if (d.armor && !out.some(([k]) => k === "Armor")) out.push(["Armor", recolor(d.armor, color)]);
  if (d.helmet && !out.some(([k]) => k === "Helmet")) out.push(["Helmet", recolor(d.helmet, color)]);
  for (const [slot, model] of d.attachments) out.push([slot, recolor(model, color)]);
  if (d.step) out.push(["Step Effect", d.step]);
  return out;
}

/** Every accessory item (for pickers): name, slot and icon. */
export function accessoryItems(data: GameData): { name: string; slot: AccessorySlot; icon: any }[] {
  const out: { name: string; slot: AccessorySlot; icon: any }[] = [];
  for (const name of data.library_("config/item.dat").keys()) {
    if (!name.startsWith("Accessory/") || /\/Parts\/|\/Dev\/|^Accessory\/(Remove|Recover)\//.test(name)) continue;
    const d = accessoryDef(data, name);
    if (d) out.push({ name, slot: d.slot, icon: d.icon });
  }
  return out;
}

/** Every costume item: name and slot. */
export function costumeItems(data: GameData): { name: string; slot: CostumeSlot }[] {
  const out: { name: string; slot: CostumeSlot }[] = [];
  for (const name of data.library_("config/item.dat").keys()) {
    const s = costumeSlot(name);
    if (s && !/\/Parts\/|\(Dev\)|\/Dev\//.test(name)) out.push({ name, slot: s });
  }
  return out;
}

export const configRef = (name: string, entries: [string, unknown][] = []) =>
  ({ $class: CONFIG_REF, name, arguments: { $map: "com.threerings.config.ArgumentMap", entries } });
