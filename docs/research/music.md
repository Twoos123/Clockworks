# Music: what the install has and where it plays

Measured against the Steam install of 2026-10-07 and the level archive of 2026-10-14 (414
levels, guild halls left out). The table lives in `src/game/music.ts`; the player that follows
the game (`src/game/musicplayer.ts`) picks a track whenever a floor starts. `tools/music-survey.ts`
prints the survey this page comes from (`npx tsx tools/music-survey.ts`, `--filter <regex>` for
some scenes, `--json <file>` for all of it). `tests/music.test.ts` checks that every floor of
every gate gets a track (the Core's terminal excepted, see below), that every file the table
names is in the install, that every track in the install is placed somewhere, and that every
table entry cites its data.

## Where the music is

- **Files.** `rsrc/sound/music/*.ogg`, 70 files on disk. `rsrc/full-music-bundle.jar` holds 61
  of them (the disk has nine more: `battle_1`, `comlink`, `crash_site`, `fanfare_failure_1`,
  `fanfare_pvp_win`, `fanfare_victory_1`, `main_theme`, `prologue_audio_only`, `title`). The
  app's file system reads both.
- **Scene globals** (`config/scene_global.dat`). Scenes pick music with two globals:
  - `Environment/Music`: one file and a gain (`world/environment/global_music.dat`, a looping
    Stream).
  - `Environment/Music Mix`: weighted files, a gain and a cross-fade (default 1 s)
    (`world/environment/global_music_mix.dat`, the sounder `Meta Stream/Default (Gain)`). A Meta
    Stream plays a weighted pick through, then another, cross-fading over `Cross Fade` seconds.
    `AudioSystem.playMix` plays it the same way.
- **Named music globals** in the same file, which scenes name instead of the two above:

  | Global | Plays |
  |---|---|
  | `Environment/Custom/Clockwork Tunnels/Default/Music Mix` | `clockwork_ambient` ×1.75, `clockwork_ambient_2` ×1.75, `clockwork_action`, 0.45, no cross-fade |
  | `.../Clockwork Tunnels/Fire`, `Freeze`, `Poison`, `Shock` | derive from `Environment/Custom/Universal/<Element>/Music (<Element>)` |
  | `.../Clockwork Tunnels/Spooky/Music Mix` | `undead` 0.6 |
  | `.../Universal/<Element>/Music (<Element>)`, `Music/Status/<Element>` | `fire`, `freeze`, `poison` 0.45; `shock` 0.75 |
  | `.../Battle Arena/Default`, `Fire`, `Freeze` | `clockwork_action` 0.15 |
  | `.../Devilish Drudgery/Music Mix` | `fiend` 0.4 |
  | `.../Graveyard/Music Mix` | `undead` 0.6 |
  | `.../Lichenous Lair/Music Mix` → `Environment/Custom/Music/Slime` | `slime` 0.4 |
  | `.../Wolver's Den/Music Mix` | `beast` 0.7 |
  | `.../Town/Haven/Default/Music`, `Winter/Music` | `haven` 0.25, `haven_winter` 0.35 |
  | `Music/Monster Family/<Family>` | `beast` 0.7; `construct`, `fiend`, `gremlin`, `slime`, `undead` 0.4 |
  | `Music/Missions/ComLink` | `comlink` 0.45 |

- **Level logic** (below): `Environment/Music` actors the levels spawn, `Triggers/Music Area`
  areas and conversations' own music.
- **The client** (decompiled, `com/threerings/projectx`):
  - `ProjectXApp` and `client/dK` play `title` at 0.45 (0.5 s fade) on the log-on and knight
    select screens, and `prologue_audio_only` once for a new knight. `client/I` stops that music
    as the knight enters the game; from then on scene music comes only from the scenes' globals
    and logic, so **a scene with no music global is silent** until its logic spawns music.
  - `mission/client/MissionPanel` plays `mission_ui` (0.5, looping) while the mission panel is
    open. `dungeon/client/EndOfLevelWindow` plays `fanfare_elevator_1` (0.7) at the elevator
    and `mission_complete` at a mission's end.
  - PvP (`dungeon/arena/a`): `g` plays `barracks` at 0.6 before a match (PRE_GAME,
    PRE_COUNTDOWN), fades it out over the countdown, and brings it back after (GAME_OVER,
    POST_GAME, 1 s fade). During the match: Blast Network (`y`) `blast_network` at 0.75, then
    `blast_network_sd` for the last 30 s; Lockdown (`C`) `lockdown` at 0.6, then `lockdown_sd`
    for the last 60 s; the third mode (`L`) `battle_2` at 0.6.
- **Sounders** (`config/sounder.dat`): `Custom/Mission/Comlink` and `Comlink (urgent)` are
  streams pushed over the music (Stack, Override); conversations name them as their `music`
  (`ProjectXActionConfig.StartConversation.music`), as Haven's mission scenes do.
- **Others:** the Mimic's actor plays `fanfare_victory_1` and `battle_2`; `config/placeable.dat`
  plays `fanfare_pvp_lose`; `ui/mission/parts/part_missioncomplete.dat` plays `fanfare_pvp_win`;
  the Swarm model (`character/npc/monster/swarm/model.dat`) plays `whitespace_ambient` and
  `whitespace_swarm`; the ready room (`world/readyroom/scene.dat`) plays `mission_ui`.

## The survey

387 of the 414 archived levels name a music global; 246 of them spawn 439 music actors. By
tileset (each scene's commonest tile prefix):

| Tileset | Levels | Music global |
|---|---|---|
| Clockworks | training grounds, guild training | `clockwork_ambient` ×2, `clockwork_action`, 0.45 |
| | Clockwork Tunnels missions (`ct *`, `bp *`, `design (...)`) | Clockwork Tunnels/Default mix |
| | `ct undead`, mission seraphynx 2 | Clockwork Tunnels/Spooky (`undead` 0.6) |
| | terminal 1, terminal return | Music Mix `title` 0.45 |
| | terminal core [48], terminal core mission [329] | **none** |
| | temp core [341] | `title` 0.33 |
| | emberlight, spiral kitchen; moorcroft | `subtown_1` 0.45; `subtown_1` 0.6 |
| | arcade lobby | `clockwork_ambient_2` 0.25 |
| | mission lobby | `mission_lobby` 0.5 |
| | hall of heroes star1-5 | `hall_heroes` 0.45 |
| | Deconstruction Zone missions (`dz *`, all elements) | `construct` 0.5 |
| | ultimate swarm trap, terminal core camefrombelow | `unknown_passage` 0.7 |
| | spark roar finale | `creepy_ambient` 0.6 |
| Clockworks Fire | cogmaster castle 1-6 | `crimson` 0.65 |
| | final test [211] | `fire` 0.6 |
| | Clockwork Tunnels fire missions (`bf *`) | Clockwork Tunnels/Fire |
| Clockworks Freeze / Poison / Shock | element missions (`cc *`, `ww *`, `pc *`...) | Clockwork Tunnels/<Element> |
| Clockworks Shock (and Fire, ultimate) | ironclaw munitions factory assembly, workshop | `munitions` 0.45 |
| | ironclaw munitions factory twins | `sound/effect/world/environmental_rumble_01` 0.5 |
| | ghost machine treasure vault | `comlink_somber` 0.45 |
| Castle | lost castle *, scarlet fortress grim gallery | `castle_ambient` ×2, `castle_action`, 0.15, no cross-fade |
| | candlestick keep * (Candlestick Keep missions) | `candlestick_keep` 0.55 |
| | royal jelly court, garden, lair (and ultimate) | `royal_jelly` 0.45 (an older lair [27]: `slime` 0.45) |
| Castle, Fire | firestorm citadel ash armory, blackstone bridge, charred court, smoldering steps | `citadel_ambient`, `citadel_action`, 0.45, cross-fade 1 |
| | firestorm citadel vanaduke, throne room | `citadel_ambient` 0.45 |
| Castle, Light | hall of heroes star0; dark halls lobby; dark halls finale | `hall_heroes` 0.45; `apocrea` 0.6; `somber` 0.45 |
| City, Base | concrete jungle *, dark city * | `city_ambient` ×2, `city_action`, 0.4, cross-fade 1 |
| | Devilish Drudgery missions (`dd *`, `devilish drudgery *`) | Devilish Drudgery (`fiend` 0.4) |
| | heart of ice, its treasure vault | `freeze` 0.45 |
| Graveyard | graveyard missions | Graveyard (`undead` 0.6) |
| | legion almire necropolis; its treasure vault | `undead` 1; `somber` 0.65 |
| Haven | haven town square, bazaar, arcade, eastside | Haven/Default (eastside [435]: Haven/Winter) |
| | rescue camp, guildhall | `subtown_1` 0.45 |
| | tutorial, rc bomb training | `main_theme` 0.45 |
| | sleeper sanctuary, core treasure vault | `sanctuary` 0.65 |
| | scarlet fortress trojan graveyard | `somber` 0.45 |
| Sky Islands, Day | jigsaw valley *, aurora isles *, geo knight camp | `sky_islands_day_ambient`, `sky_islands_day_action`, 0.25, cross-fade 1 |
| | wolver den missions | Wolver's Den (`beast` 0.7) |
| | treasure vault end rainbow | `treasure_vault` 0.35 |
| Sky Islands, Night | gloaming wildwoods path, ruins, snarbolax (and ultimate) | `wildwoods` 0.6 |
| | starlight cradle * | Music Mix `sky_islands_day_ambient` ×2 alone, gain 1 |
| | lichenous lair missions | Lichenous Lair (`slime` 0.4) |
| | punkin king | Graveyard (`undead` 0.6) |
| Sky Islands, Winter | mt grinchlin ascent, summit; mission lobby grinchlin | Music/Monster Family/Gremlin; Universal/Freeze |
| Whitespace | core 1, core dreamsandnightmares finale | `whitespace_ambient` 0.75 |

The Shadow Lairs (the archive's "... ultimate" scenes) name the same music as the levels they
darken.

## Level-scripted music (the music stack)

The levels' logic plays music of its own: it spawns `Environment/Music` actors
(`config/actor.dat`: a Block whose sprite model is `world/environment/global_music_stack.dat`, a
viewer affecter playing the sounder `Stream/Default (Gain, Stack)`), with arguments File, Gain
(default 1), Fade In, Fade Out, Override (the sounder's `push`), Stack and Tag, and a
Destruction Transient (`model/scripted/play_sound_clip.dat`, nearly always `fanfare_victory_1`).
It ends them with a DestroyActor on the tag, typically from a `Trigger/Actor Removed` when a
room's last wave falls. The 439 spawns:

- wave rooms: `battle_1` ×250, `battle_2` ×25, the Firestorm Citadel's `battle_citadel` ×31,
  each ended by the room's last wave with `fanfare_victory_1`;
- boss and mini-boss fights: `boss_1` ×23, `boss_2` ×4 (below);
- set pieces: `main_theme` ×17 (the Royal Jelly court's arena, tag `music 1g`, never destroyed;
  the munitions workshop; the jungle and cradle mini-bosses), `creepy_battle`/`creepy_ambient`
  (cogmaster castle 2, the citadel's throne room, haven laboratory), `crash_site` at 0.65 in
  the crash-site tutorial (tutorial b), `whitespace_swarm`, `sanctuary`, `dreadful`,
  `comlink*`, `lockdown`/`lockdown_sd` and element and family tracks in mission levels.

Two more ways levels play music:

- **`Triggers/Music Area`** (`config/area.dat`): an area that spawns `Environment/Music` (File,
  Fade In, Fade Out, Tag) while a knight is inside and destroys it on leaving: the Core's
  `whitespace_swarm`, the casino demo's `treasure_vault`.
- **Conversations** whose StartConversation names `music` (`Custom/Mission/Comlink`, `Comlink
  (urgent)`) in Haven's mission scenes.

Streams sit on named stacks the way Clyde's `StackedStream` keeps them: a stream pushed with
Override fades out the stack's top level over its Fade In and starts a level above it; without
Override it joins the top level and plays alongside. When the actor goes, its stream fades out
over Fade Out, and if that empties the top level the level below fades back in over the same
time. The scene's own music global is a Stream on the default stack without push, so it is the
bottom level. `src/game/musicstack.ts` holds the stacks; `MusicPlayer` puts the floor's track at
the bottom and the level's streams over it, so scripted music wins wherever it is spawned. The
Battle Arena ignores scripted music, because it leaves out the triggers that would end it.
Generated floors keep each room's spawn and its destroying trigger together, with their tag
numbers renumbered by room (`tests/musicstack.test.ts`), and generated danger rooms and arena
halls script `battle_1`/`battle_2` themselves (`src/gen/features.ts`, after scene 370).

### Bosses

Every boss lair scripts its fight: when the boss is roused (the party platform closes the doors
and spawns it) the lair spawns `boss_1` at gain 1 with Override and `fanfare_victory_1` as its
Destruction Transient, ended by a `Trigger/Actor Removed` on the boss.

| Lair | Music global | Scripted |
|---|---|---|
| royal jelly lair [255] | `royal_jelly` 0.45 | `boss_1` (tag `music_1`, fade out 2) from the "Close Door, Spawn" platform |
| gloaming wildwoods snarbolax [90] | `wildwoods` 0.6 | `boss_1` (tag `music boss`, fade out 3) from the "Spawn" platform |
| ironclaw munitions factory twins [94] | the rumble effect at 0.5 | `munitions` (tag `music_start`) on entering, ended by the door closing with `munitions_alarm_02`; then `boss_1` (tag `music_1`) |
| firestorm citadel vanaduke [32] | `citadel_ambient` 0.45 | `boss_1` (tag `music`, no fades) from the platform |

So on the game's own lairs `MusicPlayer` plays only their data: the level's music global, then
the `boss_1` their logic spawns and the fanfare when it is destroyed. Our fight track and our
victory fanfare play only on a generated arena (whose logic `spawnsMusic` finds no music in):
`BOSS_MUSIC[boss].fight`, `boss_1` at gain 1 as the lairs have it, cross-fading in when the
knight comes within 14 units of a boss or a boss attacks, and the level track back after
`fanfare_victory_1` once every boss actor has been gone about two seconds. A generated arena's
level track is the lair's (`royal_jelly` 0.45, `wildwoods` 0.6, `citadel_ambient` 0.45), and
for the Twins the factory's `munitions` 0.45 rather than the lair's rumble.

## What plays where

`MusicPlayer.choose`, in order:

1. The Battle Arena: `clockwork_action` (Battle Arena/Default/Music Mix; gain 0.15 raised to
   0.3), and every tenth wave the arena's boss track.
2. A gate floor on one of the game's own levels (any archived scene: terminals, Emberlight,
   Moorcroft Manor, boss lairs, the cached levels a stratum picks from): **that level's own
   music global**. Generated floors copy globals from whatever level they were learned from,
   not from the stratum they stand in for, so they, and archived levels naming no music, use
   the table by the floor's kind, theme and style.
3. Any other scene: its own music global, else the table by scene name.

Scripted music then plays over whichever it is.

### The table (`src/game/music.ts`)

Every entry names its source. "GUESS" marks the three the data leaves open.

| Place | Track | Source |
|---|---|---|
| Title screen | `title` 0.45 | client (ProjectXApp, dK) |
| Haven | the scene's own; `haven` 0.25, `haven_winter` 0.35 in winter | scene globals |
| Arcade (depth 0) | `haven` 0.25 | Haven/Default |
| Clockwork Terminal (4, 13, 23) | `title` 0.45 | terminal 1 |
| Terminal above the Core (29) | **silence** | terminal core [48] names no music global |
| Moorcroft Manor (8), Emberlight (18) | `subtown_1` 0.45 (the archived moorcroft plays its own 0.6) | emberlight, moorcroft |
| Guild hall | Clockwork Tunnels mix | hall |
| Hall of Heroes | `hall_heroes` 0.45 | hall of heroes star0-5 |
| Arena | `clockwork_action` 0.3 | Battle Arena/Default (0.15) |
| Arena boss waves | `boss_1` or `boss_2` 0.45 | GUESS: no archived arena boss wave |
| Danger rooms | `battle_1` (×10) or `battle_2`, gain 1 | wave rooms' scripted music |
| Treasure vaults | `treasure_vault` 0.35 | treasure vault end rainbow |
| Mission lobby, ready room | `mission_lobby` 0.5, `mission_ui` 0.45 | scenes |
| ComLink | `comlink` 0.45 (`comlink_urgent` 0.9) | scene global, sounder |
| Swarm | `whitespace_ambient`, `whitespace_swarm` | Swarm model |
| Intro | `prologue_audio_only` 0.45 | client (dK) |

Kept for content the port lacks (`MISSION_MUSIC`): `barracks` 0.6, `lockdown`/`lockdown_sd`
0.6, `blast_network`/`blast_network_sd` 0.75 (client PvP); `comlink_somber` 0.45 (ghost
machine treasure vault); `crash_site` 0.65 (tutorial b); `creepy_ambient` 0.6 (spark roar
finale); `creepy_battle` 0.85 (throne room, haven laboratory); `crimson` 0.65 (cogmaster
castle); `dreadful` 1 (ghost machine compound); `sanctuary` 0.65 (sleeper sanctuary);
`unknown_passage` 0.7 (ultimate swarm trap).

### Level styles (a stratum's generated floors)

Element strata (Fire, Freeze, Poison, Shock) play their element's track in any style
(`Environment/Custom/Universal/<Element>/Music`, which the Clockwork Tunnels element mixes
derive from): `fire`, `freeze`, `poison` 0.45, `shock` 0.75. Family strata play their style's:

| Style (clockworks.ts) | Track | Source |
|---|---|---|
| Clockwork Tunnels | `clockwork_ambient` ×1.75, `clockwork_ambient_2` ×1.75, `clockwork_action` 0.45 | Clockwork Tunnels/Default |
| Clockwork Tunnels, Undead / Fiend stratum | `undead` 0.6 / `fiend` 0.4 | Clockwork Tunnels/Spooky, Devilish Drudgery |
| Jigsaw Valley, Aurora Isles | sky islands day mix 0.25 | jigsaw valley, aurora isles scenes |
| Wolver Den | `beast` 0.7 | Wolver's Den/Music Mix |
| Lichenous Lumberyard, Lichenous Lair | `slime` 0.4 | Lichenous Lair/Music Mix |
| Candlestick Keep | `candlestick_keep` 0.55 | candlestick keep scenes |
| Graveyard | `undead` 0.6 | Graveyard/Music Mix |
| Gremlin Compound | `gremlin` 0.4 | GUESS: no plain compound archived; Music/Monster Family/Gremlin |
| Deconstruction Zone | `construct` 0.5 | deconstruction zone and `dz *` scenes |
| Frosty Islands | sky islands day mix | inferred: a sky-islands tileset (the winter scenes archived are Mt. Grinchlin's) |
| Dark Halls | `apocrea`, `somber`, cross-fade 1 | dark halls lobby and finale |
| Frozen Pools | `freeze` 0.45 | GUESS: none archived; Universal/Freeze |
| Prize vault | `treasure_vault` 0.35 | treasure vault end rainbow |
| Devilish Drudgery | `fiend` 0.4 | Devilish Drudgery/Music Mix |
| Battle Arena | `clockwork_action` 0.15 | Battle Arena/Default/Music Mix |
| Starlight Cradle | `sky_islands_day_ambient` ×2 alone, gain 1 | starlight cradle scenes |
| Concrete Jungle, Dark City | `city_ambient` ×2, `city_action` 0.4, cross-fade 1 | concrete jungle, dark city scenes |
| Scarlet Fortress | `castle_ambient` ×2, `castle_action` 0.15, no cross-fade | scarlet fortress grim gallery, lost castle |

Styles added later are matched by tileset name: `sky-night`/`valley-night` plays the den's
music, `sky-autumn` the lumberyard's, `sky-winter` Frosty Islands', `castle-light` Dark Halls',
`ice` Frozen Pools', `prize-vault` `treasure_vault`, `whitespace` `whitespace_ambient`, `haven`
`haven`, `castle` the keep's, `city` the compound's, `clockworks-white` the Deconstruction
Zone's, and tilesets named for an element that element's track; after that the stratum family's
track, then the Clockwork Tunnels mix. Mission floors play the element track when their tileset
is an element's, otherwise their monster family's (`Music/Monster Family/*`).

### Stingers

Stingers play over the music, which ducks to 30% under them.

| Moment | File |
|---|---|
| Elevator screen (floor cleared, arena checkpoint) | `fanfare_elevator_1` |
| Boss defeated on a generated arena (the lairs' own transient elsewhere) | `fanfare_victory_1` |
| Knocked out | `fanfare_failure_1` |
| Revived | `fanfare_resurrect_1` |
| (kept for later) weapon level-up, discovery, mission complete, PvP win and loss, dramatic swell | `fanfare_item_levelup_1`, `fanfare_discovery_1`, `mission_complete`, `fanfare_pvp_win`, `fanfare_pvp_lose`, `dramatic_swell_1` |

## Playback

- **Fades.** A new track fades in over 1.5 s while the old one fades out. Leaving a floor fades
  its music out over 1 s. A generated arena's boss fight cross-fades in over 1 s and back out
  over 4 s. A mix cross-fades between its own picks.
- **Silence.** A place whose data names no music (the Core's terminal) fades the music out.
- **Same track.** Asking for the track (or mix) that already plays keeps it going.
- **Overlapping requests.** If several music requests overlap (a slow decode), the last one
  wins.
- **Title screen.** Browsers start audio only after a gesture, so the title theme begins on the
  first click or key.
