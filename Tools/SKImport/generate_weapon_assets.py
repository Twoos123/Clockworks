# Unreal Editor Python script. Run it headless with:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/generate_weapon_assets.py"
#
# It creates one UClockworksWeaponDefinition asset per weapon in weapons.json, which is itself
# generated from the game's own item.xml by mine_weapons.py. 352 weapons is far too many to author
# by hand, and hand-authoring them would get the numbers wrong; this keeps the catalogue honest by
# construction.
#
# Written as an editor Python script rather than driven over the editor's automation link because
# that link is not always available, and a headless commandlet can be re-run at any time.
#
# Everything it writes lives under /Game/TopDown/Gear/Catalogue/, so it never touches the
# hand-tuned starter weapons in /Game/TopDown/Gear/.
#
# Skins are a separate step: run fix_weapon_materials.py after this.

import json
import os
import re
import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
WEAPONS_JSON = os.path.join(HERE, "weapons.json")

GEAR_PATH = "/Game/TopDown/Gear/Catalogue"
MODEL_PATH = "/Game/SK/WeaponModels"
ICON_PATH = "/Game/SK/WeaponIcons"
KNIGHT_ANIMS = "/Game/SK/Knights/PlayerKnight/SkeletalMeshes/PlayerKnight"
BLUEPRINTS = "/Game/TopDown/Blueprints"

# One attack ability per class. What separates two swords is their damage type, their status and
# their numbers, not their animation, so a single ability serves a whole class.
# Blueprint asset paths, not class paths: does_asset_exist is false for a "_C" and the load then
# silently returns nothing, which is how every weapon ended up with no attack ability the first time.
ABILITY_BY_CLASS = {
    "Sword": BLUEPRINTS + "/BP_GA_SwordAttack.BP_GA_SwordAttack",
    "Handgun": BLUEPRINTS + "/BP_GA_PistolAttack.BP_GA_PistolAttack",
    "Bomb": BLUEPRINTS + "/BP_GA_BombAttack.BP_GA_BombAttack",
}

DRAW_ANIM_BY_CLASS = {
    "Sword": KNIGHT_ANIMS + "ready_sword.PlayerKnightready_sword",
    "Handgun": KNIGHT_ANIMS + "ready_pistol.PlayerKnightready_pistol",
    "Bomb": KNIGHT_ANIMS + "lift.PlayerKnightlift",
}

# The attack-speed multiplier a class moves at when the game's own data does not say. Swords never
# declare one: the original expresses a sword's speed through its animation rates instead.
DEFAULT_ATTACK_SPEED = {"Sword": 0.25, "Handgun": 0.75, "Bomb": 0.1}
DEFAULT_CHARGE_SPEED = {"Sword": 1.0, "Handgun": 1.0, "Bomb": 0.9}

STATUS_CLASS = {
    "Fire": "/Script/Clockworks.ClockworksFireEffect",
    "Freeze": "/Script/Clockworks.ClockworksFreezeEffect",
    "Shock": "/Script/Clockworks.ClockworksShockEffect",
    "Poison": "/Script/Clockworks.ClockworksPoisonEffect",
    "Stun": "/Script/Clockworks.ClockworksStatusStunEffect",
    "Curse": "/Script/Clockworks.ClockworksCurseEffect",
    "Sleep": "/Script/Clockworks.ClockworksSleepEffect",
}

# The game's own chance enum, as a probability (its StatusChance enum, read from the bytecode by the weapon damage
# research; user's decision 2026-09-15 to use the original's). CUSTOM names its own chance; MEDIUM stands in.
CHANCE = {"LOW": 0.05, "MEDIUM": 0.10, "HIGH": 0.25, "VERY_HIGH": 0.50, "ULTRA": 0.65, "CUSTOM": 0.10}

# How long a status lasts, by its power tier.
POWER_SECONDS = {"MINOR": 3.0, "MODERATE": 5.0, "STRONG": 8.0, "CUSTOM": 5.0}
POWER_TICK_DAMAGE = {"MINOR": 3.0, "MODERATE": 5.0, "STRONG": 8.0, "CUSTOM": 5.0}

