# Unreal Editor Python script. Run it headless:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/make_ready_room.py"
#
# Builds /Game/TopDown/Floors/DA_Floor_ReadyRoom and /Game/TopDown/Lvl_ReadyRoom from the recovered scene in
# D:\Dev\SKAssets\_research\ready_room\ready_room.json.
#
# There is no room
# ----------------
# The ready room has no wall, floor, ceiling, backdrop or skybox anywhere in the game's data. It is a lit diorama in a
# black box: the console assembly and its furniture, five one-unit quads, and a deliberately *inverted* fog - linear,
# start 4.8, end 3.0 - that swallows everything near the camera. The dark surround is that fog, not geometry. The
# character creator's scene beside it does have a backdrop and a skybox, which is what makes the absence here a finding
# rather than a gap in the search.
#
# So there is nothing to stand on and nothing to walk into, and the definition carries no cells at all.
#
# The camera is the original's
# ----------------------------
# Recovered from the scene's own Camera/Default placeable and the client's camera maths: position, target, rotation,
# arm length and field of view. Clyde's `fov` is **vertical**; Unreal's FieldOfView is horizontal, so the horizontal
# figure for the aspect is what goes in.
#
# One export trap it also settles: the exporter ignores a model set's chosen variant and writes every one, so
# modelset_monitors comes out with eighteen monitor nodes where the scene asks for three. `setKey` picks the three.
#
# Re-runnable.

import json
import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import floor_model_names

DATA = os.path.join(r"D:\Dev\SKAssets\_research", "ready_room", "ready_room.json")
DEST = "/Game/TopDown/Floors"
ASSET = "DA_Floor_ReadyRoom"
LEVEL = "/Game/TopDown/Lvl_ReadyRoom"
GAME_MODE = "/Game/TopDown/Blueprints/BP_TopDownGameMode.BP_TopDownGameMode_C"

# The kinds of placement that are geometry. A light and a particle system are placed differently.
GEOMETRY = ("model", "plane", "decal")


def transform(where):
    """The recovered Unreal transform: cm, a rotator in (pitch, yaw, roll), and a uniform scale."""
    location, rotator = where["location"], where["rotator"]
    scale = float(where.get("scale") or 1.0)
    return unreal.Transform(
        location=unreal.Vector(location[0], location[1], location[2]),
        rotation=unreal.Rotator(roll=rotator[2], pitch=rotator[0], yaw=rotator[1]),
        scale=unreal.Vector(scale, scale, scale))


def meshes_for(placement):
    """The imported meshes one placement wants, filtered to its model-set variant where it names one."""
    glb = (placement.get("glb") or "").replace("\\", "/")
    if not glb:
        return []

    category, name = floor_model_names.model_asset(glb)
    folder = "/Game/SK/%s/%s/StaticMeshes" % (category, name)
    if not unreal.EditorAssetLibrary.does_directory_exist(folder):
        return []

    key = placement.get("setKey")
    found = []
    for path in unreal.EditorAssetLibrary.list_assets(folder, recursive=False, include_folder=False):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if not isinstance(asset, unreal.StaticMesh):
            continue
        if key and key not in asset.get_name():
            continue
        found.append(asset)
    return found


def main():
    if not os.path.isfile(DATA):
        unreal.log_error("ReadyRoom: no recovered scene at %s" % DATA)
        return
    with open(DATA, encoding="utf-8") as handle:
        data = json.load(handle)

    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(["/Game/SK/World", "/Game/TopDown"], True)

    groups, placed, missing = [], 0, []
    for placement in data.get("placements") or []:
        if placement.get("kind") not in GEOMETRY:
            continue
        found = meshes_for(placement)
        if not found:
            missing.append(placement.get("rsrc") or placement.get("glb") or "?")
            continue

        where = transform(placement["unreal"])
        for mesh in found:
            group = unreal.ClockworksFloorMeshGroup()
            group.set_editor_property("mesh", mesh)
            group.set_editor_property("instances", [where])
            group.set_editor_property("source", "%s|%s" % (placement.get("rsrc") or "", placement.get("role") or ""))
            groups.append(group)
        placed += 1

    path = DEST + "/" + ASSET
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        asset = unreal.EditorAssetLibrary.load_asset(path)
    else:
        asset = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            ASSET, DEST, unreal.ClockworksFloorDefinition, unreal.DataAssetFactory())
    if not asset:
        unreal.log_error("ReadyRoom: could not make %s" % path)
        return

    environment = data.get("environment") or {}
    ambient = environment.get("ambientRGBA") or [0.05, 0.14, 0.2, 1.0]
    background = environment.get("backgroundColorRGBA") or [0.0, 0.004, 0.004, 1.0]

    asset.set_editor_property("level_name", "Ready Room")
    asset.set_editor_property("scene_id", "readyroom/scene")
    asset.set_editor_property("mesh_groups", groups)
    # Nothing stands on this and nothing walks through it.
    asset.set_editor_property("cells", [])
    asset.set_editor_property("ambient_color", unreal.LinearColor(ambient[0], ambient[1], ambient[2], 1.0))
    asset.set_editor_property("background_color", unreal.LinearColor(background[0], background[1], background[2], 1.0))
    unreal.EditorAssetLibrary.save_loaded_asset(asset, False)

    unreal.log_warning("ReadyRoom: %s - %d placements, %d mesh groups%s"
                       % (ASSET, placed, len(groups),
                          (", %d not imported (%s)" % (len(missing), ", ".join(sorted(set(missing))[:3]))) if missing else ""))

    build_level(asset, data)


