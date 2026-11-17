#!/usr/bin/env python3
"""Textures inside the 3D scene file assets.ae3 of Galaxy on Fire: Alliances 1.16.1 (read-only): list them and decode them to PNG.

    python3 -I re-tools/ae3/ae3_tex.py FILE list [SUBSTRING]
    python3 -I re-tools/ae3/ae3_tex.py FILE png SUBSTRING OUT_DIR      # decode the matching textures (largest mip level) to PNG files

dataFormat (sizes checked on 289 textures, pixels checked by eye 2026-11-11): 1 = RGB888 with a full mip chain (len = 4*w*h - 1), 2 = RGBA8888 with a full mip chain,
3 = RGB565 with a full mip chain, 7 = one byte per pixel with mips (masks), 65 / 67 = PVRTC 2 bpp (RGB / RGBA), 66 / 68 = PVRTC 4 bpp (RGB / RGBA). The first w*h*bpp/8 bytes are the largest level. Needs numpy + Pillow
(Python 3.12 framework build). Output is Fishlabs material: keep it in art/extracted/ (git-ignored), never publish it."""
import mmap, os, struct, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ae3_scene as A

VAL = {"width", "height", "dataFormat", "mipMapLevel", "isCubemap", "minFilter", "repeatMode"}

def scan_textures(path):
    f = open(path, "rb"); mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    pos, cur, out = A.START, None, []
    while True:
        m = A.STR.search(mm, pos)
        if not m:
            break
        s = m.group().decode("utf-16le").rstrip("\x00")
        if s in A.ARRAYS:
            cnt = struct.unpack_from("<I", mm, m.end())[0]; n = cnt * A.ARRAYS[s]
            if m.end() + 4 + n > len(mm):
                pos = m.end(); continue
            if s == "data" and cur is not None:
                cur["off"], cur["len"] = m.end() + 4, n
            pos = m.end() + 4 + n
        elif s in A.SCALARS:
            if s in VAL and cur is not None and m.end() + 4 <= len(mm):
                cur[s] = struct.unpack_from("<I", mm, m.end())[0]
            pos = m.end()
        elif A.NAME_OK.match(s):
            if cur is not None and "off" in cur and "height" in cur and "dataFormat" in cur:   # width / height / dataFormat may come before or after the data array
                out.append(cur)
            cur = {"name": s}; pos = m.end()
        else:
            pos = m.end()
    if cur is not None and "off" in cur and "height" in cur and "dataFormat" in cur:
        out.append(cur)
    return mm, out

# ---- PVRTC 4 bpp (version 1): 8-byte blocks of 4 x 4 pixels in Morton order; per block two colours A and B (low-resolution images, bilinearly upsampled with wrap-around)
# and 2 bits of modulation per pixel (weights 0, 3, 5, 8 eighths; punch-through mode 0, 4, 4, 8).
def _expand(word, is_b):
    """15-bit colour word -> RGBA 0..255 (float arrays are built by the caller). Opaque: 554 (A) / 555 (B); else 3443 (A) / 3444 (B)."""
    opaque = (word >> 15) & 1
    r = np.where(opaque == 1, (word >> 10) & 0x1f, (word >> 8) & 0xf)
    g = np.where(opaque == 1, (word >> 5) & 0x1f, (word >> 4) & 0xf)
    if is_b:
        b = np.where(opaque == 1, word & 0x1f, word & 0xf)
    else:
        b4 = (word >> 1) & 0xf; b3 = (word >> 1) & 0x7
        b = np.where(opaque == 1, (b4 << 1) | (b4 >> 3), b3)
    a3 = (word >> 12) & 0x7
    r8 = np.where(opaque == 1, (r << 3) | (r >> 2), (r << 4) | r)
    g8 = np.where(opaque == 1, (g << 3) | (g >> 2), (g << 4) | g)
    if is_b:
        b8 = np.where(opaque == 1, (b << 3) | (b >> 2), (b << 4) | b)
    else:
        b8 = np.where(opaque == 1, (b << 3) | (b >> 2), (b << 5) | (b << 2) | (b >> 1))
    a8 = np.where(opaque == 1, 255, (a3 << 5) | (a3 << 2) | (a3 >> 1))
    return np.stack([r8, g8, b8, a8], axis=-1).astype(np.float32)

