// The client's item context menu (item/client/F, filled by ItemConfig.a(ctx, item, menu)):
// a press on an item pill in the arsenal or the inventory window pops up a menu titled with
// the item's name instead of equipping it at once. For levelled gear (ItemConfig.Level):
//
// - an "Equip as ..." or "Unequip ..." item (the item bundle's m.equip_N / m.unequip_N) for
//   each equipment slot the item fits, by the client's slot numbers (0 helmet, 1 armour,
//   2 shield, 3 and 4 the helmet and armour costumes, 6 to 8 the weapons, 10 and 11 the
//   trinkets, 15 the shield costume), each with the icon of what the slot holds or the
//   slot's own icon; the helmet and the armour, once worn, cannot be taken off, only replaced;
// - "Requires Rank 3-1 to equip" (m.rank_limit), disabled, when the knight's mission rank is
//   below the item's star rating's (ItemCodes.bwB) and it is not worn;
// - "Compare" or "Don't Compare" (M.buL): the item's group compares tooltips against it
//   rather than against what is worn.
//
// The crystal forge's "Forge..." is not offered (the forge is not in this port).

import type { GameData } from "../game/data";
import type { Economy } from "../game/economy";
import { canChangeEquipment } from "../game/equippolicy";
import { catalogue, copyLoadout, type ItemEntry } from "../game/items";
import { freshProgress } from "../game/missions";
import type { Loadout, SaveData } from "../game/save";
import { message, text } from "../i18n";

/** ItemCodes.bwB: the mission rank a star rating needs before it can be equipped. */
export const RANK_LIMIT: Record<number, [number, number]> = { 2: [3, 1], 3: [5, 1], 4: [6, 1], 5: [8, 1] };

/** PlayerObject.dN: whether the knight's mission rank allows equipping items of a star rating. */
export function rankAllows(save: SaveData, rarity: number): boolean {
  const need = RANK_LIMIT[rarity];
  if (!need) return true;
  const m = save.missions ?? freshProgress();
  return m.rank > need[0] || (m.rank === need[0] && m.subrank >= need[1]);
}

/** m.rank_limit for a star rating ("Requires Rank 3-1 to equip"), or "" when it needs no rank. */
export function rankLimitText(rarity: number): string {
  const need = RANK_LIMIT[rarity];
  if (!need) return "";
  const t = message("item", "m.rank_limit", `${need[0]}-${need[1]}`);
  return t.startsWith("m.") ? `Requires Rank ${need[0]}-${need[1]} to equip` : t;
}

/** The client's equipment slot numbers this port's loadout has. */
export type SlotNo = 0 | 1 | 2 | 3 | 4 | 6 | 7 | 8 | 10 | 11 | 12 | 15;

/** ItemConfig's h(slot, false): the slots each kind of gear fits (costume slots included). */
export function slotsFor(e: ItemEntry): SlotNo[] {
  switch (e.category.slot) {
    case "helmet": return [0, 3];
    case "armor": return [1, 4];
    case "shield": return [2, 15];
    case "weapon": return [6, 7, 8];
    case "trinket": return [10, 11];
    case "vitapod": return [12];
  }
}

/** The category icon a slot shows while empty (ItemConfig.US). */
export const SLOT_ICON: Record<SlotNo, string> = {
  0: "icon_helmet.png", 1: "icon_armor.png", 2: "icon_shield.png", 3: "icon_helmet.png", 4: "icon_armor.png", 15: "icon_shield.png",
  6: "icon_gauntlet.png", 7: "icon_gauntlet.png", 8: "icon_gauntlet.png", 10: "icon_amulet.png", 11: "icon_amulet.png", 12: "icon_capsule.png",
};

/** What a slot holds in a loadout (the costume slots read the appearance). */
export function slotItem(l: Loadout, costume: { helmet: string; armor: string; shield: string }, n: SlotNo): string {
  switch (n) {
    case 0: return l.helmet;
    case 1: return l.armor;
    case 2: return l.shield;
    case 3: return costume.helmet;
    case 4: return costume.armor;
    case 15: return costume.shield;
    case 6: case 7: case 8: return l.weapons[n - 6] ?? "";
    case 10: case 11: return l.trinkets[n - 10] ?? "";
    case 12: return l.vitapod;
  }
}

/** The costume slot a costume slot number is. */
export const COSTUME_SLOT: Partial<Record<SlotNo, "helmet" | "armor" | "shield">> = { 3: "helmet", 4: "armor", 15: "shield" };

/** Puts an item in a slot (moving it out of another slot of the same kind it was in). */
export function equipAt(loadout: Loadout, n: SlotNo, name: string): Loadout {
  const l = copyLoadout(loadout);
  const put = (list: string[], i: number) => {
    const at = list.indexOf(name);
    if (at >= 0) list.splice(at, 1);
    if (i < list.length) list[i] = name; else list.push(name);
  };
  switch (n) {
    case 0: l.helmet = name; break;
    case 1: l.armor = name; break;
    case 2: l.shield = name; break;
    case 6: case 7: case 8: put(l.weapons, n - 6); l.weapons = l.weapons.slice(0, 3); break;
    case 10: case 11: put(l.trinkets, n - 10); l.trinkets = l.trinkets.slice(0, 2); break;
    case 12: l.vitapod = name; break;
  }
  return l;
}

