# Unreal Editor Python script. Run it headless with:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/generate_bestiary_level.py"
#
# Builds Content/TopDown/Lvl_Bestiary: a flat floor with every monster in the project standing on
# it in a row, each with a name plate.
#
# It exists because nine monsters were generated unattended and none of them had been seen. Their
# mesh rotation and vertical offset are the knight's numbers applied to every skeleton, and some of
# those will be wrong; a row of them side by side is the fastest way to see which.
#
# Deliberately a new level rather than the test arena, so nothing anyone has hand-placed is touched.

import unreal

LEVEL_PATH = "/Game/TopDown/Lvl_Bestiary"
MONSTERS_PATH = "/Game/TopDown/Blueprints/Monsters"
BLUEPRINTS = "/Game/TopDown/Blueprints"

# Far enough apart that two of them cannot be confused for one, and that a big one has room.
SPACING = 350.0
ROW_LENGTH = 5

FLOOR_MESH = "/Engine/BasicShapes/Cube.Cube"


def load(path):
    return unreal.EditorAssetLibrary.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None


def spawn(cls, location, rotation=None):
    return unreal.EditorLevelLibrary.spawn_actor_from_class(
        cls, location, rotation or unreal.Rotator(0.0, 0.0, 0.0))


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([MONSTERS_PATH, BLUEPRINTS], True)

    # Gather every monster Blueprint in the project, generated or hand-made.
    classes = []
    for folder in (MONSTERS_PATH, BLUEPRINTS):
        if not unreal.EditorAssetLibrary.does_directory_exist(folder):
            continue
        for path in sorted(unreal.EditorAssetLibrary.list_assets(folder, recursive=False, include_folder=False)):
            asset = unreal.EditorAssetLibrary.load_asset(path)
            if not isinstance(asset, unreal.Blueprint):
                continue
            generated = asset.generated_class()
            if not generated:
                continue
            cdo = unreal.get_default_object(generated)
            # Training dummies are not monsters and would only pad the row.
            if isinstance(cdo, unreal.ClockworksEnemyCharacter) and "Dummy" not in asset.get_name():
                classes.append((asset.get_name(), generated))

    if not classes:
        unreal.log_warning("Clockworks: no monster blueprints found; nothing to build")
        return

    unreal.EditorLevelLibrary.new_level(LEVEL_PATH)

    # A floor to stand on, and a light so they are not silhouettes.
    floor_mesh = load(FLOOR_MESH)
    if floor_mesh:
        width = max(ROW_LENGTH, 1) * SPACING + 600.0
        depth = (len(classes) // ROW_LENGTH + 2) * SPACING + 600.0
        floor = spawn(unreal.StaticMeshActor, unreal.Vector(width * 0.4, depth * 0.4, -50.0))
        if floor:
            component = floor.static_mesh_component
            component.set_static_mesh(floor_mesh)
            component.set_relative_scale3d(unreal.Vector(width / 100.0, depth / 100.0, 1.0))
            floor.set_actor_label("BestiaryFloor")

    spawn(unreal.DirectionalLight, unreal.Vector(0.0, 0.0, 1200.0), unreal.Rotator(-50.0, -35.0, 0.0))
    spawn(unreal.SkyLight, unreal.Vector(0.0, 0.0, 900.0))
    spawn(unreal.PlayerStart, unreal.Vector(-500.0, -500.0, 100.0))

    placed = 0
    for index, (name, generated) in enumerate(classes):
        column = index % ROW_LENGTH
        row = index // ROW_LENGTH
        location = unreal.Vector(column * SPACING, row * SPACING, 100.0)

        # Facing the camera rather than along the row, so every one is seen from the same side.
        actor = spawn(generated, location, unreal.Rotator(0.0, 0.0, -135.0))
        if not actor:
            continue
        actor.set_actor_label(name)

        # A name plate, so a row of unfamiliar silhouettes can be told apart.
        label = spawn(unreal.TextRenderActor, unreal.Vector(location.x, location.y, location.z + 190.0),
                      unreal.Rotator(0.0, 0.0, -135.0))
        if label:
            component = label.text_render
            component.set_text(unreal.Text(name.replace("BP_", "")))
            component.set_horizontal_alignment(unreal.HorizTextAligment.EHTA_CENTER)
            component.set_world_size(28.0)
            label.set_actor_label(name + "_Label")
        placed += 1

    unreal.EditorLevelLibrary.save_current_level()
    unreal.log_warning("Clockworks: bestiary built with {0} monsters at {1}".format(placed, LEVEL_PATH))
    unreal.log_warning("Clockworks: monsters placed: " + ", ".join(n for n, _ in classes))


main()
