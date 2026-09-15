#!/usr/bin/env python3
"""Mine the Spiral Knights weapon catalogue out of the game's config dumps.

Reads (read-only):
    <ConfigRefs>/item.xml    the item catalogue: every sword, handgun and bomb
    <ConfigRefs>/attack.xml  attack configs, used only as a last-resort source
                             for damage types when item.xml carries none

Writes:
    weapons.json  next to this script (one object per real weapon)

Nothing here mutates the inputs. Re-running overwrites weapons.json only.

------------------------------------------------------------------------------
How the XML is shaped (learned by reading the dumps, documented so the next
person does not have to):

* The file is a com.threerings.export.XMLImporter dump. Every catalogue item is
  a top-level `<entry>` at two-space indent. NOTE: some carry an attribute --
  `<entry depth="1">` -- so a naive `^  <entry>$` match silently drops 53 of the
  7790 entries, including `Weapon/Sword/Parts/Base (Calibur)`.

* A real weapon is `ItemConfig$Derived`: it names a base item under
  `Weapon/<class>/Parts/...` and supplies an `<arguments>` map of overrides.
  Bases are themselves entries, and a base can be Derived over another base
  (Calibur -> Base (Calibur) -> Base (3 Hit)), so the chain is walked rather
  than hopping exactly once.

* Scalars like `<chargeTime>`, `<maxChain>`, `<attackingSpeed>` and
  `<chargingSpeed>` only ever appear as raw tags on the *original* (non-derived)
  implementation at the end of the chain -- never as arguments.

* Damage type lives in two places, never as a class name:
      - `ItemConfig$AttackValue` entries carry an optional `<damageType>`;
        its absence means NORMAL. This is the authoritative split.
      - `DamageConfig$DepthScale` carries `<type>` (that type replaces normal)
        and `DamageConfig$DepthScaleMulti` carries `<type2>` (normal + that).
  The `PC/Damage/Sword/Sword Base -05` style depthScale *names* encode
  magnitude, not element, so they are deliberately not used for typing.

* Status lives in the `Status Values` argument: an array of entries with a
  `<flags>` bitmask plus `<power>` / `<chance>`. The bitmask was decoded by
  correlating it with the `sc_*` tags and with weapon names:
      1 Stun, 2 Poison, 4 Fire, 8 Freeze, 16 Shock, 32 Curse, 256 Sleep.
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, OrderedDict

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

CONFIG_REFS = r"D:\Dev\Tools\ThreeRingsSharp\ThreeRingsSharp\ConfigRefs"
ITEM_XML = os.path.join(CONFIG_REFS, "item.xml")
ATTACK_XML = os.path.join(CONFIG_REFS, "attack.xml")

OUT_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "weapons.json")

WEAPON_CLASSES = ("Sword", "Handgun", "Bomb")

# --------------------------------------------------------------------------
# Lookup tables
# --------------------------------------------------------------------------

# Bitmask used by ItemConfig$StatusValue.flags and DamageConfig$Status.flags.
STATUS_FLAGS = {
    1: "Stun",
    2: "Poison",
    4: "Fire",
    8: "Freeze",
    16: "Shock",
    32: "Curse",
    256: "Sleep",
}

# Enum spellings seen in <damageType>, <type> and <type2>.
DAMAGE_TYPE_NAMES = {
    "NORMAL": "Normal",
    "PIERCING": "Piercing",
    "ELEMENTAL": "Elemental",
    "SHADOW": "Shadow",
}

STATUS_WORDS = ("Fire", "Freeze", "Shock", "Poison", "Stun", "Curse", "Sleep")

# --------------------------------------------------------------------------
# Low-level XML slicing
#
# These dumps are machine-generated with rigid two-space indentation, which is
# what makes indentation-anchored regexes safe here. A real XML parse would
# cost ~10x the time and memory for no extra fidelity on a 10 MB file.
# --------------------------------------------------------------------------

# Top-level catalogue entry. The optional attribute group is the part a naive
# pattern misses.
ENTRY_RE = re.compile(r"\n  <entry(?:\s[^>]*)?>\n(.*?)\n  </entry>", re.S)

ENTRY_NAME_RE = re.compile(r"^    <name>(.*?)</name>", re.M)
CREATABLE_RE = re.compile(r"^    <creatable>(.*?)</creatable>", re.M)
IMPL_CLASS_RE = re.compile(r'^    <implementation class="(.*?)"', re.M)

# The base item a Derived implementation sits on, plus its argument block.
DERIVED_BASE_RE = re.compile(r"^      <item>\n        <name>(.*?)</name>", re.M)

# Top-level argument keys inside `<item><arguments>` sit at exactly ten spaces.
# Nested argument maps inside a value land at fourteen, so they cannot collide.
ARG_KEY_RE = re.compile(
    r'^          <key class="java\.lang\.String">(.*?)</key>\n', re.M
)

# Raw scalars on an original (non-derived) implementation sit at six spaces.
def _impl_scalar_re(tag: str) -> "re.Pattern[str]":
    return re.compile(r"^      <%s>(.*?)</%s>" % (tag, tag), re.M)


CHARGE_TIME_IMPL_RE = _impl_scalar_re("chargeTime")
MAX_CHAIN_IMPL_RE = _impl_scalar_re("maxChain")
ATTACKING_SPEED_IMPL_RE = _impl_scalar_re("attackingSpeed")
CHARGING_SPEED_IMPL_RE = _impl_scalar_re("chargingSpeed")
RARITY_IMPL_RE = _impl_scalar_re("rarity")

ICON_IMPL_RE = re.compile(r"^      <icon>\n        <file>(.*?)</file>", re.M)
MODEL_IMPL_RE = re.compile(r"^      <model>\n        <name>(.*?)</name>", re.M)

# Splits a damage blob into one segment per DamageConfig instance.
DAMAGE_CLASS_RE = re.compile(r'class="[^"]*DamageConfig\$(\w+)"')

TYPE_RE = re.compile(r"<type>(\w+)</type>")
TYPE2_RE = re.compile(r"<type2>(\w+)</type2>")
DAMAGE_TYPE_RE = re.compile(r"<damageType>(\w+)</damageType>")

STATUS_CONDITION_RE = re.compile(r"<statusCondition>\s*<name>(.*?)</name>")

NESTED_STATUS_POWER_RE = re.compile(
    r'<key class="java\.lang\.String">Status Power</key>\s*\n'
    r'\s*<value class="[^"]*StatusPower">(\w+)</value>'
)
NESTED_STATUS_CHANCE_RE = re.compile(
    r'<key class="java\.lang\.String">Status Chance</key>\s*\n'
    r'\s*<value class="[^"]*StatusChance">(\w+)</value>'
)


def parse_arguments(block: str) -> "OrderedDict[str, str]":
    """Split one `<arguments>` block into {key: raw value XML}.

    Keys and values alternate at a fixed indent, so a value simply runs from the
    end of its key line to the start of the next key line.
    """
    args: "OrderedDict[str, str]" = OrderedDict()
    matches = list(ARG_KEY_RE.finditer(block))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(block)
        key = m.group(1)
        # First key wins: a duplicate key in the same map is the dump repeating
        # itself, and the later copy is never more specific.
        if key not in args:
            args[key] = block[m.end():end]
    return args


def derived_argument_block(body: str) -> str:
    """The `<arguments>` element belonging to a Derived implementation's item."""
    start = body.find("\n        <arguments>")
    if start == -1:
        return ""
    end = body.find("\n        </arguments>", start)
    if end == -1:
        return ""
    return body[start:end]


