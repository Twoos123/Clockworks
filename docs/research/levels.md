# Levels: the checklist

Every level in Spiral Knights is sent by the game's servers. The official client caches each
one it receives in the install's `scenes/` folder, and `server/install.ts` copies them into the
player's private archive (`%LOCALAPPDATA%\clyde-web\scenes`). This page lists every level
known to exist and where to go in the real game to get it cached.

The data lives in `src/game/levels.ts` (group, set, name, where, scene-name pattern,
availability). `npm run levels` prints the have/missing checklist for the archive and the
install's cache. The options window's **Levels** tab shows the counts per group in the game.

Measured 2026-10-13 against the player's archive after `npm run import-scenes` (19,137 cached
scenes, about 400 of them levels and the rest guild halls):

| Group | Collected | Total |
|---|---|---|
| Clockworks levels | 51 | 160 |
| Boss levels | 15 | 15 |
| Danger missions and Shadow Lairs | 27 | 31 |
| Mission levels | 115 | 153 |
| Towns and hubs | 21 (2 ship with the install) | 23 |
| Coliseum (PvP) | 0 | 39 |
| **All** | **229** | **421** |
| Guild halls | 18,732 archived | (one line, not levels) |
| Dev, test and unnamed scenes | 19 | (not levels) |

`npm run levels` reads the archive's names from `scene-index.json` beside it (the index the
local server keeps, `sceneIndex` in `server/install.ts`), so only levels that are new or changed
are parsed; with this archive it runs in under ten seconds.

## Scene names

A cached scene's `name` is a message key. `src/scene.ts` (`prettySceneName`) turns it into a
display name ("%dungeon:m.jigsaw_valley_emerald_axis_2" becomes "jigsaw valley emerald axis 2").
The key's text, in the install's message bundles (`rsrc/i18n/dungeon.properties` and
`town.properties` in `code/projectx-config.jar`), is the level's in-game name, often as
"Set|Level". That is how each key was matched to its level. The keys are internal names, not
the English names, so the checklist matches them exactly. The formats:

- **Fixed arcade sets**: `<set>_<level>`, numbered variants as digits (`aurora_isles_stone_grove_2`),
  "the" kept where the key has it. Some sets have other key names: the Scarlet Fortress is
  `lost_castle_...` (Grim Gallery is `scarlet_fortress_grim_gallery`), and Dark City's six levels
  are `dark_city_devilish_drudgery` with no number or 2 to 6 (Ritual Road I to III, then
  Sinful Steps, Sinful Steps II, Plazamonium). Minibosses are `<set>_miniboss`.
