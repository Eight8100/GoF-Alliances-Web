#!/usr/bin/env python3
"""Probe the .ae3 container of Galaxy on Fire: Alliances 1.16.1 (the 'rgba' tiers), read-only.
Grammar found so far (checked by consuming a whole file): file = objects; object = 0x11, u32 id, 4 zero bytes, 4-byte name hash, UTF-16LE name
(NUL-terminated), u8 property count, then per property: 4-byte hash, 1 byte, UTF-16LE property name (NUL-terminated), value
(u32 for numbers; for 'data': u32 length + raw bytes)."""
import struct, sys, collections

def utf16z(d, p):
    q = p
    while d[q:q + 2] != b"\x00\x00" or (q - p) % 2:
        q += 1
    return d[p:q].decode("utf-16le"), q + 2

def parse(path, limit=None, verbose=False):
    d = open(path, "rb").read()
    pos, objs, unknown = 0, [], collections.Counter()
    while pos < len(d) and (limit is None or len(objs) < limit):
        if d[pos] != 0x11:
            raise SystemExit(f"object tag expected at {pos}, got {d[pos]:#x}")
        oid = struct.unpack_from("<I", d, pos + 1)[0]; pos += 9
        pos += 4
        name, pos = utf16z(d, pos)
        n = d[pos]; pos += 1
        props = {}
        for _ in range(n):
            pos += 5
            pname, pos = utf16z(d, pos)
            if pname == "data":
                ln = struct.unpack_from("<I", d, pos)[0]; pos += 4
                props[pname] = (pos, ln); pos += ln
            else:
                props[pname] = struct.unpack_from("<I", d, pos)[0]; pos += 4
                unknown[pname] += 1
        objs.append((oid, name, props))
        if verbose:
            print(oid, name, {k: v for k, v in props.items()})
    return d, objs, pos, unknown

if __name__ == "__main__":
    d, objs, pos, unknown = parse(sys.argv[1], limit=int(sys.argv[2]) if len(sys.argv) > 2 else None, verbose="-v" in sys.argv)
    print(f"{len(objs)} objects, stopped at {pos} of {len(d)}; property names seen: {dict(unknown)}")
