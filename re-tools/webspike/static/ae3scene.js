/* The 3D scene file assets.ae3 (Galaxy on Fire: Alliances 1.16.1) read in the browser or in Node, from the owner's own app copy.
   A JavaScript port of re-tools/ae3/ae3_graph.py (exact object walker), ae3_tex.py (texture decoders: RGB888, RGBA8888, RGB565, 8-bit,
   PVRTC 4 bpp and 2 bpp, cubemaps) and export_viewer.py (the scene the renderer gofa3d.js draws: nodes, meshes, geometry, materials, original
   shaders, planets, animation clips). build(u8) gives { scene, bin, rgba(name) } in the shape of the relay's /art/3d/ files, so gofa3d.js can
   run on it (GoFA3D.create(canvas, { source })). Grammar and formats: docs/ART_3D.md. Fishlabs data: it is read from the user's own file and
   never leaves the browser. test: node re-tools/webspike/test_ae3scene.js */
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.GoFAScene = factory(); })(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const START = 51792, U16 = new TextDecoder("utf-16le");
  const BIG = new Set(["xyz", "nrm", "tan", "bitan", "uv0_2", "uv1_2", "color0", "data"]);

  // ---- object walker (ae3_graph.py) ----------------------------------------------------------------------------------------------------------
  function str(u8, p) { let e = p; while (u8[e] || u8[e + 1]) e += 2; return [U16.decode(u8.subarray(p, e)), e + 2]; }
  function walk(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n8 = u8.length, objs = [];
    const u32 = (p) => dv.getUint32(p, true), f32 = (p) => dv.getFloat32(p, true);
    const arr = (p, size, rd) => { const n = u32(p); p += 4; if (!rd) return [{ off: p, len: n * size }, p + n * size]; const o = new Array(n); for (let i = 0; i < n; i++) o[i] = rd(p + i * size); return [o, p + n * size]; };
    const READ = {
      0x03: (p) => str(u8, p), 0x05: (p) => [[f32(p), f32(p + 4), f32(p + 8)], p + 12],
      0x07: (p) => { const o = []; for (let i = 0; i < 12; i++) o.push(f32(p + 4 * i)); return [o, p + 48]; },
      0x40: (p) => [u8[p], p + 1], 0x46: (p) => [f32(p), p + 4], 0x44: (p) => [u32(p), p + 4], 0x45: (p) => [u32(p), p + 4], 0x47: (p) => [u32(p), p + 4],
      0x49: (p) => [[u8[p + 4], u32(p)], p + 5],
      0x81: (p) => { const n = u32(p); p += 4; if (!n) return [[], p]; const tag = u8[p], o = []; for (let i = 0; i < n; i++) o.push([tag, u32(p + 1 + 4 * i)]); return [o, p + 1 + 4 * n]; },
      0x82: (p) => arr(p, 1), 0x83: (p) => arr(p, 1), 0x85: (p) => arr(p, 2, (q) => dv.getUint16(q, true)), 0x86: (p) => arr(p, 4, u32), 0x88: (p) => arr(p, 4, f32),
      0x8f: (p) => { const n = u32(p); p += 4; const o = []; for (let i = 0; i < n; i++) { const r = str(u8, p); o.push(r[0]); p = r[1]; } return [o, p]; },
    };
    let p = START;
    while (p < n8 - 32) {   // the first object follows the leading table: a header whose name starts with two printable UTF-16 characters
      const size = u32(p + 1), z = u32(p + 5);
      if (z === 0 && size > 16 && size < n8 && u8[p + 13] >= 0x20 && u8[p + 13] < 0x7f && u8[p + 14] === 0 && u8[p + 15] >= 0x20 && u8[p + 15] < 0x7f && u8[p + 16] === 0) break;
      p++;
    }
    while (p < n8 - 13) {
      const o = { tag: u8[p], off: p, size: u32(p + 1), hash: u32(p + 9), props: {}, types: {}, raw: null };
      if (u32(p + 5) !== 0 || o.size < 14) throw new Error("lost sync at " + p);
      let q; [o.name, q] = str(u8, p + 13);
      const n = u8[q]; q += 1; const end = p + o.size;
      for (let k = 0; k < n; k++) {
        const t = u8[q], [pname, q2] = str(u8, q + 5);
        if (!READ[t]) { o.raw = [q, t, pname]; break; }
        o.types[pname] = t;
        if (BIG.has(pname) && (t === 0x82 || t === 0x83 || t === 0x88)) { const cnt = u32(q2), sz = t === 0x88 ? 4 : 1; o.props[pname] = { off: q2 + 4, len: cnt * sz }; q = q2 + 4 + cnt * sz; continue; }
        if (pname === "indx" && t === 0x85) { const cnt = u32(q2); o.props[pname] = { off: q2 + 4, len: cnt * 2 }; q = q2 + 4 + cnt * 2; continue; }
        if ((t & 0x80) && q2 + 4 + u32(q2) > end) { o.raw = [q, t, pname]; break; }
        let v, q3; try { [v, q3] = READ[t](q2); } catch (e) { o.raw = [q, t, pname]; break; }
        q = q3; o.props[pname] = v;
        if (q > end) { o.raw = [q, t, pname]; break; }
      }
      objs.push(o); p = end;
    }
    return objs;
  }

  // ---- textures (ae3_tex.py) ------------------------------------------------------------------------------------------------------------------
  function expand(word, isB, out, o) {   // 15-bit PVRTC colour word -> RGBA 0..255 (opaque 554 / 555, translucent 3443 / 3444)
    const opaque = (word >> 15) & 1;
    if (opaque) {
      const r = (word >> 10) & 31, g = (word >> 5) & 31, b = isB ? word & 31 : (((word >> 1) & 15) << 1) | (((word >> 1) & 15) >> 3);
      out[o] = (r << 3) | (r >> 2); out[o + 1] = (g << 3) | (g >> 2); out[o + 2] = (b << 3) | (b >> 2); out[o + 3] = 255;
    } else {
      const r = (word >> 8) & 15, g = (word >> 4) & 15, a3 = (word >> 12) & 7;
      out[o] = (r << 4) | r; out[o + 1] = (g << 4) | g;
      if (isB) { const b = word & 15; out[o + 2] = (b << 4) | b; } else { const b = (word >> 1) & 7; out[o + 2] = (b << 5) | (b << 2) | (b >> 1); }
      out[o + 3] = (a3 << 5) | (a3 << 2) | (a3 >> 1);
    }
  }
  function morton(bw, bh) {
    const n = bw * bh, xs = new Int32Array(n), ys = new Int32Array(n), kmin = Math.round(Math.log2(Math.min(bw, bh)));
    for (let idx = 0; idx < n; idx++) {
      let x = 0, y = 0; for (let k = 0; k < kmin; k++) { y |= ((idx >> (2 * k)) & 1) << k; x |= ((idx >> (2 * k + 1)) & 1) << k; }
      if (bh > bw) y |= (idx >> (2 * kmin)) << kmin; else if (bw > bh) x |= (idx >> (2 * kmin)) << kmin;
      xs[idx] = x; ys[idx] = y;
    }
    return [xs, ys];
  }
  const rnd8 = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v) - ((v % 1 === 0.5 && Math.round(v) % 2) ? 1 : 0));   // numpy rint: halves to even
  function pvrtc4(d, w, h) {
    const bw = w >> 2, bh = h >> 2, n = bw * bh, dv = new DataView(d.buffer, d.byteOffset, d.byteLength), [xs, ys] = morton(bw, bh);
    const A = new Float32Array(n * 4), B = new Float32Array(n * 4), M = new Uint32Array(n), F = new Uint8Array(n), tmp = new Uint8Array(4);
    for (let i = 0; i < n; i++) {
      const x = xs[i], y = ys[i]; if (x >= bw || y >= bh) continue; const b = y * bw + x, mod = dv.getUint32(8 * i, true), col = dv.getUint32(8 * i + 4, true);
      expand(col & 0xfffe, false, tmp, 0); A.set(tmp, 4 * b); expand(col >>> 16, true, tmp, 0); B.set(tmp, 4 * b); M[b] = mod; F[b] = col & 1;
    }
    const WT = [5 / 8, 7 / 8, 1 / 8, 3 / 8], out = new Uint8Array(w * h * 4), MOD = [0, 3 / 8, 5 / 8, 1], PUN = [0, 0.5, 0.5, 1];
    for (let py = 0; py < h; py++) {
      const by = py >> 2, j = py & 3, wy = WT[j], y0 = (by - (j < 2 ? 1 : 0) + bh) % bh, y1 = (y0 + 1) % bh;
      for (let px = 0; px < w; px++) {
        const bx = px >> 2, i = px & 3, wx = WT[i], x0 = (bx - (i < 2 ? 1 : 0) + bw) % bw, x1 = (x0 + 1) % bw, b = by * bw + bx;
        const m = (M[b] >>> (2 * (j * 4 + i))) & 3, fl = F[b], wm = fl ? PUN[m] : MOD[m], o = 4 * (py * w + px);
        const c00 = 4 * (y0 * bw + x0), c10 = 4 * (y0 * bw + x1), c01 = 4 * (y1 * bw + x0), c11 = 4 * (y1 * bw + x1);
        for (let c = 0; c < 4; c++) {
          const a = (A[c00 + c] * (1 - wx) + A[c10 + c] * wx) * (1 - wy) + (A[c01 + c] * (1 - wx) + A[c11 + c] * wx) * wy;
          const bb = (B[c00 + c] * (1 - wx) + B[c10 + c] * wx) * (1 - wy) + (B[c01 + c] * (1 - wx) + B[c11 + c] * wx) * wy;
          out[o + c] = rnd8(a * (1 - wm) + bb * wm);
        }
        if (fl && m === 2) out[o + 3] = 0;
      }
    }
    return out;
  }
  function pvrtc2(d, w, h) {
    const bw = Math.max(w >> 3, 2), bh = Math.max(h >> 2, 2), n = bw * bh, dv = new DataView(d.buffer, d.byteOffset, d.byteLength), [xs, ys] = morton(bw, bh);
    const W = bw * 8, H = bh * 4, A = new Float32Array(n * 4), B = new Float32Array(n * 4), val = new Float32Array(W * H), md = new Uint8Array(W * H), tmp = new Uint8Array(4), TAB = [0, 3, 5, 8];
    for (let i = 0; i < n; i++) {
      const bx = xs[i], by = ys[i], b = by * bw + bx, mod = dv.getUint32(8 * i, true), col = dv.getUint32(8 * i + 4, true), flag = col & 1;
      expand(col & 0xfffe, false, tmp, 0); A.set(tmp, 4 * b); expand(col >>> 16, true, tmp, 0); B.set(tmp, 4 * b);
      let m = mod, mode = flag;
      if (flag && (m & 1)) { mode = ((m >>> 20) & 1) ? 3 : 2; m = ((m >>> 21) & 1) ? (m | (1 << 20)) : (m & ~(1 << 20)); }
      if (flag) m = ((m >>> 1) & 1) ? (m | 1) : (m & ~1);
      let k = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
        const o = (by * 4 + y) * W + bx * 8 + x; md[o] = mode;
        if (!flag) val[o] = ((mod >>> (y * 8 + x)) & 1) * 8;
        else if (((x ^ y) & 1) === 0) { val[o] = TAB[(m >>> (2 * k)) & 3]; k++; }
      }
    }
    const wts = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = y * W + x, mode = md[o];
      if (mode >= 1 && ((x ^ y) & 1)) {
        const L = val[y * W + (x + W - 1) % W], Rr = val[y * W + (x + 1) % W], U = val[((y + H - 1) % H) * W + x], D = val[((y + 1) % H) * W + x];
        wts[o] = (mode === 1 ? Math.floor((L + Rr + U + D + 2) / 4) : mode === 2 ? Math.floor((L + Rr + 1) / 2) : Math.floor((U + D + 1) / 2)) / 8;
      } else wts[o] = val[o] / 8;
    }
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const fy = (y + 0.5) / 4 - 0.5, y0 = Math.floor(fy), wy = fy - y0, ya = ((y0 % bh) + bh) % bh, yb = (((y0 + 1) % bh) + bh) % bh;
      for (let x = 0; x < w; x++) {
        const fx = (x + 0.5) / 8 - 0.5, x0 = Math.floor(fx), wx = fx - x0, xa = ((x0 % bw) + bw) % bw, xb = (((x0 + 1) % bw) + bw) % bw, wm = wts[y * W + x], o = 4 * (y * w + x);
        const c00 = 4 * (ya * bw + xa), c10 = 4 * (ya * bw + xb), c01 = 4 * (yb * bw + xa), c11 = 4 * (yb * bw + xb);
        for (let c = 0; c < 4; c++) {
          const a = (A[c00 + c] * (1 - wx) + A[c10 + c] * wx) * (1 - wy) + (A[c01 + c] * (1 - wx) + A[c11 + c] * wx) * wy;
          const bb = (B[c00 + c] * (1 - wx) + B[c10 + c] * wx) * (1 - wy) + (B[c01 + c] * (1 - wx) + B[c11 + c] * wx) * wy;
          out[o + c] = rnd8(a * (1 - wm) + bb * wm);
        }
      }
    }
    return out;
  }
  // one texture -> RGBA bytes (h rows; a cubemap is six w x w faces stacked, in the stored order), or null for an unknown format
  function decodeTexture(u8, t) {
    const p = t.props, w = p.width, h = p.height, fmt = p.dataFormat, d = u8.subarray(p.data.off, p.data.off + p.data.len), cube = h === 6 * w && d.length % 6 === 0;
    if (fmt === 1) { const o = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { o[4 * i] = d[3 * i]; o[4 * i + 1] = d[3 * i + 1]; o[4 * i + 2] = d[3 * i + 2]; o[4 * i + 3] = 255; } return o; }
    if (fmt === 2) return d.slice(0, w * h * 4);
    if (fmt === 3) { const o = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { const v = d[2 * i] | (d[2 * i + 1] << 8), r = (v >> 11) & 31, g = (v >> 5) & 63, b = v & 31; o[4 * i] = (r << 3) | (r >> 2); o[4 * i + 1] = (g << 2) | (g >> 4); o[4 * i + 2] = (b << 3) | (b >> 2); o[4 * i + 3] = 255; } return o; }
    const faces = (fn, per) => { const st = d.length / 6, o = new Uint8Array(w * h * 4); for (let f = 0; f < 6; f++) o.set(fn(d.subarray(f * st, f * st + per), w, w), f * w * w * 4); return o; };
    if (fmt === 7) {
      const g = cube ? (() => { const st = d.length / 6, o = new Uint8Array(w * h); for (let f = 0; f < 6; f++) o.set(d.subarray(f * st, f * st + w * w), f * w * w); return o; })() : d.subarray(0, w * h);
      const o = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { o[4 * i] = o[4 * i + 1] = o[4 * i + 2] = g[i]; o[4 * i + 3] = 255; } return o;
    }
    if (fmt === 66 || fmt === 68) return cube ? faces(pvrtc4, w * w / 2) : pvrtc4(d.subarray(0, w * h / 2), w, h);
    if (fmt === 65 || fmt === 67) return cube ? faces(pvrtc2, w * w / 4) : pvrtc2(d.subarray(0, Math.max(w, 16) * Math.max(h, 8) / 4), w, h);
    return null;
  }
  const FORMATS = new Set([1, 2, 3, 7, 65, 66, 67, 68]);

  // ---- the scene for gofa3d.js (export_viewer.py) -------------------------------------------------------------------------------------------
  const BUILDINGS = ["hq", "spaceport", "metal_extractor", "gas_extractor", "crystal_extractor", "barracks", "research", "scanner", "planetary_shield", "trade_center", "artifact_center_type_a", "socket"];
  const SHIPS = ["/ships_terran_command_ship", "/ships_vossk_command_ship", "/nivellian_command_ship", "/ships_void_command_ship"];
  const SYSTEM = ["/system_planet_sun", "/system_ring", "/system_fx"].concat(["ocean", "jungle", "ice", "mountain", "volcano", "desert", "citadel_a", "citadel_b", "citadel_c"].map((t) => "/system_planet_" + t), ["/terran_jumpgate", "/vossk_jumpgate", "/nivelian_jumpgate"]);
  const ROOTS = ["/planet", "/planet_sun", "/planets_lens_flare", "/lensdirt"].concat(SHIPS, SYSTEM, ["/planet_artifact_type_a_scene", "/planet_artifact_type_b_scene", "/planet_artifact_type_c_scene"],
    ...["terran", "nivelian", "vossk"].map((sp) => BUILDINGS.map((b) => "/building_" + sp + "_" + b)));
  const SKIP = ["_command_ship_moving"];
  const CUBE_ORDER = { 0: 2, 1: 1, 2: 4, 3: 0, 4: 5, 5: 3 };   // stored face -> GL face (cubesolve.py)
  const STATES = new Set(["useStencil", "mergeMeshes", "colorMask", "renderLayer", "clearStencil", "staticMeshMerge", "uOffset", "vOffset", "subMaterialRenderOrder",
    "subLayerRenderOrder", "addBlend", "doublesided", "alphaBlend", "forceDepthWrite", "noDepthTest", "stencilMask", "stencilFunc", "stencilRef",
    "stencilOpDepthTestFailAction", "stencilOpOkAction", "stencilOpFailAction", "subBlend"]);
  const round = (x, n) => { const f = 10 ** n; return Math.round(x * f) / f; };

  function build(u8, log) {
    const objs = walk(u8), byh = new Map(), byname = new Map();
    for (const o of objs) { if (!byh.has(o.hash)) byh.set(o.hash, o); byname.set(o.name, o); }
    if (log) log(objs.length + " objects");
    let chunks = [], blen = 0;
    const put = (b) => { const off = blen; chunks.push(b); blen += b.length; const pad = (-blen) & 3; if (pad) { chunks.push(new Uint8Array(pad)); blen += pad; } return off; };
    const scene = { nodes: {}, meshes: {}, geoms: {}, materials: {}, shaders: {}, textures: {}, roots: [], planets: [] }, texObj = {};
    const ref = (v) => (v ? byh.get(v[1]) : undefined);
    function texture(t) {
      const nm = t.name.split("assets/").join("").split("/").join("_").replace(/\.[^.]*$/, "");
      if (scene.textures[nm]) return nm;
      const p = t.props; texObj[nm] = t;
      scene.textures[nm] = { w: p.width, h: p.height, fmt: p.dataFormat, cube: !!p.isCubemap, repeat: p.repeatMode || 0, ok: FORMATS.has(p.dataFormat) };
      return nm;
    }
    function material(m) {
      if (scene.materials[m.name]) return m.name;
      const p = m.props, tex = {}, names = p.textureNames || [], refs = p.textures || [];
      for (let i = 0; i < Math.min(names.length, refs.length); i++) { const t = byh.get(refs[i][1]); if (t) tex[names[i]] = texture(t); }
      const progs = [];
      for (const [, h] of p.shaders || []) { const s = byh.get(h); if (!s) continue; if (!scene.shaders[s.name]) scene.shaders[s.name] = { vs: s.props.vsCode, fs: s.props.fsCode }; progs.push(s.name); }
      const uni = {};
      for (const [k, v] of Object.entries(p)) {
        if (STATES.has(k) || k === "textureNames" || k === "textures" || k === "shaders") continue;
        const t = m.types[k];   // Python keeps numbers and FLOAT lists (vec3 0x05, matrix 0x07, f32 array 0x88), not int / string / reference lists
        if (typeof v === "number") uni[k] = v; else if ((t === 0x05 || t === 0x07 || t === 0x88) && Array.isArray(v) && v.length) uni[k] = v;
      }
      const st = {}; for (const k of STATES) if (k in p && k !== "colorMask") st[k] = p[k];
      if (p.colorMask) st.colorMask = Array.from(u8.subarray(p.colorMask.off, p.colorMask.off + p.colorMask.len));
      scene.materials[m.name] = { shaders: progs, textures: tex, uniforms: uni, states: st };
      return m.name;
    }
    const bytes = (a) => u8.slice(a.off, a.off + a.len);
    function geom(sm) {
      if (scene.geoms[sm.name]) return sm.name;
      const p = sm.props, e = { mode: p.primitiveMode, sprites: p.usePointSprites || 0 };
      e.nv = p.xyz ? Math.floor(p.xyz.len / 12) : 0;
      for (const [k, key] of [["xyz", "pos"], ["nrm", "nrm"], ["tan", "tan"], ["bitan", "bitan"], ["uv0_2", "uv0"], ["uv1_2", "uv1"], ["color0", "col"]]) if (p[k]) e[key] = put(bytes(p[k]));
      if (p.indx) { e.ni = p.indx.len / 2; e.idx = put(bytes(p.indx)); }
      if (p.isSpriteSystem) { e.sprite = 1; e.size = put(new Uint8Array(new Float32Array(p.size).buffer)); }
      scene.geoms[sm.name] = e; return sm.name;
    }
    function mesh(me) {
      if (scene.meshes[me.name]) return me.name;
      const subs = (me.props.submesh || []).map(([, h]) => byh.get(h)), mats = (me.props.materials || []).map(([, h]) => byh.get(h)), parts = [];
      subs.forEach((sm, i) => { if (!sm || !sm.props.xyz) return; const m = i < mats.length ? mats[i] : undefined; parts.push({ geom: geom(sm), material: m ? material(m) : null }); });
      scene.meshes[me.name] = { parts, radius: me.props.bSphereRadius ?? null, center: me.props.bSphereCenter ?? null }; return me.name;
    }
    function node(o) {
      const n = { name: o.props.localName ?? o.name, local: o.props.local ?? null, visible: o.props.visible ?? 1, children: [] }, me = ref(o.props.mesh);
      if (me) n.mesh = mesh(me);
      let c = ref(o.props.child);
      while (c) { if (!SKIP.some((s) => c.name.includes(s))) n.children.push(node(c)); c = ref(c.props.next); }
      scene.nodes[o.name] = n; return o.name;
    }
    for (const r of ROOTS) { if (byname.has(r)) scene.roots.push(node(byname.get(r))); }
    scene.anims = {};
    for (const c of objs) {
      if (c.tag !== 0x12) continue; const tracks = [];
      for (const [, h] of c.props.animation || []) {
        const tr = byh.get(h); if (!tr || !tr.props.targetNode) continue;
        const nd = byh.get(tr.props.targetNode[1]); if (!nd || !scene.nodes[nd.name]) continue;
        if (tr.tag === 0x1b) { tracks.push({ node: nd.name, vis: { t: tr.props.attributeTimes, k: tr.props.attributeKeys.map((x) => round(x, 4)) } }); continue; }
        const d = tr.props.matrixAnimationData ? byh.get(tr.props.matrixAnimationData[1]) : tr, e = { node: nd.name };
        for (const key of ["rotation", "scaleX", "scaleY", "scaleZ", "translateX", "translateY", "translateZ"]) if (d.props[key + "Time"]) e[key] = { t: d.props[key + "Time"], k: d.props[key + "Key"].map((x) => round(x, 5)) };
        tracks.push(e);
      }
      if (tracks.length) scene.anims[c.name] = { length: c.props.clipLength || 0, tracks };
    }
    for (const o of objs) {
      if (o.tag === 0x0c && o.name.startsWith("assets/planets/planetCube_") && o.name.endsWith(".mat") && !o.name.includes("_atmo") && !o.name.includes("_defense")) {
        const atmo = byname.get(o.name.replace(".mat", "_atmo.mat"));
        scene.planets.push({ name: o.name.split("planetCube_")[1].slice(0, -4), material: material(o), atmo: atmo ? material(atmo) : null });
      }
    }
    for (const c of "abc") material(byname.get("assets/ships/ships_artifacts/ships_artifacts_" + c + ".mat"));
    material(byname.get("assets/systems/system_skybox/system_skybox_cubemap_01.mat"));
    for (const sp of ["terran", "nivelian", "vossk"]) material(byname.get("assets/buildings/" + sp + "_ring/" + sp + "_ring.mat"));
    for (const nm of ["planet_mesh", "planet_mesh_atmo"]) mesh(byname.get(nm));
    const bin = new Uint8Array(blen); let o = 0; for (const c of chunks) { bin.set(c, o); o += c.length; } chunks = null;
    // rgba("name") or rgba("name.fG") (cubemap face G in GL order) -> { w, h, data } (decoded on demand; the full cubemap is kept once decoded)
    const cubeCache = new Map();
    function rgba(base) {
      const m = /^(.*)\.f(\d)$/.exec(base), nm = m && scene.textures[m[1]] && scene.textures[m[1]].cube ? m[1] : base, t = texObj[nm];
      if (!t) throw new Error("no texture " + base);
      const w = t.props.width, h = t.props.height;
      if (nm !== base) {
        if (!cubeCache.has(nm)) cubeCache.set(nm, decodeTexture(u8, t));
        const all = cubeCache.get(nm), g = +m[2], k = +Object.keys(CUBE_ORDER).find((s) => CUBE_ORDER[s] === g);
        return { w, h: w, data: all.slice(k * w * w * 4, (k + 1) * w * w * 4) };
      }
      return { w, h, data: decodeTexture(u8, t) };
    }
    return { scene, bin, rgba, objects: objs.length };
  }
  // the scene file inside an IPA (ae3lib.js reads the zip): Payload/<app>.app/assets_pvrtc/assets.ae3
  const SCENE_RE = /^Payload\/[^/]+\.app\/assets_pvrtc\/assets\.ae3$/;
  return { walk, decodeTexture, build, SCENE_RE, CUBE_ORDER };
});
