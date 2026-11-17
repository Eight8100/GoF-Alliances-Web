#!/usr/bin/env python3
"""Exact object walker for the 3D scene file assets.ae3 (Galaxy on Fire: Alliances 1.16.1, read-only).

Grammar (found 2026-11-11, docs/ART_3D.md "Object grammar"):
  object   = tag u8 | size u32 (whole object, header included) | u32 0 | hash u32 | name UTF-16LE NUL | count u8 | count x property
  property = type u8 | hash u32 | name UTF-16LE NUL | value
References name another object by its hash: arrays (type 0x81) as u32 count, ONE tag byte, count x hash u32; a single reference (0x49) as hash u32, tag u8.
Object tags seen: 0x09 node, 0x0a sub-mesh (<node>/matN, the vertex arrays), 0x0b mesh (submesh + materials refs), 0x0c material (.mat),
0x11 texture, 0x23 shader program (vsCode / fsCode), others (animation ...) are walked by size and kept raw.

    python3 -I re-tools/ae3/ae3_graph.py FILE stats
    python3 -I re-tools/ae3/ae3_graph.py FILE dump SUBSTRING      # print the matching objects with their decoded properties
"""
import mmap, struct, sys, collections

START = 51792

def _str(mm, p):
    e = p
    while mm[e] or mm[e + 1]:
        e += 2
    return mm[p:e].decode("utf-16le", "replace"), e + 2

# value readers: type -> function(mm, p) -> (value, new_p). Arrays: u32 element count first.
def _arr(fmt, size):
    def rd(mm, p):
        n = struct.unpack_from("<I", mm, p)[0]; p += 4
        if fmt is None:
            return (p, n * size), p + n * size          # big arrays: (offset, byte length)
        return list(struct.unpack_from("<%d%s" % (n, fmt), mm, p)), p + n * size
    return rd

def _refs(mm, p):
    n = struct.unpack_from("<I", mm, p)[0]; p += 4
    if n == 0:
        return [], p
    tag = mm[p]; hs = struct.unpack_from("<%dI" % n, mm, p + 1)       # one tag byte for the whole array, then n hashes (0xffffffff = empty slot)
    return [(tag, h) for h in hs], p + 1 + 4 * n

def _strs(mm, p):
    n = struct.unpack_from("<I", mm, p)[0]; p += 4; out = []
    for _ in range(n):
        s, p = _str(mm, p); out.append(s)
    return out, p

READ = {
    0x03: lambda mm, p: _str(mm, p),
    0x05: lambda mm, p: (list(struct.unpack_from("<3f", mm, p)), p + 12),
    0x07: lambda mm, p: (list(struct.unpack_from("<12f", mm, p)), p + 48),
    0x40: lambda mm, p: (mm[p], p + 1),
    0x46: lambda mm, p: (struct.unpack_from("<f", mm, p)[0], p + 4),
    0x44: lambda mm, p: (struct.unpack_from("<I", mm, p)[0], p + 4),      # u32 enum (primitiveMode, dataFormat)
    0x45: lambda mm, p: (struct.unpack_from("<I", mm, p)[0], p + 4),      # u32 hash (targetAttrUid = hash of a property name, e.g. 'local')
    0x47: lambda mm, p: (struct.unpack_from("<I", mm, p)[0], p + 4),
    0x49: lambda mm, p: ((mm[p + 4], struct.unpack_from("<I", mm, p)[0]), p + 5),
    0x81: _refs,
    0x82: _arr(None, 1),
    0x83: _arr(None, 1),      # u8 array (texture data, color0 = RGBA bytes per vertex)
    0x85: _arr("H", 2),       # u16 array (indx)
    0x86: _arr("I", 4),       # key times in ms
    0x88: _arr("f", 4),
    0x8f: _strs,
}
BIG = {"xyz", "nrm", "tan", "bitan", "uv0_2", "uv1_2", "color0", "data"}

