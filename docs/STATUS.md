# Status

Last updated 2026-10-12. Measured against a Steam install updated 2026-10-07.

## Where the game is

A single-player loop runs in the browser, built from the install's own data:

1. **Haven.** The town loads from the scenes cache. Shopkeepers stand in the bazaar and sell
   gear for crowns.
2. **Arsenal.** Every weapon, shield, armour and helmet is available with its icon, plus a
   personal colour.
3. **Runs.** Enter the Clockworks from town. The run goes through the cached levels in
   order (Jigsaw Valley, Terminal 1, Emberlight, Dark Halls, Terminal Core), one depth per
   floor, and the Core's elevator returns to Haven.
4. **Levels play by their own wiring.**
   - Spawners and trigger areas wake waves.
   - Clearing a wave opens or closes gates.
   - Buttons and platforms send signals.
   - Gold keys unlock gold gates.
   - Monsters drop crowns, heat and items.
   - The exit elevator ends the floor.
5. **Saving.** Loadout, owned items, colour, banked crowns and heat, deepest floor and runs
   are kept in the browser.

## What works

| Area | What is in |
|---|---|
| Rendering | Every model and cached scene; library materials, colours, lights, fog, particles, animation, scripted models |
| Knight | Gear from the arsenal, personal colour, idle, run, hurt, death, dash |
| Weapons | Swords (combos with lunges, charge), guns (clips, reload, charge shots, auto-aim), bombs (charge, fuse, blast), from item and attack data |
| Shield | Health, regeneration, breaking, shield bash from the shield's own attack |
| Damage | Depth-scaled damage, health and defence from `config/depth_scale.dat`; four damage types; status conditions |
| Status conditions | Fire, freeze, shock, poison, curse, sleep and stun, with the game's effects and HUD icons |
| Monsters | Data-driven spawns, tiers by depth, loot, a clean-room AI (turrets, ranged spacing, melee) |
| Level logic | Tudey handlers, actions, targets, conditions and expressions (`src/game/logic.ts`) |
| Props | Doors, switches, blocks, carried keys, pickups, elevators, townsfolk |
| HUD | The game's own `hud_v2` interfaces: status panel with 3D portrait, health and shield, debuffs, quickbar, minimap, hit flash, low-health frame |
| Audio | Sounder configs through Web Audio, scene music and ambience, animation sounds |

## What is still missing

**Content**

1. **Levels beyond the cache.** Full dungeon layouts are streamed by the game's servers. The
   cache holds only levels this account has visited, so a run uses those. A real fix needs
   a level source: more cached levels from playing, or generated or hand-made layouts.
2. **Text.** Item names, NPC dialogue and HUD strings live in message bundles inside the
   code jars, which this project does not read. Names come from config paths instead.
3. **Shop catalogues and prices** are server-side. The shops sell from the item library at
   tuning prices.

**Systems**

4. **Weapon heat levels**: weapons level up with heat in the game.
5. **Vitapods, trinkets, energy and revives**: revive is free and instant.
6. **Bosses and special monsters**: those that rely on game-code behaviours (Royal Jelly,
   Snarbolax) need their own AI.
7. **Crafting, missions, guilds, PvP.**

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
| Unit tests | 12 of 12 |

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
