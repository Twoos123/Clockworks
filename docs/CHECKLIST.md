# Checklist: the whole game, single player

Each item is ticked when it works in the browser and is committed. Items marked FLAG cannot
be done fully, with the reason.

## Structure and loop
- [ ] Game app by default (title screen from `ui/logon`, no asset viewer); viewer behind `#viewer` / `#dev=1`
- [ ] Haven → Arcade → gate selection (`ui/mission/interface_gate.dat`, adventure board)
- [ ] Clockworks gates: 4 strata, depth 0 to 28, tiers 1 to 3 (depths 1-7, 8-17, 18-28), terminals between strata, Core at the bottom
- [ ] Elevator screen between floors (`ui/elevator`), loading screen with tips (`ui/loading`)
- [ ] In-level gates and puzzles on generated floors (Iron Gates: gold key, monster, trigger, energy)
- [ ] Terminals: shop, heal, elevator onward
- [ ] Depth record, run summary
- [ ] FLAG: exact layouts of levels not in the scenes cache (server-streamed); generated instead

## Content
- [ ] Generated floors for all 22 tilesets
- [ ] Every theme's music (`full-music-bundle.jar`) mapped to its levels
- [ ] Boss arenas: Royal Jelly (Jelly Palace), Snarbolax (Gloaming Wildwoods, bells), Roarmulus Twins (Ironclaw Munitions Factory), Lord Vanaduke (Firestorm Citadel)
- [ ] Danger rooms, treasure vaults, arenas inside gates
- [ ] Missions: all 272 configs (rank missions 1-9 with prestige, exchange and gate missions), mission board, rewards, rescue camps
- [ ] Guilds: guild hall, furniture placement, guild storage
- [ ] Ready room (`rsrc/world/readyroom/scene.dat`), character creation (`rsrc/world/createknight/scene.dat`)
- [ ] FLAG: game text (message bundles are in the code jars); labels written here
- [ ] FLAG: PvP, parties, trading, mail (multiplayer)

## Combat and actors
- [ ] Audit: every monster loads, moves, attacks, reacts to hits, dies with its death animation and effects
- [ ] Audit: knight animations for every weapon class (sword combos, gun shots and reloads, bomb charges), shield, dash, hurt, death, revive, idle
- [ ] Guns and bombs: every weapon's attack and charge animations wired, projectiles and effects
- [ ] Monster reactions to guns and bombs (knockback, react animations, statuses)

## UI
- [x] HUD from the full-screen mockup (menus, objective, activities, target, dash cooldown)
- [ ] GUI widgets: Slider, ComboBox, ScrollPane, TabbedPane, TextField, interaction
- [ ] Real options screen (`ui/options`) bound to the settings
- [x] Real arsenal / loadout / forge / shop / backpack screens
- [ ] Real mission screens
- [ ] Message keys shown as readable English

## Done earlier (see STATUS.md)
Engine, scenes cache, Tudey logic, HUD, arsenal, crafting, shops, arena, pocket items, trinkets, vitapods, dash, heat.
