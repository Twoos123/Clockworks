# Unreal Editor Python script. Run it headless after importing the GearIcons and GearUI groups:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/fix_gear_textures.py"
#
# The same fix fix_hud_textures.py makes for the HUD, for the gear screen's art: the ImportAssets commandlet
# brings every PNG in as a world texture (mipmapped, block-compressed), which blurs an icon drawn at its own
# size and smears the thin rims of the item cards. Marks everything under the paths below as a UI texture.
#
# Re-runnable. Only touches textures whose settings are not already right.

import unreal

PATHS = ["/Game/SK/GearIcons", "/Game/SK/GearUI"]


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(PATHS, True)

    wanted = {
        "lod_group": unreal.TextureGroup.TEXTUREGROUP_UI,
        "mip_gen_settings": unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS,
        "compression_settings": unreal.TextureCompressionSettings.TC_EDITOR_ICON,
    }
    for root in PATHS:
        changed, total = 0, 0
        for path in unreal.EditorAssetLibrary.list_assets(root, recursive=True, include_folder=False):
            texture = unreal.EditorAssetLibrary.load_asset(path)
            if not isinstance(texture, unreal.Texture2D):
                continue
            total += 1
            dirty = False
            for name, value in wanted.items():
                if texture.get_editor_property(name) != value:
                    texture.set_editor_property(name, value)
                    dirty = True
            if dirty:
                unreal.EditorAssetLibrary.save_loaded_asset(texture, False)
                changed += 1
        unreal.log_warning("Clockworks: gear textures under {0}: {1} found, {2} changed".format(root, total, changed))


main()
