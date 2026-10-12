"""Builds src/export/registry.json: binary names of every enum and every class/interface
declared in the open-source Three Rings libraries (Clyde, Narya, Nenya). Used so the
importer never has to guess whether a known class is an enum.

Usage: python tools/gen_registry.py <java source root> [<root> ...]
"""
import json
import os
import re
import sys

DECL = r'\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)'
TOKEN = re.compile(r'[{}]|' + DECL)


def strip(src):
    src = re.sub(r'/\*.*?\*/', ' ', src, flags=re.S)
    src = re.sub(r'//[^\n]*', ' ', src)
    src = re.sub(r'"(?:\\.|[^"\\\n])*"', '""', src)
    src = re.sub(r"'(?:\\.|[^'\\\n])+'", "''", src)
    return src


def scan(path, enums, classes):
    src = strip(open(path, encoding='utf8', errors='replace').read())
    m = re.search(r'\bpackage\s+([\w.]+)\s*;', src)
    pkg = m.group(1) + '.' if m else ''
    stack = []  # (simple name, brace depth of its body)
    depth = 0
    pending = None
    for t in TOKEN.finditer(src):
        s = t.group(0)
        if s == '{':
            depth += 1
            if pending:
                stack.append((pending, depth))
                pending = None
        elif s == '}':
            if stack and stack[-1][1] == depth:
                stack.pop()
            depth -= 1
        else:
            kind, name = t.group(1), t.group(2)
            if src[max(0, t.start() - 1)] == '.':
                continue  # Foo.class literal
            body_depth = stack[-1][1] if stack else 0
            if depth != body_depth:
                continue  # local or anonymous type inside a method
            full = pkg + '$'.join([n for n, _ in stack] + [name])
            (enums if kind == 'enum' else classes).add(full)
            pending = name


def main():
    enums, classes = set(), set()
    for root in sys.argv[1:]:
        for dp, _, files in os.walk(root):
            for f in files:
                if f.endswith('.java'):
                    scan(os.path.join(dp, f), enums, classes)
    out = os.path.join(os.path.dirname(__file__), '..', 'src', 'export', 'registry.json')
    with open(out, 'w') as fh:
        json.dump({'enums': sorted(enums), 'classes': sorted(classes)}, fh, indent=0)
    print(len(enums), 'enums,', len(classes), 'classes')


if __name__ == '__main__':
    main()
