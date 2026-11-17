"""Minimal Photon Chat server emulator (eNet over UDP + Protocol16) for the alliance chat.

The game's chat manager connects to the Photon name server ns.exitgamescloud.com:5058 (redirected to the USB
link by redirect.js). This one process plays both name server and chat frontend on the same port: an
OpAuthenticate without a secret gets {secret, frontend address = us}, one with the secret is the frontend login.
Logs every packet (hex) to photon.out. Run: python3 -u photon_chat.py  (sandbox off, like serve.py).
"""
import base64
import hashlib
import json
import os
import secrets
import socket
import struct
import sys
import time

from netconf import server_host

PORT = int(os.environ.get("GOFA_PHOTON_PORT", "5058"))
HERE = os.path.dirname(os.path.abspath(__file__))
HISTORY_FILE = os.path.join(HERE, "state", "chat_history.json")
T0 = time.time()


def ms():
    return int((time.time() - T0) * 1000) & 0xFFFFFFFF


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------- Protocol16 (GpBinary)
class Raw(bytes):
    """Pre-typed value (type byte already included)."""


def ser(v):
    if v is None:
        return b"*"
    if isinstance(v, Raw):
        return bytes(v)
    if isinstance(v, bool):
        return b"o" + bytes([1 if v else 0])
    if isinstance(v, int):
        return b"i" + struct.pack(">i", v)
    if isinstance(v, str):
        b = v.encode()
        return b"s" + struct.pack(">H", len(b)) + b
    if isinstance(v, (bytes, bytearray)):
        return b"x" + struct.pack(">i", len(v)) + bytes(v)
    if isinstance(v, dict):
        out = b"h" + struct.pack(">H", len(v))
        for k, x in v.items():
            out += ser(k) + ser(x)
        return out
    if isinstance(v, list):
        if v and all(isinstance(x, str) for x in v):
            # The C++ SDK reads JString[] as a typed array 'y' + 's' ('a' gives a null array -> crash 0x1008b8a60).
            out = b"y" + struct.pack(">H", len(v)) + b"s"
            for x in v:
                b = x.encode()
                out += struct.pack(">H", len(b)) + b
            return out
        out = b"z" + struct.pack(">H", len(v))
        for x in v:
            out += ser(x)
        return out
    raise TypeError(type(v))


def byte_(n):
    return Raw(b"b" + bytes([n & 0xFF]))


def objs(lst):
    """Object[] ('z', each element typed) - ChatMessages param 2."""
    return Raw(b"z" + struct.pack(">H", len(lst)) + b"".join(ser(x) for x in lst))


def bools(lst):
    return Raw(b"y" + struct.pack(">H", len(lst)) + b"o" + bytes(1 if x else 0 for x in lst))


class Rd:
    def __init__(self, b, i=0):
        self.b, self.i = b, i

    def take(self, n):
        v = self.b[self.i:self.i + n]
        self.i += n
        return v

    def u8(self):
        return self.take(1)[0]

    def value(self, t=None):
        if t is None:
            t = chr(self.u8())
        if t == "*" or t == "\x00":
            return None
        if t == "b":
            return self.u8()
        if t == "o":
            return bool(self.u8())
        if t == "k":
            return struct.unpack(">h", self.take(2))[0]
        if t == "i":
            return struct.unpack(">i", self.take(4))[0]
        if t == "l":
            return struct.unpack(">q", self.take(8))[0]
        if t == "f":
            return struct.unpack(">f", self.take(4))[0]
        if t == "d":
            return struct.unpack(">d", self.take(8))[0]
        if t == "s":
            n = struct.unpack(">H", self.take(2))[0]
            return self.take(n).decode("utf-8", "replace")
        if t == "x":
            n = struct.unpack(">i", self.take(4))[0]
            return bytes(self.take(n))
        if t == "n":
            n = struct.unpack(">i", self.take(4))[0]
            return [struct.unpack(">i", self.take(4))[0] for _ in range(n)]
        if t == "a":
            n = struct.unpack(">H", self.take(2))[0]
            return [self.value("s") for _ in range(n)]
        if t == "y":
            n = struct.unpack(">H", self.take(2))[0]
            et = chr(self.u8())
            return [self.value(et) for _ in range(n)]
        if t == "z":
            n = struct.unpack(">H", self.take(2))[0]
            return [self.value() for _ in range(n)]
        if t == "h":
            n = struct.unpack(">H", self.take(2))[0]
            return {self.value(): self.value() for _ in range(n)}
        if t == "D":
            kt, vt = chr(self.u8()), chr(self.u8())
            n = struct.unpack(">H", self.take(2))[0]
            out = {}
            for _ in range(n):
                k = self.value(None if kt == "\x00" or kt == "*" else kt)
                out[k] = self.value(None if vt == "\x00" or vt == "*" else vt)
            return out
        raise ValueError("unknown type %r at %d" % (t, self.i))

    def params(self):
        n = struct.unpack(">h", self.take(2))[0]
        out = {}
        for _ in range(n):
            k = self.u8()
            out[k] = self.value()
        return out


