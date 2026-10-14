// The options window's custom controls page: the game's rsrc/ui/options/customcontrols.dat
// (Command / Key 1 / Key 2 / Gamepad columns over a scrolling table), its rows built from the
// page's own header label and key button configs, one per rebindable action. Clicking a key
// button waits for a key (Escape cancels); a key belongs to one action, so the action that had
// it takes the rebound action's old key. Undo steps back; the scheme buttons restore defaults
// or return to the control scheme page.

import { buildComponentConfig, type Component, type GuiContext } from "./gui";
import { buildUi, uiRef } from "./screen";
import { ACTIONS, defaultSettings, gameKeyName, keyName, WHEEL_KEYS, type Action, type Settings } from "./settings";

/** The fixed second keys (the arrows move too; the wheel's turns change weapons, WHEEL_KEYS). */
const KEY2: Partial<Record<Action, string>> = { up: "Up", down: "Down", left: "Left", right: "Right" };
const key2 = (a: Action) => KEY2[a] ?? (WHEEL_KEYS[a] ? gameKeyName(WHEEL_KEYS[a]!) : "");
/** The gamepad's fixed buttons (src/gamepad.ts). */
const PAD: Partial<Record<Action, string>> = {
  up: "Left Stick", down: "Left Stick", left: "Left Stick", right: "Left Stick", dash: "X", interact: "Y", cycle: "RB", prevWeapon: "LB",
  item1: "D-Pad Up", item2: "D-Pad Right", item3: "D-Pad Down", item4: "D-Pad Left", turnLeft: "Right Stick", turnRight: "Right Stick",
};

/** "Dash (also Shift + right click)" is "Dash" in the command column. */
const command = (a: Action) => ACTIONS[a].label.replace(/\s*\(.*\)$/, "");

export interface KeyBindingHooks {
  changed(): void;
  sound(file: string): void;
  /** Back to the control scheme page. */
  back(): void;
}

export class KeyBindings {
  /** The action waiting for a key press. */
  binding: Action | null = null;
  private buttons = new Map<Action, Component>();
  private history: Record<Action, string>[] = [];
  private status: Component | null = null;
  private undo: Component | null = null;

  private constructor(readonly root: Component, private readonly settings: Settings, private readonly hooks: KeyBindingHooks) {}

  static async build(ctx: GuiContext, settings: Settings, hooks: KeyBindingHooks): Promise<KeyBindings | null> {
    const host = await buildUi(ctx, uiRef("ui/options/customcontrols.dat"));
    const root = host?.children[0];
    if (!host || !root) return null;
    const kb = new KeyBindings(root, settings, hooks);
    await kb.init(ctx, host);
    return kb;
  }

  private async init(ctx: GuiContext, host: Component) {
    const root = this.root;
    const table = root.find("key_mappings");
    const keyTemplate = root.find("button_mod1");
    // the header row's labels: Command (160 wide), Key 1, Key 2, Gamepad (110 each)
    const header = findParent(root, c => c.children.some(k => k.config?.text === "m.command"));
    const cmdCfg = header?.children.find(k => k.config?.text === "m.command")?.config;
    if (!table || !keyTemplate || !cmdCfg) return;
    // "m.key_gamepad" reads "Key Gamepad", too long for its column
    const pad = header?.children.find(k => k.config?.text === "m.key_gamepad");
    if (pad) pad.text = "Gamepad";
    const local = keyTemplate.local.size ? keyTemplate.local : host.local;
    const label = (text: string) => buildComponentConfig(ctx, { ...cmdCfg, text }, local);
    const key = (tag: string, text: string) => buildComponentConfig(ctx, { ...keyTemplate.config, tag, text }, local);
    const rows = await Promise.all((Object.keys(ACTIONS) as Action[]).map(async a => {
      const [l, k1, k2, pad] = await Promise.all([label(command(a)), key(`key_${a}`, keyName(this.settings.keys[a])),
        key(`key2_${a}`, key2(a)), key(`pad_${a}`, PAD[a] ?? "")]);
      k2.enabled = false;
      pad.enabled = false;
      k1.onAction = () => this.press(a);
      this.buttons.set(a, k1);
      return [l, k1, k2, pad];
    }));
    table.children = rows.flat();
    for (const c of table.children) c.constraints = {};
    const only = root.find("keyboard_only"), mouse = root.find("keyboard_mouse");
    if (only) { only.text = "Restore Default Keys"; only.onAction = () => this.restore(); }
    if (mouse) { mouse.text = "Back"; mouse.onAction = () => { this.cancel(); this.hooks.sound("sound/feedback/ui_dismiss.ogg"); this.hooks.back(); }; }
    this.status = root.find("controls_status");
    this.undo = root.find("undo");
    if (this.undo) this.undo.onAction = () => this.stepBack();
    this.refresh();
  }

  /** Puts the bindings into the buttons. */
  refresh() {
    for (const [a, b] of this.buttons) {
      b.text = this.binding === a ? "Press a key" : keyName(this.settings.keys[a]);
      b.selected = this.binding === a;
    }
    if (this.status) this.status.text = this.binding ? `Press a key for ${command(this.binding)}. Escape cancels.` : "Click a key to change it.";
    if (this.undo) this.undo.enabled = this.history.length > 0;
  }

  private press(a: Action) {
    this.binding = this.binding === a ? null : a;
    this.hooks.sound("sound/feedback/ui_confirm.ogg");
    this.refresh();
  }

  cancel() {
    if (!this.binding) return;
    this.binding = null;
    this.refresh();
  }

  /** A key went down while waiting for one: binds it (Escape cancels). */
  key(e: KeyboardEvent) {
    const a = this.binding;
    if (!a) return;
    this.binding = null;
    if (e.key !== "Escape") {
      const key = e.key.toLowerCase(), keys = this.settings.keys;
      if (keys[a] !== key) {
        this.history.push({ ...keys });
        // a key belongs to one action: the old owner takes the rebound action's previous key
        const old = keys[a];
        for (const o of Object.keys(keys) as Action[]) if (keys[o] === key) keys[o] = old;
        keys[a] = key;
        this.hooks.changed();
      }
      this.hooks.sound("sound/feedback/ui_confirm.ogg");
    } else this.hooks.sound("sound/feedback/ui_dismiss.ogg");
    this.refresh();
  }

  private restore() {
    this.cancel();
    const d = defaultSettings().keys;
    if (JSON.stringify(d) !== JSON.stringify(this.settings.keys)) this.history.push({ ...this.settings.keys });
    this.settings.keys = d;
    this.hooks.sound("sound/feedback/ui_confirm.ogg");
    this.hooks.changed();
    this.refresh();
  }

  private stepBack() {
    this.cancel();
    const prev = this.history.pop();
    if (!prev) return;
    this.settings.keys = prev;
    this.hooks.sound("sound/feedback/ui_confirm.ogg");
    this.hooks.changed();
    this.refresh();
  }
}

/** The first component (depth first) matching the test. */
export function findParent(root: Component, test: (c: Component) => boolean): Component | null {
  if (test(root)) return root;
  for (const k of [...root.children, ...root.tabs]) { const r = findParent(k, test); if (r) return r; }
  return null;
}
