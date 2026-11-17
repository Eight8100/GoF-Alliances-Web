#!/usr/bin/env python3
"""Extract the images of the '.aua' companion files of Galaxy on Fire: Alliances 1.16.1 (rgba_*/..._1.aua) to RGBA PNG.

    python3 -I re-tools/ae3/aua_extract.py APP_DIR OUT_DIR [--tier high|mid|low]

Read-only on the app files (the owner's own copy). The output is Fishlabs material: keep it in art/extracted/ (git-ignored),
never publish it. Format (docs/ART_FORMAT.md, section '.aua'; decoded 2026-11-12 from the client: loader FUN_10000e7cc,
header check FUN_10035eb7c, LZ4 FUN_1003b54e4, index lookup FUN_100656c94):

  file   = record* index
  record = 'ACIF' u32 0, u32 type, u32 width, u32 height, u32 len1, u32 len2   (28 bytes), then len1 + len2 bytes
           type 0: len1 = JPEG (128 zero bytes, then a baseline JPEG padded with FFD9; the JPEG may be up to 7 px larger,
                   padded to whole 8x8 blocks: crop the top-left width x height), no alpha;
                   the alpha plane has the JPEG's padded size as well
           type 1: len1 = JPEG as type 0, len2 = LZ4 raw block -> width*height alpha bytes
           type 2: len1 = LZ4 raw block -> width*height*3 RGB;  type 3: -> width*height*4 RGBA
  index  = count x { u32 key, u32 offset, u32 size, u32 width, u32 height }, u32 count, 'AUA0'
           key = CRC32 of the image name (same hash as the .ae3 object names); the names themselves are not in any file,
           the client holds the keys as constants, so images are written as aua_<key hex>.png. names.json (next to this
           script, re-tools/ae3/aua_names.json) maps keys to a verified "name" (CRC32 match) or my "label" (role read from the
           client code, real name unknown); files are written as <name or label>.png, else aua_<key>.png.
The client multiplies RGB by alpha after decoding (FUN_10000efa4), so the JPEG holds straight colour: PNG = JPEG RGB + alpha.
JPEG decoding uses macOS 'sips' (to BMP) since the project avoids third-party Python packages.
"""
import json, os, struct, subprocess, sys, tempfile, zlib

TIERS = {"high": "rgba_high/high_ipad3_1.aua", "mid": "rgba_mid/mid_iphone4_retina_1.aua", "low": "rgba_low/low_iphone3gs_1.aua"}


def lz4_block(src, out_len):
    """Decode one LZ4 raw block (no frame header) to exactly out_len bytes."""
    dst = bytearray(); i = 0; n = len(src)
    while i < n:
        tok = src[i]; i += 1
        lit = tok >> 4
        if lit == 15:
            while True:
                b = src[i]; i += 1; lit += b
                if b != 255: break
        dst += src[i:i + lit]; i += lit
        if len(dst) >= out_len or i >= n:
            break
        off = src[i] | (src[i + 1] << 8); i += 2
        ml = tok & 15
        if ml == 15:
            while True:
                b = src[i]; i += 1; ml += b
                if b != 255: break
        ml += 4
        start = len(dst) - off
        if off >= ml:
            dst += dst[start:start + ml]
        else:
            for k in range(ml):
                dst.append(dst[start + k])
    if len(dst) != out_len:
        raise ValueError(f"LZ4 gave {len(dst)} bytes, expected {out_len}")
    return bytes(dst)


