#!/usr/bin/env python3
"""Mine the Spiral Knights knight gear (shields, helms, armour, trinkets) out of
the game's config dumps.

Reads (read-only):
    <ConfigRefs>/item.xml              the item catalogue
    <ConfigRefs>/depth_scale.xml       defense and shield-health curves (depth, star)
    <ConfigRefs>/level_table.xml       per-level (heat) bonuses
    <ConfigRefs>/item_property.xml     which level table each slot and star uses
    <ConfigRefs>/recipe.xml            upgrade parents
    <ConfigRefs>/status_condition.xml  status flag bits (cross-checked with mine_weapons)
    <ConfigRefs>/fire_action.xml       the shield push-back's knock-back options
    <ConfigRefs>/accessory.xml         accessory models (cosmetics summary only)
    <ConfigRefs>/battle_sprite.xml     battle sprites (cosmetics summary only)
    <Spiral Knights>/code/projectx-config.jar   rsrc/i18n item names (optional;
                                               without it names come from paths)
    <Spiral Knights>/rsrc              only checked for model file existence

Writes:
    gear.json        next to this script: real gear items, level tables, what was
                     excluded and why, and a cosmetics summary
    gear_models.txt  every distinct model .dat the real gear references, by slot

Nothing here mutates the inputs. Re-running overwrites the two outputs only.

------------------------------------------------------------------------------
How the gear configs are shaped (learned by reading the dumps):

* A slot's items are entries whose chain ends in `ItemConfig$Shield`, `$Helm`,
  `$Armor` or `$Trinket`. Most are written out in full; the recolour starters,
  Pathfinder/Sentinel/Shade, Node Slime and Teddy Bear Tech lines are
  `ItemConfig$Derived` over a `.../Parts/...` base.

* Unlike weapons, gear bases do not just take flat arguments: a base declares
  `<parameters>` whose `<paths>` patch nested fields
  (`implementation.item["Defenses"][1].type`,
  `implementation.defense.defenses[1].defenses`), and `Parameter$Choice`
  parameters pick an option that patches several paths at once. So this script
  parses with ElementTree and instantiates configs by applying those paths to a
  copy of the implementation, rather than using mine_weapons' regex slicing.

* Defense is a `DefenseConfig`: `DepthScale` (a depth_scale.xml curve, `<type>`
  absent = NORMAL), fixed `Normal`/`Piercing`/`Elemental`/`Shadow` amounts,
  `StatusResist` (`conditionMask` bitmask + `resist`), `Compound`, and on one
  trinket `Conditional` + `DepthNormal`.

* Every gear curve funnels into `PC/Defense/Base/Default` = `Base/Rarity Capper`:
  the item's star rating picks a `Star N` curve and caps the depth it is read at
  (0-5 stars: depth 3, 7, 12, 17, 30, 30). `Star N` is `Base/Tier Segmented`,
  a `SegmentedEntry` of (depth, value) points. Values here are evaluated at
  DEPTH_SAMPLES; the depth-30 column is the item's ceiling.

* Heat levels come from item_property.xml (per slot, per star) -> level_table.xml:
  armour and helms gain defense and health per level, shields defense only,
  trinkets nothing.

* XMLImporter omits fields at their Java default, so a modifier often carries a
  bonus label (LOW/MEDIUM/HIGH...) and no number. Those numbers are not in the
  dump; `value_inferred` fills them from the most common explicit number for the
  same modifier kind and label, and says so.
"""

from __future__ import annotations

import copy
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, OrderedDict, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mine_weapons as mw  # noqa: E402  (constants and status bits only)

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

CONFIG_REFS = mw.CONFIG_REFS
ITEM_XML = mw.ITEM_XML
RECIPE_XML = mw.RECIPE_XML
DEPTH_SCALE_XML = os.path.join(CONFIG_REFS, "depth_scale.xml")
LEVEL_TABLE_XML = os.path.join(CONFIG_REFS, "level_table.xml")
ITEM_PROPERTY_XML = os.path.join(CONFIG_REFS, "item_property.xml")
STATUS_CONDITION_XML = os.path.join(CONFIG_REFS, "status_condition.xml")
FIRE_ACTION_XML = os.path.join(CONFIG_REFS, "fire_action.xml")
ACCESSORY_XML = os.path.join(CONFIG_REFS, "accessory.xml")
BATTLE_SPRITE_XML = os.path.join(CONFIG_REFS, "battle_sprite.xml")

GAME_DIR = r"C:\Program Files (x86)\Steam\steamapps\common\Spiral Knights"
CONFIG_JAR = os.path.join(GAME_DIR, "code", "projectx-config.jar")
RSRC_DIR = os.path.join(GAME_DIR, "rsrc")
# Later bundles only fill keys the earlier ones lack.
MESSAGE_BUNDLES = (
    "rsrc/i18n/item.properties",
    "rsrc/i18n/item-names.properties",
    "rsrc/i18n/global.properties",
)

OUT_JSON = os.path.join(HERE, "gear.json")
OUT_MODELS = os.path.join(HERE, "gear_models.txt")

# Path segment under Gear/ -> the ItemConfig class a real item of that slot has.
SLOTS = ("Shield", "Helm", "Armor", "Trinket")

DEPTH_SAMPLES = (1, 3, 7, 12, 17, 23, 30)
DAMAGE_TYPES = ("Normal", "Piercing", "Elemental", "Shadow")

MAX_CHAIN_DEPTH = 12

# The one numeric field each modifier kind carries, for value inference.
MODIFIER_VALUE_FIELD = {
    "RelativeDamageBonus": "damage",
    "TaggedDamageBonus": "damage",
    "AttackSpeedChange": "speed",
    "SpeedChange": "speed",
    "ChargeTimeReduction": "reduction",
    "HealthBonus": "health",
    "DefenseIncrease": "defense",
}

# Implementation fields read explicitly; anything else lands in extra_fields.
KNOWN_IMPL_FIELDS = {
    "icon", "name", "flavor", "rarity", "itemProp", "model", "backModel",
    "defense", "globalModifier", "tags", "autoSpawnType", "accessoryBlockers",
    "healthScale", "regenTime", "hitTime", "breakTime", "defendingSpeed",
    "actionDelay", "actionInterval", "action", "bash", "effect", "breakEffect",
}

MODEL_TAGS = {"model", "backModel", "tier1", "tier2", "tier3"}

# --------------------------------------------------------------------------
# Generic config engine
# --------------------------------------------------------------------------

INT_RE = re.compile(r"^-?\d+$")
FLOAT_RE = re.compile(r"^-?\d+\.\d*(?:[eE]-?\d+)?$")
PATH_TOKEN_RE = re.compile(r'\.?([A-Za-z_]\w*)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]')
PATH_SPLIT_RE = re.compile(r'(?:[^,"]|"[^"]*")+')


