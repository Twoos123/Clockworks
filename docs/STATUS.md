# Status

Last updated 2026-10-12. Measured against a Steam install updated 2026-10-07.

## Gameplay roadmap

| Phase | What you get in the browser | State |
|---|---|---|
| A. World viewer | Models, towns, dungeons, guild halls with correct colours, lighting, fog, particles | Done, gaps below |
| B. Walk around | A knight with gear, movement, follow camera, collision, animations | Done |
| C. Fight | Weapons, attacks, monsters, health, damage, shields, the game's HUD | Sword and shield done; other weapon families not started |
| D. A playable dungeon | Doors, switches, pickups, level flow, sound and music, offline | Not started |
| E. Multiplayer | Your own server for co-op in the browser | Not started |
| F. The live game | Official servers | Only with Grey Havens' permission |

## What works now

- **World.** Every model and cached scene loads, with library materials, colours, lights,
  fog, particles and animation.
- **Knight.** Armour, helmet, the Proto Sword and Proto Shield, idle, run, hurt and death
  animations.
- **Sword.** Data-driven combos with the attack's own lunge, chain window and rearm time, and
  the charge attack.
- **Shield.**
  - Blocks hits from every direction until it breaks.
  - Regenerates and breaks using the shield's own `hitTime`, `regenTime` and `breakTime`.
- **Monsters.** Spawned from scene markers, spawn tables and triggers. They chase and attack,
  and die with their own effects.
- **HUD from the game's files.** A Clyde GUI renderer (`src/ui/`) draws the real
  `rsrc/ui/hud_v2` interfaces:
  - the status panel, with a live 3D portrait from the model's own camera node, the name
    plate, and health and shield pips;
  - the quickbar, showing the weapon icon;
  - the hit flash, the low-health frame and the health bar shake, played from the
    interfaces' own scripts.

  Raising the shield switches the panel to its Blocking layout, as the config defines.

## What is still needed for a true single-player game

The game client fills its HUD and runs combat from code that is not open source, so each
item below is clean-room work driven by the data files.

**Combat**

1. **The other weapon families.**
   - 7 sword, 14 gun and 6 bomb families exist; see `docs/research/weapon-data.md`.
   - Guns need bullets, clips and reloads. Bombs need charge, fuse and blast.
2. **Damage types and defences.**
   - Normal, piercing, elemental and shadow damage, monster weaknesses and armour defence.
   - Depth-scaled damage and health from `config/depth_scale.dat`.
3. **Status effects.** Fire, freeze, shock, poison, curse, stun and sleep, from
   `config/status_condition.dat`, plus the debuff icons the status panel already has.
4. **Monster behaviour per family.** Ranged attacks, charges and projectiles, using
   `config/behavior.dat` and the attack configs.
5. **Shield bash and bump, dash, and weapon switching.**

**Dungeons**

6. **Level objects.** Doors and gates that open when a wave is cleared, switches, keys,
   treasure boxes, heal pads and elevators, from `config/actor.dat` and scene triggers.
7. **Pickups.** Crowns, hearts, heat, and materials, with the quickbar's item slots.
8. **Level content and flow.** The scenes cache holds only levels the account has visited.
   Full dungeon layouts are streamed by the server, so the game needs a level source:
   - visited caches;
   - generated levels;
   - our own layouts.

   Also needed: level sequencing, depth and the Clockworks map.
9. **The minimap**, from `interface_minimap.dat`, drawn from the scene's tiles.

**Presentation**

10. **Audio.** Sound effects and music through Web Audio, from `config/sounder.dat` and the
    animation frame actions (footsteps, swings, hits).
11. **Knight appearance.** Personal colours, gear choice, and the charge glow.
12. **Text.** The game's message bundles for names and descriptions.

**Around the dungeon**

13. **Haven and menus.** Arsenal, loadout and inventory screens from `rsrc/ui`, save data,
    and Haven's NPCs.
14. **An engine decision.** Either keep growing the TypeScript gameplay code, or compile
    Clyde's open-source Tudey layer with TeaVM. The spike says Tudey compiles and runs, but it
    provides only movement, collision, pathfinding and behaviours, not combat. See
    `docs/research/engine-spike.md`.

## Measured results

| Check | Result |
|---|---|
| `.dat` files parsed byte-exact | 7,459 of 7,459 |
| Model files loaded in the browser | 5,816 of 5,816, no failures |
| Material uses resolved from the material library | all, zero fallbacks |
| Cached scenes loaded | 12 of 12, zero unresolved references |
| Weapons audited | 382, in 28 families |
| Unit tests | 8 of 8 |
| Folder-input end-to-end test | passes in Chromium, Firefox and WebKit |

## Known gaps in what exists

- **HUD bindings are our reading.** Which tag shows what, and 12 pixels per 10 health, are
  inferred; the interface files do not say. The quickbar's position at the bottom centre is
  a guess.
- **HUD parts not drawn.** Tooltips, hover states and the old `ui/hud` set.
- **Tuning values.** Knight health, shield health and monster damage are tuning numbers,
  because the real values come from depth-scaled tables not yet evaluated.
- **Scripted models** (99) and UI billboards (27) are not drawn.
- **Local lights** placed in scenes are ignored; only scene-global lights apply.

## Decisions for you

1. **Sending the outreach email.** Draft in `docs/outreach/grey-havens-email.md`; you said
   not yet.
2. **Hosting.** The plan recommends a name and domain free of the game's trademarks and a
   self-hosted git mirror before publishing.
3. **Engine route** for phase D onward, as described in item 14 above.

## Side findings

- The live client ships LWJGL 3 with GLFW, lwjgl3-awt and macOS arm64 natives.
- `config/actor.dat` defines 210 monster types plus bullets, doors, switches and pickups.
