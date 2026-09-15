"""Minimal Clyde config resolver over the ThreeRingsSharp XML dumps.

Resolves ConfigReference(name, arguments) against a config table:
  * applies arguments through the entry's <parameters> (Direct paths and
    Choice options) onto a deep copy of the implementation;
  * follows $Derived implementations (item / attack / fire child) with their
    own reference arguments.
"""
import copy, os, re
import xml.etree.ElementTree as ET

CR = r"D:\Dev\Tools\ThreeRingsSharp\ThreeRingsSharp\ConfigRefs"
_tables = {}
WARN = []


def table(fname):
    if fname not in _tables:
        obj = ET.parse(os.path.join(CR, fname)).getroot()[0]
        d = {}
        for e in obj:
            n = e.findtext("name")
            if n is not None and n not in d:
                d[n] = e
        _tables[fname] = d
    return _tables[fname]


def camel(s):
    parts = s.split("_")
    return parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:])


TOK = re.compile(r'\s*(?:(\w+)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]|(\.))')


def split_paths(s):
    out, depth, q, cur = [], 0, False, ""
    for ch in s:
        if ch == '"':
            q = not q
        if not q:
            if ch == "[":
                depth += 1
            elif ch == "]":
                depth = max(0, depth - 1)
            elif ch == "," and depth == 0:
                out.append(cur.strip()); cur = ""; continue
        cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def tokens(path):
    pos, out = 0, []
    while pos < len(path):
        m = TOK.match(path, pos)
        if not m or m.end() == pos:
            # the game data carries a few malformed paths (stray "]"); skip the character
            WARN.append("malformed path char %r in %r" % (path[pos], path))
            pos += 1
            continue
        pos = m.end()
        if m.group(1):
            out.append(("f", camel(m.group(1))))
        elif m.group(2):
            out.append(("i", int(m.group(2))))
        elif m.group(3) is not None:
            out.append(("a", m.group(3)))
    return out


def arg_pairs(argsel):
    """[(key_text, value_element)] from an <arguments> element."""
    if argsel is None:
        return []
    kids = list(argsel)
    return [(kids[i].text or "", kids[i + 1]) for i in range(0, len(kids) - 1, 2)]


def set_value(target, value):
    target.text = value.text
    for c in list(target):
        target.remove(c)
    for c in value:
        target.append(copy.deepcopy(c))
    target.attrib.clear()
    if value.get("class"):
        target.set("class", value.get("class"))


def apply_path(impl_holder, path, value):
    toks = tokens(path)
    if not toks or toks[0] != ("f", "implementation"):
        WARN.append("path not rooted at implementation: " + path)
        return
    node = impl_holder
    toks = toks[1:]
    cur = node.find("implementation")
    for k, (kind, v) in enumerate(toks):
        last = k == len(toks) - 1
        if kind == "f":
            nxt = cur.find(v)
            if nxt is None:
                nxt = ET.SubElement(cur, v)
            cur = nxt
        elif kind == "i":
            entries = [c for c in cur if c.tag == "entry"]
            if v >= len(entries):
                WARN.append("index %d out of range in %s" % (v, path))
                return
            cur = entries[v]
        else:  # argument on a config reference
            args = cur.find("arguments")
            if args is None:
                args = ET.SubElement(cur, "arguments")
            kids = list(args)
            found = None
            for i in range(0, len(kids) - 1, 2):
                if (kids[i].text or "") == v:
                    found = kids[i + 1]
                    break
            if found is None:
                ke = ET.SubElement(args, "key", {"class": "java.lang.String"})
                ke.text = v
                found = ET.SubElement(args, "value")
                if not last:
                    WARN.append("deep path into missing argument %r: %s" % (v, path))
                    return
            cur = found
    set_value(cur, value)


def apply_args(entry, holder, args):
    params = entry.find("parameters")
    plist = list(params) if params is not None else []
    for key, value in args:
        p = next((x for x in plist if x.findtext("name") == key), None)
        if p is None:
            WARN.append("%s: no parameter %r" % (entry.findtext("name"), key))
            continue
        cls = p.get("class", "")
        if cls.endswith("Direct"):
            for path in split_paths(p.findtext("paths") or ""):
                apply_path(holder, path, value)
        elif cls.endswith("Choice"):
            opt_name = (value.text or "").strip()
            opt = next((o for o in p.find("options") if o.findtext("name") == opt_name), None)
            if opt is None:
                WARN.append("%s: choice %r has no option %r" % (entry.findtext("name"), key, opt_name))
                continue
            directs = {d.findtext("name"): d.findtext("paths") for d in p.find("directs")}
            for k2, v2 in arg_pairs(opt.find("arguments")):
                for path in split_paths(directs.get(k2) or ""):
                    apply_path(holder, path, v2)
        else:
            WARN.append("unknown parameter class " + cls)


DERIVED_CHILD = {"item.xml": "item", "attack.xml": "attack", "fire_action.xml": "fire", "actor.xml": "actor"}


def resolve(fname, name, args=(), trail=None):
    """Return (implementation element, [chain of config names])."""
    trail = (trail or []) + [name]
    entry = table(fname).get(name)
    if entry is None:
        return None, trail
    holder = ET.Element("holder")
    impl = entry.find("implementation")
    holder.append(copy.deepcopy(impl) if impl is not None else ET.Element("implementation"))
    apply_args(entry, holder, list(args))
    impl = holder.find("implementation")
    if (impl.get("class") or "").endswith("$Derived"):
        ref = impl.find(DERIVED_CHILD[fname])
        if ref is None or ref.findtext("name") is None:
            return impl, trail
        return resolve(fname, ref.findtext("name"), arg_pairs(ref.find("arguments")), trail)
    return impl, trail


def resolve_ref(fname, refel, trail=None):
    """refel is a ConfigReference element (<name>, <arguments>)."""
    if refel is None or refel.findtext("name") is None:
        return None, []
    return resolve(fname, refel.findtext("name"), arg_pairs(refel.find("arguments")), trail)


def text(el, tag, cast=str, default=None):
    if el is None:
        return default
    t = el.findtext(tag)
    if t is None:
        return default
    try:
        return cast(t)
    except ValueError:
        return t
