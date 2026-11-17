// Test of static/ae3lib.js (zip reader + .ae3 parser) against hashes made by the Python extractor.
//   node re-tools/webspike/test_ae3lib.js ARCHIVE.ipa HASHES.json
// ARCHIVE = a zip holding Payload/X.app/rgba_high/high_ipad3_0.ae3 and KLAVIKRP.TTF (stored or deflated); HASHES.json = { name: [w, h, sha256 of the RGBA bytes] }
// from re-tools/ae3/ae3_probe.py. Prints PASS / FAIL; the archive is the owner's own game data, never committed.
const fs = require("fs"), crypto = require("crypto"), lib = require("./static/ae3lib.js");
(async () => {
  const [, , archive, hashes] = process.argv, want = JSON.parse(fs.readFileSync(hashes, "utf8")), blob = new Blob([fs.readFileSync(archive)]);
  const found = await lib.findArt(blob); if (!found.ui || !found.font) { console.log("FAIL: entries not found", found); process.exit(1); }
  const d = await lib.readEntry(blob, found.ui), tex = lib.textures(d); let bad = 0;
  for (const t of tex) { const h = crypto.createHash("sha256").update(d.subarray(t.offset, t.offset + t.length)).digest("hex"), w = want[t.name]; if (!w || w[0] !== t.width || w[1] !== t.height || w[2] !== h) { bad++; if (bad < 5) console.log("mismatch", t.name); } }
  const font = await lib.readEntry(blob, found.font), okFont = font.length > 1000 && (font[0] === 0 || font[0] === 0x4f || font[0] === 0x74);   // TrueType 0x00010000 / OTTO / ttcf
  const same = tex.length === Object.keys(want).length;
  console.log(tex.length + " textures, " + Object.keys(want).length + " expected, " + bad + " mismatches, font " + font.length + " bytes, method " + found.ui.method);
  console.log(bad === 0 && same && okFont ? "PASS" : "FAIL"); process.exit(bad === 0 && same && okFont ? 0 : 1);
})().catch((e) => { console.log("FAIL", e); process.exit(1); });