- **Tunnels and arenas**: an area abbreviation and a monster family, `ct_beast` (Clockwork
  Tunnels' Wild Path), `bf_`, `cc_`, `ww_`, `pc_` for the four status areas; arenas `iea_`,
  `fla_`, `ima_`, `vfa_`, `tfa_`. Compounds are `rc_`, `cc_`, `fc_`, `bc_`, `sc_` with
  `undead_minis` (Chittering Burrows), `slime_minis` (Creeping Colony) or `beast_minis`
  (Ravenous Warrens). Note that `cc_` is both the Cooling Chamber and the Charred Compound.
- **Themed sets**: `<set>_<theme>`, the theme being `vanilla` (no status), `fire`, `freeze`,
  `poison` or `shock` (`wolver_den_freeze`). Treasure Vaults are `tvault_<theme>`.
- **Boss strata**: a short stage name (`gloaming_wildwoods_path`, `royal_jelly_court`,
  `firestorm_citadel_vanaduke` for the Throne Room). The Shadow Lair's copy adds `_ultimate`, and
  an `_alt` layout exists for Battle Royale.
- **Mission floors**: usually the arcade level they reuse with the mission appended
  (`jigsaw_valley_emerald_axis_axesofevil` is Felling Giants); the mission name is shortened or
  run together, and two rotating variants can be the same floor. Others have their own keys
  (`mission_drakon_1`, `cogmaster_castle_1` for Operation Crimson Hammer).
- **Towns**: `%town:m.haven_town_square`; the Garrison is `haven_eastside`. Guild halls are
  `%guild:m.hall|~<guild name>` (and `design` for a hall in design mode).

The old guesses (the English name after an optional set name) missed most of these, so the
checklist keeps a guess (`guess` in `levels.ts`) only for the few levels whose key is not known.
`npm run levels` lists any cached name that matches nothing, and `npm run levels -- --all` every
distinct cached name with its level.

**Dark Halls** is the Shroud of the Apocrea's key: its lobby is The Obsidian Nexus and its
finale Departure; The Grasping Plateau is `spirits_graveyard`.

## Clockworks levels (arcade gates)

A gate in Haven's Arcade has 29 depths in three tiers: 0 to 7, 8 to 17 and 18 to 29. Each
stratum of a gate has a monster family (Beast, Construct, Fiend, Gremlin, Slime, Undead) and
often a status theme (fire, freeze, poison, shock; sleep, curse). The levels a stratum uses
follow from those. Clockwork Terminals sit at depths 4, 13 and 23, subtowns at 8 and 18. [1]

The real gates, with each depth's level options and how they rotate, come from the community
Gate Map; see gatemap.md.

| Set | Levels | Where |
|---|---|---|
| Clockwork Tunnels [2] | six monster levels (Wild Path, Mechanized Mile, Infernal Passage, Gremlin Grounds, Slimeway, Haunted Passage) in each of five areas: Clockwork Tunnels, Blast Furnace (fire), Cooling Chamber (freeze), Wasteworks (poison), Power Complex (shock). 30 levels | any tier; the most common level type |
| Battle Arena [3] | six bouts (Beastly Brawl, Robo Rampage, Fiendish Fray, Wrench Warfare, Slimey Showdown, Cadaverous Clash) in five arenas: Iron Edge, Flame Lash, Ice Maul, Venom Fang, Thunder Fist. 30 levels | any tier; three bouts, the first must be cleared |
| Compound [4] | Chittering Burrows, Creeping Colony, Ravenous Warrens in the Ruined, Charred, Frozen, Blighted and Shocked Compound. 15 levels | tiers 2 and 3 only |
| Candlestick Keep [5] | Fear the Dark, Burning Blackout, Cold Shadows, Noxious Night, Galvanized Gloom | Undead strata |
| Deconstruction Zone [6] | Savage Salvaging, Molten Mayhem, Cold Storage, Radioactive Recycling, Circuit Breakers | Gremlin strata |
| Devilish Drudgery [7] | Overtime Every Time, Everybody's Fired, Hiring Freeze, Toxic Workplace, Wired for Synergy | Fiend strata |
| Lichenous Lair [8] | Prognosis: Symbiosis, Fiery Fusion, Cold Fusion, Toxic Union, Shocking Synthesis | Slime strata |
| Wolver Den [9] | Pack Brutality, Ashes to Ash Tails, Frosty Fury, Raving Rabids, High Voltail | Beast strata |
| Treasure Vault [10] | Obscurity Through Security, Burn Rate, Frozen Assets, Toxic Debt, Flash Crash | randomized ("?") depths |
| Graveyard [11] | Where Monsters Fear to Tread | randomized ("?") depths |
| Danger Room [12] | 27 room layouts (Entrance1A, Circular1A-C, Square1A-3B, Rectangular...), 3 obsolete | optional rooms inside tunnel and Starlight Cradle levels |
| Jigsaw Valley [13] | Emerald Axis, Jade Tangle, Perimeter Promenade, each with a II | Construct and Gremlin strata; each rotates with its II |
| Aurora Isles [14] | Stone Grove, The Jelly Farm, The Jelly Farm II, The Low Gardens | arcade only, rotate in fours |
| Starlight Cradle [15] | Meteor Mile I to III, Shrine of Slumber I to IV, Torporal Titan (miniboss) | Slime strata with sleep |
| Concrete Jungle [16] | Blight Boulevard, Totem Trouble (each with a II), Briar Bone Barrage (tier 3 miniboss) | poison; not in tier 1 since 2011 |
| Dark City [17] | Sinful Steps, Sinful Steps II, Plazamonium, Stygian Steeds (tier 3 miniboss), Ritual Road I to III (arcade only) | Fiend and Undead |
| Scarlet Fortress [18] | Cravat Hall I to III, Spiral Court I and II, Grim Gallery; also Ascending and Descending, Unstable Plaza and The Rambling Arcade (cached, not on the wiki) | castle strata |

The archive also holds Aurora Isles' Stone Grove II and Concrete Jungle's Green Street, which
are not on the wiki. The game's text names a few more that nobody has cached, so where (or
whether) they appear is unknown: Concrete Jungle's Corruption Junction, a Silent Metropolis set
(Strip Maul I to III), Graveyards by theme (fire, freeze, poison, shock), a Treasure Trove and a
Battle Arena level that look like older forms, and 30 "Battlepod" levels, one per tunnel area
and monster family (perhaps the Danger Rooms).

