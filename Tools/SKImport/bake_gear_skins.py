"""Bake the tinted skin textures of colorized gear, offline, from the game's own model configs.

Plain Python, Pillow and numpy, no editor. 457 helmets, armours and shields are "colorized" in Spiral
Knights: their skins are painted in key hues and the game tints them when the model is built. Unreal wants
finished textures, so this follows each item's model config down to the textures it really draws, applies
the colorizations those textures end up with, and writes one PNG per distinct result.

    python Tools/SKImport/bake_gear_skins.py

Inputs:

  Tools/SKImport/gear.json   {"items": [...]}: per item config_name, slot and model {"path", "variant",
                             "colorization", "arguments"} (the arguments the item passes to its model)
  <SK_RSRC>/<model>.dat      the model configs, converted to XML with the game's own classes (Dat2Xml in
                             D:/Dev/Tools/SKConfigDump, run with the bundled JVM, as resolve_wrappers.py
                             does) and cached in <SK_ASSETS>/_gear_tinted/xml/<rsrc path>.xml
  <SK_RSRC>/config/texture.dat   the texture config library ("2D/File/Colorized (Single)/Default" ...):
                             which argument lands in which colorization slot, and the defaults
  <SK_RSRC>/<texture>.png    the skins
  <SK_ASSETS>/_gear_samples/colordefs/colordefs.txt   the colour table (see bake_gear_icons.py)
  <SK_ASSETS>/item/gear/**.glb, <SK_ASSETS>/_gear_export/armor/*.glb   the exports, only to confirm which
                             imported material a texture belongs to
  <SK_ASSETS>/_gear_icons/gear_icons.json   the baked icons, only for the contact sheet

How a texture is found (Clyde's ParameterizedConfig rules, reproduced):

  - A config's arguments are applied through its parameters. A Direct parameter writes the value at each
    of its paths (implementation.models[0].model["Material"]["Texture"]["Colorization"]: fields, list
    indices and ConfigReference arguments). A Choice parameter picks the option named by the value and
    writes that option's arguments through its directs. No argument means the config as stored.
  - ModelConfig$Derived follows its model reference with its arguments; CompoundConfig follows every
    model (particles are skipped); ModelConfig$Schemed follows the entry with no scheme (the default,
    highest detail); ConditionalConfig follows the first case (the near model).
  - A leaf (StaticConfig, ArticulatedConfig, StaticSetConfig) draws the material mappings its geometry
    names by (texture, tag); a StaticSetConfig only the mesh set its "model" selects. Each 2D texture
    reference in a mapping's material is resolved against the texture library: the library entry's
    parameters take the reference's arguments, and contents.file / contents.colorizations are the result.
  - A texture with a non-empty colorization list is tinted, with bake_gear_icons.py's colour maths: pixels
    go through the list in order and the first colorization that matches wins. Alpha is kept.
  - Colour class 1 "player" (26 colours: magenta with zero offsets, 23 hue turns, silver and team_neutral
    desaturated) is, INFERRED from its name and shape, the knight's personal colour. 257 (player/magenta)
    therefore leaves a texture as it is, and its magenta areas are where the personal colour would go. The
    manifest flags every texture the bake leaves unchanged.
  - The material hint follows the exporter's naming: a material is named after the texture the variant
    picks, else after the mapping's own source texture, else "dummymtl-rsrc.<model path>-<mesh>".

Outputs, in <SK_ASSETS>/_gear_tinted:

  T_GearSkin_<Stem>_<colorizations>.png   one RGBA PNG per distinct (texture file, colorization list).
        <Stem> is the texture file name in CamelCase (its folder is put in front when two textures would
        share a name); <colorizations> is the list joined by "_", an int per classId << 8 | colorId entry
        and "x" plus a short hash for a custom one (a Status glow, a recolor's FullyCustom Red/Green/Blue).
  gear_tinted.json   {"summary": counts, multi-slot items and unresolved items with reasons,
                      <config_name>: {"textures": [{"source", "tinted_png", "asset", "material_hint", ...}],
                                      "untinted": [...], "evidence": "...", "notes": [...]}}
  contact_sheet.png  about forty textures: original, tinted, and the item's baked icon to compare against
  xml/               the Dat2Xml cache (delete it to re-convert)

Re-runnable: PNGs and the manifest are rewritten, converted configs are reused.
"""
import copy
import glob
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from collections import OrderedDict, defaultdict

from PIL import Image, ImageDraw, ImageFont

try:
    import numpy as np
except ImportError:  # the palette path and the slow path below still work
    np = None

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from stage_and_import import SK_ASSETS, SK_RSRC  # noqa: E402
from bake_gear_icons import COLORDEFS, bake, load_colour_table, recolor_rgba, resolve  # noqa: E402

