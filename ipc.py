"""
IPC (Inter-Process Communication) server and client for Boring Download Manager (BDM).
Allows CLI (bdm) and browser/external integrations to communicate with the running GUI/service.
"""

import os
import sys
import json
import socket
import threading
from typing import Dict, Any, Optional, Callable

SOCKET_PATH = f"/run/user/{os.getuid()}/omarchy-dm.sock"


class IPCServer:
    def __init__(self, request_handler: Callable[[Dict[str, Any]], Dict[str, Any]]):
        self.handler = request_handler
        self.socket_path = SOCKET_PATH
        self.server_socket: Optional[socket.socket] = None
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        if os.path.exists(self.socket_path):
            try:
                # Test if another instance is actively listening
                test_client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                test_client.connect(self.socket_path)
                test_client.close()
                # If connected, another instance is running
                sys.stderr.write("BDM instance is already running.\n")
                return False
            except Exception:
                # Stale socket file
                try:
                    os.remove(self.socket_path)
                except Exception:
                    pass

        self.server_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server_socket.bind(self.socket_path)
        self.server_socket.listen(5)
        self._running = True

        # Also create bdm.sock symlink
        bdm_sock = f"/run/user/{os.getuid()}/bdm.sock"
        try:
            if os.path.exists(bdm_sock) or os.path.islink(bdm_sock):
                os.remove(bdm_sock)
            os.symlink(self.socket_path, bdm_sock)
        except Exception:
            pass

        self._thread = threading.Thread(target=self._listen_loop, daemon=True)
        self._thread.start()
        return True

    def _listen_loop(self):
        while self._running:
            try:
                conn, _ = self.server_socket.accept()
                threading.Thread(target=self._handle_client, args=(conn,), daemon=True).start()
            except Exception:
                break

    def _handle_client(self, conn: socket.socket):
        with conn:
            try:
                data = b""
                while True:
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                    if b"\n" in chunk:
                        break

                if data:
                    req = json.loads(data.decode("utf-8").strip())
                    resp = self.handler(req)
                    conn.sendall(json.dumps(resp).encode("utf-8") + b"\n")
            except Exception as e:
                try:
                    err_resp = {"status": "error", "message": str(e)}
                    conn.sendall(json.dumps(err_resp).encode("utf-8") + b"\n")
                except Exception:
                    pass

    def stop(self):
        self._running = False
        if self.server_socket:
            try:
                self.server_socket.close()
            except Exception:
                pass
        if os.path.exists(self.socket_path):
            try:
                os.remove(self.socket_path)
            except Exception:
                pass


def send_ipc_request(request: Dict[str, Any], timeout: float = 3.0) -> Optional[Dict[str, Any]]:
    target_sock = f"/run/user/{os.getuid()}/bdm.sock"
    if not os.path.exists(target_sock):
        target_sock = SOCKET_PATH
    if not os.path.exists(target_sock):
        return None
    try:
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(timeout)
        client.connect(target_sock)
        payload = json.dumps(request).encode("utf-8") + b"\n"
        client.sendall(payload)

        data = b""
        while True:
            chunk = client.recv(4096)
            if not chunk:
                break
            data += chunk
            if b"\n" in chunk:
                break
        client.close()
        if data:
            return json.loads(data.decode("utf-8").strip())
    except Exception:
        return None
    return None
