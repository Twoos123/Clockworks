# HUD audit: the client's HUD controllers against ours

The HUD was first built from the `rsrc/ui/hud_v2` interface files, before the client was
decompiled. The layouts came from the files, but what the client does to them in code was
guessed. This audit compares each HUD and in-dungeon UI class in the decompiled client with
`src/ui/hud.ts`, `src/ui/minimap.ts`, `src/ui/revive.ts`, `src/ui/elevator.ts` and
`src/main.ts`. The descriptions are ours, and no client code is reproduced. Class paths are
relative to `com/threerings/projectx/`.

Status: **fixed** (now done as the client does it), **flagged** (a known difference that is
still open), **n/a** (multiplayer, energy, PvP, or server features that single player does
not have).

The arsenal, forge, shop, missions, guild, uplink and options windows are covered by a
separate audit. Damage numbers, hitstop and hurt reactions belong to the combat-feel work in
`src/game/world.ts`.

## How the HUD is put together (`client/as`, `dungeon/client/i`, `ab`)

- **`client/as`** (the base HUD) places these parts:
  - minimap in the top-right corner;
  - status panel in the top-left corner;
  - description (target) panel at the top right, 200 px in from the edge;
  - item-acquire layer in the bottom-left;
  - help notice at the top centre, 120 px down.
- Towns (`client/dA`) use the base HUD.
- **`dungeon/client/i`** (the dungeon HUD) adds these parts:
  - quickbar at the bottom centre, only when the party has pickups;
  - weapon switcher at the centre;
  - dash cooldown at the bottom centre, 60 px up;
  - hit flash and low-health frame at the centre;
  - party list on the left, 150 px down;
  - clock timer at the top centre, 120 px down.
- **`ab`** replaces the status panel with a dungeon version, which adds the heat meter, debuffs and trailing bars.

## Status panel (`client/hud/F`, `dungeon/client/ab`)

| What the client does | What we did | Status |
|---|---|---|
| Health is shown as three stacked rows of up to 360 px each: red, then Pip Silver, then Pip Gold. Every row is restyled `Health-Recolor` with Variant and Colorization 261. The vitapod heart turns Silver above 360 px of maximum health and Gold above 720 px | One red row ran off the screen | fixed (previous commit) |
| The bars trail their values. A change leaves the old value as a difference segment, which closes by 10 points every 20 ms after 0.5 s. The segment is styled `Health` with Color `Heal` when the bar rises and `Damage` when it falls. `Shake` plays only on a loss | We drew `recentDamage` as a damage segment and never showed a heal segment | fixed |
| While the knight blocks (shield up, shield health > 0), health uses Variant `Pip Half` at 20 px high and the shield uses `Bar` at 32 px. Otherwise health uses `Pip` at 32 px and the shield `Bar Half` at 20 px. The vitapod is 20 or 32 px square and the shield icon the opposite | The panel was rebuilt on every block toggle, and the shield bar was given the Pip variants | fixed |
| The shield bar is (stars + 1) × 60 px wide, with the shield's health as a fraction of that. It uses Colorization 275, trails like health, and shakes on a loss. Without a shield, the shield row is hidden | Shield health was converted to pips like health (40 per pip) | fixed |
| Vitapod text: the lower of current and trailing health as a whole percentage, rounded down, with 1% while alive. It is blank while blocking, and the heart is disabled at 0 | Rounded up, and always shown | fixed |
| The heat meter shows the **floor's heat**, not the weapon's level. Levels step at 0, 20, 70, 140, 250, 500 and 800, from `Level 0` to `Level 7` on `ambient_heat.dat`. `Get Heat, Pulse` plays as heat comes in. The meter shows in dungeons only | It showed the equipped weapon's level | fixed |
| Debuffs: each condition's icon interface, with seconds as whole seconds left, rounded down and not padded | Seconds were rounded up and padded to "03" | fixed |
| The rank label is `c.rank` from the mission bundle ("Rank 1-1") | "RANK 1-1" | fixed |
| The portrait backdrop is restyled `Backing/Backdrop` with the personal colour | The file's default colour | fixed (passed as Portrait Colorization) |
| The rank icon is the prestige or player-type icon | The file's default icon | flagged (no prestige level in the save) |
| The portrait has an elliptical rim button that opens the personal menu (`m.personal_menu`); the pet portrait shows the battle sprite | Neither | flagged (no personal menu) |
| `revive` icon (Emergency Revive status), `icon_partyleader`, `mic` | Hidden | n/a (party features) |

