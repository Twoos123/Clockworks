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
| `client/d.g`, `client/d.e` | A sort header (`ui/social/parts/interface_header.dat`, "Sort (Natural)") opening a menu of sorts; arsenal: natural, name, stars, level; recipes: natural, name, stars; vendor: price, name | none, fixed order | fixed (a press steps to the next sort instead of a menu; flagged: no ascending/descending toggle) |
| `item/client/l` | Natural order: stars high first, level high first, name, more variants first | catalogue order | fixed |
| `client/d.b` | An empty list says the list bundle's `m.empty` | nothing | fixed |
| `client/d` | The collapse-all toggle's tooltip says Expand All / Collapse All | no tooltip | flagged |
| `item/client/j.a(aw)` | Arsenal pills never look pressed (selected states reuse the unselected styles); recipe pills keep their selection | selection shown in every list | fixed (`ItemList.showSelection`) |
| `ArsenalPanel` | Lists minerals and materials too; drops capsules, vials and equippables | gear only | fixed |
| `ArsenalPanel.a` | A click opens the item's context menu (equip to a slot, compare, preview, forge) | a click equips or removes | n/a (no context menus yet; flagged) |
| `ItemConfig.Level` tooltip | `tooltip_level.dat`: Level `%02d`; Heat bar 16 + 104 x progress pixels; Type "Equipped Sword" (`m.equipped`) when worn; Equipped True / False / Unequippable with the rank limit text | Heat 120 x progress; plain type | fixed |
| `ItemConfig.Weapon`, `Gear`, `Shield` tooltip | An "Attack Power" or "Defense Power" box (`tooltip_parts/container_stats.dat`) with a bar per damage type (`stat_bar.dat`: value at depth 30 x 5/12 for attacks, x 0.75 for armour, x 0.375 for shields, + 14, capped at 164; the potential bar at the top level), weapon speed (displaySpeed x 15 + 14), shield health (health / 40 x 6 + 14) | text lines only | fixed (`itemStats`) |
| `ItemConfig.Level` tooltip | Variant lines in the Variant colour, then level bonuses as graded words (`m.damage_bonus` "Damage Bonus: Medium", `m.charge_reduction`, `m.health_bonus`), green for bonuses, red for penalties, with the weapon class icon on class-specific ones | "Damage +16%" in our words | fixed (class-specific lines flagged: our levels carry no weapon-class bonuses) |
| `ItemConfig.Weapon` tooltip | Status resist bars (`l.a`) | none | flagged |
| `ItemConfig.Trinket` tooltip | `Equipped` gets " No Level"; the type is not upper-cased | as levelled items | fixed |
| `ItemConfig.Original` tooltip | The 3D item preview in `renderview` | hidden | flagged |
| `LoadoutPanel.d.zJ` | Equipment tab: a folding left column (`toggle_collapseleft`, `left_cont`, starts folded) "GEAR STATS" with the worn armour's defence bars (x 0.375) and each weapon's name, attack bars and bonuses | column hidden | fixed (resist bars flagged) |
| `LoadoutPanel.j` | `label_playerrank` = mission bundle `m.rank_title_N` + "(R-S)"; `label_prestige` = prestige | "Deepest Depth N", "N runs" | fixed |
| `LoadoutPanel` | The Battle Sprite tab is removed while the knight has no sprite | always shown | fixed |
| `LoadoutPanel.EZ` | `label_currentloadout` = the matching saved loadout's name | the config's "<Current Equipment>" | flagged |
| `LoadoutPanel.d.Fa` | Notice "Equipment locked" outside towns, PvP gear notices, unused upgrades | hidden | n/a |
| `LoadoutPanel.n` | Sprite feeding: `m.feed_sprite` / `m.level_up` on the feed button, `m.required_description` / `m.petfood_description` status | our English | flagged |

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
| `craft/a/o.LW` | Opens the inventory window beside the recipes | none | flagged |

## 3. Shops, vendors and the inventory

