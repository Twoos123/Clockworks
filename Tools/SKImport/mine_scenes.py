"""Convert and decode Spiral Knights scenes (levels) so floors can be rebuilt in Unreal.

Plain Python plus the game's own JVM (for SKConfigDump's Dat2Xml). Nothing here touches the project's
Content folder; everything it writes goes to D:/Dev/SKAssets/_scenes (git-ignored, Grey Havens/SEGA
property, reference and placeholders only) except the small index next to this script.

    python Tools/SKImport/mine_scenes.py

Sources:
  D:/Dev/SKAssets/_scenes/Legacy/{scenesmain,scenesmainarcade}  the community SpiralKnightsSceneArchive's
      legacy captures, including procedurally generated floors (ids above 1073741823), with the capture logs
  <game>/scenes/*                                               this install's own scene cache

A scene (a TudeySceneModel) is a grid of tiles, each a config (model + footprint) at a cell with an
elevation and a quarter-turn rotation, plus placeables (props, markers, doors, elevators) with a free
transform, areas and globals. Floors are assembled by the game's server from room prefabs; these
captures are finished floors, which is what the demo plays.

Writes:
  D:/Dev/SKAssets/_scenes/xml/<folder>/<file>.xml        Dat2Xml output
  D:/Dev/SKAssets/_scenes/decoded/<folder>__<file>.json  tiles (with footprint, model and Model argument),
                                                         placeables (with model), areas, globals
  Tools/SKImport/scene_index.json                        one summary per scene: names, tileset, size,
                                                         counts, and which model files it needs
"""
import collections
import glob
import json
import os
import re
import subprocess
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = r"C:\Program Files (x86)\Steam\steamapps\common\Spiral Knights"
CONFIG_REFS = r"D:\Dev\Tools\ThreeRingsSharp\ThreeRingsSharp\ConfigRefs"
SCENES = r"D:\Dev\SKAssets\_scenes"
LEGACY = os.path.join(SCENES, "Legacy")
XML_DIR = os.path.join(SCENES, "xml")
DECODED = os.path.join(SCENES, "decoded")
INDEX = os.path.join(HERE, "scene_index.json")

JAVA = os.path.join(GAME, "java_vm", "bin", "java.exe")
CLASSPATH = ";".join([r"D:\Dev\Tools\SKConfigDump"] + [os.path.join(GAME, "code", jar) for jar in (
    "projectx-pcode.jar", "projectx-config.jar", "config.jar", "commons-beanutils.jar", "commons-digester.jar",
    "commons-logging.jar", "lwjgl.jar", "lwjgl-opengl.jar")])

PROCEDURAL_FIRST_ID = 1073741824
LOG_LINE = re.compile(r"scene=(\d+)/([^/]+)/")


def sources():
    """(folder label, path) for every scene file to mine."""
    out = []
    for folder in ("scenesmain", "scenesmainarcade"):
        for path in sorted(glob.glob(os.path.join(LEGACY, folder, "*"))):
            if os.path.isfile(path) and os.path.basename(path).split("_")[0].isdigit():
                out.append((folder, path))
    for path in sorted(glob.glob(os.path.join(GAME, "scenes", "*"))):
        if os.path.isfile(path) and os.path.basename(path).isdigit():
            out.append(("installcache", path))
    return out


def human_names():
    """scene id -> the in-game level name from the archive's translated capture logs (the latest capture)."""
    names = {}
    for folder in ("scenesmain", "scenesmainarcade"):
        raw_log = os.path.join(LEGACY, folder + ".log")
        i18n_log = os.path.join(LEGACY, folder + "i18n.log")
        if not (os.path.isfile(raw_log) and os.path.isfile(i18n_log)):
            continue
        raw = [LOG_LINE.search(l) for l in open(raw_log, encoding="utf-8", errors="replace")]
        i18n = [LOG_LINE.search(l) for l in open(i18n_log, encoding="utf-8", errors="replace")]
        for a, b in zip([m for m in raw if m], [m for m in i18n if m]):
            names[(folder, a.group(1))] = (a.group(2), b.group(2).replace("%dungeon:", "").replace("%town:", ""))
    return names


