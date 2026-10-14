# Status

Last updated 2026-10-14. Measured against a Steam install updated 2026-10-07.

## Where the game is

A single-player loop runs in the browser, built from the install's own data:

1. **Haven.** The town loads from the scenes cache. Shopkeepers stand in the bazaar and sell
   gear for crowns.
2. **Arsenal.** The game's own arsenal and equipment windows (`ui/arsenal`, `ui/status`):
   owned gear and materials by item group as the client lists them (damage-coloured item
   pills, star ranks, sorting), the game's item tooltips with attack and defence bars, sockets
   for helmet, armour, shield, two trinkets, three weapons and the vitapod, the gear stats
   column, the knight preview, and the personal colour. B opens the inventory window
   (`ui/inventory/interface_combined.dat`, an arsenal list). The windows' behaviour is audited
   against the client's controllers in docs/research/ui-audit-windows.md.
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
9. **Knockouts.** A knocked-out knight uses a Spark of Life (a new knight has three), buys
   one for 50 energy (the client's `dungeonSparkOfLifeCost` default; any shortfall bought
   with crowns at the exchange), or gives up and rides back to Haven with nothing from the floor.
10. **Arena.** Waves from the game's single-family spawn tables on a cached level, getting
   deeper as they go, with a checkpoint every fifth wave to bank loot. Every tenth wave is a
   boss or mini-boss (Royal Jelly with its phases, Alpha Wolver, Mega Knight, Scorcher).
11. **Crafting.** The game's recipe window (`ui/recipes`, K; the client's crafting window, not
   the crystal forge `ui/forge`): learned recipes from `config/recipe.dat` turn materials,
   crowns and a levelled, unequipped base item into the next item, with the transmute result
   window and its script. Shops are the client's shop dialog: the vendor list, the shopping
   cart with the keeper's portrait and the knight's arsenal to sell from (`ui/shop`).
12. **Saving.** The browser keeps:
   - loadout, owned items and colour;
   - banked crowns, heat and materials;
   - weapon heat and the pocket;
   - the deepest floor and the number of runs.

## What works

