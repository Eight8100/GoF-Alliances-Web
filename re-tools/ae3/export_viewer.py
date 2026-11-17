#!/usr/bin/env python3
"""Export scene subtrees of assets.ae3 with their real materials and shaders for the WebGL viewer (re-tools/webspike/static/viewer3d.html).

    /Library/Frameworks/Python.framework/Versions/3.12/bin/python3 -I re-tools/ae3/export_viewer.py APP_DIR [OUT_DIR]

Uses the exact object walker ae3_graph.py (docs/ART_3D.md "Object grammar"). Writes OUT_DIR (default art/extracted/3d, git-ignored Fishlabs
material, never publish):
  scene.json  nodes (local 3x4 matrices, children, mesh), meshes (sub-meshes + material per slot), geometry (offsets into scene.bin),
              materials (shader program ids, sampler name -> texture, uniform values, render states), shaders (the original GLSL ES sources),
              planets (the nine planet materials + their atmosphere materials, assigned by game code at runtime)
  scene.bin   f32 attributes, u8 vertex colours, u16 indices
  tex/NAME.rgb.png + NAME.a.png      colour and alpha apart (browsers may premultiply a PNG with alpha); cubemaps as NAME.f0..f5 in GL order
                                     (+X -X +Y -Y +Z -Z), re-ordered from the stored order by cubesolve.py's edge matching (CUBE_ORDER below)
Needs numpy + Pillow."""
import json, os, struct, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ae3_graph as G, ae3_tex as T

BUILDINGS = ["hq", "spaceport", "metal_extractor", "gas_extractor", "crystal_extractor", "barracks", "research", "scanner", "planetary_shield", "trade_center",
             "artifact_center_type_a", "socket"]   # structure types 1-11 in port.js order (shipyard = spaceport, laboratory = research, defence = planetary_shield, citadel = artifact centre) + the pad
SHIPS = {"terran": "/ships_terran_command_ship", "vossk": "/ships_vossk_command_ship", "nivelian": "/nivellian_command_ship", "void": "/ships_void_command_ship"}   # species 1 / 2 / 3 / 4 (0x100373bd0)
SYSTEM = ["/system_planet_sun", "/system_ring", "/system_fx"] + ["/system_planet_" + t for t in ("ocean", "jungle", "ice", "mountain", "volcano", "desert", "citadel_a", "citadel_b", "citadel_c")] + ["/terran_jumpgate", "/vossk_jumpgate", "/nivelian_jumpgate"]   # the star system view (gofa3d.js R.system) + the species' jumpgates
ROOTS = ["/planet", "/planet_sun", "/planets_lens_flare", "/lensdirt"] + list(SHIPS.values()) + SYSTEM + [ "/planet_artifact_type_a_scene", "/planet_artifact_type_b_scene", "/planet_artifact_type_c_scene"] + ["/building_%s_%s" % (sp, b) for sp in ("terran", "nivelian", "vossk") for b in BUILDINGS]
SKIP = ("_command_ship_moving",)     # engine, trail, space particles + fog: shown only while the ship flies (0x100375cc8). NOT the *_body_mesh
                                     # nodes: they are the Nivelian / Void hulls (the Terran one is a small fx quad)
# stored face k of a planet cubemap -> GL target. Found with cubesolve.py: with these targets and no flips every face has the GL orientation
# (sc / tc axes) and all 12 edges join; the order itself is the engine's own (not +X -X +Y -Y +Z -Z). A mirror image would also join; it is not visible.
CUBE_ORDER = {0: 2, 1: 1, 2: 4, 3: 0, 4: 5, 5: 3}      # stored -> GL index (0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z)
STATES = {"useStencil", "mergeMeshes", "colorMask", "renderLayer", "clearStencil", "staticMeshMerge", "uOffset", "vOffset", "subMaterialRenderOrder",
          "subLayerRenderOrder", "addBlend", "doublesided", "alphaBlend", "forceDepthWrite", "noDepthTest", "stencilMask", "stencilFunc", "stencilRef",
          "stencilOpDepthTestFailAction", "stencilOpOkAction", "stencilOpFailAction", "subBlend"}

