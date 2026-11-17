#!/bin/bash
# Double-click to play: starts the local game server and opens the game in your browser.
# The first time, the page asks for your own Galaxy on Fire: Alliances 1.16.1 .ipa. Close this window to stop.
cd "$(dirname "$0")" && exec python3 -I re-tools/webspike/relay.py --play --open
