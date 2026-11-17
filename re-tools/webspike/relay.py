#!/usr/bin/env python3
"""Phase 0 spike (docs/WEB_APP_CONCEPT.md section 7): a browser page that plays a player on the LEGACY game server.

    python3 -I re-tools/webspike/relay.py [--port 8765] [--fixture big-save | --state DIR | --upstream http://HOST:PORT | --play [--data DIR] [--open]]

The game server sends no CORS headers, so the page cannot call it directly. This relay serves the page (static/) and forwards
POST /action and GET /debug/* to the server, same origin. By default it starts a THROWAWAY copy of server/ in a temp sandbox
(empty state, or a copy of --fixture / --state) on 127.0.0.1, so the live saves in server/state are never touched; the sandbox is
deleted on exit. --upstream sends everything to an already running server instead (that one is live: its saves change).
Nothing leaves this machine: the relay listens on 127.0.0.1 only and loads no remote script.

--play = PLAY MODE (2026-11-13): the same page on a game server of its own whose saves are KEPT (default re-tools/webspike/play-data, git-ignored),
separate from the iPad's live saves in server/state. The server code is copied from server/ at every start (so it is always current), the state
folder is backed up at start, every hour and at exit (the last 10 are kept, play-data/backups/), the test tools are hidden and only the read-only
/debug/quote (prices, times, odds) is forwarded: every other /debug/* is refused (also with --upstream, unless --allow-debug-upstream).
Anyone who can open the page can log in with any name, so play mode is for this Mac (127.0.0.1) only.
"""
import argparse
import atexit
import datetime
import http.server
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
STATIC = os.path.join(HERE, "static")
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png"}


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def start_sandbox(state):
    """Copy server/*.py + gofa_core to a temp dir, link data/ and protos/, optionally copy a state dir, start server.py on 127.0.0.1."""
    sb = tempfile.mkdtemp(prefix="gofa-webspike-")
    src = os.path.join(ROOT, "server")
    os.makedirs(os.path.join(sb, "server", "backups"))
    for f in os.listdir(src):
        if f.endswith(".py") or f == "auto_skip.txt":
            shutil.copy(os.path.join(src, f), os.path.join(sb, "server", f))
    shutil.copytree(os.path.join(src, "gofa_core"), os.path.join(sb, "server", "gofa_core"), ignore=shutil.ignore_patterns("__pycache__"))
    for d in ("data", "protos"):
        os.symlink(os.path.join(ROOT, d), os.path.join(sb, d))
    if state:
        shutil.copytree(state, os.path.join(sb, "server", "state"))
    port = free_port()
    env = {k: v for k, v in os.environ.items() if not k.startswith("GOFA_")}
    env.update(GOFA_HOST="127.0.0.1", GOFA_PORT=str(port), GOFA_NO_CAPTURES="1", PYTHONUNBUFFERED="1")
    log = open(os.path.join(sb, "server.out"), "w")
    proc = subprocess.Popen([sys.executable, "-B", "server.py"], cwd=os.path.join(sb, "server"), env=env, stdout=log, stderr=subprocess.STDOUT)

    def cleanup():
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(5)
            except subprocess.TimeoutExpired:
                proc.kill()
        shutil.rmtree(sb, ignore_errors=True)
    atexit.register(cleanup)
    for _ in range(100):   # wait until it accepts connections
        try:
            socket.create_connection(("127.0.0.1", port), 0.2).close()
            return f"http://127.0.0.1:{port}", sb
        except OSError:
            if proc.poll() is not None:
                raise SystemExit("sandbox server exited:\n" + open(os.path.join(sb, "server.out")).read())
            time.sleep(0.1)
    raise SystemExit("sandbox server did not start")


BACKUPS_KEPT = 10


