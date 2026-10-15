// The Event Hub (the HUD's feed button, F7): the client's FeedListPanel in its docked window
// (social/client/i, a client/g docked at the screen's left, past the Social window when that is
// open, full height above the HUD). The panel is the arsenal list window
// (ui/arsenal/interface.dat in Window mode) titled t.feed, its search bar, infobox and crowns
// line hidden, with four groups (SocialCodes.FeedGroup): Events, Today, This Week and Last Week,
// each "Name (count)" and folded or opened as the player left it (ProjectXPrefs
// social_group_<group>). Every row is a news feed entry (ui/newsfeed/parts/interface_entry.dat):
//
//  - Events (Style Event): the mission the client suggests and, here, every event mission open
//    now ("Start Mission: ...", the mission icon, INSPECT! opening it on the mission board, as
//    as.dW does). The parties of friends and guildmates to join and the Coliseum sign-up are
//    other players' and are left out.
//  - Today, This Week, Last Week (Style History): the knight's own deeds, newest first, with
//    "N minutes ago" (src/game/feed.ts). With nothing to list, the panel's one row says
//    m.empty_feed.

import { feedEntries, FEED_GROUPS, type FeedGroup } from "../game/feed";
import type { Mission } from "../game/missions";
import type { SaveData } from "../game/save";
import { compose, taint, text, xlate } from "../i18n";
import type { Component } from "./gui";
import { ItemList, type ListEntry, type ListGroup } from "./itemlist";
import { GuiScreen, uiRef, type ScreenHost } from "./screen";

export interface EventHubHost extends ScreenHost {
  save(): SaveData;
  name(): string;
  /** The missions the Events group offers (MissionBoard.hubMissions). */
  missions(): Promise<Mission[]>;
  /** INSPECT!: the mission board opened on a mission. */
  inspect(id: string): void;
  /** The x the window docks at: past the Social window when it is open (as.DK). */
  dockX(): number;
}

const ENTRY = "ui/newsfeed/parts/interface_entry.dat";
/** ProjectXPrefs.e("social", group, open): the folds, kept per group. */
const PREF = (g: string) => `clyde-web.social_group_${g}`;
const readPref = (g: string) => { try { return localStorage.getItem(PREF(g)); } catch { return null; } };
const writePref = (g: string, open: boolean) => { try { localStorage.setItem(PREF(g), open ? "1" : "0"); } catch { /* storage unavailable */ } };

export class EventHubScreen extends GuiScreen {
  private list: ItemList | null = null;
  /** The mission each event row's button inspects, by row key. */
  private inspects = new Map<string, string>();

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly hub: EventHubHost) {
    super(ctx, hub, "eventHubCanvas");
    // social/client/i: a client/g docked at the left (past the Social window), the game left undimmed
    this.dockLeft = () => hub.dockX();
  }

  protected async build(): Promise<Component | null> {
    const ui = await this.ui("ui/arsenal/interface.dat", { Mode: "Window", "Infobox Visible": false });
    if (!ui) return null;
    this.on(ui, "dismiss", () => this.close());
    // FeedListPanel: the search bar is hidden
    const bar = ui.find("search_bar");
    if (bar) bar.visible = false;
    const list = this.list = new ItemList(this.ctx, ui, this.tips, f => this.host.sound(f));
    list.clicks = this.clicks;
    list.bundle = "social";
    for (const g of FEED_GROUPS) if (readPref(g) === "0") list.collapsed.add(g);
    list.onToggle = () => { for (const g of FEED_GROUPS) writePref(g, !list.collapsed.has(g)); };
    // social/client/b: the empty feed's row
    list.emptyRow = uiRef(ENTRY, { Style: "History", Icon: "ui/icon/social/ignored.png", Info: "",
      Description: text("social", "m.empty_feed", "No recent event activity. Check back later.") });
    list.onRow = (e, c) => {
      const id = this.inspects.get(e.key);
      const b = c.find("eventbutton");
      if (b && id) b.onAction = () => { this.host.sound("sound/feedback/ui_confirm.ogg"); this.hub.inspect(id); };
    };
    return ui;
  }

  protected async refresh() {
    const list = this.list;
    if (!list) return;
    // FeedListPanel's title (t.feed) over the list, no infobox or crowns
    list.setInfo(text("social", "t.feed", "EVENT HUB"), "", "", null);
    const now = Date.now();
    const groups = new Map<FeedGroup, ListEntry[]>(FEED_GROUPS.map(g => [g, []]));
    this.inspects.clear();
    // FeedListPanel.f: "Start Mission: ..." with the mission icon and INSPECT!
    const missions = await this.hub.missions().catch(() => [] as Mission[]);
    for (const m of missions) {
      const key = "mission:" + m.id;
      this.inspects.set(key, m.id);
      groups.get("g.events")!.push(this.row(key, {
        Style: "Event", Icon: "ui/icon/social/mission.png", Info: text("social", "m.inspect", "INSPECT!"),
        Description: xlate("social", compose("m.attempt_mission", taint(m.title))),
      }));
    }
    // FeedListPanel.b: the history, each line the player's own (m.you)
    for (const e of feedEntries(this.hub.save(), this.hub.name(), now)) {
      groups.get(e.group)!.push(this.row(e.key, { Style: "History", Icon: e.icon, Info: xlate("social", e.info), Description: xlate("social", e.description) }));
    }
    const out: ListGroup[] = FEED_GROUPS.map(g => ({ id: g, label: text("social", g, g), icon: null, entries: groups.get(g)! }));
    await list.setGroups(out);
  }

  private row(key: string, args: Record<string, unknown>): ListEntry {
    return { key, label: String(args.Description ?? ""), rarity: -1, icon: null, ui: uiRef(ENTRY, args) };
  }
}
