"""Minimal protobuf wire encoding/decoding (the game's schemas are rebuilt by hand, see GOFA_FINDINGS.md)."""


def varint(n):
    n &= (1 << 64) - 1
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def key(field, wt):
    return varint(field << 3 | wt)


def v(field, n):          # varint field (int32/uint32/enum/bool)
    return key(field, 0) + varint(n)


def f64(field, n):        # fixed64 field
    return key(field, 1) + (n & (1 << 64) - 1).to_bytes(8, "little")


def ld(field, data):      # length-delimited (string/bytes/message)
    if isinstance(data, str):
        data = data.encode()
    return key(field, 2) + varint(len(data)) + data


def read_varint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7F) << s; s += 7
        if c < 0x80:
            return r, i


def fields(b):
    """Yield (field, wire_type, value) for one message level."""
    i = 0
    while i < len(b):
        k, i = read_varint(b, i)
        f, wt = k >> 3, k & 7
        if wt == 0:
            val, i = read_varint(b, i)
        elif wt == 1:
            val = int.from_bytes(b[i:i + 8], "little"); i += 8
        elif wt == 5:
            val = int.from_bytes(b[i:i + 4], "little"); i += 4
        elif wt == 2:
            n, i = read_varint(b, i); val = b[i:i + n]; i += n
        else:
            raise ValueError(f"wire type {wt}")
        yield f, wt, val