The status order of the five-level sets (normal, fire, freeze, poison, shock) and of the arenas
is confirmed by the keys (`<set>_vanilla`, `_fire`, ...).

### What varies between Battle Arenas, tunnels and compounds

Compared in the archive (prefab labels, globals and spawn tables of each captured floor; the
captures store no `spawnTypes`, so everything the servers chose is baked into the entries):

- **Battle Arenas** are one skeleton of prefab rooms: `elevator_start_N_5w`, three
  `stairs_<n>_NS_5w_26l`, three `room_battle_<n>_NS_5w_01` with a `room_break_<n>_E_5w` beside each,
  two `elevator_next_option_NSW_5w` and `elevator_next_end_SW_5w` (`ima_beast`); a `:N` suffix
  picks a room's variant. The tiles are the castle's Arena King set (the only rug variants in
  tile.dat). What changes with family and status is baked in: each Class Spawn's spawn table
  (waves of one monster, `<room>_auto_spawn <wave>`), the typed mineral nodes (`ima_beast` has
  exactly the two that match both `beast` and `freeze`: Dark Matter and Luminite) and the
  `Environment/Custom/Battle Arena/<Status>/` globals (plus Universal/Freeze/Vision Snow under
  freeze). The waves mix the family's status variants with vanilla ones (Frostifurs and
  Wolvers) and other families' supports and turrets (Menders, Polyps). Mission floors on the
  same skeleton (`ima_construct_spark_roar`, `vfa_undead_weight_of_darkness`) use the `_02` rooms,
  no break rooms, clockwork tiles and the Clockwork Tunnels globals: they are their mission's.
  The client's rule for choosing among a monster's status variants or a family's monsters of a
  role is SpawnTableConfig$SpawnTypeListEntry (best count of matching spawn types, ties at
  random, else the list's default); src/game/derive.ts re-casts an archived arena with it.
- **Clockwork Tunnels** and **Gremlin Compounds** are not one layout: two captures of one area
  and family (three `ct_beast`, two `pc_slime`; `rc_undead_minis` against `fc_undead_minis`) are
  different sets and arrangements of prefab rooms. They are generated per run, so new ones are
  assembled from the captured rooms (src/gen/assemble.ts) rather than derived.

## Boss levels

| Boss stratum | Levels | Where |
|---|---|---|
| Gloaming Wildwoods [19] | Terrilous Trail, Roarsterous Ruins, Lair of the Snarbolax | the gate with the green tree icon, second stratum of tier 1; or rank mission 3-2 Shadow of the Beast |
| Royal Jelly Palace [20] | Garden of Goo, Red Carpet Runaround, Battle Royale | the gate with the pink rook icon, tier 2; or 5-2 The Sovereign Slime |
| Ironclaw Munitions Factory [21] | Abandoned Assembly, Warfare Workshop, The Roarmulus Twins | the gate with the rocket icon, tier 2; or 6-2 Built to Destroy |
| Firestorm Citadel [22] | Blackstone Bridge, Charred Court, Ashen Armory, Smoldering Steps, Throne Room; The Path is Sealed (9-3 only) | the gate with the brown rook icon, tier 3; or 9-3 The King of Ashes |

## Danger missions and Shadow Lairs

**Shadow Lairs** [23]: a Shadow Key used on the elevator of the depth-23 terminal of a gate
with that boss. There are four: the poisoned Wildwoods (two Rabid Snarbolaxes), the frozen
Palace (Ice Queen), the fiery Factory (Red Roarmulus Twins) and the cursed Citadel (Darkfire
Vanaduke). Their stages are the normal stratum's levels in their `_ultimate` versions, with
the same names. Every lair then goes through the Unknown Passage (subtitled A Descent into
Darkness) to the Sanctuary.

**Danger missions** come from the prestige board, in the daily rotation (every fourth day).
The host must be rank 4-1 or higher, and the depth depends on rank. Each has three floors after
the Mission Lobby, the last a treasure floor (`<mission>_treasure_vault`).

| Mission | Floors |
|---|---|
| Legion of Almire [24] | Necropolis Grounds, Inner Sanctum, Cryptic Cache |
| Compound 42 [25] | Outer Facility, Containment, Fire Safe Storage. The mission data and the keys call it Toxic Plant; it is not a separate mission |
| Heart of Ice [26] | Frozen Highway, Amu-Sol, Everfrost Tower |
| Ghosts in the Machine [27] | Dry Dock, Iron Hulk, Cargo Bay |
| Grinchlin Assault! [28] (Winterfest only, rank 7-1) | Base Camp, Ascent, Summit |

## Mission levels

Ranks are the current mission board's, from the install's `config/mission.dat` (paths such as
`Rank/05/5.2/The Sovereign Slime`). Floor names come from the wiki's mission list, which
predates the rank rework (its numbers differ). [29] Every mission starts in the shared Mission
Lobby. Floors that are ordinary Clockworks levels (a Slimeway, a boss stratum) are counted
there instead. Most named floors are their own scenes, even when they reuse an arcade level:
5-1's Candlestick Keep and Devilish Drudgery floors have keys of their own, apart from the
arcade sets'.

- **Tutorial** The Crash Site: Waking in a New World, then the Rescue Camp (Pod Town, Before
  Night Falls, Light in the Darkness, its Training Grounds).
- **1-1** The Abandoned Depot: the Rescue Camp's Training Grounds (a party lobby, an unnamed
  first floor, New Challenges, Powering Up).
