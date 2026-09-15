# Unreal Editor Python script. Run it headless with:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/generate_run_level.py"
#
# Builds Content/TopDown/Lvl_Run: a walled arena with an elevator at one end, a floor director that
# repopulates it every time the party descends, and a monster table drawn from every monster in the
# project.
#
# This is the Clockworks loop in the only form it can honestly take yet: one arena redressed with a
# different population each floor, rather than assembled rooms. What it does give is the loop
# itself — arrive, clear the floor, the way down opens, descend, harder floor — which is the part
# that turns a test level into a run. Room modules are the next step and plug into the director.
#
# A new level, so nothing hand-placed in Lvl_TopDown is touched.

import unreal

LEVEL_PATH = "/Game/TopDown/Lvl_Run"
MONSTERS_PATH = "/Game/TopDown/Blueprints/Monsters"
BLUEPRINTS = "/Game/TopDown/Blueprints"
MATERIALS = "/Game/TopDown/Materials"

ARENA_HALF = 1700.0      # cm from the middle to a wall
WALL_HEIGHT = 400.0
ENTRANCE = unreal.Vector(-1200.0, 0.0, 100.0)
ELEVATOR_AT = unreal.Vector(1300.0, 0.0, 100.0)

# Which monsters make up an ordinary floor, and how deep you have to be to meet them.
# Weight is relative, so the early floors are mostly the things you can learn on.
TUNNEL_TABLE = [
    # blueprint name,        min depth, weight
    ("BP_Wolver",            1, 3.0),
    ("BP_Lichen",            1, 2.5),
    ("BP_Jellycube",         1, 2.0),
    ("BP_Spookat",           2, 2.0),
    ("BP_Gunpuppy",          2, 1.5),
    ("BP_Zombie",            3, 2.0),
    ("BP_Chromalisk",        3, 1.5),
    ("BP_Mechaknight",       4, 1.5),
    ("BP_Devilite",          5, 1.5),
    ("BP_GremlinArtillery",  5, 1.0),
]

BOSS = "BP_Snarbolax"


def load(path):
    return unreal.EditorAssetLibrary.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None


def find_blueprint_class(name):
    """A monster Blueprint by name, wherever it happens to live."""
    for folder in (MONSTERS_PATH, BLUEPRINTS):
        asset = load("{0}/{1}.{1}".format(folder, name))
        if asset:
            return asset.generated_class()
    return None


def spawn(cls, location, rotation=None):
    return unreal.EditorLevelLibrary.spawn_actor_from_class(
        cls, location, rotation or unreal.Rotator(0.0, 0.0, 0.0))


def box(label, location, scale, mesh):
    """A cube stretched into a floor or a wall."""
    actor = spawn(unreal.StaticMeshActor, location)
    if not actor:
        return None
    component = actor.static_mesh_component
    component.set_static_mesh(mesh)
    component.set_relative_scale3d(scale)
    actor.set_actor_label(label)
    return actor


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([MONSTERS_PATH, BLUEPRINTS, MATERIALS], True)

    cube = load("/Engine/BasicShapes/Cube.Cube")
    if not cube:
        unreal.log_warning("Clockworks: no cube mesh; cannot build an arena")
        return

    unreal.EditorLevelLibrary.new_level(LEVEL_PATH)

    # ---- the arena ----
    thickness = 100.0
    box("Floor", unreal.Vector(0.0, 0.0, -50.0),
        unreal.Vector(ARENA_HALF * 2 / 100.0, ARENA_HALF * 2 / 100.0, 1.0), cube)

    for label, x, y, sx, sy in [
        ("WallNorth", ARENA_HALF, 0.0, thickness / 100.0, ARENA_HALF * 2 / 100.0),
        ("WallSouth", -ARENA_HALF, 0.0, thickness / 100.0, ARENA_HALF * 2 / 100.0),
        ("WallEast", 0.0, ARENA_HALF, ARENA_HALF * 2 / 100.0, thickness / 100.0),
        ("WallWest", 0.0, -ARENA_HALF, ARENA_HALF * 2 / 100.0, thickness / 100.0),
    ]:
        box(label, unreal.Vector(x, y, WALL_HEIGHT * 0.5),
            unreal.Vector(sx, sy, WALL_HEIGHT / 100.0), cube)

    # Navigation. Without it the monsters walk straight at you through the walls, and the floor
    # director has nowhere valid to put them. A volume's size comes from its brush, which is a
    # 200 cm cube by default, so the scale is the arena's size over that.
    nav = spawn(unreal.NavMeshBoundsVolume, unreal.Vector(0.0, 0.0, 200.0))
    if nav:
        nav.set_actor_label("NavBounds")
        nav.set_actor_scale3d(unreal.Vector(
            (ARENA_HALF * 2 + 400.0) / 200.0,
            (ARENA_HALF * 2 + 400.0) / 200.0,
            (WALL_HEIGHT + 600.0) / 200.0))

    spawn(unreal.DirectionalLight, unreal.Vector(0.0, 0.0, 1400.0), unreal.Rotator(-52.0, -40.0, 0.0))
    spawn(unreal.SkyLight, unreal.Vector(0.0, 0.0, 1000.0))

    # The knights come in at one end and the way down is at the other, so a floor is a crossing.
    start = spawn(unreal.PlayerStart, ENTRANCE)
    if start:
        start.set_actor_label("Entrance")

    # ---- the elevator ----
    elevator = spawn(unreal.ClockworksElevator, ELEVATOR_AT)
    if elevator:
        elevator.set_actor_label("Elevator")
        pad_material = load(MATERIALS + "/M_ShieldBubble.M_ShieldBubble")
        if pad_material:
            elevator.set_editor_property("pad_material", pad_material)

    # ---- the director ----
    director = spawn(unreal.ClockworksFloorDirector, unreal.Vector(200.0, 0.0, 100.0))
    if director:
        director.set_actor_label("FloorDirector")
        director.set_editor_property("entrance_marker", start)
        director.set_editor_property("elevator", elevator)

        table = []
        missing = []
        for name, min_depth, weight in TUNNEL_TABLE:
            generated = find_blueprint_class(name)
            if not generated:
                missing.append(name)
                continue
            entry = unreal.ClockworksMonsterSpawn()
            entry.set_editor_property("monster", generated)
            entry.set_editor_property("min_depth", min_depth)
            entry.set_editor_property("weight", weight)
            table.append(entry)
        director.set_editor_property("tunnel_monsters", table)

        boss = find_blueprint_class(BOSS)
        if boss:
            director.set_editor_property("boss_monster", boss)
        else:
            missing.append(BOSS)

        if missing:
            unreal.log_warning("Clockworks: missing monster blueprints: " + ", ".join(missing))

    # Build the navigation now rather than leaving it to rebuild on every editor launch, which is
    # what makes monsters stand still for the first few seconds of a session.
    navigation = unreal.NavigationSystemV1.get_navigation_system(unreal.EditorLevelLibrary.get_editor_world())
    if navigation:
        try:
            navigation.build()
        except Exception:
            unreal.log_warning("Clockworks: navigation could not be built headlessly; use Build > Build Paths")

    unreal.EditorLevelLibrary.save_current_level()
    unreal.log_warning("Clockworks: run level built at {0} with {1} monster types".format(
        LEVEL_PATH, len(TUNNEL_TABLE)))


main()
