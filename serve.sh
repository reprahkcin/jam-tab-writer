#!/usr/bin/env bash
# Serve the tool over http://localhost so folder mode (File System Access API)
# works — it is disabled on file:// URLs. Then open the printed URL in Chrome.
set -e
cd "$(dirname "$0")"
PORT="${1:-8137}"
echo "Guitar Tab Writer → http://localhost:$PORT/"
exec python3 -m http.server "$PORT"