def convert(pairs):
    """Dat2Xml every scene not converted yet, one JVM per folder."""
    by_folder = collections.defaultdict(list)
    for folder, path in pairs:
        out = os.path.join(XML_DIR, folder, os.path.basename(path) + ".xml")
        if not os.path.isfile(out) or os.path.getmtime(out) < os.path.getmtime(path):
            by_folder[folder].append(path)
    for folder, paths in by_folder.items():
        os.makedirs(os.path.join(XML_DIR, folder), exist_ok=True)
        for start in range(0, len(paths), 40):
            result = subprocess.run([JAVA, "-cp", CLASSPATH, "Dat2Xml", os.path.join(XML_DIR, folder)] + paths[start:start + 40],
                                    capture_output=True, text=True)
            failed = [line for line in result.stdout.splitlines() if line.startswith("FAIL")]
            if failed:
                print("\n".join(failed))


# ---------------------------------------------------------------------------------------------
# Configs
# ---------------------------------------------------------------------------------------------

def parse_args(element):
    values = {}
    if element is None:
        return values
    kids = list(element)
    for key, value in zip(kids[0::2], kids[1::2]):
        name = value.find("name")
        values[key.text] = name.text if name is not None else (value.text or "").strip()
    return values


def load_configs(file_name):
    root = ET.parse(os.path.join(CONFIG_REFS, file_name)).getroot()
    configs = {}
    for entry in root[0].findall("entry"):
        implementation = entry.find("implementation")
        parameters = {}
        parameter_list = entry.find("parameters")
        if parameter_list is not None:
            for parameter in parameter_list.findall("entry"):
                parameters[parameter.findtext("name")] = parameter.findtext("paths") or ""
        configs[entry.findtext("name")] = {"impl": implementation, "cls": implementation.get("class") if implementation is not None else "", "params": parameters}
    return configs


def tile_info(name, args, tiles, depth=0):
    """Footprint, model file and model arguments of a tile config, following Derived chains."""
    config = tiles.get(name)
    if config is None or config["impl"] is None or depth > 8:
        return {"width": 1, "height": 1, "model": None, "modelArgs": {}}
    implementation, cls = config["impl"], config["cls"]
    if cls.endswith("$Derived"):
        reference = implementation.find("tile")
        return tile_info(reference.findtext("name"), {**parse_args(reference.find("arguments")), **args}, tiles, depth + 1)
    width = int(implementation.findtext("width") or 1)
    height = int(implementation.findtext("height") or 1)
    for parameter, paths in config["params"].items():
        if parameter in args:
            try:
                if re.search(r"implementation\.width\b", paths):
                    width = int(float(args[parameter]))
                if re.search(r"implementation\.height\b", paths):
                    height = int(float(args[parameter]))
            except ValueError:
                pass
    model = implementation.find("model")
    model_args = parse_args(model.find("arguments")) if model is not None else {}
    # A tile's own arguments may pick the model set member ("Model").
    for parameter, paths in config["params"].items():
        if parameter in args and "model" in paths.lower():
            model_args.setdefault(parameter, args[parameter])
    return {"width": width, "height": height, "model": model.findtext("name") if model is not None else None, "modelArgs": model_args}


def placeable_info(name, args, placeables, depth=0):
    """Class, model file and model arguments of a placeable config, following Derived chains."""
    config = placeables.get(name)
    if config is None or config["impl"] is None or depth > 8:
        return {"class": None, "model": name if (name or "").endswith(".dat") else None, "modelArgs": dict(args)}
    implementation, cls = config["impl"], config["cls"]
    if cls.endswith("$Derived"):
        reference = implementation.find("placeable")
        if reference is None:
            return {"class": cls.split(".")[-1], "model": None, "modelArgs": {}}
        base = placeable_info(reference.findtext("name"), {**parse_args(reference.find("arguments")), **args}, placeables, depth + 1)
        return {**base, "derivedFrom": reference.findtext("name")}
    model = implementation.find("model")
    model_args = parse_args(model.find("arguments")) if model is not None else {}
    for parameter, paths in config["params"].items():
        if parameter in args and "model" in paths.lower():
            model_args.setdefault(parameter, args[parameter])
    return {"class": cls.split(".")[-1], "model": model.findtext("name") if model is not None else None, "modelArgs": model_args}


