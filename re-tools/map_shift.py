"""Rebuild the bundled galaxy map with every system position (and lane point) shifted by +SHIFT map units.
usage: shift.py IN.map OUT.map SHIFT"""
import os, sys, struct, zipfile
sys.path.insert(0, sys.argv[4])
import pb

SHIFT = float(sys.argv[3])


def enc(f, wt, v):
    if wt == 0:
        return pb.v(f, v)
    if wt == 2:
        return pb.ld(f, v)
    if wt == 1:
        return pb.key(f, 1) + (v if isinstance(v, bytes) else struct.pack("<Q", v))
    if wt == 5:
        return pb.key(f, 5) + (v if isinstance(v, bytes) else struct.pack("<I", v))
    raise ValueError(wt)


def dbl(v):
    return struct.unpack("<d", v if isinstance(v, bytes) else struct.pack("<Q", v))[0]


def flt(v):
    return struct.unpack("<f", v if isinstance(v, bytes) else struct.pack("<I", v))[0]


def shift_pos(b):   # {1 double x, 2 double y, 3 sx, 4 sy}
    out = b""
    for f, wt, v in pb.fields(b):
        if f in (1, 2) and wt == 1:
            out += pb.key(f, 1) + struct.pack("<d", dbl(v) + SHIFT)
        else:
            out += enc(f, wt, v)
    return out


def shift_system(b):
    return b"".join(enc(f, wt, shift_pos(v) if (f == 5 and wt == 2) else v) for f, wt, v in pb.fields(b))


def shift_point(b):  # {1 float, 2 float}
    out = b""
    for f, wt, v in pb.fields(b):
        if f in (1, 2) and wt == 5:
            out += pb.key(f, 5) + struct.pack("<f", flt(v) + SHIFT)
        else:
            out += enc(f, wt, v)
    return out


def shift_lanes(b):  # {1 [point], 2 [...], 3 [...]}
    return b"".join(enc(f, wt, shift_point(v) if (f == 1 and wt == 2) else v) for f, wt, v in pb.fields(b))


def shift_sector(d):
    out = b""
    for f, wt, v in pb.fields(d):
        if f == 3 and wt == 2:
            v = b"".join(enc(f2, wt2, shift_system(v2) if (f2 == 1 and wt2 == 2) else v2) for f2, wt2, v2 in pb.fields(v))
        elif f == 5 and wt == 2:
            v = shift_lanes(v)
        out += enc(f, wt, v)
    return out


zin = zipfile.ZipFile(sys.argv[1])
zout = zipfile.ZipFile(sys.argv[2], "w", zipfile.ZIP_DEFLATED)
n = 0
for info in zin.infolist():
    data = zin.read(info.filename)
    if info.filename not in ("map_version", "0_0") and "_" in info.filename:
        data = shift_sector(data); n += 1
    elif info.filename == "map_version" and os.path.basename(sys.argv[2]).split(".")[0].isdigit():
        data = struct.pack(">Q", int(os.path.basename(sys.argv[2]).split(".")[0]))   # the new map id (OUT = <id>.map), 8 bytes big-endian
    zout.writestr(info, data)
zout.close()
print("shifted sectors:", n)
