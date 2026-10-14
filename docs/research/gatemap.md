# The real gates and the Gate Map

The Arcade's gates are made by the game's servers: a new one every two days at 22:00
America/Chicago, four open at once. The community Gate Map, https://gatemap.knightlauncher.com/
(silverhawke's open-source gatemap-viewer, kept up by lucasluqui), records each gate from the
game and publishes it. This port plays those gates. No gate data is in the repository.

## Where the data comes from

| What | Where |
|---|---|
| Gate list | `/gate/gate_list.txt`: JSON list of `[date "YYYYMMDD", colour, symbol]`, every gate since May 2019 (1,076 by October 2026) |
| Gate file | `/gate/data/<date>_<colour>_<symbol>.txt`: `##JSON`, then `{levels, themes, rotations}` |
| `levels` | one line a non-fixed depth (23 lines: depths 1-3, 5-7, 9-12, 14-17, 19-22, 24-28), level codes separated by commas, led by `r`/`l` (rotation direction) or `rand`/`rand_x`/`rand_<status>` (randomised); a line without a direction takes the opposite of the line before; older files use keywords for whole sets (`jv_ax`, `sf_2d`, `s_gww`...) |
| `themes` | the six strata's themes (`Beast`, `Poison`...) |
| `rotations` | one a depth 0-29: `n` levels and `data` `{velocity, num_entries, lengths, start}` (radians a second, wedge lengths in radians, epoch ms), `data: null` at a randomised depth |

The site sends no CORS headers, so `server/gates.ts` fetches for the browser (`/__sk/gates/list`,
`/__sk/gates/data/<name>.txt`) and caches in `%LOCALAPPDATA%\clyde-web\gates` (or `SK_GATES`)
beside the level archive: the list is refetched after 30 minutes, gate files are kept for good.
Offline, the cache serves; with neither, the Arcade falls back to generated gates
(`clockworks.ts arcadeGates`). The folder-input mode has no server, so it always generates.

A gate with date D opens at 22:00 Chicago time on D-1 (the site's own comment). The four newest
opened gates are the active ones.

## Level codes (`src/game/gatemap.ts decodeLevel`)

| Code | Level key | Icon |
|---|---|---|
| `tunnel <family> <status>` | `ct_`, `bf_`, `cc_`, `ww_`, `pc_` + family (`x` is no status) | clockwork |
| `arena <family> <status>` | `iea_`, `fla_`, `ima_`, `vfa_`, `tfa_` + family | shield |
| `compound <family> <status> <minis>` | `rc_`, `cc_`, `fc_`, `bc_`, `sc_` + `<minis>_minis` | compound_critter (beast), _glopdrop (slime), _scarab (undead) |
| `csk`, `decon`, `den`, `lichen`, `dd` + status | `<set>_<status or vanilla>` | pawn, decon, monsters, monsters, monsters |
| `graveyard`, `tv`, `pv <status>` | `graveyard_vanilla`, `treasure_vault_1`, `tvault_<status>` | graveyard, treasure |
| `aurora`, `jigsaw`, `starlight`, `concrete`, `darkcity`, `scarlet` + level | the set's level keys (`scarlet gg` is `scarlet_fortress_grim_gallery`, the rest `lost_castle_`) | island, island, island, city, city, castle |
| `*_boss` | `<set>_miniboss` | miniboss |
| `gww`, `rjp`, `imf`, `fsc` + `d1`... | the boss strata's stages | woods, castle, munitions, castle |
| `snarb`, `jk`, `rt`, `vana` | the boss levels | boss |

The icons per code were matched against the icons the site captured from the game. A
randomised depth (`rand, X`) offers the Graveyard, its listed levels and a vault: the Treasure
Trove for `rand`, a Treasure Vault of that status for `rand_<status>`.

## Colours

The map icons (`ui/icon/map`) mark two zones in pure hues, a red field and a magenta glyph. The
gate map's icon style (`ui/adventureboard/parts/map_levelicon.dat`, style `Icon`) colours them
with `CustomOffsets` of colour class 3 (`item_2`, red: "Color (Back)") and class 2 (`item_1`,
magenta: "Color (Icon)"). The colour pository has the theme colours as classes 9
(`theme-status`: none, fire, freeze, poison, shock) and 8 (`theme-family`: none and the six
families); their offsets colour a level's field by its status and its glyph by its family. The
fixed sets, boss strata, towns, the Treasure Trove and the thirteen gate colours have colours
of their own, server data; their offsets were read off icons the game drew (the site's
captures): fixed sets use a dark field (value -0.671) and a pale glyph (saturation -0.591, value
-0.376) at a hue each. A gate's emblem is its symbol (`ui/icon/gate/<symbol>.png`) in its
colour's field and device offsets.

## Rotation (the client's `dungeon/data/GateSummary`, `dungeon/util/o`)

- A depth is a `Wheel` of `Wedge`s. `Constant` wheels turn: the angle at time t is
  `normalize(((t - start) mod trunc(6283.1855 / |v|)) * v / 1000)`, zero below 1e-6.
  `Random` wheels stand still and pick at random.
- `f(i, t)`: wedge i's centre in the world (angle plus the wedge's centre; zero on a random
  wheel). `a(x, t)`: the wedge of a wheel under world angle x (x minus the angle, then walk the
  lengths).
- The next level: the next wheel's wedge under this depth's wedge's centre
  (`u.d.Cl`: `wheels[d+1].a(wheels[d].f(wedge, now), now)`). It changes when the two wheels
  have turned a wedge against each other: with these velocities every 1:45 to 20 minutes.
- The level is decided when the party takes the elevator (`lockNext`).
- Checked against the site at the same instant: the predicted path over all 30 depths matched
  (October 2026).

## The map (`dungeon/client/u`, `client/h`)

- `u` fills `ui/adventureboard/parts/map_global_v2.dat` (the strata backdrops, the ruler) with
  rows: the source town (Haven), then one row a wheel (`skip` empty rows first), each wedge a
  `map_levelicon.dat` with its colourised icon and tooltip (`parts/tooltip.dat`, name with `|`
  as a line break).
- A row with two or more wedges gets a spacer (17x34, `images/mapicons/spacer_<random, left or
  right>.png` by the wheel's type and velocity sign) before, between and after its icons.
- Each tick the rows turn with their wheels (`Pg`): the wedge at the top of the wheel (between
  two for an even count) goes to the middle.
- Lines (`h.a`): from 3 px above an icon's bottom down to the middle of the gap, across, down to
  3 px into the next icon, 3 px wide. Dark red (0.64, 0.11, 0) for the path taken, pale red
  (0.82, 0.55, 0.5) from the party's floor to the level the elevator leads to (to every level
  of a randomised depth). Icons on the path get `border_selected.png`; the party's floor shows
  "you are here".
- Our board adds, like the site, the predicted path to the bottom (pale), a stratum totem
  (theme icons, click to scroll) and a rotation timer, drawn on the canvas.

## Mapping to our floors (`src/main.ts realFloorScene`)

1. The game's level from the archive: `LevelArchive.copies(key)`, its newest fixed revision or
   any captured instance of it (each captured Wild Path is one).
2. Else a floor assembled from the captured prefab rooms of its style and status.
3. Else the older generator with the style's tiles, status and family; bosses get their arena.
