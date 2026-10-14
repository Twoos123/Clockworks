# Clockworks

**Spiral Knights, playable in your browser.** A single-player remake of Three Rings' co-op
dungeon crawler, rebuilt as a TypeScript and WebGL 2 engine that plays the game from your own
Spiral Knights install. Dive the Clockworks from Haven to the Core, fight the four bosses in
their lairs, craft and level your gear, run missions and fill out your arsenal, all in a
browser tab.

> **Unofficial fan project, not endorsed by Grey Havens.** Spiral Knights, its client and its
> assets belong to Grey Havens and Three Rings. This project ships none of them: everything the
> game shows is read at runtime from the player's own install. It is non-commercial.

## What you can play

- **The Clockworks, as the real game builds them.** The Arcade's real gates, taken from
  community-captured gate data: each gate's six strata, its themes, and every depth's levels
  rotating in real time. Tiers 1 to 3 run from depth 1 to 29, with Clockwork Terminals,
  Moorcroft Manor, Emberlight and the Core between them.
- **Real levels.** Any level your game has cached, plus a community scene archive, plays as
  the real level: 229 of the game's 421 levels so far, including every boss lair. The rest are
  assembled from real rooms cut out of captured floors, the way the game's own generator joins
  prefab rooms.
- **Bosses in their lairs.** The Royal Jelly, the Snarbolax, the Roarmulus Twins and Lord
  Vanaduke, each after its stratum's own stage floors, on their real levels with their real
  mechanics: bells, blast walls, water pots, minions.
- **Combat ported from the client.** Movement, combo windows, charge attacks, gun reloads,
  shield, dash, auto-aim and the camera follow the client's own prediction code. Damage,
  defence, status effects, knockback, heat and bonuses use the client's own maths. Every
  weapon class fires its real projectiles and animations.
- **Your knight.** The arsenal, crafting, shops, backpack, heat levelling, pocket items,
  trinkets, vitapods, costumes and accessories, battle sprites, loadouts and 65 achievements.
- **Haven and beyond.** Walkable towns with NPC dialogue, the Arcade's gate machines, the
  mission board with its rank and prestige missions, guild halls with furniture, the Ready
  Room and knight creation.
- **The game's own screens.** Every window and HUD element is built from the game's own
  interface files, with the game's own text, music and sounds.

## How to play

You need **Spiral Knights installed** (the free Steam version is fine) and
[Node.js 22](https://nodejs.org/).

```bash
npm install
```

```bash
npm start
```

The launcher finds your Spiral Knights install by itself (Steam libraries, the standalone
installer's folders, or `SK_DIR` if you set it) and opens the game in your browser. It serves
everything on `localhost` only.

**Controls:** WASD to move, left click to attack (hold to charge), right click to shield,
Shift + right click to dash, 1-3 or Space to switch weapons, 4-7 for pocket items,
R/T/G for battle sprite skills, F to interact, Q/E to turn the camera, Esc for options. The
menus use the game's own keys: I arsenal, P equipment, L loadouts, U crafting, M missions,
B map, F1 help, F6 social, F7 news, \` to lock the HUD and = to zoom. Every key can be rebound
in the options screen, which also has a "Hold Left Button to Move" mode like the original.

### Collecting more real levels

The real game downloads each level from its servers when you first enter it and caches it in
the install's `scenes/` folder. Every time the launcher starts, it copies new ones into a
private archive (`%LOCALAPPDATA%\clyde-web\scenes`) and keeps them, so a level you've visited
once in the real game stays playable here. `npm run levels` shows which of the game's levels
you have and where to find the rest.

## How it works

| Part | What it does |
|---|---|
| `src/export/` | Reads Clyde's binary export format with no Java classes, byte-exact on every `.dat` in the install |
| `src/config/`, `src/model.ts`, `src/scene.ts` | Clyde's parameter system, materials, models, animations and Tudey scenes |
| `src/render/` | WebGL 2 renderer emulating the fixed-function OpenGL states the game's materials use, plus particles, lights, skyboxes and the skybox blur |
| `src/ui/gui.ts` | A reimplementation of Clyde's GUI, so every window is built from the game's own interface configs |
| `src/game/` | The game: world and combat, the knight, monsters, bosses, gates, missions, economy, achievements |
| `src/gen/` | The level generator, assembling floors from real rooms |
| `src/i18n.ts` | The game's own text, read from the install's message bundles |
| `server/` | The local launcher: finds the install, keeps the level archive, fetches gate data |

The engine is an independent reimplementation. It follows the published sources of Three
Rings' open-source [Clyde](https://github.com/threerings/clyde), Narya and Nenya, and the
behaviour of the game's own client, studied with Grey Havens' permission. No decompiled code
is part of this repository. The research behind each part is in [docs/research/](docs/research/).

## What it doesn't do

- **No game files.** No models, textures, sounds, levels or code from the game are hosted or
  distributed. Each player's own install supplies them.
- **No game servers.** It never connects to Grey Havens' servers. Server-side behaviour
  (monster AI, boss sequencing, drops, mission floor lists) is reconstructed from the game's
  configs, the client and the community wiki.
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
| `npm test` | Unit tests; needs no game files |
| `npm run build` | Type-checks and builds the game into `dist/` |
| `npm run package` | Bundles the launcher and the built game into one executable |
| `npm run levels` | Lists the game's levels you have and are missing |
| `npm run import-scenes` | Imports a local copy of a community scene archive into your private archive |
| `npm run scan` | Parses every `.dat` in the install and reports failures |

## Credits

- [Three Rings](https://github.com/threerings) for open-sourcing Clyde, Narya and Nenya, the
  engine layers this project reads and reimplements (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- Grey Havens, for keeping Spiral Knights running, and for permission to build this.
- The community: the [Spiral Knights Wiki](https://wiki.spiralknights.com/), sinkillerj's
  [scene archive](https://github.com/sinkillerj/SpiralKnightsSceneArchive), and the
  [gate map](https://gatemap.knightlauncher.com/) by silverhawke and Magnus.

## License

The code is under the BSD 2-Clause license (see [LICENSE](LICENSE)). Spiral Knights is a
trademark of its owner. This license covers this project's code only, not the game or its
assets.
