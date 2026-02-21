"""
@file test_client.py
@description Unit tests for SmolVLA client config and remote inference client
@feature smolvla-client
"""

import pytest
from pathlib import Path

from smolvla_client.config import ClientConfig, CameraConfig, RobotConfig
from smolvla_client.remote import RemoteInferenceClient


# ============================================================================
# CameraConfig Tests
# ============================================================================

class TestCameraConfig:
    """Test CameraConfig dataclass defaults."""

    def test_defaults(self):
        """Test default camera config values."""
        cam = CameraConfig()
        assert cam.type == "opencv"
        assert cam.index == 0
        assert cam.width == 640
        assert cam.height == 480
        assert cam.fps == 30

    def test_custom_values(self):
        """Test camera config with custom values."""
        cam = CameraConfig(type="csi", index=1, width=1280, height=720, fps=60)
        assert cam.type == "csi"
        assert cam.index == 1
        assert cam.width == 1280


# ============================================================================
# RobotConfig Tests
# ============================================================================

class TestRobotConfig:
    """Test RobotConfig dataclass defaults."""

    def test_defaults(self):
        """Test default robot config values."""
        robot = RobotConfig()
        assert robot.type == "so101_follower"
        assert robot.port == "/dev/ttyACM0"
        assert robot.id == "my_follower"

    def test_custom_values(self):
        """Test robot config with custom values."""
        robot = RobotConfig(type="so101_leader", port="/dev/ttyUSB0", id="arm_1")
        assert robot.type == "so101_leader"
        assert robot.port == "/dev/ttyUSB0"


# ============================================================================
# ClientConfig Tests
# ============================================================================

class TestClientConfig:
    """Test ClientConfig dataclass and YAML loading."""

    def test_defaults(self):
        """Test default client config values."""
        config = ClientConfig()
        assert config.server_url == "http://192.168.1.100:8000"
        assert config.control_frequency_hz == 30
        assert config.overlap_inference is True
        assert config.jpeg_quality == 85
        assert config.request_timeout_s == 2.0
        assert config.max_retries == 3
        assert config.retry_delay_s == 0.5
        assert isinstance(config.robot, RobotConfig)
        assert "front" in config.cameras

    def test_from_yaml_existing(self):
        """Test loading config from the existing config.yaml."""
        config_path = Path(__file__).parent.parent / "config.yaml"
        if not config_path.exists():
            pytest.skip("config.yaml not found")

        config = ClientConfig.from_yaml(config_path)
        assert "8000" in config.server_url
        assert config.control_frequency_hz == 30
        assert config.robot.type == "so101_follower"
        assert "front" in config.cameras
        assert config.cameras["front"].index == 0

    def test_from_yaml_nonexistent(self, tmp_path):
        """Test loading config when YAML file doesn't exist returns defaults."""
        config = ClientConfig.from_yaml(tmp_path / "nonexistent.yaml")
        assert config.server_url == "http://192.168.1.100:8000"
        assert config.control_frequency_hz == 30

    def test_from_yaml_partial(self, tmp_path):
        """Test loading config with partial YAML."""
        yaml_file = tmp_path / "partial.yaml"
        yaml_file.write_text(
            'server_url: "http://10.0.0.1:9000"\n'
            'task: "Wave hello."\n'
        )

        config = ClientConfig.from_yaml(yaml_file)
        assert config.server_url == "http://10.0.0.1:9000"
        assert config.task == "Wave hello."
        assert config.control_frequency_hz == 30  # default

    def test_from_yaml_nested_robot(self, tmp_path):
        """Test loading config with nested robot config."""
        yaml_file = tmp_path / "robot.yaml"
        yaml_file.write_text(
            'server_url: "http://localhost:8000"\n'
            'task: "test"\n'
            'robot:\n'
            '  type: "so101_leader"\n'
            '  port: "/dev/ttyUSB1"\n'
            '  id: "leader_arm"\n'
        )

        config = ClientConfig.from_yaml(yaml_file)
        assert config.robot.type == "so101_leader"
        assert config.robot.port == "/dev/ttyUSB1"
        assert config.robot.id == "leader_arm"


# ============================================================================
# RemoteInferenceClient Tests
# ============================================================================

class TestRemoteInferenceClient:
    """Test RemoteInferenceClient instantiation."""

    def test_instantiation(self):
        """Test creating a client with URL."""
        client = RemoteInferenceClient(server_url="http://localhost:8000")
        assert client.server_url == "http://localhost:8000"
        assert client.timeout_s == 2.0
        assert client.max_retries == 3
        client.close()

    def test_trailing_slash_stripped(self):
        """Test that trailing slash is stripped from server URL."""
        client = RemoteInferenceClient(server_url="http://localhost:8000/")
        assert client.server_url == "http://localhost:8000"
        client.close()

    def test_custom_timeout(self):
        """Test creating client with custom timeout."""
        client = RemoteInferenceClient(
            server_url="http://localhost:8000",
            timeout_s=5.0,
            max_retries=5,
            retry_delay_s=1.0,
        )
        assert client.timeout_s == 5.0
        assert client.max_retries == 5
        assert client.retry_delay_s == 1.0
        client.close()
