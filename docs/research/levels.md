# Levels: the checklist

Every level in Spiral Knights is sent by the game's servers. The official client caches each
one it receives in the install's `scenes/` folder, and `server/install.ts` copies them into the
player's private archive (`%LOCALAPPDATA%\clyde-web\scenes`). This page lists every level
known to exist and where to go in the real game to get it cached.

The data lives in `src/game/levels.ts` (group, set, name, where, scene-name pattern,
availability). `npm run levels` prints the have/missing checklist for the archive and the
install's cache. The options window's **Levels** tab shows the counts per group in the game.

Measured 2026-10-13 against the reference install (12 cached scenes):

| Group | Collected | Total |
|---|---|---|
| Clockworks levels | 3 | 144 |
| Boss levels | 0 | 15 |
| Danger missions and Shadow Lairs | 0 | 32 |
| Mission levels | 2 | 129 |
| Towns and hubs | 9 (2 ship with the install) | 17 |
| Coliseum (PvP) | 0 | 29 |
| **All** | **14** | **366** |

## Scene names

A cached scene's `name` is a message key. `src/scene.ts` (`prettySceneName`) turns it into a
display name. The names seen so far:

| File | Raw name | Level |
|---|---|---|
| 1 | `%town:m.haven_town_square` | Haven, Town Square |
| 2 | `%town:m.haven_bazaar` | Haven, Bazaar |
| 23389 | `%guild:m.hall\|~The Exceeds` | a guild's hall (the guild's name after `~`) |
| 27913 | `%dungeon:m.dark_halls_lobby` | Shroud of the Apocrea lobby (see below) |
| 28074 | `%dungeon:m.dark_halls_finale` | Shroud of the Apocrea last floor |
| 28075 | `%dungeon:m.mission_lobby` | Mission Lobby |
| 328 | `%dungeon:m.terminal_core` | Core Terminal (depth 29) |
| 330 | `%dungeon:m.terminal_1` | Clockwork Terminal (depth 4) |
| 349 | `%dungeon:m.emberlight` | Emberlight (depth 18) |
| 370 | `%dungeon:m.jigsaw_valley_emerald_axis_2` | Jigsaw Valley: Emerald Axis II |
| 374 | `%dungeon:m.jigsaw_valley_perimeter_promenade_2` | Jigsaw Valley: Perimeter Promenade II |
| 376 | `%dungeon:m.jigsaw_valley_the_jade_tangle` | Jigsaw Valley: Jade Tangle |

So the keys look like `<region>_<level name>`, in lower case, with "the" kept and numbered
variants as digits. The keys of levels not yet seen are guesses on that model. The patterns
accept:

- the region or mission name as an optional prefix;
- an optional "the";
- "2" or "ii" for a numbered variant, and an optional "1" on an unnumbered one.

Any cached name that matches nothing is listed by `npm run levels`, so a wrong guess shows up
as soon as that level is cached.

**Dark Halls** is not a wiki name. The two scenes hold Lost Soul drones, a "Harvester Warning"
and harvested souls, the pieces of the Shroud of the Apocrea event (last run 15 to 25 May 2026).
They are filed under that mission as its lobby and its last floor (the wiki's "Departure").

## Clockworks levels (arcade gates)

A gate in Haven's Arcade has 29 depths in three tiers: 0 to 7, 8 to 17 and 18 to 29. Each
stratum of a gate has a monster family (Beast, Construct, Fiend, Gremlin, Slime, Undead) and
often a status theme (fire, freeze, poison, shock; sleep, curse). The levels a stratum uses
follow from those. Clockwork Terminals sit at depths 4, 13 and 23, subtowns at 8 and 18. [1]

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
| Scarlet Fortress [18] | Cravat Hall I to III, Spiral Court I and II, Grim Gallery | castle strata |

The status order of the five-level sets (normal, fire, freeze, poison, shock) and of the arenas
is read from the level names; the wiki does not state it.

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
Vanaduke). Their stages follow the normal stratum. Every lair then goes through the Unknown
Passage to the Sanctuary.

**Danger missions** come from the prestige board, in the daily rotation (every fourth day).
The host must be rank 4-1 or higher, and the depth depends on rank. Each has a lobby, two
combat floors and a treasure floor.

| Mission | Floors |
|---|---|
| Legion of Almire [24] | Necropolis Grounds, Inner Sanctum, Cryptic Cache |
| Compound 42 [25] | Outer Facility, Containment, Fire Safe Storage |
| Heart of Ice [26] | Frozen Highway, Amu-Sol, Everfrost Tower |
| Ghosts in the Machine [27] | Dry Dock, Iron Hulk, Cargo Bay |
| Toxic Plant | in the install's `config/mission.dat`; not on the wiki, floors unknown |
| Grinchlin Assault! [28] (Winterfest only, rank 7-1) | Base Camp, Ascent, Summit |

## Mission levels

