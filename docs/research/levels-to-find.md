# Levels to find

These are the levels missing from the archive, measured 2026-10-15 with `npm run levels`: 166 levels that are still in the game. Not listed here: Coliseum PvP (29), old removed levels, and guild halls.

## How capturing works

1. Play the level in the real game, in normal online play. The client saves every level the servers send it into the install's `scenes/` folder.
2. Open clyde-web (dev server or launcher). It copies new scenes into `%LOCALAPPDATA%\clyde-web\scenes`, where they stay even if the game clears its cache.
3. Run `npm run levels` to tick them off.

Reaching one floor of a level is enough. You don't need to clear it.

## What to prioritise

1. **Danger missions (4) and the story mission floors (22).** Without a capture, these play as a generated stand-in floor.
2. **Clockworks levels (109).** These come up randomly at Arcade gates, so just playing the Arcade picks them up over time. Look at the gate's stratum icons to aim for a theme (fire, freeze, poison or shock) and a monster family. Until captured, they play as generated floors built from the real prefab rooms.
3. **Items marked `[unknown]` or `[event: ...]`.** The game may not send these anymore, so skip them unless you happen to see one.

## Clockworks levels: 51 of 160
- [ ] **Clockwork Tunnels**: Clockwork Tunnels: Mechanized Mile — Arcade gate, any tier: a Construct stratum with no status theme (the most common level type)
- [ ] **Clockwork Tunnels**: Clockwork Tunnels: Infernal Passage — Arcade gate, any tier: a Fiend stratum with no status theme (the most common level type)
- [ ] **Clockwork Tunnels**: Clockwork Tunnels: Gremlin Grounds — Arcade gate, any tier: a Gremlin stratum with no status theme (the most common level type)
- [ ] **Clockwork Tunnels**: Blast Furnace: Wild Path — Arcade gate, any tier: a Beast stratum with the fire theme (the most common level type)
- [ ] **Clockwork Tunnels**: Blast Furnace: Mechanized Mile — Arcade gate, any tier: a Construct stratum with the fire theme (the most common level type)
- [ ] **Clockwork Tunnels**: Blast Furnace: Infernal Passage — Arcade gate, any tier: a Fiend stratum with the fire theme (the most common level type)
- [ ] **Clockwork Tunnels**: Blast Furnace: Gremlin Grounds — Arcade gate, any tier: a Gremlin stratum with the fire theme (the most common level type)
- [ ] **Clockwork Tunnels**: Blast Furnace: Slimeway — Arcade gate, any tier: a Slime stratum with the fire theme (the most common level type)
- [ ] **Clockwork Tunnels**: Blast Furnace: Haunted Passage — Arcade gate, any tier: a Undead stratum with the fire theme (the most common level type)
- [ ] **Clockwork Tunnels**: Cooling Chamber: Wild Path — Arcade gate, any tier: a Beast stratum with the freeze theme (the most common level type)
- [ ] **Clockwork Tunnels**: Cooling Chamber: Mechanized Mile — Arcade gate, any tier: a Construct stratum with the freeze theme (the most common level type)
- [ ] **Clockwork Tunnels**: Cooling Chamber: Infernal Passage — Arcade gate, any tier: a Fiend stratum with the freeze theme (the most common level type)
- [ ] **Clockwork Tunnels**: Cooling Chamber: Gremlin Grounds — Arcade gate, any tier: a Gremlin stratum with the freeze theme (the most common level type)
- [ ] **Clockwork Tunnels**: Cooling Chamber: Slimeway — Arcade gate, any tier: a Slime stratum with the freeze theme (the most common level type)
- [ ] **Clockwork Tunnels**: Cooling Chamber: Haunted Passage — Arcade gate, any tier: a Undead stratum with the freeze theme (the most common level type)
- [ ] **Clockwork Tunnels**: Wasteworks: Wild Path — Arcade gate, any tier: a Beast stratum with the poison theme (the most common level type)
- [ ] **Clockwork Tunnels**: Wasteworks: Mechanized Mile — Arcade gate, any tier: a Construct stratum with the poison theme (the most common level type)
- [ ] **Clockwork Tunnels**: Wasteworks: Infernal Passage — Arcade gate, any tier: a Fiend stratum with the poison theme (the most common level type)
- [ ] **Clockwork Tunnels**: Wasteworks: Gremlin Grounds — Arcade gate, any tier: a Gremlin stratum with the poison theme (the most common level type)
- [ ] **Clockwork Tunnels**: Wasteworks: Slimeway — Arcade gate, any tier: a Slime stratum with the poison theme (the most common level type)
- [ ] **Clockwork Tunnels**: Wasteworks: Haunted Passage — Arcade gate, any tier: a Undead stratum with the poison theme (the most common level type)
- [ ] **Clockwork Tunnels**: Power Complex: Wild Path — Arcade gate, any tier: a Beast stratum with the shock theme (the most common level type)
- [ ] **Clockwork Tunnels**: Power Complex: Mechanized Mile — Arcade gate, any tier: a Construct stratum with the shock theme (the most common level type)
- [ ] **Clockwork Tunnels**: Power Complex: Infernal Passage — Arcade gate, any tier: a Fiend stratum with the shock theme (the most common level type)
- [ ] **Clockwork Tunnels**: Power Complex: Gremlin Grounds — Arcade gate, any tier: a Gremlin stratum with the shock theme (the most common level type)
- [ ] **Clockwork Tunnels**: Power Complex: Haunted Passage — Arcade gate, any tier: a Undead stratum with the shock theme (the most common level type)
- [ ] **Battle Arena**: Iron Edge Arena: Beastly Brawl — Arcade gate, any tier: an arena depth in a Beast stratum with no status theme
- [ ] **Battle Arena**: Iron Edge Arena: Robo Rampage — Arcade gate, any tier: an arena depth in a Construct stratum with no status theme
- [ ] **Battle Arena**: Iron Edge Arena: Fiendish Fray — Arcade gate, any tier: an arena depth in a Fiend stratum with no status theme
- [ ] **Battle Arena**: Iron Edge Arena: Wrench Warfare — Arcade gate, any tier: an arena depth in a Gremlin stratum with no status theme
- [ ] **Battle Arena**: Iron Edge Arena: Slimey Showdown — Arcade gate, any tier: an arena depth in a Slime stratum with no status theme
- [ ] **Battle Arena**: Iron Edge Arena: Cadaverous Clash — Arcade gate, any tier: an arena depth in a Undead stratum with no status theme
- [ ] **Battle Arena**: Flame Lash Arena: Beastly Brawl — Arcade gate, any tier: an arena depth in a Beast stratum with the fire theme
- [ ] **Battle Arena**: Flame Lash Arena: Robo Rampage — Arcade gate, any tier: an arena depth in a Construct stratum with the fire theme
- [ ] **Battle Arena**: Flame Lash Arena: Fiendish Fray — Arcade gate, any tier: an arena depth in a Fiend stratum with the fire theme
- [ ] **Battle Arena**: Flame Lash Arena: Wrench Warfare — Arcade gate, any tier: an arena depth in a Gremlin stratum with the fire theme
- [ ] **Battle Arena**: Flame Lash Arena: Slimey Showdown — Arcade gate, any tier: an arena depth in a Slime stratum with the fire theme
- [ ] **Battle Arena**: Flame Lash Arena: Cadaverous Clash — Arcade gate, any tier: an arena depth in a Undead stratum with the fire theme
- [ ] **Battle Arena**: Ice Maul Arena: Beastly Brawl — Arcade gate, any tier: an arena depth in a Beast stratum with the freeze theme
- [ ] **Battle Arena**: Ice Maul Arena: Robo Rampage — Arcade gate, any tier: an arena depth in a Construct stratum with the freeze theme
- [ ] **Battle Arena**: Ice Maul Arena: Fiendish Fray — Arcade gate, any tier: an arena depth in a Fiend stratum with the freeze theme
- [ ] **Battle Arena**: Ice Maul Arena: Wrench Warfare — Arcade gate, any tier: an arena depth in a Gremlin stratum with the freeze theme
- [ ] **Battle Arena**: Ice Maul Arena: Slimey Showdown — Arcade gate, any tier: an arena depth in a Slime stratum with the freeze theme
- [ ] **Battle Arena**: Ice Maul Arena: Cadaverous Clash — Arcade gate, any tier: an arena depth in a Undead stratum with the freeze theme
- [ ] **Battle Arena**: Venom Fang Arena: Beastly Brawl — Arcade gate, any tier: an arena depth in a Beast stratum with the poison theme
- [ ] **Battle Arena**: Venom Fang Arena: Robo Rampage — Arcade gate, any tier: an arena depth in a Construct stratum with the poison theme
- [ ] **Battle Arena**: Venom Fang Arena: Fiendish Fray — Arcade gate, any tier: an arena depth in a Fiend stratum with the poison theme
- [ ] **Battle Arena**: Venom Fang Arena: Wrench Warfare — Arcade gate, any tier: an arena depth in a Gremlin stratum with the poison theme
- [ ] **Battle Arena**: Venom Fang Arena: Slimey Showdown — Arcade gate, any tier: an arena depth in a Slime stratum with the poison theme
- [ ] **Battle Arena**: Venom Fang Arena: Cadaverous Clash — Arcade gate, any tier: an arena depth in a Undead stratum with the poison theme
- [ ] **Battle Arena**: Thunder Fist Arena: Beastly Brawl — Arcade gate, any tier: an arena depth in a Beast stratum with the shock theme
- [ ] **Battle Arena**: Thunder Fist Arena: Robo Rampage — Arcade gate, any tier: an arena depth in a Construct stratum with the shock theme
- [ ] **Battle Arena**: Thunder Fist Arena: Fiendish Fray — Arcade gate, any tier: an arena depth in a Fiend stratum with the shock theme
- [ ] **Battle Arena**: Thunder Fist Arena: Wrench Warfare — Arcade gate, any tier: an arena depth in a Gremlin stratum with the shock theme
- [ ] **Battle Arena**: Thunder Fist Arena: Slimey Showdown — Arcade gate, any tier: an arena depth in a Slime stratum with the shock theme
- [ ] **Battle Arena**: Thunder Fist Arena: Cadaverous Clash — Arcade gate, any tier: an arena depth in a Undead stratum with the shock theme
- [ ] **Battle Arena**: Fight for Glory, Fight for Treasure [unknown] — A Battle Arena level in the game's text ("battle_arena_1"), not on the wiki; probably the arenas' older form
- [ ] **Compound**: Ruined Compound: Creeping Colony — Arcade gate, tier 2 or 3 only: a Gremlin stratum with no status theme
- [ ] **Compound**: Ruined Compound: Ravenous Warrens — Arcade gate, tier 2 or 3 only: a Gremlin stratum with no status theme
- [ ] **Compound**: Charred Compound: Chittering Burrows — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the fire theme
- [ ] **Compound**: Charred Compound: Creeping Colony — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the fire theme
- [ ] **Compound**: Charred Compound: Ravenous Warrens — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the fire theme
- [ ] **Compound**: Frozen Compound: Chittering Burrows — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the freeze theme
- [ ] **Compound**: Frozen Compound: Creeping Colony — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the freeze theme
- [ ] **Compound**: Frozen Compound: Ravenous Warrens — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the freeze theme
- [ ] **Compound**: Blighted Compound: Chittering Burrows — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the poison theme
- [ ] **Compound**: Blighted Compound: Creeping Colony — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the poison theme
- [ ] **Compound**: Blighted Compound: Ravenous Warrens — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the poison theme
- [ ] **Compound**: Shocked Compound: Chittering Burrows — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the shock theme
- [ ] **Compound**: Shocked Compound: Creeping Colony — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the shock theme
- [ ] **Compound**: Shocked Compound: Ravenous Warrens — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the shock theme
- [ ] **Candlestick Keep**: Fear the Dark — Arcade gate stratum with Undead monsters and the normal status theme, tiers 2 and 3
- [ ] **Candlestick Keep**: Burning Blackout — Arcade gate stratum with Undead monsters and the fire status theme, tiers 2 and 3
- [ ] **Candlestick Keep**: Cold Shadows — Arcade gate stratum with Undead monsters and the freeze status theme, tiers 2 and 3
- [ ] **Candlestick Keep**: Noxious Night — Arcade gate stratum with Undead monsters and the poison status theme, tiers 2 and 3
- [ ] **Candlestick Keep**: Galvanized Gloom — Arcade gate stratum with Undead monsters and the shock status theme, tiers 2 and 3
- [ ] **Deconstruction Zone**: Savage Salvaging — Arcade gate stratum with Gremlin monsters and the normal status theme
- [ ] **Deconstruction Zone**: Molten Mayhem — Arcade gate stratum with Gremlin monsters and the fire status theme
- [ ] **Deconstruction Zone**: Cold Storage — Arcade gate stratum with Gremlin monsters and the freeze status theme
- [ ] **Deconstruction Zone**: Radioactive Recycling — Arcade gate stratum with Gremlin monsters and the poison status theme
- [ ] **Devilish Drudgery**: Overtime, Every Time — Arcade gate stratum with Fiend monsters and the normal status theme
- [ ] **Devilish Drudgery**: Everybody's Fired — Arcade gate stratum with Fiend monsters and the fire status theme
- [ ] **Devilish Drudgery**: Toxic Workplace — Arcade gate stratum with Fiend monsters and the poison status theme
- [ ] **Devilish Drudgery**: Wired for Synergy — Arcade gate stratum with Fiend monsters and the shock status theme
- [ ] **Lichenous Lair**: Prognosis: Symbiosis — Arcade gate stratum with Slime monsters and the normal status theme
- [ ] **Lichenous Lair**: Fiery Fusion — Arcade gate stratum with Slime monsters and the fire status theme
- [ ] **Lichenous Lair**: Cold Fusion — Arcade gate stratum with Slime monsters and the freeze status theme
- [ ] **Lichenous Lair**: Toxic Union — Arcade gate stratum with Slime monsters and the poison status theme
- [ ] **Lichenous Lair**: Shocking Synthesis — Arcade gate stratum with Slime monsters and the shock status theme
- [ ] **Wolver Den**: Pack Brutality — Arcade gate stratum with Beast monsters and the normal status theme
- [ ] **Wolver Den**: Ashes to Ash Tails — Arcade gate stratum with Beast monsters and the fire status theme
- [ ] **Wolver Den**: Raving Rabids — Arcade gate stratum with Beast monsters and the poison status theme
- [ ] **Wolver Den**: High Voltail — Arcade gate stratum with Beast monsters and the shock status theme
- [ ] **Treasure Vault**: Obscurity Through Security — A randomized depth of an arcade gate (shown as "?" on the gate); ends with the Treasure Mimic
- [ ] **Treasure Vault**: Burn Rate — A randomized depth of an arcade gate (shown as "?" on the gate), fire theme; ends with the Treasure Mimic
- [ ] **Treasure Vault**: Frozen Assets — A randomized depth of an arcade gate (shown as "?" on the gate), freeze theme; ends with the Treasure Mimic
- [ ] **Treasure Vault**: Toxic Debt — A randomized depth of an arcade gate (shown as "?" on the gate), poison theme; ends with the Treasure Mimic
- [ ] **Treasure Vault**: Flash Crash — A randomized depth of an arcade gate (shown as "?" on the gate), shock theme; ends with the Treasure Mimic
- [ ] **Treasure Vault**: Treasure Trove: Fortune Smiles on the Greedy [unknown] — A "Treasure Trove" in the game's text ("treasure_vault_1"), not on the wiki; probably the vaults' older form
- [ ] **Graveyard**: Graveyard (fire) [unknown] — A fire Graveyard in the game's text, named only by its theme and not on the wiki
- [ ] **Graveyard**: Graveyard (freeze) [unknown] — A freeze Graveyard in the game's text, named only by its theme and not on the wiki
- [ ] **Graveyard**: Graveyard (poison) [unknown] — A poison Graveyard in the game's text, named only by its theme and not on the wiki
- [ ] **Graveyard**: Graveyard (shock) [unknown] — A shock Graveyard in the game's text, named only by its theme and not on the wiki
- [ ] **Danger Room**: Danger Room — An optional gated room inside Clockwork Tunnels (and Starlight Cradle) levels; probably part of its level's scene rather than a scene of its own
- [ ] **Battlepod**: Battlepod (30 variants) [unknown] — Named "Battlepod" in the game's text, one for each tunnel area and monster family ("bp_cc_slime"); not on the wiki, so where it appears is unknown (perhaps the Danger Rooms)
- [ ] **Concrete Jungle**: Corruption Junction [unknown] — A Concrete Jungle level in the game's text, not on the wiki
- [ ] **Silent Metropolis**: Strip Maul [unknown] — A level set in the game's text that is not on the wiki (perhaps never released)
- [ ] **Silent Metropolis**: Strip Maul II [unknown] — A level set in the game's text that is not on the wiki (perhaps never released)
- [ ] **Silent Metropolis**: Strip Maul III [unknown] — A level set in the game's text that is not on the wiki (perhaps never released)

