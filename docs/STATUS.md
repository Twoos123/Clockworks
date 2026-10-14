# Status

Last updated 2026-10-13. Measured against a Steam install updated 2026-10-07.

## Where the game is

A single-player loop runs in the browser, built from the install's own data:

1. **Haven.** The town loads from the scenes cache. Shopkeepers stand in the bazaar and sell
   gear for crowns.
2. **Arsenal.** The game's own arsenal and equipment windows (`ui/arsenal`, `ui/status`):
   owned gear by category with icons, stars and heat levels, the game's item tooltips, sockets
   for helmet, armour, shield, two trinkets, three weapons and the vitapod, the knight
   preview, and the personal colour. B opens the backpack (`ui/inventory`): pocket items and
   materials.
3. **Runs.** Enter the Clockworks from town. Each cached combat level is followed by a
   newly generated floor of its theme, one depth per floor. The Core's elevator returns to
   Haven; "go deeper" past the end keeps generating floors.
4. **The real gates** (`src/game/gatemap.ts`, `server/gates.ts`, docs/research/gatemap.md).
   The Arcade's gates are the game's own, from the community Gate Map
   (gatemap.knightlauncher.com), fetched by the local server and cached in
   `%LOCALAPPDATA%\clyde-web\gates` (never in the repository): today's four, and any older
   gate since 2019. Each depth has its real level options and each stratum its real theme.
   The options rotate in real time as the client's `GateSummary` turns them (velocity, wedge
   lengths, start); the next depth's level is locked in when the knight steps on the elevator
   and shown on the elevator screen. Without the site or the cache, the gates are generated as
   before. The Gate Map window (Arcade control panels, the minimap's map button) is the
   client's map: turning rows of coloured level icons, rotation spacers, the path and the next
   level in the client's line colours, emblems in the gate's colours, a stratum totem and a
   rotation timer.
5. **Gate floors on the game's own levels** (`src/game/archive.ts`). Each floor of a gate is
   an archived level of its stratum's style and theme when the player's archive has one (the
   Clockwork Tunnels by family and status area, Wolver Dens, Candlestick Keeps, Graveyards,
   Devilish Drudgery, Lichenous Lairs, Compounds, Battle Arenas, and the fixed sets: Jigsaw
   Valley, Aurora Isles, Starlight Cradle, Concrete Jungle, Dark City, Scarlet Fortress); a
   boss stratum's floors are its stages (Terrilous Trail, Roarsterous Ruins, the Snarbolax's
   lair...); terminals, Moorcroft Manor, Emberlight and the Core are their archived scenes.
6. **Floors from the game's prefab rooms** (`src/gen/prefabs.ts`, `src/gen/assemble.ts`,
   docs/research/prefab-generator.md). The floors the servers generated and the client cached
   name each prefab they were built from; the rooms are cut out of them at their corridors and
   joined anew at matching openings (start, rooms, airlock, rooms, exit, dead ends on every
   other opening), with their own wiring, spawners, treasure and lighting.
7. **Generated floors** (`src/gen`), for styles with no captured prefab floors and special floors.
   - The level editor's brush libraries ship empty, so the auto-tiling is learned from the
     theme's cached levels: which tile, rotation and elevation sits in which neighbourhood.
   - Layouts are rooms joined by corridors three cells wide.
   - Each room gets the game's own wiring, copied and retagged: a "Player Enter/Spawn
     Activate" area, "Single Spawn" markers with spawn tables from the sources, and treasure
     boxes.
   - The start platform, exit elevator and lighting globals come from the source levels.
8. **Levels play by their own wiring.**
   - Spawners and trigger areas wake waves.
   - Clearing a wave opens or closes gates.
   - Buttons and platforms send signals.
   - Gold keys unlock gold gates.
   - Monsters drop crowns, heat and items.
   - The exit elevator ends the floor.
9. **Knockouts.** A knocked-out knight can revive for crowns (25 per depth) or give up and
   ride back to Haven with nothing from the floor.
10. **Arena.** Waves from the game's single-family spawn tables on a cached level, getting
   deeper as they go, with a checkpoint every fifth wave to bank loot. Every tenth wave is a
   boss or mini-boss (Royal Jelly with its phases, Alpha Wolver, Mega Knight, Scorcher).
11. **Crafting.** The game's forge (`ui/forge`, K): recipes from `config/recipe.dat` turn
   materials, crowns and a levelled base item into the next item, with the forging animation
   played by the interface's own scripts. Shops use the game's vendor and cart windows
   (`ui/shop`).
12. **Saving.** The browser keeps:
   - loadout, owned items and colour;
   - banked crowns, heat and materials;
   - weapon heat and the pocket;
   - the deepest floor and the number of runs.

