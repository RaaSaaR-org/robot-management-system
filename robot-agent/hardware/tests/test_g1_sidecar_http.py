"""g1_sidecar.py's HTTP server sets TCP_NODELAY on every accepted socket (TASK-415).

`Handler._send` writes headers and body as two segments. The sim's facade, which
keeps connections alive, lost every other `/state/fast` request to Nagle holding
the body for a delayed ACK (~40 ms). This handler still answers HTTP/1.0 and
closes after each reply, which pushes the held segment out at once -- measured
offline at 0.6 ms median -- so the flag is insurance against the day it moves
to keep-alive. These tests pin the flag and that it reaches the socket.

@status test
"""

import http.client
import os
import socket
import sys
import threading
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import g1_sidecar  # noqa: E402


def test_handler_disables_nagle():
    assert g1_sidecar.Handler.disable_nagle_algorithm is True


def test_accepted_socket_has_tcp_nodelay():
    seen = []

    class Probe(g1_sidecar.Handler):
        def setup(self):
            super().setup()
            seen.append(self.connection.getsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY))

        def do_GET(self):  # no DDS, no camera: only the socket is under test
            self._send(200, {"ok": True})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Probe)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
        conn.request("GET", "/health")
        assert conn.getresponse().status == 200
        conn.close()
    finally:
        server.shutdown()
        server.server_close()
    assert seen and seen[0] != 0
