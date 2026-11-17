#!/bin/bash
# Double-click: the browser game in play mode (own game server, saves kept in re-tools/webspike/play-data, backed up). Ctrl-C / close the window to stop.
cd "$(dirname "$0")/../.." && exec python3 -I re-tools/webspike/relay.py --play --open