# --------------------------------------------------------------------------
# Value readers -- every one returns None rather than inventing a default
# --------------------------------------------------------------------------

def value_text(raw: str):
    """The scalar text of a `<value ...>text</value>`, or None if absent/empty."""
    if raw is None:
        return None
    m = re.search(r"<value(?:\s[^>]*)?>(.*?)</value>", raw, re.S)
    if not m:
        return None  # `<value/>` -- explicitly empty
    text = m.group(1).strip()
    if not text or text == "<!--empty-->":
        return None
    return text


def value_int(raw: str):
    text = value_text(raw)
    if text is None:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def value_float(raw: str):
    text = value_text(raw)
    if text is None:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def config_reference(raw: str):
    """(<name>, {arg: value}) of a ConfigReference value, or (None, {})."""
    if raw is None:
        return None, {}
    m = re.search(r"<name>(.*?)</name>", raw)
    if not m:
        return None, {}
    name = m.group(1).strip() or None
    args = {}
    for k, v in re.findall(
        r'<key class="java\.lang\.String">(.*?)</key>\s*\n'
        r'\s*<value class="java\.lang\.String">(.*?)</value>',
        raw,
    ):
        args[k] = v
    return name, args


def damage_types_from_blob(raw: str):
    """Damage types named by the DamageConfig instances inside `raw`.

    Each instance is typed by its class plus an optional element tag:
      Normal / Piercing      -- the class itself is the type
      DepthScale <type>      -- that element instead of normal
      DepthScaleMulti <type2>-- normal *and* that element
      Status                 -- a status rider, carries no damage type
    """
    out = []
    if not raw:
        return out
    marks = list(DAMAGE_CLASS_RE.finditer(raw))
    for i, m in enumerate(marks):
        cls = m.group(1)
        end = marks[i + 1].start() if i + 1 < len(marks) else len(raw)
        seg = raw[m.end():end]
        if cls == "Status":
            continue
        if cls == "Normal":
            out.append("Normal")
        elif cls == "Piercing":
            out.append("Piercing")
        elif cls == "DepthScaleMulti":
            out.append("Normal")
            t2 = TYPE2_RE.search(seg)
            if t2:
                out.append(DAMAGE_TYPE_NAMES.get(t2.group(1), t2.group(1).title()))
        elif cls in ("DepthScale", "Compound"):
            t = TYPE_RE.search(seg)
            if t:
                out.append(DAMAGE_TYPE_NAMES.get(t.group(1), t.group(1).title()))
            elif cls == "DepthScale":
                out.append("Normal")
    return out


