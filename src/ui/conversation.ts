// Talking to townsfolk: the game's conversation interface (rsrc/ui/conversation/interface.dat,
// or a node's own, such as interface_centeredimage.dat), filled the way the client's
// conversation dialog fills it:
//
//  - #name: the speaker's name, #message: the node's message (the knight's name for {0});
//  - #portrait: the NPC's model playing the node's animation, #portrait_reply: the knight;
//  - #responses (parts/responses.dat): one row per response, a cursor beside the selected one
//    (up and down or the mouse move it; Space, Enter or a click picks it), Escape leaves.
//
// The way from node to node is src/game/conversation.ts's; text comes from the message
// bundles through messageText.

import { CONFIG_REF } from "../config/params";
import { buildInterface, messageText, pack, type Component, type GuiContext, type RenderHooks } from "./gui";
import { OverlayScreen } from "./overlay";
import { nextNode, type NpcConversation as Conversation } from "../game/conversation";

type ViewHook = NonNullable<RenderHooks["view"]>;
const DEFAULT_UI = "ui/conversation/interface.dat";
const RESPONSES = "ui/conversation/parts/responses.dat";

export interface ConversationHost {
  sound(file: string): void;
  /** Draws a RenderableView: the NPC (with its model and animation) or the knight. */
  view(who: "npc" | "knight", anim: any): ViewHook | null;
  /** The conversation ended. */
  closed(): void;
}

export class ConversationScreen extends OverlayScreen {
  private conv: Conversation | null = null;
  private knight = "";
  private node = -1;
  private came: number[] = [];
  private ui: Component | null = null;
  private rows: { on: Component; off: Component; button: Component }[] = [];
  private selected = 0;
  private npcView: ViewHook | null = null;
  private knightView: ViewHook | null = null;
  private token = 0;

  constructor(private readonly ctx: GuiContext, parent: HTMLElement, private readonly host: ConversationHost) {
    super(parent, 7, "conversation-canvas");
    this.fadeTime = 0.15;
  }

  get isOpen() { return this.conv !== null; }

  /** Loads the interfaces ahead of the first conversation (in town idle time). */
  static async prebuild(ctx: GuiContext) {
    await Promise.all([DEFAULT_UI, RESPONSES].map(name => buildInterface(ctx, { $class: CONFIG_REF, name })));
  }

  /** Starts a conversation at its first node. */
  async start(conv: Conversation, knightName: string) {
    this.conv = conv;
    this.knight = knightName;
    this.came = [];
    this.knightView = this.host.view("knight", null);
    await this.show(0);
    this.open();
  }

  /** Ends the conversation. */
  end() {
    if (!this.conv) return;
    this.conv = null;
    this.node = -1;
    this.close();
    this.host.sound("sound/feedback/ui_dismiss.ogg");
    this.host.closed();
  }

  /** Keys while open: true when handled. */
  key(e: KeyboardEvent): boolean {
    if (!this.conv) return false;
    const k = e.key;
    if (k === "Escape") { this.end(); return true; }
    if (k === "ArrowUp" || k === "w" || k === "W") { this.select(this.selected - 1); return true; }
    if (k === "ArrowDown" || k === "s" || k === "S") { this.select(this.selected + 1); return true; }
    if (k === " " || k === "Enter") { if (!e.repeat) this.choose(this.selected); return true; }
    return true;
  }

  /** The knight's text for {0} and the bundle's line for a key. */
  private text(key: string) {
    // (the client formats every line with the knight's name as its argument)
    const b = this.conv!.bundle, q = /^%/.test(key) ? key : `%${b}:${key}`;
    return messageText(`${q}|~${this.knight.replace(/\|/g, "")}`);
  }

  private async show(i: number) {
    const conv = this.conv!, node = conv.nodes[i];
    const token = ++this.token;
    const ref = node.userInterface?.name ? node.userInterface : { $class: CONFIG_REF, name: DEFAULT_UI };
    const [ui, ...copies] = await Promise.all([buildInterface(this.ctx, ref),
      ...node.responses.map(() => buildInterface(this.ctx, { $class: CONFIG_REF, name: RESPONSES }))]);
    if (token !== this.token || !ui || this.conv !== conv) return;
    this.node = i;
    const set = (tag: string, text: string) => { const c = ui.find(tag); if (c) c.text = text; };
    set("name", messageText(/^%/.test(conv.speaker) ? conv.speaker : `%${conv.bundle}:${conv.speaker}`));
    set("message", this.text(node.message));
    const dismiss = ui.find("dismiss");
    if (dismiss) dismiss.visible = false;
    // one row per response, from the response part's two sample rows (cursor on and off)
    const list = ui.find("responses");
    this.rows = [];
    if (list) {
      list.children = [];
      node.responses.forEach((r, n) => {
        const sample = copies[n]?.find("responses");
        const [on, off] = sample?.children ?? [];
        if (!on || !off) return;
        for (const row of [on, off]) {
          const b = row.children.find(c => c.kind === "button");
          if (b) b.text = this.text(r.text);
        }
        const button = on.children.find(c => c.kind === "button")!;
        const offButton = off.children.find(c => c.kind === "button");
        if (offButton) offButton.tag = `response_${n}`;
        if (button) button.tag = `response_${n}`;
        this.rows.push({ on, off, button });
      });
    }
    this.ui = ui;
    this.npcView = this.host.view("npc", node.animation);
    this.select(0);
  }

  private select(n: number) {
    if (!this.rows.length) return;
    const was = this.selected;
    this.selected = (n + this.rows.length) % this.rows.length;
    if (was !== this.selected) this.host.sound("sound/feedback/ui_rollover.ogg");
    const list = this.ui?.find("responses");
    if (list) list.children = this.rows.map((r, i) => (i === this.selected ? r.on : r.off));
  }

  private choose(n: number) {
    const conv = this.conv;
    if (!conv || this.node < 0) return;
    this.host.sound("sound/feedback/ui_confirm.ogg");
    const next = nextNode(conv.nodes, this.node, n, this.came[this.came.length - 1] ?? -1);
    if (next < 0) { this.end(); return; }
    // a return to a branch takes the branch off the way back
    if (this.came[this.came.length - 1] === next) this.came.pop(); else this.came.push(this.node);
    void this.show(next);
  }

  protected clicked(c: Component) {
    const m = /^response_(\d+)$/.exec(c.tag);
    if (m) this.choose(Number(m[1]));
  }

  protected hooks(): RenderHooks {
    const npc = this.npcView, knight = this.knightView;
    return { view: (c, g, x, y, w, h) => { (c.tag === "portrait_reply" ? knight : c.tag === "portrait" ? npc : null)?.(c, g, x, y, w, h); } };
  }

  protected layers(w: number, h: number) {
    const ui = this.ui;
    if (!ui || !this.conv) return [];
    // the interface spans the screen (its letterboxing and corners anchor to the edges)
    ui.preferredSize = { width: Math.round(w), height: Math.round(h) };
    pack(ui);
    return [{ ui, x: 0, y: Math.round(h) }];
  }
}