def main():
    app = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else "art/extracted/3d"; path = os.path.join(app, "assets_pvrtc", "assets.ae3")
    os.makedirs(os.path.join(out, "tex"), exist_ok=True)
    mm, objs, byh = G.load(path); byname = {o.name: o for o in objs}
    blob = bytearray()
    def put(b):
        off = len(blob); blob.extend(b); blob.extend(b"\0" * ((-len(blob)) % 4)); return off
    scene = {"nodes": {}, "meshes": {}, "geoms": {}, "materials": {}, "shaders": {}, "textures": {}, "roots": [], "planets": []}
    def ref(v):
        return byh.get(v[1]) if v else None

    def material(m):
        if m.name in scene["materials"]: return m.name
        p = m.props; tex = {}
        for sname, (t, h) in zip(p.get("textureNames", []), p.get("textures", [])):
            if h in byh: tex[sname] = texture(byh[h])
        progs = []
        for t, h in p.get("shaders", []):
            s = byh.get(h)
            if s is None: continue
            scene["shaders"].setdefault(s.name, {"vs": s.props["vsCode"], "fs": s.props["fsCode"]}); progs.append(s.name)
        uni = {}
        for k, v in p.items():
            if k in STATES or k in ("textureNames", "textures", "shaders"): continue
            if isinstance(v, (int, float)): uni[k] = v
            elif isinstance(v, list) and v and isinstance(v[0], float): uni[k] = v
        st = {k: p[k] for k in STATES if k in p and k != "colorMask"}
        if "colorMask" in p: st["colorMask"] = list(mm[p["colorMask"][0]:p["colorMask"][0] + p["colorMask"][1]])
        scene["materials"][m.name] = {"shaders": progs, "textures": tex, "uniforms": uni, "states": st}
        return m.name

    def texture(t):
        nm = t.name.replace("assets/", "").replace("/", "_").rsplit(".", 1)[0]
        if nm in scene["textures"]: return nm
        p = t.props; w, h, fmt = p["width"], p["height"], p["dataFormat"]
        d = {"name": t.name, "off": p["data"][0], "len": p["data"][1], "width": w, "height": h, "dataFormat": fmt}
        a = T.decode(mm, d)
        info = {"w": w, "h": h, "fmt": fmt, "cube": bool(p.get("isCubemap")), "repeat": p.get("repeatMode", 0), "ok": a is not None}
        if a is not None:
            if info["cube"]:
                for k in range(6):
                    f = a[k * w:(k + 1) * w]; g = CUBE_ORDER[k]
                    Image.fromarray(np.ascontiguousarray(f[..., :3]), "RGB").save(os.path.join(out, "tex", "%s.f%d.rgb.png" % (nm, g)))
                    Image.fromarray(np.ascontiguousarray(f[..., 3]), "L").save(os.path.join(out, "tex", "%s.f%d.a.png" % (nm, g)))
            else:
                Image.fromarray(np.ascontiguousarray(a[..., :3]), "RGB").save(os.path.join(out, "tex", nm + ".rgb.png"))
                Image.fromarray(np.ascontiguousarray(a[..., 3]), "L").save(os.path.join(out, "tex", nm + ".a.png"))
        else:
            print("  texture not decoded (format %d): %s" % (fmt, t.name))
        scene["textures"][nm] = info
        return nm

    def geom(sm):
        if sm.name in scene["geoms"]: return sm.name
        p = sm.props; e = {"mode": p.get("primitiveMode"), "sprites": p.get("usePointSprites", 0)}
        nv = p["xyz"][1] // 12 if "xyz" in p else 0; e["nv"] = nv
        for k, key in (("xyz", "pos"), ("nrm", "nrm"), ("tan", "tan"), ("bitan", "bitan"), ("uv0_2", "uv0"), ("uv1_2", "uv1"), ("color0", "col")):
            if k in p:
                off, ln = p[k]; e[key] = put(bytes(mm[off:off + ln]))
        if "indx" in p:
            off, ln = p["indx"]; e["ni"] = ln // 2; e["idx"] = put(bytes(mm[off:off + ln]))
        if p.get("isSpriteSystem"):
            # a sprite system (engine 0x100993fb4, called each frame from 0x1009cc5fc): xyz = one centre per sprite, size = (w, h) per sprite,
            # uv0 / nrm / tan / bitan / color0 = 4 corners per sprite. The engine builds a quad facing the camera for each sprite with w and h
            # not 0: P - U h/2 - R w/2, P - U h/2 + R w/2, P + U h/2 + R w/2, P + U h/2 - R w/2 (R / U = the camera's right / up axes in the
            # node's local space), indices 0 1 2 0 2 3. No index list in the file.
            e["sprite"] = 1; e["size"] = put(struct.pack("<%df" % len(p["size"]), *p["size"]))
        scene["geoms"][sm.name] = e
        return sm.name

    def mesh(me):
        if me.name in scene["meshes"]: return me.name
        subs = [byh.get(h) for t, h in me.props.get("submesh", [])]; mats = [byh.get(h) for t, h in me.props.get("materials", [])]
        parts = []
        for i, sm in enumerate(subs):
            if sm is None or "xyz" not in sm.props: continue
            m = mats[i] if i < len(mats) else None
            parts.append({"geom": geom(sm), "material": material(m) if m is not None else None})
        scene["meshes"][me.name] = {"parts": parts, "radius": me.props.get("bSphereRadius"), "center": me.props.get("bSphereCenter")}
        return me.name

    def node(o):
        n = {"name": o.props.get("localName", o.name), "local": o.props.get("local"), "visible": o.props.get("visible", 1), "children": []}
        me = ref(o.props.get("mesh"))
        if me is not None: n["mesh"] = mesh(me)
        c = ref(o.props.get("child"))
        while c is not None:
            if not any(s in c.name for s in SKIP): n["children"].append(node(c))
            c = ref(c.props.get("next"))
        scene["nodes"][o.name] = n
        return o.name

    for r in ROOTS:
        scene["roots"].append(node(byname[r])); print("root", r)
    # animation clips (tag 0x12: tracks + clipLength ms, played looping) whose tracks drive exported nodes. Transform tracks (0x14): absolute local
    # TRS keys (rotation quaternion xyzw, scale / translate per axis, each with its own times in ms) in the track or in its 0x2a data object;
    # visibility tracks (0x1b): 0 / 1 per time (step). Key 0 equals the node's static local matrix (checked on the Terran gas extractor).
    scene["anims"] = {}
    for c in objs:
        if c.tag != 0x12: continue
        tracks = []
        for t, h in c.props.get("animation", []):
            tr = byh.get(h)
            if tr is None or "targetNode" not in tr.props: continue
            node = byh.get(tr.props["targetNode"][1])
            if node is None or node.name not in scene["nodes"]: continue
            if tr.tag == 0x1b:
                tracks.append({"node": node.name, "vis": {"t": tr.props["attributeTimes"], "k": [round(x, 4) for x in tr.props["attributeKeys"]]}})
            else:
                d = byh.get(tr.props["matrixAnimationData"][1]) if "matrixAnimationData" in tr.props else tr
                e = {"node": node.name}
                for key in ("rotation", "scaleX", "scaleY", "scaleZ", "translateX", "translateY", "translateZ"):
                    if key + "Time" in d.props: e[key] = {"t": d.props[key + "Time"], "k": [round(x, 5) for x in d.props[key + "Key"]]}
                tracks.append(e)
        if tracks: scene["anims"][c.name] = {"length": c.props.get("clipLength", 0), "tracks": tracks}
    print(len(scene["anims"]), "animation clips")
    for o in objs:   # planet materials: assigned to planet_mesh / planet_mesh_atmo by the game (their slots are empty in the file)
        if o.tag == 0x0c and o.name.startswith("assets/planets/planetCube_") and o.name.endswith(".mat") and "_atmo" not in o.name and "_defense" not in o.name:
            atmo = byname.get(o.name.replace(".mat", "_atmo.mat"))
            scene["planets"].append({"name": o.name.split("planetCube_")[1][:-4], "material": material(o), "atmo": material(atmo) if atmo else None})
            print("planet", scene["planets"][-1]["name"])
    for c in "abc":   # the carrier overlays the game puts on the top stage's *_artifact mesh (gofa3d.js R.ship): a red, b blue, c yellow
        material(byname["assets/ships/ships_artifacts/ships_artifacts_%s.mat" % c])
    material(byname["assets/systems/system_skybox/system_skybox_cubemap_01.mat"])   # the nebula skybox (gofa3d.js R.skybox; colours / rotation set per star system)
    for sp in ("terran", "nivelian", "vossk"):   # the ground ring under a building: a quad built by game code with this material (gofa3d.js R.ring)
        material(byname["assets/buildings/%s_ring/%s_ring.mat" % (sp, sp)])
    for nm in ("planet_mesh", "planet_mesh_atmo"):
        mesh(byname[nm])
    open(os.path.join(out, "scene.bin"), "wb").write(blob); json.dump(scene, open(os.path.join(out, "scene.json"), "w"))
    print(len(scene["nodes"]), "nodes,", len(scene["meshes"]), "meshes,", len(scene["materials"]), "materials,", len(scene["shaders"]), "shaders,",
          len(scene["textures"]), "textures,", len(blob) // 1024, "KB geometry ->", out)

if __name__ == "__main__":
    main()