## Boss levels: 15 of 15

## Danger missions and Shadow Lairs: 27 of 31
- [ ] **Legion of Almire**: Necropolis Grounds — Danger mission "Legion of Almire" from the prestige mission board (daily rotation, every fourth day), rank 4-1 or higher to host; depth by rank
- [ ] **Compound 42**: Outer Facility — Danger mission "Compound 42" from the prestige mission board (daily rotation, every fourth day), rank 4-1 or higher to host; depth by rank. The mission data calls it Toxic Plant
- [ ] **Heart of Ice**: Frozen Highway — Danger mission "Heart of Ice" from the prestige mission board (daily rotation, every fourth day), rank 4-1 or higher to host; depth by rank
- [ ] **Ghosts in the Machine**: Dry Dock — Danger mission "Ghosts in the Machine" from the prestige mission board (daily rotation, every fourth day), rank 4-1 or higher to host; depth by rank

## Mission levels: 115 of 153
- [ ] **3-1 Alien Ooze**: Field Research Site — Rank mission 3-1 "Alien Ooze"; after a Slimeway
- [ ] **4-2 Oilers in the Boilers**: The Hot Vents — Rank mission 4-2 "Oilers in the Boilers"
- [ ] **4-2 Oilers in the Boilers**: Smoldering Slime Source — Rank mission 4-2 "Oilers in the Boilers"
- [ ] **5-1 Chilled to the Bone**: Candlestick Keep — Rank mission 5-1 "Chilled to the Bone"
- [ ] **5-2 Rise or Fall**: Storm Rising — Rank mission 5-2 "Rise or Fall"
- [ ] **5-2 Rise or Fall**: Night Falls — Rank mission 5-2 "Rise or Fall"
- [ ] **6-1 Plan of Attack**: Power Grid — Rank mission 6-1 "Plan of Attack"
- [ ] **6-2 Whipping and Mishandling**: Sol'Fork Skyway — Rank mission 6-2 "Whipping and Mishandling"
- [ ] **6-2 Whipping and Mishandling**: Sol'Fork Downtown — Rank mission 6-2 "Whipping and Mishandling"
- [ ] **6-2 Sewer Stash**: Security Outpost — Rank mission 6-2 "Sewer Stash"
- [ ] **6-2 Sewer Stash**: Weapons Cache — Rank mission 6-2 "Sewer Stash"
- [ ] **7-2 Vicious and Viscous**: The Creeping Colony — Rank mission 7-2 "Vicious and Viscous"
- [ ] **7-2 Vicious and Viscous**: The Hungry Den — Rank mission 7-2 "Vicious and Viscous"
- [ ] **7-2 Vicious and Viscous**: The Oozing Onslaught — Rank mission 7-2 "Vicious and Viscous"
- [ ] **8-2 The Vile Engine**: Forgotten Trail — Rank mission 8-2 "The Vile Engine"
- [ ] **8-2 The Vile Engine**: Lichen Colony — Rank mission 8-2 "The Vile Engine"
- [ ] **8-2 The Vile Engine**: Processing Plant — Rank mission 8-2 "The Vile Engine"
- [ ] **The Core**: Stormchasing [unknown] — A Core level in the game's text (keyed like It Came From Below's The Path is Revealed), not on the wiki
- [ ] **rank 4+ Shroud of the Apocrea**: The Grasping Plateau [event: Shroud of the Apocrea] — Event mission "Shroud of the Apocrea"; Shroud of the Apocrea event, depths 19 to 25 (the Nexus is its lobby, Departure its last floor)
- [ ] **rank 4+ That Mold and Black Magic**: That Mold and Black Magic (its floors) [event: Kataclysmic Confrontation] — Kataclysmic Confrontation event mission (Black Kats, given at Moorcroft Manor); floor names and keys not known
- [ ] **rank 4+ Bad Luck and Brimstone**: Bad Luck and Brimstone (its floors) [event: Kataclysmic Confrontation] — Kataclysmic Confrontation event mission (Black Kats, given at Moorcroft Manor); floor names and keys not known
- [ ] **rank 4+ Purr Terror**: Purr Terror (its floors) [event: Kataclysmic Confrontation] — Kataclysmic Confrontation event mission (Black Kats, given at Moorcroft Manor); floor names and keys not known

## Towns and hubs: 21 of 23
- [ ] **Rescue Camp**: Training Grounds — The Rescue Camp's gate area (a new knight)
- [ ] **Haven**: King Krogmo's Coliseum — Haven: the Coliseum (Lockdown and Blast Network queues)

## Coliseum (PvP): 0 of 39