DAMAGE_TAG = {
    "Normal": "Data.Damage.Normal",
    "Piercing": "Data.Damage.Piercing",
    "Elemental": "Data.Damage.Elemental",
    "Shadow": "Data.Damage.Shadow",
}

# Dev and test entries that survived the miner's filter because they carry no `creatable` field.
SKIP_NAMES = {"_Frost Sword"}


def asset_name(path, prefix):
    """Mirror of _asset_name in stage_and_import.py, so the names line up with what was imported."""
    parts = path.replace("\\", "/").split("/")
    stem = os.path.splitext(parts[-1])[0]
    if stem.startswith("model_"):
        stem = stem[len("model_"):]
    elif stem == "model":
        stem = ""
    pieces = [parts[-3], parts[-2], stem] if len(parts) >= 3 else parts
    name = "_".join(x for x in pieces if x)
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in name)
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return prefix + cleaned.strip("_").title().replace("_", "")


def safe_asset_name(display_name):
    """'Blitz Needle' -> 'DA_Weapon_BlitzNeedle'. Unreal asset names take no spaces or punctuation."""
    cleaned = "".join(ch if ch.isalnum() else " " for ch in display_name)
    return "DA_Weapon_" + "".join(part.capitalize() for part in cleaned.split())


def load(path):
    return unreal.EditorAssetLibrary.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None


def model_tokens(model_path):
    """('r2', {'brandish', 'fir'}) out of 'item/weapon/sword/calibur/model_brandish-fir-r2.dat'."""
    stem = os.path.splitext(os.path.basename(model_path or ""))[0].lower()
    words = [w for w in re.split(r"[^a-z0-9]+", stem) if w and w != "model"]
    revision = next((w for w in words if re.fullmatch(r"r\d", w)), None)
    return revision, {w for w in words if w != revision}


# Every static mesh in each imported model folder, listed once: several weapons in a line share one
# model folder, and listing a folder is far more expensive than the lookup that saves doing it twice.
_FOLDER_MESHES = {}


def folder_meshes(folder_name):
    if folder_name not in _FOLDER_MESHES:
        meshes = []
        folder = MODEL_PATH + "/" + folder_name
        if unreal.EditorAssetLibrary.does_directory_exist(folder):
            for path in unreal.EditorAssetLibrary.list_assets(folder, recursive=True, include_folder=False):
                loaded = unreal.EditorAssetLibrary.load_asset(path)
                if isinstance(loaded, unreal.StaticMesh):
                    meshes.append(loaded)
        _FOLDER_MESHES[folder_name] = meshes
    return _FOLDER_MESHES[folder_name]


_TRACED = None


def traced_model(display_name):
    """(model path, set member) the game really draws this weapon with, from gun_models_textures.json.

    Only consulted when the weapon's own model file gave no mesh: that file is sometimes a wrapper
    (a compound, a "held" model) the exporter cannot see through.
    """
    global _TRACED
    if _TRACED is None:
        path = os.path.join(HERE, "gun_models_textures.json")
        _TRACED = {}
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as handle:
                _TRACED = json.load(handle)
    entry = _TRACED.get(display_name) or {}
    return entry.get("model_path_used"), entry.get("set_member")