WEIGHTS = {"centre": np.array([5, 7, 1, 3]) / 8.0, "corner": np.array([0, 2, 4, 6]) / 8.0}   # share of the NEXT block for pixel x % 4 (see decode_pvrtc4 weights=)

def decode_pvrtc4(data, w, h, weights="centre"):
    bw, bh = w // 4, h // 4; n = bw * bh
    blk = np.frombuffer(data, dtype="<u4", count=n * 2).reshape(n, 2)
    mod, col = blk[:, 0], blk[:, 1]
    # Morton index -> block (x, y): y bits at even positions, x bits at odd positions
    ys = np.zeros(n, dtype=np.int64); xs = np.zeros(n, dtype=np.int64); idx = np.arange(n)
    kmin = int(np.log2(min(bw, bh)))   # non-square: the low bits of the smaller side are interleaved, the rest of the index counts along the larger side
    for k in range(kmin):
        ys |= ((idx >> (2 * k)) & 1) << k; xs |= ((idx >> (2 * k + 1)) & 1) << k
    if bh > bw: ys |= (idx >> (2 * kmin)) << kmin
    elif bw > bh: xs |= (idx >> (2 * kmin)) << kmin
    ok = (xs < bw) & (ys < bh)
    A_ = np.zeros((bh, bw, 4), np.float32); B_ = np.zeros((bh, bw, 4), np.float32); M = np.zeros((bh, bw), np.uint32); F = np.zeros((bh, bw), np.uint32)
    ca = _expand((col & 0xfffe).astype(np.int64), False); cb = _expand((col >> 16).astype(np.int64), True)
    A_[ys[ok], xs[ok]] = ca[ok]; B_[ys[ok], xs[ok]] = cb[ok]; M[ys[ok], xs[ok]] = mod[ok]; F[ys[ok], xs[ok]] = (col & 1)[ok]
    wt = WEIGHTS[weights]
    def up(img):   # bilinear x4 upsample with wrap-around; pixel i of a block takes block b-1 / b (i < 2 for "centre") or b / b+1
        out = np.zeros((bh * 4, bw * 4, 4), np.float32)
        for j in range(4):
            for i in range(4):
                wx, wy = wt[i], wt[j]
                x0 = np.arange(bw) - (1 if (weights == "centre" and i < 2) else 0); y0 = np.arange(bh) - (1 if (weights == "centre" and j < 2) else 0)
                c00 = img[np.ix_(y0 % bh, x0 % bw)]; c10 = img[np.ix_(y0 % bh, (x0 + 1) % bw)]; c01 = img[np.ix_((y0 + 1) % bh, x0 % bw)]; c11 = img[np.ix_((y0 + 1) % bh, (x0 + 1) % bw)]
                out[j::4, i::4] = (c00 * (1 - wx) + c10 * wx) * (1 - wy) + (c01 * (1 - wx) + c11 * wx) * wy
        return out
    Au, Bu = up(A_), up(B_)
    m = np.zeros((bh * 4, bw * 4), np.int64)
    for j in range(4):
        for i in range(4):
            m[j::4, i::4] = (M >> (2 * (j * 4 + i))) & 3
    fl = np.repeat(np.repeat(F, 4, 0), 4, 1)
    wts = np.where(fl == 1, np.array([0, 4, 4, 8])[m], np.array([0, 3, 5, 8])[m]) / 8.0
    rgba = Au * (1 - wts[..., None]) + Bu * wts[..., None]
    rgba[..., 3] = np.where((fl == 1) & (m == 2), 0, rgba[..., 3])
    return np.clip(np.rint(rgba), 0, 255).astype(np.uint8)

