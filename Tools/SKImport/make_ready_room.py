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
# Why the grid is invented
# ------------------------
# A dungeon floor carries the original's own collision grid and the builder makes its floor and walls from it. This
# room has no grid at all, so one is laid under it: a flat field of walkable tiles across the model's footprint at the
# height of its floor. It gives the knight something to stand on. **It does not give the room walls** - walk far enough
# and you will walk out of it - and that wants either collision on the model or a hand-placed ring of blockers.
#
# Re-runnable.

import unreal

ROOM_MESHES = "/Game/SK/World/Rooms/ReadyRoom/StaticMeshes"
DEST = "/Game/TopDown/Floors"
ASSET = "DA_Floor_ReadyRoom"
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

    # A flat field of walkable tiles across the room's footprint, at the height of its floor.
    floor_z = low.z
    elevation = int(round(floor_z / ELEVATION_CM))
    cells = []
    first_y, last_y = int(low.x // TILE_CM), int(high.x // TILE_CM)
    first_x, last_x = int(low.y // TILE_CM), int(high.y // TILE_CM)
    for cell_x in range(first_x, last_x + 1):
        for cell_y in range(first_y, last_y + 1):
            cell = unreal.ClockworksFloorCell()
            cell.set_editor_property("tile", unreal.IntPoint(cell_x, cell_y))
            cell.set_editor_property("elevation", elevation)
            cell.set_editor_property("collision", 0)
            cell.set_editor_property("floor", 1)
            cells.append(cell)

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

    unreal.log_warning("ReadyRoom: %s - %d meshes, %d cells laid under it, floor at %.0f cm, footprint %.0f x %.0f cm"
                       % (ASSET, len(groups), len(cells), floor_z, high.x - low.x, high.y - low.y))


main()
