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

## Not done

- Rescue camps: the prisoner cage (`Dynamic/Rescue/Prisoner Cage/Knight (armed)`) is a
  DumbSwitch whose release and the companion knights' AI are closed code.
- Point and spot lights: the entries are emitted, but the renderer has directional lights only.
- Ghost/Starlink blocks, prism puzzles, explosive timed blocks and healing totems are not used:
  their behaviour (link toggling, beam tracing, fuses, monster healing) is closed code not yet
  modelled in `world.ts`.