def ser_params(p):
    out = struct.pack(">h", len(p))
    for k, v in p.items():
        out += bytes([k]) + ser(v)
    return out


def op_response(code, params, ret=0, debug=None):
    return bytes([code]) + struct.pack(">h", ret) + ser(debug) + ser_params(params)


def event(code, params):
    return bytes([code]) + ser_params(params)


# ---------------------------------------------------------------- encryption (Photon DH, Oakley 768-bit group)
OAKLEY_768 = int(
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD"
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A63A3620FFFFFFFFFFFFFFFF", 16)
DH_GEN = 22


def int_bytes(n):
    return n.to_bytes((n.bit_length() + 7) // 8 or 1, "big")


def aes(key, data, decrypt, iv=b"\0" * 16):
    """AES-CBC + PKCS7. Uses the cryptography package when present, else the pure-Python version below
    (the iPad's Python has no cryptography wheel; chat messages are small, so speed doesn't matter)."""
    try:
        from cryptography.hazmat.primitives import padding
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    except ImportError:
        return _aes_cbc(key, data, decrypt, iv)
    c = Cipher(algorithms.AES(key), modes.CBC(iv))
    if decrypt:
        d = c.decryptor()
        raw = d.update(data) + d.finalize()
        u = padding.PKCS7(128).unpadder()
        return u.update(raw) + u.finalize()
    p = padding.PKCS7(128).padder()
    raw = p.update(data) + p.finalize()
    e = c.encryptor()
    return e.update(raw) + e.finalize()


def _aes_tables():
    sbox, inv = [0] * 256, [0] * 256
    p = q = 1
    while True:   # walk the multiplicative group (generator 3) to build the S-box
        p ^= (p << 1) ^ (0x1B if p & 0x80 else 0)
        p &= 0xFF
        q ^= q << 1
        q ^= q << 2
        q ^= q << 4
        q &= 0xFF
        if q & 0x80:
            q ^= 0x09
        x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4))
        x = (x ^ 0x63) & 0xFF
        sbox[p] = x
        inv[x] = p
        if p == 1:
            break
    sbox[0] = 0x63
    inv[0x63] = 0
    return sbox, inv


_SBOX, _INV_SBOX = _aes_tables()


def _xt(a):
    return ((a << 1) ^ 0x1B) & 0xFF if a & 0x80 else a << 1


def _mul(a, b):
    r = 0
    while b:
        if b & 1:
            r ^= a
        a = _xt(a)
        b >>= 1
    return r


def _expand(key):
    nk = len(key) // 4
    rounds = nk + 6
    w = [list(key[4 * i:4 * i + 4]) for i in range(nk)]
    rcon = 1
    for i in range(nk, 4 * (rounds + 1)):
        t = list(w[i - 1])
        if i % nk == 0:
            t = [_SBOX[b] for b in t[1:] + t[:1]]
            t[0] ^= rcon
            rcon = _xt(rcon)
        elif nk > 6 and i % nk == 4:
            t = [_SBOX[b] for b in t]
        w.append([a ^ b for a, b in zip(w[i - nk], t)])
    return [sum(w[4 * r:4 * r + 4], []) for r in range(rounds + 1)]


def _encrypt_block(rk, b):
    s = [x ^ k for x, k in zip(b, rk[0])]
    for r in range(1, len(rk)):
        s = [_SBOX[x] for x in s]
        s = [s[(i + 4 * (i % 4)) % 16] for i in range(16)]   # shift rows (column-major state)
        if r != len(rk) - 1:
            m = []
            for c in range(4):
                a = s[4 * c:4 * c + 4]
                m += [_xt(a[0]) ^ _xt(a[1]) ^ a[1] ^ a[2] ^ a[3], a[0] ^ _xt(a[1]) ^ _xt(a[2]) ^ a[2] ^ a[3],
                      a[0] ^ a[1] ^ _xt(a[2]) ^ _xt(a[3]) ^ a[3], _xt(a[0]) ^ a[0] ^ a[1] ^ a[2] ^ _xt(a[3])]
            s = m
        s = [x ^ k for x, k in zip(s, rk[r])]
    return bytes(s)


