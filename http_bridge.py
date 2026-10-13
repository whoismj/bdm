"""
Lightweight HTTP Bridge server for Boring Download Manager (BDM).
Listens on 127.0.0.1:19532 to allow browser extensions and external scripts
to seamlessly query status and dispatch downloads via REST API.
"""

import sys
import os
import json
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = 19532

class ODMHTTPHandler(BaseHTTPRequestHandler):
    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._send_cors()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ("/api/ping", "/ping"):
            self._send_json(200, {
                "status": "ok",
                "app": "BDM",
                "version": "2.0",
                "daemon_alive": True
            })
            return

        if path in ("/api/stats", "/stats"):
            engine = getattr(self.server, "engine", None)
            if not engine:
                self._send_json(200, {"status": "ok", "speed": 0, "active": 0, "total": 0, "tasks": []})
                return

            tasks = list(engine.tasks.values())
            active_tasks = [t for t in tasks if t.status == "downloading"]
            total_speed = sum(t.speed for t in active_tasks)
            self._send_json(200, {
                "status": "ok",
                "speed": total_speed,
                "active": len(active_tasks),
                "total": len(tasks),
                "tasks": [t.to_dict() for t in tasks]
            })
            return

        self._send_json(404, {"status": "error", "message": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            req_data = json.loads(body.decode("utf-8"))
        except Exception:
            self._send_json(400, {"status": "error", "message": "Malformed JSON"})
            return

        engine = getattr(self.server, "engine", None)
        emit_func = getattr(self.server, "emit_func", None)

        if path in ("/api/add", "/add"):
            url = req_data.get("url")
            if not url:
                self._send_json(400, {"status": "error", "message": "Missing URL"})
                return

            fn = req_data.get("filename")
            cat = req_data.get("category")
            sp = req_data.get("save_path")
            conns = req_data.get("connections", 8)
            quality = req_data.get("quality", "best")
            start_now = req_data.get("start_now", True)

            if engine:
                task = engine.create_task(
                    url,
                    filename=fn,
                    save_path=sp,
                    category=cat,
                    num_connections=conns,
                    extra_meta={"quality": quality}
                )
                if start_now:
                    engine.start_task(task.id)
                if emit_func:
                    emit_func({"event": "task_added", "task": task.to_dict()})
                self._send_json(200, {"status": "ok", "task": task.to_dict()})
            else:
                self._send_json(500, {"status": "error", "message": "Engine not bound"})
            return

        if path in ("/api/open_modal", "/open_modal"):
            url = req_data.get("url", "")
            fn = req_data.get("filename", "")
            if emit_func:
                emit_func({"event": "open_add_modal", "url": url, "filename": fn})
            self._send_json(200, {"status": "ok"})
            return

        self._send_json(404, {"status": "error", "message": "Not found"})

    def log_message(self, format, *args):
        # Suppress standard logging to keep stdout clean for JSON-RPC
        pass

def start_http_bridge(engine=None, emit_func=None, port=PORT):
    try:
        server = HTTPServer(("127.0.0.1", port), ODMHTTPHandler)
        server.engine = engine
        server.emit_func = emit_func
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        sys.stderr.write(f"[http_bridge] Listening on http://127.0.0.1:{port}\n")
        return server
    except Exception as e:
        sys.stderr.write(f"[http_bridge] Failed to start HTTP server on port {port}: {e}\n")
        return None

if __name__ == "__main__":
    start_http_bridge()
    import time
    while True:
        time.sleep(1)
