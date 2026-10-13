# Puzzles, special floors and decoration on generated floors

`src/gen/features.ts` adds the cached Clockworks levels' puzzles and set pieces to generated
floors. It runs in `generatedRoot` (src/main.ts) after `arenaRooms`, reads the floor plan that
`generateLevel` leaves in `root.gen` (rooms, start, exit, floor cells), and emits ordinary
TudeySceneModel entries using the game's own placeables, wired as the cached levels wire them.
Nothing here is new behaviour: every pattern below plays through the existing logic engine
(`src/game/logic.ts`) and props (`src/game/world.ts`).

## The plan

Rooms and corridors are recovered from the floor cells: corridor components are the floor
outside the rooms, the room graph joins rooms that share a component, and a *mouth* is a run
of corridor cells just outside a room side (where `arenaRooms` stands its Monster gates). The
main path is the room path from start to exit; dead ends are rooms off it with one mouth.

## Patterns and where they come from

| Feature | Placeables and wiring | Seen in |
|---|---|---|
| Gold key | `Dynamic/Door/Iron Gate/Gold 3` at a path room's mouth (the only way on: a flood fill with it shut must not reach the exit); `Dynamic/Misc/Altar/Gold Key` with `Dynamic/Lift Objects/Gold Key` on it in a room the start still reaches, preferring rooms off the path | 376 (key on altar), 370 (key spawned by a `Trigger/One Time Action`) |
| Switch gate | closed `Iron Gate/Trigger 3` on a dead end; opened by a `Dynamic/Switch/Party Platform/Base` in the room in front (`Action`: Signal open) or by a `Dynamic/Switch/Button/One-Time` that a `Trigger/Start Up Trigger` drops on one of several `Generic Marker`s (`Marker Tag`, `Number` 1) | 370 (both) |
| Secret room | what the switch gate hides: two or three `Dynamic/Block/Treasure/Normal`/`Rare` and crown piles (`Trigger/Start Up Trigger (Generic)` with a `TableSpawn` of `Treasure/Crowns/Scaled Crown`) | 376 (crown `TableSpawn` rewards) |
| Block wall | a straight three-wide corridor section on the path filled two deep with the tileset's breakable block (`Dynamic/Block/Breakable/Sky Islands, Day`, `.../Clockworks, base`...) or `Dynamic/Block/Crystal/Random/*` | 370 (crystal walls), 374 |
| Spike run | `Dynamic/Traps and Hazards/Floor/Spikes` spawned at start-up (`Trigger/Start Up Trigger (Generic)` with a `SpawnActor`, the arguments of tile.dat's `Traps and Hazards/Floor/Spike/3x3`: cycle A or B, `spikes_3x3.dat`, size 3x3) plus the plate model (`Model Tester` with `tile_3x3.dat`) | tile.dat's trap tiles spawn the same actor from a Startup handler |
| Turrets | two Gun Puppy spawners (`Monster/Class {stc}/Family/Construct/Gun Puppy/Gun Puppy`) in a path room's corners, in that room's wave | Construct turret role |
| Minerals | `Dynamic/Block/Mineral/Class {tb}/Generic Mineral` against walls | 370, 374, 376 |
| Danger room | a dead end with an open `Iron Gate/Trigger 3`; a Party Platform in its middle closes the gate, starts battle music (`Environment/Music`, the arguments of 370's platform) and wakes wave 0; each `Trigger/Actor Removed` wakes the next of four escalating waves (Grunt; Grunt+Brute; Support+Brute+Grunt; Elite+Brute, depth offset rising); the last ends the music, opens the gate and fires the reward (`Trigger/One Time Action`s: three `Block/Treasure, Rare` and four crown piles) | 370, 376 (platform, wave chain, music) |
| Arena hall | the biggest room; `Iron Gate/Monster 5` on its mouths close from a `Player Enter/Spawn Activate` area; five escalating waves (the danger chain plus Mini+Elite), then the gates open and the reward appears | 376 (Monster 5 gates, three-wave chain) |
| Treasure vault | no spawners or encounters; every room holds `Dynamic/Block/Treasure/Vault - No Baby` and `Rare` boxes, `Dynamic/Block/Breakable/Random/Prize Vault - 100%, no-ghost` and crown piles; dead ends sit behind `Dynamic/Door/Vault/Trigger 3` doors opened by platforms | the game's prize-vault configs |
| Decoration | per tileset: blocking props against room walls (away from mouths and the elevator pads), breakables, lamps, floor litter, a little corridor litter; the stratum family adds its lairs and litter (Beast dens and nests, Undead bones and ground fog, Fiend sigils, Slime globs, Gremlin tools, Construct bolts); a `Lights/Point Light` per room | 330, 349 (lamps, pipes, rubble, grass), 370/374/376 (trees, stumps, logs, shrubs, statues) |

Palettes: Sky Islands (Day, Night, Autumn, Winter), Clockworks, Castle, Graveyard, Prize Vault
and a generic one, chosen from the generator theme key. Blocking pieces were classified from
`config/placeable.dat` (collision flags non-zero) with a one-off survey.

## Guarantees

- Every shut gate is placed only once its opener is (platform cell or button markers found).
- Puzzle gates take the mouth from the Monster gate `arenaRooms` put there; rooms given a role
  lose the encounter and arena wiring `arenaRooms` gave them.
- Flood fills: the exit is reachable from the start with every puzzle solved (gates open,
  breakables broken) and permanent decoration in place; each key is reachable with its gate
  shut. If decoration ever cut the way, every blocking piece is dropped again.
- `tests/features.test.ts` runs these checks over 160 generated floors.

## Special floors in a gate

`gateFloors` (src/game/clockworks.ts): each stratum has a 60% chance (`SPECIAL_CHANCE`) that one
of its level floors (never its first) is special: 30% a Treasure Vault (painted with the
`prize-vault` tileset), 35% a floor with a Danger Room, 35% an Arena. The pick is seeded by the
gate, so a gate's lineup is stable. The game's gate lineups are server-side, so the odds are ours.

## Engine changes they needed

- Floor traps (`DungeonActorConfig$Trap`): a `trap` prop kind cycling retracted, warning and
  extended (cycle B half a period behind A; timings ours) and striking a knight on the plate
  while extended with the first tier of `Traps and Hazards/Trap, floor`'s damage.
- Party platforms answer to knights only and stay down once pressed (as the game's do).
- A condition left implicit by the export with only `probability` set (a vault box's
  "Mimic Chance") is a Random condition; before, every vault box released a Baby Mimic.

## Dungeon objects (src/game/objects.ts)

Their behaviour is closed code; it is written from the configs and the wiki's Exploration page:

| Object | Config | Behaviour here |
|---|---|---|
| Crystal blocks | `StarlinkBlock`, `UnbreakableStarlinkBlock` | a hit breaks a crystal and every crystal of its colour touching it (four ways, chained), unbreakable ones included; unbreakable ones ignore hits |
| Ghost blocks | `GhostlinkBlock` | breakable; the chain of blocks touching it (unbreakable, stone, treasure; not prisms or explosives) fades with it, as scene 370 walls its buttons |
| Explosive blocks | `TimedBlock` (`fuse` 100 ms, Timed 4 s with its countdown state) | a hit lights the fuse; the detonationAction (`Block/Explosive Block - Explosion`, a DamageRegion) strikes the knight, monsters and blocks within 1.5 cells (ours); explosives in the blast light in turn |
| Prism puzzles | emitter `Switch`, `PrismBlock`, `PrismLaser` length 10 | hits (or signals for the Door/Signal emitters) switch emitters; beams run on the grid; a prism takes a beam at a receptor face facing back along it and sends it out of its other face (L bend) or straight on (passthrough); hits run the damageAction (a quarter turn); receivers (face-less receptor) run their On/Off Actions |
| Gun blocks | `Switch` with a Damage mask (3; "Self" 1) | struck while ready, fire a Gun Block Bullet along their facing, then reload for their Cooldown; hazard bullets strike knight, monsters and blocks, so "Self" blocks chain |
| Rocket and fire blocks | `Trap` with a TrapState handler | the trap cycle (three Intervals) runs the handler as it fires: rockets or flames; "off"/"on" signals switch them |
| Floor traps | `Trap` | fire, freeze, poison and shock plates strike with the floor's tier of `Traps and Hazards/Trap, floor` (its status infliction included) |
| Healing totems | `Block`, WarnTimer → effect `Healing, pulse` | three hits break one; each pulse heals monsters within 6 cells (DepthScaleHeal, at most a tenth of their health) |
| Heal pads | Timer with a lost Heal action | heal a knight standing on them by their Health (40/80/120 of the game's 400) every Interval |
| Mortar shells, barricades, shrubs | actors with a Damage handler and a destruction transient | a hit runs the handler and destroys them (a shell becomes its stage 3, which blows up after 1.5 s: effect `Mortar shell explosion`; a barricade becomes its weakened stage) |
| Prisoner cages | `DumbSwitch`, three states | three hits; the prisoner (spawned by the cage placeable's table) is destroyed and its own Shutdown handler spawns the freed Immortal Sword Knight |
| Companions, energy turrets | `Character/NPC/Companions/...`, `Energy-Consuming Objects/...` | allies: they fight the nearest monster, else follow the knight; immortal (the game's rest and recover) |
| Energy gates, crates | `UseEnergy`, `ActionDesc$Energy` | energy is not modelled: 50 crowns a point (floor crowns first, then the bank) |

Generated floors use crystal gates, explosive walls, status trap runs, prism gates, rescue cages,
healing totems (danger rooms, arena halls), gun blocks and explosive blocks against room walls.

## Not done

- FLAG: the prism puzzle's models (`world/dynamic/prism_puzzle`) are missing from the install:
  emitters show as gun blocks, prisms as echo blocks, receivers as unbreakable crystals, beams
  as the Roarmulus twins' beam in one-unit pieces. A stand-in prism does not show its facing.
  Pushing prisms is not in the data and not done.
- FLAG: the rescue camp itself (`Character/NPC/Rescue Camp/...` townsfolk, mission dialogue) is
  mission content from message bundles and server data; only the cages are used.
- FLAG: lockboxes are items (`ItemConfig$Lockbox` with a spawn table) opened with keys bought
  for money; they are not opened here.
- FLAG: numbers the data lacks are ours: blast radius, totem heal cap, gun block bullet offset,
  energy price, the fuse actor delay, ally immortality.
- Ghost blocks fade their chain; the task's "phase in and out" is not what the data or the wiki
  describe.
- Point and spot lights: the entries are emitted, but the renderer has directional lights only.
