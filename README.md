# Clyde Web Viewer

A browser viewer for models and scenes built with Three Rings' open-source
[Clyde](https://github.com/threerings/clyde) engine. It reads game data directly from a
game install on the player's own computer and renders it with WebGL 2. Nothing is uploaded,
and no game data, game code, or server access is part of this project.

This is the first deliverable of a longer effort to bring a Clyde-based game to the browser.
The plan, research, and current status are in [docs/](docs/).

## What it does

- Opens a game install folder through the browser's folder picker, a folder upload input,
  or drag and drop. Chromium remembers the folder between visits.
- Parses Clyde's binary export format without any of the classes that wrote it. Every one of
  the 7,459 `.dat` files in a current Spiral Knights install parses byte-exact.
- Renders articulated, static, compound, derived, schemed and conditional models, with
  GPU skinning and keyframe animation.
- Resolves materials through the install's own material and texture libraries, using a
  reimplementation of Clyde's parameter system, and emulates the fixed-function OpenGL
  states those materials need on WebGL 2.
- Renders Tudey scenes that the player's client has cached, such as towns, guild halls and
  dungeon floors they have visited, with their lighting, fog, skyboxes, particles and
  animated props.
- Applies the game's texture colorizations.
- Lets you walk a knight around any cached scene ("Play as knight").

## What it deliberately does not do

- It never decompiles or runs the proprietary game client. From the install's `code/` folder
  it reads exactly one data file, the colour definitions inside `projectx-config.jar`;
  otherwise only `rsrc/` and `scenes/` are exposed (see `src/vfs.ts`).
- It hosts and distributes no game files. Each player supplies their own install.
- It does not connect to any game server.

## Running it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5174 and choose your install folder. In development, a
"Use local dev install" button reads a local Steam install directly (set `SK_DIR` to point
elsewhere). That route exists only in the dev server, never in a production build.

```bash
npm run build
```

The production build in `dist/` is a static site with no server component.

## Developer tools

These read the local install from Node and print reports. None of them copy data anywhere.

| Command | What it does |
|---|---|
| `npm test` | Format and parameter-path unit tests; needs no game files |
| `npm run e2e -- <folder>` | Picks a mock install through the folder input in Chromium, Firefox and WebKit (needs `npm run dev`) |
| `npm run scan` | Parses every `.dat` under `rsrc/` and reports failures |
| `npx tsx tools/dump.ts <path>` | Prints one file's object graph |
| `npx tsx tools/meshes.ts <path>` | Summarizes a model's meshes and materials |
| `npx tsx tools/config.ts config/material.dat "<name>"` | Prints one named config |
| `npx tsx tools/scenes.ts` | Summarizes the cached scenes |
| `python tools/gen_registry.py <src roots>` | Rebuilds the enum/class registry from Clyde, Narya and Nenya sources |

## Layout

| Path | Contents |
|---|---|
| `src/export/` | Schema-less reader for Clyde's binary export format |
| `src/config/` | Clyde parameter system and material/texture resolution |
| `src/model.ts` | Model and animation loading |
| `src/scene.ts` | Tudey scene loading |
| `src/render/` | WebGL 2 renderer and fixed-function emulation |
| `src/vfs.ts` | Read-only install access |
| `docs/` | Plan, research notes, status, outreach draft |

## License

New code is under the BSD 2-Clause license (see LICENSE). This project contains no code
from Clyde, Narya or Nenya, but its file-format and parameter logic follows their published
sources; see THIRD_PARTY_NOTICES.md. Spiral Knights is a trademark of its owner, and this
project is not affiliated with or endorsed by Grey Havens or Three Rings.
