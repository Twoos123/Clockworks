"""Bake one coloured PNG per gear item from the game's shared, recoloured-at-runtime icons.

Plain Python and Pillow, no editor. Spiral Knights draws many gear icons from one key-coloured
picture (icon_amulet.png, icon_ring.png, nodeslime.png, the recolor_* helms and armour) and
recolours it per item when the icon is shown. Unreal wants a finished texture per item, so this
applies each item's colorizations once and writes the result.

    python Tools/SKImport/bake_gear_icons.py

Inputs:

  Tools/SKImport/gear.json   {"items": [...]}: per item config_name, display_name, slot and
                             icon {"file": path under rsrc, "colorizations": [...]}
  <SK_RSRC>/<icon file>      the game's icon PNGs (palette PNGs, a few RGBA)
  <SK_ASSETS>/_gear_samples/colordefs/colordefs.txt
                             text dump of com.threerings.media.image.ColorPository: 22 class
                             records (classId, source Color#aarrggbb, range [h, s, v]) each with
                             colour records (colorId, offsets [h, s, v])

A colorization in gear.json is one of:

  int                               classId << 8 | colorId, looked up in the colour table
  {"_class": "...$CustomOffsets"}   "clazz" (a classId): that class's source and range, the
                                    item's own "offsets"
  {"_class": "...$FullyCustom"}     "source" "r, g, b, a" (floats 0-1), "range", "offsets"
                                    (missing hue/saturation/value keys are 0)

Outputs, in <SK_ASSETS>/_gear_icons:

  T_GearIcon_<Name>.png   one RGBA PNG per item, coloured or a plain copy of an uncoloured icon.
                          <Name> is the display name in CamelCase ASCII letters and digits; on a
                          collision the slot is appended, then a number.
  gear_icons.json         {"summary": counts and anything unresolved,
                           "icons": {config_name: {"asset", "png", "source", "colorizations"}}}
  _contact_sheet.png      about forty items, source icon beside baked icon, for a human to check

The recolouring rule is Three Rings' own (nenya com.threerings.media.image.Colorization and
ImageUtil.recolorImage, Clyde ColorizationConfig and ImageCache; ThreeRingsSharp has no port of
it), reproduced with Java's float arithmetic and java.awt.Color.RGBtoHSB / HSBtoRGB:

  - The class source colour and every pixel colour go to HSV, all 0-1.
  - A pixel matches a colorization when
      distance(int(h * 32767), int(h_src * 32767)) round a circle of 32767 <= range[0] * 32767,
      |s_src - s| <= range[1] and |v_src - v| <= range[2]
    (inclusive: the original rejects on '>').
  - A matching pixel becomes HSBtoRGB(h + offsets[0], clamp(s + offsets[1]), clamp(v +
    offsets[2])); HSBtoRGB wraps the hue, including negative ones. Alpha is kept.
  - Colorizations are tried in list order against the pixel's original colour; the first that
    matches wins and the rest are skipped, so no pixel is recoloured twice.
  - Fully transparent pixels are never touched. The original only recolours indexed images, per
    palette entry; that is identical to per pixel, which is what is done for the rare non-palette
    icon.

A colorization whose class or colour id is not in the table is skipped and reported, and so is a
resolved one that matched no pixel of its icon (worth a look: likely the wrong class for it).
"""
import json
import math
import os
import re
import struct
import sys
import time
import unicodedata

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from stage_and_import import SK_ASSETS, SK_RSRC  # noqa: E402

GEAR_JSON = os.path.join(HERE, "gear.json")
COLORDEFS = os.path.join(SK_ASSETS, "_gear_samples", "colordefs", "colordefs.txt")
OUT_DIR = os.path.join(SK_ASSETS, "_gear_icons")
OUT_JSON = os.path.join(OUT_DIR, "gear_icons.json")
CONTACT_SHEET = os.path.join(OUT_DIR, "_contact_sheet.png")
PREFIX = "T_GearIcon_"
SHORT_MAX = 32767


# --- Java float arithmetic -----------------------------------------------------------------------

