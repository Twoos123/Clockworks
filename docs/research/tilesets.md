# Tilesets for generated floors

Generated floors (`gen:<theme>:<seed>`, src/gen) can use every tileset in `config/tile.dat`
whose models ship with the client. `tools/tile-themes.ts` lists the tile configs by theme
prefix with each tile's footprint and walkability (floor flag set and no collision flags, the
test `SceneLoader.tileInfo` and `CollisionMap.addTile` use):

    npx tsx tools/tile-themes.ts                 # every theme
    npx tsx tools/tile-themes.ts graveyard       # one theme
    npx tsx tools/tile-themes.ts --json out.json

The game's brush libraries (`config/ground.dat`, `config/wall.dat`) ship empty, so each theme
gets its tiling one of three ways (`src/gen/themes.ts`, `THEMES`):

- **learned**: from the cached levels that use the tileset (`learn` in src/gen/autotile.ts:
  which tile, rotation and elevation sit in which 8-neighbourhood of floor/other/void).
- **mirror**: another theme's learned model with every tile swapped for the target tileset's
  piece with the same path suffix (`remapName`/`remapModel`). Where the suffix is missing,
  the nearest-named target tile of the same walkability and a 1x1 footprint stands in (same
  folder first, then shared words, then leading characters); `alias` rules rewrite suffixes
  where two tilesets name the same piece differently. Tiles of other tilesets in the source
  levels (a few Castle or Sky Islands pieces in Terminal 1) are kept as they are.
- **rules**: no cached level and no close relative. A `RuleSpec` picks pieces by name
  (floor, straight wall or edge, inner and outer corners, pieces named by their side) and
  `ruleModel` (src/gen/rules.ts) fills every neighbourhood with the piece the rules choose,
  using the conventions the learned tilesets show: a straight piece at rotation 0 has the
  floor to its north and each quarter turn moves that side counter-clockwise (N, W, S, E); an
  outer corner at rotation 0 has the floor to its northwest; an inner corner at rotation 0
  has floor north and west. The floor is ringed one cell deep, so it is walkable inside and
  blocked at the edges (the browser check floods the walkable cells from the start and
  reaches all of them for every theme).

Lighting, fog, sky and music start from a cached level's GlobalEntry records (`globalsFrom`)
with `config/scene_global.dat` presets swapped in: each preset replaces the source globals of
its kind (camera, sky, music, light, fog, background; `mergeGlobals`), extras (embers, snow,
rain, lightning) are added. `themeLevel(key, ctx)` returns the model, the source levels (for
spawners, treasure and elevators; the cached combat levels fill in) and the globals:
everything `generateLevel` needs.

## Themes

| key | tileset (rsrc/world/tileset) | source | globals |
| --- | --- | --- | --- |
| valley | Sky Islands, Day (sky islands day) | learned: Jigsaw Valley 370/374/376 | Jigsaw Valley |
| sky-night | Sky Islands, Night | mirror of valley (same suffixes) | Jigsaw Valley + Lichenous Lair fog, light set, night skydome, music; dark background |
| sky-autumn | Sky Islands, Autumn | mirror of valley | Jigsaw Valley + Wolver's Den Default |
| sky-winter | Sky Islands, Winter | mirror of valley | Jigsaw Valley + Wolver's Den Freeze, freeze music, vision snow |
| clockworks | Clockworks | learned: Terminal 1, Emberlight, Terminal Core (330/349/328) | Clockworks source level |
| clockworks-fire/-freeze/-poison/-shock | Clockworks Fire/... | mirror of clockworks (same suffixes) | Clockwork Tunnels/<Status> presets + Universal/<Status> music and effects |
| clockworks-white | Clockworks White | mirror of clockworks | Guild Hall/White presets |
| prize-vault | Prize Vault | mirror of clockworks (Prize Vault reuses the Clockworks names; missing catwalk pieces fall back to nearest names) | Guild Hall/Default presets |
| castle-light | Castle, Light | learned: Dark Halls lobby and finale (27913, 28074): Castle, Light walls and rails on Water/Ice/Walkable floor | Dark Halls |
| castle | Castle (castle_base) | mirror of castle-light; `Rail/` becomes `Floor Edge/`, ice becomes Cobblestone | Dark Halls + Castle skydome |
| castle-fire | Castle, Fire | mirror of castle-light, as castle | Dark Halls + fire music and embers |
| graveyard | Graveyard | mirror of castle-light, as castle; ice becomes Grass | Dark Halls + Graveyard camera, fog, light set, music; dark background |
| haven | Haven (outershell) | learned: Haven town square and bazaar; Null, roof, cube and trim floors scrubbed to the commonest floor | Haven town square |
| city | City, Base (city_base) | rules: sidewalk floor, "Edge break" edges and corners | Clockworks + Battle Arena Default |
| whitespace | Whitespace | rules: floor tiles, "Rail/Featureless" edges, rail corners | Clockworks + Guild Hall/White fog and light set; pale background |
| ice | Water (water) | rules: Ice/Walkable floor, side-named ice edges and corners ("edge N", "out SW", "in NE") | Dark Halls + Heart of Ice fog and light set, freeze music, vision snow |
| dev | 000_Dev (dev) | rules: gray floor, volumetric walls and corners; left out of runs | Clockworks |
| generic | Generic (generic) | rules: plank floor, Haven whitewash walls (turned a quarter), invisible blockers on the near side; left out of runs | Haven town square |

The learned and mirrored themes need their source levels in the scenes cache
(`themeAvailable`); rule-based ones only need the install. Past the end of a run the
elevator picks a random available theme.

Screenshots of each theme (overview and in play) are made with a Playwright script against the
dev server: `selectScene("gen:<key>:<seed>")`, then `startPlaying()` and walking.

## Gaps

- **Water Temple** (Water Temple, Fire/Freeze/Poison/Shock in tile.dat) has configs but its
  models (world/tileset/water_temple*) are not in the install, so there is no theme.
- **prism_track** has a model folder but no tile configs; it is not a tileset.
- **Traps and Hazards**, **Ancient Altar**, **Moorcroft**, **000_Connectors** are props and
  markers rather than floor sets; the learned themes reuse the trap tiles their sources place.
- Mirrors copy the source level's layout habits: Prize Vault looks like the Clockworks; the
  castles and Graveyard have the Dark Halls' wall-and-rail rings rather than their own
  set pieces (arches, stairs, rugs, fences are never placed; only single-cell tiles are
  painted).
- Rule-based themes have one ring of edge pieces and no decoration. City uses only its
  sidewalk edges (no highrises or rowhouses), Whitespace only rails, Generic's tall walls are
  rough. The rotation conventions came from the learned sets; a tileset that turns its
  pieces differently needs `wallRot`, `cornerInRot` or `cornerOutRot` in its spec.
- Lighting for themes with no cached level is borrowed from scene_global.dat presets named for
  other places (Lichenous Lair for the night islands, Wolver's Den for autumn and winter,
  Battle Arena for the city, Heart of Ice for the frozen pools): plausible, not authentic.
  Horizon-fog skyboxes ("Skybox - Fog") are left out because the viewer draws them opaque.
- Clockworks variants with dense fog look solid brown in the viewer's far overview camera;
  in play (camera at the game's distance) they look right.