- **1-2** The Ancient Generator: Restoring Power. Crossing the Chasm (and 1-4 B): a party lobby,
  The Journey to Haven.
- **2-1** Pumping Up: the Advanced Training Hall.
- **2-2** The sprite missions:
  - Drakon Sprite: Sunset Steppes, Frigid Passage;
  - Seraphynx Sprite: Restless Railroad, End of the Line;
  - Maskeraith Sprite: Creeping Cavern, Emergency Outflow.

  The wiki has these as A Revelation in Flames, Angels from Antiquity and The Phantom Mask.
  Which sprite goes with which old mission is our reading of the old names.
- **2-3** Collector Mission (the wiki's The Collector): a Mechanized Mile, then Camp Crimson.
- **3-1** Alien Ooze: Field Research Site. Toy Soldiers: Factory Floor, Production Center.
- **3-2** Faith in Armor: The Trap Chamber. Strength in Unity: Geo Knight Camp. Blades of the
  Fallen: Soldier's Graveyard. Shadow of the Beast: the Gloaming Wildwoods.
- **4-2** Oilers in the Boilers: The Hot Vents, Smoldering Slime Source. Frostifur Fandango: On
  the Hunt, Den of the Snowclaw Pack. A New Threat: the Laboratory.
- **4-3** Rescues and Recycling: Supply Yard, Deconstruction Site. Shocking Sentient Sentries:
  Patrol Path, Heavy Weapons Facility.
- **5-1** Chilled to the Bone: The Cold Approach, then a Candlestick Keep. Work for Idle Hands:
  Tired of Brimstone, then a Devilish Drudgery.
- **5-2** Time Enough at Last: Inner Court, The Rambling Arcade, Eternal Study. Rise or Fall:
  Storm Rising, Night Falls, Showdown. The Sovereign Slime: the Royal Jelly Palace.
- **6-1** Axes of Evil: Felling Giants, Chopping Block. Plan of Attack: Toxic Cavern, Power
  Grid. High Temperature Hostages: Tracking, Resistance, Extraction.
- **6-2** Whipping and Mishandling: Darkness Above, Sol'Fork Skyway, Sol'Fork Downtown. Sewer
  Stash: Wasteworks Access, Security Outpost, Weapons Cache. Built to Destroy: the Factory.
- **7-2** In Cold Blood: Killer Trail, Ice Cube Alley, Lizard Lounge. Vicious and Viscous: The
  Creeping Colony, The Hungry Den, The Oozing Onslaught.
- **7-3** Beyond the Axes of Evil: Lumbering Doom, Barking Mad, Outpost of Tyranny. Spark and
  Roar: The Cold March, The Iron Tundra, The Bitter Battle, Hidden Hideout.
- **8-1** The Return of Ur: Dimensional Shift, The Summoning Circle, Banishment. Weight of
  Darkness: The Forsaken, Inner Demons, Eternal Struggle.
- **8-2** The Vile Engine: Forgotten Trail, Lichen Colony, Processing Plant. The Rotting
  Metropolis: Streets of Decay, Further Decline, Citizen Uprising. The Great Escape: Prison
  Approach, The Yard, Down the Drain.
- **9-1** An Occurrence at Owlite Keep: The Dead March, The Hall of Remembrance, The Forgotten
  Library. The Silent Legion: Poisoned Minds, Cold Hearts, Cryptic Statuary.
- **9-2** Terminal Meltdown: Code Yellow, Code Orange, Red Alert. Alone in the Dark: Pitch
  Black, Out in the Cold, Final Resting Place. The Gauntlet: Shock and Awe, Reign of Fire, Last Stand.
- **9-3** The King of Ashes: the Firestorm Citadel, then The Path is Sealed.
- **10-1** Breaking in the Recruits: Operation Greenhorn, The Underworks, The Overworks.
  Crimson Chaos: Frost Chamber, The Frozen Compound, Complex 357. It Came From Below: Haunted
  Halls, Into the Maw, A Descent into Darkness (the Unknown Passage's subtitle, so taken as the
  Shadow Lairs' `ultimate_swarm_trap`).
- **10-2** Shadowplay: Greenstone Bridge, Overgrown Court, Throne Room (Firestorm Citadel keys of
  their own). Dreams and Nightmares: The Path is Revealed (`terminal_core_camefrombelow`), A Step
  Beyond twice, Descent into Darkness, Refuge (into the Core). [30] The game's text also has a Core level "Stormchasing" that nobody has cached.
- **Hall of Heroes** missions (4-1, 5-2, 6-2, 8-2, 9-4) play in Haven's Hall of Heroes, one level
  per star (`hall_of_heroes_star1` to `5`: Becoming a Soldier, The Knight Elite, The Defenders,
  The Champions, The Vanguard; star 0 is the hall itself). Pairing the stars with the ranks in
  order is our reading.

**Prestige missions.** The daily Clockworks prestige missions are gate missions now
(`Prestige/Rank N/Gate/<family>`): they send the party down a stratum of that family and have no
levels of their own. The exchange missions have no levels at all.

**Expansion.** Operation Crimson Hammer [31] is bought once per account, with energy, and needs
3-2 The Pioneers. It has three tiers (rank 1, 4 and 6 in the data) and six floors: Storming the
Walls, Silence the Guns, Flank the Frontlines, Clear the Gatehouse, Engines of War (Warmaster
Seerus) and Aftermath.

## How missions play them

`src/game/missionfloors.ts` keeps each mission's floors in order (names and scene keys only) and
the first floor's depth from the wiki's rank mission list (danger and event missions: by rank).
`missionRun` (src/game/missions.ts) plays them one depth each after the lobby: the archived level
for each key (a fixed revision or a captured instance), else a floor generated in the style and
status its key names (`floorStyle`). Shadow Lairs (`lairRun`) are reached from the depth-23
terminal's `Dynamic/Elevator/Shadow Lair` elevators by their "Push Gate" (`sl_wildwoods`,
`sl_royaljelly`, `sl_munitions`, `sl_firestorm`); the terminal gives them "Logical Floor" 26, which
scales every lair floor, and the boss directors take up the Ultimate actors the `_ultimate` levels
spawn (two Rabid Snarbolaxes, the Ice Queen's freeze polyps and minis, Twins/Ultimate,
Vanaduke/Ultimate).

## Seasonal and event levels

The event key comes from the mission data; the floors from the wiki. [32]

| Event (key in mission.dat) | Mission | Levels |
|---|---|---|
| Shroud of the Apocrea (`Apocrea`), rank 4+, depths 19 to 25 [33] | Shroud of the Apocrea | The Obsidian Nexus (its lobby, `dark_halls_lobby`), The Grasping Plateau, Departure (`dark_halls_finale`); random fiend and undead levels between |
| Dark Harvest (`Dark Harvest`, Halloween), rank 3+ [34] | The Dark Harvest | Punkin King's Lair, after a Graveyard, Candlestick Keep or Haunted Passage floor |
| Winterfest (`Winterfest`), rank 3+ [35] | Save Winterfest! | Alleys of Emberlight and Silent Emberlight, on alternate days |
| Winterfest (`Winterfest`), rank 7+ | Grinchlin Assault! | Base Camp, Ascent, Summit |
| Anniversary (`Anniversary`), rank 3+ [36] | Total Caketastrophe!; A Gremlin in Knead | Chaos in the Kitchen; Moonstone Mixup |
| Kataclysmic Confrontation (`Black Kat`, at Moorcroft) [37] | That Mold and Black Magic, Bad Luck and Brimstone, Purr Terror | floors not on the wiki and keys not known (Purr Terror opens on a Candlestick Keep) |
| March of the Tortodrones (`Tortodrone`) [38] | March of the Tortodrones | Ancient Grove (its lobby) and Call of the Colossi, levels of its own; the wiki also tells of Mysterious Rooms inside arcade Infernal Passage, Overtime Every Time and Fiendish Fray levels |

The data has a second Winterfest mission (`Winterfest 2`), but the wiki does not name it.

## No longer reachable

These can only come from an old cache:

- **Sea Petal Pass** (Aurora Isles): beta only. [14]
- **Old named prestige missions**: A Pinch of Salt, Assault on Machine Shop 13, Hazardous
  Heist, Nature of the Beast, Scared to Death, White Collar Captives. They are on the wiki's
  2016 list [32] but not in the install's mission data. Their floors are the `p_` keys: a
  tunnel level per monster family (`p_ct_beast` A Path Less Traveled, and so on) and a themed
  level (`p_wd_vanilla` Howlers Habitat, ...), plus Munitions Storage. Which pair belongs to
  which mission is our reading of the families. A teaser mission's Demo Gate is a `p_` key too.
- **Old sprite mission names**: the levels may live on under the Drakon, Seraphynx and
  Maskeraith sprite missions (above).
- **In the data, not deployed**: Securing the Camp (its level, Bombs Away!, has been cached),
  Bazaar Troubles, Skies Under Cradle, The Scarlet Fortress (rank 1 and 2, `deployment` not
  PRODUCTION).
- **The Core: A Work in Progress**: the Core's old placeholder level.
- **Super Brawl**: a Coliseum mode in the game's text with nine maps, and a Lockdown map
  "Sanctuary" marked beta; none is in the queues.
- **Danger Room layouts**: three are obsolete (D1A_N/A_, Center Brambles, Corner Traps). [12]

## Towns and hubs

| Place | Where |
|---|---|
| Haven: Town Square, Bazaar, Arcade, Garrison [39] | Haven's four districts |
| Laboratory, Hall of Heroes | through the Garrison |
| Guild halls | through the Garrison. Each guild's hall caches as its own scene, named after the guild, so the checklist counts them on one line ("guild halls: N archived") instead of listing them; a guild's Guild Training Hall (three tiers) is a level |
| King Krogmo's Coliseum | Haven, for Lockdown and Blast Network |
| Mission Lobby; a gate's Party Lobby | the first floor of every mission; before a gate's first depth |
| Clockwork Terminals (depths 4, 13, 23), Core Terminal (29) [1][30] | one key, `terminal_1`, for all three terminals; there is no `terminal_2` or `terminal_3`. A return-only terminal (The End of a Journey) is `terminal_return` |
| Rescue Camp | a new knight's camp, during the tutorial |
| Moorcroft Manor (depth 8, rank 4-2) [40] | subtown at the start of tier 2, also by elevator from Haven |
| Emberlight (depth 18, rank 7-1) [41] | subtown at the start of tier 3 |
| Ready Room, knight creation | ship in `rsrc/world/` (no caching needed) |

## Coliseum (PvP)

Lockdown has 16 maps [42]: Forest, Reactor, Furnace, Frostbite, Gardens, Mines, Avenue, Icebox,
Pipeline, Fortress, Necropolis, Ruins, Facility, Ramparts, Downtown and Stadium.

Blast Network has 13 [43]: Gridlock and Gridlock II, Crystals and Crystals II, Backdoor, Rockets
and Rockets II, Spikes, Two Tone, Islands, Division, Stone Cross and Ring.

Both pages are a few years old, so the rotation may have changed.

## Uncertain

- The keys of the Kataclysmic Confrontation floors and of the undeployed missions' floors; those
  entries keep a guess on the English name.
- Whether Danger Rooms and Mysterious Rooms are scenes of their own (no key in the game's text
  names them, unless the Battlepods are the Danger Rooms).
- Where the levels named only in the game's text appear (marked `unknown` in the checklist).
- Which Clockwork Terminal depths share the `terminal_1` layout.
- Depths of mission floors: the wiki's numbers are from the old rank layout.
- Nineteen archived scenes are not counted as levels: developer and test scenes, and a few with
  no name in the game's text (older Wildwoods scenes, an unnamed vault and arena).

## Sources

wiki.spiralknights.com, read 2026-10-13. Names and facts only.

1. Gate; Clockwork Terminal
2. Clockwork Tunnels
3. Battle Arena
4. Compound
5. Candlestick Keep
6. Deconstruction Zone
7. Devilish Drudgery
8. Lichenous Lair
9. Wolver Den
10. Treasure Vault
11. Graveyard
12. Danger Room
13. Jigsaw Valley
14. Aurora Isles
15. Starlight Cradle
16. Concrete Jungle
17. Dark City
18. Scarlet Fortress
19. Gloaming Wildwoods
20. Royal Jelly Palace
21. Ironclaw Munitions Factory
22. Firestorm Citadel
23. Shadow Lair; The Sanctuary
24. Legion of Almire
25. Compound 42
26. Heart of Ice
27. Ghosts in the Machine
28. Grinchlin Assault!
29. List of rank missions
30. The Core
31. Operation Crimson Hammer
32. List of prestige missions; Mission
33. Shroud of the Apocrea
34. The Dark Harvest
35. Save Winterfest!
36. Total Caketastrophe!
37. Kataclysmic Confrontation
38. March of the Tortodrones
39. Haven
40. Moorcroft Manor; Subtown
41. Emberlight
42. Lockdown
43. Blast Network

Each is at `https://wiki.spiralknights.com/<Title_with_underscores>`.

The install's `rsrc/config/mission.dat` gives the mission ranks, events and deployment. It was
read with `tools/config.ts` and `parseMission`. The scene keys' level names are from the
install's `rsrc/i18n/dungeon.properties` and `town.properties` (in `code/projectx-config.jar`),
checked against the names of the levels in the player's archive.
