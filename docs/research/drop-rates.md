# Drop rates: what is real data, what the wiki gives, what is still a guess

Read October 2026. Code: `src/game/droprates.ts` (the wiki's data, every entry cited, guesses
marked `GUESS`), `src/game/spawntable.ts` (the client's loot tables), `src/game/economy.ts`
(material picks by depth weight), `src/game/prizewheel.ts`, `src/game/world.ts` (`awardItem`,
`sourceTags`, `spawnContext`, `prizeSource`). Tests: `tests/droprates.test.ts`.

## Order of trust

1. **The client's configs.** `config/spawn_table.dat` holds the real loot tables: every
   treasure box's weighted contents, monster loot by size, crown and heat value curves per
   tier, pickups, vitapods, rarities (orbs, fire crystals, sparks), mineral nodes and deposits.
   `config/item_depth_weight.dat` weights each star rating by depth; `config/item.dat` tags each
   material with the families and statuses that drop it. These are used as they are.
2. **The wiki**, for what the server decided and the client never saw.
3. **Our guesses**, only where neither says. Each is marked `GUESS` in `droprates.ts`.

The wiki gives almost no percentages. Its pages describe drops qualitatively; most numbers it
has are things the client data already holds (and agrees with).

## Pages read

| Page | What it gives | Used for |
| --- | --- | --- |
| [Materials](https://wiki.spiralknights.com/Materials) | Every general material's stars and family or status; star by depth (0/1 star from depth 1, 2 from 4, 3 from "8?", 4 from 13, 5 from 18); "a monster's drop table holds materials matching its family and status"; no rates | `MATERIALS`, `WIKI_STAR_START_DEPTH`; status materials now drop (below) |
| [Red Shard](https://wiki.spiralknights.com/Red_Shard), [Spark Plug](https://wiki.spiralknights.com/Spark_Plug) | Per-material "random drop from any defeated X in depth 1 and below"; no rates | Same as the Materials table |
| [Minerals](https://wiki.spiralknights.com/Minerals) | Pieces Small 1, Medium 2, Large 4, Shiny 6; three hits to break a spire; per gate theme, which two colours are "Uncommon" and which three "Frequented"; no odds | `MINERAL_PIECES`, `MINERAL_HITS`, `MINERALS_BY_THEME`, mineral node colour weights |
| [Crowns](https://wiki.spiralknights.com/Crowns) | Denominations 1, 5, 10, 25, 50; no amounts per monster or depth | `CROWN_VALUES` (matches the client's valued tables) |
| [Heat](https://wiki.spiralknights.com/Heat) | Embers in three sizes; no values or amounts | `EMBER_SIZES`; heat stays on the client's curves |
| [Treasure box](https://wiki.spiralknights.com/Treasure_box) | Green: heat, crowns, pickup, vitapod, sometimes material or token, rarely gear, occasional bonus rarity. Red: heat, crowns or token plus bonus rarity. Purple (vault): as red. Heart: hearts or vitapods. No odds | `BOX_CONTENTS`; the test checks the client tables hold exactly these |
| [Treasure Vault](https://wiki.spiralknights.com/Treasure_Vault), [Treasure Trove](https://wiki.spiralknights.com/Treasure_Trove) | Purple boxes may become Baby Mimics; troves are box-heavy with few crowns and little heat; no numbers | Notes only |
| [Danger Room](https://wiki.spiralknights.com/Danger_Room) | Reward area: 8 red and 4 green boxes, 4 heart boxes, scattered crowns and heat | `DANGER_ROOM_REWARD` (reference) |
| [Prize Wheel](https://wiki.spiralknights.com/Prize_Wheel) | Crowns always 5, 10, 25 or 50, more deeper; hearts heal the tier's pips; Full Health much rarer; pickups by belt rules; lockboxes and Kleptolisk; no odds | `WHEEL_CROWNS`, `wheelPickup` |
| [Golden Prize Wheel](https://wiki.spiralknights.com/Golden_Prize_Wheel) | Casino wheel, 200 crowns or a coin a spin; no odds | Not modelled |
| [Pickup](https://wiki.spiralknights.com/Pickup) | A belt slot stacks 3 of one item; capsules heal 3, 6, 12 bars; support pickups drop much less often; no rates | `BELT_STACK` (now enforced), `CAPSULE_BARS` |
| [Heart](https://wiki.spiralknights.com/Heart) | Small, medium, large hearts refill 1, 2, 3 bars; they vanish after 120 s; no rates | `HEART_PIPS`, `HEART_LIFETIME` (reference) |
| [Vitapod](https://wiki.spiralknights.com/Vitapod) | A better pod replaces the held one and adds empty pips, without healing, for the expedition; pods no better "don't drop"; capacity divides by the tier; no odds | `vitapodBetter`, `vitapodHealth`; vitapod drops reworked (below) |
| [Fire Crystal](https://wiki.spiralknights.com/Fire_Crystal), [Orb of Alchemy](https://wiki.spiralknights.com/Orb_of_Alchemy), [Spark of Life](https://wiki.spiralknights.com/Spark_of_Life) | Which strata's boxes give which crystal or orb; Radiant from depth 25; sparks "rare"; no odds | `ORB_STRATA`, `FIRE_CRYSTAL_STRATA` (reference; the client's rarity tables decide) |
| [Clockworks](https://wiki.spiralknights.com/Clockworks) | Tier 1 depths 0-7, tier 2 8-17, tier 3 18-28 | `TIER_DEPTHS`, `tierOf` (the prize wheel's tier) |
| [Slime](https://wiki.spiralknights.com/Slime) (family page) | No drop information | Nothing |

There is no "Drop table", "Loot" or "Ember" page.

## What changed in the game

- **Status materials drop.** Monsters' drops counted only family tags, so status materials
  (Blast Powder, Frost Gel, Volt Oil, Zee Core and the rest, tagged `sc_fire` and so on) never
  dropped from monsters, and status strata gave their treasure no theme. Now a monster counts
  its family and the status tags its actor carries (the wiki: family *and* status), Zee Core's
  bare `sleep` tag counts for sleep monsters, and treasure on a Fire, Freeze, Poison or Shock
  stratum drops that status's materials.
- **Mineral colours by stratum.** Mineral nodes picked evenly among the five colours; on a
  themed floor the wiki's "Frequented" colours now weigh more than its "Uncommon" ones.
- **Vitapods.** A dungeon pod healed 10 a pip on the spot. Now, as the wiki says, a better pod
  raises max health by 40 a pip (the item's Health argument: +12 is 480) with the new pips
  empty, lasts the expedition (carried floor to floor), and a pod no better is not kept. The
  client's `AlwaysBetterDungeonItem` tables are now evaluated as such: a pod no better than the
  held one gives the table's fallback (hearts or pickups). Depth lists honour their offset
  (the vitapod table's "Depth Offset").
- **The belt stacks three.** Picking up a fourth of a kind is refused.
- **Prize wheel pickups** follow the belt rules: random on an empty belt, a chance of topping
  up a part-filled stack, only a top-up when no slot is free, never a replacement.

## Where the wiki and the client disagree

The wiki's Materials page gives the first depth of each star as 1, 1, 4, 8?, 13, 18. The
client's `item_depth_weight.dat` "Materials" table starts the stars at depths 0, 0, 3, 9, 12,
19 (and ramps each to full weight by 5, 12, 14, 24). Read with the game's depth (1 is the first
floor below Haven), 2 star materials start a depth earlier than the wiki says, 3 and 5 star a
depth later; read as zero-based, 2 and 4 star agree and 3 and 5 star are two depths off. The
wiki's numbers are the strata's first depths, and it marks 3 star as unsure. The client table
is kept.

## Still guesses

| What | Our value | Why |
| --- | --- | --- |
| Prize wheel odds by kind | crowns 45%, material 30%, heart 12%, pickup 10%, Full Health 3% | The wiki gives none (only "much less common" for Full Health) |
| Prize wheel crowns by tier | tier 1: 5 or 10; tier 2: 10 or 25; tier 3: 25 or 50 | The wiki: "depends on depth", always 5, 10, 25 or 50 |
| Prize wheel top-up chance | 50% | The wiki: "has a chance" |
| Frequented vs uncommon minerals | 3 to 1 (27% and 9% each) | The wiki names the groups, not odds |
| Lockboxes, Kleptolisk, Golden Prize Wheel | not modelled | Events; no odds |
| Danger Room loot and depth | the floor's own tables | The wiki says loot there seems lower, unverified |

Everything else about drops (box weights, monster loot by size, crowns and heat by depth and
tier, material stars by depth, mineral deposit sizes by depth, rarities, pickups by tier) is
the client's own data.
