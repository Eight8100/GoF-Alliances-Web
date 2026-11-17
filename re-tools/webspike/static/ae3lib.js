/* ae3lib: read the owner's own game archive in the browser (or in Node for tests): a zip / IPA reader (central directory, stored and deflate entries, ZIP64) and the
   parser of the .ae3 texture containers (grammar: re-tools/ae3/ae3_probe.py, docs/ART_FORMAT.md). Pure functions, no Fishlabs data inside. The same file runs in a Worker
   (importScripts) and in Node (require). */
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.GoFAAe3 = factory(); })(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const td16 = new TextDecoder("utf-16le"), td8 = new TextDecoder("utf-8");

  // ---- .ae3 container: object = 0x11, u32 id, 4 zero bytes, 4-byte name hash, UTF-16LE name (NUL), u8 property count, per property 5 bytes + UTF-16LE name (NUL) + value
  //      (u32; for "data": u32 length + raw bytes). Rows of "rgba" textures (dataFormat 0) are RGBA8888, top to bottom.
  function utf16z(d, p) {
    let q = p;
    while (q + 1 < d.length && !(d[q] === 0 && d[q + 1] === 0 && (q - p) % 2 === 0)) q++;
    if (q + 1 >= d.length) throw new Error("name without a terminator at " + p);
    return [td16.decode(d.subarray(p, q)), q + 2];
  }
  function parseAe3(d) {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), objs = []; let pos = 0;
    while (pos < d.length) {
      if (d[pos] !== 0x11) throw new Error("object tag expected at " + pos + ", got " + d[pos]);
      const id = dv.getUint32(pos + 1, true); pos += 9 + 4;
      let name; [name, pos] = utf16z(d, pos);
      const n = d[pos++], props = {};
      for (let i = 0; i < n; i++) {
        pos += 5; let pname; [pname, pos] = utf16z(d, pos);
        if (pname === "data") { const ln = dv.getUint32(pos, true); pos += 4; props.data = [pos, ln]; pos += ln; }
        else { props[pname] = dv.getUint32(pos, true); pos += 4; }
      }
      objs.push({ id, name, props });
    }
    return { objs, end: pos };
  }
  function textures(d) {   // [{ name, width, height, offset, length }] for the raw RGBA8888 images
    const { objs, end } = parseAe3(d); if (end !== d.length) throw new Error("container not consumed exactly");
    const out = [];
    for (const o of objs) { const p = o.props; if (p.dataFormat !== 0 || !p.data || p.data[1] !== p.width * p.height * 4) continue; out.push({ name: o.name.replace(/\//g, "_"), width: p.width, height: p.height, offset: p.data[0], length: p.data[1] }); }
    return out;
  }

  // ---- zip / IPA: only what is needed (central directory, local header, stored or deflate), reading slices of a File / Blob so a 500 MB archive is never loaded whole
  const u16 = (v, o) => v.getUint16(o, true), u32 = (v, o) => v.getUint32(o, true), u64 = (v, o) => Number(v.getBigUint64(o, true));
  async function bytes(blob, a, b) { return new Uint8Array(await blob.slice(a, b).arrayBuffer()); }
  async function readZip(blob) {
    const size = blob.size, tail = await bytes(blob, Math.max(0, size - 66000), size), tv = new DataView(tail.buffer);
    let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (u32(tv, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("not a zip file (no end-of-directory record)");
    let count = u16(tv, e + 10), cdSize = u32(tv, e + 12), cdOff = u32(tv, e + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {   // ZIP64: locator 20 bytes before, then the 64-bit record
      if (e < 20 || u32(tv, e - 20) !== 0x07064b50) throw new Error("zip64 locator missing");
      const rec = u64(tv, e - 20 + 8), r = await bytes(blob, rec, rec + 56), rv = new DataView(r.buffer);
      if (u32(rv, 0) !== 0x06064b50) throw new Error("zip64 record missing"); count = u64(rv, 32); cdSize = u64(rv, 40); cdOff = u64(rv, 48);
    }
    const cd = await bytes(blob, cdOff, cdOff + cdSize), v = new DataView(cd.buffer), out = []; let p = 0;
    for (let i = 0; i < count; i++) {
      if (u32(v, p) !== 0x02014b50) throw new Error("bad central directory entry " + i);
      const method = u16(v, p + 10), nl = u16(v, p + 28), xl = u16(v, p + 30), cl = u16(v, p + 32);
      let comp = u32(v, p + 20), uncomp = u32(v, p + 24), off = u32(v, p + 42); const name = td8.decode(cd.subarray(p + 46, p + 46 + nl));
      if (comp === 0xffffffff || uncomp === 0xffffffff || off === 0xffffffff) {   // 64-bit values sit in the extra field (id 1), in this order, only for the fields that overflowed
        let q = p + 46 + nl; const end = q + xl;
        while (q + 4 <= end) { const id = u16(v, q), len = u16(v, q + 2); if (id === 1) { let r = q + 4; if (uncomp === 0xffffffff) { uncomp = u64(v, r); r += 8; } if (comp === 0xffffffff) { comp = u64(v, r); r += 8; } if (off === 0xffffffff) off = u64(v, r); } q += 4 + len; }
      }
      out.push({ name, method, comp, uncomp, off }); p += 46 + nl + xl + cl;
    }
    return out;
  }
  async function inflateRaw(u8) {
    const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function readEntry(blob, en) {
    const h = await bytes(blob, en.off, en.off + 30), v = new DataView(h.buffer);
    if (u32(v, 0) !== 0x04034b50) throw new Error("bad local header for " + en.name);
    const start = en.off + 30 + u16(v, 26) + u16(v, 28), raw = await bytes(blob, start, start + en.comp);
    if (en.method === 0) return raw;
    if (en.method === 8) { const out = await inflateRaw(raw); if (out.length !== en.uncomp) throw new Error("size mismatch for " + en.name); return out; }
    throw new Error("unsupported zip method " + en.method + " for " + en.name);
  }
  /* The .aua companion file (rgba_high/high_ipad3_1.aua: portraits, item cards, flags; docs/ART_FORMAT.md '.aua', re-tools/ae3/aua_extract.py):
     records 'ACIF' {u32 0, type, width, height, len1, len2} + data, then an index {key, offset, size, width, height} x count, u32 count, 'AUA0'.
     type 0 / 1: len1 = JPEG (after 128 zero bytes; may be padded to whole 8 x 8 blocks), type 1 + len2 = LZ4 alpha of the JPEG's size;
     type 2 / 3: len1 = LZ4 RGB / RGBA. key = CRC32 of the image name. */
  function auaRecords(d) {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength), n = d.length;
    if (String.fromCharCode(d[n - 4], d[n - 3], d[n - 2], d[n - 1]) !== "AUA0") throw new Error("no AUA0 index");
    const cnt = v.getUint32(n - 8, true), base = n - 8 - cnt * 20, out = [];
    for (let i = 0; i < cnt; i++) {
      const o = base + i * 20, key = v.getUint32(o, true), off = v.getUint32(o + 4, true), w = v.getUint32(o + 12, true), h = v.getUint32(o + 16, true);
      if (v.getUint32(off, true) !== 0x46494341) throw new Error("bad ACIF record at " + off);   // "ACIF"
      const type = v.getUint32(off + 8, true), l1 = v.getUint32(off + 20, true), l2 = v.getUint32(off + 24, true);
      out.push({ key: key.toString(16).padStart(8, "0"), type, width: w, height: h, p1: d.subarray(off + 28, off + 28 + l1), p2: d.subarray(off + 28 + l1, off + 28 + l1 + l2) });
    }
    return out;
  }
  function lz4Block(src, outLen) {   // one LZ4 raw block (no frame) -> exactly outLen bytes
    const dst = new Uint8Array(outLen); let i = 0, o = 0; const n = src.length;
    while (i < n) {
      const tok = src[i++]; let lit = tok >> 4;
      if (lit === 15) { let b; do { b = src[i++]; lit += b; } while (b === 255); }
      dst.set(src.subarray(i, i + lit), o); i += lit; o += lit;
      if (o >= outLen || i >= n) break;
      const off = src[i] | (src[i + 1] << 8); i += 2; let ml = tok & 15;
      if (ml === 15) { let b; do { b = src[i++]; ml += b; } while (b === 255); }
      ml += 4; for (let k = 0; k < ml; k++, o++) dst[o] = dst[o - off];
    }
    if (o !== outLen) throw new Error("LZ4 gave " + o + " bytes, expected " + outLen);
    return dst;
  }
  // the files the browser game needs from the app: the high-resolution UI textures (+ the .aua companion), the UI font, the 3D scene
  const AUA_RE = /^Payload\/[^/]+\.app\/rgba_high\/high_ipad3_1\.aua$/;
  const UI_RE = /^Payload\/[^/]+\.app\/rgba_high\/high_ipad3_0\.ae3$/, FONT_RE = /^Payload\/[^/]+\.app\/KLAVIKRP\.TTF$/i, SCENE_RE = /^Payload\/[^/]+\.app\/assets_pvrtc\/assets\.ae3$/;
  async function findArt(blob) {   // + the 3D scene file (ae3scene.js reads it)
    const en = await readZip(blob); return { aua: en.find((x) => AUA_RE.test(x.name)) || null, ui: en.find((x) => UI_RE.test(x.name)) || null, font: en.find((x) => FONT_RE.test(x.name)) || null, scene: en.find((x) => SCENE_RE.test(x.name)) || null };
  }
  return { parseAe3, textures, readZip, readEntry, findArt, inflateRaw, auaRecords, lz4Block };
});
