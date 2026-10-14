# The prefab generator: how the servers build Clockworks floors, and how we rebuild them

The game's servers lay out most Clockworks floors (the Clockwork Tunnels and their status
areas, Candlestick Keeps, Wolver Dens, Graveyards, Devilish Drudgery, Lichenous Lairs,
Compounds, Battle Arenas, Deconstruction Zones) when a party enters them, from **prefabs**:
rooms built in the level editor and stored as layers of prefab scene files. The server code is
not in the client, but its data side is, and the floors it sends are cached by the client, so
the method can be read off both. This page is what we found and what `src/gen/prefabs.ts` and
`src/gen/assemble.ts` do with it. No client code or game data is in the repository; the rooms
are cut out of the player's own archive at run time.

## What the client has

| Class | What it tells us |
|---|---|
| `dungeon/server/random/Prefab` | A prefab is `filename:layer` (a layer of a prefab scene file) with a `type` (ENVIRONMENT, MUSIC, ROOM, HALL, TRANSITION, AIRLOCK, FRAME, VOID, ARENA, BARRACK, GUILDHALL_GLOBAL, ISLAND, OVERLAY), depth range (`minDepth`, `maxDepth`, tiers 0-7, 8-17, 18+), `bounds` (a box), enabled servers, event and event variable, `attributes`, `rarity` (its weight in the random pick), `tags` (a multiset) and `exclusiveTags`, `connections`, `treasureCount`, `monsterCount`, a `missionTag` and editor warnings |
| `Prefab.Attribute` | HAS_ENTRANCE, HAS_EXIT, HAS_GOLD_KEY, HAS_GOLD_DOOR, HAS_ENERGY_DOOR, BATTLE_EVENT, TRIVIAL, HAS_TRAPS, HAS_MINERALS, NO_TRANSITION, PvP team/size flags, TORTODRONE_GLYPHS |
| `Prefab.Connection` | `type`, `location` (a point on the bounds), `orientation` (0-3, printed as `"SENW".charAt(orientation)`: 0 south, 1 east, 2 north, 3 west) and `width` (in cells; printed as a digit, or a character past 9) |
| `Prefab.Connection.Type` | LINK (both ways), ENTRANCE (forced entrance), EXIT (forced exit), BRANCH (forced branch), DISCONNECTED (a link left unjoined) |
| `dungeon/config/RandomLayoutConfig` | A layout is a `path`: a list of `Room`s, each with `specs` (predicates a prefab must pass) and `branches` (nested rooms or layout references off it). Specs: `RequireTagsSpec` (the prefab has every tag), `HasAttributesSpec` (has every attribute), `MonsterSpec` (`minMonsters` 0 to `maxMonsters` 10 spawners), `EntranceDirectionSpec` (default SOUTH; passes when the ENTRANCE, else some LINK, has orientation 0). `LayoutReference` nests another layout |
| `server/random/a` | The random pick among candidates weighs each prefab by its rarity's weight |
| `DamageTraps`, `StatusTraps` | A floor's traps: INACTIVE, RANDOM or SPIKE; INACTIVE, RANDOM, FIRE, FREEZE, SHOCK, POISON (RANDOM picks one of the others) |
| `config/PrefabMissionTag` | A mission's prefab goes in at a `location`: DEFAULT, POST_AIRLOCK, PRE_EXIT or REPLACE |
| `config/DungeonSceneGlobalConfig` | The prefab file's scene global (`PrefabData`: servers, rarity, depths, `trivial`, `noTransition`, exclusive tags, mission tag, event) and each layer's (`PrefabLayerData`, overriding them) |
| `admin/client/PrefabTester` | Prototypes (layouts) are named by dungeon level keys (it looks up `m.<proto>` in the dungeon bundle: `ct_beast`, `candlestick_keep_fire`...); each has a list of prefab files and a dev list; a floor can be tested at a depth with one prefab forced in |
| `admin/client/SceneSaver` | Saves the current floor, by default stripping its `Dev/Label - Prefab` entries: the server leaves one in each generated floor for every prefab it placed |
| `dungeon/tools/PrefabTableModel` | The prefab browser's columns: name, layer, servers, type, rarity, attributes, tags, exclusive tags, mission tag, monster and treasure counts, depths, links (`S3↔`, `E5↑`...), bounds |

The layouts themselves (the RandomLayoutConfig instances), the prefab files and the code that
joins them are server side: `config/` has no random layout library, and no prefab scene ships.

## What the captured floors show

The player's archive holds 62 floors the servers generated (scene ids from 1073741824 up), 53
of them prefab floors of the styles above (the rest are mission set pieces). In each:

- **Labels.** Every placed prefab has a `Dev/Label - Prefab` (a `DebugMarker`, invisible in
  play) whose `Text` is `filename:layer` ("room_general_EW_5w_03:4"; layer 0 is left out). It
  stands at the prefab's placement point; its z is the elevation the prefab was placed at (the
  server raises or lowers whole prefabs: -2.5, 0, 2.5 units are common, and the floor's tiles
  carry the same offset).
- **Names.** The file names give the room's role and its openings: `elevator_start_<sides>_<w>`,
  `room_<role>_<sides>_<widths>_<nn>` (roles: general, trivial, treasure, mineral, special,
  goldkey, golddoor, danger, reward, battle...), `airlock_<sides>_<w>`,
  `elevator_next_<sides>_<w>`. Sides are N, S, E, W in any order ("SN" and "NS" both occur);
  widths are 3 or 5 cells ("3w_5w" when the openings differ). The label's placement point
  sits inside the room near the opening the path came in by.
