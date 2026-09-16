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
    # The chromalisk is a melee licker and the devilite a thrower, as the plain originals are (user's decision
    # 2026-09-15). Their reach is the original's: the lick's box reaches 3.1 tiles, the throw about 7.
    ("Chromalisk",   "Family.Beast",     55,   1,   280,   310,  False, 1.0),
    ("Devilite",     "Family.Fiend",     60,   2,   300,   700,  True,  1.0),
    ("GremlinArtillery", "Family.Gremlin", 65, 3,   210,   750,  True,  1.0),
    # The Snarbolax cannot be hurt until a knight rings the beast bell; see BOSS_TUNING below.
    ("Snarbolax",    "Family.Beast",    420,   6,   360,   260,  False, 1.6),
    ("RoyalJelly",   "Family.Slime",    460,  10,   140,   260,  False, 1.6),
    # The Royal Jelly's minions (research: boss_mechanics.md section B). The polyp is a stationary shooter, the
    # mini a small tackler that heals the jelly by touching it.
    ("RoyalPolyp",   "Family.Slime",    160,   4,     0,   800,  True,  1.1),
    ("RoyalMini",    "Family.Slime",     40,   0,   210,   200,  False, 0.5),
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
    "Devilite":         {"idle": ["standing", "idle1"], "move": ["running", "walk"], "windup": ["throw_start", "swing"],
                          "attack": ["throw_fire", "swing1"], "recovery": ["throw_end", "swing2"],
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
    "RoyalPolyp":       {"idle": ["standing"], "move": ["walking"], "windup": ["attack_start"],
                          "attack": ["attack_fire"], "recovery": ["attack_end"],
                          "hurt": ["reacting"], "death": ["dying"], "aggro": ["reacting"]},
    "RoyalMini":        {"idle": ["standing"], "move": ["Walking_Omni", "walking"], "windup": ["attack_omni_start", "attack_1_start"],
                          "attack": ["attack_omni_fire", "attack_1_fire"], "recovery": ["attack_omni_end", "attack_1_end"],
                          "hurt": ["reacting"], "death": ["dying"], "aggro": ["walking"]},
}

# Each monster's own attack, from the original's configs (research: D:\Dev\SKAssets\_research\bosses\boss_mechanics.md,
# whose damage matches monster_numbers.json; 1 tile = 100 cm). Keys are the ability's Python property names, so anything
# a monster does not name keeps the ability's default. Written 2026-09-15 for the user's "match the plain originals".
ATTACK_TUNING = {
    # The chromalisk licks: a long, narrow box rather than a sphere, 0.56 s into the strike, and it pulls back as it
    # licks. Tier 3's numbers (our boss-floor depths); no knockback at all.
    "Chromalisk": {
        "windup_seconds": 1.0, "hit_delay_seconds": 0.56, "lunge_seconds": 0.467, "recovery_seconds": 0.788,
        "cooldown_seconds": 0.567, "lunge_speed": 0.0, "recoil_distance": 40.0, "recoil_seconds": 0.8,
        "hit_box_size_cm": (300.0, 75.0), "hit_forward_offset": 160.0, "knockback_multiplier": 0.0,
    },
    # The devilite throws office supplies: a 0.625 s windup, the throw itself, then a long follow-through, recoiling
    # a quarter tile. The projectile flies 8.75 tiles a second for 800 ms, so about 7 tiles.
    "Devilite": {
        "windup_seconds": 0.625, "fire_seconds": 0.167, "recovery_seconds": 1.333, "cooldown_seconds": 0.167,
        "projectile_speed": 875.0, "projectile_range": 700.0, "recoil_distance": 25.0, "recoil_seconds": 0.5,
        "muzzle_offset": (25.0, 25.0, 115.0),
    },
}

# What a boss does beyond its attack. Properties on AClockworksEnemyCharacter.
BOSS_TUNING = {
    # The Snarbolax turns everything aside until the beast bell stuns it, and shakes that stun off early once a third
    # of its maximum health has been dealt during it (the wiki's "about a third"; user's decision 2026-09-15).
    "Snarbolax": {"guarded_until_stunned": True, "stun_break_health_fraction": 0.333},
}

