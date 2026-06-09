#!/usr/bin/env bash
# ============================================================
#  WesternU 3D Viewer v6 - launcher (macOS / Linux)
#  Serves this folder over read-only HTTP on 127.0.0.1:8000
#  and opens the viewer. Ctrl+C to stop.
# ============================================================
set -e
cd "$(dirname "$0")"

PORT=8000
URL="http://localhost:${PORT}/viewer/"

# pick a Python interpreter
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
else echo "Python 3 was not found on PATH. Install Python 3 and retry."; exit 1; fi

# bail if the port is already in use
if "$PY" -c "import socket,sys; s=socket.socket(); r=s.connect_ex(('127.0.0.1',$PORT)); s.close(); sys.exit(1 if r==0 else 0)"; then
  :
else
  echo "Port $PORT is already in use."
  echo "If a server is already running, just open $URL"
  exit 1
fi

# start the static server
"$PY" devserver.py "$PORT" &
SRV=$!
sleep 1

# open the default browser (mac: open, linux: xdg-open)
if command -v open >/dev/null 2>&1; then open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
else echo "Open $URL in your browser."; fi

echo ""
echo "Viewer v6 running at $URL  (server PID $SRV)"
echo "Press Ctrl+C to stop."
wait "$SRV"
