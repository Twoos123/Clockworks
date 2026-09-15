"""Per-base attack data for every Spiral Knights weapon base in weapons.json.

Writes weapon_base_attacks.json (scratchpad) keyed by base_item.
"""
import sys, json, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import clyde

SCRATCH = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRATCH, "weapon_base_attacks.json")
RSRC = r"C:\Program Files (x86)\Steam\steamapps\common\Spiral Knights\rsrc"
WEAPONS = json.load(open(r"D:\Dev\Clockworks\Tools\SKImport\weapons.json"))
COSMETIC = ("sound", "color", "swing", "muzzle", "flare", "texture", "strider", "sounder", "pitch", "gain", "range",
            "particle", "shell", "transient", "blend", "icon", "slag", "smoke", "eject", "fx", "scar", "effect")

HOLD_NOTE = ("No player item/attack config references a charge-hold clip (hold is driven by the client code, not "
             "the XML). The file below exists in rsrc and is the only charge-hold clip for this weapon type; in the "
             "XML it is referenced only by NPC attacks (%s).")
HOLD = {
    "Sword": ("character/pc/charge_sword_hold.dat", "Character/NPC/Monster/Construct/Mecha Knight Charge"),
    "Handgun": ("character/pc/charge_pistol_hold.dat", "Character/NPC/Monster/Construct/Mecha Knight Charge (Gun)"),
    "Bomb": ("character/pc/charge_bomb_hold.dat", "Character/NPC/Companion/Knights/Charge Bomb"),
}


def num(s):
    if s is None:
        return None
    s = s.strip()
    for cast in (int, float):
        try:
            return cast(s)
        except ValueError:
            pass
    return {"true": True, "false": False}.get(s, s)


def vec(s):
    if s is None:
        return None
    try:
        return [float(x) for x in s.split(",")]
    except ValueError:
        return s


def cosmetic(k):
    return any(c in k.lower() for c in COSMETIC)


# ---------------------------------------------------------------- pieces
def shape_summary(el):
    if el is None:
        return None
    cls = (el.get("class") or "").split("$")[-1]
    if el.find("shape") is not None and (cls == "TransformedShape" or el.find("transform") is not None):
        inner = shape_summary(el.find("shape")) or {}
        tr = el.find("transform")
        if tr is not None:
            for t in ("translation", "rotation", "scale"):
                if tr.findtext(t) is not None:
                    inner[t] = vec(tr.findtext(t)) if t == "translation" else num(tr.findtext(t))
        return inner or None
    out = {"type": cls or None}
    for tag in ("width", "height", "radius", "length"):
        if el.findtext(tag) is not None:
            out[tag] = num(el.findtext(tag))
    if el.find("shapes") is not None:
        out["shapes"] = [shape_summary(s) for s in el.find("shapes")]
    if el.find("vertices") is not None:
        out["vertices"] = [vec(v.text) for v in el.find("vertices")]
    for tag in ("start", "end"):
        if el.findtext(tag) is not None and "," in (el.findtext(tag) or ""):
            out[tag] = vec(el.findtext(tag))
    return out if len(out) > 1 else None


def impulse(el):
    if el is None or (not list(el) and not (el.text or "").strip()):
        return None
    d = {"translation_tiles": vec(el.findtext("translation")), "duration_ms": num(el.findtext("duration")),
         "delay_ms": num(el.findtext("delay"))}
    if el.findtext("level") is not None:
        d["level"] = num(el.findtext("level"))
    return d


def anim_ref(el, speed=None):
    """Animation reference: clip, playback speed, non-cosmetic scalar args, and
    for animation/sequential/*.dat the ordered sub-clips."""
    if el is None or el.findtext("name") is None:
        return None
    out = {"clip": el.findtext("name"), "speed": speed}
    args = {}
    for k, v in clyde.arg_pairs(el.find("arguments")):
        if cosmetic(k):
            continue
        if k == "Animations":
            seq = []
            for e in v:
                a = e.find("animation")
                item = {"clip": a.findtext("name") if a is not None else None}
                for ch in e:
                    if ch.tag != "animation" and not list(ch) and (ch.text or "").strip():
                        item[ch.tag] = num(ch.text)
                seq.append(item)
            out["sequence"] = seq
            continue
        if not list(v) and (v.text or "").strip():
            args[k] = num(v.text)
    if args:
        out["args"] = args
    return out