# The Royal Jelly is four actors in a chain, as the original is (research: boss_mechanics.md section B): each stage
# spawns the next where it fell. Stage 3 is a transition nothing can hurt, and stage 4 rages in bursts. The user's
# decisions 2026-09-15: stage 3 lasts 10 s with its polyps still working; stage 4 alternates 5 s shut, 5 s open.
#
# key, health at the demo's depths (the same curve the numbers tool writes), targeted speed, polyps, and its own rules.
ROYAL_JELLY_STAGES = [
    # suffix,   speed, polyps, extra properties
    ("Stage1",  105.0, 3, {}),
    # From stage 2 the polyps come back as they are killed, so clearing them is a job you keep doing.
    ("Stage2",  158.0, 4, {"minions_respawn": True}),
    # The transition: no attacks, no polyps, cannot be hurt, hands over on its own clock.
    ("Stage3",  210.0, 0, {"stage_seconds": 10.0, "guarded_until_stunned": True}),
    ("Stage4",  140.0, 6, {"rage_guard_seconds": 5.0, "rage_open_seconds": 5.0, "minions_respawn": True}),
]

# What every fighting stage of the jelly does with its minions: it stands polyps around itself and eats any Royal Mini
# that reaches it (research: boss_mechanics.md section B; the healing fraction is INFERRED from 104.2 healed against a
# 3162 health bar at depth 25).
JELLY_MINION_TUNING = {
    "minion_radius_cm": 550.0,
    "minion_respawn_seconds": 6.0,
    "absorb_radius_cm": 220.0,
    "absorb_heal_fraction": 0.033,
}

# A polyp's whole job: it keeps shooting out Royal Minis. The original caps the minis at 30 and its interval is
# stripped, so the count and the interval here are INFERRED.
POLYP_MINION_TUNING = {
    "minion_count": 3,
    "minion_radius_cm": 200.0,
    "minions_respawn": True,
    "minion_respawn_seconds": 5.0,
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
    "RoyalPolyp":       ("S_JellyAggro", "S_MonsterHurt", "S_JellyDeath"),
    "RoyalMini":        ("S_JellyAggro", "S_MonsterHurt", "S_JellyDeath"),
}

ATTACK_SOUND = {
    "Zombie": "S_ZombieAttack", "Spookat": "S_SpookatAttack", "Chromalisk": "S_ChromaliskAttack",
    "Devilite": "S_DeviliteAttack", "GremlinArtillery": "S_GremlinAttack",
    "Snarbolax": "S_SnarbolaxAttack", "Jellycube": "S_JellyAttack",
    "RoyalPolyp": "S_JellyAttack", "RoyalMini": "S_JellyAttack",
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
    stale = None
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        existing = unreal.EditorAssetLibrary.load_asset(path)
        # A monster that changed kind needs its ability rebuilt: the chromalisk became a melee licker and the devilite
        # a thrower (2026-09-15). A Blueprint's parent is neither an editor property nor changeable from Python, so the
        # class is tested through its default object.
        defaults = unreal.get_default_object(existing.generated_class()) if existing else None
        if defaults is None or isinstance(defaults, parent_class):
            return existing
        # Renamed aside rather than deleted: the package stays loaded for the rest of this run, and creating an asset
        # at a path a deleted package still occupies returns nothing at all.
        unreal.log_warning("Clockworks: rebuilding {0} as a {1}".format(name, parent_class.__name__))
        stale = path + "_Old"
        unreal.EditorAssetLibrary.rename_asset(path, stale)

    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", parent_class)
    made = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, OUT_PATH, None, factory)
    if stale:
        if made:
            unreal.EditorAssetLibrary.delete_asset(stale)
        else:
            # Put it back rather than leave the monster with no ability at all.
            unreal.log_warning("Clockworks: could not rebuild {0}; keeping the old one".format(name))
            unreal.EditorAssetLibrary.rename_asset(stale, path)
            return unreal.EditorAssetLibrary.load_asset(path)
    return made


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
        # Both abilities play raw clips per phase now: the exports are plain sequences, and a thrower needs its throw.
        ability_cdo.set_editor_property("windup_anim", find_anim(key, clips["windup"]))
        ability_cdo.set_editor_property("attack_anim", find_anim(key, clips["attack"]))
        ability_cdo.set_editor_property("recovery_anim", find_anim(key, clips["recovery"]))

        # Its own numbers from the original's configs, where they have been read.
        for name, value in (ATTACK_TUNING.get(key) or {}).items():
            if isinstance(value, tuple):
                value = unreal.Vector2D(*value) if len(value) == 2 else unreal.Vector(*value)
            ability_cdo.set_editor_property(name, value)
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

        for name, value in (BOSS_TUNING.get(key) or {}).items():
            cdo.set_editor_property(name, value)

        # A polyp is a mini factory; the mini's Blueprint is built in the same run, so look it up by name.
        if key == "RoyalPolyp":
            mini = load(OUT_PATH + "/BP_RoyalMini")
            if mini:
                cdo.set_editor_property("minion_class", mini.generated_class())
                for prop, value in POLYP_MINION_TUNING.items():
                    cdo.set_editor_property(prop, value)

        cdo.set_editor_property("default_abilities", [ability_bp.generated_class()])

        spark = load(BLUEPRINTS + "/BP_HitSpark.BP_HitSpark")
        if spark:
            cdo.set_editor_property("hit_spark_class", spark.generated_class())

        unreal.EditorAssetLibrary.save_loaded_asset(monster_bp, False)
        made += 1

    made += build_royal_jelly_stages(failed)

    unreal.log_warning("Clockworks: built {0} monsters".format(made))
    if failed:
        unreal.log_warning("Clockworks: failed: " + ", ".join(failed))


