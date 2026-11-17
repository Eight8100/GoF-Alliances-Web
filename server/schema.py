"""Build protobuf payloads from the recovered message map (protos/messages.json, re-tools/msgmap.py).

    minimal(msg)              smallest valid instance: every required field, recursively
    build(msg, {field: value}) instance with chosen fields (values: int, float, str, bytes, dict for
                              nested messages, list for repeated fields); required fields not given are
                              filled with minimal values.
    check(msg, data)          problems the client would hit parsing `data` as `msg` (see check())
`msg` is a message id from the map (vtable address string) or ("request"|"response", extension number).
The map (v2) is rebuilt from the parsers' control flow, wire types and has-bits; see re-tools/msgmap.py.
"""
import json
import os
import struct

import pb

_here = os.path.dirname(os.path.abspath(__file__))
_map = json.load(open(os.path.join(_here, "..", "protos", "messages.json")))
MESSAGES = _map["messages"]
EXT = {(e["container"], e["number"]): e["msg"] for e in _map["extensions"] if e["msg"]}


def resolve(msg):
    return EXT[msg] if isinstance(msg, tuple) else msg


def _scalar(fnum, f, value):
    t = f["type"]
    if t == "string":
        return pb.ld(fnum, value if isinstance(value, (str, bytes)) else str(value))
    if t == "fixed64":
        if isinstance(value, float):
            return pb.key(fnum, 1) + struct.pack("<d", value)
        return pb.f64(fnum, int(value))
    if t == "fixed32":
        return pb.key(fnum, 5) + struct.pack("<I", int(value))
    if t == "float":
        return pb.key(fnum, 5) + struct.pack("<f", float(value))
    if t == "double":
        return pb.key(fnum, 1) + struct.pack("<d", float(value))
    return pb.v(fnum, int(value))  # varint32 / varint64 / int32 / bool / enum


def _default(f):
    if "enum" in f:
        return f["enum"][0]
    if f["type"] == "string":
        return ""
    if f["type"] in ("float", "double"):
        return 0.0
    return 0


def build(msg, values=None, depth=0):
    mid = resolve(msg)
    values = values or {}
    if mid not in MESSAGES:
        raise KeyError(f"no layout for {msg}")
    out = b""
    for fnum_s, f in MESSAGES[mid]["fields"].items():
        fnum = int(fnum_s)
        if fnum in values:
            v = values[fnum]
        elif f["required"]:
            v = {} if f["type"] == "message" else _default(f)
        else:
            continue
        items = v if (f["repeated"] and isinstance(v, list)) else [v]
        for item in items:
            if f["type"] == "message":
                if isinstance(item, bytes):
                    out += pb.ld(fnum, item)
                elif "msg" in f and depth < 12:
                    out += pb.ld(fnum, build(f["msg"], item, depth + 1))
                else:
                    out += pb.ld(fnum, b"")
            else:
                out += _scalar(fnum, f, item)
    return out


def minimal(msg):
    return build(msg, {})


def required_tree(msg, depth=0, seen=()):
    """Readable list of the required fields under a message (for planning)."""
    mid = resolve(msg)
    lines = []
    for fnum, f in MESSAGES.get(mid, {}).get("fields", {}).items():
        if not f["required"]:
            continue
        lines.append("  " * depth + f"{fnum}: {f['type']}" + (f" enum{f['enum']}" if "enum" in f else ""))
        if "msg" in f and f["msg"] not in seen:
            lines += required_tree(f["msg"], depth + 1, seen + (mid,))
    return lines


_WIRE = {"varint32": 0, "varint64": 0, "int32": 0, "fixed64": 1, "double": 1, "fixed32": 5, "float": 5,
         "string": 2, "bytes": 2, "message": 2}


def check(msg, data, path=None, depth=0):
    """Problems the game's parser would hit with `data` as message `msg`, as a list of strings:
      ERROR  required field missing (IsInitialized fails -> the whole envelope is rejected),
             or bytes that do not parse at all
      WARN   wrong wire type (the client skips the field), enum value outside the valid set (dropped),
             a field number the message does not have (kept as unknown, ignored)
    """
    mid = resolve(msg)
    path = path or (f"{msg[0]} {msg[1]}" if isinstance(msg, tuple) else mid)
    if mid not in MESSAGES:
        return [f"WARN  {path}: no layout for {mid}"]
    layout = MESSAGES[mid]["fields"]
    out, present = [], set()
    try:
        items = list(pb.fields(data))
    except Exception as e:
        return [f"ERROR {path}: does not parse ({e})"]
    for fnum, wt, val in items:
        f = layout.get(str(fnum))
        where = f"{path}.{fnum}"
        if f is None:
            out.append(f"WARN  {where}: field not in layout (ignored by client)")
            continue
        want = set(f.get("wire") or [_WIRE.get(f["type"], wt)])
        if wt not in want:
            out.append(f"WARN  {where}: wire type {wt}, client expects {sorted(want)} ({f['type']}): skipped")
            continue
        if wt == 0 and "enum" in f and val not in f["enum"]:
            out.append(f"WARN  {where}: enum value {val} not in {f['enum']} (dropped)")
            continue   # dropped = absent (a required one then fails IsInitialized below)
        present.add(fnum)
        if wt == 2 and f["type"] == "message" and "msg" in f and depth < 20:
            out += check(f["msg"], val, where, depth + 1)
    for fnum_s, f in layout.items():
        if f["required"] and int(fnum_s) not in present:
            out.append(f"ERROR {path}.{fnum_s}: required {f['type']} missing")
    return out
