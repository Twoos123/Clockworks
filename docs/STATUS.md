# Status

Last updated 2026-10-12. Measured against a Steam install updated 2026-10-07.

## Where the game is

A single-player loop runs in the browser, built from the install's own data:

1. **Haven.** The town loads from the scenes cache. Shopkeepers stand in the bazaar and sell
   gear for crowns.
2. **Arsenal.** Every weapon, shield, armour and helmet is available with its icon, plus a
   personal colour.
3. **Runs.** Enter the Clockworks from town. Each cached combat level is followed by a
   newly generated floor of its theme, one depth per floor. The Core's elevator returns to
   Haven; "go deeper" past the end keeps generating floors.
4. **Generated floors** (`src/gen`).
   - The level editor's brush libraries ship empty, so the auto-tiling is learned from the
     theme's cached levels: which tile, rotation and elevation sits in which neighbourhood.
   - Layouts are rooms joined by corridors three cells wide.
   - Each room gets the game's own wiring, copied and retagged: a "Player Enter/Spawn
     Activate" area, "Single Spawn" markers with spawn tables from the sources, and treasure
     boxes.
   - The start platform, exit elevator and lighting globals come from the source levels.
5. **Levels play by their own wiring.**
   - Spawners and trigger areas wake waves.
   - Clearing a wave opens or closes gates.
   - Buttons and platforms send signals.
   - Gold keys unlock gold gates.
   - Monsters drop crowns, heat and items.
   - The exit elevator ends the floor.
6. **Knockouts.** A knocked-out knight can revive for crowns (25 per depth) or give up and
   ride back to Haven with nothing from the floor.
7. **Arena.** Waves from the game's single-family spawn tables on a cached level, getting
   deeper as they go, with a checkpoint every fifth wave to bank loot. Every tenth wave is a
   boss or mini-boss (Royal Jelly with its phases, Alpha Wolver, Mega Knight, Scorcher).
8. **Crafting.** Recipes from `config/recipe.dat` turn materials, crowns and a levelled base
   item into the next item.
9. **Saving.** The browser keeps:
   - loadout, owned items and colour;
   - banked crowns, heat and materials;
   - weapon heat and the pocket;
   - the deepest floor and the number of runs.

## What works

| Area | What is in |
|---|---|
| Rendering | Every model and cached scene; library materials, colours, lights, fog, particles, animation, scripted models, actor shadows, projected decals (shade under roofs and trees) |
| Knight | Gear from the arsenal, personal colour, idle, run, hurt, death, dash; keyboard and mouse or gamepad |
| Weapons | Swords (combos with lunges, charge), guns (clips, reload, charge shots, auto-aim), bombs (charge, fuse, blast), from item and attack data |
| Shield | Health, regeneration, breaking, shield bash from the shield's own attack |
| Damage | Depth-scaled damage, health and defence from `config/depth_scale.dat`; four damage types; status conditions |
| Status conditions | Fire, freeze, shock, poison, curse, sleep and stun, with the game's effects and HUD icons |
| Weapon heat | Weapons absorb heat and level up (1 to 10), raising their damage; the HUD heat meter shows the level |
| Monsters | Data-driven spawns, tiers by depth, loot, a clean-room AI (turrets, ranged spacing, melee), A* pathing around walls |
| Treasure and blocks | Breakable blocks break after a few hits; treasure boxes spill crowns and items from their damage action |
| Pocket items | Capsules (health, remedy, buffs, barriers) and vials (thrown, splash damage and status), four slots on keys 4 to 7 |
| Buffs | Attack, defence and speed buffs from `Buff` status conditions, with their HUD icons |
| Gear bonuses | Two trinket slots and a vitapod slot. Armour, helmets, shields and trinkets add health, damage per weapon class, family damage, charge time, attack and move speed, and status resists |
| UI sounds | The game's style feedback sounds on the arsenal, shops, crafting and run menus |
| Level logic | Tudey handlers, actions, targets, conditions and expressions (`src/game/logic.ts`) |
| Props | Doors, switches, blocks, carried keys, pickups, elevators, townsfolk |
| Missions | 238 of the game's missions from `config/mission.dat`: a board from the HUD's Missions activity with card images, rewards (their spawn tables) and prestige; dungeon missions (themed floors at their rank's depth, ending in their boss), briefings, exchanges, prestige gate missions on their scheduled days; rank 1-1 to 10-2 in the save, shown on the HUD; tier 2 needs rank 4, tier 3 rank 6 |
| HUD | The game's own `hud_v2` interfaces: status panel with 3D portrait, health and shield, debuffs, quickbar, minimap, hit flash, low-health frame |
| Audio | Sounder configs through Web Audio, scene music and ambience, animation sounds |

## What is still missing

**Content**

1. **Level variety.** Generated floors come in the themes the cache has (Jigsaw Valley and
   the Clockwork tunnels). More cached levels would add themes and improve the learned
   tiling. Generated floors have no puzzles, doors or keys.
2. **Text.** Item names, NPC dialogue and HUD strings live in message bundles inside the
   code jars, which this project does not read. Names come from config paths instead.
3. **Shop catalogues and prices** are server-side. The shops sell from the item library at
   tuning prices.

**Systems**

4. **Energy.** Revives cost crowns rather than energy.
5. **Boss levels.** Bosses run their own handlers in the Arena. Their scripted arenas (the
   Jelly Palace, Snarbolax's bells) are server-streamed levels this cache lacks.
6. **Guilds and PvP.** Missions are in (below), but their own levels and dialogue are
   server data: dungeon missions play as themed generated floors, briefings show our summary.
7. **Health and treasure numbers.** Block health is not in the data (counted in hits here).

**Fidelity**

8. **Monster AI** is clean-room. The game's AI and attack selection are closed code.
9. **Damage formula and several numbers are tuning values:**
   - knight health, the defence formula, status chance and power levels;
   - prices, the dash.
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
| Unit tests | 15 of 15 |

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