def _decrypt_block(rk, b):
    s = [x ^ k for x, k in zip(b, rk[-1])]
    for r in range(len(rk) - 2, -1, -1):
        s = [s[(i - 4 * (i % 4)) % 16] for i in range(16)]   # inverse shift rows
        s = [_INV_SBOX[x] for x in s]
        s = [x ^ k for x, k in zip(s, rk[r])]
        if r:
            m = []
            for c in range(4):
                a = s[4 * c:4 * c + 4]
                m += [_mul(a[0], 14) ^ _mul(a[1], 11) ^ _mul(a[2], 13) ^ _mul(a[3], 9),
                      _mul(a[0], 9) ^ _mul(a[1], 14) ^ _mul(a[2], 11) ^ _mul(a[3], 13),
                      _mul(a[0], 13) ^ _mul(a[1], 9) ^ _mul(a[2], 14) ^ _mul(a[3], 11),
                      _mul(a[0], 11) ^ _mul(a[1], 13) ^ _mul(a[2], 9) ^ _mul(a[3], 14)]
            s = m
    return bytes(s)


def _aes_cbc(key, data, decrypt, iv):
    rk = _expand(key)
    out, prev = [], iv
    if decrypt:
        for i in range(0, len(data), 16):
            blk = data[i:i + 16]
            out.append(bytes(a ^ b for a, b in zip(_decrypt_block(rk, blk), prev)))
            prev = blk
        raw = b"".join(out)
        return raw[:-raw[-1]]
    n = 16 - len(data) % 16
    data += bytes([n]) * n
    for i in range(0, len(data), 16):
        prev = _encrypt_block(rk, bytes(a ^ b for a, b in zip(data[i:i + 16], prev)))
        out.append(prev)
    return b"".join(out)


# ---------------------------------------------------------------- chat state
SECRETS = {}       # secret -> user id
CHANNELS = {}      # name -> set of peer keys
HISTORY = {}       # name -> [[sender, message], ...]
try:
    HISTORY = json.load(open(HISTORY_FILE))
except Exception:
    pass


def chat_text(text, t=None):
    """Chat message body as the client writes it: base64(text) + "|" + base64(send time as little-endian double)."""
    return base64.b64encode(text.encode()).decode() + "|" + base64.b64encode(struct.pack("<d", t or time.time())).decode()


def stamped(m):
    """Give a message without a valid time suffix the current time (the client shows "Name, :" otherwise)."""
    if not isinstance(m, str):
        return m
    body, _, suf = m.partition("|")
    try:
        if 1e9 < struct.unpack("<d", base64.b64decode(suf))[0] < 4e9:
            return m
    except Exception:
        pass
    return body + "|" + base64.b64encode(struct.pack("<d", time.time())).decode()


def save_history():
    try:
        json.dump(HISTORY, open(HISTORY_FILE, "w"))
    except Exception as e:
        log("history save failed", e)


class Peer:
    def __init__(self, addr, peer_id):
        self.addr, self.peer_id = addr, peer_id
        self.challenge = 0
        self.out_seq = {}      # channel -> last reliable seq sent
        self.unrel_seq = {}
        self.user = None
        self.key = None
        self.dh_secret = None
        self.frontend = False
        self.unacked = {}      # (channel, seq) -> [command bytes, next resend time, resends]; dropped on the client's ACK
        self.rx_seen = {}      # channel -> reliable seqs already handled (Wi-Fi loss makes the client resend)


PEERS = {}
NEXT_ID = [1]
PENDING = []       # [(due time, fn)] run from the main loop
# Alliance history sent at subscribe is lost (tab starts empty after a relaunch): send it this many seconds later instead.
ALLIANCE_HIST_DELAY = float(os.environ.get("GOFA_ACHAT_DELAY", "8"))
SOCK = None
# Over USB nothing was ever lost; over Wi-Fi replies are, so unacknowledged reliable commands are resent like Photon does.
RESEND_FIRST, RESEND_MAX_GAP, RESEND_TRIES = 0.3, 2.0, 12


def send_cmds(p, cmds):
    """cmds = list of raw command bytes; one UDP packet."""
    hdr = struct.pack(">HBBII", p.peer_id, 0, len(cmds), ms(), p.challenge & 0xFFFFFFFF)
    pkt = hdr + b"".join(cmds)
    try:
        SOCK.sendto(pkt, p.addr)
    except OSError as e:   # a peer that left the network (No route to host) must not kill the server
        log("send failed", p.addr, e)
        return
    log("->", p.addr, pkt.hex())


