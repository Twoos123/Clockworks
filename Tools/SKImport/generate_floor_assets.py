# Unreal Editor Python script. Run it headless:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/generate_floor_assets.py"
#
# Turns the archived Spiral Knights scenes in D:\Dev\SKAssets\_floors into UClockworksFloorDefinition assets under
# /Game/TopDown/Floors, one per floor: every tile and prop where the original stands it, the collision grid under them,
# the props' own barriers, and the markers that say where the knights arrive and where the elevator is.
#
# Which floors it builds: the FLOORS list below, or the manifest names in the SK_FLOORS environment variable
# (comma-separated, without .json). Run Tools/SKImport/stage_and_import.py --import --groups World/Floors --floors <same>
# first, or the floor will be built with no models in it.
#
# Re-runnable: an existing asset is overwritten in place, so a floor can be regenerated after a better export.

import json
import os
import re
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import floor_model_names

FLOORS_DIR = r"D:\Dev\SKAssets\_floors"
DEST = "/Game/TopDown/Floors"
REPORT = r"D:\Dev\SKAssets\_floors\generated.json"
# What each marker actually is and what it is wired to, recovered from the scene archive.
INTERACTIVE_DIR = r"D:\Dev\SKAssets\_floors\interactive"
OBJECT_CLASSES = r"D:\Dev\SKAssets\_researchloor_objects\object_classes.json"

# The floors to build when nothing else is asked for. The Mission Lobby is the calibration case: it is small, it is the
# one floor whose layout can be checked against memory, and it is where the run's four elevators will stand.
FLOORS = ["Mission_Lobby__scenesmain__351"]


def camel(text):
    return "".join(part[:1].upper() + part[1:] for part in re.split(r"[^A-Za-z0-9]+", text) if part)


def asset_name(manifest_file):
    """"Clockwork_Tunnels_Slimeway__scenesmainarcade__1073741922" -> "DA_Floor_ClockworkTunnelsSlimeway_Arcade_1073741922".

    The scene id is kept because the archive holds several captures of the same level, and they are different layouts.
    So is the folder: five floors - the Snarbolax lair, all three of the Royal Jelly Palace and the Unknown Passage -
    exist once under scenesmain and again under scenesmainarcade with the same id, and they are not the same floor."""
    stem = os.path.splitext(manifest_file)[0]
    parts = stem.split("__")
    folder = parts[1] if len(parts) > 1 else ""
    where = camel(folder[len("scenesmain"):]) if folder.startswith("scenesmain") else camel(folder)
    scene = camel("_".join(parts[2:]) if len(parts) > 2 else "")
    return "_".join(part for part in ["DA_Floor", camel(parts[0]), where, scene] if part)


def transform(entry):
    """The manifest's own Unreal transform: cm, a rotator in (pitch, yaw, roll), and a uniform scale."""
    location = entry["location"]
    rotator = entry["rotator"]
    scale = float(entry.get("scale") or 1.0)
    return unreal.Transform(
        location=unreal.Vector(location[0], location[1], location[2]),
        rotation=unreal.Rotator(roll=rotator[2], pitch=rotator[0], yaw=rotator[1]),
        scale=unreal.Vector(scale, scale, scale))


def color(globals_list, config, fallback=(0.0, 0.0, 0.0, 1.0)):
    """One of the scene's environment colours, written as "r, g, b, a"."""
    for entry in globals_list or []:
        if entry.get("config") == config:
            text = (entry.get("args") or {}).get("Color")
            if text:
                parts = [float(v) for v in text.split(",")]
                while len(parts) < 4:
                    parts.append(1.0)
                return unreal.LinearColor(parts[0], parts[1], parts[2], parts[3])
    return unreal.LinearColor(*fallback)


def music_asset(globals_list):
    """The floor's own music, if stage_and_import.py has imported it (Audio/M_<Name>)."""
    for entry in globals_list or []:
        if entry.get("config") == "Environment/Music":
            file = (entry.get("args") or {}).get("File") or ""
            stem = os.path.splitext(os.path.basename(file))[0]
            if not stem:
                return None, file
            path = "/Game/SK/Audio/M_" + camel(stem)
            return (path if unreal.EditorAssetLibrary.does_asset_exist(path) else None), file
    return None, ""


