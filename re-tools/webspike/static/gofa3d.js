/* GoFA3D: renders the original 3D scene data with the ORIGINAL shaders (raw WebGL 1, no library).
   Data: /art/3d/scene.json + scene.bin + tex/ from re-tools/ae3/export_viewer.py (Fishlabs material from the owner's own app copy: local use only).
   What comes from the game file: meshes, node transforms, materials (uniform values, sampler -> texture, render states) and the GLSL ES
   shader programs (vsCode / fsCode, used as they are). What the engine set at runtime and is supplied here: the matrices, camera / light in
   object space (u_cameraPositionLocal, u_lightDirectionLocal), the light colours and shininess (L below: calibrated against the owner's
   recordings, see docs/ART_3D.md), the time uniforms, and the planet's material (its slot is empty in the file; the game assigns it).
   Stencil enums inferred from the planet / atmosphere / skybox materials: func 3 = always (planet writes ref 1), func 4 = equal (atmosphere and
   skybox only where nothing wrote, i.e. outside the planet disc); op 1 = keep, 2 = replace.
   API: const r = await GoFA3D.create(canvas, {base}); r.setPlanet(type) / r.setRoot(name, {visible}) ; r.frame(camera) ; r.L (lights). */
(function (global) {
  "use strict";
  const M = {
    ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
    persp(fy, asp, n, f) { const t = 1 / Math.tan(fy / 2), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; },
    look(e, c, u) { const z = norm(sub(e, c)), x = norm(cross(u, z)), y = cross(z, x); return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]); },
    rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
    trans(x, y, z) { const m = M.ident(); m[12] = x; m[13] = y; m[14] = z; return m; },
    scale(s) { const m = M.ident(); m[0] = m[5] = m[10] = s; return m; },
    from34(l) { return new Float32Array([l[0], l[4], l[8], 0, l[1], l[5], l[9], 0, l[2], l[6], l[10], 0, l[3], l[7], l[11], 1]); },   // 3x4 row-major -> column-major 4x4
    inv(m) {   // general 4x4 inverse
      const a = m, o = new Float32Array(16);
      const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
      const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
      const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
      o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * d; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * d; o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * d; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * d;
      o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * d; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * d; o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * d; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * d;
      o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * d; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * d; o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * d; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * d;
      o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * d; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * d; o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * d; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * d;
      return o;
    },
    xform(m, v, w) { return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * w, m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * w, m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * w]; },
  };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // the game's generator (java.util.Random's LCG; port.js gameRandom): seeded ((seed & 2^36-1) ^ 0x5DEECE66D) * 0x5DEECE66D + 0xB, nextFloat = bits 24-47 / 2^24
  function gameRandom(seed) {
    const MUL = 0x5DEECE66Dn, M48 = (1n << 48n) - 1n; let s = ((((BigInt(seed) & 0xFFFFFFFFFn) ^ MUL) * MUL) + 0xBn) & M48;
    return () => { s = (s * MUL + 0xBn) & M48; return Number((s >> 24n) & 0xFFFFFFn) * 5.960464477539063e-08; };
  }
  /* Planet layout of the star system view, from the game (0x10032b1c8; constants 0x100ae7c08-0x100ae7c24): planets in list order i (at most 7);
     base angle = f * 2 pi from a generator seeded with the system type; slot angle = base + [0, 3, 1, 4, 2, 6, 5][i] * 2 pi / 7; orbit radius
     R = (i + 1) * 12573 + 14000 + (f * 4000 - 2000) with f from a generator seeded with (planet field 6) * (system type) (int product), the first
     planet's offset kept >= 0; scale = ((pads (field 5) - 5) / 7) * 0.6 + 1. planets: [{ type, pads, seed }] */
  function systemLayout(planets, systemType) {   // systemType = the system record's seed (map field 4, e.g. 122842 for Home; the type 1-12 as a fallback), see ART_3D.md 'System view seed'
    const base = gameRandom(systemType | 0)() * 6.2831854820251465, ORDER = [0, 3, 1, 4, 2, 6, 5];
    return planets.slice(0, 7).map((p, i) => {
      let off = gameRandom(Math.imul(p.seed | 0, systemType | 0))() * 4000 - 2000; if (i === 0 && off <= 0) off = 0;
      return { type: p.type, radius: (i + 1) * 12573 + 14000 + off, angle: -(base + ORDER[i] * 0.8975979089736938), scale: (((p.pads || 12) - 5) / 7) * 0.6 + 1 };   // angle NEGATED (2026-11-12): with the mirrored render only the reversed sense fits Random2_t14 / t20 (planet centres AND radii, 9-12 px rms; the unfitted gate within 5 / 14 px); the game's angle as decoded went round the wrong way
    });
  }
  /* The system view's camera (0x10032bffc / 0x10032c954 / pinch 0x10032ecb4): looks at the sun from distance d (starts at 610022 = fully out;
     a two-finger pinch zooms within [242011, 610022], 0x100ae7c60 / 0x100ae7c64), pitched by -0.5 rad (vertical drag: pitch in [-1, 0.5]),
     yaw free (0.00015 x 2 pi rad per point), 20 degree field of view (horizontal here: it fits Random2_t14), clip 4400 .. 1234000. */
  function systemCamera(yaw = 0, pitch = -0.5, aspect = 4 / 3, dist = 610022, target = null) {   // target: a planet the camera flies to (the pinch range does not apply then)
    const d = target ? dist : Math.max(242011, Math.min(610022, dist)), t = target || [0, 0, 0], e = [t[0] + d * Math.cos(-pitch) * Math.sin(yaw), t[1] + d * Math.sin(-pitch), t[2] + d * Math.cos(-pitch) * Math.cos(yaw)];
    return { eye: e, target: t, fov: 2 * Math.atan(Math.tan(10 * Math.PI / 180) / aspect), near: Math.min(4400, d / 20), far: 1234000 };
  }
  async function create(canvas, opts = {}) {
    const BASE = opts.base || "/art/3d/";
    const gl = canvas.getContext("webgl", { antialias: true, alpha: !!opts.transparent, stencil: true, premultipliedAlpha: !!opts.transparent, preserveDrawingBuffer: !!opts.preserve });
    if (!gl) throw new Error("WebGL is not available");
    // opts.source: the scene built in the browser from the owner's IPA (ae3scene.js via art.js GoFAArt.source3d: { scene, bin, rgba(name) -> Promise
    // or value { w, h, data } }); otherwise the relay's exported files under BASE (development)
    const SRC = opts.source || null;
    const scene = SRC ? SRC.scene : await (await fetch(BASE + "scene.json")).json(), bin = SRC ? (SRC.bin.buffer && !(SRC.bin instanceof ArrayBuffer) ? SRC.bin.buffer.slice(SRC.bin.byteOffset, SRC.bin.byteOffset + SRC.bin.byteLength) : SRC.bin) : await (await fetch(BASE + "scene.bin")).arrayBuffer();
    // planet / building views: the planet scene's light (0x1002d58a4): directional, ambient 0.3, diffuse 0.8, specular 1, shininess 32 (2026-11-12;
    // was by eye: ambient 0.22 / 0.25 / 0.32, diffuse 1 / 0.97 / 0.92, shininess 24). port.js sets the planet screen's direction (the sun's, measured) and its per-frame ambient (0x1002db90c).
    const L_DEFAULT = { pos: null, ambient: [0.3, 0.3, 0.3], diffuse: [0.8, 0.8, 0.8], specular: [1, 1, 1], shininess: 32 };
    const R = { gl, M, scene, fromIpa: !!SRC, L: { ...L_DEFAULT, dir: norm([0.95, 0.3, -0.05]) },
      time: 0, items: [], log: [], planet: null, stats: {} };

    // ---- geometry -----------------------------------------------------------------------------------------------------------------------------
    const geoms = {};
    function geom(name) {
      if (geoms[name]) return geoms[name];
      const e = scene.geoms[name], g = { n: e.ni, nv: e.nv, attr: {}, mode: e.mode };
      const buf = (off, n, Arr) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Arr(bin, off, n), gl.STATIC_DRAW); return b; };
      if (e.sprite) {   // sprite system (export_viewer.py): one centre + (w, h) per sprite, 4 corners of uv / normal / colour; the quads are built per draw (spriteQuads)
        const ns = e.nv, I = new Uint16Array(ns * 6);
        for (let i = 0; i < ns; i++) I.set([4 * i, 4 * i + 1, 4 * i + 2, 4 * i, 4 * i + 2, 4 * i + 3], 6 * i);
        g.n = ns * 6; g.nv = ns * 4; g.sprite = { c: new Float32Array(bin, e.pos, ns * 3), s: new Float32Array(bin, e.size, ns * 2), p: new Float32Array(ns * 12) };
        g.attr.a_position = { b: gl.createBuffer(), n: 3 }; gl.bindBuffer(gl.ARRAY_BUFFER, g.attr.a_position.b); gl.bufferData(gl.ARRAY_BUFFER, g.sprite.p.byteLength, gl.DYNAMIC_DRAW);
        if (e.nrm != null) g.attr.a_normal = { b: buf(e.nrm, ns * 12, Float32Array), n: 3 };
        if (e.tan != null) g.attr.a_tangent = { b: buf(e.tan, ns * 12, Float32Array), n: 3 };
        if (e.bitan != null) g.attr.a_bitangent = { b: buf(e.bitan, ns * 12, Float32Array), n: 3 };
        if (e.uv0 != null) g.attr.a_texCoord0 = g.attr.a_texCoord1 = { b: buf(e.uv0, ns * 8, Float32Array), n: 2 };
        if (e.col != null) g.attr.a_vtxColor = { b: buf(e.col, ns * 16, Uint8Array), n: 4, type: gl.UNSIGNED_BYTE, normalized: true };
        g.idx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
        return (geoms[name] = g);
      }
      if (e.pos != null) g.attr.a_position = { b: buf(e.pos, e.nv * 3, Float32Array), n: 3 };
      if (e.nrm != null) g.attr.a_normal = { b: buf(e.nrm, e.nv * 3, Float32Array), n: 3 };
      if (e.tan != null) g.attr.a_tangent = { b: buf(e.tan, e.nv * 3, Float32Array), n: 3 };
      if (e.bitan != null) g.attr.a_bitangent = { b: buf(e.bitan, e.nv * 3, Float32Array), n: 3 };
      if (e.uv0 != null) g.attr.a_texCoord0 = { b: buf(e.uv0, e.nv * 2, Float32Array), n: 2 };
      if (e.uv1 != null) g.attr.a_texCoord1 = { b: buf(e.uv1, e.nv * 2, Float32Array), n: 2 };
      else if (e.uv0 != null) g.attr.a_texCoord1 = g.attr.a_texCoord0;
      if (e.col != null) g.attr.a_vtxColor = { b: buf(e.col, e.nv * 4, Uint8Array), n: 4, type: gl.UNSIGNED_BYTE, normalized: true };
      g.idx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(bin, e.idx, e.ni), gl.STATIC_DRAW);
      return (geoms[name] = g);
    }

    // ---- textures: colour and alpha come as two PNGs; combined on a canvas into raw RGBA so nothing is premultiplied ----------------------------
    const texCache = {}, img = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("missing " + src)); i.src = src; });
    const cv2 = document.createElement("canvas"), c2 = cv2.getContext("2d", { willReadFrequently: true });
    async function rgba(base) {
      if (SRC) { const t = await SRC.rgba(base); return { w: t.w, h: t.h, data: t.data instanceof Uint8Array ? t.data : new Uint8Array(t.data.buffer || t.data) }; }
      const [a, b] = await Promise.all([img(BASE + "tex/" + base + ".rgb.png"), img(BASE + "tex/" + base + ".a.png")]);
      cv2.width = a.width; cv2.height = a.height; c2.drawImage(a, 0, 0); const px = c2.getImageData(0, 0, a.width, a.height);
      c2.drawImage(b, 0, 0); const al = c2.getImageData(0, 0, a.width, a.height).data; for (let i = 3; i < px.data.length; i += 4) px.data[i] = al[i - 3];
      return { w: a.width, h: a.height, data: new Uint8Array(px.data.buffer) };
    }
    const white = (() => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255])); return t; })();
    const whiteCube = (() => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_CUBE_MAP, t); for (let f = 0; f < 6; f++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255])); return t; })();
    function texture(name) {
      if (texCache[name]) return texCache[name];
      const info = scene.textures[name], cube = info && info.cube, rec = { tex: cube ? whiteCube : white, cube, ready: false };
      texCache[name] = rec;
      if (!info || !info.ok) { rec.ready = true; R.log.push("texture not decoded: " + name); return rec; }
      rec.promise = (async () => {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        const t = gl.createTexture(), aniso = gl.getExtension("EXT_texture_filter_anisotropic");
        if (cube) {
          const faces = await Promise.all([0, 1, 2, 3, 4, 5].map((f) => rgba(name + ".f" + f)));
          gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
          faces.forEach((f, i) => gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA, f.w, f.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, f.data));
          gl.generateMipmap(gl.TEXTURE_CUBE_MAP); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        } else {
          const f = await rgba(name); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, f.w, f.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, f.data);
          // repeatMode from the file: 1 = clamp (set on every cubemap, the lens flare, system_global_glow_01 = glow_b: its four mirrored quadrants
          // meet at uv 1, and REPEAT blended in the uv-0 texels there = a dark cross through the sun), 0 = repeat (Clouds*, the UV-scrolled fx), 2 = only on Vossk buildings, kept as repeat
          const pow2 = !(f.w & (f.w - 1)) && !(f.h & (f.h - 1)), rep = pow2 && info.repeat !== 1 ? gl.REPEAT : gl.CLAMP_TO_EDGE;
          if (pow2) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, rep); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, rep);
          if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
        }
        rec.tex = t; rec.ready = true;
      })().catch((e) => { rec.ready = true; R.log.push(String(e.message || e)); });
      return rec;
    }

    // ---- the original shader programs ------------------------------------------------------------------------------------------------------------
    const progCache = {};
    function compile(id) {
      if (id in progCache) return progCache[id];
      const src = scene.shaders[id], mk = (type, s) => { const h = gl.createShader(type); gl.shaderSource(h, s); gl.compileShader(h); if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(h)); return h; };
      try {
        const p = gl.createProgram();
        gl.attachShader(p, mk(gl.VERTEX_SHADER, src.vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, "precision highp float;\n" + src.fs)); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, "")] = { loc: gl.getUniformLocation(p, a.name), type: a.type }; }
        const attr = {}, na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
        for (let i = 0; i < na; i++) { const a = gl.getActiveAttrib(p, i); attr[a.name] = gl.getAttribLocation(p, a.name); }
        return (progCache[id] = { p, u, attr, id, file: (/\/\/File: (\S+)/.exec(src.vs) || [])[1] });
      } catch (e) { R.log.push("shader " + id + ": " + String(e.message).split("\n")[0]); return (progCache[id] = null); }
    }
    function programFor(mat, fade) {   // a material lists several programs (variants); the last one that compiles is the lit, full-quality one;
      // a node faded by an alpha track (fade) takes the last variant that has u_opacity (e.g. unlit: gl_FragColor.a *= u_opacity), if there is one
      if (fade) {
        if (mat._progFade === undefined) { let pr = null; for (let i = mat.shaders.length - 1; i >= 0 && !pr; i--) if (/u_opacity/.test(scene.shaders[mat.shaders[i]].fs)) pr = compile(mat.shaders[i]); mat._progFade = pr; }
        if (mat._progFade) return mat._progFade;
      }
      if (mat._prog !== undefined) return mat._prog;
      let pr = null; for (let i = mat.shaders.length - 1; i >= 0 && !pr; i--) pr = compile(mat.shaders[i]);
      return (mat._prog = pr);
    }
    function setU(u, v) {
      if (!u) return; const T = gl, a = Array.isArray(v) ? v : [v];
      switch (u.type) {
        case T.FLOAT: gl.uniform1f(u.loc, a[0]); break; case T.FLOAT_VEC2: gl.uniform2f(u.loc, a[0], a[1] ?? 0); break;
        case T.FLOAT_VEC3: gl.uniform3f(u.loc, a[0], a[1] ?? 0, a[2] ?? 0); break; case T.FLOAT_VEC4: gl.uniform4f(u.loc, a[0], a[1] ?? 0, a[2] ?? 0, a[3] ?? 1); break;
        case T.INT: case T.BOOL: gl.uniform1i(u.loc, a[0] | 0); break; case T.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
      }
    }

    // ---- scene assembly: draw items = (world matrix, geometry, material) -------------------------------------------------------------------
    // ---- animation (scene.anims from export_viewer.py): clips loop; transform tracks give the node's whole local TRS, visibility tracks 0 / 1 ------
    const animByNode = {};
    for (const [clip, c] of Object.entries(scene.anims || {})) for (const tr of c.tracks) (animByNode[tr.node] = animByNode[tr.node] || []).push({ len: c.length || 1, tr, clip });
    function seg(T, t) { let i = 0; while (i < T.length - 2 && T[i + 1] <= t) i++; const span = T[i + 1] - T[i]; return [i, span > 0 ? Math.min(1, Math.max(0, (t - T[i]) / span)) : 0]; }
    function scalar(ch, t, dflt) { if (!ch || !ch.t.length) return dflt; if (ch.t.length === 1) return ch.k[0]; const [i, f] = seg(ch.t, t); return ch.k[i] + (ch.k[i + 1] - ch.k[i]) * f; }
    function quat(ch, t) {
      if (!ch || !ch.t.length) return [0, 0, 0, 1]; const K = ch.k; if (ch.t.length === 1) return K.slice(0, 4);
      const [i, f] = seg(ch.t, t), a = K.slice(i * 4, i * 4 + 4), b = K.slice(i * 4 + 4, i * 4 + 8), sg = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
      const q = a.map((v, j) => v + (sg * b[j] - v) * f), l = Math.hypot(...q) || 1; return q.map((v) => v / l);
    }
    // -> { local (column-major) or null, alpha }. The 0x1b tracks are named "..._Visibility" but their targetAttrUid is CRC32("alpha"): float keys
    // (0..1 fades, e.g. the gas extractor puffs f1-f7), sampled linearly like the other channels; alpha <= 0 hides the subtree, alpha is inherited
    function animate(path, n, tms) {
      const list = animByNode[path]; if (!list) return null; let local = null, alpha = 1;
      for (const { len, tr } of list) {
        const t = ((tms % len) + len) % len;
        if (tr.vis) { alpha *= scalar(tr.vis, t, 1); continue; }
        const L = n.local || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], [x, y, z, w] = quat(tr.rotation, t);
        const sx = scalar(tr.scaleX, t, 1), sy = scalar(tr.scaleY, t, 1), sz = scalar(tr.scaleZ, t, 1);
        const tx = scalar(tr.translateX, t, L[3]), ty = scalar(tr.translateY, t, L[7]), tz = scalar(tr.translateZ, t, L[11]);
        local = new Float32Array([(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
          2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1]);
      }
      return { local, alpha };
    }
    R.animate = true;
    function collect(nodeName, parent, out, filter, tOff = 0, alpha = 1) {
      const n = scene.nodes[nodeName]; if (!n) return;
      const an = R.animate ? animate(nodeName, n, R.time * 1000 + tOff) : null;
      if (an) { alpha *= an.alpha; if (alpha <= 0.002) return; }
      const w = an && an.local ? M.mul(parent, an.local) : n.local ? M.mul(parent, M.from34(n.local)) : parent;
      if (filter && filter(n) === false) return;
      if (n.mesh) for (const part of scene.meshes[n.mesh].parts) if (part.material) out.push({ node: n.name, world: w, geom: part.geom, mat: scene.materials[part.material], matName: part.material, alpha });
      for (const c of n.children) collect(c, w, out, filter, tOff, alpha);
    }
    R.setRoots = function (roots, filter, base) {   // roots: node paths (scene.roots); filter(node) -> false hides a subtree
      const out = []; for (const r of roots) collect(r, base || M.ident(), out, filter); R.items = out; R.planet = null; Object.assign(R.L, L_DEFAULT); return out;
    };
    const topCache = {};
    R.rootTop = function (root) {   // highest point (local y) of a node subtree: where a label goes above a building
      if (root in topCache) return topCache[root];
      const tmp = [], an = R.animate; R.animate = false; collect(root, M.ident(), tmp); R.animate = an; let top = 0;
      for (const it of tmp) { const e = scene.geoms[it.geom]; if (!e || e.pos == null) continue; const pos = new Float32Array(bin, e.pos, e.nv * 3); for (let i = 0; i < e.nv; i++) { const p = M.xform(it.world, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], 1); if (p[1] > top) top = p[1]; } }
      return (topCache[root] = top);
    };
    // A command ship / carrier as the game shows it (0x100373bd0 loads the nodes per species, 0x100375cc8 sets the look): the stages ADD UP
    // (MK I = V1, MK II = V1 + V2, MK III = V1 + V2 + V3; Void = its own ship); every *_artifact mesh is hidden and only the TOP stage's gets
    // the carrier colour's material (red = ships_artifacts_a, blue = b, yellow = c; the game's look value is 4 (mk - 1) + 1 + {none 0, blue 1,
    // red 2, yellow 3}); without a colour no overlay at all.
    const SHIP_ROOT = { terran: "/ships_terran_command_ship", vossk: "/ships_vossk_command_ship", nivelian: "/nivellian_command_ship", void: "/ships_void_command_ship" };
    const SHIP_ART = { red: "a", blue: "b", yellow: "c" };
    R.ship = function (species, mk, colour, base) {
      const top = species === "void" ? 0 : Math.max(1, Math.min(3, mk | 0)), art = SHIP_ART[colour];
      const stage = (name) => { const m = /(?:_V|_stage_)(\d)(?:_artifact)?$/.exec(name); return m ? +m[1] : 0; };
      R.setRoots([SHIP_ROOT[species]], (n) => {
        if (/_artifact$/.test(n.name)) return !!art && stage(n.name) === top;
        if (/_V\d$/.test(n.name)) return stage(n.name) <= top;
        return true;
      }, base);
      if (art) { const mn = "assets/ships/ships_artifacts/ships_artifacts_" + art + ".mat"; for (const it of R.items) if (/_artifact$/.test(it.node)) { it.mat = scene.materials[mn]; it.matName = mn; } }
      return R.items;
    };
    // The star system view (0x10032b1c8; GoFA3D.systemLayout gives the planets): the sun (/system_planet_sun: glow, mesh and flare sprites) at the
    // origin as a point light, /system_fx scaled 1.1, and per planet its /system_planet_<type> (mesh + halo sprite) at (R cos a, 0, R sin a) scaled s,
    // with an orbit ring (/system_ring) scaled R / 88011 round the sun.
    const SYS_TYPE = [null, "ocean", "jungle", "ice", "mountain", "volcano", "desert", "citadel_a", "citadel_b", "citadel_c"];
    // gate { species, i }: the player's jumpgate beside their own planet i (0x10032b1c8): on the same orbit at angle + 108000 / (pi R), its long axis
    // (local Z) along the line to the planet, up +Y; its clip (terran_jumpgate_anim ...) plays on its own
    R.system = function (layout, gate) {
      const out = []; collect("/system_planet_sun", M.ident(), out); collect("/system_fx", M.scale(1.1), out);
      if (gate && layout[gate.i] && scene.nodes["/" + gate.species + "_jumpgate"]) {
        const p = layout[gate.i], a = p.angle - 108000 / (Math.PI * p.radius), G = [p.radius * Math.cos(a), 0, p.radius * Math.sin(a)], P = [p.radius * Math.cos(p.angle), 0, p.radius * Math.sin(p.angle)];
        const z = norm([P[0] - G[0], 0, P[2] - G[2]]), x = [z[2], 0, -z[0]];   // x = up x z
        // no extra turn here: the game's 180 degrees about Y is absorbed by the model's axes. Checked 2026-11-12 in the mirrored render (cam.mirror)
        // against Random2_t20 and t14: the cyan opening faces away from the planet as here; turned, it faced the wrong way
        collect("/" + gate.species + "_jumpgate", new Float32Array([...x, 0, 0, 1, 0, 0, ...z, 0, ...G, 1]), out);
      }
      for (const p of layout) {
        const name = "/system_planet_" + (SYS_TYPE[p.type] || "ocean"); if (!scene.nodes[name]) continue;
        const T = M.trans(p.radius * Math.cos(p.angle), 0, p.radius * Math.sin(p.angle)); collect(name, M.mul(T, M.scale(p.scale)), out);
        collect("/system_ring", M.scale(p.radius / 88011), out);
      }
      // "SystemViewLight" (0x100329a1c): a point light at the sun, ambient 0.2, diffuse 0.9, specular 0.5, shininess 25 (grey: the frames' orange
      // on the gate and planets near the sun is the sun's additive glow, not the light)
      R.items = out; R.planet = null; Object.assign(R.L, { pos: [0, 0, 0], ambient: [0.2, 0.2, 0.2], diffuse: [0.9, 0.9, 0.9], specular: [0.5, 0.5, 0.5], shininess: 25 }); return out;
    };
    R.addRoot = function (root, base, filter, tOff) { collect(root, base || M.ident(), R.items, filter, tOff || 0); };   // tOff (ms): so identical buildings do not blink in step   // add a node subtree to the current items (buildings on a planet)
    R.setPlanet = function (type, model) {
      Object.assign(R.L, L_DEFAULT);   // the game puts a planetCube material on planet_mesh and its _atmo material on planet_mesh_atmo
      const p = scene.planets.find((x) => x.name === type) || scene.planets[0]; R.planet = p;
      const parts = (mesh) => scene.meshes[mesh].parts.map((x) => x.geom);
      R.items = [{ node: "planet", world: model || M.ident(), geom: parts("planet_mesh")[0], mat: scene.materials[p.material], matName: p.material, planet: true }];
      if (p.atmo) R.items.push({ node: "atmo", world: model || M.ident(), geom: parts("planet_mesh_atmo")[0], mat: scene.materials[p.atmo], matName: p.atmo, planet: true });
      return R.items;
    };
    // the ground ring under a building: the game builds this quad in code (no mesh in the file uses <species>_ring.mat); the big ring is the
    // top-left 3/4 of the texture, the small one in the corner is not used here. Size measured on the recording Nice_HQ_Panel (about 2.3 x the socket).
    R.ring = function (species, world, half = 70, y = 0.6) {
      const mat = scene.materials["assets/buildings/" + species + "_ring/" + species + "_ring.mat"]; if (!mat) return null;
      const name = "ring_quad_" + half;
      if (!geoms[name]) {
        const P = new Float32Array([-half, y, -half, half, y, -half, half, y, half, -half, y, half]), U = new Float32Array([0, 0, 0.75, 0, 0.75, 0.75, 0, 0.75]);
        const N = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), C = new Uint8Array(16).fill(255), I = new Uint16Array([0, 2, 1, 0, 3, 2]);
        const b = (arr) => { const h = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, h); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); return h; };
        const g = { n: 6, nv: 4, mode: 10, attr: { a_position: { b: b(P), n: 3 }, a_normal: { b: b(N), n: 3 }, a_texCoord0: { b: b(U), n: 2 }, a_vtxColor: { b: b(C), n: 4, type: gl.UNSIGNED_BYTE, normalized: true } } };
        g.idx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW); geoms[name] = g;
      }
      const it = { node: "ring", world: world || M.ident(), geom: name, mat, matName: species + "_ring", synthetic: true }; R.items.push(it); return it;
    };
    // the nebula skybox (assets/systems/system_skybox/system_skybox_cubemap_01.mat, shader skybox.ush with its own 70 degree projection): a cube whose
    // faces carry 0..1 UVs (the game's own table, see below; the star layer tiles twice per face), kept centred on the camera, drawn unmirrored; `rot` turns it (the game orbits its camera, so the sky
    // turns with the planet); `over` = uniforms the game sets per star system (ColorRamp0.Min / Max, Rotation0, StarOffset0)
    R.skybox = function (over, rot, first) {   // first: drawn before everything, no depth / stencil (the system view: its planets write no stencil)
      const mat = scene.materials["assets/systems/system_skybox/system_skybox_cubemap_01.mat"]; if (!mat) return null;
      if (!Object.values(mat.textures).every((t) => texture(t).ready)) return null;   // until its cubemap is in, the white placeholder washed the whole system view white
      if (!geoms.skybox_cube) {
        // the game's own cube (constructor 0x100480ab8: tables 0x100ae8898 positions, 0x100ae89b8 UVs, 0x100ae8850 indices; read 2026-11-15)
        const P = [-1,-1,1, -1,-1,-1, 1,-1,-1, 1,-1,1,  -1,1,1, 1,1,1, 1,1,-1, -1,1,-1,  -1,-1,1, 1,-1,1, 1,1,1, -1,1,1,
                   1,-1,1, 1,-1,-1, 1,1,-1, 1,1,1,  1,-1,-1, -1,-1,-1, -1,1,-1, 1,1,-1,  -1,-1,-1, -1,-1,1, -1,1,1, -1,1,-1];
        const U = [1,1, 1,0, 0,0, 0,1,  0,1, 1,1, 1,0, 0,0,  0,1, 1,1, 1,0, 0,0,  0,1, 1,1, 1,0, 0,0,  0,1, 1,1, 1,0, 0,0,  0,1, 1,1, 1,0, 0,0];
        const I = []; for (let f = 0; f < 6; f++) I.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4 + 2, f * 4 + 3, f * 4);
        const b = (arr) => { const h = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, h); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); return h; };
        const g = { n: I.length, nv: 24, mode: 10, attr: { a_position: { b: b(new Float32Array(P)), n: 3 }, a_texCoord0: { b: b(new Float32Array(U)), n: 2 } } };
        g.idx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(I), gl.STATIC_DRAW); geoms.skybox_cube = g;
      }
      const it = { node: "skybox", world: rot || M.ident(), followCam: true, geom: "skybox_cube", mat, matName: "skybox", synthetic: true, over: over || {}, first: !!first }; R.items.push(it); return it;
    };
    R.ready = () => R.items.every((it) => Object.values(it.mat.textures).every((t) => texture(t).ready));
    R.loading = () => Promise.all(R.items.flatMap((it) => Object.values(it.mat.textures).map((t) => texture(t).promise)).filter(Boolean));

    // ---- one frame ---------------------------------------------------------------------------------------------------------------------------
    const STF = { 3: gl.ALWAYS, 4: gl.EQUAL }, STO = { 0: gl.ZERO, 1: gl.KEEP, 2: gl.REPLACE };
    // the engine's sprite builder (0x100993fb4): R / U = the camera's right / up axes in the node's local space (rows 0 and 1 of view x world,
    // normalised); a sprite whose w or h is 0 is left out (here: a degenerate quad)
    function spriteQuads(g, MV) {
      const { c, s, p } = g.sprite, n = c.length / 3;
      let rl = Math.hypot(MV[0], MV[4], MV[8]) || 1, ul = Math.hypot(MV[1], MV[5], MV[9]) || 1;
      const R0 = MV[0] / rl, R1 = MV[4] / rl, R2 = MV[8] / rl, U0 = MV[1] / ul, U1 = MV[5] / ul, U2 = MV[9] / ul;
      for (let i = 0; i < n; i++) {
        const w = s[2 * i], h = s[2 * i + 1], hw = (w && h) ? w / 2 : 0, hh = (w && h) ? h / 2 : 0, x = c[3 * i], y = c[3 * i + 1], z = c[3 * i + 2], o = 12 * i;
        const rx = R0 * hw, ry = R1 * hw, rz = R2 * hw, ux = U0 * hh, uy = U1 * hh, uz = U2 * hh;
        p[o] = x - ux - rx; p[o + 1] = y - uy - ry; p[o + 2] = z - uz - rz;
        p[o + 3] = x - ux + rx; p[o + 4] = y - uy + ry; p[o + 5] = z - uz + rz;
        p[o + 6] = x + ux + rx; p[o + 7] = y + uy + ry; p[o + 8] = z + uz + rz;
        p[o + 9] = x + ux - rx; p[o + 10] = y + uy - ry; p[o + 11] = z + uz - rz;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, g.attr.a_position.b); gl.bufferSubData(gl.ARRAY_BUFFER, 0, p);
    }
    R.frame = function (cam, dt) {   // cam: {eye, target, up, fov, near, far, viewport:[x,y,w,h], clear:bool, clearColor}
      R.time += dt || 0; const [vx, vy, vw, vh] = cam.viewport || [0, 0, canvas.width, canvas.height];
      gl.viewport(vx, vy, vw, vh);
      if (cam.clear !== false) { const c = cam.clearColor || [0, 0, 0, 1]; gl.clearColor(c[0], c[1], c[2], c[3]); gl.clearStencil(0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT); }
      const V = M.look(cam.eye, cam.target, cam.up || [0, 1, 0]), P = M.persp(cam.fov || 0.7, vw / vh, cam.near, cam.far);
      // cam.mirror: the game's engine is left-handed (2026-11-12: Random2_t14 / t20 match the game's own system layout + camera only as a mirror
      // image of a right-handed look-at), so view-space x is flipped (every shader matrix stays consistent, the skybox's own projection too) and
      // the triangle winding with it
      const V0 = V.slice();   // unmirrored: sprites take their right / up axes from it, so they are mirrored with the image like everything else
      if (cam.mirror) for (const k of [0, 4, 8, 12]) V[k] = -V[k];
      R.mirrored = !!cam.mirror;
      if (cam.shift) { P[8] -= cam.shift[0]; P[9] -= cam.shift[1]; }   // lens shift: moves the image by (shift) in NDC without turning the camera
      const VP = M.mul(P, V); R.VP = VP; R.vp = [vx, vy, vw, vh];
      if (bg && bg.tex) drawBg();
      const items = R.items.slice().sort((a, b) => {
        // opaque parts first (by layer), then the blended ones (by layer): blended parts write no depth, so an opaque layer drawn after them
        // (the planet, layer 252) would paint over the building lights and rings of layer 0
        const key = (st) => ((st.addBlend || st.alphaBlend || st.subBlend) ? 1e7 : 0) + (st.renderLayer || 0) * 1e4 + (st.subLayerRenderOrder || 0) * 100 + (st.subMaterialRenderOrder || 0);
        return (a.first ? -1e12 : key(a.mat.states)) - (b.first ? -1e12 : key(b.mat.states)); });
      const t = R.time, L = R.L; let drawn = 0;
      for (const it of items) {
        const fade = it.alpha != null && it.alpha < 0.999, mat = it.mat, pr = programFor(mat, fade); if (!pr) continue; const st = mat.states, g = geom(it.geom);
        if ((st.addBlend || st.alphaBlend) && Object.values(mat.textures).some((tn) => !(scene.textures[tn] || {}).ok || !texture(tn).ready)) continue;   // a glow / fx layer waits for its texture (the grey placeholder would show as a sheet)   // an fx layer whose texture is not decoded yet (PVRTC 2 bpp): leave it out rather than draw a grey sheet
        if (g.mode !== 10 || !g.n) continue;   // 10 = triangle list; sprite / particle meshes are not drawn yet
        gl.useProgram(pr.p);
        for (const [name, loc] of Object.entries(pr.attr)) {
          const a = g.attr[name];
          if (a) { gl.bindBuffer(gl.ARRAY_BUFFER, a.b); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, a.n, a.type || gl.FLOAT, !!a.normalized, 0, 0); }
          else { gl.disableVertexAttribArray(loc); gl.vertexAttrib4f(loc, name === "a_vtxColor" ? 1 : 0, name === "a_vtxColor" ? 1 : 0, name === "a_normal" ? 1 : (name === "a_vtxColor" ? 1 : 0), 1); }
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx);
        if (g.sprite) spriteQuads(g, M.mul(V0, it.world));
        // followCam (the skybox): centred on the eye. Building that as V x T(eye) in float32 with the eye ~610000 units out left a rounding residue that changed every
        // frame (the sky shook in the system view); the view's rotation alone gives the same matrix exactly
        const W = it.followCam ? M.mul(M.trans(cam.eye[0], cam.eye[1], cam.eye[2]), it.world) : it.world, Wi = M.inv(W), camL = M.xform(Wi, cam.eye, 1), lightP = L.pos ? M.xform(Wi, L.pos, 1) : null, lightL = lightP ? norm(lightP) : norm(M.xform(Wi, L.dir, 0)), u = pr.u;
        let MV; if (it.followCam) { const Vr = (it.matName === "skybox" ? V0 : V).slice(); Vr[12] = Vr[13] = Vr[14] = 0; MV = M.mul(Vr, it.world); } else MV = M.mul(V, W);   // the skybox is NOT mirrored (2026-11-15: skybox.ush builds its own GL-style projection from the engine's left-handed view, so the game's sky is the mirror of its scene; star dots of Real_SystemStart.png match only unmirrored)
        setU(u.u_localToProjection, it.followCam ? M.mul(P, MV) : M.mul(VP, W)); setU(u.u_localToView, MV); setU(u.u_ModelViewMatrix, MV); setU(u.u_localToWorld, it.frame ? M.mul(it.frame, W) : W); setU(u.u_ModelLocal, W);   // it.frame: the scene's own world when ours differs (lens dirt: the planet's frame)
        setU(u.u_cameraPositionLocal, camL); setU(u.u_lightDirectionLocal, [lightL[0], lightL[1], lightL[2], 0]); setU(u.u_lightPositionLocal, lightP ? [lightP[0], lightP[1], lightP[2], 1] : [lightL[0], lightL[1], lightL[2], 0]);   // R.L.pos: a point light (the system view's sun)
        setU(u.u_lightAmbientColor, [...L.ambient, 1]); setU(u.u_lightDiffuseColor, [...L.diffuse, 1]); setU(u.u_lightSpecularColor, [...L.specular, 1]); setU(u.u_lightShininess, L.shininess);
        setU(u.u_totalTime, t); setU(u.u_modTime, t % 1); setU(u.u_sinTime, [Math.sin(t / 8), Math.sin(t / 4), Math.sin(t / 2), Math.sin(t)]); setU(u.u_opacity, fade ? it.alpha : 1); setU(u.u_rimColor, [...L.ambient, 1]);
        for (const [k, v] of Object.entries(mat.uniforms)) if (u[k]) setU(u[k], v);
        if (it.over) for (const [k, v] of Object.entries(it.over)) if (u[k]) setU(u[k], v);
        if (u.HeightByWidth) setU(u.HeightByWidth, vh / vw);
        // viewer fallback (no R.cloudAxis): clouds drift slowly over the surface. The shader looks the clouds up at q * position, so the pattern moves by -2a: a = -0.002 t makes it
        // drift +0.004 rad/s about +Y, the same way as the idle spin (the first version turned it as fast as the spin but backwards: the clouds stood
        // still in space and the buildings seemed to slide over the planet)
        // R.cloudAxis (port.js cloudAxis, from the game): the clouds turn about the planet's own random axis at 0.01 rad per second of clock time
        // (the game uses the device uptime, so the phase is arbitrary; here the wall clock)
        if (it.planet && u.CloudsQuaternion) {
          if (R.cloudAxis) { const a = ((Date.now() / 1000) * 0.01) % 6.2831854820251465, s = Math.sin(a / 2), x = R.cloudAxis; setU(u.CloudsQuaternion, [x[0] * s, x[1] * s, x[2] * s, Math.cos(a / 2)]); }
          else { const a = -t * 0.002; setU(u.CloudsQuaternion, [0, Math.sin(a), 0, Math.cos(a)]); }
        }
        // SurfaceQuaternion: the material's own value [1, 0, 0, 0] (a 180 degree turn about X, as the game uploads it) is kept: with it the citadel crater in
        // the texture lands on the artifact's surface point (checked: 5 degrees); an identity override put the crater on the opposite side
        let unit = 0;
        for (const [name, info] of Object.entries(u)) {
          if (info.type !== gl.SAMPLER_2D && info.type !== gl.SAMPLER_CUBE) continue;
          const tn = mat.textures[name], rec = tn ? texture(tn) : null, cube = info.type === gl.SAMPLER_CUBE;
          gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(cube ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D, rec && rec.cube === cube ? rec.tex : (cube ? whiteCube : white)); gl.uniform1i(info.loc, unit++);
        }
        // render states
        if (st.doublesided) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace((R.frontFace === "cw") !== R.mirrored ? gl.CW : gl.CCW); }
        const blend = st.addBlend || st.alphaBlend || st.subBlend;
        if (blend) { gl.enable(gl.BLEND); if (st.addBlend) gl.blendFunc(gl.SRC_ALPHA, gl.ONE); else if (st.subBlend) { gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT); } else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
        else gl.disable(gl.BLEND);
        if (!st.subBlend) gl.blendEquation(gl.FUNC_ADD);
        if (st.noDepthTest && !it.depthTest) gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);   // it.depthTest: the caller wants it hidden behind nearer meshes (the sun glow behind a focused planet)
        gl.depthMask(!blend || !!st.forceDepthWrite);
        if (st.useStencil) {
          gl.enable(gl.STENCIL_TEST); gl.stencilFunc(STF[st.stencilFunc] ?? gl.ALWAYS, st.stencilRef || 0, 0xff);
          gl.stencilOp(STO[st.stencilOpFailAction] ?? gl.KEEP, STO[st.stencilOpDepthTestFailAction] ?? gl.KEEP, STO[st.stencilOpOkAction] ?? gl.KEEP);
        } else gl.disable(gl.STENCIL_TEST);
        const cm = st.colorMask || [255, 255, 255, 255]; gl.colorMask(!!cm[0], !!cm[1], !!cm[2], !!cm[3]);
        if (it.first) { gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.STENCIL_TEST); }
        gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0); drawn++;
      }
      gl.depthMask(true); gl.disable(gl.STENCIL_TEST); gl.disable(gl.BLEND); gl.colorMask(true, true, true, true);
      R.stats = { drawn, items: items.length };
    };
    // For a transparent canvas over a page background (premultiplied alpha): the planet shaders leave alpha unwritten, so set it from the stencil
    // afterwards: 1 where the planet drew (stencil 1), 0 elsewhere, which makes the additive halo add onto the page as it adds onto space in the game.
    let fa = null;
    R.alphaFromStencil = function () {
      if (!fa) {
        const mk = (t, src) => { const h = gl.createShader(t); gl.shaderSource(h, src); gl.compileShader(h); return h; }, p = gl.createProgram();
        gl.attachShader(p, mk(gl.VERTEX_SHADER, "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }"));
        gl.attachShader(p, mk(gl.FRAGMENT_SHADER, "precision mediump float; uniform float a; void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, a); }")); gl.linkProgram(p);
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
        fa = { p, b, loc: gl.getAttribLocation(p, "p"), a: gl.getUniformLocation(p, "a") };
      }
      for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
      gl.useProgram(fa.p); gl.bindBuffer(gl.ARRAY_BUFFER, fa.b); gl.enableVertexAttribArray(fa.loc); gl.vertexAttribPointer(fa.loc, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.colorMask(false, false, false, true); gl.enable(gl.STENCIL_TEST); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.stencilFunc(gl.EQUAL, 1, 0xff); gl.uniform1f(fa.a, 1); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.stencilFunc(gl.NOTEQUAL, 1, 0xff); gl.uniform1f(fa.a, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disableVertexAttribArray(fa.loc); gl.colorMask(true, true, true, true); gl.disable(gl.STENCIL_TEST); gl.enable(gl.DEPTH_TEST);
    };
    // projection of a world point to canvas pixels (top-left origin) with the last frame's camera; null when behind the camera
    R.project = function (p) {
      const m = R.VP; if (!m) return null; const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      if (w <= 0) return null; const [vx, vy, vw, vh] = R.vp; return [vx + (x / w + 1) / 2 * vw, canvas.height - (vy + (y / w + 1) / 2 * vh)];
    };
    // a background image (e.g. the page's starfield) drawn first, so the canvas can be opaque and the planet can move anywhere on it
    let bg = null;
    R.setBackground = function (source) {
      if (!bg) {
        const mk = (t, src) => { const h = gl.createShader(t); gl.shaderSource(h, src); gl.compileShader(h); return h; }, p = gl.createProgram();
        gl.attachShader(p, mk(gl.VERTEX_SHADER, "attribute vec2 p; varying vec2 uv; void main(){ uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }"));
        gl.attachShader(p, mk(gl.FRAGMENT_SHADER, "precision mediump float; varying vec2 uv; uniform sampler2D t; void main(){ gl_FragColor = texture2D(t, uv); }")); gl.linkProgram(p);
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
        bg = { p, b, loc: gl.getAttribLocation(p, "p"), t: gl.getUniformLocation(p, "t"), tex: gl.createTexture() };
      }
      gl.bindTexture(gl.TEXTURE_2D, bg.tex); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE)); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    };
    function drawBg() {
      for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
      gl.useProgram(bg.p); gl.bindBuffer(gl.ARRAY_BUFFER, bg.b); gl.enableVertexAttribArray(bg.loc); gl.vertexAttribPointer(bg.loc, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bg.tex); gl.uniform1i(bg.t, 0);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.STENCIL_TEST); gl.depthMask(false); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.depthMask(true);
      gl.disableVertexAttribArray(bg.loc);
    }
    R.bounds = function () {   // world-space bounding sphere of the current items (from the meshes' own spheres)
      let lo = [1e30, 1e30, 1e30], hi = [-1e30, -1e30, -1e30];
      for (const it of R.items) {
        if (it.synthetic) continue;
        const e = scene.geoms[it.geom], pos = new Float32Array(bin, e.pos, e.nv * 3);
        for (let i = 0; i < e.nv; i += 7) { const p = M.xform(it.world, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], 1); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); } }
      }
      const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]; return { center: c, radius: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 };
    };
    return R;
  }
  global.GoFA3D = { create, M, gameRandom, systemLayout, systemCamera };
})(window);
