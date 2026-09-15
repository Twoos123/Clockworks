# Unreal Editor Python script. Run it headless, after the gear models, icons and armours are imported and the
# game module with UClockworksGearDefinition is built:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/generate_gear_assets.py"
#
# Creates one UClockworksGearDefinition (DA_Gear_*) per helmet, armour, shield and trinket in gear.json, which
# mine_gear.py writes from the game's item.xml. Everything lands under /Game/TopDown/Gear/Knight/<slot>/.
# Then gives BP_ClockworksCharacter its starting gear and the original's 200 base health.
#
# Numbers (decisions 2026-09-15, Docs/KnightChecklist.md): defense and shield health are the config curves at
# gear.json's depth samples; level 10 adds the heat table's defense and health steps; a bonus the data gives only
# a label for takes mine_gear.py's inferred value and is marked so.
#
# Looks are best guesses where the data does not say, and every guess is written to gear_assets_report.json:
# which member of a model set a piece shows, which of a model's skins a variant wears, and the placement a
# compound shield (Targe, Tortafist) puts its base model at. Colorized pieces (the original tints them at run
# time) show their untinted skin.
#
# Re-runnable: existing assets are updated in place.

import json
import os
import re
import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
GEAR_JSON = os.path.join(HERE, "gear.json")
REPORT = os.path.join(HERE, "gear_assets_report.json")
WRAPPERS = r"D:\Dev\SKAssets\_gear_export\wrappers.json"
ICON_MANIFEST = r"D:\Dev\SKAssets\_gear_icons\gear_icons.json"

OUT = "/Game/TopDown/Gear/Knight"
FOLDER_BY_SLOT = {"Helm": "Helmets", "Armor": "Armor", "Shield": "Shields", "Trinket": "Trinkets"}
MODELS_BY_SLOT = {"Helm": "/Game/SK/Gear/Helmets", "Shield": "/Game/SK/Gear/Shields"}
ARMOR_MODELS = "/Game/SK/Gear/Armor"
ICONS = "/Game/SK/GearIcons"
CHARACTER_BP = "/Game/TopDown/Blueprints/BP_ClockworksCharacter"

SLOT_ENUM = {
    "Helm": unreal.ClockworksGearSlot.HELMET,
    "Armor": unreal.ClockworksGearSlot.ARMOR,
    "Shield": unreal.ClockworksGearSlot.SHIELD,
    "Trinket": unreal.ClockworksGearSlot.TRINKET,
}
WEAPON_CLASS = {
    "SWORD": unreal.ClockworksWeaponClass.SWORD,
    "HANDGUN": unreal.ClockworksWeaponClass.HANDGUN,
    "BOMB": unreal.ClockworksWeaponClass.BOMB,
}
# Which field of a modifier holds its number.
VALUE_FIELD = {
    "AttackSpeedChange": "speed", "SpeedChange": "speed", "ChargeTimeReduction": "reduction",
    "HealthBonus": "health", "RelativeDamageBonus": "damage", "TaggedDamageBonus": "damage",
}
DEFENSE_PROPERTY = {"Normal": "normal_defense", "Piercing": "piercing_defense",
                    "Elemental": "elemental_defense", "Shadow": "shadow_defense"}

# The original ignores a labelled bonus's number: its strength is a fixed step per level (ItemCodes$ItemValueKey;
# D:/Dev/SKAssets/_research/shield_bonus/findings.md). A CUSTOM label keeps the file's number. Health bonuses keep
# their explicit numbers. The level order past HIGH is INFERRED.
BONUS_STEP = {"RelativeDamageBonus": 0.08, "TaggedDamageBonus": 0.08, "ChargeTimeReduction": 0.08,
              "AttackSpeedChange": 0.04, "SpeedChange": 0.04}
BONUS_LEVEL = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "VERY_HIGH": 4, "ULTRA": 5, "MAXIMUM": 6}