def f32(x):
    """x rounded to a Java float."""
    return struct.unpack("<f", struct.pack("<f", x))[0]


def rgb_to_hsb(r, g, b):
    """java.awt.Color.RGBtoHSB."""
    cmax = max(r, g, b)
    cmin = min(r, g, b)
    brightness = f32(cmax / 255.0)
    saturation = f32((cmax - cmin) / cmax) if cmax != 0 else 0.0
    if saturation == 0:
        hue = 0.0
    else:
        span = float(cmax - cmin)
        redc = f32((cmax - r) / span)
        greenc = f32((cmax - g) / span)
        bluec = f32((cmax - b) / span)
        if r == cmax:
            hue = f32(bluec - greenc)
        elif g == cmax:
            hue = f32(f32(2.0 + redc) - bluec)
        else:
            hue = f32(f32(4.0 + greenc) - redc)
        hue = f32(hue / 6.0)
        if hue < 0:
            hue = f32(hue + 1.0)
    return hue, saturation, brightness


def hsb_to_rgb(hue, saturation, brightness):
    """java.awt.Color.HSBtoRGB, without the alpha byte."""
    def byte(x):
        return int(f32(f32(x * 255.0) + 0.5))

    if saturation == 0:
        v = byte(brightness)
        return v, v, v
    h = f32(f32(hue - f32(math.floor(hue))) * 6.0)
    f = f32(h - f32(math.floor(h)))
    p = f32(brightness * f32(1.0 - saturation))
    q = f32(brightness * f32(1.0 - f32(saturation * f)))
    t = f32(brightness * f32(1.0 - f32(saturation * f32(1.0 - f))))
    sector = int(h)
    if sector == 0:
        return byte(brightness), byte(t), byte(p)
    if sector == 1:
        return byte(q), byte(brightness), byte(p)
    if sector == 2:
        return byte(p), byte(brightness), byte(t)
    if sector == 3:
        return byte(p), byte(q), byte(brightness)
    if sector == 4:
        return byte(t), byte(p), byte(brightness)
    if sector == 5:
        return byte(brightness), byte(p), byte(q)
    return 0, 0, 0  # Java's switch has no case for a hue that rounds to exactly 6


class Colorization:
    """nenya Colorization: a source colour, a match range and HSV offsets."""

    def __init__(self, label, source_rgb, rng, offsets):
        self.label = label
        self.hsv = rgb_to_hsb(*source_rgb)
        self.hue_fixed = int(f32(self.hsv[0] * SHORT_MAX))
        self.range = [f32(v) for v in rng]
        self.offsets = [f32(v) for v in offsets]

    def matches(self, hsv, hue_fixed):
        a, b = hue_fixed, self.hue_fixed
        distance = min(a - b, b + SHORT_MAX - a) if a > b else min(b - a, a + SHORT_MAX - b)
        if distance > f32(self.range[0] * SHORT_MAX):
            return False
        if abs(f32(self.hsv[1] - hsv[1])) > self.range[1]:
            return False
        if abs(f32(self.hsv[2] - hsv[2])) > self.range[2]:
            return False
        return True

    def recolor(self, hsv):
        hue = f32(hsv[0] + self.offsets[0])
        sat = min(max(f32(hsv[1] + self.offsets[1]), 0.0), 1.0)
        val = min(max(f32(hsv[2] + self.offsets[2]), 0.0), 1.0)
        return hsb_to_rgb(hue, sat, val)


# --- The colour table ----------------------------------------------------------------------------

