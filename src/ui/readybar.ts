// The Ready Room's bar: a small titled window (rsrc/ui/window/titled.dat) at the top of the
// room with the game's buttons for the arsenal and the way back to Haven. It floats over the
// room without covering it.

import type { Component, GuiContext } from "./gui";
import { FloatScreen, styledButton, type Placement } from "./floating";
import { row } from "./screen";

export interface ReadyBarHooks {
  arsenal(): void;
  leave(): void;
}

export class ReadyBar extends FloatScreen {
  constructor(ctx: GuiContext, private readonly bar: ReadyBarHooks) {
    super(ctx, "readyCanvas");
  }

  protected place(cw: number, _ch: number, w: number): Placement { return { x: (cw - w) / 2, y: 16 }; }

  protected async build(): Promise<Component | null> {
    const ui = await this.ui("ui/window/titled.dat", { Title: "Ready Room" });
    if (!ui) return null;
    // the room is left by its own button, not the dismiss button
    const dismiss = ui.find("dismiss");
    if (dismiss) dismiss.visible = false;
    const content = ui.find("content");
    const parent = content && this.parentOf(ui, content);
    if (content && parent) {
      const [arsenal, leave] = await Promise.all([
        styledButton(this.ctx, "Arsenal (I)", () => this.bar.arsenal(), ui.local, "Default/Button (Yellow)/Button"),
        styledButton(this.ctx, "Return to Haven", () => this.bar.leave(), ui.local),
      ]);
      const buttons = row([arsenal, leave], 10, "CENTER");
      buttons.constraints = content.constraints;
      parent.children[parent.children.indexOf(content)] = buttons;
    }
    return ui;
  }

  private parentOf(root: Component, c: Component): Component | null {
    for (const k of root.children) {
      if (k === c) return root;
      const p = this.parentOf(k, c);
      if (p) return p;
    }
    return null;
  }

  protected refresh() {}
}