RESEARCH = r"D:\Dev\SKAssets\_research"
RIGID_PIECES = os.path.join(RESEARCH, "rigid_armor", "rigid_pieces.json")
TINTED_SKINS = r"D:\Dev\SKAssets\_gear_tinted\gear_tinted.json"
ARMOR_PIECES = "/Game/SK/Gear/ArmorPieces"
SKIN_INSTANCES = "/Game/SK/GearSkins/Materials"
FACE_HIDING = os.path.join(RESEARCH, "face_hiding", "face_hiding.json")
BASH_MAP = os.path.join(RESEARCH, "shield_bonus", "shield_bash_map.json")
MONSTER_NUMBERS = os.path.join(RESEARCH, "monsters", "monster_numbers.json")
BASH_KIND = {
    "normal": unreal.ClockworksShieldBashKind.STANDARD,
    "tortadrone": unreal.ClockworksShieldBashKind.TORTODRONE,
    "targe": unreal.ClockworksShieldBashKind.TARGE,
}
BASH_ABILITY = "/Game/TopDown/Blueprints/BP_GA_ShieldBash"
# The original's bash (findings.md), written onto the Blueprint so a value saved there earlier cannot hide them.
BASH_DEFAULTS = {"windup_seconds": 0.5, "lunge_seconds": 0.8, "tortodrone_lunge_seconds": 0.6, "lunge_distance": 600.0,
                 "recovery_seconds": 0.3, "base_damage": 15.6, "knockback_multiplier": 2.4, "stun_seconds": 2.2,
                 "hit_radius": 80.0, "hit_forward_offset": 30.0}


def resample(by_depth, samples):
    """A curve given at some original depths, read at others: straight lines between points, flat past either end."""
    points = sorted((float(d), float(v)) for d, v in by_depth.items())
    out = []
    for depth in samples:
        if depth <= points[0][0]:
            out.append(points[0][1])
        elif depth >= points[-1][0]:
            out.append(points[-1][1])
        else:
            for (d0, v0), (d1, v1) in zip(points, points[1:]):
                if d0 <= depth <= d1:
                    out.append(v0 + (v1 - v0) * (depth - d0) / (d1 - d0))
                    break
    return out


def load_json(path):
    return json.load(open(path, encoding="utf-8")) if os.path.isfile(path) else {}

# The knight keeps the look it has today: the cap helmet, the coat armour and the buckler it was imported with,
# as the lowest-rated items that use those models. Change them in BP_ClockworksCharacter (Class Defaults,
# Combat > Gear > Default Gear) or on the gear screen.
STARTER_MODELS = {"Helm": "item/gear/helm/cap/model.dat", "Armor": "item/gear/armor/coat/model.dat",
                  "Shield": "item/gear/shield/buckler/model.dat"}
STARTER_SHIELD = "Gear/Shield/Proto Shield"
KNIGHT_BASE_HEALTH = 200.0

HASH_SUFFIX = re.compile(r"_[0-9a-f]{32}$")
SET_PIECE = re.compile(r"MeshSets_(.+?)__Mesh_\d+_$")
EFFECT_WORD = re.compile(r"^(ribbon\w*|glow|fx|billboard|energy|trail|pplane\d*|plane)$")


def words(text):
    return {w for w in re.split(r"[^a-z0-9]+", (text or "").lower()) if w and w != "model"}


def camel(text):
    return "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", text) if w)


def asset_name_from_path(path, prefix):
    """Mirror of _asset_name in stage_and_import.py, so names match what was imported."""
    parts = path.replace("\\", "/").split("/")
    stem = os.path.splitext(parts[-1])[0]
    if stem.startswith("model_"):
        stem = stem[len("model_"):]
    elif stem == "model":
        stem = ""
    pieces = [parts[-3], parts[-2], stem] if len(parts) >= 3 else parts
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in "_".join(x for x in pieces if x))
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return prefix + cleaned.strip("_").title().replace("_", "")


def gear_model_asset(model_path):
    return asset_name_from_path(model_path.replace("/owilite/", "/owlite/"), "SM_Gear")


def armor_asset(model_path):
    rel = model_path.replace("item/gear/armor/", "")[:-4]
    return "SK_Armor" + "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", rel) if w and w != "model")


_FOLDERS = {}


def folder_assets(folder):
    """(static meshes, materials) anywhere under an imported model folder, loaded once."""
    if folder not in _FOLDERS:
        meshes, materials = [], []
        if unreal.EditorAssetLibrary.does_directory_exist(folder):
            for path in unreal.EditorAssetLibrary.list_assets(folder, recursive=True, include_folder=False):
                loaded = unreal.EditorAssetLibrary.load_asset(path)
                if isinstance(loaded, unreal.StaticMesh):
                    meshes.append(loaded)
                elif isinstance(loaded, unreal.MaterialInterface):
                    materials.append(loaded)
        _FOLDERS[folder] = (meshes, materials)
    return _FOLDERS[folder]


def size(mesh):
    try:
        return mesh.get_bounds().box_extent.length()
    except Exception:
        return 0.0