class Unresolved(Exception):
    pass


def short_class(elem):
    """`DepthScale` for `...DefenseConfig$DepthScale`; None if no class."""
    if elem is None:
        return None
    cls = elem.get("class")
    return cls.rsplit("$", 1)[-1] if cls else None


def camel(ident: str) -> str:
    """Parameter paths use Java field names in snake case; the dump camel case."""
    head, *rest = ident.split("_")
    return head + "".join(p[:1].upper() + p[1:] for p in rest)


def split_paths(text):
    if not text:
        return []
    return [p.strip() for p in PATH_SPLIT_RE.findall(text) if p.strip()]


def parse_arguments(ref) -> "OrderedDict[str, ET.Element]":
    """{key: <value> element} of a ConfigReference's `<arguments>` map."""
    args: "OrderedDict[str, ET.Element]" = OrderedDict()
    if ref is None:
        return args
    block = ref.find("arguments")
    if block is None:
        return args
    key = None
    for child in block:
        if child.tag == "key":
            key = child.text or ""
        elif child.tag == "value" and key is not None:
            args.setdefault(key, child)
            key = None
    return args


def argument_slot(elem, key, create):
    """The `<value>` for `key` in `elem`'s arguments map, optionally created."""
    block = elem.find("arguments")
    if block is None:
        if not create:
            return None
        block = ET.SubElement(elem, "arguments")
    children = list(block)
    for i, child in enumerate(children):
        if (child.tag == "key" and (child.text or "") == key
                and i + 1 < len(children) and children[i + 1].tag == "value"):
            return children[i + 1]
    if not create:
        return None
    k = ET.SubElement(block, "key", {"class": "java.lang.String"})
    k.text = key
    return ET.SubElement(block, "value")


def locate(holder, path, create):
    """Element addressed by a parameter path, starting at `implementation`."""
    cur = holder
    for ident, index, key in PATH_TOKEN_RE.findall(path):
        if cur is None:
            return None
        if ident:
            nxt = cur.find(camel(ident))
            if nxt is None and create:
                nxt = ET.SubElement(cur, camel(ident))
        elif index:
            entries = [c for c in cur if c.tag == "entry"]
            i = int(index)
            while create and len(entries) <= i:
                entries.append(ET.SubElement(cur, "entry"))
            nxt = entries[i] if i < len(entries) else None
        else:
            nxt = argument_slot(cur, key, create)
        cur = nxt
    return cur


def assign(target, value):
    """Replace `target`'s class, text and children with `value`'s."""
    if target is value:
        return
    for child in list(target):
        target.remove(child)
    target.attrib.clear()
    target.text = None
    if value is None:
        return
    for k, v in value.attrib.items():
        target.set(k, v)
    target.text = value.text
    for child in value:
        target.append(copy.deepcopy(child))


def apply_parameters(entry, holder, args):
    """Apply `args` to the implementation copy in `holder` via entry parameters.

    Arguments with no matching parameter are ignored, as the engine does. A
    Choice parameter's argument names an option; that option's arguments are
    written through the choice's direct paths.
    """
    params = entry.find("parameters")
    if params is None or not args:
        return
    for param in params:
        pname = param.findtext("name")
        if pname not in args:
            continue
        value = args[pname]
        kind = short_class(param)
        if kind == "Direct":
            for path in split_paths(param.findtext("paths")):
                target = locate(holder, path, True)
                if target is not None:
                    assign(target, value)
        elif kind == "Choice":
            wanted = (value.text or "").strip()
            options = param.find("options")
            directs = param.find("directs")
            if options is None or directs is None:
                continue
            for option in options:
                if (option.findtext("name") or "") != wanted:
                    continue
                opt_args = parse_arguments(option)
                for direct in directs:
                    dname = direct.findtext("name")
                    if dname not in opt_args:
                        continue
                    for path in split_paths(direct.findtext("paths")):
                        target = locate(holder, path, True)
                        if target is not None:
                            assign(target, opt_args[dname])
                break


def reference_child(impl):
    """The ConfigReference a Derived implementation sits on (`<item>`,
    `<depthScale>`, `<table>` ... depending on the config type)."""
    for child in impl:
        if child.find("name") is not None:
            return child
    return None


class ConfigLibrary:
    """One XMLImporter dump, indexed by entry name."""

    def __init__(self, path):
        self.path = path
        root = ET.parse(path).getroot()
        container = root.find("object")
        self.entries: "OrderedDict[str, ET.Element]" = OrderedDict()
        for entry in container:
            name = entry.findtext("name")
            if name and name not in self.entries:
                self.entries[name] = entry

    def original_class(self, name):
        """Class of the non-derived implementation at the end of the chain."""
        seen = set()
        cur = name
        while cur in self.entries and cur not in seen:
            seen.add(cur)
            impl = self.entries[cur].find("implementation")
            if impl is None:
                return None
            if short_class(impl) != "Derived":
                return impl.get("class")
            ref = reference_child(impl)
            cur = (ref.findtext("name") or "").strip() if ref is not None else None
        return None

    def instantiate(self, name, args=None):
        """(original implementation with every argument applied, [chain names]).

        Walks Derived entries: each one's own parameters are applied to its copy
        first, so the arguments it passes down are already patched.
        """
        chain = []
        cur = name
        cur_args = args or {}
        while True:
            if (not cur or cur not in self.entries or cur in chain
                    or len(chain) >= MAX_CHAIN_DEPTH):
                return None, chain
            entry = self.entries[cur]
            chain.append(cur)
            source = entry.find("implementation")
            if source is None:
                return None, chain
            holder = ET.Element("config")
            holder.append(copy.deepcopy(source))
            apply_parameters(entry, holder, cur_args)
            impl = holder.find("implementation")
            if short_class(impl) != "Derived":
                return impl, chain
            ref = reference_child(impl)
            if ref is None:
                return None, chain
            cur = (ref.findtext("name") or "").strip() or None
            cur_args = parse_arguments(ref)


# --------------------------------------------------------------------------
# Element -> JSON
# --------------------------------------------------------------------------

def scalar(text, cls=None):
    if text is None:
        return None
    text = text.strip()
    if not text:
        return None
    try:
        if cls in ("java.lang.Integer", "java.lang.Long", "java.lang.Short", "java.lang.Byte"):
            return int(text)
        if cls in ("java.lang.Float", "java.lang.Double"):
            return float(text)
    except ValueError:
        return text
    if text in ("true", "false"):
        return text == "true"
    if INT_RE.match(text):
        return int(text)
    if FLOAT_RE.match(text):
        return float(text)
    return text


