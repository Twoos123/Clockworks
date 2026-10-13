# Music: what the install has and where it plays

Measured against the Steam install of 2026-10-07. The table lives in `src/game/music.ts`; the
player that follows the game (`src/game/musicplayer.ts`) asks it for a track whenever a floor
starts. `tests/music.test.ts` checks that every floor of every gate gets a track, that every file
the table names is in the install, and that every track in the install is placed somewhere.

## Where the music is

- **Files.** `rsrc/sound/music/*.ogg`, 70 files on disk. `rsrc/full-music-bundle.jar` holds 61
  of them (the disk has nine more: `battle_1`, `comlink`, `crash_site`, `fanfare_failure_1`,
  `fanfare_pvp_win`, `fanfare_victory_1`, `main_theme`, `prologue_audio_only`, `title`). The
  app's file system reads both.
- **Scene globals** (`config/scene_global.dat`). Scenes pick music with two globals:
  - `Environment/Music`: one file and a gain (`world/environment/global_music.dat`, a looping
    Stream).
  - `Environment/Music Mix`: weighted files, a gain and a cross-fade
    (`world/environment/global_music_mix.dat`, the sounder `Meta Stream/Default (Gain)`). A Meta
    Stream plays a weighted pick through, then another, cross-fading over `Cross Fade` seconds.
    `AudioSystem.playMix` plays it the same way.
- **Named music globals** in the same file:
  - per level style: `Environment/Custom/<Style>/Music Mix`;
  - per monster family: `Music/Monster Family/<Family>`;
  - per element: `Music/Status/<Element>` and `Environment/Custom/Universal/<Element>/Music (<Element>)`.
- **Sounders** (`config/sounder.dat`): `Custom/Mission/Comlink` and `Comlink (urgent)` are
  streams pushed over the music (Stack, Override).
- **Others:**
  - `ui/mission/parts/part_missioncomplete.dat` plays `fanfare_pvp_win` as a sound.
  - The Mimic's actor plays `fanfare_victory_1` and `battle_2`.
  - `config/placeable.dat` plays `fanfare_pvp_lose`.
  - The Swarm model (`character/npc/monster/swarm/model.dat`) plays `whitespace_ambient` and
    `whitespace_swarm`.
  - The ready room (`world/readyroom/scene.dat`) plays `mission_ui`.

## The cached scenes' own music

| Scene | Global | Music |
|---|---|---|
| haven town square, haven bazaar | Environment/Music | `haven_haunted` (0.25): the cache was taken during the Halloween event |
| hall (guild) | Clockwork Tunnels/Default/Music Mix | `clockwork_ambient` ×1.75, `clockwork_ambient_2` ×1.75, `clockwork_action` |
| dark halls lobby | Environment/Music | `apocrea` (0.6) |
| dark halls finale | Environment/Music | `somber` (0.45) |
| mission lobby | Environment/Music | `mission_lobby` (0.5) |
| terminal 1 | Music Mix | `title` (0.45) |
| terminal core | (none) | |
| emberlight | Environment/Music | `subtown_1` (0.45) |
| jigsaw valley (three levels) | Music Mix, cross-fade 1 | `sky_islands_day_ambient`, `sky_islands_day_action` (0.25) |

## The mapping

Gate floors always use the table. Generated floors copy their source scene's globals, and the
cached scenes stand in for places they are not, such as the Dark Halls lobby standing in for
Moorcroft Manor. Other scenes (Haven, the guild hall, the old run plan) play their own music
global, falling back to the table by scene name. "Data" means a scene global or cached scene
names the pairing; "ours" means the pairing is chosen by the file's name.

| Place | Track | Source |
|---|---|---|
| Title screen | `main_theme` | ours |
| Haven | the scene's own (`haven_haunted` now); `haven` by default, `haven_winter` in winter | data |
| Arcade (depth 0) | `haven` | data (Haven default) |
| Clockwork Terminal (4, 13, 23) | `title` | data (terminal 1) |
| Terminal above the Core (29) | `title` | ours: the cached Core names no music |
| Moorcroft Manor (8), Emberlight (18) | `subtown_1` | data (Emberlight); Moorcroft is not cached and shares it |
| Guild hall | the scene's own (Clockwork Tunnels mix) | data |
| Hall of Heroes | `hall_heroes` | ours |
| Arena | `clockwork_action` | data (Battle Arena/Default/Music Mix; gain 0.15 raised to 0.3) |
| Arena boss waves (every tenth) | `boss_1` or `boss_2` | ours |
| Danger rooms | `battle_1` or `battle_2` | ours |
| Treasure vaults | `treasure_vault` | ours |
| Mission lobby, ready room | `mission_lobby`, `mission_ui` | data |
| ComLink missions | `comlink` (`comlink_urgent`, `comlink_somber`) | data (sounder, scene global) |
| Swarm | `whitespace_ambient`, `whitespace_swarm` | data (Swarm model) |
| Intro | `prologue_audio_only` | ours |

