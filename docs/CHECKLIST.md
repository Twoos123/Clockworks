# Checklist: the whole game, single player

Each item is ticked when it works in the browser and is committed. Items marked FLAG cannot
be done fully, with the reason.

## Structure and loop
- [x] Game app by default (title screen from `ui/logon`, no asset viewer); viewer behind `#viewer` / `#dev=1`
- [x] Haven → Arcade → gate selection: the game's adventure board (`ui/window/titled.dat` with `ui/adventureboard/parts/map_global_v2.dat` and `normal/panel.dat`: gate tags, the depth map with level icons, locks, theme icons and level tooltips, the Arena entry, Start), opened from the HUD's Arcade button or by walking into Haven's north exit (`to_arcade_central`); FLAG: the Arcade scene (with its gate pillars) is not in the scenes cache, so there is no gate machine to walk up to
- [x] Floor flow in game UI: the knight rides the exit elevator (the scene's elevator model plays its activate and going-down states, the knight sinks with the platform), then the elevator screen (`ui/elevator/nextlevel`) with Advance / Return to Haven; the run summary on arrival in Haven uses the mission-complete window (`ui/mission/parts/part_missioncomplete.dat`); knockouts show the revive window with the game's leave panel (`ui/continue/interface_leaveparty.dat`) to give up. No HTML cards
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

## Also done or in progress
- [x] Economy: item levels for all gear, level tables, unique variants, loot by depth, shop catalogues, recipes to buy, selling; FLAG: daily catalogues and energy are server-side
- [x] Battle sprites (all 20 configs, skills, levels, perks) given by the sprite missions; accessories and costumes
- [x] Point, spot and directional lights from scene entries and models (LightConfig influences: attenuation, spot exponent and cutoff, box extents; the nearest eight per object, as GL's fixed-function lights; models with light influences off are skipped), including the editor light markers the game's scenes and generated floors place
- [x] White-quad particles fixed: textures are premultiplied on load as Clyde does (WebGL ignores UNPACK_PREMULTIPLY for ImageBitmaps, so alpha-only sprites drew as white squares under additive blending); second texture units (masks, "Separate Mask" materials) are applied; particle layers use their material's own blend
- [ ] Audit and fixes: every monster and weapon animation; lichen fusion

## Done earlier (see STATUS.md)
Engine, scenes cache, Tudey logic, HUD, arsenal, crafting, shops, arena, pocket items, trinkets, vitapods, dash, heat.
