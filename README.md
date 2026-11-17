# GoFA Revival (web version)

A fan-made revival of **Galaxy on Fire: Alliances**, the iOS strategy game whose servers were shut down. It plays in your browser and runs a game server on your own computer.

> **Work in progress.** Much of the game works (planets, structures, research, fleets, carriers, the galaxy map, the tutorial missions, alliances), but plenty is unfinished or only roughly matches the original. Expect bugs, and expect saves from older versions to break now and then.

## You need your own copy of the game

This repository contains **none** of the original game's files: no art, map, text, sounds or models. The game reads them from **your own copy** of the iOS app, *Galaxy on Fire: Alliances* **version 1.16.1** (the final release), as an `.ipa` file.

The import copies what it needs onto your computer, once. Nothing is uploaded to the internet, and the imported files are git-ignored so they can't be committed by accident. Please don't share them.

## Run it

Requirements: **Python 3.9 or newer** and a current browser (Chrome, Edge, Firefox or Safari). It's tested on **macOS**.

1. Download this repository (green **Code** button → *Download ZIP*, then unzip it), or clone it:
   ```bash
   git clone https://github.com/Eight8100/GoF-Alliances-Web.git
   ```
2. Start it:
   - **macOS:** double-click **`Play GoFA.command`**. (If macOS blocks it the first time, right-click → *Open*.)
   - **Any system:** in a terminal, inside the folder:
     ```bash
     python3 -I re-tools/webspike/relay.py --play --open
     ```
3. The first time, the page asks for your `.ipa`. Pick it (or drop it on the page) and wait a few minutes while it imports.
4. The game opens at <http://localhost:8765/>. Type any player name to start.

Leave the terminal window open while you play, and close it (or press Ctrl-C) to stop. Your world is saved in `re-tools/webspike/play-data/`, with automatic backups in `play-data/backups/` (the last 10, taken hourly and at every start and stop).

### Optional: 3D planets and structures

The 3D models need two Python packages. Without them the import skips that step and the game uses simple stand-ins.

```bash
python3 -m pip install numpy pillow
```

To get the 3D models after installing these, run the import again from the command line:

```bash
python3 -I re-tools/import_app.py "/path/to/Alliances 1.16.1.ipa"
```

The portrait, item-card and flag images are decoded with the macOS `sips` tool. On other systems that step is skipped for now.

## Updating

Download or `git pull` the new version. Your imported files and saves stay where they are. If an update says the import format changed, run the import again.

## What's in here

| Folder | What it is |
|---|---|
| `server/` | The game server: a rebuilt version of the original server's rules (`server/gofa_core/rules/ruleset.py` holds the balance numbers) |
| `protos/` | The game's network message layouts, worked out from the app |
| `re-tools/webspike/` | The browser game (`static/`) and the local relay that serves it (`relay.py`) |
| `re-tools/import_app.py` | Reads your `.ipa` and writes `data/` and `art/extracted/` |
| `re-tools/ae3/` | Decoders for the game's `.ae3` / `.aua` art containers and 3D scene |

The browser game has two tabs: **Original look**, which rebuilds the original screens with the original art, and a plain interface that shows the same game state as simple lists and buttons.

## Legal

This is an unofficial, non-commercial fan project. It is not affiliated with or endorsed by Fishlabs, Deep Silver or THQ Nordic. *Galaxy on Fire* and all game content belong to their owners. This repository contains only original code. The game's own files come from a copy you own, and stay on your computer.