def cmd(ctype, channel, flags, payload, seq=0, extra=b""):
    return struct.pack(">BBBBiI", ctype, channel, flags, 4, 12 + len(extra) + len(payload), seq) + extra + payload


def reliable(p, channel, payload, ctype=6):
    s = p.out_seq.get(channel, 0) + 1
    p.out_seq[channel] = s
    c = cmd(ctype, channel, 1, payload, s)
    p.unacked[(channel, s)] = [c, time.time() + RESEND_FIRST, 0]
    return c


def resend_due():
    now = time.time()
    for p in list(PEERS.values()):
        for key, item in list(p.unacked.items()):
            if item[1] > now:
                continue
            if item[2] >= RESEND_TRIES:
                log("   gave up on ch=%d seq=%d after %d resends" % (key[0], key[1], item[2]))
                del p.unacked[key]
                continue
            item[2] += 1
            item[1] = now + min(RESEND_FIRST * 2 ** item[2], RESEND_MAX_GAP)
            log("   RESEND ch=%d seq=%d (#%d)" % (key[0], key[1], item[2]))
            send_cmds(p, [item[0]])


def send_msg(p, msg_type, body, channel=0, encrypt=False):
    if encrypt and p.key:
        payload = bytes([0xF3, msg_type | 0x80]) + aes(p.key, body, False)
    else:
        payload = bytes([0xF3, msg_type]) + body
    send_cmds(p, [reliable(p, channel, payload)])


def handle_message(p, channel, data):
    if not data or data[0] != 0xF3:
        log("   non-photon payload", data.hex())
        return
    mtype = data[1] & 0x7F
    enc = bool(data[1] & 0x80)
    body = data[2:]
    if enc:
        if not p.key:
            log("   encrypted message but no key")
            return
        try:
            body = aes(p.key, body, True)
        except Exception:
            body = aes(p.key, body[16:], True, body[:16])  # random-IV variant
    if mtype == 0:  # init
        log("   INIT", body.hex(), repr(body))
        send_msg(p, 1, b"\x00", channel)
        return
    if mtype in (2, 6):
        r = Rd(body)
        code = r.u8()
        params = r.params()
        log("   OP%s %d enc=%s %r" % (" internal" if mtype == 6 else "", code, enc, params))
        if mtype == 6:
            handle_internal(p, channel, code, params)
        else:
            handle_op(p, channel, code, params, enc)
        return
    log("   msg type", mtype, body.hex())


def handle_internal(p, channel, code, params):
    if code == 0:  # InitEncryption: {1 client public key}
        cpub = int.from_bytes(params.get(1, b""), "big")
        p.dh_secret = secrets.randbits(160)
        spub = pow(DH_GEN, p.dh_secret, OAKLEY_768)
        shared = pow(cpub, p.dh_secret, OAKLEY_768)
        p.key = hashlib.sha256(int_bytes(shared)).digest()
        send_msg(p, 7, op_response(0, {1: int_bytes(spub)}), channel)
        return
    if code == 1:  # ping
        send_msg(p, 7, op_response(1, params), channel)
        return
    log("   unhandled internal op", code)


def handle_op(p, channel, code, params, enc):
    if code == 230:  # Authenticate
        secret = params.get(221)
        if secret and secret in SECRETS:
            p.user = SECRETS[secret]
            p.frontend = True
            send_msg(p, 3, op_response(230, {225: p.user}), channel, enc)
            log("   frontend login", p.user)
            return
        p.user = str(params.get(225) or "user%d" % p.peer_id)
        sec = secrets.token_hex(16)
        SECRETS[sec] = p.user
        front = "%s:%d" % (os.environ.get("GOFA_PUBLIC_HOST") or server_host(), PORT)
        if p.addr[0] == "127.0.0.1":   # client on this Mac (hosts-file test): stay on loopback, no network needed
            front = "127.0.0.1:%d" % PORT
        send_msg(p, 3, op_response(230, {221: sec, 230: front, 225: p.user}), channel, enc)
        log("   nameserver auth", p.user, "->", front)
        return
    if code == 0:  # Subscribe {0 channels, 14 history length}
        chans = params.get(0) or []
        hist = params.get(14, 0) or 0
        for c in chans:
            CHANNELS.setdefault(c, set()).add(p.addr)
        send_msg(p, 3, op_response(0, {}), channel, enc)
        send_msg(p, 4, event(5, {0: chans, 15: bools([True] * len(chans))}), channel, enc)
        for c in chans:
            h = HISTORY.get(c, [])
            if hist and h:
                h = h[-hist:] if hist > 0 else h
                ev = event(0, {1: c, 4: [x[0] for x in h], 2: objs([x[1] for x in h])})
                if c.startswith("alliance_") and ALLIANCE_HIST_DELAY > 0:
                    log("   history for", c, "in", ALLIANCE_HIST_DELAY, "s")
                    PENDING.append((time.time() + ALLIANCE_HIST_DELAY,
                                    lambda p=p, ev=ev, ch=channel, enc=enc: send_msg(p, 4, ev, ch, enc)))
                else:
                    send_msg(p, 4, ev, channel, enc)
        return
    if code == 1:  # Unsubscribe
        chans = params.get(0) or []
        for c in chans:
            CHANNELS.get(c, set()).discard(p.addr)
        send_msg(p, 3, op_response(1, {}), channel, enc)
        send_msg(p, 4, event(6, {0: chans}), channel, enc)
        return
    if code == 2:  # Publish {1 channel, 3 message}
        c, m = params.get(1), stamped(params.get(3))
        HISTORY.setdefault(c, []).append([p.user, m])
        HISTORY[c] = HISTORY[c][-100:]
        save_history()
        send_msg(p, 3, op_response(2, {}), channel, enc)
        for a in list(CHANNELS.get(c, ())):
            q = PEERS.get(a)
            if q:
                send_msg(q, 4, event(0, {1: c, 4: [p.user], 2: objs([m])}), 0, bool(q.key))
        return
    if code == 5:  # UpdateStatus
        send_msg(p, 3, op_response(5, {}), channel, enc)
        return
    log("   unhandled op", code, "-> OK")
    send_msg(p, 3, op_response(code, {}), channel, enc)