def to_json(elem):
    """Plain JSON view of a dump element (ConfigReferences as name + arguments)."""
    if elem is None:
        return None
    cls = elem.get("class") or ""
    children = list(elem)
    if cls.endswith("ColorizationConfig$Normal"):
        return scalar(elem.findtext("colorization"))
    if not children:
        if cls.startswith("["):
            return []
        return scalar(elem.text, cls or None)
    tags = {c.tag for c in children}
    if "name" in tags and tags <= {"name", "arguments"}:
        out = OrderedDict([("name", elem.findtext("name"))])
        args = parse_arguments(elem)
        if args:
            out["arguments"] = OrderedDict((k, to_json(v)) for k, v in args.items())
        return out
    if tags == {"entry"}:
        return [to_json(c) for c in children]
    out = OrderedDict()
    if cls and not cls.startswith("java.") and not cls.startswith("["):
        out["_class"] = cls.rsplit(".", 1)[-1]
    for child in children:
        val = to_json(child)
        if child.tag in out:
            if not isinstance(out[child.tag], list) or child.tag == "_class":
                out[child.tag] = [out[child.tag]]
            out[child.tag].append(val)
        else:
            out[child.tag] = val
    return out


def ref_json(elem):
    if elem is None or not (elem.findtext("name") or "").strip():
        return None
    return to_json(elem)


# --------------------------------------------------------------------------
# Messages
# --------------------------------------------------------------------------

def unescape_properties(s):
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            n = s[i + 1]
            if n == "u" and i + 6 <= len(s):
                try:
                    out.append(chr(int(s[i + 2:i + 6], 16)))
                    i += 6
                    continue
                except ValueError:
                    pass
            out.append({"n": "\n", "t": "\t", "r": "\r", "f": "\f"}.get(n, n))
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def parse_properties(text):
    table = {}
    pending = ""
    for raw in text.splitlines():
        line = pending + raw.lstrip() if pending else raw.lstrip()
        if not pending and (not line or line[0] in "#!"):
            continue
        tail = re.search(r"(\\+)$", line)
        if tail and len(tail.group(1)) % 2 == 1:
            pending = line[:-1]
            continue
        pending = ""
        m = re.match(r"((?:[^=:\s\\]|\\.)+)\s*[=:\s]\s*(.*)$", line)
        if m:
            table[unescape_properties(m.group(1))] = unescape_properties(m.group(2))
    return table


class Messages:
    def __init__(self, jar):
        self.table = {}
        self.source = None
        if not os.path.isfile(jar):
            return
        with zipfile.ZipFile(jar) as z:
            names = set(z.namelist())
            for bundle in reversed(MESSAGE_BUNDLES):
                if bundle not in names:
                    continue
                raw = z.read(bundle)
                try:
                    text = raw.decode("utf-8")
                except UnicodeDecodeError:
                    text = raw.decode("latin-1")
                self.table.update(parse_properties(text))
        self.source = jar

    def translate(self, key):
        """`m.cobalt_helm` -> Cobalt Helm; `a.rby|m.nodeslime_shield` formats
        the first key with the rest as {0}, {1} (a `~` arg is literal)."""
        if not key:
            return None
        # A handful of helms spell the whole key with the literal marker.
        parts = key.lstrip("~").split("|")
        args = []
        for p in parts[1:]:
            args.append(p[1:] if p.startswith("~") else self.table.get(p, p))
        fmt = self.table.get(parts[0])
        if fmt is None:
            if not args:
                return None
            fmt = " ".join("{%d}" % i for i in range(len(args)))
        if args:
            fmt = fmt.replace("''", "'")
            for i, a in enumerate(args):
                fmt = fmt.replace("{%d}" % i, a)
        return fmt


# --------------------------------------------------------------------------
# Depth scales
# --------------------------------------------------------------------------

def child_float(node, tag, default=None):
    text = node.findtext(tag) if node is not None else None
    if text is None or not text.strip():
        if default is None:
            raise Unresolved("missing <%s>" % tag)
        return default
    return float(text)


class DepthScales:
    """Evaluates DepthScaleConfig references at a depth and star rating.

    Assumptions (the engine code is not in the dump): SegmentedEntry is linear
    between its points and flat past the ends; Rarity picks the entry at the
    star rating; DepthCap reads its scale at min(depth, cap); ModifyDamage is a
    plain multiplier; Difficulty is read at medium.
    """

    def __init__(self, lib: ConfigLibrary):
        self.lib = lib
        self._impls = {}

    def _impl(self, ref):
        name = (ref.findtext("name") or "").strip()
        if not name:
            raise Unresolved("empty depth scale reference")
        block = ref.find("arguments")
        key = (name, ET.tostring(block) if block is not None else b"")
        if key not in self._impls:
            impl, _ = self.lib.instantiate(name, parse_arguments(ref))
            self._impls[key] = impl
        impl = self._impls[key]
        if impl is None:
            raise Unresolved("depth scale not found: %s" % name)
        return impl

    def value(self, ref, depth, rarity):
        if ref is None:
            raise Unresolved("no depth scale")
        return self._node(self._impl(ref).find("root"), depth, rarity)

    def _node(self, node, depth, rarity):
        kind = short_class(node)
        if kind == "Constant":
            return child_float(node, "value", 0.0)
        if kind == "Adder":
            return self.value(node.find("scale"), depth, rarity) + child_float(node, "add", 0.0)
        if kind in ("Multiplier", "ModifyDamage"):
            return self.value(node.find("scale"), depth, rarity) * child_float(node, "multiplier")
        if kind == "DepthCap":
            cap = child_float(node, "cap")
            return self.value(node.find("scale"), min(depth, cap), rarity)
        if kind == "MinValue":
            return max(self.value(node.find("scale"), depth, rarity), child_float(node, "min"))
        if kind == "Rarity":
            entries = list(node.find("depthScales")) if node.find("depthScales") is not None else []
            if not entries:
                raise Unresolved("Rarity with no entries")
            pick = entries[max(0, min(rarity, len(entries) - 1))]
            return self.value(pick.find("depthScale"), depth, rarity)
        if kind == "SegmentedEntry":
            segs = node.find("segments")
            points = sorted(
                (float(e.findtext("depth") or 0), float(e.findtext("value") or 0))
                for e in (segs if segs is not None else [])
            )
            if not points:
                raise Unresolved("SegmentedEntry with no points")
            if depth <= points[0][0]:
                return points[0][1]
            for (d0, v0), (d1, v1) in zip(points, points[1:]):
                if d0 <= depth <= d1:
                    return v1 if d1 == d0 else v0 + (v1 - v0) * (depth - d0) / (d1 - d0)
            return points[-1][1]
        if kind == "Difficulty":
            return self.value(node.find("medium"), depth, rarity)
        raise Unresolved("depth scale node %s" % kind)

    def curve(self, ref, rarity):
        return OrderedDict((str(d), round(self.value(ref, d, rarity), 2)) for d in DEPTH_SAMPLES)


# --------------------------------------------------------------------------
# Status bits
# --------------------------------------------------------------------------