def find_static_mesh(folder_name, model_path, set_member=None):
    """The static mesh inside an imported model folder that belongs to this weapon.

    A model *set* imports every tier into one folder: the chemical bomb folder holds r2, r3, r4 and
    r5 bodies, and the Pulsar's holds both the Pulsar and the Catalyzer. Picking the largest, as this
    used to, gave every Vaporizer the Atomizer's body. So the tier ("r2") and the line words
    ("puls", "cata") in the weapon's own model file name are matched against the mesh names first,
    and size only breaks ties: a blade is a bigger piece of geometry than the gems stuck to it.
    """
    meshes = folder_meshes(folder_name)
    if not meshes:
        return None

    revision, words = model_tokens(model_path)

    def score(mesh):
        name = mesh.get_name().lower()
        mesh_words = set(re.split(r"[^a-z0-9]+", name))
        value = 0
        if revision:
            if revision in mesh_words:
                value += 4
            elif any(re.fullmatch(r"r\d", w) for w in mesh_words):
                value -= 4
        value += sum(1 for w in words if w in mesh_words)
        # The node the game's model set names for this weapon outranks every guess from file names.
        members = [set_member] if isinstance(set_member, str) else (set_member or [])
        if any(isinstance(m, str) and m.lower() in name for m in members):
            value += 10
        try:
            size = mesh.get_bounds().box_extent.length()
        except Exception:
            size = 0.0
        return (value, size)

    return max(meshes, key=score)


# Interchange names a piece after the exporter's node: "needler_model-MeshNodes__pSphere9__" is one part
# of one model; "autogun_model_shd-MeshSets_r4__Mesh_0_" is piece 0 of the r4 member of a model set. A
# node written into one file twice comes in the second time with a 32-digit hash on the end.
HASH_SUFFIX = re.compile(r"_[0-9a-f]{32}$")
SET_PIECE = re.compile(r"MeshSets_(.+?)__Mesh_\d+_$")
EFFECT_WORD = re.compile(r"^(ribbon\w*|glow|fx|billboard|energy|trail|pplane\d*|plane)$")

_MEMBERS = None


def model_members(display_name, traced_member):
    """The model-set members this weapon wears, as the game's model data names them.

    weapon_model_members.json covers every weapon (resolved from item.xml through the model files);
    gun_models_textures.json's set_member is the fallback.
    """
    global _MEMBERS
    if _MEMBERS is None:
        path = os.path.join(HERE, "weapon_model_members.json")
        _MEMBERS = {}
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as handle:
                _MEMBERS = json.load(handle)
    members = list(_MEMBERS.get(display_name) or [])
    for member in ([traced_member] if isinstance(traced_member, str) else (traced_member or [])):
        if isinstance(member, str) and member not in members:
            members.append(member)
    return members


def piece_size(mesh):
    try:
        return mesh.get_bounds().box_extent.length()
    except Exception:
        return 0.0


_PIECE_KINDS = None


def piece_kind(folder_name, mesh):
    """'solid', 'effect' or 'hidden' for this piece, from weapon_model_pieces.json, or None when unlisted.

    That file was resolved from the game's own material configs: a piece whose material adds light
    without writing depth is an effect, everything drawn with its texture is solid. It is right where
    names mislead, which they do: a Valiance's "ribbon" and "pPlane34" are solid parts of the gun."""
    global _PIECE_KINDS
    if _PIECE_KINDS is None:
        path = os.path.join(HERE, "weapon_model_pieces.json")
        _PIECE_KINDS = {}
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as handle:
                _PIECE_KINDS = json.load(handle).get("folders") or {}
    pieces = _PIECE_KINDS.get(folder_name) or {}
    return pieces.get(mesh.get_name()) or pieces.get(HASH_SUFFIX.sub("", mesh.get_name()))


def is_effect_piece(mesh, folder_name=None):
    """A trail, glow or billboard card. The original draws these with particle materials the importer
    cannot rebuild, so on a weapon they would show as flat grey sheets."""
    kind = piece_kind(folder_name, mesh) if folder_name else None
    if kind == "effect":
        return True
    if kind in ("solid", "hidden"):
        return False
    base = HASH_SUFFIX.sub("", mesh.get_name()).lower()
    node = base.split("-", 1)[-1]  # the node half of the name, not the model file half
    if any(EFFECT_WORD.match(word) for word in re.split(r"[^a-z0-9]+", node) if word):
        return True
    for slot in mesh.get_editor_property("static_materials") or []:
        material = slot.get_editor_property("material_interface")
        names = [str(slot.get_editor_property("material_slot_name")), material.get_name() if material else ""]
        if any(name.lower().startswith("fx_") for name in names):
            return True
    return False


