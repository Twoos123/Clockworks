// The social window (the HUD's social button, F6): the client's social list (social/client/F
// and p, on client/d's ui/arsenal/interface.dat in Window mode), docked at the screen's left
// edge from the top, as tall as the screen less 145 pixels (client/g, as.i). Its groups come
// in SocialCodes.Group's order, each shown as the client's rules say:
//
// - PARTY: only in a party (never here).
// - FRIENDS (online / all, m.group_count_of) with the Friends Options header under it.
// - GUILD (online / members) with the Guild Options header showing the guild's name, or
//   "<No Guild>"; its members' pills (ui/social/parts/interface_pill.dat: name, where they are,
//   rank). The only member here is the knight.
// - OFFLINE (interface_subheader.dat) while either offline group shows; then FRIENDS (offline)
//   and, with a guild, GUILD (offline).
// - IGNORED: only with someone ignored (never here).
//
// Single player has no other players, so the friends groups are empty. Guild Options pops up
// the personal menu's guild options, as the client's header does (cr.aJ).

import { message, text } from "../i18n";
import type { Component, MenuEntry } from "./gui";
import { ItemList, type ListGroup } from "./itemlist";
import { GuiScreen, uiRef, type ScreenHost } from "./screen";

const HEADER = "ui/social/parts/interface_header.dat";
const SUBHEADER = "ui/social/parts/interface_subheader.dat";
const PILL = "ui/social/parts/interface_pill.dat";
const ICON = (name: string) => `ui/icon/social/${name}.png`;

export interface SocialHost extends ScreenHost {
  /** The knight's name. */
  knight(): string;
  /** The knight's guild's name, or null without one. */
  guild(): string | null;
  /** Where the knight is, as the pill's icon shows it (Whereabouts.Z): a town, a guild hall, the Clockworks. */
  whereabouts(): "town" | "guild" | "dungeon";
  /** The personal menu's guild options (cr.aJ) and what choosing one does. */
  guildOptions(): { entries: MenuEntry[]; run(action: string): void };
}

export class SocialScreen extends GuiScreen {
  private list: ItemList | null = null;

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly social: SocialHost) {
    super(ctx, social, "socialCanvas");
    // client/g: docked at the left edge (the event hub docks beside it), the game left undimmed
    this.dockLeft = () => 0;
    this.dim = false;
  }

  toggle() { if (this.isOpen) this.close(); else void this.open(); }

  protected async build(): Promise<Component | null> {
    const ui = await this.ui("ui/arsenal/interface.dat", { Mode: "Window" });
    if (!ui) return null;
    this.on(ui, "dismiss", () => this.close());
    const list = this.list = new ItemList(this.ctx, ui, this.tips, f => this.host.sound(f));
    list.bundle = "social";
    list.clicks = this.clicks;
    list.menu = (e, t, c) => void this.popupMenu(e, t, c);
    return ui;
  }

  protected async refresh() {
    const list = this.list;
    if (!list) return;
    list.setInfo(text("social", "t.social", "SOCIAL"), "", "", null);
    const t = (k: string, f: string) => text("social", k, f);
    const countOf = (name: string, n: number, of: number) => message("item", "m.group_count_of", name, n, of) || `${name} (${n}/${of})`;
    const count = (name: string, n: number) => message("item", "m.group_count", name, n) || `${name} (${n})`;
    const guild = this.social.guild();
    const friends = t("m.friend", "FRIENDS"), guildName = t("m.guild", "GUILD");
    const where = this.social.whereabouts();
    const me = this.social.knight();
    // the knight, the guild's only member: online, at the guild's highest rank (m.rank.0)
    const members = guild ? [{
      key: "me", label: me, rarity: -1, icon: null,
      ui: uiRef(PILL, { Name: me, Icon: where === "guild" ? ICON("guild") : where === "town" ? "ui/icon/map/town.png" : "ui/icon/map/clockwork.png",
        Colorization: [], Secondary: text("guild", "m.rank.0", "Guild Master") }),
    }] : [];
    const groups: ListGroup[] = [
      { id: "friend", label: friends, icon: ICON("friend"), entries: [], showEmpty: true, title: countOf(friends, 0, 0),
        extra: { ref: uiRef(HEADER, { "Options Label": t("m.friends_options", "Friends Options"), "Show Information": false }) } },
      { id: "guild", label: guildName, icon: ICON("guild"), entries: members, showEmpty: true,
        title: guild ? countOf(guildName, members.length, members.length) : count(guildName, 0),
        extra: { ref: uiRef(HEADER, { "Options Label": text("guild", "m.guild_options", "Guild Options"),
          "Information Label": guild ?? text("guild", "m.no_guild", "<No Guild>") }), click: () => this.guildOptions() } },
      { id: "offline", label: "", icon: "", entries: [], showEmpty: true, headerRef: uiRef(SUBHEADER, { "Options Label": t("m.offline_up", "OFFLINE") }) },
      { id: "friend_offline", label: friends, icon: ICON("friend"), entries: [], showEmpty: true },
      ...(guild ? [{ id: "guild_offline", label: guildName, icon: ICON("guild"), entries: [], showEmpty: true }] : []),
    ];
    await list.setGroups(groups);
  }

  /** The Guild Options header: the personal menu's guild options. */
  private guildOptions() {
    const { entries, run } = this.social.guildOptions();
    this.host.sound("sound/feedback/ui_dropdown_activate.ogg");
    void this.popupMenu(entries, text("guild", "m.guild_options", "Guild Options"), run);
  }
}
