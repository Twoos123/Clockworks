# Spiral Knights asset pipeline (reference / placeholder assets)

How the Spiral Knights 3D models get from the Steam install into this Unreal
project, for use as **local reference and placeholders only**.

> **Licensing.** Everything extracted this way is Grey Havens / SEGA property.
> The Spiral Knights terms of service forbid extracting or redistributing game
> assets. `Content/SK/` is git-ignored and must never be committed, shared, or
> shipped. Replace every SK asset with original art before anything leaves this
> machine.

## Overview

```
Steam\Spiral Knights\rsrc\**\*.dat          Clyde binary models (Three Rings engine)
        │  SKExport.exe  (headless wrapper around the ThreeRingsSharp library)
        ▼
D:\Dev\SKAssets\<same path>.glb             glTF 2.0 binary, textures embedded
        │  Tools\SKImport\stage_and_import.py
        ▼
D:\Dev\SKAssets\_staging\<Category>\<Name>.glb + Tools\SKImport\import.json
        │  UnrealEditor-Cmd.exe -run=ImportAssets   (Interchange glTF importer)
        ▼
Content\SK\<Category>\<Name>\{SkeletalMeshes,StaticMeshes,Materials,Textures}
```

## Tools (all outside the repo, under `D:\Dev\Tools`)

| Tool | What it is | Where |
|------|-----------|-------|
| ThreeRingsSharp | C# port of the Clyde model reader plus a glTF exporter (modified MIT). Cloned from https://github.com/EtiTheSpirit/ThreeRingsSharp and built with MSBuild (.NET Framework 4.7.2). Three local patches, see below. | `D:\Dev\Tools\ThreeRingsSharp` |
| SKExport | ~120-line console app that drives the ThreeRingsSharp library without its WinForms GUI: batch `.dat` → `.glb`. | `D:\Dev\Tools\SKExport` (exe in `bin\Release\net472`) |
| SKConfigDump | Tiny Java program that converts the game's `rsrc/config/*.dat` tables to Clyde XML using the game's own jar. Needed once to build ThreeRingsSharp's `MergedConfigReferences.bin` (material and texture lookups). | `D:\Dev\Tools\SKConfigDump` |
| KnightLauncher / SpiralView | Investigated and **not needed**: they view models but export nothing. | – |

### Local patches to ThreeRingsSharp (not upstream)

1. `XansData/IO/GLTF/GLTFExporter.cs` — GLB chunk padding. The original padded
   by `length % 4` bytes instead of up to the next multiple of four, which
   leaves chunks misaligned and crashes Unreal's glTF reader ("seek past the
   end of file"). Both the JSON and BIN chunks are now padded correctly.
2. `DataHandlers/Parameters/ModelPropertyUtility.cs` — texture-variant
   discovery skips a parameter it cannot traverse instead of aborting the model.
3. `XansData/Extensions/ParameterizedConfigExtension.cs` — arguments that hit
   an untraversable direct path (sound pitch/file on animations) are logged and
   skipped instead of aborting the model.

`DataHandlers/Parameters/XDirect.cs` also gained a descriptive exception message.

### Config references

ThreeRingsSharp resolves material/texture names through the game's config
tables. Those tables contain Spiral Knights-only classes, so:

1. `SKConfigDump\Dat2Xml.java` converts `rsrc\config\*.dat` to XML with the
   game's bundled JVM (`java_vm\bin\java.exe`, Java 25; the jar is obfuscated,
   `readObject` is `qd()` and `writeObject` is `bg(Object)`).
2. The XML goes in `ConfigRefs\` next to `SKExport.exe`. On first run
   ThreeRingsSharp prunes SK-only entries and writes `MergedConfigReferences.bin`.
   `item.dat` fails to convert and must not be present as an empty file.

Already done; only redo it if the game updates its config tables.

## Exporting models

```bash
cd D:\Dev\Tools\SKExport\bin\Release\net472
SKExport.exe --rsrc "C:\Program Files (x86)\Steam\steamapps\common\Spiral Knights\rsrc" --out D:\Dev\SKAssets --embed --no-scale100 --quiet --list D:\Dev\SKAssets\batch_characters.txt
```

- Paths in the list file are relative to `rsrc`; output mirrors the folder tree.
- `--embed` puts the PNG textures inside the `.glb` (required; otherwise the
  file references absolute paths).
- `--no-scale100` keeps Clyde units (metres). Interchange multiplies glTF by
  100 on import, so a 1.1 m wolver becomes ~110 uu tall. Do not combine the
  x100 export option with the import scale.
- Exit code 2 means at least one file failed; the log says which.

Known export limits (ThreeRingsSharp):
- The player knight (`character/pc/model.dat`) and NPC knights only export face
  and helmet pieces. Armour (`item/gear/armor/*/model.dat`) exports as an
  unrigged static mesh because its skeleton is an external reference the
  library does not follow. The ThreeRingsSharp 2.3.2 release ships
  `PlayerKnightAsArticulatedConfig.Fixed.dat` for a rigged knight; not
  downloaded yet.
- `world/prop/clockworks/fan_x2_01.dat` fails with a `KeyNotFoundException`.
- Only triangle-list geometry is exported; `Composite` animations are skipped.

## Importing into Unreal

```bash
python Tools\SKImport\stage_and_import.py --import
python Tools\SKImport\stage_and_import.py --import --groups Monsters
```

The script copies each `.glb` to `D:\Dev\SKAssets\_staging\<Category>\<Name>.glb`
(the asset name comes from the file name), writes `Tools\SKImport\import.json`,
and runs the `ImportAssets` commandlet. The editor may stay open: the commandlet
is a separate process and the Content Browser picks up the new files.

Import notes:
- Interchange creates `<Name>\SkeletalMeshes`, `StaticMeshes`, `Materials`,
  `Textures` subfolders. AnimSequences land in `SkeletalMeshes` named
  `<Name><animation>` (e.g. `Wolvermoving`). Skeletons and PhysicsAssets are
  created per skinned mesh.
- Tileset files such as `CW_FloorBase` contain 100+ small meshes and import as
  one StaticMesh each (139 for the floor). Merge or cherry-pick as needed.
- Materials are Interchange instances of `MI_Default_Opaque` etc. with the
  base colour texture wired in. Spiral Knights uses unlit textures, so they look
  darker under Unreal lighting.
- Two models (Jellycube, Lichen) have a 0.033 s animation that is dropped
  ("not frame-border aligned"). `CW_ControlConsole` has one invalid primitive.
  Harmless.

## What is imported today (2026-09-13)

- Monsters: Wolver, Jellycube, Lichen, Gunpuppy, Zombie, Mechaknight, Spookat,
  Snarbolax, RoyalJelly, GremlinArtillery, Devilite, Chromalisk, TrainingBag,
  TrainingTarget (skeletal meshes, skeletons, animations, textures).
- Knights: CrewKnight, PlayerKnight (face and helmet static meshes only).
- Weapons: Calibur. Gear: HelmCap, ShieldBuckler, ArmorCoat (static).
- World/Clockworks: floor, wall, roof gear, fences, edge rail, control console,
  conveyor, lamp rail. World/Props: AltarX3, Bones.

To add more, append rows to `MODELS` in `stage_and_import.py`, add the `.dat`
paths to a batch list, export, and re-run the script with `--groups`.
