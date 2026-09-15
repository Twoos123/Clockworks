#!/usr/bin/env python3
"""Copy Spiral Knights' mouse cursors into the project.

Plain Python, no editor needed. Unreal's hardware cursors are not assets: they are image files
under the project's Content folder, named in Config/DefaultEngine.ini under
[/Script/Engine.UserInterfaceSettings] HardwareCursors. So this copies the game's own cursor PNGs
to Content/SK/Cursors, which is git-ignored placeholder art like the rest of Content/SK.

The game's cursor table (ConfigRefs/cursor.xml) has three: Default, Hand (hot spot x 5) and
Text (hot spot 4, 11), all 32 x 32.

Re-runnable; overwrites the copies.
"""

import os
import shutil
import sys

SK_CURSORS = r"C:\Program Files (x86)\Steam\steamapps\common\Spiral Knights\rsrc\ui\cursor"
PROJECT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DEST = os.path.join(PROJECT, "Content", "SK", "Cursors")

CURSORS = ("default", "hand", "text")


def main():
    os.makedirs(DEST, exist_ok=True)
    missing = []
    for name in CURSORS:
        source = os.path.join(SK_CURSORS, name + ".png")
        if not os.path.isfile(source):
            missing.append(source)
            continue
        shutil.copyfile(source, os.path.join(DEST, name + ".png"))
        print("copied", name)
    if missing:
        print("missing:", ", ".join(missing))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