def load_status_bits(lib: ConfigLibrary):
    """{bit: status} read from status_condition.xml, mine_weapons as fallback."""
    bits = dict(mw.STATUS_FLAGS)
    for word, name in (("Stun", "Stun"), ("Poison", "Base/Poison"), ("Fire", "Base/Fire"),
                       ("Freeze", "Base/Freeze"), ("Shock", "Base/Shock"),
                       ("Curse", "Base/Curse"), ("Sleep", "Base/Sleep")):
        impl, _ = lib.instantiate(name)
        flags = scalar(impl.findtext("flags")) if impl is not None else None
        if isinstance(flags, int):
            for bit in [b for b, w in bits.items() if w == word]:
                del bits[bit]
            bits[flags] = word
    return dict(sorted(bits.items()))


def mask_statuses(mask, bits):
    if not isinstance(mask, int):
        return [], None
    names = [w for b, w in bits.items() if mask & b]
    other = mask & ~sum(bits)
    return names, (other or None)


# --------------------------------------------------------------------------
# Item pieces
# --------------------------------------------------------------------------

def parse_defense(elem, out):
    kind = short_class(elem)
    if elem is None or kind is None:
        return
    if kind == "Compound":
        defs = elem.find("defenses")
        for e in (defs if defs is not None else []):
            parse_defense(e, out)
    elif kind == "DepthScale":
        t = elem.findtext("type")
        out.append({"kind": "DepthScale",
                    "type": mw.DAMAGE_TYPE_NAMES.get(t, t.title()) if t else "Normal",
                    "scale": elem.find("depthScale")})
    elif kind in DAMAGE_TYPES:
        out.append({"kind": "Fixed", "type": kind, "amount": scalar(elem.findtext("amount"))})
    elif kind == "StatusResist":
        out.append({"kind": "StatusResist", "mask": scalar(elem.findtext("conditionMask")),
                    "resist": scalar(elem.findtext("resist"))})
    elif kind == "Conditional":
        nested = []
        parse_defense(elem.find("defense"), nested)
        out.append({"kind": "Conditional", "condition": to_json(elem.find("condition")),
                    "defense": nested})
    else:
        out.append({"kind": kind, "raw": to_json(elem)})


def resolve_defense(components, scales, rarity, bits, problems):
    by_type = OrderedDict()
    resists, other = [], []

    def slot_for(t):
        if t not in by_type:
            by_type[t] = OrderedDict([
                ("sources", []),
                ("at_depth", OrderedDict((str(d), 0.0) for d in DEPTH_SAMPLES)),
            ])
        return by_type[t]

    for c in components:
        if c["kind"] == "DepthScale":
            slot = slot_for(c["type"])
            src = ref_json(c["scale"])
            slot["sources"].append(src["name"] if src and "arguments" not in src else src)
            try:
                for d, v in scales.curve(c["scale"], rarity).items():
                    slot["at_depth"][d] += v
            except Unresolved as e:
                problems.append("defense %s: %s" % (c["type"], e))
                slot["unresolved"] = True
        elif c["kind"] == "Fixed":
            slot = slot_for(c["type"])
            slot["sources"].append("fixed %s" % c["amount"])
            for d in slot["at_depth"]:
                slot["at_depth"][d] += c["amount"] or 0
        elif c["kind"] == "StatusResist":
            names, extra = mask_statuses(c["mask"], bits)
            entry = OrderedDict([("mask", c["mask"]), ("statuses", names), ("resist", c["resist"])])
            if extra:
                entry["other_bits"] = extra
            resists.append(entry)
        else:
            if c["kind"] == "Conditional":
                c = dict(c, defense=[
                    {k: (ref_json(v) if k == "scale" else v) for k, v in n.items()}
                    for n in c["defense"]])
            other.append(c)
    for slot in by_type.values():
        for d in slot["at_depth"]:
            slot["at_depth"][d] = round(slot["at_depth"][d], 2)
        slot["max"] = slot["at_depth"][str(DEPTH_SAMPLES[-1])]
    ordered = OrderedDict((t, by_type[t]) for t in DAMAGE_TYPES if t in by_type)
    ordered.update((t, v) for t, v in by_type.items() if t not in ordered)
    return ordered, resists, other


def flatten_modifier(elem, weapon_class=None, under_weapon_class=False):
    """LevelConfig tree -> flat list of {kind, weapon_class, bonus, value fields}."""
    kind = short_class(elem)
    if elem is None or kind in (None, "Empty"):
        return []
    if kind == "Compound":
        levels = elem.find("levels")
        out = []
        for e in (levels if levels is not None else []):
            out.extend(flatten_modifier(e, weapon_class, under_weapon_class))
        return out
    if kind == "WeaponClass":
        return flatten_modifier(elem.find("level"), elem.findtext("weaponClass"), True)
    mod = OrderedDict([("kind", kind)])
    if under_weapon_class:
        # Absent = the enum default. Sword Focus Module carries none while the
        # Handgun and Bomb Focus Modules name theirs, and of the Padded Armor /
        # Demo / Hunting trio only Hunting is unnamed, so the default is SWORD.
        mod["weapon_class"] = weapon_class or "SWORD"
        if not weapon_class:
            mod["weapon_class_implicit"] = True
    for child in elem:
        if child.tag in ("level", "levels"):
            continue
        key = re.sub(r"(?<!^)([A-Z])", r"_\1", child.tag).lower()
        mod[key] = to_json(child)
    return mod and [mod]


def model_info(elem, rsrc_ok):
    name = (elem.findtext("name") or "").strip() if elem is not None else ""
    if not name:
        return None
    args = OrderedDict((k, to_json(v)) for k, v in parse_arguments(elem).items())
    out = OrderedDict([
        ("path", name),
        ("variant", args.get("Variant", args.get("variant"))),
        ("colorization", args.get("Colorization")),
        ("arguments", args),
    ])
    if rsrc_ok:
        out["in_install"] = os.path.isfile(os.path.join(RSRC_DIR, *name.split("/")))
    return out


def icon_info(elem):
    if elem is None:
        return None
    cols = elem.find("colorizations")
    return OrderedDict([
        ("file", (elem.findtext("file") or "").strip() or None),
        ("colorizations", [to_json(c) for c in cols] if cols is not None else []),
    ])


def int_field(impl, tag):
    return scalar(impl.findtext(tag)) if impl.find(tag) is not None else None


def shield_action(action, fire_lib):
    if action is None:
        return None
    out = OrderedDict([("kind", short_class(action))])
    fa = action.find("fireAction")
    if fa is None or not (fa.findtext("name") or "").strip():
        out["fire_action"] = None
        return out
    out["fire_action"] = fa.findtext("name")
    out["arguments"] = OrderedDict((k, to_json(v)) for k, v in parse_arguments(fa).items())
    impl, _ = fire_lib.instantiate(fa.findtext("name"), parse_arguments(fa))
    if impl is not None:
        holder = ET.Element("config")
        holder.append(impl)
        kb = locate(holder, "implementation.action.action.action.actions[1].impulse_dealt", False)
        out["knockback_impulse"] = to_json(kb)
    return out


