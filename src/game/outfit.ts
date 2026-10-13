// Glue between the save, the world and the HUD for what the knight brings along besides its
// gear: the battle sprite (sprites.ts) and the accessories and costumes it shows
// (accessories.ts). The arsenal, the missions ("Choose Your Sprite") and the dev wardrobe
// call these functions; they persist the save and refresh the knight and companion in play.

import type { ModelLoader } from "../model";
import {
  accessoryDef, equipAccessory, equipCostume, loadAccessoryLibraries, normalizeAppearance, removeAccessory,
  resolveDressing, type AccessorySlot, type Appearance, type CostumeSlot,
} from "./accessories";
import type { SaveData } from "./save";
import { createCompanion, loadSpriteDefs, SpriteRoster, type SpriteDef } from "./sprites";
import type { World } from "./world";

export class Outfit {
  readonly sprites: SpriteRoster;
  private defs = new Map<string, SpriteDef>();
  private defsReady: Promise<void> | null = null;
  private world: World | null = null;
  /** Called after the knight is redressed (the HUD portrait follows). */
  onRedress: (() => void) | null = null;
  /** Hotkey labels for the sprite slots. */
  hotkeys: string[] = ["R", "T", "G"];

  constructor(private readonly loader: ModelLoader, private readonly save: () => SaveData, private readonly persist: () => void) {
    this.sprites = new SpriteRoster(save, persist, () => this.defs);
    this.sprites.onChange = () => void this.refreshSprite();
  }

  private loadDefs() {
    return this.defsReady ??= loadSpriteDefs(this.loader).then(d => { this.defs = d; }).catch(e => { console.warn("battle sprites failed to load", e); });
  }

  get appearance(): Appearance {
    const s = this.save();
    return (s.appearance = normalizeAppearance(s.appearance));
  }

  /** Before world.start: the knight's dressing. */
  async dress(world: World) {
    this.world = world;
    world.dressing = await resolveDressing(world.data, this.appearance);
  }

  /** After world.start: the companion. */
  async accompany(world: World) {
    this.world = world;
    await this.loadDefs();
    world.companion?.dispose();
    world.companion = null;
    const c = await createCompanion(this.defs, this.sprites.active(), world.spriteWorld());
    if (c && this.world === world) { c.hotkeys = this.hotkeys; world.companion = c; }
  }

  /** The world ended (left the level). */
  leave(world: World) { if (this.world === world) this.world = null; }

  private async refreshSprite() {
    const w = this.world;
    if (!w?.knight) return;
    const active = this.sprites.active();
    if (w.companion && active && w.companion.def.name === active.name) {
      // same sprite: a new form, recharges and perks
      Object.assign(w.companion.progress, active);
      await w.companion.refresh();
      w.companion.eat();
    } else await this.accompany(w);
  }

  private async redress() {
    const w = this.world;
    this.persist();
    if (!w?.knight) return;
    await w.redress(await resolveDressing(w.data, this.appearance));
    this.onRedress?.();
  }

  // ---------------------------------------------------------------- API for the UI and missions

  /** Chooses the battle sprite ("Drakon", "Maskeraith", "Seraphynx" or a variant), or "" for none. */
  setSprite(name: string) { return this.sprites.setSprite(name); }

  /** Uses the companion's skill i (0 to 2). */
  useSkill(i: number) { return this.world?.companion?.use(i) ?? false; }

  /** Battle sprite names (for a picker). */
  async spriteNames() { await this.loadDefs(); return [...this.defs.keys()]; }

  /** Puts on an accessory item (or accessory config); false if it is not one. */
  async equipAccessory(name: string): Promise<boolean> {
    const data = this.world?.data;
    if (!data) return false;
    await loadAccessoryLibraries(data);
    const def = accessoryDef(data, name);
    if (!def) return false;
    equipAccessory(this.appearance, name, def, n => accessoryDef(data, n));
    await this.redress();
    return true;
  }

  async removeAccessory(slot: AccessorySlot) { removeAccessory(this.appearance, slot); await this.redress(); }

  /** Wears a costume over the armour, helmet or shield ("" takes it off). */
  async equipCostume(slot: CostumeSlot, item: string) { equipCostume(this.appearance, slot, item); await this.redress(); }
}