def dedupe(seq):
    seen = set()
    out = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def status_from_condition_names(raw: str):
    """Status named by a `<statusCondition><name>Fire 3</name>` reference."""
    if not raw:
        return None
    for cond in STATUS_CONDITION_RE.findall(raw):
        for word in STATUS_WORDS:
            if cond.startswith(word):
                return word
    return None


# --------------------------------------------------------------------------
# Catalogue loading -- one pass, one dict
# --------------------------------------------------------------------------

class Entry:
    __slots__ = ("name", "body", "creatable", "impl_class", "base", "args")

    def __init__(self, name: str, body: str):
        self.name = name
        self.body = body
        c = CREATABLE_RE.search(body)
        self.creatable = c.group(1).strip().lower() if c else None
        ic = IMPL_CLASS_RE.search(body)
        self.impl_class = ic.group(1).rsplit("$", 1)[-1] if ic else None
        if self.impl_class == "Derived":
            b = DERIVED_BASE_RE.search(body)
            self.base = b.group(1) if b else None
            self.args = parse_arguments(derived_argument_block(body))
        else:
            self.base = None
            self.args = OrderedDict()


def load_entries(path: str):
    """Read the dump once and index every top-level entry by name."""
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    entries = {}
    order = []
    for body in ENTRY_RE.findall(text):
        m = ENTRY_NAME_RE.search(body)
        if not m:
            continue
        name = m.group(1)
        if name in entries:
            continue
        entries[name] = Entry(name, body)
        order.append(name)
    return entries, order


# --------------------------------------------------------------------------
# Inheritance
# --------------------------------------------------------------------------

MAX_CHAIN_DEPTH = 8


def resolve_chain(entries, name: str):
    """[weapon, base, base-of-base, ...] stopping at the original or a cycle."""
    chain = []
    seen = set()
    cur = name
    while cur and cur in entries and cur not in seen and len(chain) < MAX_CHAIN_DEPTH:
        seen.add(cur)
        e = entries[cur]
        chain.append(e)
        cur = e.base
    return chain


class Resolver:
    """Merged view of a weapon and its bases, remembering where each value came
    from so inherited fields can be reported."""

    def __init__(self, chain):
        self.chain = chain
        self.inherited = []

    def arg(self, key: str, field: str = None):
        """Raw XML of an argument, searched weapon-first then up the bases."""
        for depth, entry in enumerate(self.chain):
            if key in entry.args:
                raw = entry.args[key]
                if depth > 0 and field:
                    self._mark(field)
                return raw
        return None

    def impl_scalar(self, pattern, field: str = None):
        """A raw tag on whichever implementation in the chain declares it."""
        for depth, entry in enumerate(self.chain):
            m = pattern.search(entry.body)
            if m:
                text = m.group(1).strip()
                if not text:
                    continue
                if depth > 0 and field:
                    self._mark(field)
                return text
        return None

    def chain_search(self, pattern):
        """First capture of `pattern` anywhere in the chain, weapon body first.

        Used for values buried inside nested argument maps, where the flat
        top-level argument lookup cannot reach.
        """
        for entry in self.chain:
            m = pattern.search(entry.body)
            if m:
                return m.group(1)
        return None

    def _mark(self, field):
        if field not in self.inherited:
            self.inherited.append(field)