| Area | What is in |
|---|---|
| Rendering | Every model and cached scene; library materials (two texture units), colours, lights (scene directional plus point, spot and directional influences, nearest eight per object), fog, particles, animation, scripted models, actor shadows, projected decals (shade under roofs and trees); skyboxes and backdrops (viewer-affecter skyboxes placed at camera + (origin - camera) x scale, the Skybox queues first with their field-of-view scale, overlays such as rain and fog with the level; the Uniform Blur render effect on them is not drawn) |
| Knight | Gear from the arsenal, personal colour, idle, walk and run sets, hurt, death, dash; keyboard and mouse (WASD or the mouse-move scheme) or gamepad; controls and timing from the client's own prediction (src/game/knight.ts: combos, charging, reloads, shield, bash, dodge, flinches, facing, auto-target) |
| Weapons | Swords (combos with lunges, charge), guns (clips, reload, charge shots, auto-aim), bombs (charge, fuse, blast), from item and attack data |
| Shield | Health, regeneration, breaking, shield bash from the shield's own attack |
| Damage | Depth-scaled damage, health and defence from `config/depth_scale.dat`; four damage types; status conditions |
| Status conditions | Fire, freeze, shock, poison, curse, sleep and stun, with the game's effects and HUD icons |
| Heat and levels | Equipped weapons, shields, armour and helmets absorb a floor's heat and level 1 to 10 (`item_property.dat` heat by star); level bonuses from `level_table.dat`: damage and charge time on weapons, defence and heart pips on gear |
| Economy (`src/game/economy.ts`) | Prices and sell prices from `item_property.dat`; Haven's Strangers stock the wiki's lists (`src/game/vendors.ts`: Quillion, Ricasso, Greave, Kragen and Vatel's recipes; zero and one star always, a random few two and three star goods per knight per day, turning at midnight Pacific), Basil (recipes, per visit) and the Supply Depot (capsules and vials the treasure tables give, and its energy goods); selling back; recipes are bought before crafting; crafting costs `recipe_property.dat` crowns, the recipe's materials, three orbs of alchemy of its star (or their pack's energy) and the base item at its level; unique variants rolled from `variant_table.dat` on crafted and found gear, stored per item, shown in names and applied |
| Energy (`src/game/energy.ts`) | The old free Mist Energy tank (100, refilling over 22 hours) and Crystal Energy from the exchange (100 for 6,500 crowns, the client's Get Energy panel), spent mist first; the arsenal's energy module; the Supply Depot's energy goods at their `depotCost` (heat amplifier 800 / 1,600 / 5,000 for 2 / 7 / 30 days, ten Sparks of Life 200, orbs of alchemy 10 to 800 a pack of three); revives, crafting, energy gates and crates, and the knight statues in the furniture shop pay energy |
| Drops | Materials by depth weight (`item_depth_weight.dat`) and the monster's family tags; rare gear drops; mineral deposits (1, 2, 4 or 6 minerals); crowns and heat by depth on the tables' per-tier curves, coins and embers worth their denominations |
| Monsters | Data-driven spawns, tiers by depth, loot; Tudey's behaviour engine (Clyde's BehaviorLogic, AgentLogic, ScriptLogic and Pathfinder) with Spiral Knights' Targeting behaviours and target actions rebuilt from the client's config classes; each family's behaviour from its attack list and the wiki (docs/research/monster-ai.md); Blastcores run their surviving behaviour scripts |
| Treasure and blocks | Breakable blocks break after a few hits; treasure boxes spill crowns and items from their damage action |
| Pocket items | Capsules (health, remedy, buffs, barriers) and vials (thrown, splash damage and status), four slots on keys 4 to 7 |
| Buffs | Attack, defence and speed buffs from `Buff` status conditions, with their HUD icons |
| Gear bonuses | Two trinket slots and a vitapod slot. Armour, helmets, shields and trinkets add health, damage per weapon class, family damage, charge time, attack and move speed, and status resists |
| UI sounds | The game's style feedback sounds on the arsenal, shops, crafting and run menus |
| Level logic | Tudey handlers, actions, targets, conditions and expressions (`src/game/logic.ts`) |
| Props | Doors, switches, blocks, carried keys, pickups, elevators, townsfolk |
| Dungeon objects (`src/game/objects.ts`) | Crystal and ghost block chains, timed explosives, prism puzzles, gun, rocket and fire blocks, status floor traps, healing totems, heal pads, mortar shells, barricades, prisoner cages with freed companion knights, energy gates and crates (paid in energy) |
| Missions | 238 of the game's missions from `config/mission.dat`: a board from the HUD's Missions activity with card images, rewards (their spawn tables) and prestige; dungeon missions on their own floors in order (`src/game/missionfloors.ts`: the wiki's floor lists and depths, each floor its archived level by its scene key, generated in its key's style and status when the archive lacks it; boss floors run the boss director; their own lobbies), briefings, exchanges, prestige gate missions on their scheduled days; event missions (Dark Harvest, Winterfest, Anniversary, Black Kat, Apocrea, Tortodrone) always on, by their rank ranges and day schedules; rank 1-1 to 10-2 in the save, shown on the HUD; tier 2 needs rank 4, tier 3 rank 6 |
| Rescue Camp | A new knight goes on from the crash site to the archived Rescue Camp (Pod Town) when the archive has it: a town with its townsfolk and their conversations (`Character/NPC/Rescue Camp/...`, config/conversation.dat), its General Goods shop, the REACHED_RESCUE_CAMP achievement; the HUD's first activity rides on to Haven |
| HUD | The game's own `hud_v2` interfaces, driven as the client drives them (docs/research/ui-audit-hud.md): status panel with 3D portrait, trailing health and shield bars, floor-heat meter, debuffs; quickbar with sprite skills and pockets; weapon switcher; target panel; minimap; hit flash, low-health frame |
| Audio | Sounder configs through Web Audio, scene music and ambience, animation sounds |
| Guild | Your own hall (the cached hall without its owners' furniture); furniture mode places, moves, rotates (45 degree steps) and stores any of the 250 furniture items from `config/item.dat`, bought with crowns by rarity; guild vault for materials and crowns; guild name and emblem (gate heraldry) |
| Ready Room | `rsrc/world/readyroom/scene.dat` as the client stages it (ReadyRoomSceneConfig): the knight posed at the console (activity 3, `use_inventory_start` then `_loop`), not controllable; the room's Camera/Default camera and its reversed fog; the HUD without its minimap; the Haven activity goes back where the player came from; the knight changes into a new loadout when the arsenal closes |
| Level checklist | `src/game/levels.ts`: 366 server-side levels (Clockworks sets, bosses, Shadow Lairs, danger, rank, expansion and event missions, towns, PvP) with where to get each and a scene-name pattern; `npm run levels` prints collected/missing from the archive and cache; the options window's Levels tab shows the counts (docs/research/levels.md) |
| Log-on screen | As the client opens it (ProjectXApp.aQ, LogonWindow): `ui/logon/interface.dat` over the Cradle skybox (its RenderableView of `world/skybox/cradle/parts/model_base.dat`), the logo and panel entrances, the Grey Havens footer, `title.ogg`; the account parts hidden, Log On plays (`src/ui/title.ts`, `src/ui/glscreen.ts`) |
| Knights | Up to three knights, each a save of its own (arsenal, crowns, missions, rank, played time, look) in one roster; the old single save moves into the first slot. The knight select window (`ui/pick`, client cB): a card per knight with the knight in its gear, rank, guild and time played, Delete with a confirmation, a Create New Knight card per free slot (`src/ui/pick.ts`, `src/game/save.ts`) |
| Prologue | A new knight's intro as the client plays it (dK): `ui/prolgue`, the Cradle camera moves, the preface captions, the 3D comic panels, the crash; `prologue_audio_only.ogg`; SKIP (shown when the pointer moves) or Escape (`src/ui/prologue.ts`) |
| Knight creation | After the prologue: `rsrc/world/createknight/scene.dat` as a stage (the knight on display, no controls, HUD or sprite; held mouse turns it a half turn a second); the creator's windows step through (Armor, Personalize, then the name and Start) with Next, Back returns; a name, personal colour, and the zero-star Spiral helmets and armours in their seven trims |

## What is still missing

**Content**

1. **Level variety.** Generated floors come in the themes the cache has (Jigsaw Valley and
   the Clockwork tunnels). More cached levels would add themes and improve the learned
   tiling. Generated floors have the cached levels' puzzles (gold keys, switch gates,
   block walls, spike runs, secret treasure rooms) and special floors (treasure vaults,
   danger rooms, arenas) and dungeon objects (crystal gates, explosives, prism gates, trap runs,
   rescue cages, healing totems, gun blocks): see docs/research/generated-features.md. The
   Rescue Camp is its archived town (Pod Town) with its own townsfolk and conversations, and
   its missions are the board's rank 1 missions; its tutorial states ("Before Night Falls",
   "Light in the Darkness") and its Training Grounds gate area are not wired (the tutorial's
   objectives, memories and the camp's attack are server logic).
2. **Text.** The game's message bundles are read from the install's projectx-config.jar
   (src/i18n.ts). Text the game makes on its servers, and things this port invents (some
   generated level styles, run summaries, notices, our settings rows), are still our English.
3. **Shop catalogues** are server-side (`config/catalog.dat` and `config/depot_catalog.dat`
   ship empty). Prices are the game's own (`item_property.dat`). Haven's Strangers stock the
   wiki's per-vendor lists (src/game/vendors.ts); how many random goods they show a day the
   wiki does not say (ours: four of each star's list, six recipes of each star), and Kragen's
   trinkets and vitapods are not on his page (kept: every one in the progress's star range).
   Other keepers sell every item of their kind in their place's star range; Basil picks twelve
   recipes per visit. The Supply Depot sells only the energy goods with a use here.
   Guild halls: the cached hall and its layout are as before (the archive's many halls are
   other players'); furniture now costs its `item_property.dat` price by star (Furni Common,
   Uncommon, Rare...; knight statues their `depotCost` in energy), event prizes our tuning.

**Systems**

4. **Energy** (src/game/energy.ts) was server state; there is no real-money Crystal Energy
   here. The single-player source is the game's own pre-2013 Mist Energy: a tank of 100 that
   refills over 22 hours (press and forum accounts; the client still names it, t.mist_tip),
   plus the exchange's instant buy at the client's Get Energy panel figure (100 for 6,500
   crowns; the real exchange was a player market). Mist is spent first. Revives: the wiki and
   the client's server defaults give a flat 50 energy per spark bought on the spot; the rising
   cost of the old energy revives (10, 20, 40... per run, before 2013-07-30) is only in
   forum posts and is not modelled, nor is the wiki's free revive per floor (no client text
   or UI for it). Crafting takes three orbs of alchemy of the recipe's star or their pack's
   depot price (the post-2013 rule; old energy-only crafting costs are not documented).
   Elevators are free (the old 10 mist per elevator was removed in 2013). Minerals carry no
   energy in the data; they bank as materials and sell for nothing (their uses, sprite food
   and gate themes, are not modelled). Guild formation (500 energy, 50,000 crowns) is not
   charged: the single-player guild exists from the start.
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
6. **Guilds and PvP.** Missions play their own levels where the archive has them; their
   dialogue is server data (briefings show the bundle's text or our summary). Event missions
   ran on the servers' event calendar, whose dates moved every year and are not in the data
   (`config/event.dat` holds names only): here every event is always on. Shadow Lairs open from
   the depth-23 terminal's lair elevators of a gate with that boss (no Shadow Key needed here).
7. **Health and treasure numbers.** Block health is not in the data (counted in hits here).

**Fidelity**

8. **Taken from the client** (docs/research/client-fidelity.md, client-map.md): the damage
   and defence formula, bonus steps and caps, knight health (200), the heat series and its
   split between items, status chance and power levels and each condition's defaults,
   knockback impulses, attack timing, the dash, shield regeneration, config class defaults,
   monster and boss health, trap cycles; the knight's controls and their timing, the camera,
   and hit feedback (flash, shake, damage numbers, hit particles, charge effects).
9. **Still ours.** The client runs no game logic (it is server code): which behaviour each monster ran and its distances and weights (the engine is Clyde's, the families are rebuilt: docs/research/monster-ai.md), the boss
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
| Unit tests | 209 of 209 |

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
