// Checks static/ae3scene.js against the Python export (re-tools/ae3/export_viewer.py output in art/extracted/3d):
//   node re-tools/webspike/test_ae3scene.js ASSETS.ae3 [EXPORT_DIR] [RAW_OUT_DIR]
// scene.json must be deep-equal (numbers within 1e-4), scene.bin byte-identical. With RAW_OUT_DIR, a sample of textures is decoded to NAME.rgba
// (raw RGBA) for re-tools/ae3/compare_raw.py to compare with the exported PNGs.
const fs = require("fs"), path = require("path"), S = require("./static/ae3scene.js");
const [file, dir = "art/extracted/3d", rawDir] = process.argv.slice(2);
const t0 = Date.now(), u8 = new Uint8Array(fs.readFileSync(file)), out = S.build(u8, (m) => console.log(m));
console.log("built in", Date.now() - t0, "ms:", Object.keys(out.scene.nodes).length, "nodes,", Object.keys(out.scene.geoms).length, "geoms,", Object.keys(out.scene.materials).length, "materials,", out.bin.length, "bytes");
const ref = JSON.parse(fs.readFileSync(path.join(dir, "scene.json"))), refBin = fs.readFileSync(path.join(dir, "scene.bin"));
let diffs = 0;
function cmp(a, b, p) {
  if (diffs > 20) return;
  if (typeof a === "number" && typeof b === "number") { if (Math.abs(a - b) > 1e-4 * Math.max(1, Math.abs(b))) { diffs++; console.log("number", p, a, b); } return; }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") { if (a !== b && !(a === true && b === 1) && !(a === false && b === 0)) { diffs++; console.log("value", p, JSON.stringify(a)?.slice(0, 80), JSON.stringify(b)?.slice(0, 80)); } return; }
  if (Array.isArray(a) !== Array.isArray(b)) { diffs++; console.log("type", p); return; }
  const ka = Object.keys(a), kb = Object.keys(b);
  for (const k of new Set([...ka, ...kb])) { if (!(k in a) || !(k in b)) { diffs++; console.log("key", p + "." + k, k in a ? "only JS" : "only Python"); continue; } cmp(a[k], b[k], p + "." + k); }
}
cmp(out.scene, ref, "scene");
const binSame = out.bin.length === refBin.length && Buffer.compare(Buffer.from(out.bin), refBin) === 0;
console.log("scene.json differences:", diffs, "| scene.bin identical:", binSame, out.bin.length, refBin.length);
if (rawDir) {
  fs.mkdirSync(rawDir, { recursive: true });
  const byFmt = {};
  for (const [nm, info] of Object.entries(out.scene.textures)) { if (!info.ok) continue; (byFmt[info.fmt + (info.cube ? "c" : "")] = byFmt[info.fmt + (info.cube ? "c" : "")] || []).push(nm); }
  for (const [f, list] of Object.entries(byFmt)) for (const nm of list.slice(0, 3)) {
    const t1 = Date.now(), base = out.scene.textures[nm].cube ? nm + ".f2" : nm, r = out.rgba(base);
    fs.writeFileSync(path.join(rawDir, base + "." + r.w + "x" + r.h + ".rgba"), r.data); console.log("decoded", f, base, r.w + "x" + r.h, Date.now() - t1, "ms");
  }
}
process.exit(diffs || !binSame ? 1 : 0);
