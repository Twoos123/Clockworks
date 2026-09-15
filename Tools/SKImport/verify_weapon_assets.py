# Unreal Editor Python script. Checks what generate_weapon_assets.py actually wrote.
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/verify_weapon_assets.py"
#
# Generating 351 assets unattended is only worth doing if something then reads them back, so this
# counts what landed and prints a handful in full.

import unreal

GEAR_PATH = "/Game/TopDown/Gear/Catalogue"
SAMPLES = ["DA_Weapon_Calibur", "DA_Weapon_Combuster", "DA_Weapon_BlitzNeedle", "DA_Weapon_Callahan"]


def describe(asset):
    status = asset.get_editor_property("status_effect")
    return "{0} | type {1} | x{2:.2f} | status {3} @ {4:.2f} | mesh {5} | icon {6}".format(
        asset.get_editor_property("display_name"),
        asset.get_damage_type_name(),
        asset.get_editor_property("damage_multiplier"),
        status.get_name() if status else "none",
        asset.get_editor_property("status_chance"),
        "yes" if asset.get_editor_property("mesh") else "NO",
        "yes" if asset.get_editor_property("icon") else "NO",
    )


def main():
    # A commandlet starts with an asset registry that has not walked the project yet, so a folder
    # full of assets lists as empty until it is told to look.
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([GEAR_PATH], True)

    paths = unreal.EditorAssetLibrary.list_assets(GEAR_PATH, recursive=False, include_folder=False)
    total = with_mesh = with_icon = with_status = with_ability = 0
    types = {}

    for path in paths:
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if not isinstance(asset, unreal.ClockworksWeaponDefinition):
            continue
        total += 1
        if asset.get_editor_property("mesh"):
            with_mesh += 1
        if asset.get_editor_property("icon"):
            with_icon += 1
        if asset.get_editor_property("status_effect"):
            with_status += 1
        if asset.get_editor_property("attack_ability"):
            with_ability += 1
        name = asset.get_damage_type_name()
        types[name] = types.get(name, 0) + 1

    unreal.log_warning("Clockworks: {0} weapon assets | {1} with a mesh | {2} with an icon | "
               "{3} with a status | {4} with an attack ability".format(
                   total, with_mesh, with_icon, with_status, with_ability))
    unreal.log_warning("Clockworks: damage types " + str(types))

    for name in SAMPLES:
        path = GEAR_PATH + "/" + name
        if unreal.EditorAssetLibrary.does_asset_exist(path):
            unreal.log_warning("Clockworks: " + describe(unreal.EditorAssetLibrary.load_asset(path)))


main()
