# Clockworks

An isometric co-op action dungeon crawler in the spirit of **Spiral Knights**:
real-time melee combat, a run down through the Clockworks to the Core, two
players online. Built in Unreal Engine 5.8, C++ first.

This is a solo passion project in development. The current target is a
showable demo, decided 2026-09-14:
- **The run:** the full Clockworks loop, compressed to one floor of each kind:
  lobby, tunnels, terminal, themed stratum, boss and Core (eight depths, one
  tileset).
- **Weapons and gear:** all three weapon classes (sword, gun, bomb) and the
  original's shields, helmets, armour and trinkets, from the game's own data.
- **Menus:** a main menu and an in-game gear screen.
- **Players:** single player for now; online sessions are deferred, not cut.

## Status

| Phase | State |
|---|---|
| 01 Project and version control | Done |
| 02 Two-player testing loop | Done |
| 03 Isometric camera and Spiral Knights movement | Done |
| 04 Combat spine on the Gameplay Ability System | Done |
| 05 Enemies | In progress: 12 monsters on the original's numbers by depth, bosses being built |
| 06 The Clockworks run | In progress: depths, elevator and floor population in `Lvl_Run`; real floor layouts next |
| 07 Online sessions | Deferred until the single-player demo is whole |
| 08 Gear | Largely built: 351 weapons and 623 pieces of gear, the gear screen; unseen in play |
| 09 Readability and feel | Partly built: HUD, hit flash, hitstop, damage numbers, health bars, status icons |
| 10 Ship | Planned |

What each phase means and why: [PLAN.md](PLAN.md). What is built, in detail, and
the rules for working in the repo: [CLAUDE.md](CLAUDE.md). What the demo still
needs, in order: [Docs/DemoTodo.md](Docs/DemoTodo.md).

**Nothing since phase 05 has been tested in two-player play yet.** Every system
is still written server-authoritative, so the two-player test gate is suspended
rather than dropped.

## Controls

The Spiral Knights keyboard-and-mouse scheme.

| Action | Input |
|---|---|
| Move | W A S D, relative to the screen |
| Aim | Mouse cursor; the knight always faces it |
| Attack | Left mouse button; hold after a swing or shot to charge |
| Shield | Hold right mouse button |
| Shield bash | Shift + left mouse button |
| Dodge | Shift + right mouse button |
| Switch weapon | Space or mouse wheel |
| Gear screen | L |
| Menu | Esc |
| How to play | F1 |

## Requirements

- Windows, Unreal Engine 5.8 (Epic Games Launcher install), Visual Studio 2022
  with the Unreal workload.
- Git with Git LFS. Run `git lfs install` once before cloning; all `.uasset`
  and `.umap` files are LFS objects.
- Python 3 for the asset and data tools in `Tools/SKImport`.

## Building

From a `cmd` prompt in the repo root (adjust the engine path if needed):

```
"C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat" -projectfiles -project="%CD%\Clockworks.uproject" -game -rocket -progress
"C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat" ClockworksEditor Win64 Development -Project="%CD%\Clockworks.uproject" -WaitMutex
```

Then open `Clockworks.uproject`. The maps:
- `Lvl_Run`: the playable run.
- `Lvl_Bestiary`: every monster in a row.
- `Lvl_TopDown`: the original test map.

## Reference assets are not in this repository

The models, animations, sounds, icons and cursors are Spiral Knights' own. They
were extracted locally as placeholders and live in `Content/SK/`, which is
git-ignored: they are Grey Havens / SEGA property.

A fresh clone builds and opens without them, but most Blueprints and data
assets will show missing meshes, clips and sounds. How they are extracted and
imported: [Docs/SpiralKnightsAssetPipeline.md](Docs/SpiralKnightsAssetPipeline.md).

## Tools

Most assets are generated, not hand-authored: the weapon catalogue, the gear, the
monsters and the levels.
- **How they run:** editor Python scripts in `Tools/SKImport`, run headless
  through a commandlet so they need no open editor:

  ```
  UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript -script="<absolute path to the script>"
  ```

- **What they read:** the `.json` files beside them, numbers and file paths mined
  from the game's config dumps.
- **The script list, running order and known traps:** [Docs/Handoff.md](Docs/Handoff.md).

## Testing

The development loop is two players in the editor:
1. On the toolbar, open the Play button's dropdown.
2. Set Number of Players to `2` and Net Mode to `Play As Listen Server`.

One window hosts and the other joins. In the console, `showdebug AbilitySystem`
shows health, tags and abilities per player.

## Layout

```
Source/Clockworks/               C++ module
  ClockworksCharacter.*          the knight: movement, aim, weapons, shield, gear looks, sounds
  ClockworksPlayerController.*   cursor aiming, menus, music
  ClockworksPlayerState.*        the player's ability system, loadout and gear
  ClockworksEnemyCharacter.*     monster base: damage reaction, depth numbers, death
  ClockworksProjectile.*         bullets and their bursts, splits and orbitals
  ClockworksGameplayTags.*       native gameplay tags
  AbilitySystem/                 attribute set, weapon and monster abilities, statuses
  AI/                            the monster brain
  Combat/                        bombs, hit sparks, status visuals
  Gear/                          weapon and gear definitions, attack profiles, gear stats
  UI/                            HUD, gear screen, menus
  World/                         depth, elevator, floor director
  Debug/                         input log
Content/TopDown/                 maps, Blueprints, materials, input
  Blueprints/Monsters/           the generated monsters
  Gear/Catalogue/                the 351 weapons (DA_Weapon_*)
  Gear/Knight/                   the 623 shields, helmets, armours and trinkets (DA_Gear_*)
Content/SK/                      Spiral Knights reference assets (local only, git-ignored)
Tools/SKImport/                  extraction, import and generator scripts and their data
Docs/                            reference, pipeline, demo to-do, knight checklist, handoff
Config/                          project settings
```

The template's `Variant_Strategy` and `Variant_TwinStick` folders are Epic
sample code left in place and unused.

## Design rules

- Server-authoritative from the first line. Clients send intent, the server
  decides, the server replicates the result.
- C++ owns gameplay logic and anything replicated. Blueprints are thin
  children that assign assets and tuning values.
- Networking is listen server only: one player hosts, one joins.

The full rule set, including what is deliberately out of scope, is in
[CLAUDE.md](CLAUDE.md).

## Licence

Not yet decided. Engine content from the Unreal Engine templates is covered by
the Unreal Engine EULA. The Spiral Knights reference assets are not included and
not licensed for redistribution.