## Low health and damage flashes (`dungeon/client/i`)

| What the client does | What we did | Status |
|---|---|---|
| The low-health frame shows while trailing health / maximum < 0.3. On recovery it runs `Fade Out` and is removed after 750 ms | The frame showed below 25% of current health, and was removed when its script ended | fixed |
| The `show_damage_effects` option gates both the red pulse and the low-health frame, in dungeons only | The option gated the pulse only | fixed |

## Quickbar (`dungeon/client/QuickbarPanel`, `ah`, `at`, `t`, `sprites/a/C`)

| What the client does | What we did | Status |
|---|---|---|
| `bs0` to `bs2` are replaced by the battle sprite's three skill slots (`interface_spriteslot.dat`). A slot is empty without the skill, shows cooldown seconds rounded while above 0, and is enabled only when ready | The three weapons sat in `bs0` to `bs2`, and the sprite slots floated above the bar | fixed |
| Pocket slot hotkeys come from the bound QUICKSLOT keys, at most 3 characters | The file's "1" to "4", while the keys were 4 to 7 | fixed |
| Towns have no quickbar; the dungeon HUD adds it | Shown everywhere | fixed |
| Slot style `Hud/Quickbar/Button:Disabled` while the HUD is locked; tooltips; dragging items onto slots | None | flagged (no HUD lock; pockets fill automatically) |
| The vitaslot shows the vitapod's capsule count from the item config | The capsule count is shown | matches |
| The event slot (`interface_eventslot.dat`) | Empty | n/a (event items) |

## Weapon switcher (`dungeon/client/au`)

| What the client does | What we did | Status |
|---|---|---|
| On a weapon change, `interface_weaponswitch.dat` appears at the screen centre for 0.9 s. It shows the new weapon at 60 px with its name, the two weapons before it above (40 and 30 px) and the two after it below. It runs `Scroll Down` when stepping back and `Scroll Up` otherwise. It is on by default (`show_weapon_switcher`) | Nothing appeared; the weapons were on the quickbar | fixed |

## Dash cooldown (`dungeon/client/f`)

| What the client does | What we did | Status |
|---|---|---|
| `interface_cooldown.dat` sits 60 px up from the bottom centre and shows the seconds left, rounded, while any are left | It sat 60 px above the quickbar and rounded up | fixed |

## Target panel (`client/hud/q`, `dungeon/client/g`)

| What the client does | What we did | Status |
|---|---|---|
| `interface_status-mini.dat` is built with Model null, Rank "" and Background Full. The model, status icon, difference segment and debuffs are hidden, and the backdrop style is cleared. The monster description's icon goes into `family_icon` (`Family_Icon`, File) | Our monster model was rendered in the portrait, with Background Half | fixed |
| The health bar is fraction × 200 px wide and 12 px high, shown only while the fraction is above 0. The name row is 200 × 22 | 180 px wide | fixed |
| Weakness: when the description's weakness is not NORMAL, `label_weakness` shows the item bundle's name for it, styled `Hud/Status/Mini/Weakness Label` with Color set to the type. The attack icon is `ui/icon/stats/attack_<damage>.png` | Neither was shown | fixed (the description's weakness, damage and icon are now read in `data.ts`) |
| The panel fades out (`Remove/Fade Out`) when the target is lost | It vanished at once | fixed (0.3 s fade) |
| The target is the knight sprite's current target (`PO()`) | The last monster struck, for 6 s | flagged (the client's targeting is not reproduced) |
| The panel also describes hovered townsfolk, shops and items (`as.i(description)`) | No hover descriptions | flagged |

## Minimap (`client/hud/Minimap`, `dungeon/client/F`, `W`, `C`; `map/client/a`, `AbstractMapComponent`; Tudey's map renderer)