def _morton(bw, bh):
    n = bw * bh; ys = np.zeros(n, dtype=np.int64); xs = np.zeros(n, dtype=np.int64); idx = np.arange(n)
    kmin = int(np.log2(min(bw, bh)))
    for k in range(kmin):
        ys |= ((idx >> (2 * k)) & 1) << k; xs |= ((idx >> (2 * k + 1)) & 1) << k
    if bh > bw: ys |= (idx >> (2 * kmin)) << kmin
    elif bw > bh: xs |= (idx >> (2 * kmin)) << kmin
    return xs, ys

def decode_pvrtc2(data, w, h):
    """PVRTC 2 bpp (v1): 8-byte blocks of 8 x 4 pixels in Morton order (block grid w/8 x h/4). Colour word as in 4 bpp; its bit 0 selects the
    modulation mode: 0 = one bit per pixel (A or B); 1 = 2-bit values (0, 3, 5, 8 eighths) on the checkerboard pixels ((x ^ y) & 1 == 0), the others
    interpolated from their neighbours: all four (mode 1), left / right (mode 2) or up / down (mode 3); modes 2 / 3 are flagged by bit 0 and bit 20
    of the modulation word (the reference decoder's rules, PVRTDecompress)."""
    bw, bh = max(w // 8, 2), max(h // 4, 2); n = bw * bh
    blk = np.frombuffer(data, dtype="<u4", count=n * 2).reshape(n, 2)
    mod, col = blk[:, 0].astype(np.int64), blk[:, 1].astype(np.int64)
    xs, ys = _morton(bw, bh)
    A_ = np.zeros((bh, bw, 4), np.float32); B_ = np.zeros((bh, bw, 4), np.float32)
    A_[ys, xs] = _expand(col & 0xfffe, False); B_[ys, xs] = _expand(col >> 16, True)
    flag = col & 1
    m = mod.copy(); mode = np.where(flag == 1, 1, 0)
    sel = (flag == 1) & ((m & 1) == 1)
    mode = np.where(sel, np.where((m >> 20) & 1 == 1, 3, 2), mode)
    m = np.where(sel, np.where((m >> 21) & 1 == 1, m | (1 << 20), m & ~(1 << 20)), m)
    m = np.where(flag == 1, np.where((m >> 1) & 1 == 1, m | 1, m & ~1), m)
    W, H = bw * 8, bh * 4; val = np.zeros((H, W), np.float32); md = np.zeros((H, W), np.int64)
    tab = np.array([0, 3, 5, 8], np.float32)
    for y in range(4):
        for x in range(8):
            md[ys * 4 + y, xs * 8 + x] = mode
    # mode 0: bit i -> pixel (i % 8, i // 8)
    for i in range(32):
        y, x = i // 8, i % 8
        v0 = ((mod >> i) & 1) * 8.0
        val[ys * 4 + y, xs * 8 + x] = np.where(flag == 0, v0, val[ys * 4 + y, xs * 8 + x])
    k = 0
    for y in range(4):
        for x in range(8):
            if ((x ^ y) & 1) == 0:
                v1 = tab[(m >> (2 * k)) & 3]; k += 1
                val[ys * 4 + y, xs * 8 + x] = np.where(flag == 1, v1, val[ys * 4 + y, xs * 8 + x])
    yy, xx = np.mgrid[0:H, 0:W]; odd = ((xx ^ yy) & 1) == 1
    L, Rr, U, D = np.roll(val, 1, 1), np.roll(val, -1, 1), np.roll(val, 1, 0), np.roll(val, -1, 0)
    interp = np.where(md == 1, (L + Rr + U + D + 2) // 4, np.where(md == 2, (L + Rr + 1) // 2, (U + D + 1) // 2))
    wts = np.where((md >= 1) & odd, interp, val) / 8.0
    def up(img, sx, sy):   # bilinear upsample (block centres), wrap-around
        fx = (np.arange(W) + 0.5) / sx - 0.5; fy = (np.arange(H) + 0.5) / sy - 0.5
        x0 = np.floor(fx).astype(int); y0 = np.floor(fy).astype(int); wx = (fx - x0)[None, :, None]; wy = (fy - y0)[:, None, None]
        c00 = img[np.ix_(y0 % bh, x0 % bw)]; c10 = img[np.ix_(y0 % bh, (x0 + 1) % bw)]; c01 = img[np.ix_((y0 + 1) % bh, x0 % bw)]; c11 = img[np.ix_((y0 + 1) % bh, (x0 + 1) % bw)]
        return (c00 * (1 - wx) + c10 * wx) * (1 - wy) + (c01 * (1 - wx) + c11 * wx) * wy
    Au, Bu = up(A_, 8, 4), up(B_, 8, 4)
    rgba = Au * (1 - wts[..., None]) + Bu * wts[..., None]
    return np.clip(np.rint(rgba), 0, 255).astype(np.uint8)[:h, :w]

def decode(mm, t, weights="centre"):
    w, h, fmt = t["width"], t["height"], t["dataFormat"]; d = bytes(mm[t["off"]:t["off"] + t["len"]])
    if fmt == 1:   # RGB888, largest level first, then the mip chain (len = 3 * (4^n - 1) / 3 for n levels; the mip-less explosion.png is exactly w*h*3)
        rgb = np.frombuffer(d, np.uint8, w * h * 3).reshape(h, w, 3); return np.dstack([rgb, np.full((h, w), 255, np.uint8)])
    if fmt == 2:   # RGBA8888 + mip chain
        return np.frombuffer(d, np.uint8, w * h * 4).reshape(h, w, 4)
    if fmt == 3:   # RGB565 (u16 little-endian) + mip chain
        v = np.frombuffer(d, "<u2", w * h).reshape(h, w).astype(np.uint32)
        r, g, b = (v >> 11) & 31, (v >> 5) & 63, v & 31
        return np.dstack([(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), np.full((h, w), 255, np.uint32)]).astype(np.uint8)
    if fmt == 7:
        if h == 6 * w and len(d) % 6 == 0:   # cubemap (the skybox): six faces, each with its own mip chain
            st = len(d) // 6; g = np.concatenate([np.frombuffer(d[i * st:i * st + w * w], np.uint8).reshape(w, w) for i in range(6)], axis=0)
        else:
            g = np.frombuffer(d, np.uint8, w * h).reshape(h, w)
        return np.dstack([g, g, g, np.full_like(g, 255)])
    if fmt in (66, 68):
        if h == 6 * w and len(d) % 6 == 0:   # cubemap: six square faces, each stored with its own mip chain (stride = len / 6)
            st = len(d) // 6
            return np.concatenate([decode_pvrtc4(d[i * st:i * st + w * w // 2], w, w, weights) for i in range(6)], axis=0)
        return decode_pvrtc4(d[:w * h // 2], w, h, weights)
    if fmt in (65, 67):
        if h == 6 * w and len(d) % 6 == 0:
            st = len(d) // 6
            return np.concatenate([decode_pvrtc2(d[i * st:i * st + w * w // 4], w, w) for i in range(6)], axis=0)
        return decode_pvrtc2(d[:max(w, 16) * max(h, 8) // 4], w, h)
    return None

def main():
    path, cmd = sys.argv[1], sys.argv[2]; mm, tex = scan_textures(path)
    if cmd == "list":
        sub = sys.argv[3] if len(sys.argv) > 3 else ""
        for t in tex:
            if sub in t["name"]: print(f"{t['dataFormat']:3d} {t['width']:5d}x{t['height']:<5d} mips {t.get('mipMapLevel')} {t['len']:9d}  {t['name']}")
    elif cmd == "png":
        from PIL import Image
        sub, out = sys.argv[3], sys.argv[4]; os.makedirs(out, exist_ok=True)
        for t in tex:
            if sub not in t["name"]: continue
            a = decode(mm, t)
            if a is None: print("not decoded (format %d): %s" % (t["dataFormat"], t["name"])); continue
            Image.fromarray(a, "RGBA").save(os.path.join(out, t["name"].replace("/", "_") + ".png")); print("wrote", t["name"], a.shape)

if __name__ == "__main__":
    main()
