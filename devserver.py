"""Dev-only static server: same as `python -m http.server` but sends
`Cache-Control: no-store` on every response so the browser never serves a
stale ES module / asset during development (the reason a code change can look
like "nothing changed" until a hard refresh). Used by launch_viewer*.bat.

It also accepts ONE narrow POST — `/__camera_views__` — that writes the
`data/camera_views.json` artifact authored by the dev-only camera_tool
(architecture/camera_tool.md). This is the only write the server performs; it
validates the body shape and refuses to write anywhere else, so the server
stays effectively read-only for the shipped viewer (which only ever GETs).

Usage:  python devserver.py [PORT]   (default 8000)
"""
import http.server
import json
import os
import socketserver
import sys
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

# the single artifact the camera_tool may write, relative to the served root (cwd)
CAMERA_VIEWS_REL = os.path.join("data", "camera_views.json")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    # Narrow dev-only write endpoint for the camera_tool. Only POST /__camera_views__ is honored;
    # the body must be a JSON object with version/campus/buildings → written to data/camera_views.json.
    def do_POST(self):
        if self.path.rstrip("/") != "/__camera_views__":
            self.send_error(404, "Not Found")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(payload, dict) or "buildings" not in payload or "version" not in payload:
                raise ValueError("expected {version, campus, buildings}")
            if not isinstance(payload.get("buildings"), dict):
                raise ValueError("buildings must be an object")
            dest = os.path.join(os.getcwd(), CAMERA_VIEWS_REL)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            text = json.dumps(payload, indent=2) + "\n"
            for attempt in range(8):  # OneDrive/Box hydration can lock the file mid-write — retry
                try:
                    with open(dest, "w", encoding="utf-8") as fh:
                        fh.write(text)
                    break
                except OSError:
                    if attempt == 7:
                        raise
                    time.sleep(0.25 * (attempt + 1))
            body = json.dumps({"ok": True, "path": CAMERA_VIEWS_REL.replace("\\", "/")}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:  # noqa: BLE001 — dev tool: surface the message to the client
            msg = json.dumps({"ok": False, "error": str(exc)}).encode("utf-8")
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    # A browser switching from the old (cacheable) server may still hold validators
    # and send a conditional request; strip them so dev always gets a fresh 200, never 304.
    def send_head(self):
        for h in ("If-Modified-Since", "If-None-Match"):
            if h in self.headers:
                del self.headers[h]

        # When the project lives in a cloud-sync folder (Box / OneDrive / Dropbox),
        # files may be online-only "placeholders". Opening one triggers a background
        # hydration that swaps the file's bytes in mid-flight, invalidating the handle
        # the stdlib just opened -> os.fstat() raises WinError 1006 and the request
        # crashes. Force a full hydration first (read the file through), retrying a few
        # times until the volume settles, then delegate to the normal handler.
        path = self.translate_path(self.path)
        if os.path.isfile(path):
            for attempt in range(8):
                try:
                    with open(path, "rb") as fh:
                        while fh.read(1 << 20):
                            pass
                    break
                except OSError:
                    time.sleep(0.25 * (attempt + 1))

        for attempt in range(8):
            try:
                return super().send_head()
            except OSError as exc:
                # WinError 1006 (and friends) during hydration: wait and retry.
                if getattr(exc, "winerror", None) not in (1006, 21, 1392) and attempt == 7:
                    raise
                time.sleep(0.25 * (attempt + 1))
        return super().send_head()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("", PORT), NoCacheHandler) as httpd:
        print(f"no-cache dev server on http://localhost:{PORT}/  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