/** Takes a slot's item off; null when the port's loadout rules keep it (the last weapon, the shield). */
export function unequipAt(loadout: Loadout, n: SlotNo): Loadout | null {
  const l = copyLoadout(loadout);
  switch (n) {
    case 6: case 7: case 8: if (l.weapons.length <= 1 || n - 6 >= l.weapons.length) return null; l.weapons.splice(n - 6, 1); return l;
    case 10: case 11: if (n - 10 >= l.trinkets.length) return null; l.trinkets.splice(n - 10, 1); return l;
    case 12: l.vitapod = ""; return l;
    default: return null;
  }
}

/** M.buL: the item each group's tooltips compare against, chosen with the menu's Compare (cleared when the windows close). */
export const COMPARE = new Map<string, string>();

/**
 * M.c: the item a tooltip compares an owned item with: the one chosen with Compare for its
 * group, else the first other item of its group in the group's slots.
 */
export function compareTarget(l: Loadout, e: ItemEntry): string | null {
  const chosen = COMPARE.get(e.category.id);
  if (chosen && chosen !== e.name) return chosen;
  const worn = e.category.slot === "weapon" ? l.weapons : e.category.slot === "trinket" ? l.trinkets
    : [e.category.slot === "helmet" ? l.helmet : e.category.slot === "armor" ? l.armor : e.category.slot === "shield" ? l.shield : l.vitapod];
  return worn.find(n => n && n !== e.name && n.startsWith(e.name.split("/").slice(0, 2).join("/") + "/")) ?? null;
}

/** One entry of the item menu: the action, its text, the icon's item (or slot icon) and whether it can be chosen. */
export interface ItemMenuEntry { action: string; text: string; slot?: SlotNo; item?: string; enabled: boolean }

/**
 * ItemConfig.Level.a(ctx, item, menu) and Original's: the item menu's entries for an owned piece
 * of gear. Where gear cannot change (M.K: in the Clockworks away from an Arsenal Station) there
 * is no Equip or Unequip; the menu says so ("Can't Change Equipment", the item bundle's m.cant_equip).
 */
export function itemMenu(save: SaveData, costume: { helmet: string; armor: string; shield: string }, e: ItemEntry,
  canEquip = canChangeEquipment()): ItemMenuEntry[] {
  const out: ItemMenuEntry[] = [];
  const l = save.loadout, slots = slotsFor(e);
  const wornIn = slots.find(n => !COSTUME_SLOT[n] && slotItem(l, costume, n) === e.name);
  if (!canEquip) out.push({ action: "cant_equip", text: cantEquipText(), enabled: false });
  // the helmet and armour, once worn, stay (ItemCodes.bwv)
  else if (wornIn !== 0 && wornIn !== 1) {
    let worn = false;
    for (const n of slots) {
      const held = slotItem(l, costume, n);
      if (n === wornIn || (COSTUME_SLOT[n] && held === e.name)) {
        worn = true;
        if (COSTUME_SLOT[n] || unequipAt(l, n)) out.push({ action: `unequip_${n}`, text: menuText(`m.unequip_${n}`, n), slot: n, item: held, enabled: true });
      } else if (rankAllows(save, e.rarity)) {
        out.push({ action: `equip_${n}`, text: menuText(`m.equip_${n}`, n), slot: n, item: held, enabled: true });
      }
    }
    if (!rankAllows(save, e.rarity) && !worn) {
      out.push({ action: "rank_limit", text: rankLimitText(e.rarity), enabled: false });
    }
  }
  // Original.a: Compare / Don't Compare for items whose group has slots
  out.push({ action: COMPARE.get(e.category.id) === e.name ? "uncompare" : "compare",
    text: text("item", COMPARE.get(e.category.id) === e.name ? "m.uncompare" : "m.compare", COMPARE.get(e.category.id) === e.name ? "Don't Compare" : "Compare"), enabled: true });
  return out;
}

/** The vitapod slot is this port's own: its texts are ours where the bundle has none. */
function menuText(key: string, n: SlotNo): string {
  const t = text("item", key, "");
  if (t) return t;
  return n === 12 ? (key.startsWith("m.unequip") ? "Unequip Vitapod" : "Equip as Vitapod") : key;
}

/** The item bundle's m.cant_equip ("Can't Change Equipment"). */
export function cantEquipText(): string {
  return text("item", "m.cant_equip", "Can't Change Equipment");
}

/**
 * Applies an item menu action to the save's loadout; returns the new loadout, or null when
 * nothing changes (an equip refused where gear cannot change, M.d's M.b check, among them).
 */
export function applyItemAction(save: SaveData, e: ItemEntry, action: string,
  canEquip = canChangeEquipment()): { loadout?: Loadout; costume?: ["helmet" | "armor" | "shield", string] } | null {
  const m = /^(un)?equip_(\d+)$/.exec(action);
  if (m) {
    if (!canEquip) return null;
    const n = Number(m[2]) as SlotNo, cs = COSTUME_SLOT[n];
    if (cs) return { costume: [cs, m[1] ? "" : e.name] };
    const l = m[1] ? unequipAt(save.loadout, n) : equipAt(save.loadout, n, e.name);
    return l ? { loadout: l } : null;
  }
  if (action === "compare") COMPARE.set(e.category.id, e.name);
  if (action === "uncompare") COMPARE.delete(e.category.id);
  return null;
}

/** The owned gear entry of an item name, if it is gear. */
export function gearEntry(data: GameData, name: string): ItemEntry | null {
  return catalogue(data).find(x => x.name === name) ?? null;
}

/** Whether a rank lets the knight wear an owned item now (the pill's Equippable). */
export function equippable(save: SaveData, eco: Economy, name: string): boolean {
  return rankAllows(save, eco.info(name)?.rarity ?? 0);
}
