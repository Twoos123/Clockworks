"""Stage exported Spiral Knights glTF files under readable names and build the
ImportAssets commandlet config for Unreal.

Pipeline (see Docs/SpiralKnightsAssetPipeline.md):
  rsrc/*.dat  --SKExport.exe-->  D:/Dev/SKAssets/<rsrc path>.glb
              --this script-->   D:/Dev/SKAssets/_staging/<Category>/<Name>.glb + import.json
              --UnrealEditor-Cmd -run=ImportAssets-->  Content/SK/<Category>/<Name>/...

Everything under Content/SK/ is git-ignored: these are Grey Havens / SEGA assets used
as local reference and placeholders only.

Usage:
  python Tools/SKImport/stage_and_import.py            # stage + write import.json
  python Tools/SKImport/stage_and_import.py --import   # ...and run the commandlet
  python Tools/SKImport/stage_and_import.py --import --groups Gear,Monsters   # only these categories
"""
import json
import os
import shutil
import subprocess
import sys

SK_ASSETS = r"D:\Dev\SKAssets"
STAGING = os.path.join(SK_ASSETS, "_staging")
UE_CMD = r"C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
PROJECT = r"D:\Dev\Clockworks\Clockworks.uproject"
IMPORT_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "import.json")

# (exported glb relative to SK_ASSETS, content folder under /Game/SK, asset name)
MODELS = [
    # Monsters: skinned + animated (ArticulatedConfig)
    (r"character\npc\monster\wolver\model.glb",            "Monsters", "Wolver"),
    (r"character\npc\monster\jellycube\model.glb",         "Monsters", "Jellycube"),
    (r"character\npc\monster\lichen\model.glb",            "Monsters", "Lichen"),
    (r"character\npc\monster\gunpuppy\model.glb",          "Monsters", "Gunpuppy"),
    (r"character\npc\monster\zombie\model.glb",            "Monsters", "Zombie"),
    (r"character\npc\monster\mechaknight\model.glb",       "Monsters", "Mechaknight"),
    (r"character\npc\monster\spookat\model.glb",           "Monsters", "Spookat"),
    (r"character\npc\monster\snarbolax\model.glb",         "Monsters", "Snarbolax"),
    (r"character\npc\monster\royaljelly\model.glb",        "Monsters", "RoyalJelly"),
    (r"character\npc\monster\gremlin\artillery\model.glb", "Monsters", "GremlinArtillery"),
    (r"character\npc\monster\devilite\model_fir.glb",      "Monsters", "Devilite"),
    (r"character\npc\monster\chromalisk\model_cloaked.glb","Monsters", "Chromalisk"),
    (r"character\npc\monster\trainingbag\model.glb",       "Monsters", "TrainingBag"),
    (r"character\npc\monster\trainingtarget\model.glb",    "Monsters", "TrainingTarget"),
    # Knights
    (r"character\npc\crew\model.glb",                      "Knights",  "CrewKnight"),
    # Rigged knight: character/pc/model.dat re-typed from ProjectXModelConfig to ArticulatedConfig
    # (see Docs/SpiralKnightsAssetPipeline.md), wearing the cap helm and coat armour.
    (r"_fixed\PlayerKnight.glb",                           "Knights",  "PlayerKnight"),
    # Weapons and gear (static)
    (r"item\weapon\sword\calibur\model.glb",               "Weapons",  "Calibur"),
    (r"item\gear\helm\cap\model.glb",                      "Gear",     "HelmCap"),
    (r"item\gear\shield\buckler\model.glb",                "Gear",     "ShieldBuckler"),
    # Knight body armour exports unrigged (its skeleton is an external reference TRS does not follow)
    (r"item\gear\armor\coat\model.glb",                    "Gear",     "ArmorCoat"),
    # Clockworks tileset and props
    (r"world\tileset\clockworks\floor\floor_base.glb",     "World/Clockworks", "CW_FloorBase"),
    (r"world\tileset\clockworks\wall\wall.glb",            "World/Clockworks", "CW_Wall"),
    (r"world\tileset\clockworks\wall\roof_gear_6x2.glb",   "World/Clockworks", "CW_RoofGear6x2"),
    (r"world\tileset\clockworks\fence\fence_high.glb",     "World/Clockworks", "CW_FenceHigh"),
    (r"world\tileset\clockworks\fence\fence_low.glb",      "World/Clockworks", "CW_FenceLow"),
    (r"world\tileset\clockworks\edge_rail\rail.glb",       "World/Clockworks", "CW_EdgeRail"),
    (r"world\prop\clockworks\factory\control_console.glb", "World/Clockworks", "CW_ControlConsole"),
    (r"world\prop\clockworks\factory\conveyor_x2_01.glb",  "World/Clockworks", "CW_Conveyor2"),
    (r"world\prop\clockworks\lamp_rail01.glb",             "World/Clockworks", "CW_LampRail"),
    (r"world\prop\generic\altar_x3.glb",                   "World/Props",      "AltarX3"),
    (r"world\prop\generic\bones.glb",                      "World/Props",      "Bones"),
]


