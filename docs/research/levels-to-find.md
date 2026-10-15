# Levels to find

What is still worth capturing, measured 2026-10-15 with `npm run levels`: one (type x status) pair of the prefab-built Clockworks levels (and seven derived ones a capture would improve), then the levels the game sends as they are that the archive lacks. Not listed here: Coliseum PvP, old removed levels, and guild halls.

## Why playing them doesn't capture them

The client only saves *fixed* scenes to the install's `scenes/` folder. These are scenes whose id is below 1073741823 (2^30): towns, buildings and other permanent places (`cV.a` in `ProjectXApp`). Mission floors and Arcade floors are instances the servers create per party, with ids above that line, and the client never writes them to disk. So playing these levels in the real game does not add them to the cache, and the 2026-10-15 run of Alien Ooze saved nothing. The mission and Clockworks levels in the archive came from a community scene archive (`npm run import-scenes`).

Ways to fill the gaps:
- **`npm run capture`:** this starts your own client with a small wrapper around its scene cache (`tools/capture/`), which saves every instanced floor the servers send to `%LOCALAPPDATA%\clyde-web\captured`. clyde-web imports these on its next sync (`importCaptured` in `server/install.ts`). The game's files aren't modified.
- **Fixed places** (King Krogmo's Coliseum, the Training Grounds): visiting them in the real game does cache them.
- **Instanced floors:** find another community scene archive that has them, and import it with `npm run import-scenes <folder>`. Otherwise they keep playing as generated floors built from the real prefab rooms.

## What to capture, and what not to

Most Clockworks levels are not levels to collect one by one. The servers build the Clockwork
Tunnels, Candlestick Keeps, Wolver Dens, Lichenous Lairs, Devilish Drudgery and Graveyards from
prefab rooms on every run, and so does our generator (docs/research/levels.md, "Prefab-built
levels: coverage"). What it needs is rooms and an environment for each **level type and status**,
not a capture of each named level: "Wasteworks: Wild Path" is the poison tunnels' rooms with Beast
monsters, and is built from any captured poison tunnel floor. Of those 30 (type x status) pairs,
22 are captured, 7 are derived (their environment comes from the client's own globals) and 1 is
missing. The named levels of covered pairs count as generated from captured rooms, not missing.

1. **Candlestick Keep with fire (Burning Blackout).** The one pair that is missing: the Keep's
   lighting and fog are colours in its captures, not named per status, so a fire Keep's can only
   come from a capture. Any fire Keep floor will do, a mission's included.
2. **The derived pairs, if you meet them:** a poison Wolver Den, a freeze Lichenous Lair, a plain
   Devilish Drudgery (the one captured, Office Party, has its mission's lighting) and the
   Graveyards with a status. They play already; a capture replaces the library's environment with
   the real one (and shows the status's extras, snow or embers, that the library can't tell).
   The Infernal Passage (plain tunnels, Fiend) is derived the same way: its "Fiendish" lighting
   is in the client's library but no capture shows it.
3. **Danger missions (3).** Without a capture, these play as a generated stand-in floor.
4. **Compounds, Deconstruction Zones and Treasure Vaults.** The servers build these from prefabs
   too, but our generator does not rebuild their layouts yet (compound wilds, framed fields), so
   each still counts by name.
5. **Items marked `[unknown]` or `[event: ...]`.** The game may not send these anymore, so skip
   them unless you happen to see one.

Measured 2026-10-15 with `npm run levels` (which reads the captured floors' tiles and globals) and
`npm run coverage` (which also cuts and assembles their rooms). Not listed: Coliseum PvP (39),
removed levels (26) and guild halls. `[~]` marks a level that plays already but is derived.

## Prefab level types (type x status)
- [ ] **Candlestick Keep**, Fire: missing — its environment is in no capture: the Candlestick Keep's globals carry their colours, not a status's name; rooms of other statuses would do
- [~] **Wolver Den**, Poison: derived — environment from the client's "Wolver's Den/Poison" globals on rooms of other statuses (Wolver Den rooms are the same in every status)
- [~] **Lichenous Lair**, Freeze: derived — environment from the client's "Lichenous Lair/Freeze" globals on rooms of other statuses (Lichenous Lair rooms are the same in every status)
- [~] **Devilish Drudgery**, no status: derived — environment from the client's "Devilish Drudgery/Default" globals
- [~] **Graveyard**, Fire: derived — environment from the client's "Graveyard/Fire" globals on rooms of other statuses (Graveyard rooms are the same in every status)
- [~] **Graveyard**, Freeze: derived — environment from the client's "Graveyard/Freeze" globals on rooms of other statuses (Graveyard rooms are the same in every status)
- [~] **Graveyard**, Poison: derived — environment from the client's "Graveyard/Poison" globals on rooms of other statuses (Graveyard rooms are the same in every status)
- [~] **Graveyard**, Shock: derived — environment from the client's "Graveyard/Shock" globals on rooms of other statuses (Graveyard rooms are the same in every status)

## Clockworks levels: 61 captured, 70 generated or derived, 29 missing (of 160)
- [ ] **Battle Arena**: Fight for Glory, Fight for Treasure [unknown] — A Battle Arena level in the game's text ("battle_arena_1"), not on the wiki; probably the arenas' older form
- [ ] **Compound**: Ruined Compound: Creeping Colony — Arcade gate, tier 2 or 3 only: a Gremlin stratum with no status theme
- [ ] **Compound**: Ruined Compound: Ravenous Warrens — Arcade gate, tier 2 or 3 only: a Gremlin stratum with no status theme
- [ ] **Compound**: Charred Compound: Chittering Burrows — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the fire theme
- [ ] **Compound**: Charred Compound: Creeping Colony — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the fire theme
- [ ] **Compound**: Charred Compound: Ravenous Warrens — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the fire theme
- [ ] **Compound**: Frozen Compound: Creeping Colony — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the freeze theme
- [ ] **Compound**: Frozen Compound: Ravenous Warrens — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the freeze theme
- [ ] **Compound**: Blighted Compound: Creeping Colony — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the poison theme
- [ ] **Compound**: Blighted Compound: Ravenous Warrens — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the poison theme
- [ ] **Compound**: Shocked Compound: Chittering Burrows — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the shock theme
- [ ] **Compound**: Shocked Compound: Creeping Colony — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the shock theme
- [ ] **Compound**: Shocked Compound: Ravenous Warrens — Arcade gate, tier 2 or 3 only: a Gremlin stratum with the shock theme
- [ ] **Candlestick Keep**: Burning Blackout — Arcade gate stratum with Undead monsters and the fire status theme, tiers 2 and 3
- [ ] **Deconstruction Zone**: Savage Salvaging — Arcade gate stratum with Gremlin monsters and the normal status theme
- [ ] **Deconstruction Zone**: Molten Mayhem — Arcade gate stratum with Gremlin monsters and the fire status theme
- [ ] **Deconstruction Zone**: Cold Storage — Arcade gate stratum with Gremlin monsters and the freeze status theme
- [ ] **Deconstruction Zone**: Radioactive Recycling — Arcade gate stratum with Gremlin monsters and the poison status theme
- [ ] **Treasure Vault**: Obscurity Through Security — A randomized depth of an arcade gate (shown as "?" on the gate); ends with the Treasure Mimic
- [ ] **Treasure Vault**: Burn Rate — A randomized depth of an arcade gate (shown as "?" on the gate), fire theme; ends with the Treasure Mimic
- [ ] **Treasure Vault**: Frozen Assets — A randomized depth of an arcade gate (shown as "?" on the gate), freeze theme; ends with the Treasure Mimic
- [ ] **Treasure Vault**: Toxic Debt — A randomized depth of an arcade gate (shown as "?" on the gate), poison theme; ends with the Treasure Mimic
- [ ] **Treasure Vault**: Flash Crash — A randomized depth of an arcade gate (shown as "?" on the gate), shock theme; ends with the Treasure Mimic
- [ ] **Danger Room**: Danger Room — An optional gated room inside Clockwork Tunnels (and Starlight Cradle) levels; probably part of its level's scene rather than a scene of its own
- [ ] **Battlepod**: Battlepod (30 variants) [unknown] — Named "Battlepod" in the game's text, one for each tunnel area and monster family ("bp_cc_slime"); not on the wiki, so where it appears is unknown (perhaps the Danger Rooms)
- [ ] **Concrete Jungle**: Corruption Junction [unknown] — A Concrete Jungle level in the game's text, not on the wiki
- [ ] **Silent Metropolis**: Strip Maul [unknown] — A level set in the game's text that is not on the wiki (perhaps never released)
- [ ] **Silent Metropolis**: Strip Maul II [unknown] — A level set in the game's text that is not on the wiki (perhaps never released)
- [ ] **Silent Metropolis**: Strip Maul III [unknown] — A level set in the game's text that is not on the wiki (perhaps never released)
- [~] **Clockwork Tunnels**: Clockwork Tunnels: Infernal Passage — derived: its environment is the client's "Clockwork Tunnels/Fiendish" set, which no capture shows
- [~] **Devilish Drudgery**: Overtime, Every Time — derived: environment from the client's "Devilish Drudgery/Default" globals
- [~] **Lichenous Lair**: Cold Fusion — derived: environment from the client's "Lichenous Lair/Freeze" globals on rooms of other statuses (Lichenous Lair rooms are the same in every status)
- [~] **Wolver Den**: Raving Rabids — derived: environment from the client's "Wolver's Den/Poison" globals on rooms of other statuses (Wolver Den rooms are the same in every status)
- [~] **Graveyard**: Graveyard (fire) — derived: environment from the client's "Graveyard/Fire" globals on rooms of other statuses (Graveyard rooms are the same in every status)
- [~] **Graveyard**: Graveyard (freeze) — derived: environment from the client's "Graveyard/Freeze" globals on rooms of other statuses (Graveyard rooms are the same in every status)
- [~] **Graveyard**: Graveyard (poison) — derived: environment from the client's "Graveyard/Poison" globals on rooms of other statuses (Graveyard rooms are the same in every status)
- [~] **Graveyard**: Graveyard (shock) — derived: environment from the client's "Graveyard/Shock" globals on rooms of other statuses (Graveyard rooms are the same in every status)

## Boss levels: 15 captured, 0 generated or derived, 0 missing (of 15)

## Danger missions and Shadow Lairs: 28 captured, 0 generated or derived, 3 missing (of 31)
- [ ] **Legion of Almire**: Necropolis Grounds — Danger mission "Legion of Almire" from the prestige mission board (daily rotation, every fourth day), rank 4-1 or higher to host; depth by rank
- [ ] **Compound 42**: Outer Facility — Danger mission "Compound 42" from the prestige mission board (daily rotation, every fourth day), rank 4-1 or higher to host; depth by rank. The mission data calls it Toxic Plant
- [ ] **Ghosts in the Machine**: Dry Dock — Danger mission "Ghosts in the Machine" from the prestige mission board (daily rotation, every fourth day), rank 4-1 or higher to host; depth by rank

## Mission levels: 132 captured, 0 generated or derived, 21 missing (of 153)
- [ ] **The Core**: Stormchasing [unknown] — A Core level in the game's text (keyed like It Came From Below's The Path is Revealed), not on the wiki
- [ ] **rank 4+ Shroud of the Apocrea**: The Grasping Plateau [event: Shroud of the Apocrea] — Event mission "Shroud of the Apocrea"; Shroud of the Apocrea event, depths 19 to 25 (the Nexus is its lobby, Departure its last floor)
- [ ] **rank 4+ That Mold and Black Magic**: That Mold and Black Magic (its floors) [event: Kataclysmic Confrontation] — Kataclysmic Confrontation event mission (Black Kats, given at Moorcroft Manor); floor names and keys not known
- [ ] **rank 4+ Bad Luck and Brimstone**: Bad Luck and Brimstone (its floors) [event: Kataclysmic Confrontation] — Kataclysmic Confrontation event mission (Black Kats, given at Moorcroft Manor); floor names and keys not known
- [ ] **rank 4+ Purr Terror**: Purr Terror (its floors) [event: Kataclysmic Confrontation] — Kataclysmic Confrontation event mission (Black Kats, given at Moorcroft Manor); floor names and keys not known

## Towns and hubs: 21 captured, 0 generated or derived, 2 missing (of 23)
- [ ] **Rescue Camp**: Training Grounds — The Rescue Camp's gate area (a new knight)
- [ ] **Haven**: King Krogmo's Coliseum — Haven: the Coliseum (Lockdown and Blast Network queues)

