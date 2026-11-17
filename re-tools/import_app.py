#!/usr/bin/env python3
"""Import the files the web version needs from YOUR OWN copy of Galaxy on Fire: Alliances 1.16.1 (iOS).

    python3 -I re-tools/import_app.py "Alliances 1.16.1.ipa"        # or the unpacked Dominion.app folder

Nothing of the original game ships with this project. This reads your .ipa (or Dominion.app) and writes, inside this folder:
  data/        galaxy map (map_x/ sector files, 1931642559.map, 1931642560.map), game text (base_loc, base_loc_en, base_loc_x/, loca_en.tsv)
  art/extracted/   UI images (ui_high/, aua_high/), the UI font (KLAVIKRP.TTF), 3D scene for planets and structures (3d/)
Both folders are git-ignored: they are Fishlabs / Deep Silver material for your own use, never commit or share them.
The app file is only read. Running it again overwrites the old import. The play page (re-tools/webspike/relay.py) runs this for you
when you pick the .ipa there; this command-line form does the same.

Needs: Python 3.9+. The 3D step needs numpy + Pillow (python3 -m pip install numpy pillow); without them it is skipped and the game
shows simple stand-in planets. The portrait / item images step uses macOS 'sips' (skipped elsewhere).
"""
import datetime
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "re-tools")
MAP_ID = "1931642559"
NEEDED = ["Info.plist", "KLAVIKRP.TTF", "base_loc", f"maps_ios/{MAP_ID}.map", "rgba_high/high_ipad3_0.ae3",
          "rgba_high/high_ipad3_1.aua", "assets_pvrtc/assets.ae3"]
STEPS = 7


def step(n, text):
    print(f"STEP {n}/{STEPS}: {text}", flush=True)


def run(args, **kw):
    """Run a helper script; its output goes to ours (the play page shows it)."""
    r = subprocess.run(args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, **kw)
    out = r.stdout.strip().splitlines()
    for line in out[-3:]:
        print("   ", line[:200], flush=True)
    if r.returncode:
        raise RuntimeError(f"{os.path.basename(args[1])} failed (exit {r.returncode})")