def png(w, h, rgba):
    raw = b"".join(b"\x00" + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    def chunk(t, b):
        c = struct.pack(">I", len(b)) + t + b
        return c + struct.pack(">I", zlib.crc32(t + b) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")


def jpeg_rgb(jpeg, tmp):
    """JPEG bytes -> (w, h, RGB bytes top row first) via sips -> 24/32-bit BMP."""
    jp, bp = os.path.join(tmp, "a.jpg"), os.path.join(tmp, "a.bmp")
    open(jp, "wb").write(jpeg)
    subprocess.run(["sips", "-s", "format", "bmp", jp, "--out", bp], check=True, capture_output=True)
    b = open(bp, "rb").read()
    off = struct.unpack_from("<I", b, 10)[0]
    w, h = struct.unpack_from("<ii", b, 18); bpp = struct.unpack_from("<H", b, 28)[0]
    comp = struct.unpack_from("<I", b, 30)[0]
    assert bpp in (24, 32) and comp in (0, 3), (bpp, comp)
    px = bpp // 8; stride = (w * px + 3) & ~3
    rows = range(abs(h)) if h < 0 else range(h - 1, -1, -1)
    out = bytearray()
    for y in rows:
        r = b[off + y * stride: off + y * stride + w * px]
        for x in range(0, w * px, px):
            out += bytes((r[x + 2], r[x + 1], r[x]))   # BGR(A) -> RGB
    return w, abs(h), bytes(out)


def records(d):
    cnt = struct.unpack_from("<I", d, len(d) - 8)[0]
    assert d[-4:] == b"AUA0", "no AUA0 index"
    base = len(d) - 8 - cnt * 20
    for i in range(cnt):
        key, off, size, w, h = struct.unpack_from("<5I", d, base + i * 20)
        assert d[off:off + 4] == b"ACIF", hex(off)
        z, typ, rw, rh, l1, l2 = struct.unpack_from("<6I", d, off + 4)
        assert z == 0 and (rw, rh) == (w, h) and 28 + l1 + l2 == size, (hex(key), rw, rh, w, h, size)
        yield key, typ, w, h, d[off + 28:off + 28 + l1], d[off + 28 + l1:off + 28 + l1 + l2]


def decode(typ, w, h, p1, p2, tmp):
    if typ in (0, 1):
        jw, jh, rgb = jpeg_rgb(p1[p1.index(b"\xff\xd8"):], tmp)
        assert jw >= w and jh >= h, (jw, jh, w, h)          # the JPEG may be padded to whole 8x8 blocks
        a = lz4_block(p2, jw * jh) if typ == 1 else b"\xff" * (jw * jh)   # alpha has the JPEG's size too
        if (jw, jh) != (w, h):                                # crop both to the top-left width x height
            rgb = b"".join(rgb[y * jw * 3:y * jw * 3 + w * 3] for y in range(h))
            a = b"".join(a[y * jw:y * jw + w] for y in range(h))
        out = bytearray(w * h * 4)
        out[0::4], out[1::4], out[2::4], out[3::4] = rgb[0::3], rgb[1::3], rgb[2::3], a
        return bytes(out)
    if typ == 2:
        rgb = lz4_block(p1, w * h * 3)
        out = bytearray(b"\xff" * (w * h * 4))
        out[0::4], out[1::4], out[2::4] = rgb[0::3], rgb[1::3], rgb[2::3]
        return bytes(out)
    if typ == 3:
        return lz4_block(p1, w * h * 4)
    raise ValueError(f"type {typ}")


def main():
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    tier = sys.argv[sys.argv.index("--tier") + 1] if "--tier" in sys.argv else "high"
    app, out = a[0], a[1]
    os.makedirs(out, exist_ok=True)
    names_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "aua_names.json")
    names = json.load(open(names_path)) if os.path.exists(names_path) else {}
    d = open(os.path.join(app, TIERS[tier]), "rb").read()
    index = []
    with tempfile.TemporaryDirectory() as tmp:
        for key, typ, w, h, p1, p2 in records(d):
            k = f"{key:08x}"
            rgba = decode(typ, w, h, p1, p2, tmp)
            nm = names.get(k, {})
            fn = (nm.get("name") or nm.get("label") or "aua_" + k) + ".png"   # real name (CRC32-verified) > my label > key
            open(os.path.join(out, fn), "wb").write(png(w, h, rgba))
            index.append({"key": k, "file": fn, "type": typ, "width": w, "height": h, "name": nm.get("name", ""), "label": nm.get("label", "")})
    json.dump(index, open(os.path.join(out, "index.json"), "w"), indent=1)
    print(f"{len(index)} images -> {out}")


if __name__ == "__main__":
    main()