class Obj:
    __slots__ = ("tag", "off", "size", "hash", "name", "props", "raw")
    def __repr__(self):
        return "<%02x %s %08x>" % (self.tag, self.name, self.hash)

def walk(mm, start=START):
    """Yield every object in file order. Properties of unknown type stop the property parse (the object is still skipped by its size)."""
    p = start
    # the first object follows the leading table: find a header whose size points at another valid header
    while p < len(mm) - 32:
        tag, size, z = mm[p], *struct.unpack_from("<II", mm, p + 1)
        if z == 0 and 16 < size < len(mm) and 0x20 <= mm[p + 13] < 0x7f and mm[p + 14] == 0 and 0x20 <= mm[p + 15] < 0x7f and mm[p + 16] == 0:
            break
        p += 1
    while p < len(mm) - 13:
        o = Obj(); o.tag = mm[p]; o.off = p
        o.size, z, o.hash = struct.unpack_from("<III", mm, p + 1)
        if z != 0 or o.size < 14:
            raise ValueError("lost sync at %d" % p)
        o.name, q = _str(mm, p + 13)
        n = mm[q]; q += 1; o.props = {}; o.raw = None
        end = p + o.size
        for _ in range(n):
            t = mm[q]; pname, q2 = _str(mm, q + 5)
            if t not in READ:
                o.raw = (q, t, pname); break
            if pname in BIG and t in (0x82, 0x83, 0x88):
                cnt = struct.unpack_from("<I", mm, q2)[0]; sz = 4 if t == 0x88 else 1
                o.props[pname] = (q2 + 4, cnt * sz); q = q2 + 4 + cnt * sz; continue
            if pname == "indx" and t == 0x85:
                cnt = struct.unpack_from("<I", mm, q2)[0]; o.props[pname] = (q2 + 4, cnt * 2); q = q2 + 4 + cnt * 2; continue
            if t & 0x80 and q2 + 4 + struct.unpack_from("<I", mm, q2)[0] > end:
                o.raw = (q, t, pname); break
            try:
                v, q3 = READ[t](mm, q2)
            except (struct.error, IndexError, UnicodeDecodeError):
                o.raw = (q, t, pname); break
            q = q3; o.props[pname] = v
            if q > end:
                o.raw = (q, t, pname); break
        if not o.raw and q != end:
            o.raw = (q, None, "parse ended %d bytes before the object size" % (end - q))
        yield o
        p = end

def load(path):
    f = open(path, "rb"); mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    objs = list(walk(mm)); byhash = {}
    for o in objs:
        byhash.setdefault(o.hash, o)
    return mm, objs, byhash

def main():
    path, cmd = sys.argv[1], sys.argv[2]
    mm, objs, byhash = load(path)
    if cmd == "stats":
        c = collections.Counter(o.tag for o in objs); bad = collections.Counter((o.tag, o.raw[1], o.raw[2]) for o in objs if o.raw)
        print(len(objs), "objects, end at", objs[-1].off + objs[-1].size, "of", len(mm))
        for t, k in sorted(c.items()):
            ex = [o.name for o in objs if o.tag == t][:3]
            print("tag %02x: %5d  e.g. %s" % (t, k, ex))
        print("unparsed property types:", bad.most_common(30))
    elif cmd == "dump":
        sub = sys.argv[3]
        for o in objs:
            if sub in o.name:
                print("%r size %d" % (o, o.size))
                for k, v in o.props.items():
                    if isinstance(v, str) and len(v) > 200: v = v[:200] + "..."
                    if isinstance(v, list) and v and isinstance(v[0], tuple):
                        v = ["%02x:%s" % (t, byhash[h].name if h in byhash else "%08x?" % h) for t, h in v]
                    elif isinstance(v, tuple) and len(v) == 2 and k in ("parent", "child", "next", "mesh", "targetNode", "animation"):
                        v = byhash[v[1]].name if v[1] in byhash else v
                    print("   ", k, "=", v)
                if o.raw: print("    (stopped at type %02x %s)" % (o.raw[1], o.raw[2]))

if __name__ == "__main__":
    main()