# --------------------------------------------------------------------------
# Per-weapon extraction
# --------------------------------------------------------------------------

def extract_attack_values(raw: str):
    """(first `<value>` as int, [damage type per entry]) from an Attack Values array.

    The array's own `</value>` cannot be used as a terminator: each `<entry>`
    inside it holds a `<value>N</value>` of its own, so a non-greedy match stops
    on the first child. `raw` is already exactly one argument's value, so the
    entries are simply scanned across the whole blob.
    """
    if not raw or "AttackValue;" not in raw:
        return None, []
    types = []
    first_value = None
    for ent in re.findall(r"<entry>(.*?)</entry>", raw, re.S):
        dt = DAMAGE_TYPE_RE.search(ent)
        # No <damageType> on an AttackValue means plain normal damage.
        types.append(
            DAMAGE_TYPE_NAMES.get(dt.group(1), dt.group(1).title()) if dt else "Normal"
        )
        if first_value is None:
            v = re.search(r"<value>(-?\d+)</value>", ent)
            if v:
                first_value = int(v.group(1))
    return first_value, types


def extract_status(raw: str):
    """(status, power, chance) from a Status Values array.

    Scanned across the whole argument blob for the same reason as
    extract_attack_values: the array's children carry their own closing tags.
    """
    if not raw or "StatusValue;" not in raw:
        return None, None, None
    for ent in re.findall(r"<entry>(.*?)</entry>", raw, re.S):
        f = re.search(r"<flags>(\d+)</flags>", ent)
        if not f:
            continue
        status = STATUS_FLAGS.get(int(f.group(1)))
        if not status:
            continue
        p = re.search(r"<power>(\w+)</power>", ent)
        c = re.search(r"<chance>(\w+)</chance>", ent)
        return status, (p.group(1) if p else None), (c.group(1) if c else None)
    return None, None, None