def actor_summary(ref):
    if ref is None or ref.findtext("name") is None:
        return None
    impl, trail = clyde.resolve_ref("actor.xml", ref)
    out = {"actor": ref.findtext("name")}
    args = {k: num(v.text) for k, v in clyde.arg_pairs(ref.find("arguments"))
            if not list(v) and (v.text or "").strip() and not cosmetic(k)}
    if args:
        out["args"] = args
    if impl is None:
        out["actor_resolved"] = False
        return out
    out["actor_class"] = (impl.get("class") or "").split("$")[-1]
    if out["actor_class"] == "Bomb":
        out["fuse_ms"] = num(impl.findtext("fuse"))
        if out["fuse_ms"] is None:
            out["fuse_note"] = "no <fuse> anywhere in the actor's Derived chain %s; Java default applies (not in dump)" % trail
    return out


def fire_ref_summary(fe):
    ref = fe.find("ref")
    if ref is None or ref.findtext("name") is None:
        return None
    f, trail = clyde.resolve_ref("fire_action.xml", ref)
    args = dict(clyde.arg_pairs(ref.find("arguments")))
    out = {"fire_action": ref.findtext("name")}
    if f is None:
        out["fire_action_resolved"] = False
        return out
    out["delay_ms"] = num(f.findtext("delay"))
    act = f.find("action")
    out["action"] = (act.get("class") or "").split("$")[-1] if act is not None else None
    if act is not None and act.find("actions") is not None:
        out["sub_actions"] = [(a.get("class") or "").split("$")[-1] for a in act.find("actions")]
    shp = shape_summary(args["Shape"]) if "Shape" in args else None
    if shp is None and act is not None and act.find("region") is not None:
        shp = shape_summary(act.find("region").find("shape"))
    if shp:
        out["shape"] = shp
    if act is not None:
        kb = impulse(act.find("impulseDealt"))
        if kb:
            out["knockback"] = kb
        if act.findtext("impulseTranslation") is not None:
            out["knockback_origin"] = vec(act.findtext("impulseTranslation"))
    if "Actor" in args and args["Actor"].findtext("name"):
        out["spawns"] = actor_summary(args["Actor"])
    elif act is not None and act.find("actor") is not None and act.find("actor").findtext("name"):
        out["spawns"] = actor_summary(act.find("actor"))
    for k in ("Rotation", "Rotation Variance"):
        if k in args and (args[k].text or "").strip():
            out[k.lower().replace(" ", "_")] = num(args[k].text)
    return out


def attack_summary(ref):
    if ref is None or ref.findtext("name") is None:
        return None
    a, trail = clyde.resolve_ref("attack.xml", ref)
    out = {"config": trail[0]}
    if len(trail) > 1:
        out["derived_from"] = trail[1:]
    if a is None:
        out["resolved"] = False
        return out
    cls = (a.get("class") or "").split("$")[-1]
    if cls != "Original":
        out["attack_class"] = cls
    out["start"] = anim_ref(a.find("start"), num(a.findtext("startSpeed")))
    out["fire"] = anim_ref(a.find("fire"), num(a.findtext("fireSpeed")))
    out["end"] = anim_ref(a.find("end"), num(a.findtext("endSpeed")))
    out["land_ms"] = num(a.findtext("land"))
    out["rearm_ms"] = num(a.findtext("rearm"))
    out["clear_ms"] = num(a.findtext("clear"))
    if a.findtext("interruptable") is not None:
        out["interruptable"] = num(a.findtext("interruptable"))
    out["lunge"] = impulse(a.find("impulseReceived"))
    out["hits"] = [x for x in (fire_ref_summary(fe) for fe in (a.find("fireRefs") if a.find("fireRefs") is not None else [])) if x]
    out["_all_pc_clips"] = sorted({el.text for el in a.iter("name") if el.text and el.text.startswith("character/pc/")})
    return out


