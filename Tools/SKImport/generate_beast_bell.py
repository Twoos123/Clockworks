# Unreal Editor Python script. Run it headless after importing the BeastBell model (stage_and_import.py --names BeastBell):
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/generate_beast_bell.py"
#
# Builds Content/TopDown/Blueprints/BP_BeastBell from the imported bell: its mesh, the ring and ready clips, and its
# sounds. The bell is the whole of the Snarbolax fight (research: D:\Dev\SKAssets\_research\bosses\boss_mechanics.md):
# one hit rings it, every wolver and the Snarbolax within 4.5 tiles is stunned (the user's decision 2026-09-15:
# wolvers and the Snarbolax only), the boss takes its own 8 s stun and is open to damage for it, and the bell will not
# ring again for 8 s.
#
# The class itself is AClockworksBeastBell; this only makes the Blueprint that carries the assets.

import unreal

BELL = "/Game/SK/World/Props/BeastBell/SkeletalMeshes"
OUT_PATH = "/Game/TopDown/Blueprints"
NAME = "BP_BeastBell"
AUDIO = "/Game/SK/Audio"


def load(path):
    return unreal.EditorAssetLibrary.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None


def clip(name):
    return load("{0}/BeastBell{1}.BeastBell{1}".format(BELL, name))


def sound(name):
    return load("{0}/{1}.{1}".format(AUDIO, name))


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([BELL, AUDIO, OUT_PATH], True)

    mesh = None
    for path in unreal.EditorAssetLibrary.list_assets(BELL, recursive=False, include_folder=False):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if isinstance(asset, unreal.SkeletalMesh):
            mesh = asset
            break
    if not mesh:
        unreal.log_warning("BeastBell: no skeletal mesh under %s; import it first" % BELL)
        return

    path = OUT_PATH + "/" + NAME
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        blueprint = unreal.EditorAssetLibrary.load_asset(path)
    else:
        factory = unreal.BlueprintFactory()
        factory.set_editor_property("parent_class", unreal.ClockworksBeastBell)
        blueprint = unreal.AssetToolsHelpers.get_asset_tools().create_asset(NAME, OUT_PATH, None, factory)
    if not blueprint:
        unreal.log_warning("BeastBell: could not create " + path)
        return

    cdo = unreal.get_default_object(blueprint.generated_class())

    # The export is Z-up where glTF is Y-up, the same as every other Spiral Knights model here.
    bell_mesh = cdo.get_editor_property("bell_mesh")
    if bell_mesh:
        bell_mesh.set_editor_property("skeletal_mesh_asset", mesh)
        bell_mesh.set_relative_rotation(unreal.Rotator(-90.0, 0.0, -90.0), False, False)

    # activate_sequence is the whole ring: the lights switch, the arm swings the bell, the arm retracts.
    cdo.set_editor_property("ring_anim", clip("activate_sequence") or clip("activate_ring"))
    cdo.set_editor_property("ready_anim", clip("inactive_extend") or clip("state_inactive"))
    cdo.set_editor_property("ring_sound", sound("S_BeastBellRing") or sound("S_SnarbolaxRush"))
    cdo.set_editor_property("dull_sound", sound("S_BeastBellDull") or sound("S_MonsterHurt"))

    unreal.EditorAssetLibrary.save_loaded_asset(blueprint, False)
    unreal.log_warning("BeastBell: %s built on %s (ring %s, ready %s, sounds %s / %s)" % (
        NAME, mesh.get_name(),
        cdo.get_editor_property("ring_anim").get_name() if cdo.get_editor_property("ring_anim") else None,
        cdo.get_editor_property("ready_anim").get_name() if cdo.get_editor_property("ready_anim") else None,
        cdo.get_editor_property("ring_sound").get_name() if cdo.get_editor_property("ring_sound") else None,
        cdo.get_editor_property("dull_sound").get_name() if cdo.get_editor_property("dull_sound") else None))


main()
