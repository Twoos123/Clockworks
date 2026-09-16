"""Which imported asset answers to which of the original's model files.

The floor manifests in D:\\Dev\\SKAssets\\_floors name their models by resource path
("world/tileset/clockworks/floor/floor_base.glb") and their pieces by node
("floor.floor_base-MeshSets[catwalk_08].Mesh[0]"). Two tools need to agree on where those end up in
the project: stage_and_import.py, which imports them, and generate_floor_assets.py, which points a
floor's mesh groups at them. This is the one rule both read.

A model becomes `/Game/SK/<category>/<name>/StaticMeshes/<sanitised node>`; Unreal makes the folder
from the staged file's name and the mesh from the glTF node's, replacing anything that is not a
letter, a digit, an underscore or a hyphen.
"""
import re

# The nine tileset and prop models that were imported by hand before the floor pipeline existed.
# They keep their folders so nothing that already points at them breaks.
PRE_IMPORTED = {
    "world/tileset/clockworks/floor/floor_base.glb":     ("World/Clockworks", "CW_FloorBase"),
    "world/tileset/clockworks/wall/wall.glb":            ("World/Clockworks", "CW_Wall"),
    "world/tileset/clockworks/wall/roof_gear_6x2.glb":   ("World/Clockworks", "CW_RoofGear6x2"),
    "world/tileset/clockworks/fence/fence_high.glb":     ("World/Clockworks", "CW_FenceHigh"),
    "world/tileset/clockworks/fence/fence_low.glb":      ("World/Clockworks", "CW_FenceLow"),
    "world/tileset/clockworks/edge_rail/rail.glb":       ("World/Clockworks", "CW_EdgeRail"),
    "world/prop/clockworks/factory/control_console.glb": ("World/Clockworks", "CW_ControlConsole"),
    "world/prop/clockworks/factory/conveyor_x2_01.glb":  ("World/Clockworks", "CW_Conveyor2"),
    "world/prop/clockworks/lamp_rail01.glb":             ("World/Clockworks", "CW_LampRail"),
    "world/prop/generic/altar_x3.glb":                   ("World/Props", "AltarX3"),
    "world/prop/generic/bones.glb":                      ("World/Props", "Bones"),
}

# Where the rest go, by what they are. A floor is mostly tiles and props, but a scene also names
# characters (a shopkeeper), items (a heat capsule on a pedestal) and effect planes.
CATEGORY_BY_ROOT = {
    "world": "World/Floors",
    "character": "World/Floors",
    "item": "World/Floors",
    "particle": "World/Floors",
    "editor": "World/Floors",
}

PREFIX_BY_KIND = {
    "tileset": "TS_",
    "prop": "P_",
    "dynamic": "D_",
    "readyroom": "RR_",
    "character": "C_",
    "item": "I_",
    "particle": "FX_",
    "editor": "ED_",
}


def _camel(word):
    return "".join(part[:1].upper() + part[1:] for part in re.split(r"[^A-Za-z0-9]+", word) if part)


def model_asset(glb):
    """(content category, asset name) for a model named by a manifest, e.g.
    "world/tileset/clockworks/floor/floor_base.glb" -> ("World/Floors", "TS_ClockworksFloorFloorBase")."""
    glb = glb.replace("\\", "/")
    if glb in PRE_IMPORTED:
        return PRE_IMPORTED[glb]

    parts = glb[:-4].split("/") if glb.endswith(".glb") else glb.split("/")
    root = parts[0]
    rest = parts[1:] if root == "world" else parts
    kind = rest[0] if root == "world" else root
    if root == "world":
        rest = rest[1:]

    # "model" and "model_something" are the game's name for a model file, not for the thing itself.
    if rest and rest[-1].startswith("model"):
        tail = rest[-1][len("model"):].strip("_-")
        rest = rest[:-1] + ([tail] if tail else [])

    name = PREFIX_BY_KIND.get(kind, "W_") + "".join(_camel(part) for part in rest)
    return CATEGORY_BY_ROOT.get(root, "World/Floors"), name


def mesh_asset_name(node):
    """The static mesh Unreal makes from a glTF node: 'floor.floor_base-MeshSets[catwalk_08].Mesh[0]'
    becomes 'floor_floor_base-MeshSets_catwalk_08__Mesh_0_'."""
    return re.sub(r"[^A-Za-z0-9_-]", "_", node)


def mesh_object_path(glb, node):
    """The full object path of one piece of one model, e.g.
    '/Game/SK/World/Clockworks/CW_FloorBase/StaticMeshes/floor_floor_base-MeshSets_catwalk_08__Mesh_0_'."""
    category, asset = model_asset(glb)
    return "/Game/SK/%s/%s/StaticMeshes/%s" % (category, asset, mesh_asset_name(node))


def single_mesh_object_path(glb):
    """Where a model with only one mesh in it ends up: Unreal names that one after the file rather than after the
    node, so a toughbox is 'P_KnightsToughboxEmpty', not 'knights_toughbox_empty-Mesh_0_'."""
    category, asset = model_asset(glb)
    return "/Game/SK/%s/%s/StaticMeshes/%s" % (category, asset, asset)