def describe(att):
    """Factual one-line summary of a charged/incomplete attack from its hits."""
    if att is None:
        return None
    parts = []
    dmg = [h for h in att["hits"] if h.get("action") == "DamageRegionFromPoint"]
    spawns = [h for h in att["hits"] if h.get("spawns")]
    if dmg:
        shapes = sorted({json.dumps({k: v for k, v in (h.get("shape") or {}).items() if k in ("type", "radius", "width", "height")}) for h in dmg})
        parts.append("%d damage region(s) at %s ms, shape %s" % (len(dmg), "/".join(str(h["delay_ms"]) for h in dmg),
                                                                 ", ".join(shapes)))
    if spawns:
        names = collections.Counter(h["spawns"]["actor"] for h in spawns)
        parts.append("spawns " + ", ".join("%s x%d" % kv for kv in names.items()) +
                     " at %s ms" % "/".join(str(h["delay_ms"]) for h in spawns))
    other = sorted({h.get("action") for h in att["hits"]} - {"DamageRegionFromPoint", None} -
                   ({h.get("action") for h in spawns}))
    if other:
        parts.append("other actions: " + ", ".join(other))
    if att.get("lunge"):
        l = att["lunge"]
        parts.append("self impulse %s tiles over %s ms after %s ms" % (l["translation_tiles"][0] if isinstance(l["translation_tiles"], list) else l["translation_tiles"],
                                                                      l["duration_ms"], l["delay_ms"]))
    return "; ".join(parts) or None


def clip_list(att):
    if att is None:
        return []
    return att["_all_pc_clips"]


def item_summary(name):
    impl, trail = clyde.resolve("item.xml", name)
    s = collections.OrderedDict()
    s["item_class"] = (impl.get("class") or "").split("$")[-1]
    if len(trail) > 1:
        s["derived_from"] = trail[1:]
    for tag, key in (("maxChain", "max_chain"), ("chainCooldown", "chain_cooldown_ms"), ("chargeTime", "charge_time_ms"),
                     ("attackingSpeed", "attacking_move_speed"), ("chargingSpeed", "charging_move_speed"),
                     ("targetingDist", "targeting_dist"), ("targetingAngle", "targeting_angle")):
        s[key] = num(impl.findtext(tag))
    at = impl.find("attacks")
    s["normal_chain"] = [attack_summary(e.find("ref")) for e in at] if at is not None else []
    s["incomplete_charge"] = attack_summary(impl.find("incompleteChargedAttack"))
    s["charged_attack"] = attack_summary(impl.find("chargedAttack"))
    s["reload"] = attack_summary(impl.find("cooldownAttack"))
    return s


def projectile_of(att):
    if att is None:
        return None
    sp = [h["spawns"] for h in att["hits"] if h.get("spawns")]
    if not sp:
        return None
    names = collections.Counter(x["actor"] for x in sp)
    d = {"actors": dict(names)}
    fuses = sorted({x.get("fuse_ms") for x in sp if "fuse_ms" in x}, key=lambda v: (v is None, v))
    if fuses:
        d["fuse_ms"] = fuses
    return d


def signature(s):
    """Strip what varies per weapon without changing the animation/timing shape."""
    def strip(o):
        if isinstance(o, dict):
            return {k: strip(v) for k, v in o.items() if k not in ("spawns", "_all_pc_clips", "derived_from")}
        if isinstance(o, list):
            return [strip(x) for x in o]
        return o
    return strip(s)


