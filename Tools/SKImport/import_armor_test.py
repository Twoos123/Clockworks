# Unreal Editor Python script. Run it headless:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/import_armor_test.py"
#
# Proves that knight armour exported through the knight (D:/Dev/SKAssets/_gear_export/armor) imports as skeletal
# meshes bound to the player knight's existing skeleton rather than each making a skeleton of its own, before all
# 60 armours are imported the same way. Imports two: the coat (one part) and the padded armour (three skinned
# parts: body, legs, hands) into /Game/SK/GearTest, then logs each mesh's skeleton, bone count and materials.
#
# The ImportAssets commandlet cannot name an existing skeleton, so this drives the Interchange manager directly
# with the generic assets pipeline's skeleton set.

import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stage_and_import import fix_armor_glb  # noqa: E402  (scene-root fix plus merging an armour's parts onto one skin)

EXPORTS = r"D:\Dev\SKAssets\_gear_export\armor"
STAGING = r"D:\Dev\SKAssets\_staging\GearTest"
DESTINATION = "/Game/SK/GearTest"
KNIGHT_SKELETON = "/Game/SK/Knights/PlayerKnight/SkeletalMeshes/coat_model-Mesh_0__Skeleton"
TESTS = [("coat__model.glb", "ArmorTestCoat"), ("padded__model_padded.glb", "ArmorTestPadded")]
# ARMOR_TESTS="padded__model_padded.glb:ArmorTestPadded,coat__model.glb:ArmorTestCoat" picks and orders the imports.
if os.environ.get("ARMOR_TESTS"):
    TESTS = [tuple(entry.split(":", 1)) for entry in os.environ["ARMOR_TESTS"].split(",") if ":" in entry]


def say(text):
    unreal.log_warning("ArmorTest: " + text)


_pipeline_count = [0]


def make_pipeline(skeleton):
    """A fresh generic assets pipeline for one import: skeletal meshes only, on the knight's skeleton, no animations
    or physics. One per import: a pipeline handed to one import is used up by it, and the next import given the same
    object starts and never finishes."""
    _pipeline_count[0] += 1
    # No outer given: new_object puts it in the transient package, so it is never saved.
    pipeline = unreal.new_object(unreal.InterchangeGenericAssetsPipeline, name="ArmorImportPipeline_%d" % _pipeline_count[0])
    say("pipeline %s created" % pipeline.get_path_name())

    skeletal = pipeline.get_editor_property("common_skeletal_meshes_and_animations_properties")
    skeletal.set_editor_property("skeleton", skeleton)
    skeletal.set_editor_property("import_only_animations", False)

    mesh = pipeline.get_editor_property("mesh_pipeline")
    mesh.set_editor_property("import_skeletal_meshes", True)
    mesh.set_editor_property("import_static_meshes", False)
    mesh.set_editor_property("create_physics_asset", False)

    animation = pipeline.get_editor_property("animation_pipeline")
    for prop in ("import_animations",):
        try:
            animation.set_editor_property(prop, False)
        except Exception as error:
            say("animation_pipeline.%s not set: %s" % (prop, error))
    return pipeline


def import_one(manager, pipeline, filename, name):
    folder = DESTINATION + "/" + name
    source = manager.create_source_data(filename)
    params = unreal.ImportAssetParameters()
    params.set_editor_property("is_automated", True)
    params.set_editor_property("replace_existing", True)
    try:
        params.set_editor_property("override_pipelines", [pipeline])
    except Exception as error:
        say("override_pipelines rejects an object (%s); trying a soft path" % error)
        params.set_editor_property("override_pipelines", [unreal.SoftObjectPath(pipeline.get_path_name())])
    result = manager.import_asset(folder, source, params)
    manager.wait_until_all_tasks_done(True)
    say("imported %s -> %s (result %s)" % (os.path.basename(filename), folder, result))
    return folder


def report(folder, skeleton):
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([folder], True)
    assets = unreal.EditorAssetLibrary.list_assets(folder, recursive=True, include_folder=False)
    say("%s holds %d assets" % (folder, len(assets)))
    for path in assets:
        asset = unreal.EditorAssetLibrary.load_asset(path)
        kind = asset.get_class().get_name()
        if isinstance(asset, unreal.SkeletalMesh):
            own = asset.get_editor_property("skeleton")
            bones = own.get_editor_property("bone_tree") if own else []
            materials = asset.get_editor_property("materials")
            say("  SkeletalMesh %s: skeleton %s (%s), %d bones, %d material slots" % (
                path, own.get_path_name() if own else None,
                "the knight's" if own == skeleton else "NOT the knight's", len(bones), len(materials)))
        else:
            say("  %s %s" % (kind, path))


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(["/Game/SK/Knights", "/Interchange"], True)
    skeleton = unreal.EditorAssetLibrary.load_asset(KNIGHT_SKELETON)
    if not skeleton:
        say("knight skeleton not found at " + KNIGHT_SKELETON)
        return
    say("knight skeleton %s, %d bones" % (skeleton.get_path_name(), len(skeleton.get_editor_property("bone_tree"))))

    os.makedirs(STAGING, exist_ok=True)
    manager = unreal.InterchangeManager.get_interchange_manager_scripted()
    for glb, name in TESTS:
        pipeline = make_pipeline(skeleton)
        staged = os.path.join(STAGING, name + ".glb")
        fix_armor_glb(os.path.join(EXPORTS, glb), staged)
        folder = import_one(manager, pipeline, staged, name)
        unreal.EditorAssetLibrary.save_directory(folder, only_if_is_dirty=False, recursive=True)
        report(folder, skeleton)


main()