def load_object_classes():
    """config -> {behaviour, params}: the original's 373 placeable configs boiled down to door, switch, block, hazard
    and lift, with the numbers each needs. Written by the floor-objects research."""
    if not os.path.isfile(OBJECT_CLASSES):
        return {}
    with open(OBJECT_CLASSES, encoding="utf-8") as handle:
        data = json.load(handle)
    rows = data.get("configs") or []
    if isinstance(rows, dict):
        rows = list(rows.values())
    return {row["config"]: row for row in rows if row.get("config")}


def load_wiring(manifest_file):
    """marker id -> what that marker is wired to, from the interactive sidecar for the same floor."""
    path = os.path.join(INTERACTIVE_DIR, manifest_file)
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as handle:
        sidecar = json.load(handle)

    objects = sidecar.get("objects") or []
    wiring = {}
    for entry in sidecar.get("entries") or []:
        index = entry.get("object")
        if entry.get("id") is None or index is None or index >= len(objects):
            continue
        wiring[str(entry["id"])] = (objects[index], entry)
    return wiring


def emissions(obj):
    """The signals this object sends, as the floor definition wants them."""
    built = []
    for emit in obj.get("emits") or []:
        target = (emit.get("target") or {}).get("tag")
        if not target:
            continue
        entry = unreal.ClockworksFloorEmission()
        entry.set_editor_property("verb", emit.get("signal") or "open")
        entry.set_editor_property("target_tag", target)
        # The original's own wording: a handler fires either as the switch goes on or as it lets go.
        entry.set_editor_property("on_release", "Off" in (emit.get("via") or "") or emit.get("signal") == "close")
        built.append(entry)
    return built


def mesh_groups(manifest, report):
    """One entry per imported static mesh, carrying every copy of it on this floor.

    A model set's variant is several meshes (a catwalk tile is its deck, its underside and its trim), and the same mesh
    can be named by more than one group, so the copies are pooled by mesh rather than by group: fewer components to
    build, and the same picture."""
    pooled = {}
    order = []
    missing, skipped = set(), 0

    for group in manifest.get("meshes") or []:
        if group.get("editorOnly"):
            skipped += 1
            continue
        if not group.get("glbExists"):
            missing.add(group.get("glb") or "?")
            continue

        transforms = [transform(instance["unreal"] if "unreal" in instance else instance)
                      for instance in group.get("instances") or []]
        if not transforms:
            continue

        for node in group.get("nodes") or []:
            path = floor_model_names.mesh_object_path(group["glb"], node)
            if not unreal.EditorAssetLibrary.does_asset_exist(path):
                # A model with a single mesh in it is named after the file instead of after the node.
                single = floor_model_names.single_mesh_object_path(group["glb"])
                if len(group["nodes"]) == 1 and unreal.EditorAssetLibrary.does_asset_exist(single):
                    path = single
                else:
                    missing.add(path)
                    continue
            if path not in pooled:
                pooled[path] = []
                order.append((path, group.get("key") or group.get("glb")))
            pooled[path].extend(transforms)

    groups = []
    for path, source in order:
        entry = unreal.ClockworksFloorMeshGroup()
        entry.set_editor_property("mesh", unreal.load_asset(path))
        entry.set_editor_property("instances", pooled[path])
        entry.set_editor_property("source", source)
        groups.append(entry)

    report["missing_models"] = sorted(missing)
    report["editor_only_groups"] = skipped
    report["mesh_groups"] = len(groups)
    report["instances"] = sum(len(v) for v in pooled.values())
    return groups


def cells(manifest, report):
    """The collision grid: a height and a bit field per tile, which is what actually stops anything."""
    data = (manifest.get("cells") or {}).get("data") or {}
    built = []
    for key, value in data.items():
        x, y = (int(part) for part in key.split(","))
        cell = unreal.ClockworksFloorCell()
        cell.set_editor_property("tile", unreal.IntPoint(x, y))
        cell.set_editor_property("elevation", int(value[0]))
        cell.set_editor_property("collision", int(value[1]))
        cell.set_editor_property("floor", int(value[3]))
        built.append(cell)
    report["cells"] = len(built)
    return built


