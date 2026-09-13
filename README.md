# Clockworks

An isometric co-op action dungeon crawler in the spirit of **Spiral Knights**:
real-time melee combat, floors assembled procedurally from hand-built room
modules, two players online. Built in Unreal Engine 5.8, C++ first.

This is a solo passion project in early development. The current target is a
vertical slice: one floor, one sword, three enemy types, eight room modules,
two players, about ten minutes of play.

## Status

| Phase | State |
|---|---|
| 01 Project and version control | Done |
| 02 Two-player testing loop | Done |
| 03 Isometric camera and Spiral Knights movement | Done |
| 04 Combat spine on the Gameplay Ability System | Done |
| 05 Three enemies | Next |
| 06 Clockworks floor assembly | Planned |
| 07 Online sessions | Planned |
| 08 Gear | Planned |
| 09 Readability and feel | Planned |
| 10 Ship | Planned |

See [PLAN.md](PLAN.md) for what each phase means and the decisions behind it.

## Controls

Modelled on the Spiral Knights keyboard-and-mouse scheme.

| Action | Input |
|---|---|
| Move | W A S D, relative to the screen |
| Aim | Mouse cursor; the knight always faces it |
| Attack | Left mouse button |
| Dodge | Shift + right mouse button |

Right mouse alone is reserved for the shield, Space for weapon switching.

## Requirements

- Windows, Unreal Engine 5.8 (Epic Games Launcher install), Visual Studio 2022
  with the Unreal workload.
- Git with Git LFS. Run `git lfs install` once before cloning; all `.uasset`
  and `.umap` files are LFS objects.

## Building

From a `cmd` prompt in the repo root (adjust the engine path if needed):

```
"C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat" -projectfiles -project="%CD%\Clockworks.uproject" -game -rocket -progress
"C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat" ClockworksEditor Win64 Development -Project="%CD%\Clockworks.uproject" -WaitMutex
```

Then open `Clockworks.uproject`. The startup map is `Lvl_TopDown`.

## Testing

Every feature is tested as two players before it counts as done. In the
editor: Play button dropdown → Number of Players `2`, Net Mode
`Play As Listen Server`. One window hosts, the other joins. `showdebug
AbilitySystem` in the console shows health, tags and abilities per player.

## Layout

```
Source/Clockworks/               C++ module
  ClockworksCharacter.*          player pawn: movement, aim, ability wiring
  ClockworksPlayerController.*   cursor aiming
  ClockworksPlayerState.*        hosts the player's ability system component
  ClockworksEnemyCharacter.*     enemy base: damage reaction, death
  ClockworksGameplayTags.*       native gameplay tags
  AbilitySystem/                 attribute set, abilities, effects
Content/TopDown/                 the playable map and its Blueprints
Content/Characters/              Epic mannequins and animations
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
the Unreal Engine EULA.