def backup_state(data):
    """Copy play-data/server/state to play-data/backups/state-YYYYMMDD-HHMMSS and keep the newest BACKUPS_KEPT."""
    state = os.path.join(data, "server", "state")
    if not os.path.isdir(state):
        return None
    bdir = os.path.join(data, "backups")
    os.makedirs(bdir, exist_ok=True)
    dest = os.path.join(bdir, "state-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
    n = 0
    while os.path.exists(dest + ("" if not n else f"-{n}")):
        n += 1
    dest += "" if not n else f"-{n}"
    shutil.copytree(state, dest)
    old = sorted(d for d in os.listdir(bdir) if d.startswith("state-"))
    for d in old[:-BACKUPS_KEPT]:
        shutil.rmtree(os.path.join(bdir, d), ignore_errors=True)
    return dest


def start_play(data):
    """A persistent game server on 127.0.0.1: fresh copy of the server code, the saves in DATA/server/state stay between runs."""
    data = os.path.abspath(data)
    srv = os.path.join(data, "server")
    os.makedirs(srv, exist_ok=True)
    lock = os.path.join(data, "play.lock")   # two play servers on one set of saves would corrupt them
    try:
        pid = int(open(lock).read().strip())
        os.kill(pid, 0)
        raise SystemExit(f"play mode is already running for {data} (process {pid}): stop it first (or use --data for another world)")
    except (OSError, ValueError):
        pass
    open(lock, "w").write(str(os.getpid()))
    first = not os.path.isdir(os.path.join(srv, "state"))
    if not first:
        b = backup_state(data)
        print(f"backup of the saves: {b}")
    src = os.path.join(ROOT, "server")
    for f in os.listdir(src):
        if f.endswith(".py") or f == "auto_skip.txt":
            shutil.copy(os.path.join(src, f), os.path.join(srv, f))
    gc = os.path.join(srv, "gofa_core")
    shutil.rmtree(gc, ignore_errors=True)
    shutil.copytree(os.path.join(src, "gofa_core"), gc, ignore=shutil.ignore_patterns("__pycache__"))
    for d in ("data", "protos"):
        link = os.path.join(data, d)
        if not os.path.lexists(link):
            os.symlink(os.path.join(ROOT, d), link)
    port = free_port()
    env = {k: v for k, v in os.environ.items() if not k.startswith("GOFA_")}
    env.update(GOFA_HOST="127.0.0.1", GOFA_PORT=str(port), GOFA_NO_CAPTURES="1", PYTHONUNBUFFERED="1")
    log = open(os.path.join(data, "server.out"), "a")
    proc = subprocess.Popen([sys.executable, "-B", "server.py"], cwd=srv, env=env, stdout=log, stderr=subprocess.STDOUT)
    stop = threading.Event()

    def hourly():
        while not stop.wait(3600):
            try:
                backup_state(data)
            except OSError as e:
                print("backup failed:", e, flush=True)

    def cleanup():
        stop.set()
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(10)
            except subprocess.TimeoutExpired:
                proc.kill()
        try:
            print(f"backup of the saves: {backup_state(data)}", flush=True)
        except OSError as e:
            print("backup failed:", e, flush=True)
        try:
            os.remove(lock)
        except OSError:
            pass
    atexit.register(cleanup)
    threading.Thread(target=hourly, daemon=True).start()
    for _ in range(200):   # wait until it accepts connections
        try:
            socket.create_connection(("127.0.0.1", port), 0.2).close()
            return f"http://127.0.0.1:{port}", data, first
        except OSError:
            if proc.poll() is not None:
                raise SystemExit("play server exited:\n" + open(os.path.join(data, "server.out")).read()[-2000:])
            time.sleep(0.1)
    raise SystemExit("play server did not start")


def imported():
    """True when this copy has the files from the player's own app (re-tools/import_app.py)."""
    return all(os.path.exists(os.path.join(ROOT, *p)) for p in (("data", "map_x", "0_0"), ("data", "loca_en.tsv"), ("data", "base_loc_en"),
                                                               ("art", "extracted", "ui_high")))


class Setup:
    """First-run import: the page uploads the .ipa to this relay (127.0.0.1, it never leaves the machine), import_app.py unpacks it."""
    state, log, after, lock = "idle", [], None, threading.Lock()

    @classmethod
    def run(cls, src, cleanup=None):
        def work():
            try:
                p = subprocess.Popen([sys.executable, "-I", os.path.join(ROOT, "re-tools", "import_app.py"), src], cwd=ROOT,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                for line in p.stdout:
                    cls.log.append(line.rstrip()[:300]); print("import:", line.rstrip(), flush=True)
                ok = p.wait() == 0 and imported()
                if ok and cls.after:
                    cls.log.append("starting the game ..."); cls.after()
                cls.state = "done" if ok else "failed"
            except BaseException as e:   # SystemExit from a server that would not start included
                cls.log.append(f"ERROR: {e}"); cls.state = "failed"
            finally:
                if cleanup:
                    cleanup()
        cls.state, cls.log = "running", []
        threading.Thread(target=work, daemon=True).start()


class Relay(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    upstream = ""
    sandbox_dir = ""
    mode = "sandbox"   # sandbox (throwaway saves) | play (own server, saves kept) | live (--upstream)

    def log_message(self, fmt, *a):   # quiet: one line per game request is enough
        if self.path.startswith(("/action", "/debug")):
            print(f"{time.strftime('%H:%M:%S')} {self.command} {self.path[:80]}", flush=True)

    def _send(self, code, body, ctype="text/plain; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _forward(self, method, body=None):
        req = urllib.request.Request(self.upstream + self.path, data=body, method=method,
                                     headers={"Content-Type": self.headers.get("Content-Type", "application/dominion-bin"), "Host": "relay"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                self._send(r.status, r.read(), r.headers.get("Content-Type", "application/octet-stream"))
        except urllib.error.HTTPError as e:
            self._send(e.code, e.read())
        except Exception as e:
            self._send(502, f"upstream error: {e}".encode())

    def _setup_post(self):
        """POST /setup/upload: the .ipa as the raw body (streamed to a temp file); POST /setup/path: a local path (an .ipa or a Dominion.app folder)."""
        n = int(self.headers.get("Content-Length") or 0)
        with Setup.lock:
            busy = Setup.state == "running" or Relay.mode != "setup"
            if not busy:
                Setup.state = "running"
        if busy:
            self.rfile.read(n) if n < (1 << 20) else None
            self.close_connection = True
            return self._send(409, b"an import is running, or the game is already set up")
        if self.path.split("?")[0] == "/setup/path":
            src = os.path.expanduser(self.rfile.read(n).decode("utf-8", "replace").strip().strip('"').strip("'"))
            if not os.path.exists(src):
                Setup.state = "idle"
                return self._send(404, f"not found: {src}".encode())
            Setup.run(src)
            return self._send(200, b"started")
        tmp = tempfile.mkdtemp(prefix="gofa-upload-")
        dest = os.path.join(tmp, "app.ipa")
        try:
            with open(dest, "wb") as f:
                left = n
                while left > 0:
                    b = self.rfile.read(min(left, 1 << 20))
                    if not b:
                        raise OSError("upload cut short")
                    f.write(b); left -= len(b)
        except OSError as e:
            shutil.rmtree(tmp, ignore_errors=True); Setup.state = "idle"
            return self._send(400, f"upload failed: {e}".encode())
        Setup.run(dest, lambda: shutil.rmtree(tmp, ignore_errors=True))
        return self._send(200, b"started")

    def do_POST(self):
        if self.path.startswith("/setup/"):
            return self._setup_post()
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path.split("?")[0] == "/action":
            return self._forward("POST", body)
        if self.path.startswith("/snap/"):   # dev aid: a PNG of the 3D viewer canvas -> art/extracted/3d/previews/NAME.png (git-ignored, local only)
            name = self.path[len("/snap/"):].split("?")[0]
            if not re.fullmatch(r"[A-Za-z0-9_\-]+", name) or not body.startswith(b"\x89PNG"):
                return self._send(400, b"bad snapshot")
            d = os.path.join(ROOT, "art", "extracted", "3d", "previews"); os.makedirs(d, exist_ok=True)
            open(os.path.join(d, name + ".png"), "wb").write(body)
            return self._send(200, b"ok")
        self._send(404, b"not found")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/setup/status":
            return self._send(200, json.dumps({"state": Setup.state, "mode": Relay.mode, "log": Setup.log[-40:]}).encode(), "application/json")
        if Relay.mode == "setup" and (path in ("/", "/index.html") or path.startswith(("/action", "/debug/", "/relay/"))):
            if path.startswith(("/action", "/debug/", "/relay/")):
                return self._send(503, b"import your app first")
            return self._send(200, open(os.path.join(STATIC, "setup.html"), "rb").read(), TYPES[".html"])
        if path == "/relay/info":
            return self._send(200, (f'{{"upstream":"{self.upstream}","sandbox":{str(bool(self.sandbox_dir)).lower()},"mode":"{self.mode}"}}').encode(), "application/json")
        if path.startswith("/art/ui/"):   # the owner's extracted UI images (art/extracted/ui_high, git-ignored Fishlabs material): local use only, nothing is uploaded or stored elsewhere
            name = path[len("/art/ui/"):]
            if not re.fullmatch(r"[A-Za-z0-9_.\-]+", name or "") or ".." in name:
                return self._send(404, b"bad name")
            full = os.path.join(ROOT, "art", "extracted", "ui_high", name)
            if not os.path.isfile(full):   # the images of the .aua companion file (portraits, item cards, flags): re-tools/ae3/aua_extract.py
                full = os.path.join(ROOT, "art", "extracted", "aua_high", name)
            if not os.path.isfile(full):
                return self._send(404, b"not extracted: run re-tools/ae3/ae3_extract.py and aua_extract.py")
            return self._send(200, open(full, "rb").read(), TYPES.get(os.path.splitext(full)[1], "application/octet-stream"))
        if path.startswith("/art/3d/"):   # meshes and decoded textures for the 3D viewer (art/extracted/3d, git-ignored Fishlabs material): local use only
            name = path[len("/art/3d/"):]
            if not re.fullmatch(r"[A-Za-z0-9_.\-/]+", name or "") or ".." in name:
                return self._send(404, b"bad name")
            full = os.path.join(ROOT, "art", "extracted", "3d", name)
            if not os.path.isfile(full):
                return self._send(404, b"not exported: run re-tools/ae3/export_viewer.py")
            return self._send(200, open(full, "rb").read(), TYPES.get(os.path.splitext(full)[1], "application/octet-stream"))
        if path.startswith("/art/ref/"):   # the owner's final-release screenshots (reference/, git-ignored): to overlay a rebuilt screen on its model, local only
            name = path[len("/art/ref/"):]
            full = os.path.join(ROOT, "reference", "alliances-media", "Final Screenshots", name)
            if not os.path.isfile(full):   # frames cut from the owner's final-release screen recordings (June 2019), scaled to 2048 x 1536
                full = os.path.join(ROOT, "reference", "alliances-media", "Recording Frames", name)
            if not re.fullmatch(r"[A-Za-z0-9_.\-]+\.PNG", name or "") or not os.path.isfile(full):
                return self._send(404, b"no such screenshot")
            return self._send(200, open(full, "rb").read(), "image/png")
        if path == "/art/font/klavika.ttf":   # the app's own UI face, from the owner's unpacked app (GOFA_APP or --app)
            full = os.path.join(APP_DIR, "KLAVIKRP.TTF") if APP_DIR else ""
            if not os.path.isfile(full):   # copied there by re-tools/import_app.py
                full = os.path.join(ROOT, "art", "extracted", "KLAVIKRP.TTF")
            if not os.path.isfile(full):
                return self._send(404, b"no font: import your app (re-tools/import_app.py) or start the relay with --app DIR")
            return self._send(200, open(full, "rb").read(), "font/ttf")
        if path == "/relay/sector":   # raw map sector file data/map_x/X_Y (the server's own source of system / planet data); local use only
            import urllib.parse
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                x, y = int(q["x"][0]), int(q["y"][0])
                assert 0 <= x < 100 and 0 <= y < 100
                data = open(os.path.join(ROOT, "data", "map_x", f"{x}_{y}"), "rb").read()
            except (KeyError, ValueError, AssertionError, OSError):
                return self._send(404, b"no such sector")
            return self._send(200, data, "application/octet-stream")
        if path == "/relay/loca":   # the game's own texts (data/loca_en.tsv, git-ignored Fishlabs text) for the Help tab and tooltips: ?prefix=A_,B_ lists the key prefixes wanted; local use only
            import urllib.parse
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            pre = tuple(p for p in (q.get("prefix") or [""])[0].split(",") if re.fullmatch(r"[A-Z0-9_]{1,40}", p))
            try:
                rows = open(os.path.join(ROOT, "data", "loca_en.tsv"), encoding="utf-8").read().split("\n")
            except OSError:
                return self._send(404, b"data/loca_en.tsv is missing")
            out = {}
            for line in rows:
                k, _, v = line.partition("\t")
                if pre and k.startswith(pre):
                    out[k] = v
            return self._send(200, json.dumps(out, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")
        if path.startswith("/debug/"):
            if not self.sandbox_dir and not ALLOW_DEBUG_UPSTREAM and path != "/debug/quote":   # play / live: only the read-only quotes (prices, times, odds)
                return self._send(403, b"only /debug/quote is forwarded outside the sandbox (use --allow-debug-upstream to override)")
            return self._forward("GET")
        rel = "index.html" if path == "/" else path.lstrip("/")
        full = os.path.normpath(os.path.join(STATIC, rel))
        if not full.startswith(STATIC + os.sep) or not os.path.isfile(full):
            return self._send(404, b"not found")
        return self._send(200, open(full, "rb").read(), TYPES.get(os.path.splitext(full)[1], "application/octet-stream"))


ALLOW_DEBUG_UPSTREAM = False
APP_DIR = ""


def main():
    global ALLOW_DEBUG_UPSTREAM, APP_DIR
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--fixture", help="start the sandbox from re-tools/oracle/fixtures/NAME (e.g. big-save)")
    g.add_argument("--state", help="start the sandbox from a copy of this state directory")
    g.add_argument("--upstream", help="forward to a running server instead of a sandbox (its saves are live)")
    g.add_argument("--play", action="store_true", help="play mode: a game server of its own with saves that are kept (and backed up), test tools hidden")
    ap.add_argument("--data", default=os.path.join(HERE, "play-data"), help="play mode: the folder of the kept saves (default re-tools/webspike/play-data)")
    ap.add_argument("--open", action="store_true", help="open the page in the default browser (Original look)")
    ap.add_argument("--allow-debug-upstream", action="store_true")
    ap.add_argument("--app", help="an unpacked Dominion.app to take the UI font from (default: the imported copy in art/extracted)")
    a = ap.parse_args()
    ALLOW_DEBUG_UPSTREAM = a.allow_debug_upstream
    APP_DIR = a.app or os.environ.get("GOFA_APP") or ""
    def start():
        if a.play:
            Relay.upstream, data, first = start_play(a.data)
            Relay.sandbox_dir, Relay.mode = "", "play"
            print(f"PLAY MODE: own game server {Relay.upstream}, saves kept in {data}/server/state ({'new game world' if first else 'continuing the saved world'}); backups in {data}/backups (last {BACKUPS_KEPT}, hourly and at start / exit)", flush=True)
        elif a.upstream:
            Relay.upstream, Relay.sandbox_dir, Relay.mode = a.upstream.rstrip("/"), "", "live"
            print(f"forwarding to LIVE server {Relay.upstream} (its saves change)", flush=True)
        else:
            state = a.state or (os.path.join(ROOT, "re-tools", "oracle", "fixtures", a.fixture) if a.fixture else None)
            Relay.upstream, Relay.sandbox_dir, Relay.mode = start_sandbox(state)[0], "yes", "sandbox"
            print(f"sandbox server at {Relay.upstream} ({'state from ' + state if state else 'empty state'}); deleted on exit", flush=True)
    if a.upstream or imported():
        start()
    else:   # first run on this copy: the page asks for the player's own .ipa first (re-tools/import_app.py), then starts the game
        Setup.after, Relay.mode = start, "setup"
        print("No game files imported yet: the page will ask for your own Alliances 1.16.1 .ipa (or run re-tools/import_app.py).", flush=True)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), Relay)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    url = f"http://localhost:{a.port}/"
    print(f"open {url}   (Ctrl-C to stop)", flush=True)
    if a.open:
        threading.Timer(0.5, lambda: webbrowser.open(url + "#original")).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
