"""
Tests for hardware/backends/ plugin system.

Tests the VLABackend ABC, SmolVLABackend HTTP backend, and integration
with VLARunner's backend parameter.
@status test
"""

import base64
import importlib.util
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

import sys
import os

# `SmolVLABackend.connect()` imports httpx, so anything that talks to the mock
# server needs it. Not every interpreter this repo documents has it (the
# sim_g1_dds venv does not; the curation venv does), and a self-skip is how that
# stays visible — excluding these files from scripts/test-all.sh instead only hid
# whether they pass.
requires_httpx = pytest.mark.skipif(
    importlib.util.find_spec("httpx") is None,
    reason="SmolVLABackend.connect() needs httpx; this interpreter has none",
)

# Ensure hardware/ is on the path so `backends` and `vla_safety` resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backends import SmolVLABackend, VLABackend
from backends.base import VLABackend as VLABackendBase


# ---------------------------------------------------------------------------
# Mock VLA server
# ---------------------------------------------------------------------------

class MockVLAServer:
    """Minimal mock VLA server for backend tests."""

    def __init__(self):
        self.predict_count = 0
        self.last_request = None
        self._server = None
        self._thread = None

        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/health":
                    self._respond({"status": "ok"})
                elif self.path == "/config":
                    self._respond({
                        "action_dim": 6,
                        "chunk_size": 3,
                        "cameras": ["front", "wrist"],
                        "state_dim": 6,
                    })
                else:
                    self.send_error(404)

            def do_POST(self):
                if self.path == "/predict":
                    length = int(self.headers.get("Content-Length", 0))
                    body = json.loads(self.rfile.read(length)) if length else {}
                    parent.last_request = body
                    parent.predict_count += 1
                    actions = [[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]] * 3
                    self._respond({"actions": actions})
                else:
                    self.send_error(404)

            def _respond(self, data):
                body = json.dumps(data).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self._handler = Handler

    def start(self):
        self._server = HTTPServer(("127.0.0.1", 0), self._handler)
        self.port = self._server.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        if self._server:
            self._server.shutdown()


@pytest.fixture
def mock_server():
    srv = MockVLAServer()
    srv.start()
    yield srv
    srv.stop()


# ---------------------------------------------------------------------------
# Test 1: VLABackend ABC cannot be instantiated
# ---------------------------------------------------------------------------

class TestVLABackendABC:
    def test_cannot_instantiate_abc(self):
        """VLABackend is abstract and cannot be instantiated directly."""
        with pytest.raises(TypeError):
            VLABackend()

    def test_subclass_must_implement_all_methods(self):
        """A subclass missing any abstract method cannot be instantiated."""
        class IncompleteBackend(VLABackend):
            def connect(self, server_url, config=None):
                pass
            # missing predict, disconnect, is_connected

        with pytest.raises(TypeError):
            IncompleteBackend()

    def test_concrete_subclass_works(self):
        """A fully implemented subclass can be instantiated."""
        class DummyBackend(VLABackend):
            def connect(self, server_url, config=None):
                pass
            def predict(self, images, state, prompt):
                return []
            def disconnect(self):
                pass
            @property
            def is_connected(self):
                return False

        backend = DummyBackend()
        assert not backend.is_connected
        assert backend.predict({}, np.array([]), "") == []


# ---------------------------------------------------------------------------
# Test 2: SmolVLABackend connect/disconnect lifecycle
# ---------------------------------------------------------------------------

@requires_httpx
class TestSmolVLABackendLifecycle:
    def test_connect_and_disconnect(self, mock_server):
        """Backend connects via /health and disconnects cleanly."""
        backend = SmolVLABackend(timeout=5.0)
        assert not backend.is_connected

        backend.connect(mock_server.url)
        assert backend.is_connected
        assert backend.server_url == mock_server.url
        assert "front" in backend.camera_names

        backend.disconnect()
        assert not backend.is_connected

    def test_connect_to_unreachable_server_raises(self):
        """Connecting to a non-existent server raises ConnectionError."""
        backend = SmolVLABackend(timeout=1.0)
        with pytest.raises(ConnectionError):
            backend.connect("http://127.0.0.1:1")

    def test_double_disconnect_is_safe(self, mock_server):
        """Calling disconnect() twice does not raise."""
        backend = SmolVLABackend()
        backend.connect(mock_server.url)
        backend.disconnect()
        backend.disconnect()  # should not raise


# ---------------------------------------------------------------------------
# Test 3: SmolVLABackend predict
# ---------------------------------------------------------------------------