Ranks are the current mission board's, from the install's `config/mission.dat` (paths such as
`Rank/05/5.2/The Sovereign Slime`). Floor names come from the wiki's mission list, which
predates the rank rework (its numbers differ). [29] Every mission starts in the shared Mission
Lobby. Floors that are ordinary Clockworks levels (a Slimeway, a Candlestick Keep, a boss
stratum) are counted there instead.

- **1-1** The Abandoned Depot: the tutorial's first mission; not on the wiki.
- **1-2** The Ancient Generator: Restoring Power. Crossing the Chasm (and 1-4 B): The Journey to Haven.
- **2-1** Pumping Up: the training hall; floor name not on the wiki.
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
  Halls, Into the Maw, A Descent into Darkness.
- **10-2** Shadowplay: Greenstone Bridge, Overgrown Court, Throne Room. Dreams and Nightmares:
  The Path is Revealed, A Step Beyond, Descent into Darkness, Refuge (into the Core). [30]
- **Hall of Heroes** missions (4-1, 5-2, 6-2, 8-2, 9-4) play in Haven's Hall of Heroes.

**Prestige missions.** The daily Clockworks prestige missions are gate missions now
(`Prestige/Rank N/Gate/<family>`): they send the party down a stratum of that family and have no
levels of their own. The exchange missions have no levels at all.

**Expansion.** Operation Crimson Hammer [31] is bought once per account, with energy, and needs
3-2 The Pioneers. It has three tiers (rank 1, 4 and 6 in the data) and six floors: Storming the
Walls, Silence the Guns, Flank the Frontlines, Clear the Gatehouse, Engines of War (Warmaster
Seerus) and Aftermath.

## Seasonal and event levels

The event key comes from the mission data; the floors from the wiki. [32]

| Event (key in mission.dat) | Mission | Levels |
|---|---|---|
| Shroud of the Apocrea (`Apocrea`), rank 4+, depths 19 to 25 [33] | Shroud of the Apocrea | Dark Halls lobby and finale (cached), The Obsidian Nexus, The Grasping Plateau; random fiend and undead levels between |
| Dark Harvest (`Dark Harvest`, Halloween), rank 3+ [34] | The Dark Harvest | Punkin King's Lair, after a Graveyard, Candlestick Keep or Haunted Passage floor |
| Winterfest (`Winterfest`), rank 3+ [35] | Save Winterfest! | Alleys of Emberlight and Silent Emberlight, on alternate days |
| Winterfest (`Winterfest`), rank 7+ | Grinchlin Assault! | Base Camp, Ascent, Summit |
| Anniversary (`Anniversary`), rank 3+ [36] | Total Caketastrophe!; A Gremlin in Knead | Chaos in the Kitchen; the second's floors are not on the wiki |
| Kataclysmic Confrontation (`Black Kat`, at Moorcroft) [37] | That Mold and Black Magic, Bad Luck and Brimstone, Purr Terror | floors not on the wiki (Purr Terror opens on a Candlestick Keep) |
| March of the Tortodrones (`Tortodrone`) [38] | March of the Tortodrones | Mysterious Rooms inside arcade Infernal Passage, Overtime Every Time and Fiendish Fray levels |

The data has a second Winterfest mission (`Winterfest 2`), but the wiki does not name it.

## No longer reachable

These can only come from an old cache:

- **Sea Petal Pass** (Aurora Isles): beta only. [14]
- **Old named prestige missions**: A Pinch of Salt, Assault on Machine Shop 13 (Munitions
  Storage), Hazardous Heist, Nature of the Beast, Scared to Death, White Collar Captives. They
  are on the wiki's 2016 list [32] but not in the install's mission data.
- **Old sprite mission names**: the levels may live on under the Drakon, Seraphynx and
  Maskeraith sprite missions (above).
- **In the data, not deployed**: Securing the Camp, Bazaar Troubles, Skies Under Cradle, The
  Scarlet Fortress (rank 1 and 2, `deployment` not PRODUCTION).
- **Danger Room layouts**: three are obsolete (D1A_N/A_, Center Brambles, Corner Traps). [12]

## Towns and hubs

| Place | Where |
|---|---|
| Haven: Town Square, Bazaar, Arcade, Garrison [39] | Haven's four districts |
| Laboratory, Guild Hall, Hall of Heroes | through the Garrison. Each guild's hall caches as its own scene, named after the guild |
| King Krogmo's Coliseum | Haven, for Lockdown and Blast Network |
| Mission Lobby | the first floor of every mission |
| Clockwork Terminals (depths 4, 13, 23), Core Terminal (29) [1][30] | `terminal_1` is cached; `terminal_2` and `terminal_3` are guesses |
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

- The scene keys of every level not yet cached (see Scene names).
- Whether Danger Rooms, Clockwork Tunnels segments and Mysterious Rooms are scenes of their own.
  Tunnel levels are built from segments, so a cached tunnel level is probably one scene per level.
- Which Shadow Lair stages are distinct scenes. The wiki gives no stage names, so ours use the
  normal stratum's names with a "shadow" prefix.
- Depths of mission floors: the wiki's numbers are from the old rank layout.

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
read with `tools/config.ts` and `parseMission`.
