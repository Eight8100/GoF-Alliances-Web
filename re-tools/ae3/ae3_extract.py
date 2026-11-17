#!/usr/bin/env python3
"""Extract the 2D UI textures of Galaxy on Fire: Alliances 1.16.1 from the 'rgba' .ae3 containers to PNG (read-only on the app files).

    python3 -I re-tools/ae3/ae3_extract.py APP_DIR OUT_DIR [--tier high|mid|low] [--name SUBSTRING]

APP_DIR = the unpacked Dominion.app (from the owner's own copy of the game). OUT_DIR gets one PNG per texture plus index.json
(name, width, height). The output is Fishlabs material: keep it out of git (art/extracted/ is in .gitignore) and never publish it.
Format (see docs/ART_FORMAT.md): dataFormat 0 = raw RGBA8888, rows top to bottom. PVRTC tiers (dataFormat 68) are not decoded here."""
import json, os, struct, sys, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ae3_probe as P

TIERS = {"high": "rgba_high/high_ipad3_0.ae3", "mid": "rgba_mid/mid_iphone4_retina_0.ae3", "low": "rgba_low/low_iphone3gs_0.ae3"}

def png(w, h, rgba):
    raw = b"".join(b"\x00" + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    def chunk(t, b):
        c = struct.pack(">I", len(b)) + t + b
        return c + struct.pack(">I", zlib.crc32(t + b) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")

def main():
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    opt = lambda k, dflt: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else dflt
    app, out, tier, only = a[0], a[1], opt("--tier", "high"), opt("--name", "")
    d, objs, pos, _ = P.parse(os.path.join(app, TIERS[tier]))
    assert pos == len(d), "container not consumed exactly"
    os.makedirs(out, exist_ok=True)
    index = []
    for oid, name, pr in objs:
        if only and only not in name:
            continue
        off, ln = pr["data"]
        w, h = pr["width"], pr["height"]
        if pr["dataFormat"] != 0 or ln != w * h * 4:
            print("skipped (not RGBA8888):", name, pr["dataFormat"], ln, w, h); continue
        open(os.path.join(out, name.replace("/", "_") + ".png"), "wb").write(png(w, h, d[off:off + ln]))
        index.append({"name": name, "width": w, "height": h})
    json.dump(index, open(os.path.join(out, "index.json"), "w"), indent=1)
    print(f"{len(index)} textures -> {out}")

if __name__ == "__main__":
    main()
