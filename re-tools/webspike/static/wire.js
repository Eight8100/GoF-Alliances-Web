/* Minimal protobuf wire codec for the legacy "dominion-bin" protocol (no dependencies, nothing downloaded).
   decode(bytes) -> [{f, wt, v}]: wt 0 varint -> Number (BigInt if above 2^53), wt 1 fixed64 -> {big: BigInt, num: Number, dbl: Number},
   wt 2 -> Uint8Array, wt 5 -> {u32, flt}. The game's messages carry no field names; the app maps field numbers (see app.js). */
(function (root) {
  "use strict";
  const MAXSAFE = BigInt(Number.MAX_SAFE_INTEGER);

  function readVarint(b, i) {
    let r = 0n, shift = 0n;
    for (;;) {
      if (i >= b.length) throw new Error("truncated varint");
      const x = b[i++];
      r |= BigInt(x & 0x7f) << shift;
      if (!(x & 0x80)) break;
      shift += 7n;
      if (shift > 70n) throw new Error("varint too long");
    }
    return [r, i];
  }

  function decode(b) {
    const out = [];
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let i = 0;
    while (i < b.length) {
      let key; [key, i] = readVarint(b, i);
      const f = Number(key >> 3n), wt = Number(key & 7n);
      if (wt === 0) {
        let v; [v, i] = readVarint(b, i);
        out.push({ f, wt, v: v <= MAXSAFE ? Number(v) : v });
      } else if (wt === 1) {
        if (i + 8 > b.length) throw new Error("truncated fixed64");
        const big = dv.getBigUint64(i, true);
        out.push({ f, wt, v: { big, num: big <= MAXSAFE ? Number(big) : NaN, dbl: dv.getFloat64(i, true) } });
        i += 8;
      } else if (wt === 2) {
        let n; [n, i] = readVarint(b, i);
        n = Number(n);
        if (i + n > b.length) throw new Error("truncated length-delimited field");
        out.push({ f, wt, v: b.subarray(i, i + n) });
        i += n;
      } else if (wt === 5) {
        if (i + 4 > b.length) throw new Error("truncated fixed32");
        out.push({ f, wt, v: { u32: dv.getUint32(i, true), flt: dv.getFloat32(i, true) } });
        i += 4;
      } else {
        throw new Error("unsupported wire type " + wt);
      }
    }
    return out;
  }

  const enc = new TextEncoder(), dec = new TextDecoder();

  function concat(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  function varintBytes(v) {
    let x = BigInt(v);
    if (x < 0n) x += 1n << 64n;
    const out = [];
    while (x > 0x7fn) { out.push(Number(x & 0x7fn) | 0x80); x >>= 7n; }
    out.push(Number(x));
    return Uint8Array.from(out);
  }

  const W = {
    decode,
    str: (u8) => dec.decode(u8),
    // builders (return Uint8Array)
    v: (f, val) => concat([varintBytes(BigInt(f) << 3n), varintBytes(val)]),
    f64: (f, val) => {                       // fixed64 from an integer / BigInt
      const b = new Uint8Array(8);
      new DataView(b.buffer).setBigUint64(0, BigInt(val), true);
      return concat([varintBytes((BigInt(f) << 3n) | 1n), b]);
    },
    dbl: (f, x) => {                         // fixed64 holding a double
      const b = new Uint8Array(8);
      new DataView(b.buffer).setFloat64(0, x, true);
      return concat([varintBytes((BigInt(f) << 3n) | 1n), b]);
    },
    ld: (f, data) => {
      const d = typeof data === "string" ? enc.encode(data) : data;
      return concat([varintBytes((BigInt(f) << 3n) | 2n), varintBytes(d.length), d]);
    },
    concat,
    // lookups over a decoded list
    get: (fs, n) => { for (const x of fs) if (x.f === n) return x.v; return undefined; },
    all: (fs, n) => fs.filter((x) => x.f === n).map((x) => x.v),
    msg: (u8) => decode(u8),
    num: (x) => (x && typeof x === "object" && "num" in x ? x.num : x),     // fixed64 / varint -> Number
  };
  root.Wire = W;
})(typeof window !== "undefined" ? window : globalThis);
