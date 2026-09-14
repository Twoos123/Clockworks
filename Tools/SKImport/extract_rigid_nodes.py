"""
Pull rigid (unskinned) mesh nodes out of a ThreeRingsSharp GLB into their own GLB, re-based
into a bone's local space, so Unreal can import them as a static mesh that attaches to that
bone with an identity offset.

Why: Spiral Knights builds some heads (the Mechaknight's mesh_helmet + mesh_icon) as MeshNodes
that TRS exports as orphan scene nodes in model space. Interchange ignores orphans, so the
head never reached the project. The knight's own helmet/face export correctly parented under
bone_helmet, so this script is only needed for models where TRS lost the parent.

Usage:
  python Tools/SKImport/extract_rigid_nodes.py <src.glb> <out.glb> <bone> <node>[,<node>...]

Materials are deliberately left off the output: the material assets already exist in the
project from the main import, and the head component overrides them in the Blueprint.
"""
import json
import os
import struct
import sys

import numpy as np

CT = {"VEC2": 2, "VEC3": 3, "VEC4": 4, "SCALAR": 1, "MAT4": 16}
DT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}


def read_glb(path):
    d = open(path, "rb").read()
    jl = struct.unpack("<I", d[12:16])[0]
    g = json.loads(d[20:20 + jl])
    bl = struct.unpack("<I", d[20 + jl:24 + jl])[0]
    return g, d[28 + jl:28 + jl + bl]


def accessor(g, blob, idx):
    a = g["accessors"][idx]
    bv = g["bufferViews"][a["bufferView"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = a["count"] * CT[a["type"]]
    return np.frombuffer(blob, dtype=DT[a["componentType"]], count=n, offset=off).reshape(a["count"], -1)


def bone_bind_world(g, blob, bone):
    skin = g["skins"][0]
    ibm = accessor(g, blob, skin["inverseBindMatrices"])
    for j, ni in enumerate(skin["joints"]):
        if g["nodes"][ni]["name"] == bone:
            return np.linalg.inv(ibm[j].reshape(4, 4).T)  # glTF matrices are column-major
    raise SystemExit(f"bone {bone!r} not in skin")


def node_local(n):
    if "matrix" in n:
        return np.array(n["matrix"], dtype=float).reshape(4, 4).T
    x, y, z, w = n.get("rotation", [0, 0, 0, 1])
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4)
    m[:3, :3] = r * np.array(n.get("scale", [1, 1, 1]))
    m[:3, 3] = n.get("translation", [0, 0, 0])
    return m


def node_global(g, idx, parent):
    """Rest-pose transform of a node in model space, composed up its parent chain. Interchange
    bakes exactly this into a static mesh, so it is what we have to undo."""
    m = node_local(g["nodes"][idx])
    return node_global(g, parent[idx], parent) @ m if idx in parent else m


def main(src, dst, bone, node_names):
    g, blob = read_glb(src)
    asset_name = os.path.splitext(os.path.basename(dst))[0]  # becomes the Unreal asset name
    world = bone_bind_world(g, blob, bone)
    to_local = np.linalg.inv(world)
    parent = {c: i for i, n in enumerate(g["nodes"]) for c in n.get("children", [])}

    out_json = {
        "asset": {"version": "2.0", "generator": "Clockworks extract_rigid_nodes"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"name": asset_name, "mesh": 0}],
        "meshes": [{"name": asset_name, "primitives": []}],
        "accessors": [], "bufferViews": [], "buffers": [],
    }
    chunks = []

    def push(arr, target, comp_type, kind):
        arr = np.ascontiguousarray(arr)
        raw = arr.tobytes()
        raw += b"\0" * ((4 - len(raw) % 4) % 4)
        offset = sum(len(c) for c in chunks)
        chunks.append(raw)
        out_json["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(arr.tobytes()), "target": target})
        acc = {"bufferView": len(out_json["bufferViews"]) - 1, "componentType": comp_type, "count": len(arr), "type": kind}
        if kind == "VEC3" and comp_type == 5126:
            acc["min"] = arr.min(0).tolist()
            acc["max"] = arr.max(0).tolist()
        out_json["accessors"].append(acc)
        return len(out_json["accessors"]) - 1

    found = 0
    seen_meshes = set()
    for idx, node in enumerate(g["nodes"]):
        short = node.get("name", "")
        if "mesh" not in node or not any(f'"{n}"' in short or short == n for n in node_names):
            continue
        if node["mesh"] in seen_meshes:
            continue  # the knight lists its face twice; one copy is enough
        seen_meshes.add(node["mesh"])
        found += 1
        # model space = node's rest transform applied to its local vertices; then into bone space
        xform = to_local @ node_global(g, idx, parent)
        rot = xform[:3, :3]
        mesh = g["meshes"][node["mesh"]]
        for prim in mesh["primitives"]:
            attrs = prim["attributes"]
            pos = accessor(g, blob, attrs["POSITION"]).astype(np.float32)
            pos = (pos @ rot.T + xform[:3, 3]).astype(np.float32)
            new_attrs = {"POSITION": push(pos, 34962, 5126, "VEC3")}
            if "NORMAL" in attrs:
                nrm = accessor(g, blob, attrs["NORMAL"]).astype(np.float32)
                nrm = nrm @ np.linalg.inv(rot)  # rotation only (inverse-transpose == rotation); scale cancels below
                nrm = (nrm / np.linalg.norm(nrm, axis=1, keepdims=True).clip(1e-8)).astype(np.float32)
                new_attrs["NORMAL"] = push(nrm, 34962, 5126, "VEC3")
            if "TEXCOORD_0" in attrs:
                new_attrs["TEXCOORD_0"] = push(accessor(g, blob, attrs["TEXCOORD_0"]).astype(np.float32), 34962, 5126, "VEC2")
            new_prim = {"attributes": new_attrs, "mode": prim.get("mode", 4)}
            if "indices" in prim:
                ia = g["accessors"][prim["indices"]]
                idx = accessor(g, blob, prim["indices"]).reshape(-1)
                new_prim["indices"] = push(idx, 34963, ia["componentType"], "SCALAR")
            out_json["meshes"][0]["primitives"].append(new_prim)
    if found == 0:
        raise SystemExit(f"none of {node_names} found")

    blob_out = b"".join(chunks)
    out_json["buffers"].append({"byteLength": len(blob_out)})
    js = json.dumps(out_json, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(blob_out), 0x004E4942) + blob_out
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body)
    print(f"wrote {dst}: {found} nodes, {len(out_json['meshes'][0]['primitives'])} primitives, bone {bone} at {world[:3, 3].round(3).tolist()}")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split(","))
