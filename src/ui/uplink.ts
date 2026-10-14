// The uplink: the game's news and mail window (rsrc/ui/uplink/interface.dat), opened from the
// HUD's mail button on its Mail tab, and on its News tab with the Event Hub on the first
// arrival in a town of the session (as.DX). The News tab's promotions were images streamed from the
// game's servers; here the tab lists this port's news as news feed entries
// (ui/newsfeed/parts/interface_entry.dat). The Mail tab is the game's mailbox: a header per
// letter (parts/interface_mailheader.dat) that opens its body (parts/interface_mailbody.dat)
// beneath it, with Mark All, Compose (disabled: there is no one to write to) and MailPanel's
// m.autoprune line under the list. Invites (e-mail invitations) and gifts are online and stay hidden.

import type { SaveData } from "../game/save";
import { buildComponentConfig, restyle, selectTab, type Component } from "./gui";
import { text } from "../i18n";
import { GuiScreen, uiRef, buildUi, type ScreenHost } from "./screen";
import { styledLabel } from "./floating";

export interface UplinkHost extends ScreenHost {
  save(): SaveData;
  write(): void;
}

type Letter = NonNullable<SaveData["mail"]>[number];

/** What this port has and lacks (the game's feed came from its servers). */
export const NEWS: [string, string][] = [
  ["The Clockworks are open", "Four gates a day in the Arcade, six strata from depth 1 to 28, terminals, Moorcroft Manor, Emberlight and the Core."],
  ["Generated floors", "Floors are built from the game's own tiles, spawners, gates and treasure; the real layouts of levels you have not visited are not in the install."],
  ["Single player", "Parties, trading, PvP and guild chat are online features and are not part of this port."],
];

const ENTRY = "ui/newsfeed/parts/interface_entry.dat";
const HEADER = "ui/uplink/parts/interface_mailheader.dat";
const BODY = "ui/uplink/parts/interface_mailbody.dat";

/** The mailbox, with the welcome letter on first use. */
export function mailbox(save: SaveData): Letter[] {
  const mail = save.mail ??= [];
  if (!mail.length) mail.push({ from: "Spiral HQ", subject: "Welcome to Haven", at: Date.now(), read: false,
    body: "Welcome, knight. Visit the Bazaar for gear, then take a gate in the Arcade into the Clockworks. Good luck below!" });
  return mail;
}