def python_with(*mods):
    """A python that can import mods: this one first, then common other installs (the macOS framework build, Homebrew)."""
    cands = [sys.executable, "/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
             "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]
    for p in cands:
        if os.path.isfile(p) and subprocess.run([p, "-c", "import " + ",".join(mods)], capture_output=True).returncode == 0:
            return p
    return None


def open_app(src, tmp):
    """-> folder holding the needed app files: the Dominion.app itself, or a temp copy of just those files from the .ipa."""
    if os.path.isdir(src):
        app = src
        if not os.path.isfile(os.path.join(app, "Info.plist")) and os.path.isdir(os.path.join(src, "Payload")):
            apps = [d for d in os.listdir(os.path.join(src, "Payload")) if d.endswith(".app")]
            app = os.path.join(src, "Payload", apps[0]) if apps else src
    else:
        try:
            z = zipfile.ZipFile(src)
        except zipfile.BadZipFile:
            raise SystemExit(f"{src} is not an .ipa (zip) file or an app folder")
        names = z.namelist()
        prefix = next((n[:n.index(".app/") + 5] for n in names if n.startswith("Payload/") and ".app/" in n), None)
        if not prefix:
            raise SystemExit("no Payload/*.app inside this .ipa")
        app = os.path.join(tmp, "app")
        for rel in NEEDED:
            if prefix + rel in names:
                dest = os.path.join(app, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with z.open(prefix + rel) as fi, open(dest, "wb") as fo:
                    shutil.copyfileobj(fi, fo, 1 << 20)
    missing = [rel for rel in NEEDED if not os.path.isfile(os.path.join(app, rel))]
    if missing:
        raise SystemExit("this does not look like Galaxy on Fire: Alliances 1.16.1; missing: " + ", ".join(missing))
    return app


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        return 0 if len(sys.argv) > 1 else 2
    src = os.path.abspath(os.path.expanduser(sys.argv[1]))
    if not os.path.exists(src):
        raise SystemExit(f"not found: {src}")
    data, art = os.path.join(ROOT, "data"), os.path.join(ROOT, "art", "extracted")
    os.makedirs(data, exist_ok=True)
    os.makedirs(art, exist_ok=True)
    marker = os.path.join(art, "IMPORTED.json")
    if os.path.exists(marker):
        os.remove(marker)
    skipped = []
    with tempfile.TemporaryDirectory(prefix="gofa-import-") as tmp:
        step(1, "reading the app (" + os.path.basename(src) + ")")
        app = open_app(src, tmp)
        info = plistlib.load(open(os.path.join(app, "Info.plist"), "rb"))
        version = info.get("CFBundleShortVersionString", "?")
        print(f"    {info.get('CFBundleDisplayName') or info.get('CFBundleName', '?')} version {version}", flush=True)
        if version != "1.16.1":
            print("    WARNING: made for version 1.16.1 (the final release); other versions may not import correctly", flush=True)

        step(2, "game text")
        shutil.copy(os.path.join(app, "base_loc"), os.path.join(data, "base_loc"))
        bx = os.path.join(data, "base_loc_x")
        shutil.rmtree(bx, ignore_errors=True)
        zipfile.ZipFile(os.path.join(data, "base_loc")).extractall(bx)
        run([sys.executable, "-I", os.path.join(TOOLS, "loca_dump.py")])
        run([sys.executable, "-I", os.path.join(TOOLS, "loca_en_only.py")])

        step(3, "galaxy map")
        mp = os.path.join(data, f"{MAP_ID}.map")
        shutil.copy(os.path.join(app, "maps_ios", f"{MAP_ID}.map"), mp)
        mx = os.path.join(data, "map_x")
        shutil.rmtree(mx, ignore_errors=True)
        zipfile.ZipFile(mp).extractall(mx)
        # the map the game client is sent: every position +32 (see server.py MAP_ID)
        run([sys.executable, "-I", os.path.join(TOOLS, "map_shift.py"), mp, os.path.join(data, "1931642560.map"), "32",
             os.path.join(ROOT, "server")])
        print(f"    {len(os.listdir(mx)) - 1} map sectors", flush=True)

        step(4, "UI font")
        shutil.copy(os.path.join(app, "KLAVIKRP.TTF"), os.path.join(art, "KLAVIKRP.TTF"))

        step(5, "UI images (this takes a minute)")
        out = os.path.join(art, "ui_high")
        shutil.rmtree(out, ignore_errors=True)
        run([sys.executable, "-I", os.path.join(TOOLS, "ae3", "ae3_extract.py"), app, out, "--tier", "high"])

        step(6, "portraits, item cards and flags")
        out = os.path.join(art, "aua_high")
        if shutil.which("sips"):
            shutil.rmtree(out, ignore_errors=True)
            run([sys.executable, "-I", os.path.join(TOOLS, "ae3", "aua_extract.py"), app, out, "--tier", "high"])
        else:
            skipped.append("portraits / item cards (needs macOS)")
            print("    skipped: needs macOS 'sips'", flush=True)

        step(7, "3D planets and structures (a few minutes)")
        py = python_with("numpy", "PIL")
        out = os.path.join(art, "3d")
        if py:
            shutil.rmtree(out, ignore_errors=True)
            run([py, "-I", os.path.join(TOOLS, "ae3", "export_viewer.py"), app, out])
        else:
            skipped.append("3D models (python3 -m pip install numpy pillow, then import again)")
            print("    skipped: needs numpy + Pillow (python3 -m pip install numpy pillow)", flush=True)

    json.dump({"app_version": version, "imported": datetime.datetime.now().isoformat(timespec="seconds"), "skipped": skipped},
              open(marker, "w"), indent=1)
    print("DONE" + (" (skipped: " + "; ".join(skipped) + ")" if skipped else ""), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
