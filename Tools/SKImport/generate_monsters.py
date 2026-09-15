# Unreal Editor Python script. Run it headless with:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/generate_monsters.py"
#
# Builds one Blueprint per monster from the Spiral Knights assets already imported under
# Content/SK/Monsters: mesh, idle, movement, attack, flinch and death clips, the family it belongs
# to, its sounds, and a melee or ranged attack ability tuned for it.
#
# The monsters use direct animation mode rather than an Animation Blueprint. Each one needs only an
# idle loop, a movement loop and some one-off clips, none of which needs a blend tree, and an
# Animation Blueprint cannot be authored except by hand in the editor. Fourteen monsters would
# otherwise be fourteen manual jobs.
#
# Everything it writes lives under /Game/TopDown/Blueprints/Monsters/.

import unreal

MONSTER_PATH = "/Game/SK/Monsters"
OUT_PATH = "/Game/TopDown/Blueprints/Monsters"
AUDIO = "/Game/SK/Audio"
BLUEPRINTS = "/Game/TopDown/Blueprints"

# name, family, health, defense, move speed, attack range, ranged?
# Health and defense follow the original's shape rather than its numbers: a wolver is fast and
# fragile, a construct is slow and armoured, a jelly is a wall with no reach.
MONSTERS = [
    # key,           family,             hp,  def, speed, range, ranged, scale
    ("Jellycube",    "Family.Slime",     70,   2,   170,   210,  False, 1.0),
    ("Lichen",       "Family.Slime",     40,   0,   220,   190,  False, 1.0),
    ("Zombie",       "Family.Undead",    85,   4,   150,   210,  False, 1.0),
    ("Spookat",      "Family.Undead",    45,   0,   330,   200,  False, 1.0),
    ("Chromalisk",   "Family.Beast",     55,   1,   280,   600,  True,  1.0),
    ("Devilite",     "Family.Fiend",     60,   2,   300,   200,  False, 1.0),
    ("GremlinArtillery", "Family.Gremlin", 65, 3,   210,   750,  True,  1.0),
    ("Snarbolax",    "Family.Beast",    420,   6,   360,   260,  False, 1.6),
    ("RoyalJelly",   "Family.Slime",    460,  10,   140,   260,  False, 1.6),
]

# Which imported clip plays for which purpose. The exports do not agree on names, so each monster
# lists its own; the first entry that exists wins, and a missing one simply goes unset.
CLIPS = {
    "Jellycube":        {"idle": ["standing"], "move": ["Walking_Omni"], "windup": ["attack_1_start"],
                          "attack": ["attack_1_fire"], "recovery": ["attack_1_end"],
                          "hurt": ["reacting"], "death": ["reacting"], "aggro": ["Attack_Omni"]},
    "Lichen":           {"idle": ["standing"], "move": ["walking", "jellycube_walk"], "windup": ["attack_1_start"],
                          "attack": ["attack_1_fire"], "recovery": ["attack_1_end"],
                          "hurt": ["reacting"], "death": ["reacting"], "aggro": ["reacting"]},
    "Zombie":           {"idle": ["standing"], "move": ["moving"], "windup": ["attack_start"],
                          "attack": ["attack_fire"], "recovery": ["attack_end"],
                          "hurt": ["reacting"], "death": ["dying"], "aggro": ["spawn"]},
    "Spookat":          {"idle": ["standing_idle", "standing"], "move": ["walking"], "windup": ["attack_1_start"],
                          "attack": ["attack_1_fire"], "recovery": ["attack_1_end"],
                          "hurt": ["reacting"], "death": ["dying"], "aggro": ["standing_idle2"]},
    "Chromalisk":       {"idle": ["standing"], "move": ["moving"], "windup": ["attack_start"],
                          "attack": ["attack_fire"], "recovery": ["attack_end"],
                          "hurt": ["react"], "death": ["dying"], "aggro": ["react"]},
    "Devilite":         {"idle": ["standing", "idle1"], "move": ["running", "walk"], "windup": ["swing"],
                          "attack": ["swing1"], "recovery": ["swing2"],
                          "hurt": ["reacting"], "death": ["dying"], "aggro": ["talk"]},
    "GremlinArtillery": {"idle": ["standing"], "move": ["walking"], "windup": ["attack_1_fire"],
                          "attack": ["attack_1_fire1"], "recovery": ["attack_1_fire2"],
                          "hurt": ["reacting"], "death": ["dying"], "aggro": ["reacting1"]},
    "Snarbolax":        {"idle": ["standing"], "move": ["moving"], "windup": ["activate"],
                          "attack": ["attack"], "recovery": ["reacting"],
                          "hurt": ["reacting"], "death": ["dying"], "aggro": ["bark"]},
    "RoyalJelly":       {"idle": ["standing"], "move": ["running", "walking"], "windup": ["attack_1_start"],
                          "attack": ["attack_1_fire"], "recovery": ["attack_1_end"],
                          "hurt": ["reacting"], "death": ["dying"], "aggro": ["Core1"]},
}