def shape_size_tiles(shape):
    """(width, height, is a circle) in tiles. A shape the exporter could not resolve becomes one tile, which is the
    grid's own size and the smallest honest guess for a prop that says only "I block"."""
    if not shape:
        return 1.0, 1.0, False
    kind = shape.get("kind")
    if kind == "Circle":
        radius = float(shape.get("radius") or 0.5)
        return radius * 2.0, radius * 2.0, True
    if kind == "Compound":
        parts = shape.get("shapes") or []
        width = max([float(part.get("width") or 1.0) for part in parts] or [1.0])
        height = max([float(part.get("height") or 1.0) for part in parts] or [1.0])
        return width, height, False
    return float(shape.get("width") or 1.0), float(shape.get("height") or 1.0), False


def blockers(manifest, tile_cm, report):
    """Every prop that stops something: a roadblock, a rail, an invisible barrier around a shop."""
    built = []
    for entry in manifest.get("propCollision") or []:
        where = entry.get("unreal")
        if not where:
            continue
        width, height, circle = shape_size_tiles(entry.get("shape"))
        scale = float(where.get("scale") or 1.0)

        blocker = unreal.ClockworksFloorBlocker()
        blocker.set_editor_property("where", transform(where))
        blocker.set_editor_property("size_cm", unreal.Vector2D(width * scale * tile_cm, height * scale * tile_cm))
        blocker.set_editor_property("circle", circle)
        blocker.set_editor_property("collision", int(entry.get("flags") or 0))
        blocker.set_editor_property("config", entry.get("config") or "")
        built.append(blocker)
    report["blockers"] = len(built)
    return built


def markers(manifest, wiring, classes, report):
    """Everything on the floor that means something rather than looks like something, with what it is wired to."""
    built = []
    wired = 0
    for entry in manifest.get("markers") or []:
        where = entry.get("unreal")
        if not where:
            continue

        marker = unreal.ClockworksFloorMarker()
        marker.set_editor_property("category", entry.get("category") or "prop")
        marker.set_editor_property("where", transform(where))
        marker.set_editor_property("config", entry.get("config") or "")

        obj, side = wiring.get(str(entry.get("id"))) or (None, None)
        if obj:
            tags = obj.get("tags") or []
            if tags:
                marker.set_editor_property("tag", tags[0])
            sends = emissions(obj)
            if sends:
                marker.set_editor_property("emits", sends)
            if tags or sends:
                wired += 1

        rules = classes.get(entry.get("config") or "")
        if rules:
            if rules.get("behaviour"):
                marker.set_editor_property("behaviour", rules["behaviour"])
            params = {name: str(value) for name, value in (rules.get("params") or {}).items()}
            # A gate's required count is its own argument and differs from the number in its name.
            for source in (side or {}, obj or {}):
                args = source.get("entryArgs") or {}
                for key in ("Triggers", "Trigger Count"):
                    if isinstance(args.get(key), (str, int)):
                        params["triggers"] = str(args[key])
            if params:
                marker.set_editor_property("params", params)

        built.append(marker)

    report["markers"] = manifest.get("markerSummary") or {}
    report["wired_markers"] = wired
    return built


