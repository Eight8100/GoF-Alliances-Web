"""Hot-reloading front end for server.py.

Owns the listening socket and forwards every request to the current server.Handler. Before each request it
checks the mtimes of server.py / schema.py / pb.py; if one changed it reloads them (pb, schema, then server)
and carries the live game state across, so handler edits take effect on the next request without dropping
the game's connection. A reload that fails (syntax error, exception at import) keeps the old code running.

    python3 -u serve.py          (instead of python3 -u server.py)
"""
import importlib
import os
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import pb      # noqa: E402
import schema  # noqa: E402
import gofa_core.rules.ruleset as ruleset  # noqa: E402  (game rules moved out of server.py; reloaded before it)
import server  # noqa: E402
from netconf import PORT, bind_host  # noqa: E402

# Live state kept across reloads (everything a handler mutates).
STATE = ["ACH", "HOME_NPC", "PLAYER", "PENDING_PLANET_PUSH", "STRUCTURES", "BUILDS", "JOB_ID", "RESOURCES", "SHIP_JOBS", "SHIPS",
         "SCAN_JOBS", "MISSIONS", "MISSION_ID", "CARRIER_JOBS", "CARRIERS", "CREDITS_BOX", "XP_BOX", "SKILLS", "TECHS", "RESEARCH", "JUMPGATE", "COLONIES", "PLANET_STATE", "TROOP_JOBS"]
WATCH = [pb, schema, ruleset, server]
_mtimes = {m.__name__: os.path.getmtime(m.__file__) for m in WATCH}
_lock = threading.Lock()


def maybe_reload():
    global server
    changed = [m for m in WATCH if os.path.getmtime(m.__file__) != _mtimes[m.__name__]]
    if not changed:
        return
    with _lock:
        changed = [m for m in WATCH if os.path.getmtime(m.__file__) != _mtimes[m.__name__]]
        if not changed:
            return
        for m in WATCH:
            _mtimes[m.__name__] = os.path.getmtime(m.__file__)
        keep = {n: getattr(server, n) for n in STATE if hasattr(server, n)}
        try:
            # a changed dependency means server must re-import it too
            for m in WATCH[WATCH.index(changed[0]):]:
                importlib.reload(m)
            for n, v in keep.items():
                setattr(server, n, v)
            print(f"=== reloaded {', '.join(m.__name__ for m in changed)}", flush=True)
        except Exception:
            print("=== RELOAD FAILED, keeping state, fix and save again:\n" + traceback.format_exc(), flush=True)
            for n, v in keep.items():   # a half-executed module may have reset some names
                setattr(server, n, v)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _go(self, name):
        maybe_reload()
        getattr(server.Handler, name)(self)

    def do_POST(self):
        self._go("do_POST")

    def do_GET(self):
        self._go("do_GET")

    do_PUT = do_HEAD = do_GET

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    host = bind_host()
    print("listening on", host, PORT, "(hot reload)", flush=True)
    ThreadingHTTPServer((host, PORT), Handler).serve_forever()