def build_level(asset, data):
    """The ready room's level: the diorama, and the original's own camera pointed at it."""
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

    builder = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.ClockworksFloorBuilder, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    builder.set_editor_property("floor", asset)
    builder.set_editor_property("build_lights", False)
    builder.set_actor_label("ReadyRoomSet")

    camera = (data.get("camera") or {}).get("unreal") or {}
    eye = camera.get("location") or [175.27, -419.11, 194.07]
    rotator = camera.get("rotator") or [-11.0, 120.0, 0.0]
    look = camera.get("lookAt") or [-66.7, 0.0, 100.0]
    # Clyde's field of view is vertical; Unreal's is horizontal.
    fov = float(camera.get("fovHorizontalDegrees_16x9") or 50.942)

    room = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.ClockworksReadyRoom,
        unreal.Vector(eye[0], eye[1], eye[2]),
        unreal.Rotator(roll=rotator[2], pitch=rotator[0], yaw=rotator[1]))
    room.set_actor_label("ReadyRoom")
    room.set_editor_property("set_centre", unreal.Vector(look[0], look[1], look[2]))
    room.set_editor_property("camera_fov", fov)

    # The knight the game mode spawns is never shown here, but it wants somewhere to go.
    knight = (data.get("knight") or {}).get("unreal") or {}
    at = knight.get("location") or [0.0, 0.0, 0.0]
    start = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.PlayerStart, unreal.Vector(at[0], at[1], at[2] + 100.0), unreal.Rotator(0, 0, 0))
    start.set_actor_label("PlayerStart")

    # The scene's own two directional lights.
    for index, light in enumerate((data.get("environment") or {}).get("directionalLights") or []):
        direction = light.get("direction") or [0.0, 0.0, -1.0]
        diffuse = light.get("diffuse") or [1.0, 1.0, 1.0, 1.0]
        # Clyde points a light along a direction; Unreal aims one by its rotation, and the axes are swapped as
        # everywhere else: Unreal (x, y, z) = (clyde y, clyde x, clyde z).
        facing = unreal.MathLibrary.conv_vector_to_rotator(
            unreal.Vector(-direction[1], -direction[0], -direction[2]))
        sun = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.DirectionalLight, unreal.Vector(0.0, 0.0, 600.0), facing)
        sun.set_actor_label("SceneLight_%d" % index)
        component = sun.get_component_by_class(unreal.DirectionalLightComponent)
        if component:
            component.set_mobility(unreal.ComponentMobility.MOVABLE)
            component.set_light_color(unreal.LinearColor(diffuse[0], diffuse[1], diffuse[2], 1.0))
            component.set_intensity(3.0)

    sky = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0.0, 0.0, 300.0))
    sky.set_actor_label("SkyLight")

    world = unreal.EditorLevelLibrary.get_editor_world()
    if world and world.get_world_settings():
        mode = unreal.load_class(None, GAME_MODE)
        if mode:
            world.get_world_settings().set_editor_property("default_game_mode", mode)

    level_editor.save_current_level()
    unreal.log_warning("ReadyRoom: %s built - camera at %s, rotator %s, %.2f deg horizontal"
                       % (LEVEL, eye, rotator, fov))


main()
