"""
@file test_simulation.py
@description Unit tests for SimulatedCamera, SimulatedCameraManager, and SimulatedRobot
@feature smolvla-client
"""

import base64

import pytest

from smolvla_client.config import CameraConfig
from smolvla_client.simulation import (
    SimulatedCamera,
    SimulatedCameraManager,
    SimulatedRobot,
)


# ============================================================================
# SimulatedCamera Tests
# ============================================================================

class TestSimulatedCamera:
    """Test SimulatedCamera JPEG generation."""

    def test_camera_captures_valid_jpeg(self):
        """Base64 output decodes to valid JPEG bytes."""
        cam = SimulatedCamera("front", CameraConfig(width=224, height=224))
        cam.connect()

        b64_str = cam.capture_jpeg_b64()
        jpeg_bytes = base64.b64decode(b64_str)

        # JPEG magic bytes: FF D8 FF
        assert jpeg_bytes[:2] == b"\xff\xd8", "Not a valid JPEG header"
        cam.disconnect()

    def test_camera_different_frames(self):
        """Each capture should produce a different image (random noise)."""
        cam = SimulatedCamera("front", CameraConfig(width=224, height=224))
        cam.connect()

        frame1 = cam.capture_jpeg_b64()
        frame2 = cam.capture_jpeg_b64()

        # Random noise makes it extremely unlikely that two frames are identical
        assert frame1 != frame2, "Two consecutive frames should differ"
        cam.disconnect()

    def test_camera_not_connected_raises(self):
        """Capturing before connect() should raise RuntimeError."""
        cam = SimulatedCamera("front", CameraConfig())
        with pytest.raises(RuntimeError, match="not connected"):
            cam.capture_jpeg_b64()


# ============================================================================
# SimulatedCameraManager Tests
# ============================================================================

class TestSimulatedCameraManager:
    """Test SimulatedCameraManager with multiple cameras."""

    def test_camera_manager_multiple(self):
        """Manager handles front + wrist cameras."""
        configs = {
            "front": CameraConfig(width=224, height=224),
            "wrist": CameraConfig(width=224, height=224),
        }
        manager = SimulatedCameraManager(configs)
        manager.connect_all()

        captures = manager.capture_all_b64()

        assert "front" in captures
        assert "wrist" in captures
        assert len(captures) == 2

        # Both should be valid base64 JPEG
        for name, b64_str in captures.items():
            jpeg_bytes = base64.b64decode(b64_str)
            assert jpeg_bytes[:2] == b"\xff\xd8", f"Camera '{name}' did not produce valid JPEG"

        manager.disconnect_all()

    def test_camera_manager_single(self):
        """Manager works with a single camera."""
        configs = {"front": CameraConfig(width=224, height=224)}
        manager = SimulatedCameraManager(configs)
        manager.connect_all()

        captures = manager.capture_all_b64()
        assert len(captures) == 1
        assert "front" in captures

        manager.disconnect_all()


# ============================================================================
# SimulatedRobot Tests
# ============================================================================

class TestSimulatedRobot:
    """Test SimulatedRobot state management and clamping."""

    def test_robot_initial_state_zeros(self):
        """Robot starts with all-zero joint state."""
        robot = SimulatedRobot()
        robot.connect()

        state = robot.get_state()
        assert state == [0.0] * 6

    def test_robot_send_action_updates_state(self):
        """Sending an action updates the robot state."""
        robot = SimulatedRobot()
        robot.connect()

        action = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
        robot.send_action(action)

        state = robot.get_state()
        for expected, actual in zip(action, state):
            assert abs(expected - actual) < 1e-6

    def test_robot_clamps_to_joint_limits(self):
        """Values beyond joint limits get clamped."""
        robot = SimulatedRobot()
        robot.connect()

        # Send values way beyond limits
        action = [5.0, -5.0, 3.0, -3.0, 10.0, -10.0]
        robot.send_action(action)

        state = robot.get_state()
        # All values should be within [-2, 2] (with gripper [-0.5, 1.5])
        assert state[0] == 2.0   # clamped high
        assert state[1] == -2.0  # clamped low
        assert state[2] == 2.0   # clamped high
        assert state[3] == -2.0  # clamped low
        assert state[4] == 2.0   # clamped high
        assert state[5] == -0.5  # gripper clamped low

    def test_robot_not_connected_raises(self):
        """Operations before connect() should raise RuntimeError."""
        robot = SimulatedRobot()

        with pytest.raises(RuntimeError, match="not connected"):
            robot.get_state()

        with pytest.raises(RuntimeError, match="not connected"):
            robot.send_action([0.0] * 6)

    def test_robot_disconnect(self):
        """Robot can be disconnected cleanly."""
        robot = SimulatedRobot()
        robot.connect()
        assert robot.connected

        robot.disconnect()
        assert not robot.connected

    def test_robot_multiple_actions(self):
        """State reflects the most recent action."""
        robot = SimulatedRobot()
        robot.connect()

        robot.send_action([0.1] * 6)
        robot.send_action([0.5] * 6)

        state = robot.get_state()
        for v in state:
            assert abs(v - 0.5) < 1e-6
