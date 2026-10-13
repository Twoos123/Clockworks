# Checklist: the whole game, single player

Each item is ticked when it works in the browser and is committed. Items marked FLAG cannot
be done fully, with the reason.

## Structure and loop
- [x] Game app by default (title screen from `ui/logon`, no asset viewer); viewer behind `#viewer` / `#dev=1`
- [x] Haven → Arcade → gate selection (gate board drawn from the game's gate, map and theme icons)
- [x] Clockworks gates: six strata, depth 0 to 29, tiers 1 to 3, terminals at 4/13/23, Moorcroft Manor (8), Emberlight (18), the Core's terminal (29), boss floors
- [ ] Elevator screen between floors (`ui/elevator`), loading screen with tips (`ui/loading`)
- [x] Arena rooms on generated floors (Iron Gates close, two waves, reopen); gold keys and gold gates, party-platform and hidden-button gates, secret treasure rooms, block and crystal walls, spike runs, Gun Puppy turrets, mineral nodes, themed decoration (`src/gen/features.ts`, docs/research/generated-features.md); FLAG: point/spot lights emitted but not rendered (directional lights only), ghost/prism/timed-explosive blocks and healing totems not used (closed behaviour)
- [x] Terminals: heal on arrival, tiered Supply Depot, elevator onward
- [ ] Depth record, run summary
- [ ] FLAG: exact layouts of levels not in the scenes cache (server-streamed); generated instead

## Content
- [x] Generated floors for 21 tilesets (learned, mirrored, rule-based); FLAG: Water Temple models missing from the install, prism_track is not a tileset
- [ ] Every theme's music (agent: music/loading/elevator) (`full-music-bundle.jar`) mapped to its levels
- [ ] Boss arenas (agent: bosses): Royal Jelly (Jelly Palace), Snarbolax (Gloaming Wildwoods, bells), Roarmulus Twins (Ironclaw Munitions Factory), Lord Vanaduke (Firestorm Citadel)
- [x] Danger rooms, treasure vaults, arenas inside gates (one special floor in 60% of strata, `gateFloors`); FLAG: rescue camps (prisoner cage release and companion AI are closed code)
- [x] Missions: all 272 configs read (238 shown: rank 1-10, prestige by schedule, operations), mission board, rewards, rank progression, tier locks (`src/game/missions.ts`, `src/ui/missions.ts`)
- [ ] FLAG Mission levels, dialogue and rescue camps (server data and message bundles), event missions
- [ ] Guilds: guild hall (agent: guilds), furniture placement, guild storage
- [ ] Ready room (agent: guilds) (`rsrc/world/readyroom/scene.dat`), character creation (`rsrc/world/createknight/scene.dat`)
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
- [ ] Real arsenal / loadout / forge / shop screens (agent: arsenal UI)
- [x] Message keys shown as readable English

## Also in progress (agents)
- [ ] Economy: item levels for all gear, level tables, unique variants, loot by depth, shop catalogues, recipes to buy, selling
- [ ] Battle sprites (Drakon, Maskeraith, Seraphynx) and accessories/costumes
- [ ] Audit and fixes: every monster and weapon animation; lichen fusion

## Done earlier (see STATUS.md)
Engine, scenes cache, Tudey logic, HUD, arsenal, crafting, shops, arena, pocket items, trinkets, vitapods, dash, heat.