def fix_glb(src, dst):
    """Copy a ThreeRingsSharp .glb, dropping scene-root entries for nodes that also have a
    parent. ThreeRingsSharp lists skeleton bones both under their parent and as scene roots,
    which is invalid glTF; Unreal then re-roots those bones and the skin explodes."""
    import struct
    data = open(src, "rb").read()
    json_len = struct.unpack("<I", data[12:16])[0]
    js = json.loads(data[20:20 + json_len])
    rest = data[20 + json_len:]  # BIN chunk, already 4-byte aligned by the patched exporter
    parented = {c for n in js.get("nodes", []) for c in n.get("children", [])}
    for scene in js.get("scenes", []):
        scene["nodes"] = [i for i in scene["nodes"] if i not in parented]
    body = json.dumps(js, separators=(",", ":")).encode("utf-8")
    body += b" " * ((4 - len(body) % 4) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(body) + len(rest))
    out += struct.pack("<II", len(body), 0x4E4F534A) + body + rest
    open(dst, "wb").write(out)


def stage(only=None):
    groups = {}
    missing = []
    for rel, category, name in MODELS:
        if only and category not in only:
            continue
        src = os.path.join(SK_ASSETS, rel)
        if not os.path.isfile(src):
            missing.append(rel)
            continue
        dst_dir = os.path.join(STAGING, category.replace("/", os.sep))
        os.makedirs(dst_dir, exist_ok=True)
        dst = os.path.join(dst_dir, name + ".glb")
        fix_glb(src, dst)
        groups.setdefault(category, []).append(dst)

    cfg = {"ImportGroups": [
        {
            "GroupName": "SK_" + category.replace("/", "_"),
            "Filenames": files,
            "DestinationPath": "/Game/SK/" + category,
            "bReplaceExisting": True,
            "bSkipReadOnly": True,
        }
        for category, files in groups.items()
    ]}
    with open(IMPORT_JSON, "w") as f:
        json.dump(cfg, f, indent=2)
    staged = sum(len(v) for v in groups.values())
    print(f"staged {staged} files in {len(groups)} groups -> {IMPORT_JSON}")
    for rel in missing:
        print("MISSING", rel)
    return staged


def run_import():
    cmd = [UE_CMD, PROJECT, "-run=ImportAssets", f"-importsettings={IMPORT_JSON}",
           "-nosourcecontrol", "-unattended", "-nopause", "-stdout", "-FullStdOutLogOutput"]
    print("running:", " ".join(cmd))
    return subprocess.call(cmd)


if __name__ == "__main__":
    only = None
    if "--groups" in sys.argv:
        only = sys.argv[sys.argv.index("--groups") + 1].split(",")
    if stage(only) and "--import" in sys.argv:
        sys.exit(run_import())
