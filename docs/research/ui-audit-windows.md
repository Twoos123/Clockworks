# Window audit: what the client's controllers do that the interface configs do not say

The windows were first built from the install's interface configs alone. Behaviour that the
client adds in code (components shown or hidden, styles switched with arguments, sorting,
tooltip contents, enabled states, text keys) was guessed. This audit reads each window's
controller in the decompiled client (`.decompiled/projectx-full.zip`, studied under Grey
Havens' permission, docs/permissions/grey-havens.md) and compares it with `src/ui/*.ts`.
Descriptions are ours; no client code is reproduced. Class paths are relative to
`com/threerings/projectx/`.

Status: **fixed** (the port now does what the client does), **flagged** (a known difference
left for later), **n/a** (needs other players or the game's servers, or is deliberately
different in single player).

The HUD (`src/ui/hud.ts`) is audited separately. The gate board and the elevator choice
screen are being rebuilt from the real gate data elsewhere and are not covered here.

## 1. Arsenal, status window and item tooltips

| Client class | What the client does | What we did | Status |
|---|---|---|---|
| `item/client/j` (item list) | Item pills are `ui/hud_v2/parts/interface_itempill.dat`: backing coloured by the item's first two non-normal damage types (`Damage`, `Damage (Secondary)`; Red and Green replace them for "cannot" and "ready"), a star with the star rating as a number, variant pips (`Variants`, -1 hides them on items that cannot hold variants), the lock state on levelled items, `Equipped`, the stack count only above one | `ui/recipes/parts/pill_recipe/interface.dat` with five stars, the item level drawn over the icon | fixed (`src/ui/itemlist.ts`, `src/game/itemstats.ts` `pillDamage`) |
| `client/d.c` (group header) | `Name` = item bundle `m.group_count` ("Sword (3)") with the singular group name; `Selected` = folded and not empty; `Enabled` = not empty | "Swords (3)", Selected while open, always enabled | fixed |
| `client/d.c.BZ`, `ItemCodes.Group` | Groups in enum order (Sword, Handgun, Bomb, Helmet, Armor, Shield, Trinket, Mineral, Material, Recipe...); groups marked show-when-empty stay, disabled, with nothing in them | only groups with items, our order (shields before armour) | fixed (vitapods stay a group of this port's own) |
| `client/d.d` | A blank row (`pill_recipe/interface_blank.dat`) closes each open group | none | fixed |
| `client/d.g`, `client/d.e`, `client/ui/K` | A sort header (`ui/social/parts/interface_header.dat`, "Sort (Natural)") opening a menu of sorts (`m.sort`, the list bundle's `m.<sort>`, `ui/combobox/arrow_up/down/empty.png` on the current one); choosing the current sort reverses it; arsenal: natural, name, stars, level; recipes: natural, name, stars; vendor: price, name | none, fixed order | fixed (`ItemList.sortMenu`, a popup menu built as `client/ui/E` builds them: `gui.ts buildMenu`, `GuiScreen.popupMenu`; the shop's arsenal sorts too) |
| `item/client/l` | Natural order: stars high first, level high first, name, more variants first | catalogue order | fixed |
| `client/d.b` | An empty list says the list bundle's `m.empty` | nothing | fixed |
| `client/d` | The collapse-all toggle's tooltip says Expand All / Collapse All (the list bundle's `m.expand_all`, `m.collapse_all`); it is pressed while no group with entries is open | no tooltip | fixed (a text tooltip in `Default/TooltipWindow`, `screen.ts textTip`) |
| `item/client/j.a(aw)` | Arsenal pills never look pressed (selected states reuse the unselected styles); recipe pills keep their selection | selection shown in every list | fixed (`ItemList.showSelection`) |
| `ArsenalPanel` | Lists minerals and materials too; drops capsules, vials and equippables | gear only | fixed |
| `ArsenalPanel.a`, `item/client/F`, `ItemConfig.Level.a(ctx, item, F)` | A click opens the item's context menu, titled with its name: `m.equip_N` / `m.unequip_N` per slot it fits (costume slots too) with the slot's item icon or its own icon, worn helmet and armour not removable, `m.rank_limit` disabled below the star rating's rank (`ItemCodes.bwB`), Compare / Don't Compare (`M.buL`), Preview, Forge... | a click equips or removes | fixed (`src/ui/itemmenu.ts`, in the arsenal, the inventory window and the crafting window's inventory; Preview and Forge... are not offered: no dressing-room preview or crystal forge here) |
| `ItemConfig.Level` tooltip | `tooltip_level.dat`: Level `%02d`; Heat bar 16 + 104 x progress pixels; Type "Equipped Sword" (`m.equipped`) when worn; Equipped True / False / Unequippable with the rank limit text | Heat 120 x progress; plain type | fixed |
| `ItemConfig.Weapon`, `Gear`, `Shield` tooltip | An "Attack Power" or "Defense Power" box (`tooltip_parts/container_stats.dat`) with a bar per damage type (`stat_bar.dat`: value at depth 30 x 5/12 for attacks, x 0.75 for armour, x 0.375 for shields, + 14, capped at 164; the potential bar at the top level), weapon speed (displaySpeed x 15 + 14), shield health (health / 40 x 6 + 14) | text lines only | fixed (`itemStats`) |
| `ItemConfig.Level` tooltip | Variant lines in the Variant colour, then level bonuses as graded words (`m.damage_bonus` "Damage Bonus: Medium", `m.charge_reduction`, `m.health_bonus`), green for bonuses, red for penalties, with the weapon class icon on class-specific ones | "Damage +16%" in our words | fixed (class-specific lines n/a: this port's level tables carry no weapon-class bonuses) |
| `ItemConfig.Gear` tooltip, `client/l.a` | A "STATUS RESIST" box (`t.status_resist`) after the defence bars on armour, helmets, shields and trinkets: a centred bar per enabled condition (`ui/icon/debuff/<status>.png`, the item bundle's `m.<status>`), value + 8 up to 82, resistance as bonus and weakness as penalty widths; weapons have none | none | fixed (`itemstats.ts itemResist`, `resistBars`, the defence's StatusResist and the unique variants') |
| `ItemConfig.Trinket` tooltip | `Equipped` gets " No Level"; the type is not upper-cased | as levelled items | fixed |
| `ItemConfig.Original` tooltip, `client/ui/Q` | The 3D item preview in `renderview`: the item's model in the knight's colour inside `item/preview/model_<kind>.dat`, the camera orbiting after 0.2 s at up to 3pi/8 a second; hidden for dungeon gear | hidden | fixed (`itemlist.ts previewModel`, drawn by the window's view hook; the bomb's `tooltipModelZ` camera lift is not applied) |
| `LoadoutPanel.d.zJ` | Equipment tab: a folding left column (`toggle_collapseleft`, `left_cont`, starts folded) "GEAR STATS" with the worn armour's defence bars (x 0.375) and each weapon's name, attack bars and bonuses | column hidden | fixed (with the worn gear's status resist bars) |
| `LoadoutPanel.j` | `label_playerrank` = mission bundle `m.rank_title_N` + "(R-S)"; `label_prestige` = prestige | "Deepest Depth N", "N runs" | fixed |
| `LoadoutPanel` | The Battle Sprite tab is removed while the knight has no sprite | always shown | fixed |
| `LoadoutPanel.EZ` | `label_currentloadout` = the matching saved loadout's name, else "<Current Equipment>"; Save Loadout enabled only while unsaved | the config's "<Current Equipment>" | fixed |
| `LoadoutPanel.d.Fa` | Notice "Equipment locked" outside towns, PvP gear notices, unused upgrades | hidden | n/a |
| `LoadoutPanel.n` | Sprite feeding: `m.feed_sprite` / `m.level_up` on the feed button, `m.required_description` / `m.petfood_description` status | our English | fixed (`m.feed_sprite` and `m.petfood_description`; this port's sprites need no level-up item, so `m.level_up` and `m.required_description` never apply) |

## 2. Crafting and the heat forge

| Client class | What the client does | What we did | Status |
|---|---|---|---|
| `craft/a/o` | Crafting is `ui/recipes/interface.dat`: the recipe list (`craft/a/x`, the arsenal interface in Window mode, "RECIPES") beside the ingredients (`craft/a/s`, `interface_ingredients.dat`) | `ui/forge/interface_forge.dat` (the crystal forge) with our panel texts | fixed (`src/ui/forge.ts`) |
| `craft/a/x` | Lists the recipes the knight has learned, grouped by what they make (craft bundle names), sorts natural / name / stars, the pick stays pressed; "You have new Recipes" notice for unlearned recipe items | every recipe within reach, red/green by readiness | fixed (the notice never applies: recipes are learned when bought) |
| `craft/a/s` | Hidden until a recipe is picked; `titlebar_itemname`; `cost_crowns` disabled when short; materials as `parts/material` rows; the base item as `parts/special` (Ready when held, not worn); `unequip_label` when the base item is worn (then not ready); `keep_variants` and `result_bound` hidden; `confirm` (Transmute) enabled when everything is at hand | forge panel with chance of success and our bonus lines | fixed (worn base items must now be taken off first, as in the client) |
| `craft/a/g` | `find_materials` replaced by a blank of its size unless the material has gate themes | hidden | fixed (always the blank: no gate finder) |
| `craft/a/G` | `interface_success.dat`: "TRANSMUTING", `m.summary` or `m.summary_upgrade`, then after 3000 ms "SUCCESS!", the `Transmute Success` script, item name and icon, `m.unique` when variants rolled, `m.moved_arsenal`, Equip (disabled when already worn), View Item, OK | the crystal forge's `interface_forging.dat` animation | fixed (View Item hidden) |
| `craft/a/s.LO` | Confirmation when accessories would be lost | none | n/a (no accessories on crafted gear) |
| `item/client/n` | `ui/forge` is the crystal forge: levelled gear takes crystals for bonus levels with a success chance | was used for crafting | n/a (crystals and energy are not in this port) |
| `craft/a/o.LW` | Opens the inventory window beside the recipes | none | fixed (the inventory panel docked at the screen's right, `GuiScreen.side`; its own dismiss closes only it) |

## 3. Shops, vendors and the inventory

| Client class | What the client does | What we did | Status |
|---|---|---|---|
| `shop/client/m` | The shop is `ui/shop/interface.dat`: the shopping cart with the keeper's portrait (`shoppingcart_withportrait.dat`), a VENDOR list window (`shop/client/u`) and the knight's arsenal window to sell from | the older `vendor_withportrait.dat` with eight sockets a page and a Sell tab | fixed (`src/ui/shop.ts`) |
| `shop/client/u`, `f`, `g` | Goods as price-tagged sockets (`slot_tag`) by item group, empty groups hidden, sorts price and name | paged sockets, price/name buttons | fixed |
| `shop/client/GoodSlot` | Modes: Normal (`Socket/Socket`, money style), Buy (`Socket/Buy/Socket`, cost style), Sell; count shown above one; shift or control moves ten | Buy/Sell modes only in the cart | fixed |
| `shop/client/m.XL` | Total = sales minus purchases, signed ("+250", "-1,000"), `TotalLabel_money_neg` while negative | unsigned cost | fixed |
| `shop/client/a`, `m` | Empty Cart and Checkout enabled only with something in the cart; status lines from the shop bundle (`m.unsellable`, `m.cart_full`, `m.cart_recipe_learned`, `m.cart_recipe_adjusted`); 100 lines, 500 of one good | Checkout only; our messages | fixed |
| `shop/client/a.d` | A click on an arsenal item puts one in the cart to sell, the pill counting down what is left | a Sell tab of sockets | fixed |
| `shop/client/m.a(Dungeon)` | One best vitapod: one at a time, a better one replaces the cart's, one no better than the cart's or the worn one stays out (`m.cart_vitapod_adjusted`) | none | fixed (`shop.ts vitapodRule`) |
| `shop/client/a.XN` | Selling a costume asks first (`t.sell_costume`) | none | n/a (costumes are not sold here) |
| `item/client/f`, `i` | The HUD Arsenal button opens `ui/inventory/interface_combined.dat` with its arsenal panel and without the old bag (`inv_panel` removed), docked at the screen's right | the sixteen-socket bag `ui/inventory/interface.dat` with pocket items and materials | fixed (docked at the screen's right; gear opens its item menu) |

## 4. Mission board and briefings

| Client class | What the client does | What we did | Status |
|---|---|---|---|
| `mission/client/MissionPanel` cards | `card_label` "RANK" and "1-1"; prestige "TODAY", "TOMORROW" or "REPLAYABLE"; rank missions above the knight's rank are "???" on `cards/images/unknown.png` and disabled; known but not startable: Locked card with the lock icon; completed: the difficulty icon, no completed caption | rank or number, completed caption, no unknown cards | fixed |
| `MissionPanel.Wr`, `Ws` | Briefing: name (Header), briefing (Body), objective (Summary), `m.once_only` for once-only prestige missions, then "REWARDS" and the reward pills | rewards in the mission pane, our status lines | fixed |
| `MissionPanel.a(b)` | One START button (`m.start`) styled `Adventure Board/Start Button/Comlink/Start` (exchanges: `.../Exchange/Start`), enabled when the mission can start | per-kind yellow buttons under the briefing ("Turn In", "Read Briefing") | fixed |
| `MissionPanel.zJ` | Header `m.prestige_header`, `m.rank_header`; the rank bar's title is the rank title alone | "RECRUIT 1-1" | fixed |
| `MissionPanel` | Plays `sound/music/mission_ui.ogg` looping at half the music volume over the level's music while open, fading in and out over 2 s (not in two zones, the ready room's and knight creation's) | no music change | fixed (`AudioSystem.playStream`; the board is never opened in those zones here) |
| `MissionPanel.Wl`, `g`, `Wv`, intro | While `ConfirmPrompt.MISSION_INTRO` is on (default), the board opens on `top_intro` (`m.intro_type`, a column per category, the `intro_pref` check box) with no category picked and the bottom empty (`bottom_empty`); a picked category's cards show with none chosen and `bottom_intro` reads `m.intro_reward_<category>` with the check box under it, until a card is picked. Prestige, arcade and expansion open with `prestigious_opportunity`, `reporting_duty` and `pioneers` done: a closed one is disabled with `locked_*` shown and its intro text `m.intro_*_locked`; a closed tab asked for from code shows the mission that opens it | hidden; prestige locked below rank 3 | fixed (the preference is kept in local storage) |
| `MissionPanel.c`, `d` | An exchange's pane: `ui/mission/interface_exchange.dat` (stacks under `t.materials`, single items under `t.special`), a TOGGLE ARSENAL toggle (`b.toggle_arsenal`; the crafting tutorial `time_to_crafty`'s becomes `b.unequip_items` when the items are all owned but worn, else `b.get_recipes` when one has no recipe known or held, `b.learn_recipes` when a recipe item is held, `b.craft_items`; hidden when nothing is needed), the `m.verify_exchange` check box once the items are there, then START (`.../Exchange/Start`), enabled only by the check box | needs listed as material rows | fixed (the arsenal opens as its own window over the board, not the client's side panel; Craft Items opens the forge, where the client's servers craft them; Get Recipes shows `alchemy_beginners`) |

## 5. Guild console, vault, emblem and furniture

| Client class | What the client does | What we did | Status |
|---|---|---|---|
| `guild/client/a` | Console cards named from the guild bundle: Show Guild Treasury, Birdsong Emporium, Guild Record, Design Mode, Member / Veteran / Officer Storage, Help | our names | fixed for the cards this port has (treasury, design mode) |
| `guild/client/a.b` | The row under the title is the message of the day (`motd`, 255 characters), editable by officers; `open` toggles the hall open to all | the row renames the guild; `open` hidden | n/a (single player has no other members) |
| `GuildBagWindow`, `G`, `GuildBagType`, `trade/a/s` | The treasury and the member, veteran and officer storages open in trade mode: the bag as an arsenal list titled `t.treasury` / `t.*_storage`, its pills backed green (treasury) or red; the trade cart (`ui/trade/interface_tradecart.dat`, Direction Give for the treasury, Both else; five lines, `e.cart_full`; the bag's warning `m.treasury_warning` / `m.storage_warning`; the crowns slot for the treasury only; Empty, Confirm) and the knight's arsenal. A pill pressed goes into the cart (Shift: 10), a cart line pressed comes out; counts in the lists drop by what the cart holds. The treasury takes materials, crowns (and holds furniture and guild upgrades) and never gives back, and confirms first (`m.confirm_deposit_treasury`); storages take gear and materials both ways; worn gear is `e.untradeable` | the trade window (`ui/trade/tradewindow.dat`) with crowns | fixed (the three windows sit side by side in the middle; the client puts the bag at the left edge, the cart centred and the arsenal at the right; the storage cards are on the console) |
| `guild/client/u`, `r`, `ad` | Expansions, energy well, guild log | none | n/a |

## 6. Uplink and options

| Client class | What the client does | What we did | Status |
|---|---|---|---|
| `uplink/client/MailPanel` | Mail headers: `Seal Icon` on official mail, `Icon` letter / announcement / attachment, `Icon Color` Unread or Read; dates "dd MMM yyyy" | a bullet before unread subjects, MM/DD/YY | fixed |
| `client/eu` | The Mail tab shows `ui/icon/notice.png` while something is unread | none | fixed (`restyle` now refreshes a button's icon from its style) |
| `client/eu`, bundle | Title `m.title` "SPIRAL UPLINK", button `m.markall` "Mark All" | "News and Mail", "Mark all read" | fixed |
| `client/bV` | News promotions streamed from the servers | our news entries | n/a |
| `client/OptionsDialog` | Graphics quality: three steps named `m.low`, `m.medium`, `m.high` | four English names | fixed (the slider stays continuous: flagged) |
| `client/OptionsDialog.a`, `f`, `cd` | UI scale: 100%, 150%, 200%, 250% (each shown when the screen's largest scale reaches it) and Max! (a toggle: the screen's largest scale, the others disabled); the scale in use marked with `ui/icon/check.png`; the slider runs from 70% to the largest scale (min(w/1280, h/1024), or the 1024 x 600 share), its label reads the dragged scale in `display_label_up` and the scale applies when the mouse is let go | our label only | fixed (the scale is the HUD's; the screen is the browser window) |
| `client/OptionsDialog` | `camera_shake` shows `!noShake` and stores the inverse preference (`noShake`, off by default); it stops camera shakes only | bound to screen flash | fixed (screen flash stays on `show_damage_effects`) |
| `client/OptionsDialog` | Confirm prompt check boxes (`confirm_prompts`, one per ConfirmPrompt), client version line | hidden | n/a |