| What the client does | What we did | Status |
|---|---|---|
| The map is a texture with one texel per cell. Tiles give each cell its collision flags under the map mask (wall, edge, player, player barrier). Placeables and areas with such flags mark the cells their shape covers (more than four of the nine thirds of a cell), and floor-tile placeables mark floor. Markers add nothing | Walkable cells were filled with a pale colour as the knight walked | fixed (`src/game/levelmap.ts`, built in `src/scene.ts`) |
| Floor is flooded from the default-entrance placeables and the party's spawn point through cells with no flags (four sides). Reached floor is dark blue (0.082, 0.2, 0.29), other floor grey-blue (0.29, 0.44, 0.47), blocked cells light blue (0.42, 0.69, 0.73), and uncovered cells clear. Walls and edges are one or two cells deep, so the level reads as a light outline | A filled blob | fixed |
| Exploration: Clockworks levels (`MapType.DISCOVER`) show a disc around each two-unit square the knight has visited, solid to 20 cells and fading out at 32. Terminals, towns and other places show the same disc around every reached cell | Cells within 9 units of the knight were revealed | fixed (the spawn seed is the knight's first position) |
| The minimap uses the overlay's map renderer, drawn at 3 px per unit in the 160 px square at the map layer's upper-right corner, multiplied by `ui/hud_v2/images/minimap/mask.png`. It sits after the faceplate and under the hash marks and gloss | Drawn in the map background spacer with an elliptical clip | fixed |
| Markers, in order: the knight as `ui/minimap/player_local.png` (colour print 264 in towns; the knight's personal colour in dungeons), half transparent and turned to its heading; then `MinimapIcon` entities; then monsters (dungeon only) | A yellow arrow drawn last | fixed |
| Monsters use `ui/minimap/monster.png` at full size and are hidden beyond the 69 px edge | Red dots | fixed |
| Entity icons are drawn at 0.75 size. Beyond 69 px they are pinned to the edge, shrinking to 0.25 over 690 px, and hidden further out. They are not rotated | They were drawn at full size and clipped | fixed |
| Edge markers are rotated toward their direction only for other players (an occupant's arrow, `ui/minimap/arrow*.png`, guild members and friends) | No other players | n/a (single player) |
| The floor label is the dungeon bundle's `m.depth` ("DEPTH 3"), or `???` on shadow and core floors | "Depth 3" | fixed (`m.depth`) |
| `spacer_zoom` (the magnifier) shows only where the scene controller allows zoom (`dA.Ja()`: towns, guild halls, arenas); the dungeon minimap has none. The zoom button toggles the camera zoom (`TOGGLE_ZOOM`, `=`) and shows it selected while zoomed | Always drawn, inactive | fixed |
| `spacer_map` always shows. The map button toggles the `map_overlay` preference (`TOGGLE_MAP`, the B key) and shows it selected while the overlay is on | Opened the Gate Map | fixed (kept in local storage; our B key is the backpack, so only the button toggles it) |
| `button_lockhud` is disabled (the dungeon enables it for party HUD lock); the ping label shows the connection icon; the instance-select button is for town instances | Drawn | fixed (lock disabled) / n/a |
| When the camera's target is off radar (`Dungeoneer.OFF_RADAR`, actor flag 512) the dungeon minimap shows random static and no monsters, and the overlay hides | Not done | flagged (no off-radar state) |

## Corner menus, activities, objectives (`client/hud/M`, `L`, `P`, `y`, `a`, `E`)

| What the client does | What we did | Status |
|---|---|---|
| Panels slide when folded or unfolded over 0.2 s (CubicOutOvershoot opening, CubicIn closing). Both corner menus fold together, and the state is saved (`menu_panels_out`) | Fold is instant, and the menus fold separately when the window is narrow | flagged |
| A folded panel's handle shows `ui/icon/notice.png` when there is news, with tooltips `m.activities_tip` and `m.objectives_tip` | None | flagged |
| Menu hotkeys come from the bound commands, truncated to 3 characters. `button_menu` has none | Fixed letters | flagged (main.ts handles a few keys directly) |
| Objectives hang 166 px down the right edge, and the activities panel 6 px below them | Placed under the minimap's height + 8 | fixed |
| Objectives: one "- text" label per server objective. The panel unfolds when new objectives arrive and is hidden when there are none | Our own objective lines | flagged (our text; there are no server objectives) |
| Activity labels: `b.to_town` ("Go to Haven"), `b.to_readyroom`, `b.to_guildhall`, `b.furni`, `m.missions_item`, `m.supply_depot` | Our own English | fixed (bundle text; in town, "The Arcade" is our own) |
| Furnishings show only in a guild hall's design mode. Ready Room is hidden inside the Ready Room. The dividers show only when their groups have buttons | Always shown | flagged |
| Notification buttons (trade, party invite, party found) slide in with a bounce | Hidden | n/a |

## Revive (`dungeon/client/ai`, `B`, `I`)

| What the client does | What we did | Status |
|---|---|---|
| `interface_revive_margin.dat` is added to the HUD at the bottom centre, with no dimming. The leave-party panel joins the party list on the left, 150 px down | A centred window over a red tint | fixed |
| The spark buttons stay disabled for 1.2 s after the panel appears | Usable at once | fixed |
| The use and buy panels are switched by spark count; the cost is in energy; a dismiss timer shows | Crowns instead of energy | n/a (no energy) |
| The text is the bundle's `m.revive_desc`, which mentions the Energy Blast | Our own description | flagged (we have no energy blast) |

## Elevator and end of floor (`dungeon/client/EndOfLevelWindow`, `R`, `O`, `as`)

| What the client does | What we did | Status |
|---|---|---|
| The next-level window counts down from 10 (`m.countdown`, "in 10 seconds...") and then advances on its own | No countdown; the label held our loot tally | fixed (the tally moved to the window's spare line) |
| `labelQuit` is `m.leaveparty_return` with the town's name | Our own sentence | fixed |
| After a choice: `Clicked-Advance` plus `HideQuit-Solo`, or `Clicked-Quit`; then the stripe's `FadeOut` | It closes at once | flagged |
| The heat report: `title_heat.dat` and `heat_list.dat` slide in from the right. The floor's heat is counted over 3 s (`sound/feedback/heat_score.ogg`) and shared between the heatable items, then the loot cards and the bonus wheel follow. `fanfare_elevator_1.ogg` plays when the floor asks for it | No report | flagged (the largest remaining gap) |
| The arrival title (`title_nextfloor[-ubs/-wht].dat`) shows Gate Name, Zone Name and Depth Counter | Has its own screen | flagged (not compared in detail) |

## Help notices (`client/ar`, `dungeon/client/h`)

| What the client does | What we did | Status |
|---|---|---|
| A 600 px `Default/TooltipWindow` label at the top centre, 120 px down, shows the knight's action hint (helptips). In dungeons it shows `m.elevator` while waiting on an elevator, and `m.can_resurrect` or `m.dead` for parties | Our notices use the alert frame near the top | flagged |

## Other HUD classes

| Class | What it does | Status |
|---|---|---|
| `client/hud/t` (item acquire) | Each item gained flies a 3D icon (`ui/scripted/dynamic/item_acquire.dat`, with Icon, Colorizations and ItemCount). Pocket items go beside their quickbar slot; other items go 125 px in from the top-right corner. The icons are queued 300 ms apart and removed after 2 s | flagged (we show a floating text label instead) |
| `client/hud/n` (`interface_toosmall.dat`) | Warns when the window is under 1024 × 600, for 20 s | flagged |
| `client/hud/r` (`ui/energy/interface_collapse.dat`) | Energy widget | n/a |
| `dungeon/client/an` (clock timer) | `interface_clocktimer.dat` as mm:ss. The colour is `default`, then `warning`, then `suddendeath` under the thresholds, with a blip under 4 s | n/a (party timers and PvP) |
| `dungeon/client/Z`, `I`, `am` (party list, split invites, go-ahead) | Party UI | n/a |
| `client/hud/z`, `A`, `client/bU`, `dungeon/client/V`, `N` (map overlay) | A full-screen window under the HUD, shown by the `map_overlay` preference: the level map at 4.5 px per unit and half opacity, centred on the camera target, with the knight and the entity icons at full size and no monsters | fixed (drawn first by `GameHud.draw`) |
