"""Spawn GoF Alliances on the USB-connected iPad with redirect.js loaded.

    python3 -u launch.py [extra.js ...]
    GOFA_WAIT=1 ...   wait for the user to tap the icon, then attach (GOFA_WAIT_DELAY s later)
    GOFA_OPEN=1 ...   close the game and reopen it via SpringBoard, then attach as in wait mode
"""
import os
import sys
import time
import frida

from netconf import PORT, server_host

BUNDLE = "www.fishlabs.net.gofalliances"
PROCESS = "Dominion"
here = os.path.dirname(os.path.abspath(__file__))


def load(session, path, source=None):
    script = session.create_script(source or open(path).read())
    script.on("message", lambda m, d: print(m.get("payload", m), flush=True))
    script.load()


def spawn_and_attach(dev):
    """Start the game, then attach. Attaching while suspended at spawn crashed GoF3 on this
    jailbreak, so let it start first; the lobby call retries anyway."""
    pid = dev.spawn([BUNDLE])
    dev.resume(pid)
    for attempt in range(20):
        time.sleep(0.5)
        try:
            session = dev.attach(pid)
            load(session, None, open(os.path.join(here, "redirect.js")).read()
                 .replace("__TARGET__", server_host()).replace("__PORT__", str(PORT)))
            for extra in sys.argv[1:]:
                load(session, extra)
            print("attached pid", pid, "after", attempt + 1, "tries", flush=True)
            return session
        except frida.ProcessNotFoundError:
            print("game exited before attach (pid", pid, ")", flush=True)
            return None
        except (frida.ProcessNotRespondingError, frida.TransportError):
            continue
    return None


def open_via_springboard(dev):
    """Ask SpringBoard to open the game, like tapping its icon (no frida spawn, so no launch watchdog)."""
    for p in dev.enumerate_processes():
        if p.name == PROCESS:
            dev.kill(p.pid)
            time.sleep(1.5)
    sb = dev.attach("SpringBoard")
    script = sb.create_script(
        "ObjC.schedule(ObjC.mainQueue, () => ObjC.classes.UIApplication.sharedApplication()"
        f".launchApplicationWithIdentifier_suspended_('{BUNDLE}', 0));")
    script.load()
    time.sleep(0.5)
    sb.detach()
    print("asked SpringBoard to open", BUNDLE, flush=True)


dev = frida.get_usb_device(timeout=5)
if os.environ.get("GOFA_OPEN"):
    # Open the game ourselves via SpringBoard, then fall through to wait mode.
    os.environ["GOFA_WAIT"] = "1"
    open_via_springboard(dev)
if os.environ.get("GOFA_WAIT"):
    # Wait mode: the user starts the game by tapping its icon; attach as soon as it appears.
    # (Used when frida's spawn makes the app miss iOS's 20 s launch watchdog.)
    print("waiting for the game to be started on the iPad...", flush=True)
    while True:
        procs = [p for p in dev.enumerate_processes() if p.name == PROCESS]
        if procs:
            break
        time.sleep(0.2)
    # Let the app finish creating its first screen (iOS kills it if launch takes > ~20 s and an early
    # attach slows it down); the lobby lookup only happens a few seconds later.
    time.sleep(float(os.environ.get("GOFA_WAIT_DELAY", "4")))
    session = dev.attach(procs[0].pid)
    load(session, None, open(os.path.join(here, "redirect.js")).read()
         .replace("__TARGET__", server_host()).replace("__PORT__", str(PORT)))
    for extra in sys.argv[1:]:
        load(session, extra)
    print("attached pid", procs[0].pid, "(wait mode)", flush=True)
    session.on("detached", lambda reason, crash: os._exit(0))
    while True:
        time.sleep(3600)
for p in dev.enumerate_processes():
    if p.name == PROCESS:
        dev.kill(p.pid)
        time.sleep(2)
for _ in range(3):
    session = spawn_and_attach(dev)
    if session:
        break
    time.sleep(2)
else:
    sys.exit("could not attach to the game after 3 launches")
session.on("detached", lambda reason, crash: os._exit(0))
while True:
    time.sleep(3600)