# ---------------------------------------------------------------------------------------------
# Scenes
# ---------------------------------------------------------------------------------------------

def decode_tiles(scene, flip):
    cells = scene.find("tiles/cells")
    out = []
    if cells is None:
        return out
    kids = list(cells)
    for key, value in zip(kids[0::2], kids[1::2]):
        cell_x, cell_y = [int(s) for s in key.text.split(",")]
        values = [int(s) for s in value.findtext("values").split(",")]
        side = int(round(len(values) ** 0.5))
        shift = side.bit_length() - 1
        for index, packed in enumerate(values):
            if packed == -1:
                continue
            a, b = index & (side - 1), index >> shift
            local_x, local_y = (b, a) if flip else (a, b)
            elevation = (packed >> 2) & 0x3FFF
            if elevation & 0x2000:
                elevation -= 0x4000
            out.append({"x": (cell_x << shift) + local_x, "y": (cell_y << shift) + local_y, "config": packed >> 16,
                        "elevation": elevation, "rotation": packed & 3})
    return out


def overlap_count(tiles, mappings):
    occupied = collections.Counter()
    for tile in tiles:
        mapping = mappings[tile["config"]] if tile["config"] < len(mappings) else None
        width, height = (mapping["info"]["width"], mapping["info"]["height"]) if mapping else (1, 1)
        if tile["rotation"] % 2:
            width, height = height, width
        for dx in range(width):
            for dy in range(height):
                occupied[(tile["x"] + dx, tile["y"] + dy)] += 1
    return sum(c - 1 for c in occupied.values() if c > 1), occupied


