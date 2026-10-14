# Checklist: the whole game, single player

Each item is ticked when it works in the browser and is committed. Items marked FLAG cannot
be done fully, with the reason.

## Structure and loop
- [x] Game app by default (title screen from `ui/logon`, no asset viewer); viewer behind `#viewer` / `#dev=1`
- [x] Haven → Arcade → gate selection: the game's adventure board (`ui/window/titled.dat` with `ui/adventureboard/parts/map_global_v2.dat` and `normal/panel.dat`: gate tags, the depth map with level icons, locks, theme icons and level tooltips, the Arena entry, Start), opened from the HUD's Arcade button or by walking into Haven's north exit (`to_arcade_central`); FLAG: the Arcade scene (with its gate pillars) is not in the scenes cache, so there is no gate machine to walk up to
- [x] Floor flow in game UI: the knight rides the exit elevator (the scene's elevator model plays its activate and going-down states, the knight sinks with the platform), then the elevator screen (`ui/elevator/nextlevel`) with Advance / Return to Haven; the run summary on arrival in Haven uses the mission-complete window (`ui/mission/parts/part_missioncomplete.dat`); knockouts show the revive window with the game's leave panel (`ui/continue/interface_leaveparty.dat`) to give up. No HTML cards
- [x] Town exits (`src/game/portals.ts`): every `Portals/*` area reports through `World.onPortal` (scene moves, town moves, training floors, and exits whose action the data dropped); an exit to a level in the archive or cache loads it behind the loading screen and the knight arrives at the destination marker with the exit's portal tag, facing out of it (Haven town square, bazaar, Arcade, Garrison...); the Arcade's gate control panels open the gate board; places the archive lacks show the game's not-available notice. Towns without a start platform start at their default entrance
- [x] Townsfolk (`src/game/townsfolk.ts`): idles drawn by their sprite weights as Clyde's ActorSprite does; wanderers (Emberlight's `Gremlin (Wander)`) walk, turn and pause near home with their movement animations at their speed; FLAG: the behaviours themselves are server data (timings ours), and only actors named Wander wander
- [x] Conversations (`src/game/conversation.ts`, `src/ui/conversation.ts`): StartConversation opens `ui/conversation/interface.dat` (or the node's own interface) with the NPC's model and node animation, the knight's reply portrait and response rows, lines as keys of the conversation's bundle; FLAG: the response jumps are stripped, so the way between nodes follows the designers' part names ("part 2a" to "part 3a/3b"); conditional nodes are not evaluated
- [x] Mission Lobby: missions start in the archive's Mission Lobby; its elevator goes down to the mission's first floor
- [x] Clockworks gates: six strata, depth 0 to 29, tiers 1 to 3, terminals at 4/13/23, Moorcroft Manor (8), Emberlight (18), the Core's terminal (29), boss floors
- [x] Elevator screen between floors (`ui/elevator/nextlevel`), loading screen with the game's tips (helptips bundle) and progress (`ui/loading`)
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
- [x] Game text: the message bundles (rsrc/i18n in the install's projectx-config.jar, served by /__sk/i18n, src/i18n.ts) for interface text, item names, flavor, types and variants, monster, boss and level names, mission names, briefings, objectives and dialogue, rank titles, loading tips, shop keepers, help pages; locales the install has (options, language). Our English stays where the game builds text on its servers or we invented the thing (generated style names, run summaries, notices)
- [ ] FLAG: PvP, parties, trading, mail (multiplayer)

## Combat and actors
- [x] Audit: every monster loads, moves, attacks, reacts to hits, dies with its death animation and effects (docs/research/actor-audit.md; reactions follow reactTime, d3a1d96; behaviours in src/game/behavior.ts)
- [x] Audit: knight animations for every weapon class (sword combos, gun shots and reloads, bomb charges), shield, dash, hurt, death, revive, idle
- [x] Guns and bombs: every weapon's attack and charge animations wired, projectiles and effects (c29bc90); FLAG: about 11 guns still don't fire (being fixed)
- [x] Monster reactions to guns and bombs (knockback, react animations, statuses)

## UI
- [x] HUD from the full-screen mockup (menus, objective, activities, target, dash cooldown)
- [x] GUI widgets: Slider, ComboBox, ScrollPane, TabbedPane, TextField, List, interaction
- [x] Real options screen (`ui/options`) bound to the settings
- [x] Real arsenal / loadout / forge / shop / backpack screens (the game's own interfaces)
- [x] Message keys from the game's bundles (readable English made from the key when a bundle lacks it)
- [x] Status window tabs through the game's interfaces (`src/ui/equipment.ts`): Costume (helmet, armour and shield costume sockets; costumes and accessories by location in the arsenal list), Battle Sprite (the sprite's preview and skill sockets, feeding with `interface_battlesprite-hunger.dat`, augment points with confirm and cancel in `panel_battlesprite-skill.dat`, ultimates in `interface_battlesprite-ultimate.dat`), Save Loadout (named loadouts in the save, `ui/loadout` pills and tooltips; up to 10), Character Options (rename with `ui/rename`, personal colour), Achievements (`panel_cheevos.dat`: the cheevos icons and locks, tooltips with the bundle's names, descriptions and progress); the dev HTML wardrobe is gone. FLAG: sprite harnesses and perks, appetite; costumes and accessories are all wearable (their sources are server-side)
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
- [x] Accessories sit at their attachment points: the accessory wrappers (`item/gear/accessory/*/compound_attachwrapper.dat`) name a node (the helmet's `bone_helmet`, the armour's spine or root) that resolves against the knight's skeleton, as Clyde's compound components find theirs through the scope chain (checked in the browser on helmet top, brow, front, side and back, and armour front, arms, back, rear, ankle and aura)
- [x] Achievements (`src/game/achievements.ts`): the client's 65 types (codes are the CRC-32 of the type name: bundle keys `m.achievement_<code>`, icons `ui/icon/cheevos/<code>.png`), kept in the save; earned offline from the arsenal (gear by kind, five-star set, level 10, every socket), rank (tier clearance), depths and runs (terminals, subtowns, the Core, tiers and the full Clockworks without revives), bosses, crafting, capsules and revives; kills counted; announced with the chat bundle's notice. FLAG: party revives, derelict Mecha Knights, Lockdown, the prize wheel and mineral deposits need other players or the server
- [x] Point, spot and directional lights from scene entries and models (LightConfig influences: attenuation, spot exponent and cutoff, box extents; the nearest eight per object, as GL's fixed-function lights; models with light influences off are skipped), including the editor light markers the game's scenes and generated floors place
- [x] White-quad particles fixed: textures are premultiplied on load as Clyde does (WebGL ignores UNPACK_PREMULTIPLY for ImageBitmaps, so alpha-only sprites drew as white squares under additive blending); second texture units (masks, "Separate Mask" materials) are applied; particle layers use their material's own blend
- [x] Audit and fixes: every monster and weapon animation; lichen fusion (c29bc90, e94a9fe)

## Done earlier (see STATUS.md)
Engine, scenes cache, Tudey logic, HUD, arsenal, crafting, shops, arena, pocket items, trinkets, vitapods, dash, heat.
