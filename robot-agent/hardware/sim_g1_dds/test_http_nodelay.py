"""The sim's HTTP facade answers a keep-alive client without a ~40 ms stall (TASK-415).

`_send` writes the headers and then the body: two small segments on one socket.
With Nagle on, the body waits for the client's ACK of the headers, and a client
on a connection no longer in quick-ACK mode delays that ACK ~40 ms. The facade
is HTTP/1.1, so a pooled client (Node's `fetch`) hit it on every other request:
measured median 2.4 ms but mean 22 ms, with half the requests at 43 ms, which
held a 30 fps recorder to 11-15 distinct samples a second. curl never showed it,
because each curl run opens a fresh connection.

No DDS and no MuJoCo scene: `make_handler` is served against a stub node over a
real loopback socket, because the bug lives in the socket, not in the handler.

    python -m pytest robot-agent/hardware/sim_g1_dds/test_http_nodelay.py
"""
from __future__ import annotations

import http.client
import socket
import statistics
import sys
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

# Same import guard as test_camera_stream.py: `sim_node` needs mujoco AND
# unitree_sdk2py at module scope, and a machine with only one of them must
# report this file SKIPPED, not FAILED.
sys.path.insert(0, str(Path(__file__).resolve().parent))
sim_node = pytest.importorskip("sim_node")


class FakeNode:
    """`/cameras` is the cheapest route: it touches only `camera_names()`."""

    def camera_names(self):
        return ["head_camera"]


def _serve(handler_cls):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def test_handler_disables_nagle_and_keeps_http11():
    handler = sim_node.make_handler(FakeNode(), None)
    assert handler.protocol_version == "HTTP/1.1"
    assert handler.disable_nagle_algorithm is True


def test_accepted_socket_has_tcp_nodelay():
    seen = []
    base = sim_node.make_handler(FakeNode(), None)

    class Probe(base):
        def setup(self):
            super().setup()
            seen.append(self.connection.getsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY))

    server = _serve(Probe)
    try:
        conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
        conn.request("GET", "/cameras")
        assert conn.getresponse().read()
        conn.close()
    finally:
        server.shutdown()
        server.server_close()
    assert seen and seen[0] != 0


def test_keep_alive_requests_do_not_stall_on_delayed_ack():
    server = _serve(sim_node.make_handler(FakeNode(), None))
    try:
        conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
        times = []
        for _ in range(40):
            started = time.perf_counter()
            conn.request("GET", "/cameras")
            res = conn.getresponse()
            assert res.status == 200
            res.read()
            times.append((time.perf_counter() - started) * 1000)
        conn.close()
    finally:
        server.shutdown()
        server.server_close()
    # With Nagle on, half of these took ~40 ms; the slowest decile is the tell.
    # 20 ms leaves a loaded CI box plenty of room and still sits far below it.
    slow = sorted(times)[int(len(times) * 0.9)]
    assert slow < 20, (
        f"p90 {slow:.1f} ms over a keep-alive connection (median "
        f"{statistics.median(times):.1f} ms) -- the Nagle/delayed-ACK stall is back"
    )
