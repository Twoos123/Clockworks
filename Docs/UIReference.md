# The original's interface, from the user's screenshots (2026-09-16)

The user sent reference screenshots of every major screen. This is what they show, so the work can be
done against a description rather than from memory. Art lives in `rsrc/ui`; the HUD was already
rebuilt from `rsrc/ui/hud_v2` the same way.

**Standing rule, the user's:** every button should do its job, and any that is not built yet must say
so on screen rather than doing nothing silently.

---

## 1. Title screen — `rsrc/ui/logon`

Assets found: `logo.png` (393x145), `footer_havens.png` (195x80, the Grey Havens mark),
`border.png` (1024x768, a vignette), `interface.dat` (layout), `parts/skybox.dat` and
`parts/ambient_gears.dat`. **The background is a 3D skybox scene, not a flat image** — the planet
Cradle, lit from behind, with a moon, drifting motes and a gold serpent coiled round it.

Two variants exist, and the user sent both:

- **Web:** ACCOUNT NAME and ACCOUNT PASSWORD fields, a "Login as Guest" checkbox, a status line
  ("Failed to connect to the server."), then **Logon**, **Quit**, **Options**, the Terms of Service
  line, and Help & Support / Forgot your password links.
- **Steam:** just a "Use Steam Account" checkbox, then **Logon**, **Quit**, **Options** and the same
  Terms line.

**Build the Steam variant.** It is faithful to the original and has no credential entry at all,
which is the right answer for an offline game with no server. Logon starts the game.

## 2. Character select

"SELECT A CHARACTER" over the same planet background. A row of cards, each: a gold name plate, a
portrait of the knight in a lit alcove, then `Rank:`, `Guild:`, `Played:` and a red **Delete**
button. Bottom left a **Log off** arrow; bottom right an **Energy** readout.

Maps onto offline save slots.

## 3. The ready room

The 3D room you appear in after choosing a knight. Blue-lit, banks of monitors, gold machinery.
Overlaid:

- **EVENT HUB** (left, F7): a titled panel with Events / Today / This Week sections, each entry an
  icon, a line of text, a relative time, some with an **INSPECT!** or **SIGN UP!** button.
- **SPIRAL UPLINK** (centre): tabs **NEWS**, **MAIL**, **INVITES**. News is a picture, a headline
  and two lines of copy, plus a second card and an "OFFICIAL SPIRAL KNIGHTS WIKI" button.
  Mail is a table — Mark All and Compose buttons, SUBJECT / FROM / DATE columns, "You have no
  messages." when empty.
- **ACTIVITIES** (right): Go to Haven, Missions, Guild Halls, Coliseum, Party Finder, Supply Depot.
- The HUD's own system buttons bottom left and the icon row bottom right.

## 4. Missions (M)

Gold title bar: **MISSIONS**, a Prestige total and a Rank badge, close button. Below it a rank
progress bar with the rank name in the middle (VANGUARD) and the current and next rank at either end.

Four tabs, each with its own art: **RANK**, **PRESTIGE**, **EXPANSION**, **ARCADE**. Under them a
scrolling row of mission cards; a selected card is outlined gold with a pointer beneath. A card
shows its rank requirement, a picture and a name, and a badge for a locked or completed one.

Lower half, two columns:
- Left: the mission's name, its briefing, its objective in gold, then **REWARDS** (Prestige, items
  with quantities and star ratings). Before a card is picked it reads "Select a mission card to
  receive a mission briefing...", with a "Show mission introduction" checkbox.
- Right: **CONFIGURE YOUR PARTY** — Join Party, Create Public Party, Create Private Party, Play
  Solo; a difficulty spinner (arrows either side, "Elite"); a big **START** button.

**Arcade** replaces the briefing with a **Gate Map** / **Gate Materials** pair of tabs: a vertical
map of the gate's strata with depth numbers up the side, and tier buttons —
**TIER 1 (Depth 0)**, **TIER 2 (Depth 8)**, **TIER 3 (Depth 18)**.

## 5. Arsenal (I)

A tall left-hand panel: a search box with a clear cross, a **Sort (Name)** control, then collapsible
categories with counts — Battle Sprite (1), Sword (15), Handgun (10)... Each row: icon, name, damage
type pips, and a star rating. Selected rows are outlined gold. **Crowns** at the bottom, **Energy**
below that.

## 6. Character (P)

Title `<Current Equipment>` with **Save Loadout** and **Character Options**. Tabs: Equipment,
Costume, Battle Sprite, Achievements. Down the left a column of equipment slots, locked ones shown
with a padlock. Centre: the knight, lit, on a dark backdrop, with rank, name and prestige beneath.

## 7. Forge

Left: the same category list as the Arsenal, filtered to what can be forged. Centre: the item, its
**HEAT** bar and **LEVEL**, a large ring dial, the required crystal and how many are available, a
multiplier, and **APPLY CRYSTALS** with three crystal buttons. Right: **RESULTS** — Chance for Forge
Success as a percentage, **Enhancements**, **Possible Bonuses**. A wide **FORGE** button beneath.

## 8. Social (F6)

Search box, **FRIENDS (0/109)** with a Friends Options link, **GUILD (0)** with `<No Guild>` and
Guild Options, then an OFFLINE section listing friends as rounded rows.

## 9. Help (F1)

Tabs: Support, Controls, Energy, Clockworks, Monsters. The Controls tab lists Move, Attack, Change
Weapon, Inventory, Defend, Chat with their bindings and a line of explanation each, and an OPTIONS
MENU link. Two buttons at the foot: **Forums** and **Wiki**.

## 10. Main menu

A plain list, each with its shortcut: Arsenal (I), Character (P), Missions (M), Social (F6),
Event Hub (F7), Recipes (F5), Achievements (O), Messages, Options (Esc), Help (F1), Support,
Report a Bug, Crucible Editor, Purchase Energy, Redeem Code.

## 11. Supply Depot

Gold title bar: **SUPPLY DEPOT**, a Crowns total and an Energy total, close button. Under it a wide
banner picture of the vendor.

Left column, two headed groups:
- **ENERGY DEPOT** — Purchase, Trade, Market.
- **SUPPLY DEPOT** — Specials, Sword, Handgun, Bomb, Helmet, Armor, Shield, Rarity, Material,
  Usable, Sprite Gear, Accessory, Key, Ticket. The selected row is gold.
At the foot, a search box and a **Search** button.

Right: the category name as a large faint watermark, then item cards. A card has its star rating, a
picture, the price in energy, a SALE ribbon down both sides with the old price struck through, the
item's name, and a "13 hours left" footer.

This is the shop, and the economy is one of the systems the scope change reopened - so build the
screen when the economy is built, not before.

---

## What to build, in order

1. **The shell**: title screen (Steam variant), character select, and the ready room with its
   Activities panel. This is the path from launch to standing in the world.
2. **The overlays that already have data behind them**: Arsenal and Character (623 gear items and
   351 weapons exist), Help, Main menu.
3. **Missions**, once runs exist — the four tabs map onto the four boss runs and the Arcade gate.
4. **The rest**: Social, Forge, Spiral Uplink (news/mail/invites), Event Hub.

Everything not yet built shows the standing "not built yet" notice rather than nothing.

## What is deliberately not built

A working account login. The Steam variant of the title screen is faithful and has no credential
entry, so nothing is lost by it. Anything that asks for a real password is out — see `CLAUDE.md`,
"Scope".