# --------------------------------------------------------------------------
# Selection
# --------------------------------------------------------------------------

def exclusion_reason(lib, name, cls):
    """None for a real knight gear item, else why it is left out."""
    parts = name.split("/")
    last = parts[-1]
    kind = cls.rsplit("$", 1)[-1]
    if "Bogus" in name:
        return "bogus placeholder (%s class)" % kind
    if parts[0] != "Gear":
        if "Game Master" in name:
            return "Game Master costume (%s class, not a player item)" % kind
        return "%s class outside Gear/" % kind
    if len(parts) > 1 and parts[1] == "PvP":
        return "PvP Lockdown class kit (LockdownShield)"
    if len(parts) < 3 or parts[1] not in SLOTS or kind != parts[1]:
        return "class %s does not match slot folder" % kind
    if "Parts" in parts:
        return "shared base (Parts), not an item"
    if "(Dev)" in name:
        return "developer item (Dev)"
    if "(TEST)" in name or "Test" in parts:
        return "test item"
    if "Bogus" in name:
        return "bogus placeholder"
    # Underscore-prefixed items have no recipe and nothing references them, so they read as
    # unreleased; the user chose to include them (2026-09-15). They are tagged "unreleased".
    if last.startswith("_"):
        return None
    creatable = lib.entries[name].findtext("creatable")
    if (creatable or "").strip() != "true":
        return "not creatable"
    return None


def load_gear_upgrade_parents(path):
    """{gear config name: [items it is upgraded from]}, as mine_weapons does for
    weapons: the recipe's `IngredientConfig$LevelItem` ingredients."""
    parents = defaultdict(list)
    if not os.path.isfile(path):
        return parents
    root = ET.parse(path).getroot()
    for entry in root.iter("entry"):
        impl = entry.find("implementation")
        if impl is None or "RecipeConfig" not in (impl.get("class") or ""):
            continue
        output = impl.find("item/name")
        if output is None or not (output.text or "").startswith("Gear/"):
            continue
        for ingredient in impl.findall("ingredients/entry"):
            if "LevelItem" not in (ingredient.get("class") or ""):
                continue
            parent = ingredient.find("item/name")
            if parent is not None and (parent.text or "").startswith("Gear/"):
                if parent.text not in parents[output.text]:
                    parents[output.text].append(parent.text)
    return parents


VARIANT_SUFFIX_RE = re.compile(r"^(.*?)(?:,\s*([^,]+)|\s*\(([^)]*)\)|\s+(\d+))$")


def split_variant(label):
    m = VARIANT_SUFFIX_RE.match(label)
    if not m:
        return label, None
    return m.group(1).strip(), next((g for g in m.groups()[1:] if g), None)


# --------------------------------------------------------------------------
# Per-item extraction
# --------------------------------------------------------------------------

def mine_item(ctx, name):
    lib, msgs, scales, bits = ctx["items"], ctx["messages"], ctx["scales"], ctx["bits"]
    impl, chain = lib.instantiate(name)
    slot = name.split("/")[1]
    problems = []

    rarity_given = impl.find("rarity") is not None
    rarity = scalar(impl.findtext("rarity")) if rarity_given else 0

    name_key = (impl.findtext("name") or "").strip() or None
    display = msgs.translate(name_key)
    flavor_key = (impl.findtext("flavor") or "").strip() or None

    components = []
    parse_defense(impl.find("defense"), components)
    defense, resists, defense_other = resolve_defense(components, scales, rarity, bits, problems)

    modifiers = flatten_modifier(impl.find("globalModifier"))

    prop_name = impl.findtext("itemProp/name")
    level = None
    prop = ctx["item_props"].get(prop_name)
    if prop:
        row = prop[max(0, min(rarity, len(prop) - 1))]
        level = OrderedDict([("item_property", prop_name)] + list(row.items()))

    model = model_info(impl.find("model"), ctx["rsrc_ok"])

    item = OrderedDict([
        ("config_name", name),
        ("display_name", display or name.split("/")[-1]),
        ("display_name_key", name_key),
        ("display_name_source", "bundle" if display else "path"),
        ("flavor", msgs.translate(flavor_key)),
        ("slot", slot),
        ("star_rating", rarity),
        ("star_rating_explicit", rarity_given),
        ("base_config", chain[1] if len(chain) > 1 else None),
        ("config_chain", chain),
        ("set", None),
        ("line", None),
        ("upgrades_from", ctx["parents"].get(name) or []),
        ("icon", icon_info(impl.find("icon"))),
        ("model", model),
        ("model_family", model["path"].rsplit("/", 1)[0] if model else None),
        ("defense", defense),
        ("defense_max_total", round(sum(v["max"] for v in defense.values()), 2)),
        ("status_resist", resists),
        ("defense_other", defense_other),
        ("modifiers", modifiers),
        ("level", level),
        ("tags", [t.strip() for t in (impl.findtext("tags/tags") or "").split(",") if t.strip()]
                 + (["unreleased"] if name.split("/")[-1].startswith("_") else [])),
        ("accessory_blockers", [e.text for e in impl.findall("accessoryBlockers/entry")]),
        ("auto_spawn_type", impl.findtext("autoSpawnType")),
        ("shield", None),
    ])

    if slot == "Shield":
        health = None
        hs = impl.find("healthScale")
        if hs is not None:
            try:
                curve = scales.curve(hs, rarity)
                health = OrderedDict([("source", ref_json(hs)), ("at_depth", curve),
                                      ("max", curve[str(DEPTH_SAMPLES[-1])])])
            except Unresolved as e:
                problems.append("health: %s" % e)
                health = OrderedDict([("source", ref_json(hs)), ("unresolved", True)])
        item["shield"] = OrderedDict([
            ("health", health),
            ("regen_time_ms", int_field(impl, "regenTime")),
            ("hit_time_ms", int_field(impl, "hitTime")),
            ("break_time_ms", int_field(impl, "breakTime")),
            ("defending_speed", int_field(impl, "defendingSpeed")),
            ("action_delay_ms", int_field(impl, "actionDelay")),
            ("action_interval_ms", int_field(impl, "actionInterval")),
            ("action", shield_action(impl.find("action"), ctx["fire_actions"])),
            ("bash", (impl.findtext("bash/name") or "").strip() or None),
            ("effect", ref_json(impl.find("effect"))),
            ("break_effect", ref_json(impl.find("breakEffect"))),
            ("back_model", model_info(impl.find("backModel"), ctx["rsrc_ok"])),
        ])

    extra = OrderedDict((c.tag, to_json(c)) for c in impl if c.tag not in KNOWN_IMPL_FIELDS)
    item["extra_fields"] = extra
    item["unresolved"] = problems
    return item