# aggro, hurt, death. Falls back to the generic monster set where a monster has none of its own.
SOUNDS = {
    "Jellycube":        ("S_JellyAggro", "S_MonsterHurt", "S_JellyDeath"),
    "Lichen":           ("S_MonsterSpawn", "S_MonsterHurt", "S_MonsterDeath"),
    "Zombie":           ("S_ZombieAggro", "S_ZombieHurt", "S_MonsterDeath"),
    "Spookat":          ("S_SpookatAggro", "S_SpookatHurt", "S_SpookatDeath"),
    "Chromalisk":       ("S_ChromaliskAggro", "S_ChromaliskHurt", "S_ChromaliskDeath"),
    "Devilite":         ("S_DeviliteAggro", "S_DeviliteHurt", "S_DeviliteDeath"),
    "GremlinArtillery": ("S_GremlinAggro", "S_GremlinHurt", "S_GremlinDeath"),
    "Snarbolax":        ("S_SnarbolaxAggro", "S_SnarbolaxHurt", "S_SnarbolaxDeath"),
    "RoyalJelly":       ("S_RoyalJellyAggro", "S_MonsterHurt", "S_RoyalJellyDeath"),
}

ATTACK_SOUND = {
    "Zombie": "S_ZombieAttack", "Spookat": "S_SpookatAttack", "Chromalisk": "S_ChromaliskAttack",
    "Devilite": "S_DeviliteAttack", "GremlinArtillery": "S_GremlinAttack",
    "Snarbolax": "S_SnarbolaxAttack", "Jellycube": "S_JellyAttack",
}


def load(path):
    return unreal.EditorAssetLibrary.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None


def find_anim(monster, names):
    """The first of `names` that exists for this monster. Exports disagree on naming, so try a list."""
    folder = "{0}/{1}/SkeletalMeshes".format(MONSTER_PATH, monster)
    for name in names:
        asset = load("{0}/{1}{2}.{1}{2}".format(folder, monster, name))
        if asset:
            return asset
    return None


def find_skeletal_mesh(monster):
    folder = "{0}/{1}/SkeletalMeshes".format(MONSTER_PATH, monster)
    if not unreal.EditorAssetLibrary.does_directory_exist(folder):
        return None
    for path in unreal.EditorAssetLibrary.list_assets(folder, recursive=False, include_folder=False):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if isinstance(asset, unreal.SkeletalMesh):
            return asset
    return None


def measure_rotated_mesh(mesh, rotation, scale):
    """(lowest Z, highest Z, horizontal radius) of a mesh once rotated and scaled.

    The import leaves every Spiral Knights skeleton lying on its side, so a mesh's own bounds say
    nothing useful about how tall it will be in the world. Rotating the eight corners of its box and
    measuring the result does.
    """
    bounds = mesh.get_bounds()
    origin = bounds.origin
    extent = bounds.box_extent

    low, high, radius = None, None, 0.0
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            for sz in (-1.0, 1.0):
                corner = unreal.Vector(
                    origin.x + extent.x * sx,
                    origin.y + extent.y * sy,
                    origin.z + extent.z * sz)
                rotated = unreal.MathLibrary.greater_greater_vector_rotator(corner, rotation)
                z = rotated.z * scale
                low = z if low is None else min(low, z)
                high = z if high is None else max(high, z)
                radius = max(radius, max(abs(rotated.x), abs(rotated.y)) * scale)

    return low or 0.0, high or 0.0, radius


def sound(name):
    return load("{0}/{1}.{1}".format(AUDIO, name)) if name else None


