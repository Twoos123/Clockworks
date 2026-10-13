# Checklist: the whole game, single player

Each item is ticked when it works in the browser and is committed. Items marked FLAG cannot
be done fully, with the reason.

## Structure and loop
- [x] Game app by default (title screen from `ui/logon`, no asset viewer); viewer behind `#viewer` / `#dev=1`
- [x] Haven → Arcade → gate selection (gate board drawn from the game's gate, map and theme icons)
- [x] Clockworks gates: six strata, depth 0 to 29, tiers 1 to 3, terminals at 4/13/23, Moorcroft Manor (8), Emberlight (18), the Core's terminal (29), boss floors
- [x] Elevator screen between floors (`ui/elevator/nextlevel`), loading screen with tips and progress (`ui/loading`); FLAG: tips beyond the two in the install's interfaces are written here (the game's are in message bundles)
- [x] Arena rooms on generated floors (Iron Gates close, two waves, reopen); gold keys and gold gates, party-platform and hidden-button gates, secret treasure rooms, block and crystal walls, spike runs, Gun Puppy turrets, mineral nodes, themed decoration (`src/gen/features.ts`, docs/research/generated-features.md); crystal gates, explosive walls, status trap runs, prism gates, rescue cages, healing totems, gun blocks (`src/game/objects.ts`); FLAG: prism puzzle models missing from the install (stand-ins)
- [x] Terminals: heal on arrival, tiered Supply Depot, elevator onward
- [x] Depth record, run summary; knockouts with the game's revive window (Sparks of Life)
- [ ] FLAG: exact layouts of levels not in the scenes cache (server-streamed); generated instead

## Content
- [x] Generated floors for 21 tilesets (learned, mirrored, rule-based); FLAG: Water Temple models missing from the install, prism_track is not a tileset
- [x] Every theme's music (`full-music-bundle.jar`, `sound/music`) mapped to its levels, bosses, towns and stingers (`docs/research/music.md`)
- [x] Boss arenas: Royal Jelly (Jelly Palace), Snarbolax (Gloaming Wildwoods, bells), Roarmulus Twins (Ironclaw Munitions Factory), Lord Vanaduke (Firestorm Citadel)
- [x] Danger rooms, treasure vaults, arenas inside gates (one special floor in 60% of strata, `gateFloors`); prisoner cages free companion knights (clean-room ally AI); FLAG: rescue camps themselves (townsfolk, missions) are server and bundle data
- [x] Missions: all 272 configs read (238 shown: rank 1-10, prestige by schedule, operations), mission board, rewards, rank progression, tier locks (`src/game/missions.ts`, `src/ui/missions.ts`)
- [ ] FLAG Mission levels, dialogue and rescue camps (server data and message bundles), event missions
- [x] Guilds: guild hall, furniture placement, guild storage (vault), guild name and emblem
- [ ] FLAG: guild hall layouts (expansions, rooms, themes) are server-side; every guild gets the one cached hall
- [x] Ready room (`rsrc/world/readyroom/scene.dat`), character creation (`rsrc/world/createknight/scene.dat`)
- [ ] FLAG: game text (message bundles are in the code jars); labels written here
- [ ] FLAG: PvP, parties, trading, mail (multiplayer)

## Combat and actors
- [ ] Audit: every monster loads, moves, attacks, reacts to hits, dies with its death animation and effects
- [ ] Audit: knight animations for every weapon class (sword combos, gun shots and reloads, bomb charges), shield, dash, hurt, death, revive, idle
- [ ] Guns and bombs: every weapon's attack and charge animations wired, projectiles and effects
- [ ] Monster reactions to guns and bombs (knockback, react animations, statuses)

## UI
- [x] HUD from the full-screen mockup (menus, objective, activities, target, dash cooldown)
- [x] GUI widgets: Slider, ComboBox, ScrollPane, TabbedPane, TextField, List, interaction
- [x] Real options screen (`ui/options`) bound to the settings
- [x] Real arsenal / loadout / forge / shop / backpack screens (the game's own interfaces)
- [x] Message keys shown as readable English
- [x] Status window tabs through the game's interfaces (`src/ui/equipment.ts`): Costume (helmet, armour and shield costume sockets; costumes and accessories by location in the arsenal list), Battle Sprite (the sprite's preview and skill sockets, feeding with `interface_battlesprite-hunger.dat`, augment points with confirm and cancel in `panel_battlesprite-skill.dat`, ultimates in `interface_battlesprite-ultimate.dat`), Save Loadout (named loadouts in the save, `ui/loadout` pills and tooltips; up to 10), Character Options (rename with `ui/rename`, personal colour); the dev HTML wardrobe is gone. FLAG: achievements (only the icons ship; the achievements are server code), sprite harnesses and perks, appetite; costumes and accessories are all wearable (their sources are server-side)
- [x] Shopkeeper portraits: the keeper's own NPC model and shop animation in `vendor_withportrait.dat`'s RenderableView
- [x] Arsenal, backpack, forge and options windows built in idle time after reaching town (first open under a second)
- [x] No HTML panels in game mode: every window is the game's own interface on canvas
  - Mission board (`ui/mission/interface.dat`: category buttons, paged cards, briefing and mission panes; results in `part_missioncomplete.dat`, briefings in `ui/window/confirm_prompt`) (`src/ui/missions.ts`)
  - News and mail in the uplink window (`ui/uplink`: news as `ui/newsfeed` entries, mail headers and bodies) (`src/ui/uplink.ts`)
  - Help window (`ui/help`, H or the HUD's ?) with the bound keys and the mouse, replacing the HTML controls bar (`src/ui/help.ts`)
  - Run summary in the mission results window (`src/ui/summary.ts`); notices in the game's alert frame on a click-through canvas (`src/ui/notice.ts`)
  - Guild console (`ui/guild/interface_console.dat`: name, emblem, vault, hall), furniture mode as a click-through side window, knight creation (`ui/create`), the Ready Room bar (`src/ui/guild.ts`, `furniture.ts`, `createknight.ts`, `readybar.ts`, `floating.ts`)
  - The HTML settings menu is gone: master volume, mute, graphics toggles, minimap, camera, dead zone, key bindings (`ui/options/customcontrols.dat`) and save data (in the Steam tab's place) live in `ui/options`; the Levels checklist moved to the Prompts tab's place
  - FLAG: the gate board and the floor-cleared / knocked-out cards are another branch's work

## Also done or in progress
- [x] Economy: item levels for all gear, level tables, unique variants, loot by depth, shop catalogues, recipes to buy, selling; FLAG: daily catalogues and energy are server-side
- [x] Battle sprites (all 20 configs, skills, levels, perks) given by the sprite missions; accessories and costumes
- [x] Point, spot and directional lights from scene entries and models (LightConfig influences: attenuation, spot exponent and cutoff, box extents; the nearest eight per object, as GL's fixed-function lights; models with light influences off are skipped), including the editor light markers the game's scenes and generated floors place
- [x] White-quad particles fixed: textures are premultiplied on load as Clyde does (WebGL ignores UNPACK_PREMULTIPLY for ImageBitmaps, so alpha-only sprites drew as white squares under additive blending); second texture units (masks, "Separate Mask" materials) are applied; particle layers use their material's own blend
- [ ] Audit and fixes: every monster and weapon animation; lichen fusion

## Done earlier (see STATUS.md)
Engine, scenes cache, Tudey logic, HUD, arsenal, crafting, shops, arena, pocket items, trinkets, vitapods, dash, heat.