GEAR_JSON = os.path.join(HERE, "gear.json")
GAME = os.path.dirname(SK_RSRC)
JAVA = os.path.join(GAME, "java_vm", "bin", "java.exe")
CLASSPATH = ";".join([r"D:\Dev\Tools\SKConfigDump"] + [os.path.join(GAME, "code", jar) for jar in (
    "projectx-pcode.jar", "projectx-config.jar", "config.jar", "commons-beanutils.jar", "commons-digester.jar",
    "commons-logging.jar", "lwjgl.jar", "lwjgl-opengl.jar")])
OUT_DIR = os.path.join(SK_ASSETS, "_gear_tinted")
XML_CACHE = os.path.join(OUT_DIR, "xml")
OUT_JSON = os.path.join(OUT_DIR, "gear_tinted.json")
CONTACT_SHEET = os.path.join(OUT_DIR, "contact_sheet.png")
ICON_MANIFEST = os.path.join(SK_ASSETS, "_gear_icons", "gear_icons.json")
ARMOR_GLBS = os.path.join(SK_ASSETS, "_gear_export", "armor")
TEXTURE_LIBRARY = "config/texture.dat"
PREFIX = "T_GearSkin_"
EFFECT_KINDS = ("ParticleSystemConfig", "SceneInfluencerConfig")
PLAYER_COLOUR_NOTE = (
    "Colorization 257 is class 1 'player' colour 1 'magenta', offsets [0, 0, 0]: it changes no pixel. Class 1 has "
    "26 colours (hue turns of 0.041 per step, silver and team_neutral desaturate), so it is INFERRED to be the "
    "knight's personal colour, and the magenta areas of these skins are where that colour goes. Textures whose "
    "only effective colorization is 257 are flagged unchanged_by_tint.")


# --- Dat2Xml and the XML object model -----------------------------------------------------------

def xml_path(rsrc_path):
    return os.path.join(XML_CACHE, rsrc_path.replace("/", os.sep))[:-4] + ".xml"


def dump(rsrc_paths):
    """Convert every .dat not yet in the cache, one JVM per folder."""
    by_dir = defaultdict(list)
    for path in rsrc_paths:
        out = xml_path(path)
        if (not os.path.isfile(out) or os.path.getsize(out) == 0) and os.path.isfile(
                os.path.join(SK_RSRC, path.replace("/", os.sep))):
            by_dir[os.path.dirname(out)].append(os.path.join(SK_RSRC, path.replace("/", os.sep)))
    for out_dir, files in by_dir.items():
        subprocess.run([JAVA, "-cp", CLASSPATH, "Dat2Xml", out_dir] + files, cwd=GAME, capture_output=True, text=True)


