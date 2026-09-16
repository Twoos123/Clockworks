# Unreal Editor Python script. Run it headless after importing world models:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/fix_floor_materials.py"
#
# Why this exists
# ---------------
# A floor is drawn with instanced static mesh components, because a floor is a few hundred models repeated a few
# thousand times and an actor apiece would cost more than the rest of the game. Unreal will only use a material on an
# instanced mesh if that material is flagged for it, and the glTF importer's materials are not:
#
#   LogMaterial: Warning: Material .../floor_catwalk_bit1 missing usage flag InstancedStaticMeshes!
#                Default Material will be used in game.
#
# So every world surface was silently drawn with the engine's grey checker while its real texture sat loaded and unused.
#
# The flag belongs to the parent material, which lives in an engine plugin and is not ours to edit. Writing a master
# material of our own instead does not work either: this project runs Substrate, the importer's parent is specifically
# the Substrate build of M_GLTF, and a hand-authored legacy material outputs nothing at all under it - the whole world
# turned invisible rather than grey. So the parent is *copied* into the project, exactly as it is, and the flags are set
# on the copy. Same graph, same parameter names, so every material instance keeps its texture when it is re-parented.
#
# Re-runnable. Run it again after importing more world models.

import unreal

MASTER_PATH = "/Game/TopDown/Materials"
MASTER_NAME = "M_SKWorld_GLTF"
FOLDERS = ["/Game/SK/World"]
# Every imported material, for the usage-flag pass below; only World materials are re-parented.
ALL_SK = "/Game/SK"
TEXTURE_PARAM = "BaseColorTexture"

# What the glTF importer parents its materials to on this engine. Only used when every material has already been
# re-parented and there is no original left to copy from.
IMPORT_PARENT = "/InterchangeAssets/gltf/Substrate/M_GLTF.M_GLTF"


def make_master():
    """The project's own copy of whichever material the importer parented these to, with the usage flags set.

    Copied rather than authored: the importer's parent is the Substrate build of the glTF material, and reproducing it
    by hand is both fragile and unnecessary. Settings are applied every run, so fixing them here and re-running fixes
    every material in the project."""
    full = MASTER_PATH + "/" + MASTER_NAME
    master = unreal.EditorAssetLibrary.load_asset(full) if unreal.EditorAssetLibrary.does_asset_exist(full) else None

    if not master:
        source = find_import_parent()
        if not source:
            unreal.log_error("FloorMaterials: no imported material to copy a parent from")
            return None
        unreal.log_warning("FloorMaterials: copying %s" % source.get_path_name())
        master = unreal.EditorAssetLibrary.duplicate_asset(source.get_path_name(), full)
        if not master:
            unreal.log_error("FloorMaterials: could not copy it to %s" % full)
            return None

    # The whole point: without these the engine swaps in its default checker.
    for flag in ("used_with_instanced_static_meshes", "used_with_nanite", "used_with_static_lighting",
                 "used_with_skeletal_mesh"):
        try:
            master.set_editor_property(flag, True)
        except Exception as error:
            unreal.log_warning("FloorMaterials: could not set %s (%s)" % (flag, error))

    unreal.MaterialEditingLibrary.recompile_material(master)
    unreal.EditorAssetLibrary.save_loaded_asset(master, False)
    unreal.log_warning("FloorMaterials: master %s ready (instanced-mesh and Nanite usage on)" % full)
    return master


def find_import_parent():
    """The material the importer gave these instances, which is the one worth copying."""
    for path in unreal.EditorAssetLibrary.list_assets(FOLDERS[0], recursive=True, include_folder=False):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if isinstance(asset, unreal.MaterialInstanceConstant):
            parent = asset.get_editor_property("parent")
            if parent and not parent.get_path_name().startswith(MASTER_PATH):
                return parent
    # EditorAssetLibrary will not reach into a plugin's content that the registry has not walked; the plain loader will.
    return unreal.load_asset(IMPORT_PARENT) or unreal.load_object(None, IMPORT_PARENT)


def fix_usage_flags():
    """Sets the missing usage flags on every base material the project owns.

    The same bug that made the floors grey also hits the knight: an armour or gear material that is not flagged for
    skeletal meshes or for Nanite is replaced by the default one. These parents are ours, so they are fixed where they
    stand rather than copied."""
    seen, fixed = set(), 0
    for path in unreal.EditorAssetLibrary.list_assets(ALL_SK, recursive=True, include_folder=False):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        base = None
        if isinstance(asset, unreal.MaterialInstanceConstant):
            base = asset.get_editor_property("parent")
            while isinstance(base, unreal.MaterialInstanceConstant):
                base = base.get_editor_property("parent")
        elif isinstance(asset, unreal.Material):
            base = asset
        if not base or not isinstance(base, unreal.Material):
            continue

        name = base.get_path_name()
        # Only what the project owns: an engine or plugin material is not ours to change.
        if name in seen or not name.startswith("/Game/"):
            continue
        seen.add(name)

        changed = False
        for flag in ("used_with_instanced_static_meshes", "used_with_nanite", "used_with_skeletal_mesh",
                     "used_with_static_lighting"):
            try:
                if not base.get_editor_property(flag):
                    base.set_editor_property(flag, True)
                    changed = True
            except Exception:
                pass
        if changed:
            unreal.MaterialEditingLibrary.recompile_material(base)
            unreal.EditorAssetLibrary.save_loaded_asset(base, False)
            fixed += 1

    unreal.log_warning("FloorMaterials: usage flags set on %d of %d base materials the project owns" % (fixed, len(seen)))


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(FOLDERS + [MASTER_PATH, ALL_SK], True)

    master = make_master()
    if not master:
        return

    moved, already, skipped = 0, 0, []
    for path in unreal.EditorAssetLibrary.list_assets(FOLDERS[0], recursive=True, include_folder=False):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if not isinstance(asset, unreal.MaterialInstanceConstant):
            continue

        parent = asset.get_editor_property("parent")
        if parent == master:
            already += 1
            continue

        # Keep the texture the importer found, then re-parent. Both masters call the parameter the same thing, so the
        # value survives; reading it first means a material whose texture did not import is reported rather than
        # silently turned into a blank one.
        texture = None
        try:
            texture = unreal.MaterialEditingLibrary.get_material_instance_texture_parameter_value(asset, TEXTURE_PARAM)
        except Exception:
            pass

        asset.set_editor_property("parent", master)
        if texture:
            unreal.MaterialEditingLibrary.set_material_instance_texture_parameter_value(asset, TEXTURE_PARAM, texture)
        else:
            skipped.append(asset.get_name())

        unreal.EditorAssetLibrary.save_loaded_asset(asset, False)
        moved += 1

    unreal.log_warning("FloorMaterials: re-parented %d, already ours %d, no base colour texture %d"
                       % (moved, already, len(skipped)))
    for name in skipped[:10]:
        unreal.log_warning("FloorMaterials:   no texture: %s" % name)

    fix_usage_flags()


main()
