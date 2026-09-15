# Unreal Editor Python script. Run it headless after importing the HUD group:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/fix_hud_textures.py"
#
# The ImportAssets commandlet brings every PNG in as a world texture: mipmapped and block-compressed.
# That is wrong for interface art. Slate draws a pip at its own size, so mips only blur it, and
# compression smears the thin rims on the portrait and the minimap. This marks everything under
# /Game/SK/HUD as a UI texture: no mips, UserInterface2D compression, the UI texture group.
#
# Re-runnable. Only touches textures whose settings are not already right.

import unreal

HUD_PATH = "/Game/SK/HUD"


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([HUD_PATH], True)

    changed, total = 0, 0
    for path in unreal.EditorAssetLibrary.list_assets(HUD_PATH, recursive=True, include_folder=False):
        texture = unreal.EditorAssetLibrary.load_asset(path)
        if not isinstance(texture, unreal.Texture2D):
            continue
        total += 1

        wanted = {
            "lod_group": unreal.TextureGroup.TEXTUREGROUP_UI,
            "mip_gen_settings": unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS,
            "compression_settings": unreal.TextureCompressionSettings.TC_EDITOR_ICON,
        }
        dirty = False
        for name, value in wanted.items():
            if texture.get_editor_property(name) != value:
                texture.set_editor_property(name, value)
                dirty = True

        if dirty:
            unreal.EditorAssetLibrary.save_loaded_asset(texture, False)
            changed += 1

    unreal.log_warning("Clockworks: HUD textures: {0} found, {1} changed".format(total, changed))


main()
