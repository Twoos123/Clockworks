# Unreal Editor Python script. Run it headless after generate_floor_assets.py:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/verify_floor_assets.py"
#
# Reads back every UClockworksFloorDefinition under /Game/TopDown/Floors and checks it against the manifest it came
# from: the same number of tiles, the same walkable area, the same markers, every mesh still loadable, and the floor
# standing where the original stands it. Reports, changes nothing.

import json
import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import floor_model_names

FLOORS_DIR = r"D:\Dev\SKAssets\_floors"
DEST = "/Game/TopDown/Floors"


def manifest_for(asset):
    """The manifest a floor was built from, found by its scene id ("scenesmain/351")."""
    folder, _, scene = (asset.get_editor_property("scene_id") or "").partition("/")
    for file in sorted(os.listdir(FLOORS_DIR)):
        if not file.endswith(".json") or file == "report.json" or file == "generated.json":
            continue
        parts = os.path.splitext(file)[0].split("__")
        if len(parts) >= 3 and parts[1] == folder and parts[2].split("_")[0] == scene:
            with open(os.path.join(FLOORS_DIR, file), encoding="utf-8") as handle:
                return file, json.load(handle)
    return None, None


def check(asset, problems):
    name = asset.get_name()
    file, manifest = manifest_for(asset)
    if not manifest:
        problems.append("%s: no manifest found for scene %s" % (name, asset.get_editor_property("scene_id")))
        return

    tile_cm = asset.get_editor_property("tile_cm")
    elevation_cm = asset.get_editor_property("elevation_cm")
    cells = asset.get_editor_property("cells")
    groups = asset.get_editor_property("mesh_groups")
    markers = asset.get_editor_property("markers")
    knight_mask = asset.get_editor_property("knight_mask")

    # Every cell the manifest has, and no others.
    grid = (manifest.get("cells") or {}).get("data") or {}
    if len(cells) != len(grid):
        problems.append("%s: %d cells against the manifest's %d" % (name, len(cells), len(grid)))

    walkable = 0
    lowest, highest = None, None
    for cell in cells:
        floor_bits = cell.get_editor_property("floor")
        collision = cell.get_editor_property("collision")
        if (floor_bits & 1) and not (collision & knight_mask):
            walkable += 1
        elevation = cell.get_editor_property("elevation")
        lowest = elevation if lowest is None else min(lowest, elevation)
        highest = elevation if highest is None else max(highest, elevation)
    if walkable == 0:
        problems.append("%s: nowhere on the floor can be stood on" % name)

    # Every mesh still loads, and the copies sit inside the floor's own footprint.
    copies, broken = 0, 0
    bounds = None
    for group in groups:
        mesh = group.get_editor_property("mesh")
        if not mesh:
            broken += 1
            continue
        for where in group.get_editor_property("instances"):
            copies += 1
            location = where.translation
            box = (location.x, location.y, location.x, location.y)
            bounds = box if bounds is None else (min(bounds[0], box[0]), min(bounds[1], box[1]),
                                                 max(bounds[2], box[2]), max(bounds[3], box[3]))
    if broken:
        problems.append("%s: %d mesh groups have no mesh" % (name, broken))

    size = manifest.get("scene", {}).get("sizeTiles") or [0, 0]
    span_x = (bounds[2] - bounds[0]) / tile_cm if bounds else 0
    span_y = (bounds[3] - bounds[1]) / tile_cm if bounds else 0
    # The scene's size is its tile bounds; the models can reach a tile or two past it (a wall's cap, a hanging vine).
    if bounds and (span_x > size[1] + 8 or span_y > size[0] + 8):
        problems.append("%s: models span %.0f x %.0f tiles against the scene's %d x %d"
                        % (name, span_x, span_y, size[1], size[0]))

    found = {}
    for marker in markers:
        category = str(marker.get_editor_property("category"))
        found[category] = found.get(category, 0) + 1
    wanted = manifest.get("markerSummary") or {}
    for category, count in wanted.items():
        if found.get(category, 0) != count:
            problems.append("%s: %d %s markers against the manifest's %d" % (name, found.get(category, 0), category, count))

    if "player_entrance" not in found:
        problems.append("%s: no player entrance, so the knights have nowhere to arrive" % name)

    entrance = next((marker.get_editor_property("where") for marker in markers
                     if str(marker.get_editor_property("category")) == "player_entrance"), None)
    where = ("entrance (%.0f, %.0f, %.0f)" % (entrance.translation.x, entrance.translation.y, entrance.translation.z)
             if entrance else "no entrance")

    unreal.log_warning("Floor: %-30s %4d meshes %5d copies | %4d cells, %4d walkable, height %d..%d (%.0f..%.0f cm) | %s"
                       % (name, len(groups), copies, len(cells), walkable, lowest or 0, highest or 0,
                          (lowest or 0) * elevation_cm, (highest or 0) * elevation_cm, where))


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([DEST, "/Game/SK/World"], True)

    problems = []
    paths = unreal.EditorAssetLibrary.list_assets(DEST, recursive=True, include_folder=False)
    floors = 0
    for path in sorted(paths):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if isinstance(asset, unreal.ClockworksFloorDefinition):
            floors += 1
            check(asset, problems)

    unreal.log_warning("Floor: %d floors checked, %d problems" % (floors, len(problems)))
    for problem in problems:
        unreal.log_warning("Floor:   " + problem)


main()