def main():
    by_base = collections.OrderedDict()
    for w in sorted(WEAPONS, key=lambda w: (w["weapon_class"], w["base_item"], w["star_rating"] or 0, w["display_name"])):
        by_base.setdefault(w["base_item"], []).append(w)

    result = collections.OrderedDict()
    all_clips = collections.Counter()
    for base, ws in by_base.items():
        clyde.WARN.clear()
        wclass = ws[0]["weapon_class"]
        bs = item_summary(base)
        base_sig = signature(bs)
        e = collections.OrderedDict()
        e["weapon_class"] = wclass
        e["weapon_count"] = len(ws)
        e["weapons"] = ["%s (%s*)" % (w["display_name"], w["star_rating"]) for w in ws]
        e["chain_steps"] = len(bs["normal_chain"])
        e.update(bs)

        hold, npc = HOLD[wclass]
        e["charge"] = {
            "hold_clip": hold,
            "hold_clip_source": HOLD_NOTE % npc,
            "charge_time_ms": bs["charge_time_ms"],
            "charged_attack_config": bs["charged_attack"]["config"] if bs["charged_attack"] else None,
            "summary": describe(bs["charged_attack"]),
            "incomplete_release_summary": describe(bs["incomplete_charge"]),
        }
        if wclass == "Handgun":
            first = bs["normal_chain"][0] if bs["normal_chain"] else None
            e["handgun"] = {
                "shots_per_clip": bs["max_chain"] if bs["max_chain"] is not None else len(bs["normal_chain"]),
                "shots_per_clip_source": "item maxChain" if bs["max_chain"] is not None else
                                         "maxChain absent in item chain; count of attacks[] entries",
                "chain_cooldown_ms": bs["chain_cooldown_ms"],
                "first_shot": {"land_ms": first["land_ms"], "rearm_ms": first["rearm_ms"], "clear_ms": first["clear_ms"]} if first else None,
                "follow_up_shot": ({"land_ms": bs["normal_chain"][1]["land_ms"], "rearm_ms": bs["normal_chain"][1]["rearm_ms"],
                                    "clear_ms": bs["normal_chain"][1]["clear_ms"]} if len(bs["normal_chain"]) > 1 else None),
                "reload_clip": bs["reload"]["fire"]["clip"] if bs["reload"] and bs["reload"]["fire"] else None,
                "reload_speed": bs["reload"]["fire"]["speed"] if bs["reload"] and bs["reload"]["fire"] else None,
                "reload_rearm_ms": bs["reload"]["rearm_ms"] if bs["reload"] else None,
                "fire_clips": sorted({c for st in bs["normal_chain"] for c in clip_list(st)}),
            }
        if wclass == "Bomb":
            ca, ic = bs["charged_attack"], bs["incomplete_charge"]
            e["bomb"] = {
                "has_normal_attack": bool(bs["normal_chain"]),
                "place_clip": ca["fire"]["clip"] if ca and ca["fire"] else None,
                "place_clip_speed": ca["fire"]["speed"] if ca and ca["fire"] else None,
                "uses_attack_bomb_blend": bool(ca and ca["fire"] and ca["fire"]["clip"].endswith("attack_bomb_blend.dat")),
                "early_release_clip": ic["fire"]["clip"] if ic and ic["fire"] else None,
                "early_release_spawns": projectile_of(ic),
                "charged_bomb": projectile_of(ca),
                "max_chain": bs["max_chain"], "chain_cooldown_ms": bs["chain_cooldown_ms"],
            }

        variants = collections.OrderedDict()
        projectiles = collections.OrderedDict()
        for w in ws:
            s = item_summary(w["config_name"])
            label = "%s (%s*)" % (w["display_name"], w["star_rating"])
            sig = signature(s)
            diff = collections.OrderedDict()
            for k, v in sig.items():
                if k == "normal_chain":
                    if v != base_sig["normal_chain"]:
                        diff["normal_chain"] = {str(i): st for i, st in enumerate(v)
                                                if i >= len(base_sig["normal_chain"]) or st != base_sig["normal_chain"][i]}
                        if len(v) != len(base_sig["normal_chain"]):
                            diff["chain_steps"] = len(v)
                elif v != base_sig.get(k):
                    diff[k] = v
            key = json.dumps(diff, sort_keys=True)
            variants.setdefault(key, {"weapons": [], "differs_from_base": diff})
            variants[key]["weapons"].append(label)
            if wclass in ("Handgun", "Bomb"):
                p = {"normal": projectile_of(s["normal_chain"][-1]) if s["normal_chain"] else None,
                     "incomplete": projectile_of(s["incomplete_charge"]),
                     "charged": projectile_of(s["charged_attack"])}
                projectiles[label] = p
            for part in [*s["normal_chain"], s["incomplete_charge"], s["charged_attack"], s["reload"]]:
                for c in clip_list(part):
                    all_clips[c] += 1
        e["weapon_variants"] = list(variants.values())
        e["weapon_variants_note"] = ("Each variant lists only fields that differ from the base's own resolved "
                                     "values (projectile/bomb actor names and damage excluded; see projectiles_by_weapon).")
        if projectiles:
            e["projectiles_by_weapon"] = projectiles

        clips = set()
        for part in [*bs["normal_chain"], bs["incomplete_charge"], bs["charged_attack"], bs["reload"]]:
            clips.update(clip_list(part))
        for v in variants.values():
            pass
        # clips used by any weapon of this base
        wclips = set()
        for w in ws:
            s = item_summary(w["config_name"])
            for part in [*s["normal_chain"], s["incomplete_charge"], s["charged_attack"], s["reload"]]:
                wclips.update(clip_list(part))
        wclips.add(hold)
        e["knight_anim_dats"] = sorted(c for c in wclips)
        e["knight_anim_dats_missing_in_rsrc"] = sorted(c for c in wclips if not os.path.exists(os.path.join(RSRC, c.replace("/", os.sep))))
        e["resolver_warnings"] = sorted({x for x in clyde.WARN if "Sound" not in x and "shapes[0]" not in x})[:15]
        # drop helper keys
        def clean(o):
            if isinstance(o, dict):
                return collections.OrderedDict((k, clean(v)) for k, v in o.items() if k != "_all_pc_clips")
            if isinstance(o, list):
                return [clean(x) for x in o]
            return o
        result[base] = clean(e)
        all_clips[hold] += 1

    all_dats = sorted(all_clips)
    doc = collections.OrderedDict()
    doc["_meta"] = {
        "source": r"D:\Dev\Tools\ThreeRingsSharp\ThreeRingsSharp\ConfigRefs (item.xml, attack.xml, fire_action.xml, actor.xml)",
        "method": ("Clyde configs resolved programmatically: $Derived chains followed, <parameters> Direct paths and "
                   "Choice options applied with each reference's arguments, per base and per weapon."),
        "units": "translation in tiles (1 tile = 100 cm in Clockworks); times in ms; speeds are animation playback multipliers",
        "field_notes": {
            "start/fire/end.speed": "startSpeed/fireSpeed/endSpeed on the resolved AttackConfig; null = field absent in XML (engine default, not in dump)",
            "land_ms": "AttackConfig.land; null = absent in XML",
            "rearm_ms": "AttackConfig.rearm: time before the next attack in the chain can start",
            "clear_ms": "AttackConfig.clear: time after which the chain resets",
            "lunge": "AttackConfig.impulseReceived (self impulse: translation tiles, duration, delay)",
            "hits": "fireRefs resolved against fire_action.xml: delay, damage shape (Shape argument, local tiles, +X forward), knockback (impulseDealt), spawned actor",
            "charge.hold_clip": "not referenced by any player config; see hold_clip_source",
        },
        "base_count": len(result),
        "weapon_count": sum(v["weapon_count"] for v in result.values()),
    }
    doc["all_knight_anim_dats"] = [{"path": c, "exists_in_rsrc": os.path.exists(os.path.join(RSRC, c.replace("/", os.sep)))} for c in all_dats]
    doc["bases"] = result
    with open(OUT, "w") as fh:
        json.dump(doc, fh, indent=1)
    print("wrote", OUT, "bases", len(result), "dats", len(all_dats))


main()
