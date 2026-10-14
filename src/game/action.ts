// What the knight can act on, in the client's terms (config/ActionDesc, config/DescriptionConfig):
// the helptips key the HUD's help notice shows for an action, and the message bundle a
// description's texts are in.

/** The class name after the last "$" ("com...ActionDesc$Shop" is "Shop"). */
const kind = (cls: unknown) => String(cls ?? "").split("$").pop() ?? "";

/** ActionDesc.LD(): the helptips message key for an action description config (null for none). */
export function actionHint(desc: any, fallback = "m.interact"): string {
  switch (kind(desc?.$class)) {
    case "Lift": return "m.lift";
    case "Talk": return "m.talk";
    case "Zone": return "m.zone";
    case "PointOfInterest": return "m.poi";
    case "Unlock": return "m.unlock";
    case "UnlockGold": return "m.unlock_gold";
    case "UnlockShadow": return "m.unlock_shadow";
    case "Shop": return "m.shop";
    case "Energy": return "m.energy";
    case "ConfirmEnergy": return "m.confirm_energy";
    case "Resurrect": return "m.can_resurrect";
    case "CustomInteract": return desc.helpTip || "m.interact";
    case "Interact": case "Furni": return "m.interact";
    default: return fallback;
  }
}

/** DescriptionConfig.BT(): the bundle a description's name, title and text are in. */
export function descriptionBundle(cls: unknown): string {
  switch (kind(cls)) {
    case "Conversation": return "conversation";
    case "Craft": return "craft";
    case "Dungeon": return "dungeon";
    case "Item": case "Statue": return "item";
    case "Mission": return "mission";
    case "Monster": return "monster";
    case "Shop": return "shop";
    case "Sprites": return "sprites";
    default: return "projectx";
  }
}
