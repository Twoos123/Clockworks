# Unreal Editor Python script. Run it headless after importing world models:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/apply_world_textures.py"
#
# Why this exists
# ---------------
# Most of the world's models exported with placeholder materials and no textures at all. ThreeRingsSharp reads a
# texture in exactly one place - spelled out inline on a mesh mapping - so a model like `floor_base.dat`, which does
# that, came out right, while `wall.dat`, which points at a *named* material in the game's global material group, came
# out with 65 placeholders and no images. 1,793 materials across 377 models were affected; the Clockworks walls are the
# ones you see, as blank white slabs.
#
# The research in `_research/world_textures` resolved 1,726 of them out of the game's own configs and wrote both a
# mapping and a set of re-bound models. Re-importing the re-bound models alone is not enough: Interchange keeps the
# material assets it already made (their names are unchanged, deliberately, because the name is the join key), so the
# meshes come back with their textures and the materials stay white. This binds them from the mapping instead, which
# works whether or not the model was re-imported.
#
# Re-runnable. Textures are imported once and reused.

import json
import os
import re
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import floor_model_names

MAPPING = os.path.join(r"D:\Dev\SKAssets\_research", "world_textures", "world_textures.json")
TEXTURE_PARAM = "BaseColorTexture"


def sanitise(name):
    """The asset name Unreal makes from a glTF material name - the same rule its meshes follow."""
    return re.sub(r"[^A-Za-z0-9_-]", "_", name)


def import_texture(png, folder):
    """The texture asset for a source png, imported into this model's folder once and reused after."""
    name = sanitise(os.path.splitext(os.path.basename(png))[0])
    path = "%s/%s" % (folder, name)
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        return unreal.EditorAssetLibrary.load_asset(path)

    task = unreal.AssetImportTask()
    task.filename = png
    task.destination_path = folder
    task.destination_name = name
    task.automated = True
    task.replace_existing = False
    task.save = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])

    return unreal.EditorAssetLibrary.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None


def main():
    if not os.path.isfile(MAPPING):
        unreal.log_error("WorldTextures: no mapping at %s" % MAPPING)
        return

    with open(MAPPING, encoding="utf-8") as handle:
        models = json.load(handle).get("models") or {}

    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(["/Game/SK/World"], True)

    bound, already, no_material, no_texture = 0, 0, 0, 0
    missing_models = set()

    for model_dat, entry in models.items():
        glb = (entry.get("glb") or os.path.splitext(model_dat)[0] + ".glb").replace("\\", "/")
        category, asset = floor_model_names.model_asset(glb)
        folder = "/Game/SK/%s/%s" % (category, asset)
        if not unreal.EditorAssetLibrary.does_directory_exist(folder):
            missing_models.add(glb)
            continue

        for record in entry.get("materials") or []:
            png = record.get("texture")
            if not record.get("textureExists") or not png or not os.path.isfile(png):
                no_texture += 1
                continue

            material_path = "%s/Materials/%s" % (folder, sanitise(record["material"]))
            material = unreal.EditorAssetLibrary.load_asset(material_path) \
                if unreal.EditorAssetLibrary.does_asset_exist(material_path) else None
            if not isinstance(material, unreal.MaterialInstanceConstant):
                no_material += 1
                continue

            texture = import_texture(png, folder + "/Textures")
            if not texture:
                no_texture += 1
                continue

            current = unreal.MaterialEditingLibrary.get_material_instance_texture_parameter_value(material, TEXTURE_PARAM)
            if current == texture:
                already += 1
                continue

            unreal.MaterialEditingLibrary.set_material_instance_texture_parameter_value(material, TEXTURE_PARAM, texture)
            # The original's own flags for it: a cut-out fence is not a solid slab, and a sheet is seen from both sides.
            properties = record.get("properties") or {}
            if properties.get("twoSided"):
                material.set_editor_property("two_sided", True)
            unreal.EditorAssetLibrary.save_loaded_asset(material, False)
            bound += 1

    unreal.log_warning("WorldTextures: bound %d, already right %d, no material asset %d, no texture %d"
                       % (bound, already, no_material, no_texture))
    for glb in sorted(missing_models)[:10]:
        unreal.log_warning("WorldTextures:   model not imported: %s" % glb)


main()