def make_blueprint(name, parent_class):
    path = OUT_PATH + "/" + name
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        return unreal.EditorAssetLibrary.load_asset(path)
    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", parent_class)
    return unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, OUT_PATH, None, factory)


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([MONSTER_PATH, AUDIO, BLUEPRINTS], True)

    made, failed = 0, []

    for key, family, health, defense, speed, attack_range, ranged, scale in MONSTERS:
        clips = CLIPS[key]

        mesh = find_skeletal_mesh(key)
        if not mesh:
            failed.append(key + " (no skeletal mesh)")
            continue

        # ---- the attack ability ----
        ability_parent = unreal.ClockworksEnemyRangedAbility if ranged else unreal.ClockworksEnemyMeleeAbility
        ability_bp = make_blueprint("BP_GA_{0}Attack".format(key), ability_parent)
        if not ability_bp:
            failed.append(key + " (no ability blueprint)")
            continue

        ability_cdo = unreal.get_default_object(ability_bp.generated_class())
        if not ranged:
            ability_cdo.set_editor_property("windup_anim", find_anim(key, clips["windup"]))
            ability_cdo.set_editor_property("attack_anim", find_anim(key, clips["attack"]))
            ability_cdo.set_editor_property("recovery_anim", find_anim(key, clips["recovery"]))
        # The two ability classes name their sound differently: a melee attack has a telegraph, a
        # ranged one has a shot.
        attack_sound = sound(ATTACK_SOUND.get(key))
        if attack_sound:
            ability_cdo.set_editor_property("fire_sound" if ranged else "attack_sound", attack_sound)

        if ranged:
            # A ranged ability with no projectile fires nothing at all, so this is not optional.
            bolt = load(BLUEPRINTS + "/BP_GunpuppyBolt.BP_GunpuppyBolt")
            if bolt:
                ability_cdo.set_editor_property("projectile_class", bolt.generated_class())

        unreal.EditorAssetLibrary.save_loaded_asset(ability_bp, False)

        # ---- the monster ----
        monster_bp = make_blueprint("BP_{0}".format(key), unreal.ClockworksEnemyCharacter)
        if not monster_bp:
            failed.append(key + " (no monster blueprint)")
            continue

        cdo = unreal.get_default_object(monster_bp.generated_class())

        # The Spiral Knights exports are Z-up where glTF is Y-up and the importer does not convert,
        # so every monster needs the same rotation the knight already has.
        mesh_rotation = unreal.Rotator(-90.0, 0.0, -90.0)

        # Where the mesh's feet and head end up once that rotation is applied, and how wide it is.
        # Measured rather than assumed: the knight's own offset of -90 is right for a knight and
        # wrong for a jelly, and using it everywhere is how a monster ends up sunk into the floor.
        low_z, high_z, radius = measure_rotated_mesh(mesh, mesh_rotation, scale)
        half_height = max((high_z - low_z) * 0.5, 40.0)

        capsule = cdo.get_editor_property("capsule_component")
        if capsule:
            capsule.set_capsule_size(max(radius, 20.0), half_height, False)

        mesh_component = cdo.get_editor_property("mesh")
        if mesh_component:
            mesh_component.set_editor_property("skeletal_mesh_asset", mesh)
            mesh_component.set_relative_rotation(mesh_rotation, False, False)
            # Drop the mesh so its lowest point rests on the bottom of the capsule.
            mesh_component.set_relative_location(unreal.Vector(0.0, 0.0, -half_height - low_z), False, False)
            if scale != 1.0:
                mesh_component.set_relative_scale3d(unreal.Vector(scale, scale, scale))

        # The floating health bar sits just above the head, whatever size the head is.
        cdo.set_editor_property("health_bar_height", half_height + 40.0)

        cdo.set_editor_property("use_direct_animation", True)
        cdo.set_editor_property("idle_anim", find_anim(key, clips["idle"]))
        cdo.set_editor_property("move_anim", find_anim(key, clips["move"]))
        cdo.set_editor_property("death_anim", find_anim(key, clips["death"]))
        cdo.set_editor_property("hurt_anim", find_anim(key, clips["hurt"]))
        cdo.set_editor_property("aggro_anim", find_anim(key, clips["aggro"]))
        cdo.set_editor_property("move_anim_reference_speed", float(speed))

        cdo.set_family_tag_by_name(family)
        cdo.set_editor_property("initial_health", float(health))
        cdo.set_editor_property("initial_defense_power", float(defense))
        cdo.set_editor_property("initial_move_speed", float(speed))
        cdo.set_editor_property("attack_range", float(attack_range))
        cdo.set_editor_property("attack_needs_line_of_sight", bool(ranged))

        aggro_sound, hurt_sound, death_sound = SOUNDS[key]
        cdo.set_editor_property("aggro_sound", sound(aggro_sound))
        cdo.set_editor_property("hurt_sound", sound(hurt_sound))
        cdo.set_editor_property("death_sound", sound(death_sound))

        cdo.set_editor_property("default_abilities", [ability_bp.generated_class()])

        spark = load(BLUEPRINTS + "/BP_HitSpark.BP_HitSpark")
        if spark:
            cdo.set_editor_property("hit_spark_class", spark.generated_class())

        unreal.EditorAssetLibrary.save_loaded_asset(monster_bp, False)
        made += 1

    unreal.log_warning("Clockworks: built {0} monsters".format(made))
    if failed:
        unreal.log_warning("Clockworks: failed: " + ", ".join(failed))


main()