@requires_httpx
class TestSmolVLABackendPredict:
    def test_predict_returns_actions(self, mock_server):
        """predict() sends images+state+prompt and returns action chunks."""
        backend = SmolVLABackend(timeout=5.0)
        backend.connect(mock_server.url)

        images = {"front": "base64_encoded_data"}
        state = np.array([0.0, 17.0, -28.6, 0.0, 0.0, 28.6])
        actions = backend.predict(images, state, "pick up the cube")

        assert len(actions) == 3
        assert len(actions[0]) == 6
        assert mock_server.predict_count == 1
        assert mock_server.last_request["task"] == "pick up the cube"

        backend.disconnect()

    def test_predict_with_numpy_images(self, mock_server):
        """predict() encodes a numpy frame as a base64 JPEG, not a nested list.

        This asserted `isinstance(..., list)` until now, which stopped being
        true at TASK-146: raw arrays went out as ~1 MB of nested JSON per
        480x640 frame and blew the client's timeout, so the contract with
        vla-server is `images: dict[str, str]`. The assertion was simply never
        updated, and the stale failure sat behind an --ignore in
        scripts/test-all.sh (TASK-190 review).
        """
        backend = SmolVLABackend(timeout=5.0)
        backend.connect(mock_server.url)

        images = {"front": np.zeros((2, 2, 3), dtype=np.uint8)}
        state = np.array([0.0] * 6)
        actions = backend.predict(images, state, "test")

        assert len(actions) == 3
        sent = mock_server.last_request["images"]["front"]
        assert isinstance(sent, str), "a numpy frame must not go out as nested JSON lists"
        assert base64.b64decode(sent)[:3] == b"\xff\xd8\xff", "not a JPEG"

        backend.disconnect()

    def test_predict_without_connect_raises(self):
        """predict() raises RuntimeError if not connected."""
        backend = SmolVLABackend()
        with pytest.raises(RuntimeError, match="not connected"):
            backend.predict({}, np.array([]), "test")


# ---------------------------------------------------------------------------
# Test 4: SmolVLABackend predict_with_latency
# ---------------------------------------------------------------------------

@requires_httpx
class TestSmolVLABackendLatency:
    def test_predict_with_latency_returns_tuple(self, mock_server):
        """predict_with_latency() returns (actions, latency_ms)."""
        backend = SmolVLABackend(timeout=5.0)
        backend.connect(mock_server.url)

        images = {"front": "data"}
        state = np.array([0.0] * 6)
        actions, latency_ms = backend.predict_with_latency(images, state, "test")

        assert len(actions) == 3
        assert isinstance(latency_ms, float)
        assert latency_ms >= 0

        backend.disconnect()


# ---------------------------------------------------------------------------
# Test 5: SmolVLABackend camera_names from /config
# ---------------------------------------------------------------------------

@requires_httpx
class TestSmolVLABackendConfig:
    def test_camera_names_from_config(self, mock_server):
        """Backend fetches camera names from /config on connect."""
        backend = SmolVLABackend(timeout=5.0)
        backend.connect(mock_server.url)
        assert backend.camera_names == ["front", "wrist"]
        backend.disconnect()

    def test_camera_names_default_on_missing_config(self):
        """If /config is unavailable, defaults to ['front']."""
        # Start a server that only serves /health (no /config)
        class HealthOnlyHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/health":
                    body = json.dumps({"status": "ok"}).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    self.send_error(404)
            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), HealthOnlyHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        try:
            backend = SmolVLABackend(timeout=5.0)
            backend.connect(f"http://127.0.0.1:{port}")
            assert backend.camera_names == ["front"]
            backend.disconnect()
        finally:
            server.shutdown()


# ---------------------------------------------------------------------------
# Test 6: VLARunner accepts backend parameter
# ---------------------------------------------------------------------------

class TestVLARunnerBackendIntegration:
    def test_runner_uses_injected_backend(self):
        """VLARunner stores the injected backend."""
        mock_backend = MagicMock(spec=VLABackend)
        mock_backend.is_connected = False

        from vla_runner import VLARunner
        runner = VLARunner(
            server_url="http://localhost:8000",
            backend=mock_backend,
        )
        assert runner._backend is mock_backend

    def test_runner_defaults_to_smolvla_backend(self):
        """VLARunner creates SmolVLABackend by default."""
        from vla_runner import VLARunner
        runner = VLARunner(server_url="http://localhost:8000")
        assert isinstance(runner._backend, SmolVLABackend)