def build(manifest_file, factory, classes, report):
    with open(os.path.join(FLOORS_DIR, manifest_file), encoding="utf-8") as handle:
        manifest = json.load(handle)

    wiring = load_wiring(manifest_file)
    scene = manifest.get("scene") or {}
    rules = manifest.get("unreal") or {}
    tile_cm = float(rules.get("tileCm") or 100.0)
    name = asset_name(manifest_file)
    path = DEST + "/" + name

    if unreal.EditorAssetLibrary.does_asset_exist(path):
        asset = unreal.EditorAssetLibrary.load_asset(path)
    else:
        asset = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            name, DEST, unreal.ClockworksFloorDefinition, factory)
    if not asset:
        unreal.log_error("Floors: could not make %s" % path)
        return None

    size = scene.get("sizeTiles") or [0, 0]
    bounds = scene.get("bounds") or {}
    music, music_file = music_asset(manifest.get("globals"))

    asset.set_editor_property("level_name", scene.get("levelName") or scene.get("name") or manifest_file)
    asset.set_editor_property("scene_id", "%s/%s" % (scene.get("folder") or "?", scene.get("sceneId") or "?"))
    asset.set_editor_property("size_tiles", unreal.IntPoint(int(size[0]), int(size[1])))
    asset.set_editor_property("min_tile", unreal.IntPoint(int(bounds.get("minX") or 0), int(bounds.get("minY") or 0)))
    asset.set_editor_property("tile_cm", tile_cm)
    asset.set_editor_property("elevation_cm", float(rules.get("elevationCm") or 50.0))
    asset.set_editor_property("mesh_groups", mesh_groups(manifest, report))
    asset.set_editor_property("cells", cells(manifest, report))
    asset.set_editor_property("blockers", blockers(manifest, tile_cm, report))
    asset.set_editor_property("markers", markers(manifest, wiring, classes, report))

    grid = manifest.get("cells") or {}
    asset.set_editor_property("knight_mask", int(grid.get("knightMask") or 43))
    asset.set_editor_property("bullet_mask", int(grid.get("bulletMask") or 137))
    asset.set_editor_property("monster_mask", int(grid.get("monsterMask") or 79))
    asset.set_editor_property("background_color", color(manifest.get("globals"), "Environment/Background Color"))
    asset.set_editor_property("ambient_color", color(manifest.get("globals"), "Environment/Ambient"))
    if music:
        asset.set_editor_property("music", unreal.load_asset(music))

    unreal.EditorAssetLibrary.save_loaded_asset(asset, False)

    report["asset"] = path
    report["level"] = asset.get_editor_property("level_name")
    report["size_tiles"] = [int(size[0]), int(size[1])]
    report["music"] = music or ("not imported: " + music_file if music_file else "none")
    unreal.log_warning("Floors: %-46s %-34s %4d models, %5d copies, %5d cells, %4d barriers, %3d markers%s"
                       % (name, report["level"], report["mesh_groups"], report["instances"], report["cells"],
                          report["blockers"], sum((report["markers"] or {}).values()),
                          ", %d models missing" % len(report["missing_models"]) if report["missing_models"] else ""))
    return asset


def all_floors():
    """Every manifest in the archive, by name."""
    return sorted(os.path.splitext(file)[0] for file in os.listdir(FLOORS_DIR)
                  if file.endswith(".json") and not file.startswith("_")
                  and file not in ("report.json", "generated.json", "index.json"))


def prune(wanted):
    """Deletes floor assets no manifest answers to any more.

    Renaming the rule that names an asset leaves the old name behind holding a whole floor's worth of data, and these
    are megabytes apiece. Only run when every floor was rebuilt, or it would delete the ones simply not asked for."""
    keep = {asset_name(name + ".json") for name in wanted}
    stale = [path for path in unreal.EditorAssetLibrary.list_assets(DEST, recursive=True, include_folder=False)
             if path.split("/")[-1].split(".")[0] not in keep]
    for path in stale:
        unreal.EditorAssetLibrary.delete_asset(path)
    if stale:
        unreal.log_warning("Floors: deleted %d assets no manifest answers to any more" % len(stale))


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(["/Game/SK/World", "/Game/SK/Audio", DEST], True)

    wanted = [name.strip() for name in (os.environ.get("SK_FLOORS") or "").split(",") if name.strip()] or FLOORS
    # "all" builds every archived floor. The user's decision 2026-09-15: all 111 are generated and tracked.
    if wanted == ["all"]:
        wanted = all_floors()
    factory = unreal.DataAssetFactory()
    classes = load_object_classes()

    reports = {}
    for name in wanted:
        file = name if name.endswith(".json") else name + ".json"
        if not os.path.isfile(os.path.join(FLOORS_DIR, file)):
            unreal.log_error("Floors: no manifest called %s" % file)
            continue
        report = {}
        reports[name] = report
        build(file, factory, classes, report)

    if wanted == all_floors():
        prune(wanted)

    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(reports, handle, indent=1)
    unreal.log_warning("Floors: %d built, report in %s" % (len(reports), REPORT))


main()
