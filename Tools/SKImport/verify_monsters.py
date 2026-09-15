# Checks what generate_monsters.py wrote. See that script for why the monsters exist at all.
import unreal

OUT_PATH = "/Game/TopDown/Blueprints/Monsters"


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([OUT_PATH], True)

    for path in sorted(unreal.EditorAssetLibrary.list_assets(OUT_PATH, recursive=False, include_folder=False)):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if not isinstance(asset, unreal.Blueprint):
            continue
        cdo = unreal.get_default_object(asset.generated_class())
        if not isinstance(cdo, unreal.ClockworksEnemyCharacter):
            continue

        mesh_component = cdo.get_editor_property("mesh")
        has_mesh = bool(mesh_component and mesh_component.get_editor_property("skeletal_mesh_asset"))
        capsule = cdo.get_editor_property("capsule_component")

        # The two numbers most likely to be wrong on a generated monster: how tall its capsule ended
        # up, and how far its mesh was dropped to stand on the floor of it.
        half_height = capsule.get_editor_property("capsule_half_height") if capsule else 0.0
        mesh_z = mesh_component.get_editor_property("relative_location").z if mesh_component else 0.0

        unreal.log_warning(
            "Clockworks: {0} | mesh {1} | anims i{2} m{3} d{4} | {5} | hp {6:.0f} | ability {7} | snd {8} | "
            "capsule {9:.0f} | mesh z {10:.0f}".format(
                asset.get_name(),
                "yes" if has_mesh else "NO",
                "y" if cdo.get_editor_property("idle_anim") else "N",
                "y" if cdo.get_editor_property("move_anim") else "N",
                "y" if cdo.get_editor_property("death_anim") else "N",
                cdo.get_family_tag_name(),
                cdo.get_editor_property("initial_health"),
                len(cdo.get_editor_property("default_abilities")),
                "y" if cdo.get_editor_property("aggro_sound") else "N",
                half_height, mesh_z))


main()