def mine(folder, path, tiles_cfg, placeables_cfg, names):
    xml_path = os.path.join(XML_DIR, folder, os.path.basename(path) + ".xml")
    if not os.path.isfile(xml_path):
        return None
    scene = ET.parse(xml_path).getroot()[0]
    ids = {element.get("id"): element for element in scene.iter() if "id" in element.attrib}

    def deref(element):
        while element is not None and "ref" in element.attrib:
            element = ids[element.get("ref")]
        return element

    mappings = []
    tile_configs = scene.find("tileConfigs")
    for entry in (tile_configs if tile_configs is not None else []):
        tile = deref(entry.find("tile"))
        if tile is None:
            mappings.append(None)
            continue
        args = parse_args(tile.find("arguments"))
        mappings.append({"name": tile.findtext("name"), "args": args, "info": tile_info(tile.findtext("name"), args, tiles_cfg)})

    # The cell index ordering is whichever leaves fewer overlapping footprints.
    candidates = {flip: decode_tiles(scene, flip) for flip in (False, True)}
    scores = {flip: overlap_count(candidates[flip], mappings)[0] for flip in candidates}
    flip = min(scores, key=scores.get)
    tiles = candidates[flip]
    _, occupied = overlap_count(tiles, mappings)

    tilesets = collections.Counter()
    models = collections.Counter()
    tile_out = []
    for tile in tiles:
        mapping = mappings[tile["config"]] if tile["config"] < len(mappings) else None
        if not mapping:
            continue
        info = mapping["info"]
        tilesets[mapping["name"].split("/")[0]] += 1
        if info["model"]:
            models[info["model"]] += 1
        tile_out.append({"x": tile["x"], "y": tile["y"], "elevation": tile["elevation"], "rotation": tile["rotation"],
                         "w": info["width"], "h": info["height"], "config": mapping["name"],
                         "model": info["model"], "modelArgs": info["modelArgs"]})

    placeables, areas, globals_ = [], [], []
    entries = scene.find("entries")
    for entry in (entries if entries is not None else []):
        cls = (entry.get("class") or "").split("$")[-1]
        if cls == "PlaceableEntry":
            placeable = deref(entry.find("placeable"))
            name = placeable.findtext("name") if placeable is not None else None
            args = parse_args(placeable.find("arguments")) if placeable is not None else {}
            info = placeable_info(name, args, placeables_cfg)
            if info.get("model"):
                models[info["model"]] += 1
            transform = entry.find("transform")
            placeables.append({"id": entry.findtext("id"), "config": name, "args": args, "class": info.get("class"),
                               "model": info.get("model"), "modelArgs": info.get("modelArgs") or {},
                               "translation": transform.findtext("translation") if transform is not None else None,
                               "rotation": transform.findtext("rotation") if transform is not None else None,
                               "scale": transform.findtext("scale") if transform is not None else None,
                               "tags": [t.text for t in entry.findall("tags/*") if t.text]})
        elif cls == "AreaEntry":
            area = deref(entry.find("area"))
            vertices = [v.text for v in entry.findall("vertices/*") if v.text]
            areas.append({"config": area.findtext("name") if area is not None else None, "vertices": vertices})
        elif cls == "GlobalEntry":
            global_ = deref(entry.find("sceneGlobal"))
            globals_.append({"config": global_.findtext("name") if global_ is not None else None,
                             "args": parse_args(global_.find("arguments")) if global_ is not None else {}})

    file_name = os.path.basename(path)
    scene_id = file_name.split("_")[0]
    raw_name, human = names.get((folder, scene_id), (scene.findtext("name"), None))
    xs = [c[0] for c in occupied] or [0]
    ys = [c[1] for c in occupied] or [0]
    total = sum(tilesets.values()) or 1
    clockworks_share = sum(c for k, c in tilesets.items() if k.startswith("Clockworks")) / total

    record = {
        "folder": folder, "file": file_name, "sceneId": scene_id, "procedural": int(scene_id) >= PROCEDURAL_FIRST_ID,
        "name": scene.findtext("name") or raw_name, "levelName": human,
        "tilesets": dict(tilesets.most_common(4)), "clockworksShare": round(clockworks_share, 3),
        "bounds": {"minX": min(xs), "maxX": max(xs), "minY": min(ys), "maxY": max(ys)},
        "sizeTiles": [max(xs) - min(xs) + 1, max(ys) - min(ys) + 1],
        "counts": {"tiles": len(tile_out), "placeables": len(placeables), "areas": len(areas)},
        "overlaps": scores[flip], "models": dict(models.most_common()),
        "decoded": os.path.join(DECODED, folder + "__" + file_name + ".json"),
    }
    os.makedirs(DECODED, exist_ok=True)
    with open(record["decoded"], "w", encoding="utf-8") as handle:
        json.dump({"summary": record, "tiles": tile_out, "placeables": placeables, "areas": areas, "globals": globals_}, handle)
    return record


def main():
    pairs = sources()
    print(f"{len(pairs)} scene files")
    convert(pairs)
    tiles_cfg = load_configs("tile.xml")
    placeables_cfg = load_configs("placeable.xml")
    names = human_names()

    records = []
    for folder, path in pairs:
        try:
            record = mine(folder, path, tiles_cfg, placeables_cfg, names)
        except Exception as error:  # a scene the decoder cannot read is reported, not fatal
            print("could not decode", folder, os.path.basename(path), error)
            continue
        if record:
            records.append(record)

    with open(INDEX, "w", encoding="utf-8") as handle:
        json.dump({"_about": "Written by mine_scenes.py. One entry per decoded Spiral Knights scene; geometry lives in the 'decoded' file under D:/Dev/SKAssets/_scenes.",
                   "scenes": [{k: v for k, v in r.items() if k != "models"} | {"modelFiles": len(r["models"])} for r in records]}, handle, indent=1)

    clockworks = [r for r in records if r["clockworksShare"] >= 0.6]
    print(f"{len(records)} decoded, {len(clockworks)} mostly Clockworks tiles")
    for r in sorted(clockworks, key=lambda r: (not r["procedural"], r["name"] or "")):
        print(f"  {r['folder']:17s} {r['file']:30s} {str(r['name'])[:44]:44s} {str(r['levelName'])[:40]:40s} {r['sizeTiles']} tiles={r['counts']['tiles']} props={r['counts']['placeables']} overlaps={r['overlaps']}")


if __name__ == "__main__":
    main()
