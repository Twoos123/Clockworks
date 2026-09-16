# Unreal Editor Python script. Run it headless after generate_floor_assets.py:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/make_floor_level.py"
#
# Makes /Game/TopDown/Lvl_Floor: an empty level with one AClockworksFloorBuilder in it, pointed at a real Spiral
# Knights floor, a light, a navigation bounds volume and a PlayerStart on the floor's own entrance. It is the
# calibration map — open it, press Play, and you are standing in the original's Mission Lobby.
#
# It does not touch Lvl_Run or Lvl_TopDown. Re-runnable: the level is rebuilt from scratch each time.
#
# Which floor: FLOOR below, or the SK_FLOOR_ASSET environment variable.

import os

import unreal

LEVEL = "/Game/TopDown/Lvl_Floor"
FLOOR = "/Game/TopDown/Floors/DA_Floor_MissionLobby_351"
GAME_MODE = "/Game/TopDown/Blueprints/BP_TopDownGameMode.BP_TopDownGameMode_C"


def spawn(cls, location=None, rotation=None):
    return unreal.EditorLevelLibrary.spawn_actor_from_class(
        cls, location or unreal.Vector(0, 0, 0), rotation or unreal.Rotator(0, 0, 0))


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(["/Game/TopDown", "/Game/SK/World"], True)

    floor_path = os.environ.get("SK_FLOOR_ASSET") or FLOOR
    floor = unreal.EditorAssetLibrary.load_asset(floor_path)
    if not floor:
        unreal.log_error("FloorLevel: no floor asset at %s - run generate_floor_assets.py first" % floor_path)
        return

    level_editor = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    # Rebuilt each run. new_level refuses to write over a level that already exists, so an existing one is opened and
    # emptied instead, which keeps the same asset (and anything pointing at it) rather than making a second.
    if unreal.EditorAssetLibrary.does_asset_exist(LEVEL):
        if not level_editor.load_level(LEVEL):
            unreal.log_error("FloorLevel: could not open %s" % LEVEL)
            return
        for actor in actors.get_all_level_actors():
            actors.destroy_actor(actor)
    elif not level_editor.new_level(LEVEL):
        unreal.log_error("FloorLevel: could not make %s" % LEVEL)
        return

    # The floor's own bounds, so the light and the navigation volume can be sized to it.
    cells = floor.get_editor_property("cells")
    tile_cm = floor.get_editor_property("tile_cm")
    elevation_cm = floor.get_editor_property("elevation_cm")
    xs = [cell.get_editor_property("tile").y * tile_cm for cell in cells] or [0.0]
    ys = [cell.get_editor_property("tile").x * tile_cm for cell in cells] or [0.0]
    zs = [cell.get_editor_property("elevation") * elevation_cm for cell in cells] or [0.0]
    centre = unreal.Vector((min(xs) + max(xs)) * 0.5, (min(ys) + max(ys)) * 0.5, (min(zs) + max(zs)) * 0.5)
    size = unreal.Vector(max(xs) - min(xs) + tile_cm * 4, max(ys) - min(ys) + tile_cm * 4, 2000.0)

    builder = spawn(unreal.ClockworksFloorBuilder)
    builder.set_editor_property("floor", floor)
    builder.set_actor_label("FloorBuilder")

    # Which class answers to which kind of marker. The floor data carries a behaviour per marker, boiled down from the
    # original's 373 placeable configs, so three rules cover every gate, switch and block in the game.
    rules = []
    for behaviour, cls in (("door", unreal.ClockworksFloorDoor),
                           ("switch", unreal.ClockworksFloorSwitch),
                           ("block", unreal.ClockworksFloorBlock)):
        rule = unreal.ClockworksFloorObjectRule()
        rule.set_editor_property("category", behaviour)
        rule.set_editor_property("object_class", cls)
        rules.append(rule)
    builder.set_editor_property("object_rules", rules)

    # Where the knights arrive, a little above the tile so nobody starts inside it.
    entrance = next((marker.get_editor_property("where") for marker in floor.get_editor_property("markers")
                     if str(marker.get_editor_property("category")) == "player_entrance"), None)
    # Snapped to a tile that can actually be stood on. An archived entrance marker is not always on one: the Clockwork
    # Tunnels' sits in a gap in the grid two tiles from anything solid, and a knight put there falls out of the world.
    grid = {(cell.get_editor_property("tile").x, cell.get_editor_property("tile").y): cell for cell in cells}
    knight_mask = floor.get_editor_property("knight_mask")

    def walkable(key):
        cell = grid.get(key)
        return bool(cell) and (cell.get_editor_property("floor") & 1) \
            and not (cell.get_editor_property("collision") & knight_mask)

    start_at = unreal.Vector(centre.x, centre.y, centre.z + 200.0)
    if entrance:
        start_at = unreal.Vector(entrance.translation.x, entrance.translation.y, entrance.translation.z + 120.0)
        near = (int(entrance.translation.y // tile_cm), int(entrance.translation.x // tile_cm))
        for radius in range(0, 17):
            ring = [(near[0] + x, near[1] + y)
                    for x in range(-radius, radius + 1) for y in range(-radius, radius + 1)
                    if radius == 0 or abs(x) == radius or abs(y) == radius]
            standing = [key for key in ring if walkable(key)]
            if standing:
                key = standing[0]
                height = grid[key].get_editor_property("elevation") * elevation_cm
                start_at = unreal.Vector(key[1] * tile_cm + tile_cm * 0.5,
                                         key[0] * tile_cm + tile_cm * 0.5, height + 120.0)
                unreal.log_warning("FloorLevel: entrance snapped to tile %s, %d tiles away" % (key, radius))
                break
    start = spawn(unreal.PlayerStart, start_at)
    start.set_actor_label("PlayerStart")

    sun = spawn(unreal.DirectionalLight, unreal.Vector(centre.x, centre.y, 2000.0), unreal.Rotator(0.0, -50.0, 30.0))
    sun.set_actor_label("Sun")
    sky = spawn(unreal.SkyLight, unreal.Vector(centre.x, centre.y, 1000.0))
    sky.set_actor_label("SkyLight")

    # The navigation mesh builds at runtime but only inside a bounds volume; the builder stretches this one over
    # whichever floor it is given, so its size here only has to be sane.
    volume = spawn(unreal.NavMeshBoundsVolume, centre)
    volume.set_actor_label("NavBounds")
    if volume.root_component:
        volume.root_component.set_mobility(unreal.ComponentMobility.MOVABLE)
    volume.set_actor_scale3d(unreal.Vector(size.x / 200.0, size.y / 200.0, size.z / 200.0))

    # ...and the navigation mesh itself. The editor makes this the moment you build paths by hand; a level made by a
    # script has to carry its own, or nothing has anywhere to walk and the crowd manager says so at startup.
    nav = spawn(unreal.RecastNavMesh, centre)
    if nav:
        nav.set_actor_label("RecastNavMesh-Default")
        nav.set_editor_property("runtime_generation", unreal.RuntimeGenerationType.DYNAMIC)
    else:
        # Not placeable from a script on this engine version. The navigation system makes its own when the level is
        # opened in the editor with a bounds volume in it, so this costs one open of the map rather than a build.
        unreal.log_warning("FloorLevel: no navigation mesh actor could be spawned; open the level once in the editor")

    world = unreal.EditorLevelLibrary.get_editor_world()
    if world and world.get_world_settings():
        mode = unreal.load_class(None, GAME_MODE)
        if mode:
            world.get_world_settings().set_editor_property("default_game_mode", mode)

    level_editor.save_current_level()
    unreal.log_warning("FloorLevel: %s built on %s - entrance %s, %d cells, bounds %.0f x %.0f cm"
                       % (LEVEL, floor.get_editor_property("level_name"),
                          "yes" if entrance else "centre", len(cells), size.x, size.y))


main()