def mine_weapon(entries, attack_entries, name: str):
    chain = resolve_chain(entries, name)
    r = Resolver(chain)
    weapon_class = name.split("/")[1]

    # --- damage + attack value -------------------------------------------
    attack_raw = r.arg("Attack Values", "attack_value")
    attack_value, types = extract_attack_values(attack_raw)
    if attack_value is None and "attack_value" in r.inherited:
        r.inherited.remove("attack_value")

    damage_types = dedupe(types)
    damage_source_field = "damage_types"
    if not damage_types:
        # Fall back to the DamageConfig objects themselves.
        for key in ("Damage", "End Combo Damage", "Charged Attack"):
            raw = r.arg(key, damage_source_field)
            found = dedupe(damage_types_from_blob(raw))
            if found:
                damage_types = found
                break
        else:
            if damage_source_field in r.inherited:
                r.inherited.remove(damage_source_field)
    elif attack_raw is not None:
        # Record inheritance of the damage types alongside the attack values.
        for depth, entry in enumerate(chain):
            if "Attack Values" in entry.args:
                if depth > 0:
                    r._mark("damage_types")
                break

    if not damage_types:
        # Last resort: the original implementation's own attack blocks, and
        # then any attack config it references in attack.xml.
        original = chain[-1] if chain else None
        if original is not None:
            damage_types = dedupe(damage_types_from_blob(original.body))
            if damage_types:
                r._mark("damage_types")
            else:
                for ref in re.findall(r"<name>(Weapon/[^<]*)</name>", original.body):
                    att = attack_entries.get(ref)
                    if att:
                        found = dedupe(damage_types_from_blob(att))
                        if found:
                            damage_types = found
                            r._mark("damage_types")
                            break

    # --- status -----------------------------------------------------------
    status_raw = r.arg("Status Values", "status")
    status, power, chance = extract_status(status_raw)
    if status is None and "status" in r.inherited:
        r.inherited.remove("status")
    if status is None:
        # Some weapons express the rider only as a DamageConfig$Status with a
        # named condition ("Fire 3"), with power/chance as nested arguments.
        for key in ("Damage", "End Combo Damage", "Charged Attack"):
            raw = r.arg(key)
            found = status_from_condition_names(raw)
            if found:
                status = found
                p = NESTED_STATUS_POWER_RE.search(raw)
                c = NESTED_STATUS_CHANCE_RE.search(raw)
                power = p.group(1) if p else None
                chance = c.group(1) if c else None
                break
    if status is not None:
        # XMLImporter omits any field sitting at its Java default, so a
        # StatusValue often carries <chance> but no <power>. The real value is
        # then only in the `Status Power` / `Status Chance` arguments nested
        # inside the status condition reference. Weapon first, then its bases.
        if power is None:
            power = r.chain_search(NESTED_STATUS_POWER_RE)
        if chance is None:
            chance = r.chain_search(NESTED_STATUS_CHANCE_RE)

    # --- timings ----------------------------------------------------------
    charge_time = value_int(r.arg("Charge Time", "charge_time_ms"))
    if charge_time is None:
        if "charge_time_ms" in r.inherited:
            r.inherited.remove("charge_time_ms")
        text = r.impl_scalar(CHARGE_TIME_IMPL_RE, "charge_time_ms")
        charge_time = int(text) if text and text.lstrip("-").isdigit() else None

    def impl_number(pattern, field, cast):
        text = r.impl_scalar(pattern, field)
        if text is None:
            return None
        try:
            return cast(text)
        except ValueError:
            return None

    attacking_speed = impl_number(ATTACKING_SPEED_IMPL_RE, "attacking_speed", float)
    charging_speed = impl_number(CHARGING_SPEED_IMPL_RE, "charging_speed", float)
    max_chain = impl_number(MAX_CHAIN_IMPL_RE, "max_chain", int)

    # --- presentation -----------------------------------------------------
    model_raw = r.arg("Model", "model_path")
    model_path, model_args = config_reference(model_raw)
    if model_path is None:
        if "model_path" in r.inherited:
            r.inherited.remove("model_path")
        model_path = r.impl_scalar(MODEL_IMPL_RE, "model_path")
        model_args = {}
    # The dump spells this key both ways depending on who authored the base.
    model_variant = model_args.get("Variant") or model_args.get("variant") or None

    icon_path = value_text(r.arg("Icon", "icon_path"))
    if icon_path is None:
        if "icon_path" in r.inherited:
            r.inherited.remove("icon_path")
        icon_path = r.impl_scalar(ICON_IMPL_RE, "icon_path")

    star_rating = value_int(r.arg("Rarity", "star_rating"))
    if star_rating is None:
        if "star_rating" in r.inherited:
            r.inherited.remove("star_rating")
        text = r.impl_scalar(RARITY_IMPL_RE, "star_rating")
        star_rating = int(text) if text and text.lstrip("-").isdigit() else None

    return OrderedDict([
        ("config_name", name),
        ("display_name", name.split("/")[-1]),
        ("weapon_class", weapon_class),
        ("base_item", chain[0].base if chain else None),
        ("damage_types", damage_types),
        ("status", status),
        ("status_power", power),
        ("status_chance", chance),
        ("attack_value", attack_value),
        ("charge_time_ms", charge_time),
        ("attacking_speed", attacking_speed),
        ("charging_speed", charging_speed),
        ("max_chain", max_chain),
        ("model_path", model_path),
        ("model_variant", model_variant),
        ("icon_path", icon_path),
        ("star_rating", star_rating),
        ("inherited_from_base", sorted(r.inherited)),
    ])


# --------------------------------------------------------------------------
# Selection
# --------------------------------------------------------------------------

def is_real_weapon(entry: Entry) -> bool:
    name = entry.name
    parts = name.split("/")
    if len(parts) < 3 or parts[0] != "Weapon":
        return False
    if parts[1] not in WEAPON_CLASSES:
        return False
    # Shared bases, not items anyone can hold.
    if "Parts" in parts:
        return False
    # PvP loadout stand-ins.
    if any(p == "PvP" or "PvP" in p for p in parts):
        return False
    if entry.creatable == "false":
        return False
    return True


# --------------------------------------------------------------------------
# Upgrade lines
# --------------------------------------------------------------------------

RECIPE_XML = os.path.join(CONFIG_REFS, "recipe.xml")


