# Clockworks

**Spiral Knights, playable in your browser.** A single-player remake of Three Rings' co-op
dungeon crawler, rebuilt as a TypeScript and WebGL 2 engine that plays the game from your own
Spiral Knights install. Start at the log-on screen, create your knight, crash-land on Cradle,
dive the Clockworks from the gate lobby to the Core, fight the four bosses in their lairs,
forge and craft your gear and run missions, all in a browser tab.

> **Unofficial fan project, not endorsed by Grey Havens.** Spiral Knights, its client and its
> assets belong to Grey Havens and Three Rings. This project ships none of them: everything the
> game shows is read at runtime from the player's own install. It is non-commercial.

## What you can play

- **From launch to Haven, as the game does it.**
  - The log-on screen over Cradle, with its own music.
  - Knight select, with up to three knights, each with its own progress.
  - The new-knight intro (skippable).
  - Knight creation (Armor, Details, Personalize, name), with a knight you can spin.
  - The crash site, the Rescue Camp, then Haven. The Event Hub and Spiral Uplink open when you
    arrive.
- **The Clockworks, as the real game builds them.**
  - The Arcade's real gates come from community-captured gate data. Each gate has six strata
    and themes, and every depth's levels rotate in real time.
  - Every run starts in the gate lobby, with Kozma and the lobby consoles.
  - Tiers 1 to 3 run from depth 1 to 29, with Clockwork Terminals, Moorcroft Manor, Emberlight
    and the Core between them.
- **Real levels.** Any level your game has cached, plus a community scene archive, plays as the
  real level, including every boss lair and Shadow Lair. The rest are assembled from real rooms
  cut out of captured floors, the way the game's own generator joins prefab rooms.
- **Levels that sound like the game.** Each level plays its own music, switches to battle music
  in arena rooms, and plays the victory fanfare when the last wave falls.
- **Bosses in their lairs.** The Royal Jelly, the Snarbolax, the Roarmulus Twins and Lord
  Vanaduke each follow their stratum's own stage floors and play on their real levels with
  their real mechanics.
- **Combat ported from the client.**
  - Movement, combo windows, charge attacks, gun reloads, the shield bubble, dash, auto-aim
    and the camera.
  - Damage, defence, status effects, knockback and heat use the client's own maths.
  - Every weapon fires its real projectiles, disk guns and mixer cores included.
  - Monsters run Clyde's behaviour engine, rebuilt per family.
- **Your knight.**
  - The arsenal, loadouts, costumes and accessories, battle sprites and their skills, pocket
    items, trinkets, vitapods and achievements.
  - The Forge levels gear with fire crystals.
  - Alchemy machines craft from recipes.
  - Energy (the mist tank) pays for revives, crafting and energy gates.
- **Haven and beyond.**
  - Walkable towns, with NPC dialogue and the vendors' real stock.
  - The mission board with its rank, prestige, expansion and Arcade tabs.
  - Mission lobbies, guild halls with furniture, and the Ready Room.
- **The game's own screens.**
  - Every window and HUD element is built from the game's own interface files, with the game's
    own text, music and sounds.
  - That includes the main menu, options, help, social, the event hub, the uplink and the
    end-of-level report.

## How to play

You need **Spiral Knights installed** (the free Steam version is fine) and
[Node.js 22](https://nodejs.org/).

```bash
npm install
```

```bash
npm start
```

The launcher finds your Spiral Knights install on its own (Steam libraries, the standalone
installer's folders, or `SK_DIR` if you set it) and opens the game in your browser. It serves
everything on `localhost` only.

**Controls** (the game's own defaults, all rebindable in Options → Controls):

| Action | Key |
|---|---|
| Move | WASD, or hold the left button with Mouse Movement |
| Attack (hold to charge) | Left click |
| Shield | Right click |
| Dash | Shift + right click |
| Change weapon | Space or wheel down (1-3 picks one) |
| Pocket items, sprite skills | 4-7, R/T/G |
| Arsenal, Character, Loadouts, Forge | I, P, L, U |
| Inventory (Character and Arsenal) | Tab |
| Recipes, Achievements, Missions, Map | F5, O, M, B |
| Help, Social, Event Hub | F1, F6, F7 |
| Lock the HUD, camera zoom | \`, = |
| Options | Esc |

### Collecting more real levels

The real game downloads each level from its servers the first time you enter it, and caches it
in the install's `scenes/` folder. Every time the launcher starts, it copies new ones into a
private archive (`%LOCALAPPDATA%\clyde-web\scenes`) and keeps them. A level you've visited once
in the real game stays playable here. `npm run levels` shows which of the game's levels you have
and where to find the rest.

## How it works

| Part | What it does |
|---|---|
| `src/export/` | Reads Clyde's binary export format with no Java classes, byte-exact on every `.dat` in the install |
| `src/config/`, `src/model.ts`, `src/scene.ts` | Clyde's parameter system, materials, models, animations, floors and Tudey scenes |
| `src/render/` | WebGL 2 renderer emulating the fixed-function OpenGL states the game's materials use, plus particles, lights, skyboxes and the skybox blur |
| `src/ui/` | A reimplementation of Clyde's GUI, so every window is built from the game's own interface configs |
| `src/game/` | The game: world and combat, behaviours, the knight, monsters, bosses, gates, missions, forge, energy, music, achievements |
| `src/gen/` | The level generator, assembling floors from real rooms |
| `src/i18n.ts` | The game's own text, read from the install's message bundles |
| `server/` | The local launcher: finds the install, keeps the level archive, fetches gate data |

The engine is an independent reimplementation. It follows the published sources of Three Rings'
open-source [Clyde](https://github.com/threerings/clyde), Narya and Nenya, and the behaviour of
the game's own client. No decompiled code is part of this repository. The research behind each
part is in [docs/research/](docs/research/).

## What it doesn't do

- **No game files.** No models, textures, sounds, levels or code from the game are hosted or
  distributed. Each player's own install supplies them.
- **No game servers.** It never connects to the official servers. Server-side behaviour
  (monster AI, boss sequencing, drops, shop stock, mission floor lists) is reconstructed from
  the game's configs, the client and the community wiki.
- **No multiplayer.** Parties, trading, the auction house and PvP are out of scope for a
  single-player remake.

## Development

```bash
npm run dev
```

The dev server runs at http://localhost:5174 and finds the install the same way the launcher
does. `#dev=1` opens the developer viewer (scene list, model browser).

| Command | What it does |
|---|---|
| `npm test` | Unit tests; most need no game files |
| `npm run build` | Type-checks and builds the game into `dist/` |
| `npm run package` | Bundles the launcher and the built game into one executable |
| `npm run levels` | Lists the game's levels you have and are missing |
| `npm run import-scenes` | Imports a local copy of a community scene archive into your private archive |
| `npm run scan` | Parses every `.dat` in the install and reports failures |

## Credits

- [Three Rings](https://github.com/threerings), for open-sourcing Clyde, Narya and Nenya, the
  engine layers this project reads and reimplements (see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- The community: the [Spiral Knights Wiki](https://wiki.spiralknights.com/), sinkillerj's
  [scene archive](https://github.com/sinkillerj/SpiralKnightsSceneArchive), and the
  [gate map](https://gatemap.knightlauncher.com/) by silverhawke and Magnus.

## License

The code is under the BSD 2-Clause license (see [LICENSE](LICENSE)). Spiral Knights is a
trademark of its owner. This license covers this project's code only, not the game or its
assets.