/** MailPanel's date: "dd MMM yyyy". */
const date = (t: number) => {
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}`;
};

/** Spiral HQ's letters are the game's sealed announcements; the rest are letters. */
const official = (m: Letter) => /spiral hq/i.test(m.from);

export class UplinkScreen extends GuiScreen {
  /** The letter open beneath its header. */
  private opened: Letter | null = null;
  private tab: "news" | "mail" = "news";
  private generation = 0;
  /** The mailbox's status line (MailPanel's m.autoprune). */
  private footer: Component | null = null;

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly up: UplinkHost) {
    super(ctx, up, "uplinkCanvas");
  }

  /** Opens on a tab: the news feed or the mailbox. */
  async show(tab: "news" | "mail") {
    this.tab = tab;
    if (tab === "mail") this.up.write();
    await this.open();
  }

  protected async build(): Promise<Component | null> {
    const ui = await this.ui("ui/uplink/interface.dat");
    if (!ui) return null;
    this.on(ui, "dismiss", () => this.close());
    const pane = ui.find("tabs");
    // invites and gifts come from other players
    pane?.parts.buttons?.children.forEach((b, i) => { if (i >= 2) b.visible = false; });
    if (pane) pane.onAction = c => { this.tab = c.selectedIndex === 1 ? "mail" : "news"; this.host.sound("sound/feedback/ui_dropdown_select.ogg"); void this.refresh(); };
    // the window's title and the mark-all button are the uplink bundle's
    const title = ui.find("container_uplink")?.children[0]?.children.find(k => k.kind === "label");
    if (title) title.text = text("uplink", "m.title", "SPIRAL UPLINK");
    // the news promotions were server images: the tab lists news feed entries instead
    const news = ui.find("newstab");
    const page = news?.children[0];
    if (page) {
      page.layout = { $class: "LayoutConfig$VerticalGroup", policy: { name: "NONE" }, justification: { name: "TOP" }, offAxisPolicy: { name: "STRETCH" }, gap: 6 };
      const entries = await Promise.all(NEWS.map(([title, text]) => buildUi(this.ctx, uiRef(ENTRY, { Description: text, Info: title }))));
      page.children = entries.filter((e): e is Component => !!e);
      for (const e of page.children) {
        e.constraints = null;
        // the headline sits above the text, as the entry's own date line does below it
        const desc = e.find("description"), when = e.find("date");
        const col = desc && when ? this.parentOf(e, desc) : null;
        if (col && when) col.children = [when, desc!, ...col.children.filter(k => k !== desc && k !== when)];
      }
    }
    const mail = ui.find("mailtab");
    // there is no one to write to in single player: Compose shows, disabled
    const compose = mail?.find("button_compose");
    if (compose) compose.enabled = false;
    // MailPanel's status line under the mailbox: m.autoprune while there is mail
    const cont = mail?.find("mail_cont");
    if (cont) {
      this.footer = await styledLabel(this.ctx, text("uplink", "m.autoprune", "Note: Mail is automatically deleted 30 days after sent date."), "Default/Label");
      this.footer.constraints = null;
      cont.children = [...cont.children, this.footer];
    }
    const markall = mail?.find("button_markall");
    if (markall) markall.text = text("uplink", "m.markall", "Mark All");
    if (mail) this.on(mail, "button_markall", () => {
      for (const m of mailbox(this.up.save())) m.read = true;
      this.up.write();
      this.host.sound("sound/feedback/ui_confirm.ogg");
      void this.refresh();
    });
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

  protected async refresh() {
    const ui = this.root;
    if (!ui) return;
    const pane = ui.find("tabs");
    if (pane) selectTab(pane, this.tab === "mail" ? 1 : 0);
    // UplinkWindow: the Mail tab carries the notice icon while a letter is unread
    const unread = mailbox(this.up.save()).some(m => !m.read);
    const mailTab = pane?.parts.buttons?.children[1];
    if (mailTab && (mailTab as any).__unread !== unread) {
      (mailTab as any).__unread = unread;
      const icon = unread ? { $class: "com.threerings.opengl.gui.config.IconConfig$Image", file: "ui/icon/notice.png" } : { $class: "com.threerings.opengl.gui.config.IconConfig$Blank" };
      await restyle(this.ctx, mailTab, "Default/Tab", { Icon: icon }).catch(() => undefined);
    }
    if (this.footer) this.footer.visible = mailbox(this.up.save()).length > 0;
    const list = ui.find("mail_list");
    if (!list) return;
    const gen = ++this.generation;
    const mail = [...mailbox(this.up.save())].reverse();
    const rows: Component[] = [];
    for (const m of mail) {
      // MailPanel: the seal on official mail, the letter or announcement icon, lit while unread
      const h = await buildUi(this.ctx, uiRef(HEADER, { "Seal Icon": official(m) ? "ui/icon/spiralseal.png" : null,
        Icon: `ui/icon/uplink/icon_${official(m) ? "announcement" : "letter"}.png`, "Icon Color": m.read ? "Read" : "Unread",
        Subject: m.subject, From: m.from, Date: date(m.at) }));
      if (!h) continue;
      const sel = h.find("entryselect");
      if (sel) {
        sel.selected = this.opened === m;
        sel.onAction = c => {
          if ((this.opened === m) === c.selected) return;
          this.opened = c.selected ? m : null;
          if (this.opened && !m.read) { m.read = true; this.up.write(); }
          this.host.sound("sound/feedback/ui_dropdown_select.ogg");
          void this.refresh();
        };
      }
      rows.push(h);
      if (this.opened === m) {
        const b = await buildUi(this.ctx, uiRef(BODY));
        if (b) {
          // the letter's text, wrapped as a label in the editor's own style (nothing here is edited)
          const editor = b.find("mail_body"), col = editor ? this.parentOf(b, editor) : null;
          if (editor && col) {
            const text = await buildComponentConfig(this.ctx, { ...editor.config, $class: "ComponentConfig$Label", text: m.body }, editor.local);
            text.constraints = editor.constraints;
            col.children = col.children.map(k => k === editor ? text : k);
          }
          // letters here carry nothing to accept, reply to or report
          for (const tag of ["attachments_list", "actions_list"]) { const c = b.find(tag); if (c) c.visible = false; }
          rows.push(b);
        }
      }
    }
    if (gen !== this.generation) return;
    for (const r of rows) r.constraints = null;
    list.children = rows;
  }
}