def load_item_properties(lib):
    """{item property name: [per-star {level_table, base_heat, max_heat}]}."""
    out = {}
    for name in lib.entries:
        impl, _ = lib.instantiate(name)
        if impl is None or short_class(impl) != "Level":
            continue
        rows = []
        for e in (impl.find("itemProps") if impl.find("itemProps") is not None else []):
            rows.append(OrderedDict([
                ("level_table", (e.findtext("levelTable/name") or "").strip() or None),
                ("base_heat", scalar(e.findtext("baseHeat"))),
                ("max_heat", scalar(e.findtext("maxHeat"))),
            ]))
        out[name] = rows
    return out


def resolve_level_table(lib, name, args=None, depth=0):
    """[[LevelConfig element, ...] per level] through Derived and Compound tables."""
    impl, _ = lib.instantiate(name, args)
    kind = short_class(impl)
    if impl is None or depth > MAX_CHAIN_DEPTH:
        return []
    if kind == "Levels":
        levels = impl.find("levels")
        return [[e] for e in levels] if levels is not None else []
    if kind == "Compound":
        merged = []
        tables = impl.find("tables")
        for t in (tables if tables is not None else []):
            ref = t.find("table")
            if ref is None:
                continue
            sub = resolve_level_table(lib, ref.findtext("name"), parse_arguments(ref), depth + 1)
            for i, lv in enumerate(sub):
                while len(merged) <= i:
                    merged.append([])
                merged[i].extend(lv)
        return merged
    return []


# --------------------------------------------------------------------------
# Cosmetics summary
# --------------------------------------------------------------------------

COSMETIC_GROUPS = (
    ("Costume/Helm", "Costume/Helm/"),
    ("Costume/Armor", "Costume/Armor/"),
    ("Costume/Shield", "Costume/Shield/"),
    ("Accessory/Helm", "Accessory/Helm/"),
    ("Accessory/Armor", "Accessory/Armor/"),
    ("Costume/Recolor Sets", "Costume/Recolor Sets/"),
    ("Upgrade/Color", "Upgrade/Color/"),
    ("Upgrade/Eye", "Upgrade/Eye/"),
    ("Upgrade/Height", "Upgrade/Height/"),
)


def model_refs(impl):
    found = set()
    if impl is None:
        return found
    for el in impl.iter():
        if el.tag in MODEL_TAGS:
            n = (el.findtext("name") or "").strip()
            if n.endswith(".dat"):
                found.add(n)
    return found


def samples(names, n=5):
    if len(names) <= n:
        return list(names)
    step = len(names) / n
    return [names[int(i * step)] for i in range(n)]