- **Tags.** The server renumbers every prefab's tags with its placement number: a prefab's
  "(auto) spawn 1" becomes "3_auto_spawn 1", its doors "10_auto_door 2". Entries sharing a
  number are one prefab's.
- **Spawns.** Rooms carry `Trigger/Master Signal Trigger`s (a spawn table and a Number of
  monsters to put at the `Character/Monster/Generic/Subset Spawn` markers of their tag),
  `Class Spawn`s (one monster of a class) and `Player Enter/Spawn Activate` areas that signal
  them. The server has already filled in the tables: the stratum's family for the masters
  (Jelly Cubes and Lichens on a Slimeway), other families' support and turret classes for the
  class spawns (a Mender, a Polyp, an Alpha Wolver), drones (Shankles) on their own.
- **Shape.** A floor is a path: start elevator, two or three rooms, an airlock, two or three
  rooms, exit elevator; every room's other openings lead to dead ends (treasure rooms, mineral
  rooms, trivial nooks). Prefabs meet in corridors, where their openings line up; the
  openings never turn (a prefab is placed as built).
- **Not prefab-built in the same way:** Deconstruction Zones are a grid of 15-wide fields
  framed by `frame_*` prefabs; Battle Arenas are a fixed chain (battle room, stairs, three
  times, then the elevator options); Compounds mix `room_wilds_*` with `trans_*` transitions.

## Cutting the rooms out (`src/gen/prefabs.ts`)

1. The floor's walkable cells (tile.dat: floor flag, no collision) split into **corridors** —
   cells whose cross-section is at most six cells (or the widest width the floor's names give
   plus two: Devilish Drudgery's "5w" openings are seven cells between their posts) and the
   same one cell either way along the corridor — and **rooms**, the connected rest.
2. Each label starts a region at the node nearest it; regions grow over the node graph.
3. A local search moves rooms and corridors between neighbouring regions (with whatever of the
   region hangs off them) to lower a cost: sides the name gives but the region does not open
   on, openings the name does not give, openings of widths the name does not give, regions
   meeting room to room instead of in a corridor, and tag numbers split between regions or
   mixed in one. Several starts (even growth, dead ends and elevators slowed, shuffled paces)
   keep the best.
4. A corridor between two regions is cut where its floor elevation steps (the two prefabs'
   placements), else at its middle. Walls and edges go with the nearest floor; entries go with
   their tag number's region, else with the region they stand in.

Of the 809 labelled prefabs in the archive, 497 come out opening exactly as their names say
(most of the rest are frames, fields, arena stairs and compound wilds, which are not joined at
corridors). The generator uses only those (one opening a side, three cells to the name's width
plus two), and
leaves out mission set pieces, gold key and door rooms, danger and reward rooms, fields, frames,
arenas, mazes, stairs and transitions.

## Assembling a floor (`src/gen/assemble.ts`)

The rooms of a style and status (the status's captured floors first, then the style's others)
make a library: starts, exits, airlocks, rooms (two or more openings) and dead ends (one). A
floor follows the path the captures show: start, two or three rooms, airlock (when the library
has one), two or three rooms, exit. Each next piece joins the last one's free opening with an
opening of the same width on the opposite side; it must not overlap anything placed, its floor
must not touch other floor except at the joint, and its other openings need room beyond them.
Then every opening still free is closed with a dead end. Forty seeded tries, else null.

The floor keeps everything the rooms carry: their tiles (with the placement's elevation taken
off, so the floor is level), elevators, doors, spawners and areas, treasure, minerals, traps,
props, renumbered tags. Its lighting, fog, sky and music are the globals of the floor its start
room came from. On a family stratum the masters' tables become the stratum's (`rethemeMasters`
in src/main.ts); class spawns and drones stay as captured.

## Where it is used

`floorScene` (src/main.ts): a gate floor is the game's own level whenever the archive has one
(src/game/archive.ts); otherwise a style with captured prefab floors gets
`gen:pf-<style>-<status>:<seed>`, assembled here; when that fails, or for styles with no
captures (and treasure vaults, danger-room and arena floors), the older rooms-and-corridors
generator with learned tiling paints it.

## Not done, and guesses

- The real path specs (how many rooms, which tags and attributes, where the branches go, the
  monster counts) are in the server's RandomLayoutConfigs. Ours are read off the captures.
- Rarity, depth ranges and exclusive tags are prefab file globals we never see; every room cut
  out is equally likely, at any depth.
- Gold key and door pairs, danger rooms with their reward rooms, and mission tags
  (POST_AIRLOCK, PRE_EXIT, REPLACE) are not placed.
- Traps are as captured: the floor's DamageTraps and StatusTraps choice is already applied.
- The cut is a reconstruction: where two prefabs meet inside a corridor of one elevation, the
  split is our guess (the middle). Openings must match exactly in width.
- Layouts that are not corridor-joined (Deconstruction Zone fields, Compounds, Battle Arenas)
  are not cut; those styles fall back to the older generator.
- A status with too few captured floors borrows the style's other statuses' rooms as they are
  (a Candlestick Keep of shock may get a frozen room); their tiles are not repainted.

## Measured

With the archive of 2026-10-13: tunnels 30 of 30 seeds assemble (178 pieces from 27 captured floors),
Candlestick Keep 20 of 20 (5 floors), Graveyard, Wolver Den, Lichenous Lair and Devilish
Drudgery 10 of 10 each. `tests/prefabs.test.ts` checks the cut and the assembly on a synthetic
floor.
