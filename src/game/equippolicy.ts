// Where the knight may change gear, as the client decides it (item/client/M.K):
//
// - out of a dungeon (a town, the Rescue Camp) anywhere;
// - in a dungeon level whose type allows it (DungeonCodes.LevelType.canEquip: terminals,
//   lobbies, subtowns and the Core terminal; not Clockworks levels, LEVEL and SPECIAL), anywhere;
// - elsewhere in the Clockworks only while the knight's PlayerObject.EquipPolicy is ANY
//   (LevelPartyObject.a), which an Arsenal Station's zone sets while the knight stands on its
//   pad (DungeonActionConfig$SetEquipPolicy on its IntersectionStart, NORMAL again on its
//   IntersectionStop).
//
// While it cannot, the item menus offer no Equip or Unequip (ItemConfig.Level.a), the loadout
// menu says "Not in lobby" (client/bH, l.cant_loadout), the battle sprite menu "Can't change
// equipment" (sprites/a/z), the forge "The Forge can only be used in town or at Arsenal
// Stations." (item/client/n), and the character window's notices EQUIPMENT LOCKED and SPRITE
// LOCKED (LoadoutPanel's Fa).

/** PlayerObject.EquipPolicy. */
export type EquipPolicy = "NORMAL" | "PVP_LOADOUT" | "ANY";

/** A SetEquipPolicy action's policy (its default NORMAL). */
export function policyOf(cfg: any): EquipPolicy {
  const n = String(cfg?.equipPolicy?.name ?? "NORMAL");
  return n === "ANY" || n === "PVP_LOADOUT" ? n : "NORMAL";
}

/** What a level is, for the gear rules. */
export interface EquipPlace {
  /** A town or another place outside the dungeons (the client has no party there). */
  town: boolean;
  /** A lobby (LevelType.LOBBY). */
  lobby?: boolean;
  /** The gate floor's kind (src/game/clockworks.ts FloorKind), when on a gate's floor. */
  floorKind?: string | null;
  /** The scene's name (an archived terminal or subtown outside a gate). */
  sceneName?: string;
}

/** Terminals and subtowns among the archived scenes ("terminal 1", "emberlight", "moorcroft manor"). */
const SAFE_SCENE = /^(terminal\b|emberlight|moorcroft)/i;

/** DungeonCodes.LevelType.canEquip: whether the level lets gear change anywhere in it. */
export function levelCanEquip(p: EquipPlace): boolean {
  if (p.town || p.lobby) return true;
  if (p.floorKind) return p.floorKind !== "level" && p.floorKind !== "boss";
  return SAFE_SCENE.test(p.sceneName ?? "");
}

/** M.K: whether gear can change here with this policy. */
export function canEquipAt(p: EquipPlace, policy: EquipPolicy): boolean {
  return levelCanEquip(p) || policy === "ANY";
}

let gate: () => boolean = () => true;

/** The game's answer to M.K (main.ts sets it; without a game gear can always change). */
export function setEquipGate(f: () => boolean) { gate = f; }

/** M.K: whether the knight can change equipment now. */
export function canChangeEquipment(): boolean {
  try { return gate(); } catch { return true; }
}

/** The Arsenal Stations' placeables: the zone (console and pad) and the box (the console alone). */
export const ARSENAL_STATION = /^Dynamic\/Misc\/Arsenal\/Arsenal (Zone|Box)$/;

/** The station's target panel description (description.dat Dungeon/Arsenal: "Arsenal", the interact icon). */
export const ARSENAL_DESCRIPTION = "Dungeon/Arsenal";
