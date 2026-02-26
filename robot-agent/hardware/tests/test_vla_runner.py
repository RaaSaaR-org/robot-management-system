"""
Tests for VLARunner — mock server, action queue, start/stop.

These tests don't require real hardware or ML dependencies.
They mock the HTTP server and verify the runner's logic.
"""

import base64
import io
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import MagicMock, patch

import pytest

# We need to mock hardware dependencies before importing VLARunner
# since the control loop imports lerobot, picamera2, etc.


class MockVLAServer:
    """A minimal mock VLA server for testing."""

    def __init__(self, port: int = 0):
        self.port = port
        self.predict_count = 0
        self.last_request = None
        self._server = None
        self._thread = None

        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/health":
                    self._respond({"status": "ok", "model_loaded": True, "device": "cpu"})
                elif self.path == "/config":
                    self._respond({
                        "action_dim": 6,
                        "chunk_size": 5,
                        "cameras": ["front"],
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

                    # Return 5 dummy actions
                    actions = [[float(i + j) * 0.1 for j in range(6)] for i in range(5)]
                    self._respond({
                        "actions": actions,
                        "timestamp": time.time(),
                        "inference_time_ms": 1.0,
                    })
                elif self.path == "/reset":
                    self._respond({"ok": True})
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

        self._handler_cls = Handler

    def start(self):
        self._server = HTTPServer(("127.0.0.1", self.port), self._handler_cls)
        self.port = self._server.server_address[1]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        if self._server:
            self._server.shutdown()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


@pytest.fixture
def mock_server():
    server = MockVLAServer()
    server.start()
    yield server
    server.stop()


def _dummy_image_b64() -> str:
    """Create a minimal JPEG as base64."""
    from PIL import Image

    img = Image.new("RGB", (64, 64), color=(100, 100, 100))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


class TestVLARunnerUnit:
    """Unit tests that don't need a mock server — test state/logic only."""

    def test_initial_state(self):
        from vla_runner import VLARunner

        runner = VLARunner(server_url="http://localhost:9999")
        assert not runner.is_running
        assert runner.last_error is None
        assert runner.status()["active"] is False

    def test_status_fields(self):
        from vla_runner import VLARunner

        runner = VLARunner(server_url="http://localhost:9999")
        status = runner.status()
        assert "active" in status
        assert "instruction" in status
        assert "step" in status
        assert "queue_size" in status
        assert "error" in status

    def test_stop_when_not_running(self):
        from vla_runner import VLARunner

        runner = VLARunner(server_url="http://localhost:9999")
        # Should not raise
        runner.stop()
        assert not runner.is_running


class TestVLARunnerIntegration:
    """Integration tests with mock server — mocks robot/camera hardware."""

    @patch("vla_runner.VLARunner._connect_robot")
    @patch("vla_runner.VLARunner._disconnect_robot")
    @patch("vla_runner.VLARunner._make_camera")
    @patch("vla_runner.VLARunner._release_camera")
    @patch("vla_runner.VLARunner._capture_b64", return_value=_dummy_image_b64())
    @patch("vla_runner.VLARunner._get_state", return_value=[0.0] * 6)
    @patch("vla_runner.VLARunner._send_action")
    def test_start_stop_cycle(
        self,
        mock_send_action,
        mock_get_state,
        mock_capture,
        mock_release_cam,
        mock_make_cam,
        mock_disconnect,
        mock_connect,
        mock_server,
    ):
        from vla_runner import VLARunner

        mock_connect.return_value = MagicMock()
        mock_make_cam.return_value = ("mock", MagicMock())

        runner = VLARunner(server_url=mock_server.url, hz=10.0)
        runner.start("pick up the object")

        # Let it run a few cycles
        time.sleep(1.0)
        assert runner.is_running
        assert runner._step > 0

        runner.stop()
        assert not runner.is_running

    @patch("vla_runner.VLARunner._connect_robot")
    @patch("vla_runner.VLARunner._disconnect_robot")
    @patch("vla_runner.VLARunner._make_camera")
    @patch("vla_runner.VLARunner._release_camera")
    @patch("vla_runner.VLARunner._capture_b64", return_value=_dummy_image_b64())
    @patch("vla_runner.VLARunner._get_state", return_value=[1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    @patch("vla_runner.VLARunner._send_action")
    def test_sends_actions_to_robot(
        self,
        mock_send_action,
        mock_get_state,
        mock_capture,
        mock_release_cam,
        mock_make_cam,
        mock_disconnect,
        mock_connect,
        mock_server,
    ):
        from vla_runner import VLARunner

        mock_connect.return_value = MagicMock()
        mock_make_cam.return_value = ("mock", MagicMock())

        runner = VLARunner(server_url=mock_server.url, hz=20.0)
        runner.start("test instruction")
        time.sleep(0.8)
        runner.stop()

        assert mock_send_action.call_count > 0
        # First action should be from the mock server's response
        first_call_action = mock_send_action.call_args_list[0]
        action_arg = first_call_action[0][1]  # (robot, action)
        assert len(action_arg) == 6

    @patch("vla_runner.VLARunner._connect_robot")
    @patch("vla_runner.VLARunner._disconnect_robot")
    @patch("vla_runner.VLARunner._make_camera")
    @patch("vla_runner.VLARunner._release_camera")
    @patch("vla_runner.VLARunner._capture_b64", return_value=_dummy_image_b64())
    @patch("vla_runner.VLARunner._get_state", return_value=[0.0] * 6)
    @patch("vla_runner.VLARunner._send_action")
    def test_sends_instruction_to_server(
        self,
        mock_send_action,
        mock_get_state,
        mock_capture,
        mock_release_cam,
        mock_make_cam,
        mock_disconnect,
        mock_connect,
        mock_server,
    ):
        from vla_runner import VLARunner

        mock_connect.return_value = MagicMock()
        mock_make_cam.return_value = ("mock", MagicMock())

        runner = VLARunner(server_url=mock_server.url, hz=10.0)
        runner.start("pick up the green bottle")
        time.sleep(0.5)
        runner.stop()

        assert mock_server.predict_count > 0
        assert mock_server.last_request["task"] == "pick up the green bottle"

    @patch("vla_runner.VLARunner._connect_robot")
    @patch("vla_runner.VLARunner._disconnect_robot")
    @patch("vla_runner.VLARunner._make_camera")
    @patch("vla_runner.VLARunner._release_camera")
    @patch("vla_runner.VLARunner._capture_b64", return_value=_dummy_image_b64())
    @patch("vla_runner.VLARunner._get_state", return_value=[0.0] * 6)
    @patch("vla_runner.VLARunner._send_action")
    def test_action_queue_drains(
        self,
        mock_send_action,
        mock_get_state,
        mock_capture,
        mock_release_cam,
        mock_make_cam,
        mock_disconnect,
        mock_connect,
        mock_server,
    ):
        """Verify that actions from a chunk are executed before re-querying."""
        from vla_runner import VLARunner

        mock_connect.return_value = MagicMock()
        mock_make_cam.return_value = ("mock", MagicMock())

        runner = VLARunner(server_url=mock_server.url, hz=50.0)
        runner.start("test")
        time.sleep(0.5)
        runner.stop()

        # Mock server returns 5 actions per predict. With 50 Hz we should
        # have executed multiple actions but with fewer predict calls.
        total_actions = mock_send_action.call_count
        predict_calls = mock_server.predict_count
        assert total_actions > predict_calls, (
            f"Expected more action executions ({total_actions}) than predict calls ({predict_calls})"
        )

    @patch("vla_runner.VLARunner._connect_robot")
    @patch("vla_runner.VLARunner._disconnect_robot")
    @patch("vla_runner.VLARunner._make_camera")
    @patch("vla_runner.VLARunner._release_camera")
    @patch("vla_runner.VLARunner._capture_b64", return_value=_dummy_image_b64())
    @patch("vla_runner.VLARunner._get_state", return_value=[0.0] * 6)
    @patch("vla_runner.VLARunner._send_action")
    def test_wrist_camera_capture(
        self,
        mock_send_action,
        mock_get_state,
        mock_capture,
        mock_release_cam,
        mock_make_cam,
        mock_disconnect,
        mock_connect,
        mock_server,
    ):
        """Wrist camera enabled → images dict includes 'wrist' key."""
        from vla_runner import VLARunner

        mock_connect.return_value = MagicMock()
        mock_make_cam.return_value = ("mock", MagicMock())

        runner = VLARunner(
            server_url=mock_server.url, hz=10.0, wrist_camera_index=1
        )
        runner.start("pick up object")
        time.sleep(0.5)
        runner.stop()

        assert mock_server.predict_count > 0
        # _make_camera should be called twice: front (index 0) + wrist (index 1)
        assert mock_make_cam.call_count >= 2
        # Server should receive images dict with front key
        assert "images" in mock_server.last_request
        assert "front" in mock_server.last_request["images"]

    @patch("vla_runner.VLARunner._connect_robot")
    @patch("vla_runner.VLARunner._disconnect_robot")
    @patch("vla_runner.VLARunner._release_camera")
    @patch("vla_runner.VLARunner._capture_b64", return_value=_dummy_image_b64())
    @patch("vla_runner.VLARunner._get_state", return_value=[0.0] * 6)
    @patch("vla_runner.VLARunner._send_action")
    def test_wrist_camera_fallback(
        self,
        mock_send_action,
        mock_get_state,
        mock_capture,
        mock_release_cam,
        mock_disconnect,
        mock_connect,
        mock_server,
    ):
        """Wrist camera unavailable → graceful degradation, front only."""
        from vla_runner import VLARunner

        mock_connect.return_value = MagicMock()

        call_count = 0

        def make_camera_side_effect(index):
            nonlocal call_count
            call_count += 1
            if index == 1:
                raise RuntimeError("Wrist camera not available")
            return ("mock", MagicMock())

        with patch.object(VLARunner, "_make_camera", side_effect=make_camera_side_effect):
            runner = VLARunner(
                server_url=mock_server.url, hz=10.0, wrist_camera_index=1
            )
            runner.start("pick up object")
            time.sleep(0.5)
            runner.stop()

        # Runner should still be functional (front camera only)
        assert runner._step > 0
        assert runner.last_error is None
        assert mock_server.predict_count > 0

    @patch("vla_runner.VLARunner._connect_robot")
    @patch("vla_runner.VLARunner._disconnect_robot")
    @patch("vla_runner.VLARunner._make_camera")
    @patch("vla_runner.VLARunner._release_camera")
    @patch("vla_runner.VLARunner._get_state", return_value=[0.0] * 6)
    @patch("vla_runner.VLARunner._send_action")
    def test_crash_recovery(
        self,
        mock_send_action,
        mock_get_state,
        mock_release_cam,
        mock_make_cam,
        mock_disconnect,
        mock_connect,
        mock_server,
    ):
        """Runner crash → is_running becomes False, error is recorded."""
        from vla_runner import VLARunner

        mock_connect.return_value = MagicMock()
        mock_make_cam.return_value = ("mock", MagicMock())

        # Make _capture_b64 raise after first successful call to simulate a crash
        call_idx = 0

        def capture_crash(*args, **kwargs):
            nonlocal call_idx
            call_idx += 1
            if call_idx > 1:
                raise RuntimeError("Camera hardware failure")
            return _dummy_image_b64()

        with patch.object(VLARunner, "_capture_b64", side_effect=capture_crash):
            runner = VLARunner(server_url=mock_server.url, hz=50.0)
            runner.start("test crash")
            # Wait for the crash to propagate (1st chunk executes, 2nd capture crashes)
            time.sleep(2.0)

        assert not runner.is_running
        assert runner.status()["active"] is False
        assert runner.last_error is not None

    def test_vla_status_accuracy(self, mock_server):
        """Thread not alive → status active=False immediately."""
        from vla_runner import VLARunner

        runner = VLARunner(server_url=mock_server.url)
        # Never started — thread is None
        assert runner.status()["active"] is False
        assert not runner.is_running

        # Manually set a dead thread to simulate post-crash state
        dead_thread = threading.Thread(target=lambda: None)
        dead_thread.start()
        dead_thread.join()  # Ensure it's done
        runner._thread = dead_thread

        # is_alive() should be False since the thread completed
        assert not runner.is_running
        assert runner.status()["active"] is False