def cosmetics_summary(ctx):
    lib, msgs = ctx["items"], ctx["messages"]
    accessories = ConfigLibrary(ACCESSORY_XML)
    sprites = ConfigLibrary(BATTLE_SPRITE_XML)
    out = OrderedDict([("_note",
        "Counts are creatable entries, not Parts bases and not (Dev). models = "
        "distinct .dat files referenced by model/backModel, by the accessory "
        "config an accessory item points at, or by a sprite's tiers.")])
    for label, prefix in COSMETIC_GROUPS:
        names, classes, models, displays = [], Counter(), set(), []
        for name, entry in lib.entries.items():
            if not name.startswith(prefix):
                continue
            if "Parts" in name.split("/") or "(Dev)" in name:
                continue
            if (entry.findtext("creatable") or "").strip() != "true":
                continue
            impl, _ = lib.instantiate(name)
            names.append(name)
            classes[short_class(impl) if impl is not None else None] += 1
            models |= model_refs(impl)
            acc = impl.find("accessory") if impl is not None else None
            if acc is not None and (acc.findtext("name") or "").strip():
                acc_impl, _ = accessories.instantiate(acc.findtext("name").strip(),
                                                      parse_arguments(acc))
                models |= model_refs(acc_impl)
            key = (impl.findtext("name") or "").strip() if impl is not None else ""
            displays.append(msgs.translate(key) or name.split("/")[-1])
        out[label] = OrderedDict([
            ("count", len(names)),
            ("classes", dict(classes)),
            ("distinct_models", len(models)),
            ("samples", samples(sorted(displays))),
        ])

    acc_models = set()
    acc_count = 0
    for name in accessories.entries:
        if "Parts" in name.split("/"):
            continue
        acc_count += 1
        impl, _ = accessories.instantiate(name)
        acc_models |= model_refs(impl)
    out["accessory.xml"] = OrderedDict([
        ("count", acc_count), ("distinct_models", len(acc_models)),
        ("samples", samples(sorted(n for n in accessories.entries if "Parts" not in n))),
    ])

    sprite_names, sprite_models = [], set()
    for name in sprites.entries:
        if "Parts" in name.split("/"):
            continue
        impl, _ = sprites.instantiate(name)
        sprite_names.append(name)
        sprite_models |= model_refs(impl)
    out["battle_sprites"] = OrderedDict([
        ("count", len(sprite_names)), ("distinct_models", len(sprite_models)),
        ("samples", samples(sorted(sprite_names))),
    ])
    return out


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> int:
    for path in (ITEM_XML, DEPTH_SCALE_XML, LEVEL_TABLE_XML, ITEM_PROPERTY_XML, RECIPE_XML,
                 STATUS_CONDITION_XML, FIRE_ACTION_XML, ACCESSORY_XML, BATTLE_SPRITE_XML):
        if not os.path.isfile(path):
            sys.stderr.write("missing input: %s\n" % path)
            return 1

    items = ConfigLibrary(ITEM_XML)
    level_lib = ConfigLibrary(LEVEL_TABLE_XML)
    ctx = {
        "items": items,
        "messages": Messages(CONFIG_JAR),
        "scales": DepthScales(ConfigLibrary(DEPTH_SCALE_XML)),
        "bits": load_status_bits(ConfigLibrary(STATUS_CONDITION_XML)),
        "fire_actions": ConfigLibrary(FIRE_ACTION_XML),
        "item_props": load_item_properties(ConfigLibrary(ITEM_PROPERTY_XML)),
        "parents": load_gear_upgrade_parents(RECIPE_XML),
        "rsrc_ok": os.path.isdir(RSRC_DIR),
    }

    # ---- select ------------------------------------------------------------
    wanted = tuple("ItemConfig$" + s for s in SLOTS) + ("ItemConfig$LockdownShield",)
    real, excluded = [], []
    for name in items.entries:
        cls = items.original_class(name) or ""
        if not cls.endswith(wanted):
            continue
        reason = exclusion_reason(items, name, cls)
        if reason:
            excluded.append(OrderedDict([("config_name", name),
                                         ("class", cls.rsplit("$", 1)[-1]),
                                         ("reason", reason)]))
        else:
            real.append(name)

    gear = [mine_item(ctx, n) for n in real]
    by_name = {g["config_name"]: g for g in gear}

    # ---- sets: a name stem shared by items in two or more slots -----------
    stems = defaultdict(set)
    for g in gear:
        base, _ = split_variant(g["config_name"].split("/")[-1])
        words = base.split()
        g["_stem"] = " ".join(words[:-1]) if len(words) > 1 else None
        if g["_stem"]:
            stems[g["_stem"]].add(g["slot"])
    for g in gear:
        stem = g.pop("_stem")
        g["set"] = stem if stem and len(stems[stem]) > 1 else None

    # ---- lines: root of the recipe upgrade tree ---------------------------
    in_tree = set(ctx["parents"])
    for ps in ctx["parents"].values():
        in_tree.update(ps)
    for g in gear:
        if g["config_name"] not in in_tree:
            continue
        cur, seen = g["config_name"], set()
        while ctx["parents"].get(cur) and cur not in seen:
            seen.add(cur)
            cur = ctx["parents"][cur][0]
        g["line"] = by_name[cur]["display_name"] if cur in by_name else cur.split("/")[-1]

    # ---- modifier numbers the dump omits ----------------------------------
    observed = defaultdict(Counter)
    for g in gear:
        for m in g["modifiers"]:
            field = MODIFIER_VALUE_FIELD.get(m["kind"])
            if field and m.get(field) is not None:
                observed["%s/%s" % (m["kind"], m.get("bonus"))][m[field]] += 1
    for g in gear:
        for m in g["modifiers"]:
            field = MODIFIER_VALUE_FIELD.get(m["kind"])
            if not field or m.get(field) is not None:
                continue
            seen = observed.get("%s/%s" % (m["kind"], m.get("bonus")))
            if seen:
                value, count = seen.most_common(1)[0]
                m["value_inferred"] = value
                m["value_inferred_from"] = "%d of %d explicit %s/%s" % (
                    count, sum(seen.values()), m["kind"], m.get("bonus"))
                m["value_inferred_unanimous"] = len(seen) == 1
            else:
                m["value_inferred"] = None

    # ---- level tables used by the gear ------------------------------------
    level_tables = OrderedDict()
    for g in gear:
        table = (g["level"] or {}).get("level_table")
        if table and table not in level_tables:
            rows = resolve_level_table(level_lib, table)
            level_tables[table] = [
                OrderedDict([("level", i + 1),
                             ("modifiers", [m for e in lv for m in flatten_modifier(e)])])
                for i, lv in enumerate(rows)]

    gear.sort(key=lambda g: (SLOTS.index(g["slot"]), g["config_name"]))
    excluded.sort(key=lambda e: e["config_name"])

    # ---- models -------------------------------------------------------------
    models_by_slot = OrderedDict((s, set()) for s in SLOTS)
    for g in gear:
        if g["model"]:
            models_by_slot[g["slot"]].add(g["model"]["path"])
        if g["shield"] and g["shield"]["back_model"]:
            models_by_slot[g["slot"]].add(g["shield"]["back_model"]["path"])

    counts = OrderedDict((s, sum(1 for g in gear if g["slot"] == s)) for s in SLOTS)
    doc = OrderedDict([
        ("source", OrderedDict([("config_refs", CONFIG_REFS),
                                ("messages", ctx["messages"].source),
                                ("rsrc_checked", RSRC_DIR if ctx["rsrc_ok"] else None)])),
        ("notes", [
            "defense.<type>.at_depth: summed DepthScale curves (plus fixed amounts) at "
            "each sampled depth for the item's own star rating; max = depth %d, the "
            "ceiling. Level (heat) bonuses are separate, in level_tables." % DEPTH_SAMPLES[-1],
            "Depth-scale evaluation assumes: SegmentedEntry linear between points; "
            "Rarity picks the star's entry; DepthCap reads min(depth, cap); "
            "ModifyDamage multiplies; Difficulty at medium (shield health).",
            "status_resist.statuses decode conditionMask with status_mask_bits.",
            "modifiers: numbers absent in the dump are Java defaults; value_inferred "
            "is the most common explicit number for the same kind and bonus label. "
            "weapon_class null under a WeaponClass wrapper = the Java default.",
            "set: a name stem (variant suffix and last word removed) shared by items "
            "in at least two slots. line: display name of the recipe tree root.",
        ]),
        ("depth_samples", list(DEPTH_SAMPLES)),
        ("status_mask_bits", OrderedDict((str(b), w) for b, w in ctx["bits"].items())),
        ("counts", OrderedDict(list(counts.items()) + [("excluded", len(excluded))])),
        ("modifier_value_observations", OrderedDict(
            (k, OrderedDict((str(v), c) for v, c in cnt.most_common()))
            for k, cnt in sorted(observed.items()))),
        ("items", gear),
        ("level_tables", level_tables),
        ("excluded", excluded),
        ("cosmetics_summary", cosmetics_summary(ctx)),
    ])

    with open(OUT_JSON, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    with open(OUT_MODELS, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("# Model .dat files referenced by real Spiral Knights knight gear "
                 "(paths relative to rsrc). Written by mine_gear.py.\n")
        for slot, paths in models_by_slot.items():
            fh.write("\n# %s (%d files)\n" % (slot, len(paths)))
            for p in sorted(paths):
                fh.write(p + "\n")

    report(doc, gear, excluded, models_by_slot, ctx)
    return 0


# --------------------------------------------------------------------------
# Console report
# --------------------------------------------------------------------------

def report(doc, gear, excluded, models_by_slot, ctx):
    print("wrote %s" % OUT_JSON)
    print("wrote %s" % OUT_MODELS)
    print("messages: %s" % (ctx["messages"].source or "none (names from paths)"))
    print("\ncounts:")
    for k, v in doc["counts"].items():
        print("  %-9s %d" % (k, v))
    print("\nexcluded by reason:")
    for reason, n in Counter(e["reason"] for e in excluded).most_common():
        print("  %3d  %s" % (n, reason))

    total = len(gear)
    shields = [g for g in gear if g["slot"] == "Shield"]
    armour_like = [g for g in gear if g["slot"] in ("Helm", "Armor", "Shield")]
    mods = [m for g in gear for m in g["modifiers"]]
    valued = [m for m in mods if MODIFIER_VALUE_FIELD.get(m["kind"])]
    rows = [
        ("display name from bundle", sum(g["display_name_source"] == "bundle" for g in gear), total),
        ("flavor text", sum(bool(g["flavor"]) for g in gear), total),
        ("star rating explicit", sum(g["star_rating_explicit"] for g in gear), total),
        ("icon file", sum(bool(g["icon"] and g["icon"]["file"]) for g in gear), total),
        ("icon colorizations", sum(bool(g["icon"] and g["icon"]["colorizations"]) for g in gear), total),
        ("model (helm/armour/shield)", sum(bool(g["model"]) for g in armour_like), len(armour_like)),
        ("model file in install", sum(bool(g["model"] and g["model"].get("in_install")) for g in armour_like), len(armour_like)),
        ("defense numbers", sum(bool(g["defense"]) for g in gear), total),
        ("defense fully resolved", sum(bool(g["defense"]) and not g["unresolved"] for g in gear), total),
        ("status resist", sum(bool(g["status_resist"]) for g in gear), total),
        ("other defense (conditional)", sum(bool(g["defense_other"]) for g in gear), total),
        ("modifiers", sum(bool(g["modifiers"]) for g in gear), total),
        ("modifier number explicit", sum(m.get(MODIFIER_VALUE_FIELD[m["kind"]]) is not None for m in valued), len(valued)),
        ("modifier number inferred", sum(m.get("value_inferred") is not None for m in valued), len(valued)),
        ("level table", sum(bool(g["level"] and g["level"]["level_table"]) for g in gear), total),
        ("upgrades_from", sum(bool(g["upgrades_from"]) for g in gear), total),
        ("line (recipe tree)", sum(bool(g["line"]) for g in gear), total),
        ("set (name stem)", sum(bool(g["set"]) for g in gear), total),
        ("shield health resolved", sum(bool(g["shield"]["health"] and "max" in g["shield"]["health"]) for g in shields), len(shields)),
        ("shield push-back knockback", sum(bool(g["shield"]["action"] and g["shield"]["action"].get("knockback_impulse")) for g in shields), len(shields)),
        ("shield bash", sum(bool(g["shield"]["bash"]) for g in shields), len(shields)),
    ]
    print("\ncoverage:")
    for label, n, of in rows:
        print("  %-30s %4d / %d" % (label, n, of))

    print("\nunresolved problems: %d" % sum(len(g["unresolved"]) for g in gear))
    for g in gear:
        for p in g["unresolved"]:
            print("  %s: %s" % (g["config_name"], p))
    extra = Counter(k for g in gear for k in g["extra_fields"])
    print("\nextra implementation fields: %s" % dict(extra))
    wc_missing = Counter()
    for g in gear:
        for m in g["modifiers"]:
            if m.get("weapon_class_implicit"):
                wc_missing[g["config_name"].split("/")[-1]] += 1
    print("WeaponClass modifiers read as implicit SWORD (%d items): %s" % (
        len(wc_missing), sorted(wc_missing)[:25]))

    print("\ndistinct model files: %s" % {s: len(p) for s, p in models_by_slot.items()})
    shared = defaultdict(list)
    for g in gear:
        if g["model"]:
            shared[g["model"]["path"]].append(g["display_name"])
    top = sorted(shared.items(), key=lambda kv: -len(kv[1]))[:6]
    print("most shared models:")
    for path, users in top:
        print("  %2d  %s  e.g. %s" % (len(users), path, users[:3]))

    print("\nmean defense ceiling (sum of type max) by star:")
    for slot in SLOTS:
        by_star = defaultdict(list)
        for g in gear:
            if g["slot"] == slot:
                by_star[g["star_rating"]].append(g["defense_max_total"])
        print("  %-8s %s" % (slot, "  ".join("%d*:%.1f(n=%d)" % (s, sum(v) / len(v), len(v))
                                            for s, v in sorted(by_star.items()))))
    by_name = {g["config_name"]: g for g in gear}
    edges = bad = 0
    bad_examples = []
    for g in gear:
        for p in g["upgrades_from"]:
            parent = by_name.get(p)
            if not parent or parent["slot"] != g["slot"] or not parent["defense"]:
                continue
            edges += 1
            if g["defense_max_total"] < parent["defense_max_total"] or g["star_rating"] < parent["star_rating"]:
                bad += 1
                bad_examples.append("%s %d* %.1f <- %s %d* %.1f" % (
                    g["display_name"], g["star_rating"], g["defense_max_total"],
                    parent["display_name"], parent["star_rating"], parent["defense_max_total"]))
    print("upgrade edges with defense: %d, child below parent: %d" % (edges, bad))
    for ex in bad_examples[:8]:
        print("  " + ex)

    print("\nspot checks:")
    for cname in ("Gear/Shield/Proto Shield", "Gear/Helm/Cobalt Helm", "Gear/Armor/Cobalt Armor",
                  "Gear/Helm/Skolver Cap", "Gear/Armor/Skolver Coat", "Gear/Helm/Vog Cub Cap",
                  "Gear/Armor/Vog Cub Coat", "Gear/Trinket/Silver Amulet",
                  "Gear/Trinket/Penta-Heart Pendant", "Gear/Trinket/Elite Slash Module",
                  "Gear/Shield/Node Slime/Node Slime, Ruby",
                  "Gear/Helm/Pathfinder/Sacred Guerrilla Helm, Falcon",
                  "Gear/Armor/Spiral Brigandine (Blue)"):
        g = by_name.get(cname)
        if not g:
            print("  (missing) %s" % cname)
            continue
        print("  %s  [%s %d*]  set=%s line=%s from=%s" % (
            g["display_name"], g["slot"], g["star_rating"], g["set"], g["line"],
            [p.split("/")[-1] for p in g["upgrades_from"]]))
        if g["model"]:
            print("     model %s variant=%s colorization=%s" % (
                g["model"]["path"], g["model"]["variant"], g["model"]["colorization"]))
        for t, d in g["defense"].items():
            print("     %-9s %s  max %s  <- %s" % (t, dict(d["at_depth"]), d["max"], d["sources"]))
        for r in g["status_resist"]:
            print("     resist %s %s" % ("+".join(r["statuses"]), r["resist"]))
        for m in g["modifiers"]:
            print("     mod %s" % dict(m))
        if g["level"]:
            print("     level %s" % dict(g["level"]))
        if g["shield"]:
            s = g["shield"]
            print("     shield health %s max %s regen %s hit %s break %s speed %s bash %s" % (
                dict(s["health"]["at_depth"]) if s["health"] and "at_depth" in s["health"] else None,
                s["health"] and s["health"].get("max"), s["regen_time_ms"], s["hit_time_ms"],
                s["break_time_ms"], s["defending_speed"], s["bash"]))
            print("     action %s" % json.dumps(s["action"]))

    print("\ncosmetics summary:")
    for k, v in doc["cosmetics_summary"].items():
        if k.startswith("_"):
            continue
        print("  %-22s count %-5s models %-4s %s" % (k, v["count"], v["distinct_models"], v["samples"]))


if __name__ == "__main__":
    raise SystemExit(main())
