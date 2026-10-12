# Status

Last updated 2026-10-12. Measured against a Steam install updated 2026-10-07.

## Where this is against the plan

| Phase in docs/PLAN.md | State | Notes |
|---|---|---|
| 0. Groundwork | Partly done | Repo, licenses, no-server rule, install inventory done. Outreach email drafted but **not sent**. Public hosting and a self-hosted mirror not set up. |
| 1. Proof of concept: model viewer | Done | All exit criteria met except the TeaVM ones; see "Decision: TypeScript instead of TeaVM" below. |
| 2. World viewer and platform layer | Started | Cached Tudey scenes render with instancing. Audio, UI, OPFS cache and PWA not started. |
| 3. Clean-room offline game layer | Not started | |
| 4. Networking | Not started | |
| 5. Distribution hardening | Not started | Production build works as a static site. |
| 6. Blessing | Not started | Depends on Grey Havens. |

## Measured results

| Check | Result |
|---|---|
| `.dat` files parsed byte-exact | 7,459 of 7,459 |
| Model files loaded and uploaded to the GPU in the browser | 2,693 of 2,693, no failures |
| Material uses resolved from the install's material library | 7,485 of 7,485 |
| Cached scenes loaded | 12 of 12 |
| Haven Town Square | 17,710 tiles, 1,675 props, 489 distinct models, loads in about 1.3 s |
| Haven draw calls after instancing | about 955 per frame, down from about 30,000 |
| Haven frame time (integrated timing, 923×1274 canvas) | about 7 ms |
| Production bundle | 37 KB gzipped |
| Unit tests (no game files needed) | 8 of 8 passing |

## Decision: TypeScript instead of TeaVM for the viewer

The plan proposed compiling Clyde's Java export system with TeaVM. Reading Clyde's
BinaryExporter showed the format is self-describing: class names, field names and field
types are all in the stream. A schema-less reader in TypeScript therefore covers every file
without compiling any Java and without the reflection whitelisting that TeaVM would need.
The renderer, material system and scene loader followed the same route.

TeaVM is still the likely tool for Phase 3, where reusing Clyde's Java Tudey logic (actors,
movement, collision) may beat reimplementing it. The next TeaVM step is a spike that compiles
Clyde's `tudey` and `math` packages and calls them from this viewer.

## Known gaps

- **Colorization.** Recolorable surfaces show their raw template colors (bright magenta and
  yellow). The color definitions live in `rsrc/config/media/colordefs.dat` inside
  `code/projectx-config.jar`, which the viewer does not read. See "Decisions for you".
- **Particles** (888 particle-system models) are skipped.
- **Custom shaders.** `Vertex/Skin` and `Fragment/Diffuse` are emulated. `Vertex/Wave` (6
  uses) and `Fragment/Emissive` (1 use) are not.
- **Animated texture state.** Scrolling textures (`Model/Scrolling/*`, 120 uses in Haven)
  draw without their texture because it is set by dynamic bindings, not arguments.
- **Scene globals.** Scene lighting, fog and skyboxes are ignored; one fixed light is used.
- **Guild furniture.** 851 player-placed furniture props in the cached guild hall are not
  drawn, because their model is chosen by the proprietary game code.
- **Untested paths.** The Chromium directory picker and the Firefox/Safari folder input
  were not clicked through by hand. The folder-input code path was exercised in-page.

## Decisions for you

1. **Color definitions.** Reading the single data file `rsrc/config/media/colordefs.dat` from
   the player's own `code/projectx-config.jar`, locally in their browser, would fix
   colorization. It is data rather than code, but it breaks the "never read code/" rule the
   plan adopted for the clean-room posture. The default here is to keep the rule.
2. **Sending the outreach email.** A draft is in `docs/outreach/grey-havens-email.md`.
   The plan recommends sending it privately before anything is public.
3. **Hosting.** The plan recommends a project name and domain free of the game's trademarks
   and a self-hosted git mirror before publishing.

## Side findings

- The live client in `code/` ships LWJGL 3 with GLFW, the lwjgl3-awt bridge, and
  macOS arm64 natives. This confirms the 2026 LWJGL 3 migration that the research could
  only infer.