### Level styles (a stratum's floors)

Element strata (Fire, Freeze, Poison, Shock) play their element's track in any style. This is
`Environment/Custom/Universal/<Element>/Music`, which the Clockwork Tunnels element mixes
derive from:

- `fire` 0.45;
- `freeze` 0.45;
- `poison` 0.45;
- `shock` 0.75.

Family strata play their style's music:

| Style (clockworks.ts) | Track | Source |
|---|---|---|
| Clockwork Tunnels | `clockwork_ambient` ×1.75, `clockwork_ambient_2` ×1.75, `clockwork_action` | data (Clockwork Tunnels/Default) |
| Clockwork Tunnels, Undead stratum | `undead` 0.6 | data (Clockwork Tunnels/Spooky) |
| Clockwork Tunnels, Fiend stratum | `fiend` 0.4 | data (Devilish Drudgery) |
| Jigsaw Valley (sky islands) | `sky_islands_day_ambient`, `sky_islands_day_action`, cross-fade 1 | data (jigsaw valley scenes) |
| Wolver Den | `beast` 0.7 | data (Wolver's Den/Music Mix) |
| Lichenous Lumberyard | `slime` 0.4 | data (Lichenous Lair → Music/Slime) |
| Candlestick Keep (castle) | `candlestick_keep` ×1.5, `castle_ambient`, `castle_action` | ours |
| Graveyard | `undead` 0.6 | data (Graveyard/Music Mix) |
| Gremlin Compound (city) | `gremlin` ×1.5, `city_ambient`, `city_action` | gremlin from data (Music/Monster Family/Gremlin); city ours |
| Deconstruction Zone | `construct` 0.4 | data (Music/Monster Family/Construct) |
| Frosty Islands | the sky islands mix | data (jigsaw valley scenes; a sky-islands tileset) |
| Dark Halls | `apocrea`, `somber`, cross-fade 1 | data (dark halls lobby and finale) |
| Frozen Pools | `freeze` 0.45 | ours |

Styles added later are matched by tileset name:

- `sky-night` / `valley-night` plays the den's music;
- `sky-autumn` / `valley-autumn` plays the lumberyard's;
- `sky-winter` plays Frosty Islands';
- `castle-light` plays Dark Halls';
- `ice` plays Frozen Pools';
- `castle` plays the keep's;
- `city` plays the compound's;
- `clockworks-white` plays the Deconstruction Zone's;
- tilesets named for an element (fire, ice and so on) play that element's track.

After that comes the stratum family's track, then the Clockwork Tunnels mix.

### Bosses

| Boss | Level track | Fight (once roused) |
|---|---|---|
| Royal Jelly (Royal Jelly Palace) | `royal_jelly` | `boss_1` |
| Snarbolax (Gloaming Wildwoods) | `wildwoods` | `boss_2` |
| Roarmulus Twins (Ironclaw Munitions Factory) | `munitions` | `boss_1` |
| Lord Vanaduke (Firestorm Citadel) | `citadel_ambient`, `citadel_action` | `battle_citadel` |

The fight track cross-fades in when the knight comes within 14 units of a boss or a boss
attacks. When every boss actor has been gone for about two seconds (so a boss between phases
still counts), `fanfare_victory_1` plays and the level track returns. All of these pairings
are ours.

### Stingers

Stingers play over the music, which ducks to 30% under them.

| Moment | File |
|---|---|
| Elevator screen (floor cleared, arena checkpoint) | `fanfare_elevator_1` |
| Boss defeated | `fanfare_victory_1` |
| Knocked out | `fanfare_failure_1` |
| Revived | `fanfare_resurrect_1` |
| (kept for later) weapon level-up, discovery, mission complete, PvP win and loss, dramatic swell | `fanfare_item_levelup_1`, `fanfare_discovery_1`, `mission_complete`, `fanfare_pvp_win`, `fanfare_pvp_lose`, `dramatic_swell_1` |

### Kept for content the port lacks

These are keyed in `MISSION_MUSIC` and the pairings are ours:

- `barracks`;
- `crash_site`;
- `crimson`;
- `dreadful`;
- `sanctuary`;
- `unknown_passage`;
- `creepy_ambient` and `creepy_battle` (Shadow Lairs);
- `lockdown`, `lockdown_sd`, `blast_network` and `blast_network_sd` (PvP; `_sd` is sudden death).

## Playback

- **Fades.** A new track fades in over 1.5 s while the old one fades out. Leaving a floor fades
  its music out over 1 s. A boss fight cross-fades in over 1 s and back out over 4 s. A mix
  cross-fades between its own picks.
- **Same track.** Asking for the track (or mix) that already plays keeps it going.
- **Overlapping requests.** If several music requests overlap (a slow decode), the last one
  wins.
- **Title screen.** Browsers start audio only after a gesture, so the title theme begins on the
  first click or key.