def is_effect(mesh):
    node = HASH_SUFFIX.sub("", mesh.get_name()).lower().split("-", 1)[-1]
    if any(EFFECT_WORD.match(w) for w in re.split(r"[^a-z0-9]+", node) if w):
        return True
    for slot in mesh.get_editor_property("static_materials") or []:
        material = slot.get_editor_property("material_interface")
        names = [str(slot.get_editor_property("material_slot_name")), material.get_name() if material else ""]
        if any(n.lower().startswith("fx_") for n in names):
            return True
    return False


def pieces_for(folder, hint_words, notes):
    """The meshes a piece is drawn with, largest first: every part, but only one member of a model set."""
    meshes, _ = folder_assets(folder)
    unique = {}
    for mesh in meshes:
        key = HASH_SUFFIX.sub("", mesh.get_name())
        if key not in unique or mesh.get_name() == key:
            unique[key] = mesh
    solid = [m for m in unique.values() if not is_effect(m)] or list(unique.values())
    sets, parts = {}, []
    for mesh in solid:
        match = SET_PIECE.search(HASH_SUFFIX.sub("", mesh.get_name()))
        if match:
            sets.setdefault(match.group(1).lower(), []).append(mesh)
        else:
            parts.append(mesh)
    chosen = []
    if sets:
        def score(key):
            plain = 0 if re.search(r"lrg|large|alt", key) else 1
            return (len(words(key) & hint_words), plain, -len(key))
        best = max(sets, key=score)
        chosen = sets[best]
        if len(sets) > 1:
            notes.append("model set member guessed: %s (of %s)" % (best, ", ".join(sorted(sets))))
    return sorted(chosen + parts, key=size, reverse=True)


def skin_for(folder, hint_words, notes):
    """The material a variant wears, among a model's imported skins, when its pieces wear placeholders."""
    meshes, materials = folder_assets(folder)
    skins = [m for m in materials if not m.get_name().lower().startswith("dummymtl")]
    placeholders = any(m.get_name().lower().startswith("dummymtl") for m in materials)
    if not skins or (not placeholders and len(skins) < 2):
        return None
    best = max(skins, key=lambda m: (len(words(m.get_name()) & hint_words), -len(m.get_name())))
    if len(skins) > 1:
        overlap = len(words(best.get_name()) & hint_words)
        notes.append("skin %s: %s" % ("matched" if overlap else "guessed (no name match)", best.get_name()))
    return best


def offset_from_wrapper(part, notes):
    """The placement a compound model gives its base, from Clyde (Z-up, metres) into the imported mesh's space.

    The exported glTF carries Clyde's axes as they are and the importer swaps Y and Z, so the same swap applies
    here (INFERRED; check the Targe and the Tortafists on the knight)."""
    transform = part.get("transform") or {}
    t = [float(v) for v in (transform.get("translation") or "0,0,0").split(",")]
    q = [float(v) for v in (transform.get("rotation") or "0,0,0,1").split(",")]
    s = [float(v) for v in (transform.get("scale") or "1").split(",")]
    s = s * 3 if len(s) == 1 else s
    notes.append("placement from the compound model (inferred axis swap)")
    return unreal.Transform(
        location=unreal.Vector(t[0] * 100.0, t[2] * 100.0, t[1] * 100.0),
        rotation=unreal.Quat(-q[0], -q[2], -q[1], q[3]).rotator(),
        scale=unreal.Vector(s[0], s[2], s[1]))


def curve(at_depth, samples):
    return [float(at_depth.get(str(d), 0.0)) for d in samples]


def make_struct(struct_type, **values):
    struct = struct_type()
    for name, value in values.items():
        struct.set_editor_property(name, value)
    return struct


