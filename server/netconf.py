"""Which Mac address the iPad should use to reach the server.

Default = USB only: the USB network link to the iPad (a 169.254.x.x link-local address on an active
interface). No Wi-Fi fallback, so nothing is exposed on whatever network the Mac is on (requested
2026-10-09 while on the work Wi-Fi). GOFA_NET=wifi = the Mac's Wi-Fi address (en0) instead, for a trusted
home network (port 8090; *:8080 is the GoF3 server). Override the address with GOFA_HOST, the port with GOFA_PORT.
Both server.py and launch.py must be started with the same settings.
GOFA_NET=hosts = untethered play at home: the iPad's /etc/hosts maps the fishlegion.net names to the Mac's
Wi-Fi address, the game connects on its normal port 80, and the server listens on all interfaces port 80
(macOS only allows an unprivileged port-80 bind on 0.0.0.0). No Frida needed.
"""
import os
import re
import subprocess

HOSTS = os.environ.get("GOFA_NET") == "hosts"
WIFI = os.environ.get("GOFA_NET") == "wifi" or HOSTS
PORT = int(os.environ.get("GOFA_PORT") or (80 if HOSTS else 8090 if WIFI else 8080))  # redirect.js maps the game's port 80 to this


def server_host():
    if os.environ.get("GOFA_HOST"):
        return os.environ["GOFA_HOST"]
    if WIFI:
        ip = subprocess.run(["ipconfig", "getifaddr", "en0"], capture_output=True, text=True).stdout.strip()
        if not ip:
            raise SystemExit("GOFA_NET=wifi but en0 has no address.")
        return ip
    out = subprocess.run(["ifconfig"], capture_output=True, text=True).stdout
    for block in re.split(r"\n(?=\S)", out):
        if "status: active" in block and (m := re.search(r"inet (169\.254\.\d+\.\d+)", block)):
            return m.group(1)
    raise SystemExit("No active USB link (169.254.x.x) to the iPad found; plug it in / unlock it, or set GOFA_HOST.")


def bind_host():
    return "0.0.0.0" if HOSTS else server_host()


if __name__ == "__main__":
    print(server_host())
