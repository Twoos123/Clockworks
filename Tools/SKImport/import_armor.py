# Unreal Editor Python script. Run it headless, once per armour (run_armor_imports.py does that):
#
#   set ARMOR_IMPORT=<armour glb>|<asset name>
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript -script="D:/Dev/Clockworks/Tools/SKImport/import_armor.py"
#
# Imports one knight armour exported through the knight (D:/Dev/SKAssets/_gear_export/armor) as a skeletal
# mesh on the player knight's own skeleton, into /Game/SK/Gear/Armor/<asset name>. Staged with fix_armor_glb
# (parts merged onto one skin, placeholder materials linked, what Interchange refuses repaired).
#
# One armour per run: only the first Interchange import of a headless run completes. The ImportAssets
# commandlet cannot name an existing skeleton, so this drives the Interchange manager directly.

import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stage_and_import import fix_armor_glb  # noqa: E402

STAGING = r"D:\Dev\SKAssets\_staging\GearArmor"
DESTINATION = "/Game/SK/Gear/Armor"
KNIGHT_SKELETON = "/Game/SK/Knights/PlayerKnight/SkeletalMeshes/coat_model-Mesh_0__Skeleton"


def say(text):
    unreal.log_warning("ArmorImport: " + text)


def main():
    spec = os.environ.get("ARMOR_IMPORT", "")
    if "|" not in spec:
        say("ARMOR_IMPORT is not set to '<glb>|<asset name>'")
        return
    glb, name = spec.split("|", 1)

    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(["/Game/SK/Knights", DESTINATION], True)
    skeleton = unreal.EditorAssetLibrary.load_asset(KNIGHT_SKELETON)
    if not skeleton:
        say("FAIL %s: knight skeleton not found at %s" % (name, KNIGHT_SKELETON))
        return

    os.makedirs(STAGING, exist_ok=True)
    staged = os.path.join(STAGING, name + ".glb")
    dropped = fix_armor_glb(glb, staged)
    if dropped:
        say("%s: parts with bones the knight lacks left out: %s" % (name, dropped))

    pipeline = unreal.new_object(unreal.InterchangeGenericAssetsPipeline, name="ArmorImportPipeline")
    skeletal = pipeline.get_editor_property("common_skeletal_meshes_and_animations_properties")
    skeletal.set_editor_property("skeleton", skeleton)
    skeletal.set_editor_property("import_only_animations", False)
    mesh = pipeline.get_editor_property("mesh_pipeline")
    mesh.set_editor_property("import_skeletal_meshes", True)
    mesh.set_editor_property("import_static_meshes", False)
    mesh.set_editor_property("create_physics_asset", False)
    try:
        pipeline.get_editor_property("animation_pipeline").set_editor_property("import_animations", False)
    except Exception as error:
        say("animations setting not applied: %s" % error)

    params = unreal.ImportAssetParameters()
    params.set_editor_property("is_automated", True)
    params.set_editor_property("replace_existing", True)
    params.set_editor_property("override_pipelines", [unreal.SoftObjectPath(pipeline.get_path_name())])

    folder = DESTINATION + "/" + name
    manager = unreal.InterchangeManager.get_interchange_manager_scripted()
    manager.import_asset(folder, manager.create_source_data(staged), params)
    manager.wait_until_all_tasks_done(True)
    unreal.EditorAssetLibrary.save_directory(folder, only_if_is_dirty=False, recursive=True)

    registry.scan_paths_synchronous([folder], True)
    meshes = []
    for path in unreal.EditorAssetLibrary.list_assets(folder, recursive=True, include_folder=False):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if isinstance(asset, unreal.SkeletalMesh):
            own = asset.get_editor_property("skeleton")
            meshes.append((path, own == skeleton, len(asset.get_editor_property("materials"))))
    good = [m for m in meshes if m[1]]
    if good:
        say("OK %s -> %s (%d material slots)" % (name, good[0][0], good[0][2]))
    else:
        say("FAIL %s: no skeletal mesh on the knight's skeleton in %s (%s)" % (name, folder, meshes))


main()