def load_upgrade_parents(path: str):
    """{weapon config name: the weapon it is upgraded from} out of the game's recipes.

    An upgrade recipe is a `RecipeConfig` whose output `<item>` is a weapon and
    whose ingredients include a `IngredientConfig$LevelItem`: the previous weapon
    in the line, at heat level 5. Every other ingredient is a crafting material,
    which this project does not use. No recipe in the dump has two such parents,
    so a line is a tree and each weapon has at most one parent. Recipes with no
    LevelItem are the lines' first rungs, bought outright in the original.

    recipe.xml is small next to item.xml, so this one is simply parsed.
    """
    import xml.etree.ElementTree as ET

    parents = {}
    if not os.path.isfile(path):
        return parents
    root = ET.parse(path).getroot()
    for entry in root.iter("entry"):
        impl = entry.find("implementation")
        if impl is None or "RecipeConfig" not in (impl.get("class") or ""):
            continue
        output = impl.find("item/name")
        if output is None or not (output.text or "").startswith("Weapon/"):
            continue
        for ingredient in impl.findall("ingredients/entry"):
            if "LevelItem" not in (ingredient.get("class") or ""):
                continue
            parent = ingredient.find("item/name")
            if parent is not None and (parent.text or "").startswith("Weapon/"):
                parents.setdefault(output.text, parent.text)
    return parents


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> int:
    for path in (ITEM_XML, ATTACK_XML):
        if not os.path.isfile(path):
            sys.stderr.write("missing input: %s\n" % path)
            return 1

    entries, order = load_entries(ITEM_XML)

    # attack.xml is only consulted for weapons whose damage type is nowhere in
    # item.xml, so keep it as raw bodies rather than parsing it properly. On the
    # current dump nothing reaches this far, but it is cheap insurance against a
    # future weapon that types itself only in its attack config.
    attack_entries = {}
    with open(ATTACK_XML, encoding="utf-8") as fh:
        attack_text = fh.read()
    for body in ENTRY_RE.findall(attack_text):
        m = ENTRY_NAME_RE.search(body)
        if m and m.group(1) not in attack_entries:
            attack_entries[m.group(1)] = body

    weapons = []
    for name in order:
        entry = entries[name]
        if not name.startswith("Weapon/"):
            continue
        if not is_real_weapon(entry):
            continue
        weapons.append(mine_weapon(entries, attack_entries, name))

    # Upgrade lines, from the game's recipes. Only used to lay the loadout screen out as trees.
    parents = load_upgrade_parents(RECIPE_XML)
    for weapon in weapons:
        weapon["upgrades_from"] = parents.get(weapon["config_name"])

    weapons.sort(key=lambda w: (w["weapon_class"], w["config_name"]))

    with open(OUT_JSON, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(weapons, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    # ---- summary ---------------------------------------------------------
    by_class = Counter(w["weapon_class"] for w in weapons)
    by_damage = Counter(t for w in weapons for t in w["damage_types"])
    by_status = Counter(w["status"] for w in weapons if w["status"])
    no_damage = [w["config_name"] for w in weapons if not w["damage_types"]]
    no_model = [w["config_name"] for w in weapons if not w["model_path"]]

    print("wrote %s" % OUT_JSON)
    print("total weapons: %d" % len(weapons))
    print("\nby class:")
    for k in sorted(by_class):
        print("  %-10s %d" % (k, by_class[k]))
    print("\nby damage type:")
    for k, v in by_damage.most_common():
        print("  %-10s %d" % (k, v))
    print("\nwith a status: %d" % sum(by_status.values()))
    for k, v in by_status.most_common():
        print("  %-10s %d" % (k, v))
    print("\nweapons with no damage type resolved: %d" % len(no_damage))
    for n in no_damage:
        print("  %s" % n)
    print("\nweapons with no model path resolved: %d" % len(no_model))
    for n in no_model:
        print("  %s" % n)

    # Caveat worth surfacing: a weapon that deals two damage types has one
    # Attack Values entry per type, but `attack_value` is a single number, so it
    # only reports the first. The per-type split is visible in `damage_types`.
    split = [w for w in weapons if len(w["damage_types"]) > 1]
    print("\nweapons dealing more than one damage type "
          "(attack_value reports the first entry only): %d" % len(split))
    for w in split:
        print("  %-46s %s" % (w["config_name"], "+".join(w["damage_types"])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