def handle_packet(data, addr):
    log("<-", addr, data.hex())
    if len(data) < 12:
        return
    peer_id, crc, count, sent, challenge = struct.unpack(">HBBIi", data[:12])
    i = 12 + (4 if crc else 0)
    p = PEERS.get(addr)
    for _ in range(count):
        if i + 12 > len(data):
            break
        ctype, ch, flags, _r, length, seq = struct.unpack(">BBBBiI", data[i:i + 12])
        body = data[i + 12:i + length]
        i += length
        if ctype == 2 and p is not None and p.challenge == challenge:
            # the client resent CONNECT (our VERIFYCONNECT was lost): ACK it, the VERIFYCONNECT resend is pending
            send_cmds(p, [cmd(1, ch, 0, struct.pack(">Ii", seq, sent), seq)])
            continue
        if ctype == 2:  # CONNECT
            p = Peer(addr, NEXT_ID[0])
            NEXT_ID[0] += 1
            PEERS[addr] = p
            p.challenge = challenge
            log("   CONNECT ch=%d seq=%d" % (ch, seq), body.hex())
            ver = bytearray(body.ljust(32, b"\0"))
            ver[0:2] = struct.pack(">H", p.peer_id)
            send_cmds(p, [cmd(1, ch, 0, struct.pack(">Ii", seq, sent), seq),
                          reliable(p, ch, bytes(ver), 3)])
            continue
        if p is None:
            log("   command from unknown peer", ctype)
            continue
        p.challenge = challenge
        if flags & 1:  # reliable -> ACK
            send_cmds(p, [cmd(1, ch, 0, struct.pack(">Ii", seq, sent), seq)])
            seen = p.rx_seen.setdefault(ch, set())
            if seq in seen:
                continue   # a resend of something already handled
            seen.add(seq)
        if ctype == 1:
            p.unacked.pop((ch, struct.unpack(">I", body[:4])[0]), None)
            continue
        if ctype == 4:
            log("   DISCONNECT")
            for s in CHANNELS.values():
                s.discard(addr)
            PEERS.pop(addr, None)
            continue
        if ctype == 5:
            continue
        if ctype == 6:
            handle_message(p, ch, body)
        elif ctype == 7:
            handle_message(p, ch, body[4:])
        elif ctype == 8:
            log("   FRAGMENT (not handled)", body[:20].hex())
        else:
            log("   cmd type", ctype, body.hex())


def main():
    global SOCK
    host = "0.0.0.0" if os.environ.get("GOFA_PUBLIC_HOST") else server_host()   # public route: all interfaces
    SOCK = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    SOCK.bind((host, PORT))
    log("photon listening on", host, PORT)
    SOCK.settimeout(0.1)
    while True:
        resend_due()
        now = time.time()
        for item in [x for x in PENDING if x[0] <= now]:
            PENDING.remove(item)
            try:
                item[1]()
            except Exception as e:
                log("pending failed", e)
        try:
            data, addr = SOCK.recvfrom(65536)
        except socket.timeout:
            continue
        try:
            handle_packet(data, addr)
        except Exception as e:
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    main()
