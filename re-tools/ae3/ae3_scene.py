#!/usr/bin/env python3
"""Scan the 3D scene file assets.ae3 of Galaxy on Fire: Alliances 1.16.1 (read-only) and extract meshes.

The 51 KB table at the start of the file (a stream of small u32 values, probably type / length codes) is skipped, not decoded. After it the
file is a stream of objects whose properties are `[4-byte hash][1 byte][UTF-16LE name, NUL-terminated][value]`. Mesh data are arrays:
value = u32 byte length + raw bytes (xyz / nrm / tan / bitan: f32 x 3, uv0_2 / uv1_2: f32 x 2, color0, indx: u16 triangle list, data: texture pixels).
This scanner walks the file by those names, skips the arrays by their length, and groups properties under the last object name seen.

    python3 -I re-tools/ae3/ae3_scene.py FILE list [N]            # meshes (objects with xyz + indx) with counts
    python3 -I re-tools/ae3/ae3_scene.py FILE obj SUBSTRING OUT   # export meshes whose name contains SUBSTRING to OUT.obj
"""
import mmap, re, struct, sys, collections

ARRAYS = {"xyz": 4, "nrm": 4, "tan": 4, "bitan": 4, "uv0_2": 4, "uv1_2": 4, "indx": 2, "data": 1}   # name -> bytes per counted element (the u32 before an array is an ELEMENT count: floats for xyz..uv, u16 for indx, bytes for data)
SCALARS = {"primitiveMode", "usePointSprites", "isSpriteSystem", "isSkybox", "useVertexColors", "visible", "lodThreshold", "bSphereRadius", "bSphereCenter",
           "submesh", "materials", "local", "localName", "parent", "child", "next", "mesh", "color0", "textures", "textureNames", "shaders", "vsCode", "fsCode",
           "renderLayer", "useStencil", "clearStencil", "colorMask", "mergeMeshes", "staticMeshMerge", "dataFormat", "mipMapLevel", "width", "height", "doublesided",
           "addBlend", "minFilter", "repeatMode", "isCubemap", "size", "animation", "attributeKeys", "attributeTimes", "targetNode", "targetAttrUid", "clipLength"}
STR = re.compile(rb"(?:[\x20-\x7e]\x00){2,}\x00\x00")
NAME_OK = re.compile(r"^[A-Za-z0-9_./@\-]{4,}$")
START = 51792   # end of the leading u32 table (first object name follows at 51824)

def scan(path, limit=None):
    f = open(path, "rb"); mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    pos, objs, cur = START, [], None
    while True:
        m = STR.search(mm, pos)
        if not m:
            break
        s = m.group().decode("utf-16le").rstrip("\x00")
        if s in ARRAYS:
            cnt = struct.unpack_from("<I", mm, m.end())[0]
            n = cnt * ARRAYS[s]                    # byte length
            if m.end() + 4 + n > len(mm):          # not really an array property: a false match
                pos = m.end(); continue
            if cur is not None:
                cur["arrays"][s] = (m.end() + 4, n)   # (data offset, byte length)
            pos = m.end() + 4 + n
        elif s in SCALARS:
            pos = m.end()
        elif NAME_OK.match(s):                       # an object / node / material name
            cur = {"name": s, "off": m.start(), "arrays": {}}
            objs.append(cur)
            if limit and len(objs) >= limit:
                break
            pos = m.end()
        else:
            pos = m.end()
    return mm, objs

def mesh_of(mm, o):
    a = o["arrays"]
    if "xyz" not in a or "indx" not in a:
        return None
    nv = a["xyz"][1] // 12
    out = {"name": o["name"], "nv": nv, "ni": a["indx"][1] // 2}
    for k, sz in (("nrm", 12), ("uv0_2", 8), ("tan", 12)):
        if k in a:
            out[k] = a[k][1] // sz
    return out

def main():
    path, cmd = sys.argv[1], sys.argv[2]
    mm, objs = scan(path)
    meshes = [(o, mesh_of(mm, o)) for o in objs]
    meshes = [(o, m) for o, m in meshes if m]
    if cmd == "list":
        n = int(sys.argv[3]) if len(sys.argv) > 3 else 30
        bad = sum(1 for _, m in meshes if ("nrm" in m and m["nrm"] != m["nv"]) or ("uv0_2" in m and m["uv0_2"] != m["nv"]))
        print(f"{len(objs)} named objects, {len(meshes)} meshes (xyz + indx), {bad} with inconsistent normal / uv counts")
        for o, m in meshes[:n]:
            print(f"{m['name']:90s} verts {m['nv']:6d} tris {m['ni'] // 3:6d} nrm {m.get('nrm')} uv {m.get('uv0_2')}")
    elif cmd == "obj":
        sub, out = sys.argv[3], sys.argv[4]
        base = 1; lines = []
        for o, m in meshes:
            if sub not in m["name"]:
                continue
            a = o["arrays"]
            off, n = a["xyz"]; pos = struct.unpack_from(f"<{(n // 12) * 3}f", mm, off)   # arrays carry a few trailing bytes (9 after f32 x 3, 6 after f32 x 2): read whole elements only
            lines.append(f"o {m['name']}")
            lines += [f"v {pos[i]:.6f} {pos[i + 1]:.6f} {pos[i + 2]:.6f}" for i in range(0, len(pos), 3)]
            if "uv0_2" in a:
                off2, n2 = a["uv0_2"]; uv = struct.unpack_from(f"<{(n2 // 8) * 2}f", mm, off2)
                lines += [f"vt {uv[i]:.6f} {1 - uv[i + 1]:.6f}" for i in range(0, len(uv), 2)]
            if "nrm" in a:
                off3, n3 = a["nrm"]; nr = struct.unpack_from(f"<{(n3 // 12) * 3}f", mm, off3)
                lines += [f"vn {nr[i]:.6f} {nr[i + 1]:.6f} {nr[i + 2]:.6f}" for i in range(0, len(nr), 3)]
            off4, n4 = a["indx"]; ix = struct.unpack_from(f"<{n4 // 2}H", mm, off4)
            has_uv, has_n = "uv0_2" in a, "nrm" in a
            for i in range(0, len(ix) - 2, 3):
                face = []
                for k in ix[i:i + 3]:
                    v = base + k
                    face.append(f"{v}/{v if has_uv else ''}/{v}" if has_n and has_uv else f"{v}/{v}" if has_uv else f"{v}//{v}" if has_n else f"{v}")
                lines.append("f " + " ".join(face))
            base += len(pos) // 3
            print("exported", m["name"], m["nv"], "vertices", m["ni"] // 3, "triangles")
        open(out, "w").write("\n".join(lines) + "\n")

if __name__ == "__main__":
    main()