def build_royal_jelly_stages(failed):
    """The Royal Jelly's four stages, each a copy of BP_RoyalJelly with its own rules, chained by NextStageClass.

    Built backwards so every stage can name the one that follows it; the floor director spawns Stage 1, which hands
    over as each health bar empties (stage 3 on its own clock instead). The base BP_RoyalJelly stays as it is, for the
    bestiary and for anything that just wants one jelly.
    """
    base = load(OUT_PATH + "/BP_RoyalJelly")
    if not base:
        failed.append("RoyalJelly stages (no BP_RoyalJelly)")
        return 0
    base_cdo = unreal.get_default_object(base.generated_class())

    # Everything a stage copies from the jelly itself: it is the same creature in a different mood.
    copied = ["use_direct_animation", "idle_anim", "move_anim", "death_anim", "hurt_anim", "aggro_anim",
              "move_anim_reference_speed", "initial_health", "initial_defense_power", "attack_range",
              "attack_needs_line_of_sight", "health_bar_height", "aggro_sound", "hurt_sound", "death_sound",
              "hit_spark_class", "impulse_level", "default_abilities"]

    made, next_class = 0, None
    for suffix, speed, polyps, extra in reversed(ROYAL_JELLY_STAGES):
        name = "BP_RoyalJelly" + suffix
        blueprint = make_blueprint(name, unreal.ClockworksEnemyCharacter)
        if not blueprint:
            failed.append(name)
            continue
        cdo = unreal.get_default_object(blueprint.generated_class())

        for prop in copied:
            cdo.set_editor_property(prop, base_cdo.get_editor_property(prop))
        cdo.set_family_tag_by_name("Family.Slime")

        # The mesh, its rotation, offset and scale, measured once for the jelly and true for every stage.
        base_mesh = base_cdo.get_editor_property("mesh")
        mesh_component = cdo.get_editor_property("mesh")
        if base_mesh and mesh_component:
            mesh_component.set_editor_property("skeletal_mesh_asset", base_mesh.get_editor_property("skeletal_mesh_asset"))
            mesh_component.set_relative_rotation(base_mesh.get_editor_property("relative_rotation"), False, False)
            mesh_component.set_relative_location(base_mesh.get_editor_property("relative_location"), False, False)
            mesh_component.set_relative_scale3d(base_mesh.get_editor_property("relative_scale3d"))
        base_capsule = base_cdo.get_editor_property("capsule_component")
        capsule = cdo.get_editor_property("capsule_component")
        if base_capsule and capsule:
            capsule.set_capsule_size(base_capsule.get_editor_property("capsule_radius"),
                                     base_capsule.get_editor_property("capsule_half_height"), False)

        cdo.set_editor_property("initial_move_speed", float(speed))

        # Polyps standing around it, and the Royal Minis it eats to heal.
        polyp = load(OUT_PATH + "/BP_RoyalPolyp")
        mini = load(OUT_PATH + "/BP_RoyalMini")
        if polyps > 0 and polyp:
            cdo.set_editor_property("minion_class", polyp.generated_class())
            cdo.set_editor_property("minion_count", int(polyps))
            for prop, value in JELLY_MINION_TUNING.items():
                cdo.set_editor_property(prop, value)
            if mini:
                cdo.set_editor_property("absorb_minion_class", mini.generated_class())

        # The transition has nothing to attack with; the others keep the jelly's roundhouse.
        if polyps == 0:
            cdo.set_editor_property("default_abilities", [])
        if next_class:
            cdo.set_editor_property("next_stage_class", next_class)
        for prop, value in extra.items():
            cdo.set_editor_property(prop, value)

        unreal.EditorAssetLibrary.save_loaded_asset(blueprint, False)
        next_class = blueprint.generated_class()
        made += 1
        unreal.log_warning("Clockworks: {0} (speed {1}, polyps {2}, {3})".format(
            name, speed, polyps, ", ".join("{0}={1}".format(k, v) for k, v in extra.items()) or "fights normally"))

    return made


main()