| Client class | What the client does | What we did | Status |
|---|---|---|---|
| `shop/client/m` | The shop is `ui/shop/interface.dat`: the shopping cart with the keeper's portrait (`shoppingcart_withportrait.dat`), a VENDOR list window (`shop/client/u`) and the knight's arsenal window to sell from | the older `vendor_withportrait.dat` with eight sockets a page and a Sell tab | fixed (`src/ui/shop.ts`) |
| `shop/client/u`, `f`, `g` | Goods as price-tagged sockets (`slot_tag`) by item group, empty groups hidden, sorts price and name | paged sockets, price/name buttons | fixed |
| `shop/client/GoodSlot` | Modes: Normal (`Socket/Socket`, money style), Buy (`Socket/Buy/Socket`, cost style), Sell; count shown above one; shift or control moves ten | Buy/Sell modes only in the cart | fixed |
| `shop/client/m.XL` | Total = sales minus purchases, signed ("+250", "-1,000"), `TotalLabel_money_neg` while negative | unsigned cost | fixed |
| `shop/client/a`, `m` | Empty Cart and Checkout enabled only with something in the cart; status lines from the shop bundle (`m.unsellable`, `m.cart_full`, `m.cart_recipe_learned`, `m.cart_recipe_adjusted`); 100 lines, 500 of one good | Checkout only; our messages | fixed |
| `shop/client/a.d` | A click on an arsenal item puts one in the cart to sell, the pill counting down what is left | a Sell tab of sockets | fixed |
| `shop/client/m.a(Dungeon)` | One best vitapod: cart adjusted (`m.cart_vitapod_adjusted`) | none | flagged |
| `shop/client/a.XN` | Selling a costume asks first (`t.sell_costume`) | none | n/a (costumes are not sold here) |
| `item/client/f`, `i` | The HUD Arsenal button opens `ui/inventory/interface_combined.dat` with its arsenal panel and without the old bag (`inv_panel` removed), docked at the screen's right | the sixteen-socket bag `ui/inventory/interface.dat` with pocket items and materials | fixed (centred, not docked: flagged) |

## 4. Mission board and briefings

| Client class | What the client does | What we did | Status |
|---|---|---|---|
| `mission/client/MissionPanel` cards | `card_label` "RANK" and "1-1"; prestige "TODAY", "TOMORROW" or "REPLAYABLE"; rank missions above the knight's rank are "???" on `cards/images/unknown.png` and disabled; known but not startable: Locked card with the lock icon; completed: the difficulty icon, no completed caption | rank or number, completed caption, no unknown cards | fixed |
| `MissionPanel.Wr`, `Ws` | Briefing: name (Header), briefing (Body), objective (Summary), `m.once_only` for once-only prestige missions, then "REWARDS" and the reward pills | rewards in the mission pane, our status lines | fixed |
| `MissionPanel.a(b)` | One START button (`m.start`) styled `Adventure Board/Start Button/Comlink/Start` (exchanges: `.../Exchange/Start`), enabled when the mission can start | per-kind yellow buttons under the briefing ("Turn In", "Read Briefing") | fixed |
| `MissionPanel.zJ` | Header `m.prestige_header`, `m.rank_header`; the rank bar's title is the rank title alone | "RECRUIT 1-1" | fixed |
| `MissionPanel` | Plays `sound/music/mission_ui.ogg` at half volume while open (outside some zones) | no music change | flagged |
| `MissionPanel.Wl`, intro | An intro page (`top_intro`, `bottom_intro`, `m.intro_*`) before a category is picked; locked categories by completed missions | hidden; prestige locked below rank 3 | flagged |
| `MissionPanel` exchanges | Toggle-arsenal button with `b.unequip_items`, `b.craft_items`, `b.learn_recipes`, `b.get_recipes`, and a verify check box | needs listed as material rows | flagged |

## 5. Guild console, vault, emblem and furniture

| Client class | What the client does | What we did | Status |
|---|---|---|---|
| `guild/client/a` | Console cards named from the guild bundle: Show Guild Treasury, Birdsong Emporium, Guild Record, Design Mode, Member / Veteran / Officer Storage, Help | our names | fixed for the cards this port has (treasury, design mode) |
| `guild/client/a.b` | The row under the title is the message of the day (`motd`, 255 characters), editable by officers; `open` toggles the hall open to all | the row renames the guild; `open` hidden | n/a (single player has no other members) |
| `GuildBagWindow` | Storage is an arsenal-style bag window per rank | the trade window (`ui/trade/tradewindow.dat`) with crowns | flagged |
| `guild/client/u`, `r`, `ad` | Expansions, energy well, guild log | none | n/a |

## 6. Uplink and options

| Client class | What the client does | What we did | Status |
|---|---|---|---|
| `uplink/client/MailPanel` | Mail headers: `Seal Icon` on official mail, `Icon` letter / announcement / attachment, `Icon Color` Unread or Read; dates "dd MMM yyyy" | a bullet before unread subjects, MM/DD/YY | fixed |
| `client/eu` | The Mail tab shows `ui/icon/notice.png` while something is unread | none | fixed (`restyle` now refreshes a button's icon from its style) |
| `client/eu`, bundle | Title `m.title` "SPIRAL UPLINK", button `m.markall` "Mark All" | "News and Mail", "Mark all read" | fixed |
| `client/bV` | News promotions streamed from the servers | our news entries | n/a |
| `client/OptionsDialog` | Graphics quality: three steps named `m.low`, `m.medium`, `m.high` | four English names | fixed (the slider stays continuous: flagged) |
| `client/OptionsDialog` | UI scale buttons (100% ... max) marked with an icon, the label styled `display_label_up` when raised | our label only | flagged |
| `client/OptionsDialog` | `camera_shake` stores the inverse preference | bound to screen flash | flagged |
| `client/OptionsDialog` | Confirm prompt check boxes (`confirm_prompts`, one per ConfirmPrompt), client version line | hidden | n/a |