def convert_document(path):
    """A Clyde XML export as Python values: dicts for objects ("_class" when the XML names one), lists,
    str/int/float, {"@ref": name, "arguments": {...}} for a ConfigReference, and an int for a
    ColorizationConfig$Normal (its colorization), the form bake_gear_icons.resolve takes."""
    root = ET.parse(path).getroot().find("object")
    ids = {e.get("id"): e for e in root.iter() if e.get("id") is not None}
    memo = {}

    def by_id(ref):
        if ref not in memo:
            memo[ref] = convert(ids[ref], follow_id=False)
        return copy.deepcopy(memo[ref])

    def convert(e, follow_id=True):
        if e.get("ref") is not None:
            return by_id(e.get("ref")) if e.get("ref") in ids else None
        cls = e.get("class", "")
        children = [c for c in e if c.tag != "outer"]
        if cls.endswith("ColorizationConfig$Normal"):
            return int(e.findtext("colorization") or 0)
        if cls.startswith("["):
            return [convert(c) for c in children]
        text = (e.text or "").strip()
        if cls in ("java.lang.String",):
            return e.text or ""
        if cls in ("java.lang.Integer", "java.lang.Long", "java.lang.Short", "java.lang.Byte"):
            return int(text)
        if cls in ("java.lang.Float", "java.lang.Double"):
            return float(text)
        if cls == "java.lang.Boolean":
            return text == "true"
        if not children:
            if cls and not text:
                return {"_class": cls.rsplit(".", 1)[-1]}
            return text if text else None
        tags = [c.tag for c in children]
        if all(t == "entry" for t in tags):
            return [convert(c) for c in children]
        if len(tags) % 2 == 0 and tags[0::2] == ["key"] * (len(tags) // 2) and tags[1::2] == ["value"] * (len(tags) // 2):
            return OrderedDict(((children[i].text or ""), convert(children[i + 1])) for i in range(0, len(children), 2))
        value = OrderedDict()
        if cls:
            value["_class"] = cls.rsplit(".", 1)[-1]
        for child in children:
            value[child.tag] = convert(child)
        plain = set(value) - {"_class"}
        if "name" in value and plain <= {"name", "arguments"} and cls in ("", "com.threerings.config.ConfigReference"):
            return {"@ref": value["name"], "arguments": value.get("arguments") or OrderedDict()}
        return value

    return convert(root)


_CONFIGS = {}


def load(rsrc_path):
    """A fresh copy of a converted config, or None when the .dat is missing or will not convert."""
    if rsrc_path not in _CONFIGS:
        out = xml_path(rsrc_path)
        if not os.path.isfile(out) or os.path.getsize(out) == 0:
            dump([rsrc_path])
        _CONFIGS[rsrc_path] = convert_document(out) if os.path.isfile(out) and os.path.getsize(out) else None
    return copy.deepcopy(_CONFIGS[rsrc_path])


# --- Parameters and paths ----------------------------------------------------------------------

TOKEN = re.compile(r'\s*(?:\.?([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\])')


def split_paths(text):
    paths, depth, quoted, start = [], 0, False, 0
    text = text or ""
    for i, ch in enumerate(text):
        if ch == '"':
            quoted = not quoted
        elif not quoted and ch == "[":
            depth += 1
        elif not quoted and ch == "]":
            depth -= 1
        elif not quoted and depth == 0 and ch == ",":
            paths.append(text[start:i].strip())
            start = i + 1
    paths.append(text[start:].strip())
    return [p for p in paths if p]


def tokens(path):
    out, pos = [], 0
    while pos < len(path):
        match = TOKEN.match(path, pos)
        if not match or match.end() == pos:
            # The game's data has a few paths with a stray closing bracket at the end
            # (...["Colorizations"][0].colorization]); the game loads them, so trailing brackets are ignored.
            if out and re.fullmatch(r"[\]\s]*", path[pos:]):
                break
            raise ValueError("cannot parse path %r at %d" % (path, pos))
        field, index, arg = match.groups()
        out.append(("field", field) if field else ("index", int(index)) if index is not None else ("arg", arg))
        pos = match.end()
    return out


def norm(key):
    return key.replace("_", "").lower()


def field_key(node, name):
    for key in node:
        if isinstance(key, str) and norm(key) == norm(name):
            return key
    return None


def child(node, token):
    kind, key = token
    if kind == "field" and isinstance(node, dict) and "@ref" not in node:
        found = field_key(node, key)
        return node.get(found) if found else None
    if kind == "index" and isinstance(node, list):
        return node[key] if key < len(node) else None
    if kind == "arg" and isinstance(node, dict) and "@ref" in node:
        return (node.get("arguments") or {}).get(key)
    return None


def assign(node, token, value):
    kind, key = token
    if kind == "field" and isinstance(node, dict) and "@ref" not in node:
        node[field_key(node, key) or key] = value
        return True
    if kind == "index" and isinstance(node, list):
        if key < len(node):
            node[key] = value
            return True
        if key == len(node):
            node.append(value)
            return True
        return False
    if kind == "arg" and isinstance(node, dict) and "@ref" in node:
        if node.get("arguments") is None:
            node["arguments"] = OrderedDict()
        node["arguments"][key] = value
        return True
    return False


def set_path(config, path, value):
    """Write value at a Clyde property path; False when the path does not exist in this config."""
    toks = tokens(path)
    node, chain = config, []
    for position, token in enumerate(toks[:-1]):
        nxt = child(node, token)
        if nxt is None:
            following = toks[position + 1]
            if following[0] == "arg":
                return False
            nxt = OrderedDict() if following[0] == "field" else []
            if not assign(node, token, nxt):
                return False
        chain.append((node, token))
        node = nxt
    last = toks[-1]
    # A Normal colorization is held as its int: ".colorization" on it replaces the int itself.
    if last == ("field", "colorization") and isinstance(node, int) and chain:
        parent, parent_token = chain[-1]
        return assign(parent, parent_token, value)
    return assign(node, last, copy.deepcopy(value))


def apply_arguments(config, args, notes, where):
    """Clyde's ParameterizedConfig.applyArguments over converted values."""
    params = OrderedDict((p.get("name"), p) for p in (config.get("parameters") or []) if isinstance(p, dict))
    for key in sorted(args or {}):
        value = args[key]
        param = params.get(key)
        if param is None:
            notes.append("%s: argument %r has no parameter" % (where, key))
            continue
        kind = param.get("_class", "")
        if kind.endswith("$Direct"):
            for path in split_paths(param.get("paths")):
                if not set_path(config, path, value):
                    notes.append("%s: %s path not found: %s" % (where, key, path))
        elif kind.endswith("$Choice"):
            options = [o for o in (param.get("options") or []) if isinstance(o, dict)]
            option = next((o for o in options if o.get("@ref") == value), None) or next(
                (o for o in options if str(o.get("@ref", "")).lower() == str(value).lower()), None)
            if option is None:
                notes.append("%s: %s has no option %r, so the stored choice stays (INFERRED: Clyde skips an "
                             "unknown option; options: %s)" % (
                    where, key, value, ", ".join(str(o.get("@ref")) for o in options)))
                continue
            option_args = option.get("arguments") or {}
            for direct in param.get("directs") or []:
                if not isinstance(direct, dict) or direct.get("name") not in option_args:
                    continue
                for path in split_paths(direct.get("paths")):
                    if not set_path(config, path, option_args[direct["name"]]):
                        notes.append("%s: %s=%s direct %s path not found: %s" % (where, key, value, direct["name"], path))
        else:
            notes.append("%s: parameter %s of kind %s not handled" % (where, key, kind))


# --- Models down to textures -------------------------------------------------------------------

_TEXTURE_LIBRARY = None


def texture_library():
    global _TEXTURE_LIBRARY
    if _TEXTURE_LIBRARY is None:
        entries = load(TEXTURE_LIBRARY) or []
        _TEXTURE_LIBRARY = {e.get("name"): e for e in entries if isinstance(e, dict)}
    return _TEXTURE_LIBRARY


def resolve_texture(ref, notes, where):
    """(file, colorizations) for a 2D texture ConfigReference, through the texture library."""
    entry = texture_library().get(ref.get("@ref"))
    args = ref.get("arguments") or {}
    if entry is None:
        notes.append("%s: texture config %r not in the library; read its arguments directly" % (where, ref.get("@ref")))
        colorizations = args.get("Colorizations")
        if colorizations is None and args.get("Colorization") is not None:
            colorizations = [args.get("Colorization")]
        return args.get("File"), list(colorizations or [])
    config = copy.deepcopy(entry)
    apply_arguments(config, args, notes, where + " " + ref.get("@ref"))
    contents = (config.get("implementation") or {}).get("contents") or {}
    return contents.get("file"), [c for c in (contents.get("colorizations") or []) if c is not None]


def geometry_pairs(node, pairs):
    """Every (texture, tag) a piece of geometry is drawn with."""
    if isinstance(node, dict):
        if "geometry" in node and "texture" in node:
            pairs.add((node.get("texture"), node.get("tag")))
        for key, value in node.items():
            if key != "materialMappings":
                geometry_pairs(value, pairs)
    elif isinstance(node, list):
        for value in node:
            geometry_pairs(value, pairs)
    return pairs


def describe_args(args):
    shown = []
    for key, value in (args or {}).items():
        if isinstance(value, (str, int, float)):
            shown.append("%s=%s" % (key, value))
        elif isinstance(value, dict) and "@ref" in value:
            shown.append("%s=<%s>" % (key, value["@ref"]))
        else:
            shown.append("%s=<%s>" % (key, type(value).__name__))
    return ", ".join(shown)


def evaluate(path, args, notes, trail, slots, depth=0):
    """Append every material slot this model draws to slots."""
    where = path
    if depth > 16:
        notes.append("%s: too deep, stopped" % path)
        return
    config = load(path)
    if config is None:
        notes.append("%s: missing or would not convert" % path)
        return
    apply_arguments(config, args, notes, where)
    step = "%s [%s]" % (path, describe_args(args)) if args else path
    trail = trail + [step]
    impl = config.get("implementation") or {}
    kind = impl.get("_class", "") if isinstance(impl, dict) else ""

    def follow(ref, label):
        if not isinstance(ref, dict) or not ref.get("@ref"):
            return
        name = ref["@ref"]
        if name.startswith("particle/"):
            return
        if not name.endswith(".dat"):
            notes.append("%s: %s references library model %r, not followed" % (path, label, name))
            return
        evaluate(name, ref.get("arguments") or {}, notes, trail, slots, depth + 1)

    if kind == "ModelConfig$Derived":
        follow(impl.get("model"), "derived model")
    elif kind == "CompoundConfig":
        for index, entry in enumerate(impl.get("models") or []):
            if isinstance(entry, dict):
                follow(entry.get("model"), "compound model %d" % index)
    elif kind == "ModelConfig$Schemed":
        entries = [e for e in (impl.get("models") or []) if isinstance(e, dict) and e.get("model")]
        default = [e for e in entries if not e.get("scheme")] or entries
        if default:
            follow(default[0]["model"], "default scheme")
    elif kind == "ConditionalConfig":
        cases = [c for c in (impl.get("cases") or []) if isinstance(c, dict) and c.get("model")]
        follow(cases[0]["model"] if cases else impl.get("defaultModel"), "first condition")
    elif isinstance(impl, dict) and "materialMappings" in impl:
        leaf(path, kind, impl, notes, trail, slots)
    elif kind in EFFECT_KINDS:
        pass  # particles and light influencers: effects, no skin
    else:
        notes.append("%s: implementation %r not handled" % (path, kind or impl))


def leaf(path, kind, impl, notes, trail, slots):
    geometry = impl
    mesh_set = None
    if kind == "StaticSetConfig":
        mesh_set = impl.get("model")
        meshes = impl.get("meshes") or {}
        if mesh_set in meshes:
            geometry = meshes[mesh_set]
        else:
            notes.append("%s: mesh set %r not among %s; all sets counted" % (path, mesh_set, list(meshes)))
    used = geometry_pairs(geometry, set())
    for mapping in impl.get("materialMappings") or []:
        if not isinstance(mapping, dict):
            continue
        pair = (mapping.get("texture"), mapping.get("tag"))
        if used and pair not in used:
            continue
        material = mapping.get("material") or {}
        found = False
        for param, value in (material.get("arguments") or {}).items():
            if not (isinstance(value, dict) and str(value.get("@ref") or "").startswith("2D/")):
                continue
            found = True
            file_, colorizations = resolve_texture(value, notes, path)
            slots.append({
                "model": path, "mesh_set": mesh_set, "mapping_texture": pair[0], "tag": pair[1],
                "material": material.get("@ref"), "material_parameter": param, "texture_config": value.get("@ref"),
                "file": file_, "colorizations": colorizations, "trail": trail})
        if not found:
            slots.append({
                "model": path, "mesh_set": mesh_set, "mapping_texture": pair[0], "tag": pair[1],
                "material": material.get("@ref"), "material_parameter": None, "texture_config": None,
                "file": None, "colorizations": [], "trail": trail})


# --- Exports: which imported material a texture is ----------------------------------------------

def glb_materials(path):
    try:
        with open(path, "rb") as handle:
            head = handle.read(20)
            length = struct.unpack("<I", head[12:16])[0]
            data = json.loads(handle.read(length))
        return [m.get("name") for m in data.get("materials", [])]
    except (OSError, ValueError, struct.error):
        return None


def file_stem(path):
    return os.path.splitext(os.path.basename(path or ""))[0]


def material_hint(slot, slots, materials):
    """The imported material a slot's texture lands on, by the exporter's naming."""
    if materials is None:
        return "%s (INFERRED: no export found to check)" % file_stem(slot["file"])
    names = [m for m in materials if m]
    own = file_stem(slot["file"])
    if own in names:
        return own
    mapping = (slot["model"], slot["mapping_texture"], slot["tag"])
    siblings = [s for s in slots if (s["model"], s["mapping_texture"], s["tag"]) == mapping and s is not slot and s["file"]]
    siblings.sort(key=lambda s: s["material_parameter"] != "Texture")
    for sibling in siblings:
        if file_stem(sibling["file"]) in names:
            return "%s (the mapping's material; this texture is its %r)" % (file_stem(sibling["file"]), slot["material_parameter"])
    source = file_stem(slot["mapping_texture"])
    if source in names:
        return "%s (material named after the mapping's source texture)" % source
    dotted = "dummymtl-rsrc." + slot["model"][:-4].replace("/", ".") + "-"
    dummies = [m for m in names if m.startswith(dotted)]
    if slot["mesh_set"]:
        dummies = [m for m in dummies if "[%s]" % slot["mesh_set"] in m] or dummies
    if dummies:
        return "%s (placeholder material of %s)" % (" | ".join(dummies[:3]) + (" | ..." if len(dummies) > 3 else ""), slot["model"])
    return "%s (INFERRED: not among the export's materials)" % own


_ARMOR_INDEX = None


def export_for(item):
    """The glb the item's model was exported to, or None."""
    global _ARMOR_INDEX
    model = item["model"]["path"]
    if item["slot"] == "Armor":
        if _ARMOR_INDEX is None:
            _ARMOR_INDEX = {re.sub(r"[^a-z0-9]", "", os.path.basename(p)[:-4].lower()): p
                            for p in glob.glob(os.path.join(ARMOR_GLBS, "*.glb"))}
        key = re.sub(r"[^a-z0-9]", "", model[len("item/gear/armor/"):-4].lower())
        return _ARMOR_INDEX.get(key)
    candidate = os.path.join(SK_ASSETS, model.replace("/", os.sep))[:-4] + ".glb"
    return candidate if os.path.isfile(candidate) else None


# --- Baking ------------------------------------------------------------------------------------

def bake_texture(path, zations):
    """(RGBA image, matched pixels per colorization). Palette images use the icon baker's own path;
    true-colour ones are recoloured once per distinct colour, which gives the same pixels."""
    image = Image.open(path)
    image.load()
    if image.mode == "P" or np is None:
        return bake(path, zations)
    rgba = np.asarray(image.convert("RGBA"))
    flat = rgba.reshape(-1, 4).astype(np.uint32)
    packed = (flat[:, 0] << 24) | (flat[:, 1] << 16) | (flat[:, 2] << 8) | flat[:, 3]
    unique, inverse = np.unique(packed, return_inverse=True)
    counts = np.bincount(inverse.ravel(), minlength=len(unique))
    table = np.empty((len(unique), 4), dtype=np.uint8)
    hits = [0] * len(zations)
    for index, value in enumerate(unique.tolist()):
        entry_hits = [0] * len(zations)
        table[index] = recolor_rgba(((value >> 24) & 255, (value >> 16) & 255, (value >> 8) & 255, value & 255),
                                    zations, entry_hits)
        for z, hit in enumerate(entry_hits):
            hits[z] += hit * int(counts[index])
    result = table[inverse.ravel()].reshape(rgba.shape)
    return Image.fromarray(result, "RGBA"), hits


def camel(text):
    return "".join(w[:1].upper() + w[1:] for w in re.findall(r"[A-Za-z0-9]+", text)) or "Unnamed"


def colorization_token(entry):
    if isinstance(entry, int):
        return str(entry)
    digest = hashlib.sha1(json.dumps(entry, sort_keys=True).encode("utf-8")).hexdigest()[:6]
    return "x" + digest


def signature(colorizations):
    return json.dumps(colorizations, sort_keys=True)


def asset_names(keys):
    """{(file, signature): asset name}; a texture stem shared by two files gets its folders in front."""
    stems = defaultdict(set)
    for file_, _ in keys:
        stems[camel(os.path.splitext(os.path.basename(file_))[0])].add(file_)
    names = {}
    for file_, sig in keys:
        base = camel(os.path.splitext(os.path.basename(file_))[0])
        if len(stems[base]) > 1:
            parts = file_.split("/")[:-1]
            for count in range(1, len(parts) + 1):
                prefixed = camel("_".join(parts[-count:])) + base
                if all(camel("_".join(f.split("/")[:-1][-count:])) + base != prefixed or f == file_ for f in stems[base]):
                    base = prefixed
                    break
        names[(file_, sig)] = PREFIX + base + "_" + "_".join(colorization_token(c) for c in json.loads(sig))
    return names


# --- Contact sheet -----------------------------------------------------------------------------

def contact_sheet(samples, path):
    size, pad, text_h, cols = 150, 8, 44, 4
    cell_w, cell_h = size * 3 + pad * 4, size + text_h + pad * 2
    rows = (len(samples) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell_w, max(rows, 1) * cell_h), (40, 40, 44, 255))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default(size=11)
    except TypeError:
        font = ImageFont.load_default()
    checker = Image.new("RGBA", (size, size))
    checker_draw = ImageDraw.Draw(checker)
    for y in range(0, size, 15):
        for x in range(0, size, 15):
            shade = 96 if (x + y) // 15 % 2 else 128
            checker_draw.rectangle([x, y, x + 14, y + 14], fill=(shade, shade, shade, 255))
    for index, sample in enumerate(samples):
        ox, oy = index % cols * cell_w, index // cols * cell_h
        pictures = [sample["source_abs"], sample["png"], sample.get("icon")]
        for column, picture_path in enumerate(pictures):
            if not picture_path or not os.path.isfile(picture_path):
                continue
            picture = Image.open(picture_path).convert("RGBA")
            picture.thumbnail((size, size), Image.LANCZOS)
            tile = checker.copy()
            tile.alpha_composite(picture, ((size - picture.width) // 2, (size - picture.height) // 2))
            sheet.paste(tile, (ox + pad + column * (size + pad), oy + pad))
        draw.text((ox + pad, oy + pad + size + 2), sample["label"][:70], fill=(235, 235, 235, 255), font=font)
        draw.text((ox + pad, oy + pad + size + 16), sample["detail"][:70], fill=(160, 160, 170, 255), font=font)
        draw.text((ox + pad, oy + pad + size + 30), "original | tinted | icon", fill=(120, 120, 130, 255), font=font)
    sheet.save(path)


def pick_samples(baked, items_by_texture, icons, limit=40):
    """Round-robin over model folders so every family shows up before any repeats: textures the tint
    changes first (three quarters of the sheet), then some it leaves as they are."""
    def round_robin(keys, count):
        by_folder = defaultdict(list)
        for key in keys:
            by_folder[os.path.dirname(key[0])].append(key)
        chosen = []
        while len(chosen) < count and any(by_folder.values()):
            for folder in sorted(by_folder):
                if by_folder[folder] and len(chosen) < count:
                    chosen.append(by_folder[folder].pop(0))
        return chosen

    picked = round_robin([k for k in sorted(baked) if not baked[k]["unchanged"]], limit * 3 // 4)
    picked += round_robin([k for k in sorted(baked) if baked[k]["unchanged"]], limit - len(picked))
    samples = []
    for key in picked:
        entry = baked[key]
        config_name = items_by_texture[key][0]
        icon = (icons.get(config_name) or {}).get("png")
        samples.append({"source_abs": entry["source_abs"], "png": entry["png"], "icon": icon,
                        "label": config_name.split("/")[-1],
                        "detail": "%s%s  %s" % ("UNCHANGED  " if entry["unchanged"] else "",
                                                os.path.basename(key[0]), entry["asset"][len(PREFIX):])})
    return samples


# --- Main --------------------------------------------------------------------------------------

def main():
    started = time.perf_counter()
    classes = load_colour_table(COLORDEFS)
    items = [i for i in json.load(open(GEAR_JSON, encoding="utf-8"))["items"]
             if (i.get("model") or {}).get("colorization")]
    os.makedirs(XML_CACHE, exist_ok=True)
    dump(sorted({i["model"]["path"] for i in items} | {TEXTURE_LIBRARY}))
    icons = (json.load(open(ICON_MANIFEST, encoding="utf-8")).get("icons") or {}) if os.path.isfile(ICON_MANIFEST) else {}

    per_item, wanted = OrderedDict(), OrderedDict()
    for item in items:
        model = item["model"]
        notes, slots = [], []
        evaluate(model["path"], model.get("arguments") or {}, notes, [], slots)
        seen, unique_slots = set(), []
        for slot in slots:
            key = (slot["model"], slot["mapping_texture"], slot["tag"], slot["material_parameter"], slot["file"],
                   signature(slot["colorizations"]))
            if key not in seen:
                seen.add(key)
                unique_slots.append(slot)
        per_item[item["config_name"]] = (item, unique_slots, notes)
        for slot in unique_slots:
            if slot["colorizations"] and slot["file"]:
                wanted.setdefault((slot["file"], signature(slot["colorizations"])), []).append(item["config_name"])

    names = asset_names(list(wanted))
    baked, bake_problems = {}, []
    for key, users in wanted.items():
        file_, sig = key
        source_abs = os.path.join(SK_RSRC, file_.replace("/", os.sep))
        if not os.path.isfile(source_abs):
            bake_problems.append({"source": file_, "reason": "texture file not in the install"})
            continue
        raw = json.loads(sig)
        zations, labels, unresolved = [], [], []
        for entry in raw:
            zation, reason = resolve(entry, classes)
            if zation is None:
                unresolved.append(reason)
            else:
                zations.append(zation)
                labels.append(zation.label)
        image, hits = bake_texture(source_abs, zations)
        png = os.path.join(OUT_DIR, names[key] + ".png")
        image.save(png)
        original = Image.open(source_abs).convert("RGBA")
        unchanged = original.size == image.size and original.tobytes() == image.convert("RGBA").tobytes()
        baked[key] = {"asset": names[key], "png": png, "source_abs": source_abs, "size": list(image.size),
                      "unchanged": unchanged,
                      "matched_pixels": OrderedDict(zip(labels, hits)), "unresolved_colorizations": unresolved,
                      "mode": Image.open(source_abs).mode}

    manifest, unresolved_items, multi_slot, no_item_colorization = OrderedDict(), [], [], []
    zero_match, variant_misses, no_visible_tint = [], [], []
    for config_name, (item, slots, notes) in per_item.items():
        model = item["model"]
        export = export_for(item)
        materials = glb_materials(export) if export else None
        textures, untinted = [], []
        for slot in slots:
            if not (slot["colorizations"] and slot["file"]):
                untinted.append({"source": slot["file"], "mapping_texture": slot["mapping_texture"],
                                 "material": slot["material"], "material_parameter": slot["material_parameter"]})
                continue
            key = (slot["file"], signature(slot["colorizations"]))
            entry = baked.get(key)
            hint = material_hint(slot, slots, materials)
            record = OrderedDict([
                ("source", slot["file"]),
                ("tinted_png", entry["png"] if entry else None),
                ("asset", entry["asset"] if entry else None),
                ("material_hint", hint),
                ("material_parameter", slot["material_parameter"]),
                ("material", slot["material"]),
                ("mapping_texture", slot["mapping_texture"]),
                ("model", slot["model"]),
                ("mesh_set", slot["mesh_set"]),
                ("colorizations", [c if isinstance(c, int) else colorization_token(c) for c in slot["colorizations"]]),
                ("matched_pixels", entry["matched_pixels"] if entry else None),
                ("unchanged_by_tint", entry["unchanged"] if entry else None),
            ])
            textures.append(record)
            if entry and entry["matched_pixels"] and not any(entry["matched_pixels"].values()):
                zero_match.append({"config_name": config_name, "source": slot["file"]})
        item_colorization = model["colorization"]
        carried = [t for t in textures if item_colorization in t["colorizations"]]
        evidence_bits = []
        for slot in slots:
            if slot["colorizations"] and slot["file"]:
                evidence_bits.append("%s -> mapping %s/%s, material %s, %s = %s(File %s, colorizations %s)" % (
                    " -> ".join(slot["trail"]), slot["mapping_texture"], slot["tag"], slot["material"],
                    slot["material_parameter"], slot["texture_config"], slot["file"],
                    [c if isinstance(c, int) else colorization_token(c) for c in slot["colorizations"]]))
        manifest[config_name] = OrderedDict([
            ("slot", item["slot"]),
            ("model", model["path"]),
            ("arguments", model.get("arguments")),
            ("colorization", item_colorization),
            ("textures", textures),
            ("untinted", untinted),
            ("export", export),
            ("evidence", " || ".join(evidence_bits) or "no tinted texture reached"),
            ("notes", notes),
        ])
        if not textures:
            reason = "no material slot with a colorized texture reached"
            if notes:
                reason += "; " + "; ".join(notes[:3])
            unresolved_items.append({"config_name": config_name, "model": model["path"], "reason": reason})
        elif not carried:
            no_item_colorization.append({"config_name": config_name, "colorization": item_colorization,
                                         "textures": [t["source"] for t in textures]})
        variant_misses.extend({"config_name": config_name, "note": n} for n in notes if "has no option" in n)
        if textures and all(t["unchanged_by_tint"] for t in textures):
            no_visible_tint.append(config_name)
        distinct = {(t["source"], t["material_parameter"], t["mapping_texture"]) for t in textures}
        if len(distinct) > 1:
            multi_slot.append({"config_name": config_name,
                               "slots": ["%s <- %s (%s)" % (t["mapping_texture"], t["source"], t["material_parameter"])
                                         for t in textures]})

    items_by_texture = {key: users for key, users in wanted.items()}
    samples = pick_samples(baked, items_by_texture, icons)
    contact_sheet(samples, CONTACT_SHEET)

    summary = OrderedDict([
        ("colorized_items", len(items)),
        ("items_resolved", len(items) - len(unresolved_items)),
        ("items_unresolved", len(unresolved_items)),
        ("distinct_textures_baked", len(baked)),
        ("distinct_source_files", len({k[0] for k in baked})),
        ("items_with_several_tinted_slots", len(multi_slot)),
        ("items_whose_textures_do_not_carry_their_colorization", len(no_item_colorization)),
        ("textures_matching_no_pixel", len(zero_match)),
        ("textures_identical_to_source", sum(1 for b in baked.values() if b["unchanged"])),
        ("items_with_no_visible_tint", len(no_visible_tint)),
        ("items_with_variant_not_an_option", len(variant_misses)),
        ("player_colour", PLAYER_COLOUR_NOTE),
        ("bake_problems", bake_problems),
        ("unresolved", unresolved_items),
        ("several_tinted_slots", multi_slot),
        ("colorization_not_carried", no_item_colorization),
        ("matching_no_pixel", zero_match),
        ("no_visible_tint", no_visible_tint),
        ("variant_not_an_option", variant_misses),
        ("contact_sheet", CONTACT_SHEET),
        ("seconds", round(time.perf_counter() - started, 1)),
    ])
    output = OrderedDict([("summary", summary)])
    output.update(manifest)
    with open(OUT_JSON, "w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=1, ensure_ascii=False)

    for key in ("colorized_items", "items_resolved", "items_unresolved", "distinct_textures_baked",
                "distinct_source_files", "items_with_several_tinted_slots",
                "items_whose_textures_do_not_carry_their_colorization", "textures_matching_no_pixel",
                "textures_identical_to_source", "items_with_no_visible_tint", "items_with_variant_not_an_option",
                "seconds"):
        print("%-54s %s" % (key, summary[key]))
    for entry in unresolved_items:
        print("unresolved: %s: %s" % (entry["config_name"], entry["reason"]))
    for entry in bake_problems:
        print("bake problem: %s: %s" % (entry["source"], entry["reason"]))
    print("wrote %s" % OUT_JSON)


if __name__ == "__main__":
    main()