def weapon_pieces(folder_name, model_path, members):
    """Every static mesh this weapon is drawn with, largest first.

    A model set (every tier of a line in one file) contributes only the members this weapon wears: the
    ones the game's data names, else the best match for the tier and words in the model file name, else
    the largest. Every other part in the folder belongs to the model itself and is kept, bar effect cards.
    """
    unique = {}
    for mesh in folder_meshes(folder_name):
        key = HASH_SUFFIX.sub("", mesh.get_name())
        if key not in unique or mesh.get_name() == key:
            unique[key] = mesh
    pieces = [m for m in unique.values() if not is_effect_piece(m, folder_name)]
    if not pieces:
        # The game draws every piece of a few models with an effect material (the Diskgun's glowing
        # body). Then the names and materials decide, so the body still shows and the spinner card does not.
        pieces = [m for m in unique.values() if not is_effect_piece(m)] or list(unique.values())
    if not pieces:
        return []

    sets, parts = {}, []
    for mesh in pieces:
        match = SET_PIECE.search(HASH_SUFFIX.sub("", mesh.get_name()))
        if match:
            sets.setdefault(match.group(1).lower(), []).append(mesh)
        else:
            parts.append(mesh)

    chosen = []
    if sets:
        wanted = {re.sub(r"[^a-z0-9_-]", "_", m.lower()) for m in members}
        chosen = [key for key in sets if key in wanted]
        if not chosen:
            revision, words = model_tokens(model_path)

            def score(key):
                key_words = set(re.split(r"[^a-z0-9]+", key))
                value = 0
                if revision:
                    if revision in key_words:
                        value += 4
                    elif any(re.fullmatch(r"r\d", w) for w in key_words):
                        value -= 4
                return value + sum(1 for w in words if w in key_words)

            best = max(score(key) for key in sets)
            if best > 0:
                chosen = [key for key in sets if score(key) == best]
            else:
                chosen = [max(sets, key=lambda key: max(piece_size(m) for m in sets[key]))]
    selected = [m for key in chosen for m in sets[key]] + parts
    return sorted(selected, key=piece_size, reverse=True)