## What works

| Area | What is in |
|---|---|
| Rendering | Every model and cached scene; library materials (two texture units), colours, lights (scene directional plus point, spot and directional influences, nearest eight per object), fog, particles, animation, scripted models, actor shadows, projected decals (shade under roofs and trees) |
| Knight | Gear from the arsenal, personal colour, idle, walk and run sets, hurt, death, dash; keyboard and mouse (WASD or the mouse-move scheme) or gamepad; controls and timing from the client's own prediction (src/game/knight.ts: combos, charging, reloads, shield, bash, dodge, flinches, facing, auto-target) |
| Weapons | Swords (combos with lunges, charge), guns (clips, reload, charge shots, auto-aim), bombs (charge, fuse, blast), from item and attack data |
| Shield | Health, regeneration, breaking, shield bash from the shield's own attack |
| Damage | Depth-scaled damage, health and defence from `config/depth_scale.dat`; four damage types; status conditions |
| Status conditions | Fire, freeze, shock, poison, curse, sleep and stun, with the game's effects and HUD icons |
| Heat and levels | Equipped weapons, shields, armour and helmets absorb a floor's heat and level 1 to 10 (`item_property.dat` heat by star); level bonuses from `level_table.dat`: damage and charge time on weapons, defence and heart pips on gear |
| Economy (`src/game/economy.ts`) | Prices and sell prices from `item_property.dat`; Haven keepers, Basil (recipes, per visit) and the Supply Depot (capsules and vials the treasure tables give); selling back; recipes are bought before crafting; crafting costs `recipe_property.dat` crowns, the recipe's materials and the base item at its level; unique variants rolled from `variant_table.dat` on crafted and found gear, stored per item, shown in names and applied |
| Drops | Materials by depth weight (`item_depth_weight.dat`) and the monster's family tags; rare gear drops; mineral deposits (1, 2, 4 or 6 minerals); crowns and heat by depth on the tables' per-tier curves, coins and embers worth their denominations |
| Monsters | Data-driven spawns, tiers by depth, loot, a clean-room AI (turrets, ranged spacing, melee), A* pathing around walls |
| Treasure and blocks | Breakable blocks break after a few hits; treasure boxes spill crowns and items from their damage action |
| Pocket items | Capsules (health, remedy, buffs, barriers) and vials (thrown, splash damage and status), four slots on keys 4 to 7 |
| Buffs | Attack, defence and speed buffs from `Buff` status conditions, with their HUD icons |
| Gear bonuses | Two trinket slots and a vitapod slot. Armour, helmets, shields and trinkets add health, damage per weapon class, family damage, charge time, attack and move speed, and status resists |
| UI sounds | The game's style feedback sounds on the arsenal, shops, crafting and run menus |
| Level logic | Tudey handlers, actions, targets, conditions and expressions (`src/game/logic.ts`) |
| Props | Doors, switches, blocks, carried keys, pickups, elevators, townsfolk |
| Dungeon objects (`src/game/objects.ts`) | Crystal and ghost block chains, timed explosives, prism puzzles, gun, rocket and fire blocks, status floor traps, healing totems, heal pads, mortar shells, barricades, prisoner cages with freed companion knights, energy gates and crates (paid in crowns) |
| Missions | 238 of the game's missions from `config/mission.dat`: a board from the HUD's Missions activity with card images, rewards (their spawn tables) and prestige; dungeon missions (themed floors at their rank's depth, ending in their boss), briefings, exchanges, prestige gate missions on their scheduled days; rank 1-1 to 10-2 in the save, shown on the HUD; tier 2 needs rank 4, tier 3 rank 6 |
| HUD | The game's own `hud_v2` interfaces: status panel with 3D portrait, health and shield, debuffs, quickbar, minimap, hit flash, low-health frame |
| Audio | Sounder configs through Web Audio, scene music and ambience, animation sounds |
| Guild | Your own hall (the cached hall without its owners' furniture); furniture mode places, moves, rotates (45 degree steps) and stores any of the 250 furniture items from `config/item.dat`, bought with crowns by rarity; guild vault for materials and crowns; guild name and emblem (gate heraldry) |
| Ready Room | `rsrc/world/readyroom/scene.dat` with the arsenal open; the knight changes into a new loadout when it closes |
| Level checklist | `src/game/levels.ts`: 366 server-side levels (Clockworks sets, bosses, Shadow Lairs, danger, rank, expansion and event missions, towns, PvP) with where to get each and a scene-name pattern; `npm run levels` prints collected/missing from the archive and cache; the options window's Levels tab shows the counts (docs/research/levels.md) |
| Knight creation | On a fresh save: `rsrc/world/createknight/scene.dat`, a name (shown on the HUD name plate), personal colour, and the zero-star Spiral helmets and armours in their seven trims |

## What is still missing

**Content**

1. **Level variety.** Generated floors come in the themes the cache has (Jigsaw Valley and
   the Clockwork tunnels). More cached levels would add themes and improve the learned
   tiling. Generated floors have the cached levels' puzzles (gold keys, switch gates,
   block walls, spike runs, secret treasure rooms) and special floors (treasure vaults,
   danger rooms, arenas) and dungeon objects (crystal gates, explosives, prism gates, trap runs,
   rescue cages, healing totems, gun blocks): see docs/research/generated-features.md. Rescue
   camps themselves (their townsfolk and missions) are missing.
2. **Text.** The game's message bundles are read from the install's projectx-config.jar
   (src/i18n.ts). Text the game makes on its servers, and things this port invents (some
   generated level styles, run summaries, notices, our settings rows), are still our English.
3. **Shop catalogues** are server-side (`config/catalog.dat` ships empty). Prices are the
   game's own (`item_property.dat`); each keeper sells every item of its kind in the star
   range its place allows, and Basil picks twelve recipes per visit.

**Systems**

4. **Energy.** Revives cost crowns rather than energy. The heat amplifier (an Energy item)
   is modelled (`save.heatAmplifier`, double heat) but cannot be bought. Minerals carry no
   energy in the data; they bank as materials and sell for nothing (their uses, sprite food
   and gate themes, are not modelled).
5. **Boss levels.** The four Clockworks bosses fight on their own archived levels: the level's
   platforms, triggers and doors bring the boss on and open the way out, and a director
   (`src/game/bosses.ts`) takes up the boss the level spawned. Without the level, a generated arena:
   the Royal Jelly's stage chain with polyps, minis it absorbs and its rage; the Snarbolax,
   hurt only while a Beast Bell's ring has it stunned; the Roarmulus Twins, exposed only by
   each other's rockets (pressure plates raise a blast wall); Lord Vanaduke's three body
   stages and two burning masks, put out with water pots. The fights' server logic is not in
   the client data (conditions, timers and signal names are stripped), so a director per boss
   runs it, written from the configs and the wiki's fight descriptions. On the real levels it
   uses their markers (the Jelly's mini spawn points, the Snarbolax's warps, the Twins' lanes
   and toggle walls, Vanaduke's seat and sprite wells).
6. **Guilds and PvP.** Missions are in (below), but their own levels and dialogue are
   server data: dungeon missions play as themed generated floors, briefings show our summary.
7. **Health and treasure numbers.** Block health is not in the data (counted in hits here).

**Fidelity**

8. **Taken from the client** (docs/research/client-fidelity.md, client-map.md): the damage
   and defence formula, bonus steps and caps, knight health (200), the heat series and its
   split between items, status chance and power levels and each condition's defaults,
   knockback impulses, attack timing, the dash, shield regeneration, config class defaults,
   monster and boss health, trap cycles; the knight's controls and their timing, the camera,
   and hit feedback (flash, shake, damage numbers, hit particles, charge effects).
9. **Still ours.** The client runs no game logic (it is server code): monster AI, the boss
   directors' sequencing (bell range, Vanaduke's wet time), how power and resistance turn into
   a status's duration and chance, freeze breaking, invulnerability windows, forging levels.
10. **Unread defaults.** The export drops default-valued fields, and some game defaults
    differ from upstream Clyde. The logic infers implicit objects and treats unnamed signal
    handlers as hearing "activate". A few ExpressionSwitch case values are matched by
    position.

## Measured results

| Check | Result |
|---|---|
| `.dat` files parsed byte-exact | 7,459 of 7,459 |
| Model files loaded in the browser | 5,816 of 5,816, no failures |
| Cached scenes loaded | 12 of 12, zero unresolved references |
| A full run, Haven to Terminal Core and back | passes (automated) |
| Unit tests | 150 of 150 |

## Decisions for you

1. **Sending the outreach email.** Draft in `docs/outreach/grey-havens-email.md`; you said
   not yet.
2. **Hosting.** The plan recommends a name and domain free of the game's trademarks and a
   self-hosted git mirror before publishing.
3. **Level source.** More cached levels (from playing the real game), procedural layouts,
   or hand-built ones.

## Side findings

- The live client ships LWJGL 3 with GLFW, lwjgl3-awt and macOS arm64 natives.
- Tudey's open-source logic compiles to the browser with TeaVM (`docs/research/engine-spike.md`);
  the TypeScript engine was written instead, following `docs/research/tudey-logic.md`.
