# Unreal Editor Python script. Run it headless:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/make_ready_room.py"
#
# Makes /Game/TopDown/Floors/DA_Floor_ReadyRoom from the imported ready-room model, so the hub a knight appears in goes
# through the same builder every dungeon floor does - the same lighting, the same pinned exposure, the same object
# rules.
#
# Why a model and not a scene
# ---------------------------
# `world/readyroom/scene.dat` exists and resolves, but it places only the furniture: the control panel, the monitor
# banks, some toughboxes and the arsenal. The room itself is not in it. `model_readyroom.dat` is a compound model that
# holds the whole room - shell, panel, monitors and furniture, 34 meshes - so that is the better source and the scene
# is not used.
#
# There is no floor, because nothing walks
# ----------------------------------------
# The ready room is not a place you move around in: it is a fixed view of a set with the interface over it, and the
# only thing you do there is press things. The user confirmed this. So the definition carries no cells at all - no
# floor, no walls, no navigation - and the camera is what does the work.
#
# Re-runnable.

import unreal

ROOM_MESHES = "/Game/SK/World/Rooms/ReadyRoom/StaticMeshes"
DEST = "/Game/TopDown/Floors"
ASSET = "DA_Floor_ReadyRoom"
LEVEL = "/Game/TopDown/Lvl_ReadyRoom"
GAME_MODE = "/Game/TopDown/Blueprints/BP_TopDownGameMode.BP_TopDownGameMode_C"
TILE_CM = 100.0
ELEVATION_CM = 50.0


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([ROOM_MESHES, DEST], True)

    meshes = []
    for path in unreal.EditorAssetLibrary.list_assets(ROOM_MESHES, recursive=False, include_folder=False):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if isinstance(asset, unreal.StaticMesh):
            meshes.append(asset)
    if not meshes:
        unreal.log_error("ReadyRoom: no meshes under %s - import the model first" % ROOM_MESHES)
        return

    # The model is one piece placed at the origin, so every mesh sits at identity.
    identity = unreal.Transform()
    groups, low, high = [], None, None
    for mesh in meshes:
        group = unreal.ClockworksFloorMeshGroup()
        group.set_editor_property("mesh", mesh)
        group.set_editor_property("instances", [identity])
        group.set_editor_property("source", "world/readyroom/model_readyroom.dat|" + mesh.get_name())
        groups.append(group)

        bounds = mesh.get_bounds()
        origin, extent = bounds.origin, bounds.box_extent
        corners = (unreal.Vector(origin.x - extent.x, origin.y - extent.y, origin.z - extent.z),
                   unreal.Vector(origin.x + extent.x, origin.y + extent.y, origin.z + extent.z))
        for corner in corners:
            low = corner if low is None else unreal.Vector(min(low.x, corner.x), min(low.y, corner.y), min(low.z, corner.z))
            high = corner if high is None else unreal.Vector(max(high.x, corner.x), max(high.y, corner.y), max(high.z, corner.z))

    # No cells. Nothing stands on this and nothing walks through it.
    cells = []
    floor_z = low.z

    path = DEST + "/" + ASSET
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        asset = unreal.EditorAssetLibrary.load_asset(path)
    else:
        asset = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            ASSET, DEST, unreal.ClockworksFloorDefinition, unreal.DataAssetFactory())
    if not asset:
        unreal.log_error("ReadyRoom: could not make %s" % path)
        return

    asset.set_editor_property("level_name", "Ready Room")
    asset.set_editor_property("scene_id", "readyroom/model")
    asset.set_editor_property("tile_cm", TILE_CM)
    asset.set_editor_property("elevation_cm", ELEVATION_CM)
    asset.set_editor_property("mesh_groups", groups)
    asset.set_editor_property("cells", cells)
    # The room's own blue-lit look. The scene beside it records one point light and an ambient, and this is that
    # ambient; the rest of its light is in the monitors, which are emissive in the original and flat here.
    asset.set_editor_property("ambient_color", unreal.LinearColor(0.16, 0.30, 0.44, 1.0))
    asset.set_editor_property("background_color", unreal.LinearColor(0.02, 0.04, 0.07, 1.0))
    unreal.EditorAssetLibrary.save_loaded_asset(asset, False)

    unreal.log_warning("ReadyRoom: %s - %d meshes, no floor (nothing walks here), set is %.0f x %.0f x %.0f cm at z %.0f"
                       % (ASSET, len(groups), high.x - low.x, high.y - low.y, high.z - low.z, floor_z))

    build_level(asset, low, high)


def build_level(asset, low, high):
    """The ready room's own level: the set, a camera pointed at it, and nothing to walk on."""
    level_editor = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    if unreal.EditorAssetLibrary.does_asset_exist(LEVEL):
        if not level_editor.load_level(LEVEL):
            unreal.log_error("ReadyRoom: could not open %s" % LEVEL)
            return
        for actor in actors.get_all_level_actors():
            actors.destroy_actor(actor)
    elif not level_editor.new_level(LEVEL):
        unreal.log_error("ReadyRoom: could not make %s" % LEVEL)
        return

    centre = unreal.Vector((low.x + high.x) * 0.5, (low.y + high.y) * 0.5, (low.z + high.z) * 0.5)

    builder = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.ClockworksFloorBuilder, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    builder.set_editor_property("floor", asset)
    builder.set_editor_property("build_lights", False)
    builder.set_actor_label("ReadyRoomSet")

    # Chosen by comparing six angles in headless runs: this one faces the control console, which is what the original
    # puts in front of you. The original's own framing is in a bounded camera whose numbers are not recovered, and
    # `Clockworks.RoomCamera` moves this one live if a better angle is wanted.
    eye = unreal.Vector(centre.x, centre.y + 560.0, centre.z + 140.0)
    look = unreal.MathLibrary.find_look_at_rotation(eye, centre)
    room = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.ClockworksReadyRoom, eye, look)
    room.set_actor_label("ReadyRoom")

    # The game mode wants somewhere to put the knight even though it is never shown here.
    start = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.PlayerStart, unreal.Vector(centre.x, centre.y, centre.z), unreal.Rotator(0, 0, 0))
    start.set_actor_label("PlayerStart")

    sun = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.DirectionalLight, unreal.Vector(centre.x, centre.y, centre.z + 900.0), unreal.Rotator(0.0, -55.0, 20.0))
    sun.set_actor_label("Sun")
    sky = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.SkyLight, unreal.Vector(centre.x, centre.y, centre.z + 400.0))
    sky.set_actor_label("SkyLight")

    world = unreal.EditorLevelLibrary.get_editor_world()
    if world and world.get_world_settings():
        mode = unreal.load_class(None, GAME_MODE)
        if mode:
            world.get_world_settings().set_editor_property("default_game_mode", mode)

    level_editor.save_current_level()
    unreal.log_warning("ReadyRoom: %s built, camera at %s looking at the set" % (LEVEL, eye))


main()