def main():
    with open(WEAPONS_JSON, encoding="utf-8") as handle:
        weapons = json.load(handle)

    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    factory = unreal.DataAssetFactory()
    factory.set_editor_property("data_asset_class", unreal.ClockworksWeaponDefinition)

    made, skipped, no_mesh = 0, 0, []
    seen = set()
    by_config = {}

    for weapon in weapons:
        display = weapon.get("display_name") or ""
        if not display or display in SKIP_NAMES:
            skipped += 1
            continue

        name = safe_asset_name(display)
        if name in seen:
            # Two config entries can share a display name; the first wins rather than overwriting.
            skipped += 1
            continue
        seen.add(name)

        full_path = GEAR_PATH + "/" + name
        if unreal.EditorAssetLibrary.does_asset_exist(full_path):
            asset = unreal.EditorAssetLibrary.load_asset(full_path)
        else:
            asset = asset_tools.create_asset(name, GEAR_PATH, unreal.ClockworksWeaponDefinition, factory)
        if not asset:
            skipped += 1
            continue
        by_config[weapon["config_name"]] = asset

        weapon_class = weapon.get("weapon_class") or "Sword"

        asset.set_editor_property("display_name", unreal.Text(display))
        asset.set_editor_property("weapon_class", {
            "Sword": unreal.ClockworksWeaponClass.SWORD,
            "Handgun": unreal.ClockworksWeaponClass.HANDGUN,
            "Bomb": unreal.ClockworksWeaponClass.BOMB,
        }[weapon_class])
        asset.set_editor_property("star_rating", int(weapon.get("star_rating") or 0))

        traced_path, set_member = traced_model(display)
        members = model_members(display, set_member)
        pieces = weapon_pieces(asset_name(weapon["model_path"], "SM_"), weapon["model_path"], members)
        if not pieces and traced_path:
            pieces = weapon_pieces(asset_name(traced_path, "SM_"), traced_path, members)
        if pieces:
            asset.set_editor_property("mesh", pieces[0])
            asset.set_editor_property("extra_meshes", pieces[1:])
        else:
            asset.set_editor_property("extra_meshes", [])
            no_mesh.append(display)

        icon = load(ICON_PATH + "/" + asset_name(weapon["icon_path"], "T_"))
        if icon:
            asset.set_editor_property("icon", icon)

        ability = load(ABILITY_BY_CLASS[weapon_class])
        if ability:
            asset.set_editor_property("attack_ability", ability.generated_class())

        draw = load(DRAW_ANIM_BY_CLASS[weapon_class])
        if draw:
            asset.set_editor_property("draw_anim", draw)
        asset.set_editor_property("draw_seconds", 0.3)
        asset.set_editor_property("attach_socket", "bone_weapon_r")

        # The first damage type is the weapon's primary. A dual-type weapon deals both in the
        # original; this project resolves one type per hit, so the first is what it carries.
        types = weapon.get("damage_types") or ["Normal"]
        # Through a C++ helper: a gameplay tag's name is read-only in Unreal's Python bindings and
        # the tag library is not exposed there, so this is the only supported route.
        asset.set_damage_type_by_name(DAMAGE_TAG.get(types[0], DAMAGE_TAG["Normal"]))

        # Attack values run from about 10 to about 300 across the catalogue, and this project's own
        # scale has a sword swing at 10. Normalise against the starter weapons rather than letting a
        # 5-star weapon deal thirty times a Calibur.
        attack_value = weapon.get("attack_value")
        base_value = {"Sword": 120.0, "Handgun": 10.0, "Bomb": 80.0}[weapon_class]
        multiplier = 1.0
        if attack_value:
            multiplier = max(0.25, min(3.0, float(attack_value) / base_value))
        asset.set_editor_property("damage_multiplier", multiplier)

        asset.set_editor_property(
            "attack_move_speed_multiplier",
            weapon.get("attacking_speed") or DEFAULT_ATTACK_SPEED[weapon_class])
        asset.set_editor_property(
            "charge_move_speed_multiplier",
            weapon.get("charging_speed") or DEFAULT_CHARGE_SPEED[weapon_class])

        status = weapon.get("status")
        if status and status in STATUS_CLASS:
            status_class = unreal.load_class(None, STATUS_CLASS[status])
            if status_class:
                asset.set_editor_property("status_effect", status_class)
                asset.set_editor_property("status_chance", CHANCE.get(weapon.get("status_chance"), 0.3))
                asset.set_editor_property("status_seconds", POWER_SECONDS.get(weapon.get("status_power"), 5.0))
                asset.set_editor_property("status_tick_damage", POWER_TICK_DAMAGE.get(weapon.get("status_power"), 5.0))

        unreal.EditorAssetLibrary.save_loaded_asset(asset, False)
        made += 1

    # Second pass: the upgrade lines. Every asset exists by now, so a parent can be pointed at even
    # when it sorts after its child.
    linked = 0
    for weapon in weapons:
        asset = by_config.get(weapon.get("config_name"))
        if not asset:
            continue
        parent = by_config.get(weapon.get("upgrades_from")) if weapon.get("upgrades_from") else None
        if asset.get_editor_property("upgrades_from") != parent:
            asset.set_editor_property("upgrades_from", parent)
            unreal.EditorAssetLibrary.save_loaded_asset(asset, False)
        linked += 1 if parent else 0

    unreal.log_warning("Clockworks: generated {0} weapon data assets, skipped {1}, {2} linked to the weapon they upgrade from".format(made, skipped, linked))
    if no_mesh:
        unreal.log_warning("Clockworks: {0} weapons have no imported mesh: {1}".format(
            len(no_mesh), ", ".join(sorted(no_mesh)[:25])))


main()
