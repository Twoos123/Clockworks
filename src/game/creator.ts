// What the client's character creator (client I, with S its scene view) offers a new knight,
// and how its choices dress the knight's body model:
//
//  - Armor: the helm and armour styles (items that are creatable and whose original is a
//    starter Helm or Armor, named "<style> (<design>)"), and the design, one of ItemCodes'
//    seven (Blue, Gold, Green, Heavy, Pink, Purple, Red). The design's label is the colour word
//    of the Bolted Vee accessory in that design ("a.hvy|a.boltedvee": "Heavy").
//  - Details: two helm accessories in the chosen design, or none: Headband, Bolted Vee, Maid
//    Headband and Power Scanner; Plume, Ribbon, Com Unit and Mecha Wings.
//  - Personalize: the height (ProjectXCodes.KnightHeight SHORT_1, BASE, TALL_1, the body
//    model's "Height" argument "-1", "0", "+1"), the eyes (EyeType DEFAULT, ALMOND, DETERMINED,
//    HAPPY: the "Face Texture" argument character/pc/face/eye_<name>.png) and the personal
//    colour (a colour of the class, the "Colorization" argument).

import { hasMessage, message } from "../i18n";
import type { KnightFace } from "./save";

/** ItemCodes.bwi: the designs, in order. */
export const DESIGNS = ["Blue", "Gold", "Green", "Heavy", "Pink", "Purple", "Red"] as const;
/** ItemCodes.bwj: the first accessory's choices (accessory configs without the design). */
export const ACCESSORY_1 = ["Helm/Top/Headband/Headband", "Helm/Top/Bolted Vee/Bolted Vee", "Helm/Top/Maid Headband/Maid Headband", "Helm/Front/Power Scanner/Power Scanner"];
/** ItemCodes.bwk: the second accessory's choices. */
export const ACCESSORY_2 = ["Helm/Back/Plume/Plume", "Helm/Back/Ribbon/Ribbon", "Helm/Side/Com Unit/Com Unit", "Helm/Side/Mecha Wings/Mecha Wings"];
/** ProjectXCodes.baZ: KnightHeight SHORT_1, BASE, TALL_1 as the model's "Height" values. */
export const HEIGHTS = ["-1", "0", "+1"] as const;
const HEIGHT_KEYS: Record<string, string> = { "-2": "short_2", "-1": "short_1", "0": "base", "+1": "tall_1", "+2": "tall_2" };
/** ProjectXCodes.baY: the eyes a new knight may pick. */
export const EYES = ["DEFAULT", "ALMOND", "DETERMINED", "HAPPY"] as const;

export const DEFAULT_FACE: KnightFace = { height: "0", eyes: "DEFAULT" };

/** An accessory config in a design: "Helm/Top/Headband/Headband, Heavy". */
export const accessoryIn = (acc: string, design: string) => `${acc}, ${design}`;

/**
 * The body model arguments for a height and eyes (EyeType.updatePlayerModelArgs and the
 * "Height" argument): eye_<name>.png, and the closed-eye texture for the eyes that have one.
 */
export function faceArgs(face: KnightFace | null | undefined): [string, unknown][] {
  const f = face ?? DEFAULT_FACE;
  const eye = f.eyes.toLowerCase();
  const out: [string, unknown][] = [["Height", f.height], ["Face Texture", `character/pc/face/eye_${eye}.png`]];
  if (f.eyes === "BLANK") out.push(["Texture - Closed", `character/pc/face/eye_${eye}.png`]);
  else if (f.eyes === "CIRCUIT" || f.eyes === "BRIGHT") out.push(["Texture - Closed", `character/pc/face/eye_${eye}_closed.png`]);
  return out;
}

/** The item bundle's text for a key (with an empty argument), trimmed, else the fallback. */
function itemText(key: string, fallback: string): string {
  return hasMessage("item", key) ? message("item", key, "").trim() || fallback : fallback;
}

/** The creator's labels (client I.g): "a.none" for nothing, height and eye names. */
export const noneLabel = () => itemText("a.none", "<None>");
export const heightLabel = (h: string) => itemText(`m.${HEIGHT_KEYS[h] ?? "base"}_height`, h);
export const eyesLabel = (e: string) => itemText(`m.${e.toLowerCase()}_eye`, e);

/** An accessory's label: the part of its aName after the colour word ("a.blu|a.headband": Headband). */
export function accessoryLabel(aName: string | undefined, fallback: string): string {
  if (!aName) return fallback;
  return itemText(aName.substring(aName.lastIndexOf("|") + 1), fallback);
}

/** A design's label: the colour word of the accessory's aName ("a.hvy|a.boltedvee": Heavy). */
export function designLabel(aName: string | undefined, fallback: string): string {
  if (!aName || !aName.includes("|")) return fallback;
  return itemText(aName.substring(0, aName.lastIndexOf("|")), fallback);
}