def main():
    with open(GEAR_JSON, encoding="utf-8") as handle:
        gear = json.load(handle)
    wrappers = json.load(open(WRAPPERS, encoding="utf-8")) if os.path.isfile(WRAPPERS) else {}
    manifest = json.load(open(ICON_MANIFEST, encoding="utf-8")) if os.path.isfile(ICON_MANIFEST) else {}
    icons = manifest.get("icons") or {}
    samples = gear["depth_samples"]
    level_tables = gear["level_tables"]
    faces = load_json(FACE_HIDING)
    bash_map = load_json(BASH_MAP)
    weapon_damage = load_json(MONSTER_NUMBERS).get("knight_weapon_damage_gross") or {}
    handgun_damage = next((t for t in weapon_damage.values() if t.get("config") == "PC/Damage/Handgun/Handgun Base"), {})
    rigid_pieces = load_json(RIGID_PIECES)
    tinted = load_json(TINTED_SKINS)

    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(["/Game/SK/Gear", ICONS, OUT, "/Game/TopDown/Blueprints"], True)

    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    factory = unreal.DataAssetFactory()
    factory.set_editor_property("data_asset_class", unreal.ClockworksGearDefinition)

    report, by_config, taken = {}, {}, set()
    no_look = []

    for item in gear["items"]:
        slot = item["slot"]
        folder = OUT + "/" + FOLDER_BY_SLOT[slot]
        stem = item["config_name"].split("/")[-1]
        unreleased = "unreleased" in (item.get("tags") or []) or stem.startswith("_")
        name = "DA_Gear_" + camel(stem.lstrip("_"))
        if (folder, name) in taken:
            name += "Unreleased" if unreleased else "Alt"
        taken.add((folder, name))

        path = folder + "/" + name
        asset = unreal.EditorAssetLibrary.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) \
            else asset_tools.create_asset(name, folder, unreal.ClockworksGearDefinition, factory)
        if not asset:
            unreal.log_warning("GearAssets: could not create %s" % path)
            continue
        by_config[item["config_name"]] = asset
        notes = []

        asset.set_editor_property("display_name", unreal.Text(item.get("display_name") or stem))
        asset.set_editor_property("flavor", unreal.Text(item.get("flavor") or ""))
        asset.set_editor_property("slot", SLOT_ENUM[slot])
        asset.set_editor_property("star_rating", int(item.get("star_rating") or 0))
        asset.set_editor_property("line", item.get("line") or item.get("set") or "")
        asset.set_editor_property("unreleased", unreleased)

        icon_entry = icons.get(item["config_name"]) or {}
        icon = unreal.EditorAssetLibrary.load_asset(ICONS + "/" + icon_entry["asset"]) if icon_entry.get("asset") and \
            unreal.EditorAssetLibrary.does_asset_exist(ICONS + "/" + icon_entry["asset"]) else None
        asset.set_editor_property("icon", icon)
        if not icon:
            notes.append("no icon")

        # ----- look -----
        model = item.get("model") or {}
        model_path = model.get("path")
        hint = words(model.get("variant")) | words(item.get("display_name")) | words(os.path.basename(model_path or ""))
        asset.set_editor_property("mesh", None)
        asset.set_editor_property("extra_meshes", [])
        asset.set_editor_property("mesh_material", None)
        asset.set_editor_property("mesh_offset", unreal.Transform())
        asset.set_editor_property("armor_mesh", None)
        asset.set_editor_property("hides_face", slot == "Helm" and (faces.get(item["config_name"]) or {}).get("show_face") is False)
        if model.get("colorization"):
            notes.append("colorized %s in the original; shows untinted" % model["colorization"])

        if slot in MODELS_BY_SLOT and model_path:
            parts = wrappers.get(model_path) or [{"base": model_path}]
            pieces, skin = [], None
            for part in parts:
                model_folder = MODELS_BY_SLOT[slot] + "/" + gear_model_asset(part["base"])
                pieces += pieces_for(model_folder, hint, notes)
                skin = skin or skin_for(model_folder, hint | words(part.get("variant")), notes)
            if parts[0].get("transform"):
                asset.set_editor_property("mesh_offset", offset_from_wrapper(parts[0], notes))
            if pieces:
                asset.set_editor_property("mesh", pieces[0])
                asset.set_editor_property("extra_meshes", pieces[1:])
                asset.set_editor_property("mesh_material", skin)
            else:
                no_look.append(item["config_name"])
                notes.append("no imported mesh in %s" % ", ".join(gear_model_asset(p["base"]) for p in parts))
        elif slot == "Armor" and model_path:
            armor = armor_asset(model_path)
            armor_path = "%s/%s/%s" % (ARMOR_MODELS, armor, armor)
            if unreal.EditorAssetLibrary.does_asset_exist(armor_path):
                asset.set_editor_property("armor_mesh", unreal.EditorAssetLibrary.load_asset(armor_path))
            else:
                no_look.append(item["config_name"])
                notes.append("no imported armour %s" % armor_path)

        # The armour's loose pieces: the camera-facing build of a billboard (placed at its pivot), the bone-space one
        # otherwise (research: _research/rigid_armor/rigid_pieces.md). Bone names lose their spaces on import.
        pieces = []
        for piece in (rigid_pieces.get(model_path or "") or {}).get("pieces") or []:
            billboard = piece.get("billboard_variant")
            chosen = billboard or piece
            meshes, _ = folder_assets(ARMOR_PIECES + "/" + chosen["static_mesh_name"])
            if not meshes:
                notes.append("loose piece %s not imported" % chosen["static_mesh_name"])
                continue
            location = billboard["pivot_location_cm_INFERRED"] if billboard else piece["relative_transform"]["location_cm"]
            spec = unreal.ClockworksGearPiece()
            spec.set_editor_property("mesh", max(meshes, key=size))
            spec.set_editor_property("bone", piece["bone"].replace(" ", "-"))
            spec.set_editor_property("offset", unreal.Transform(location=unreal.Vector(*location)))
            spec.set_editor_property("faces_camera", bool(billboard))
            pieces.append(spec)
        asset.set_editor_property("armor_pieces", pieces)

        # Tinted skins, keyed by the imported material each replaces. Additive overlays keep their own material: the
        # masked gear skin material would draw them solid.
        swaps = {}
        for texture in (tinted.get(item["config_name"]) or {}).get("textures") or []:
            hint = (texture.get("material_hint") or "").split(" (")[0].strip()
            if not hint or "Additive" in (texture.get("material") or "") or texture.get("material_parameter") not in (None, "Texture"):
                continue
            instance = SKIN_INSTANCES + "/MI_GearSkin_" + texture["asset"][len("T_GearSkin_"):]
            if unreal.EditorAssetLibrary.does_asset_exist(instance):
                swaps[hint] = unreal.EditorAssetLibrary.load_asset(instance)
            else:
                notes.append("tinted skin %s not made" % texture["asset"])
        asset.set_editor_property("skin_swaps", swaps)

        # ----- stats -----
        defense = item.get("defense") or {}
        for kind, prop in DEFENSE_PROPERTY.items():
            asset.set_editor_property(prop, curve(defense[kind]["at_depth"], samples) if kind in defense else [])

        heat_defense, heat_health = 0.0, []
        table = (item.get("level") or {}).get("level_table")
        top = [l for l in level_tables.get(table) or [] if l["level"] == 10]
        for modifier in (top[0]["modifiers"] if top else []):
            if modifier["kind"] == "DefenseIncrease":
                heat_defense += float(modifier.get("defense") or 0.0)
            elif modifier["kind"] == "HealthBonus" and modifier.get("health"):
                heat_health.append(make_struct(unreal.ClockworksGearHealthStep,
                                               min_depth=int(modifier.get("min_depth") or 0), health=float(modifier["health"])))
        asset.set_editor_property("heat_defense_bonus", heat_defense)
        asset.set_editor_property("heat_health", heat_health)

        resists = []
        for entry in item.get("status_resist") or []:
            for status in entry.get("statuses") or []:
                resists.append(make_struct(unreal.ClockworksGearStatusResist, status=status, resist=float(entry.get("resist") or 0.0)))
        asset.set_editor_property("status_resists", resists)

        bonuses = []
        for modifier in item.get("modifiers") or []:
            kind = modifier["kind"]
            label = str(modifier.get("bonus") or "")
            raw = modifier.get(VALUE_FIELD.get(kind, ""))
            inferred = False
            if kind in BONUS_STEP and label in BONUS_LEVEL:
                # The step for the level, pointing the way the bonus points (a penalty is marked positive: false or
                # carries a negative number).
                hint = raw if raw is not None else modifier.get("value_inferred")
                negative = modifier.get("positive") is False or (hint is not None and float(hint) < 0)
                value = (-1.0 if negative else 1.0) * BONUS_STEP[kind] * BONUS_LEVEL[label]
            else:
                value = raw
                if value is None:
                    value = modifier.get("value_inferred")
                    inferred = True
            if value is None:
                notes.append("bonus %s has no number; left out" % kind)
                continue
            weapon_class = modifier.get("weapon_class")
            bonuses.append(make_struct(
                unreal.ClockworksGearBonus, kind=kind, all_weapon_classes=weapon_class not in WEAPON_CLASS,
                weapon_class=WEAPON_CLASS.get(weapon_class, unreal.ClockworksWeaponClass.SWORD), value=float(value),
                label=str(modifier.get("bonus") or ""), value_inferred=inferred,
                tag=(modifier.get("tag") or "").replace("fam_", "").capitalize()))
        asset.set_editor_property("bonuses", bonuses)

        shield = item.get("shield") or {}
        if slot == "Shield" and shield:
            asset.set_editor_property("shield_health", curve((shield.get("health") or {}).get("at_depth") or {}, samples))
            asset.set_editor_property("shield_regen_seconds", (shield.get("regen_time_ms") or 6000) / 1000.0)
            asset.set_editor_property("shield_hit_seconds", (shield.get("hit_time_ms") or 3000) / 1000.0)
            asset.set_editor_property("shield_break_seconds", (shield.get("break_time_ms") or 8000) / 1000.0)
            asset.set_editor_property("shield_defending_speed", float(shield.get("defending_speed") if shield.get("defending_speed") is not None else -0.5))
            asset.set_editor_property("shield_bash", shield.get("bash") or "")
            arguments = (shield.get("action") or {}).get("arguments") or {}
            asset.set_editor_property("shield_push_back", float(arguments.get("Knock-Back Power") or 0.0))

            # The bash: the kind and rank the research mapped, and the handgun damage curve at the shield's stars
            # (the original reads the bash's damage there), resampled onto the gear curve depths.
            bash = (bash_map.get(item["config_name"]) or {}).get("bash_numbers") or {}
            stars = int(item.get("star_rating") or 0)
            asset.set_editor_property("shield_bash_kind", BASH_KIND.get(bash.get("variant"), unreal.ClockworksShieldBashKind.STANDARD))
            asset.set_editor_property("shield_bash_rank", int(bash.get("rank") if bash.get("rank") is not None else stars))
            by_depth = ((handgun_damage.get("by_star") or {}).get(str(stars))) or {}
            asset.set_editor_property("shield_bash_damage", resample(by_depth, samples) if by_depth else [])
            if not bash or not by_depth:
                notes.append("bash numbers missing (map %s, damage %s)" % (bool(bash), bool(by_depth)))

        unreal.EditorAssetLibrary.save_loaded_asset(asset, False)
        report[item["config_name"]] = {"asset": path, "notes": notes}

    # Upgrade lines, once every asset exists.
    for item in gear["items"]:
        asset = by_config.get(item["config_name"])
        parent = by_config.get((item.get("upgrades_from") or [None])[0])
        if asset and asset.get_editor_property("upgrades_from") != parent:
            asset.set_editor_property("upgrades_from", parent)
            unreal.EditorAssetLibrary.save_loaded_asset(asset, False)

    # The starting gear and the knight's own health.
    starters = {}
    for slot, model_path in STARTER_MODELS.items():
        candidates = [i for i in gear["items"] if i["slot"] == slot and (i.get("model") or {}).get("path") == model_path]
        if slot == "Shield" and STARTER_SHIELD in by_config:
            starters[slot] = by_config[STARTER_SHIELD]
        elif candidates:
            starters[slot] = by_config.get(min(candidates, key=lambda i: (i.get("star_rating") or 0, i["config_name"]))["config_name"])
    blueprint = unreal.EditorAssetLibrary.load_asset(CHARACTER_BP)
    if blueprint:
        defaults = unreal.get_default_object(blueprint.generated_class())
        defaults.set_editor_property("default_gear", [starters.get("Helm"), starters.get("Armor"), starters.get("Shield"), None, None])
        defaults.set_editor_property("initial_max_health", KNIGHT_BASE_HEALTH)
        defaults.set_editor_property("initial_health", KNIGHT_BASE_HEALTH)
        unreal.EditorAssetLibrary.save_loaded_asset(blueprint, False)
        unreal.log_warning("GearAssets: BP_ClockworksCharacter starts in %s" % ", ".join(
            a.get_name() if a else "nothing" for a in [starters.get("Helm"), starters.get("Armor"), starters.get("Shield")]))

    bash_ability = unreal.EditorAssetLibrary.load_asset(BASH_ABILITY)
    if bash_ability:
        bash_defaults = unreal.get_default_object(bash_ability.generated_class())
        for name, value in BASH_DEFAULTS.items():
            bash_defaults.set_editor_property(name, value)
        unreal.EditorAssetLibrary.save_loaded_asset(bash_ability, False)
        unreal.log_warning("GearAssets: BP_GA_ShieldBash set to the original's bash numbers")

    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump({"no_look": no_look, "items": report}, handle, indent=1)
    guesses = sum(1 for r in report.values() if any("guess" in n or "inferred" in n for n in r["notes"]))
    unreal.log_warning("GearAssets: %d gear assets written, %d without a model, %d with a looks guess -> %s"
                       % (len(report), len(no_look), guesses, REPORT))


main()
