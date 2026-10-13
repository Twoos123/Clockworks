# Status

Last updated 2026-10-12. Measured against a Steam install updated 2026-10-07.

## Gameplay roadmap

| Phase | What you get in the browser | State |
|---|---|---|
| A. World viewer | Models, towns, dungeons, guild halls with correct colours, lighting, fog, particles | Done, gaps below |
| B. Walk around | A knight with armour and helmet, WASD movement, follow camera, collision, idle and run animations | First slice done |
| C. Fight | Weapons and attack animations, monsters from `config/actor.dat`, health and damage | Not started |
| D. A playable dungeon | Spawns, doors, switches, pickups, sound and music, a win condition, offline | Not started |
| E. Multiplayer | Your own server for co-op in the browser | Not started |
| F. The live game | Official servers | Only with Grey Havens' permission |

Phases C onward may compile Three Rings' open-source Java Tudey logic with TeaVM rather than
rewrite it; that spike comes first in phase C.

## Measured results

| Check | Result |
|---|---|
| `.dat` files parsed byte-exact | 7,459 of 7,459 |
| Model files loaded in the browser | 5,816 of 5,816, no failures, about 31 s for all |
| Material uses resolved from the material library | all, zero fallbacks |
| Cached scenes loaded | 12 of 12, zero unresolved references |
| Guild hall furniture | 851 of 851 resolved |
| Haven frame time with particles and animation | about 6 ms, about 1,000 draw calls |
| Unit tests | 8 of 8 |
| Folder-input end-to-end test | passes in Chromium, Firefox and WebKit |

## What this round added

- **Colours.** Texture colorizations from the game's colour definitions, decoded with a Java
  serialization reader. Only `rsrc/config/media/colordefs.dat` inside
  `code/projectx-config.jar` is read, in the browser; nothing else in `code/` is opened.
- **Scene environments.** Ambient and directional lights, fog, background colour, skyboxes,
  and each scene's own camera angle.
- **Particles.** Sprite, mesh and model-emitting particle systems.
- **Animation.** Scrolling and animated textures, procedural animations, prop idle loops,
  billboard nodes, and the wave and emissive shaders.
- **Fidelity fixes.** Premultiplied textures, editor helpers hidden, default-normal lighting.
- **Guild furniture.** Resolved through item, placeable and actor configs.
- **Folder picking.** A race that dropped early picks is fixed, and the folder input is
  tested end to end in three browser engines.
- **Play mode.** "Play as knight" in any cached scene.

## Known gaps

- **Native picker dialog.** The Chromium directory picker's own dialog was not clicked by
  hand; the handle-based code behind it was tested against real directory handles.
- **Knight appearance.** The default armour and helmet only; no personal colours, weapon or
  shield yet, and no gear selection.
- **Walking.** No stairs logic beyond floor heights, no doors or interactions, and spawn is
  the walkable cell nearest the scene centre.
- **Scripted models** (99) and UI billboards (27) are not drawn.
- **Local lights** placed in scenes are ignored; only scene-global lights apply.

## Decisions for you

1. **Sending the outreach email.** Draft in `docs/outreach/grey-havens-email.md`; you said
   not yet.
2. **Hosting.** The plan recommends a name and domain free of the game's trademarks and a
   self-hosted git mirror before publishing.

## Side findings

- The live client ships LWJGL 3 with GLFW, lwjgl3-awt and macOS arm64 natives.
- `config/actor.dat` defines 210 monster types plus bullets, doors, switches and pickups,
  which is the data phase C needs.
