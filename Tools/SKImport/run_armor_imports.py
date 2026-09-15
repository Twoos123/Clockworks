"""Imports every knight armour onto the player knight's skeleton, one headless editor run each.

Plain Python; the editor must be closed:

    python Tools/SKImport/run_armor_imports.py [--redo]

Reads gear.json for the armour model files, finds each one's export in D:/Dev/SKAssets/_gear_export/armor, and
runs import_armor.py for it (only the first Interchange import of a headless run completes, so each armour
gets its own run). An armour already imported is skipped unless --redo. Writes
D:/Dev/SKAssets/_staging/GearArmor/armor_import_results.json: {armour model: {asset, glb, result, seconds}}.
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from stage_and_import import GEAR_JSON, PROJECT, UE_CMD, armor_asset  # noqa: E402

EXPORTS = r"D:\Dev\SKAssets\_gear_export\armor"
CONTENT = os.path.join(os.path.dirname(PROJECT), "Content", "SK", "Gear", "Armor")
RESULTS = r"D:\Dev\SKAssets\_staging\GearArmor\armor_import_results.json"


def export_for(model_path):
    """The glb export_armor.py / export_armor_leaves.py wrote for an armour model file."""
    name = model_path.replace("item/gear/armor/", "").replace("/", "__")[:-4]
    return os.path.join(EXPORTS, name + ".glb")


def main():
    redo = "--redo" in sys.argv
    with open(GEAR_JSON, encoding="utf-8") as handle:
        models = sorted({(item.get("model") or {}).get("path") for item in json.load(handle)["items"]
                         if item["slot"] == "Armor" and (item.get("model") or {}).get("path")})
    os.makedirs(os.path.dirname(RESULTS), exist_ok=True)
    results = {}
    if os.path.isfile(RESULTS):
        with open(RESULTS, encoding="utf-8") as handle:
            results = json.load(handle)

    for index, model in enumerate(models, 1):
        asset = armor_asset(model)
        glb = export_for(model)
        folder = os.path.join(CONTENT, asset)
        if not redo and results.get(model, {}).get("result", "").startswith("OK") and os.path.isdir(folder):
            print("[%d/%d] skip %s (imported)" % (index, len(models), asset), flush=True)
            continue
        if not os.path.isfile(glb):
            results[model] = {"asset": asset, "glb": glb, "result": "FAIL no export"}
            print("[%d/%d] FAIL %s: no export %s" % (index, len(models), asset, glb), flush=True)
            continue
        start = time.time()
        env = dict(os.environ, ARMOR_IMPORT=glb + "|" + asset)
        run = subprocess.run([UE_CMD, PROJECT, "-run=pythonscript", "-script=" + os.path.join(HERE, "import_armor.py").replace("\\", "/"),
                              "-unattended", "-nop4", "-nosplash"], env=env, capture_output=True, text=True, errors="replace")
        lines = [l.split("ArmorImport: ", 1)[1] for l in run.stdout.splitlines() if "LogPython: Warning: ArmorImport: " in l and "LogInit" not in l]
        verdict = next((l for l in lines if l.startswith(("OK ", "FAIL "))), "FAIL no result (exit %d)" % run.returncode)
        results[model] = {"asset": asset, "glb": glb, "result": verdict, "notes": [l for l in lines if l is not verdict],
                          "seconds": round(time.time() - start, 1)}
        print("[%d/%d] %s (%.0fs)" % (index, len(models), verdict, time.time() - start), flush=True)
        with open(RESULTS, "w", encoding="utf-8") as handle:
            json.dump(results, handle, indent=1)

    ok = sum(1 for r in results.values() if r.get("result", "").startswith("OK"))
    print("armour imported: %d of %d -> %s" % (ok, len(models), RESULTS))


if __name__ == "__main__":
    main()