def argb(text):
    """'Color#ffff00ff' (aarrggbb) to (r, g, b)."""
    value = int(re.search(r"#([0-9a-fA-F]{8})", text).group(1), 16)
    return (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF


def triple(text):
    return [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?(?:[eE]-?\d+)?", text)][:3]


def load_colour_table(path):
    """{classId: {"name", "source", "range", "colors": {colorId: {"name", "offsets"}}}}."""
    classes = {}
    current_class = None
    current_colour = None
    with open(path, encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            line = raw.rstrip("\n")
            stripped = line.strip()
            if re.match(r"\{\d+\} : com\.threerings\.media\.image\.ColorPository\$ClassRecord$", stripped):
                current_class = {"colors": {}}
                current_colour = None
                continue
            if re.match(r"\{\d+\} : com\.threerings\.media\.image\.ColorPository\$ColorRecord$", stripped):
                current_colour = {}
                continue
            match = re.match(r"(\s*)(\w+) = (.*)$", line)
            if not match or current_class is None:
                continue
            indent, key, value = len(match.group(1)), match.group(2), match.group(3).strip()
            if current_colour is not None and indent > 6:
                if key == "colorId":
                    current_colour["id"] = int(value)
                    current_class["colors"][int(value)] = current_colour
                elif key == "name":
                    current_colour["name"] = value
                elif key == "offsets":
                    current_colour["offsets"] = triple(value)
                continue
            current_colour = None
            if key == "classId":
                current_class["id"] = int(value)
                classes[int(value)] = current_class
            elif key == "name":
                current_class["name"] = value
            elif key == "source":
                current_class["source"] = argb(value)
            elif key == "range":
                current_class["range"] = triple(value)
    return classes


def hsv_dict(values):
    values = values or {}
    return [float(values.get(k, 0.0)) for k in ("hue", "saturation", "value")]


def resolve(entry, classes):
    """A Colorization for one gear.json entry, or (None, reason)."""
    if isinstance(entry, int):
        class_id, colour_id = entry >> 8, entry & 0xFF
        crec = classes.get(class_id)
        if crec is None:
            return None, "unknown class %d (colorization %d)" % (class_id, entry)
        colour = crec["colors"].get(colour_id)
        if colour is None:
            return None, "unknown colour %d in class %d %s (colorization %d)" % (
                colour_id, class_id, crec["name"], entry)
        label = "%s/%s" % (crec["name"], colour.get("name", colour_id))
        return Colorization(label, crec["source"], crec["range"], colour["offsets"]), None
    if isinstance(entry, dict):
        kind = entry.get("_class", "")
        if kind.endswith("$CustomOffsets"):
            crec = classes.get(entry.get("clazz"))
            if crec is None:
                return None, "unknown class %r (CustomOffsets)" % entry.get("clazz")
            return Colorization("%s/custom" % crec["name"], crec["source"], crec["range"],
                                hsv_dict(entry.get("offsets"))), None
        if kind.endswith("$FullyCustom"):
            floats = [float(x) for x in str(entry.get("source", "0, 0, 0, 1")).split(",")]
            rgb = tuple(int(f32(f32(c * 255.0) + 0.5)) for c in floats[:3])  # java.awt.Color(float...)
            return Colorization("fully custom", rgb, hsv_dict(entry.get("range")),
                                hsv_dict(entry.get("offsets"))), None
        return None, "unsupported colorization type %r" % kind
    return None, "unsupported colorization %r" % (entry,)


# --- Images --------------------------------------------------------------------------------------

def recolor_rgba(rgba, zations, hits):
    """One (r, g, b, a) through the first matching colorization; counts hits per colorization."""
    r, g, b, a = rgba
    if a == 0 or not zations:
        return rgba
    hsv = rgb_to_hsb(r, g, b)
    hue_fixed = int(f32(hsv[0] * SHORT_MAX))
    for index, zation in enumerate(zations):
        if zation.matches(hsv, hue_fixed):
            hits[index] += 1
            return zation.recolor(hsv) + (a,)
    return rgba


def bake(path, zations):
    """(RGBA image, matched pixel count per colorization)."""
    image = Image.open(path)
    image.load()
    hits = [0] * len(zations)
    if image.mode == "P":
        palette = image.getpalette("RGB") or []
        count = len(palette) // 3
        alpha = [255] * 256
        transparency = image.info.get("transparency")
        if isinstance(transparency, (bytes, bytearray)):
            for index, value in enumerate(transparency[:256]):
                alpha[index] = value
        elif isinstance(transparency, int) and 0 <= transparency < 256:
            alpha[transparency] = 0
        histogram = image.histogram()
        lut = []
        for index in range(256):
            rgb = tuple(palette[index * 3:index * 3 + 3]) if index < count else (0, 0, 0)
            entry_hits = [0] * len(zations)
            colour = recolor_rgba(rgb + (alpha[index],), zations, entry_hits)
            for z, hit in enumerate(entry_hits):
                hits[z] += hit * histogram[index]
            lut.append(bytes(colour))
        data = b"".join(lut[i] for i in image.tobytes())
        return Image.frombytes("RGBA", image.size, data), hits
    image = image.convert("RGBA")
    if not zations:
        return image, hits
    cache = {}
    out = []
    data = image.tobytes()
    for offset in range(0, len(data), 4):
        pixel = tuple(data[offset:offset + 4])
        colour = cache.get(pixel)
        if colour is None:
            entry_hits = [0] * len(zations)
            colour = recolor_rgba(pixel, zations, entry_hits)
            cache[pixel] = (colour, entry_hits)
        else:
            colour, entry_hits = colour
        for z, hit in enumerate(entry_hits):
            hits[z] += hit
        out.append(colour)
    result = Image.new("RGBA", image.size)
    result.putdata(out)
    return result, hits


def camel_name(display_name):
    text = unicodedata.normalize("NFKD", display_name).encode("ascii", "ignore").decode("ascii")
    text = text.replace("'", "")
    words = re.findall(r"[A-Za-z0-9]+", text)
    return "".join(w[0].upper() + w[1:] for w in words) or "Unnamed"


def unique_asset(item, taken):
    base = PREFIX + camel_name(item.get("display_name") or item["config_name"].split("/")[-1])
    if base not in taken:
        return base
    with_slot = base + camel_name(item.get("slot") or "Gear")
    if with_slot not in taken:
        return with_slot
    number = 2
    while "%s%d" % (with_slot, number) in taken:
        number += 1
    return "%s%d" % (with_slot, number)


# --- Contact sheet -------------------------------------------------------------------------------

def pick_samples(baked):
    """About forty items: many sharing the three big shared icons, then a spread of the rest."""
    wanted = [("icon_amulet.png", 11), ("icon_ring.png", 10), ("nodeslime.png", 10)]
    picked, seen_keys = [], set()
    for stem, limit in wanted:
        signatures = set()
        for entry in baked:
            if os.path.basename(entry["source"]) != stem or not entry["zations"]:
                continue
            signature = json.dumps(entry["raw"], sort_keys=True)
            if signature in signatures:
                continue
            signatures.add(signature)
            picked.append(entry)
            seen_keys.add(entry["config_name"])
            if len(signatures) >= limit:
                break
    used_sources = set()
    for entry in baked:
        if len(picked) >= 40:
            break
        if not entry["zations"] or entry["config_name"] in seen_keys:
            continue
        source = os.path.basename(entry["source"])
        if source in used_sources or source in {s for s, _ in wanted}:
            continue
        used_sources.add(source)
        picked.append(entry)
    return picked


def contact_sheet(samples, path):
    size, pad, text_h, cols = 96, 8, 30, 5
    cell_w, cell_h = size * 2 + pad * 3, size + text_h + pad * 2
    rows = (len(samples) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell_w, rows * cell_h), (40, 40, 44, 255))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default(size=11)
    except TypeError:
        font = ImageFont.load_default()
    checker = Image.new("RGBA", (size, size))
    checker_draw = ImageDraw.Draw(checker)
    for y in range(0, size, 12):
        for x in range(0, size, 12):
            shade = 96 if (x + y) // 12 % 2 else 128
            checker_draw.rectangle([x, y, x + 11, y + 11], fill=(shade, shade, shade, 255))
    for index, entry in enumerate(samples):
        ox, oy = index % cols * cell_w, index // cols * cell_h
        source = Image.open(entry["source_abs"]).convert("RGBA").resize((size, size), Image.LANCZOS)
        result = Image.open(entry["png"]).convert("RGBA").resize((size, size), Image.LANCZOS)
        for column, picture in enumerate((source, result)):
            x = ox + pad + column * (size + pad)
            tile = checker.copy()
            tile.alpha_composite(picture)
            sheet.paste(tile, (x, oy + pad))
        label = entry["display_name"][:30]
        detail = "%s  x%d" % (os.path.basename(entry["source"])[:22], len(entry["raw"]))
        draw.text((ox + pad, oy + pad + size + 2), label, fill=(235, 235, 235, 255), font=font)
        draw.text((ox + pad, oy + pad + size + 15), detail, fill=(160, 160, 170, 255), font=font)
    sheet.save(path)


# --- Main ----------------------------------------------------------------------------------------

def main():
    started = time.perf_counter()
    classes = load_colour_table(COLORDEFS)
    colour_count = sum(len(c["colors"]) for c in classes.values())
    print("colour table: %d classes, %d colours" % (len(classes), colour_count))
    items = json.load(open(GEAR_JSON, encoding="utf-8"))["items"]
    os.makedirs(OUT_DIR, exist_ok=True)

    taken, icons, baked = set(), {}, []
    unresolved, no_match, missing_icons = [], [], []
    counts = {"items": len(items), "written": 0, "recoloured": 0, "plain_copies": 0,
              "colorizations": 0, "colorizations_applied": 0, "colorizations_unresolved": 0,
              "colorizations_matching_nothing": 0, "non_palette_recoloured": 0}
    for item in items:
        icon = item.get("icon") or {}
        source = icon.get("file")
        source_abs = os.path.join(SK_RSRC, source.replace("/", os.sep)) if source else None
        if not source_abs or not os.path.isfile(source_abs):
            missing_icons.append({"config_name": item["config_name"], "file": source})
            continue
        raw = icon.get("colorizations") or []
        zations = []
        for entry in raw:
            counts["colorizations"] += 1
            zation, reason = resolve(entry, classes)
            if zation is None:
                counts["colorizations_unresolved"] += 1
                unresolved.append({"config_name": item["config_name"], "reason": reason})
            else:
                zations.append(zation)
        asset = unique_asset(item, taken)
        taken.add(asset)
        png = os.path.join(OUT_DIR, asset + ".png")
        image, hits = bake(source_abs, zations)
        image.save(png)
        counts["written"] += 1
        if raw:
            counts["recoloured"] += 1
            counts["colorizations_applied"] += len(zations)
            if Image.open(source_abs).mode != "P":
                counts["non_palette_recoloured"] += 1
        else:
            counts["plain_copies"] += 1
        for zation, hit in zip(zations, hits):
            if hit == 0:
                counts["colorizations_matching_nothing"] += 1
                no_match.append({"config_name": item["config_name"], "icon": source,
                                 "colorization": zation.label})
        icons[item["config_name"]] = {"asset": asset, "png": png, "source": source,
                                      "colorizations": len(raw)}
        baked.append({"config_name": item["config_name"], "display_name": item.get("display_name", ""),
                      "source": source, "source_abs": source_abs, "png": png,
                      "raw": raw, "zations": zations})

    samples = pick_samples(baked)
    contact_sheet(samples, CONTACT_SHEET)
    elapsed = time.perf_counter() - started
    summary = dict(counts, colour_classes=len(classes), colour_records=colour_count,
                   missing_icons=missing_icons, unresolved=unresolved, matching_nothing=no_match,
                   contact_sheet=CONTACT_SHEET, contact_sheet_items=len(samples),
                   seconds=round(elapsed, 2))
    with open(OUT_JSON, "w", encoding="utf-8") as handle:
        json.dump({"summary": summary, "icons": icons}, handle, indent=1, ensure_ascii=False)

    for key, value in counts.items():
        print("%-32s %d" % (key, value))
    print("missing icon files               %d" % len(missing_icons))
    for entry in unresolved:
        print("unresolved: %s: %s" % (entry["config_name"], entry["reason"]))
    for entry in no_match:
        print("matched nothing: %s (%s): %s" % (entry["config_name"], entry["icon"], entry["colorization"]))
    print("contact sheet: %s (%d items)" % (CONTACT_SHEET, len(samples)))
    print("wrote %s in %.2f s" % (OUT_JSON, elapsed))


if __name__ == "__main__":
    main()
