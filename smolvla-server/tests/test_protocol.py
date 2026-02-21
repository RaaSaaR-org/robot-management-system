"""
@file test_protocol.py
@description Unit tests for SmolVLA server protocol models and config
@feature smolvla-server
"""

import pytest
from pathlib import Path

from smolvla_server.protocol import (
    PredictRequest,
    PredictResponse,
    HealthResponse,
    ConfigResponse,
)
from smolvla_server.config import ServerConfig


# ============================================================================
# Protocol Model Tests
# ============================================================================

class TestPredictRequest:
    """Test PredictRequest Pydantic model."""

    def test_valid_request(self):
        """Test constructing a valid predict request."""
        req = PredictRequest(
            images={"front": "base64data=="},
            state=[0.0, 0.1, 0.2, 0.3, 0.4, 0.5],
            task="Pick up the cube.",
        )
        assert req.images == {"front": "base64data=="}
        assert len(req.state) == 6
        assert req.task == "Pick up the cube."

    def test_multiple_cameras(self):
        """Test request with multiple camera images."""
        req = PredictRequest(
            images={"front": "aaa", "wrist": "bbb"},
            state=[0.0] * 6,
            task="Grasp object.",
        )
        assert len(req.images) == 2
        assert "front" in req.images
        assert "wrist" in req.images

    def test_missing_required_fields(self):
        """Test that missing required fields raise validation error."""
        with pytest.raises(Exception):
            PredictRequest(images={"front": "data"}, state=[0.0])
            # missing task

    def test_empty_state(self):
        """Test request with empty state list."""
        req = PredictRequest(
            images={"front": "data"},
            state=[],
            task="Do something.",
        )
        assert req.state == []


class TestPredictResponse:
    """Test PredictResponse Pydantic model."""

    def test_valid_response(self):
        """Test constructing a valid predict response."""
        resp = PredictResponse(
            actions=[[0.1, 0.2, 0.3, 0.4, 0.5, 0.6]] * 10,
            timestamp=1234567890.0,
            inference_time_ms=42.5,
        )
        assert len(resp.actions) == 10
        assert resp.timestamp == 1234567890.0
        assert resp.inference_time_ms == 42.5

    def test_single_action(self):
        """Test response with single action."""
        resp = PredictResponse(
            actions=[[1.0, 2.0]],
            timestamp=0.0,
            inference_time_ms=0.1,
        )
        assert len(resp.actions) == 1


class TestHealthResponse:
    """Test HealthResponse Pydantic model."""

    def test_defaults(self):
        """Test default health response values."""
        resp = HealthResponse()
        assert resp.status == "ok"
        assert resp.model_path == ""
        assert resp.device == ""
        assert resp.model_loaded is False

    def test_custom_values(self):
        """Test health response with custom values."""
        resp = HealthResponse(
            status="ok",
            model_path="lerobot/smolvla_base",
            device="mps",
            model_loaded=True,
        )
        assert resp.model_loaded is True
        assert resp.device == "mps"


class TestConfigResponse:
    """Test ConfigResponse Pydantic model."""

    def test_valid_config(self):
        """Test constructing a valid config response."""
        resp = ConfigResponse(
            action_dim=6,
            chunk_size=10,
            camera_names=["front"],
            state_dim=6,
        )
        assert resp.action_dim == 6
        assert resp.chunk_size == 10
        assert resp.camera_names == ["front"]
        assert resp.state_dim == 6

    def test_multiple_cameras(self):
        """Test config with multiple camera names."""
        resp = ConfigResponse(
            action_dim=6,
            chunk_size=10,
            camera_names=["front", "wrist", "overhead"],
            state_dim=6,
        )
        assert len(resp.camera_names) == 3


# ============================================================================
# Server Config Tests
# ============================================================================

class TestServerConfig:
    """Test ServerConfig dataclass and YAML loading."""

    def test_defaults(self):
        """Test default config values."""
        config = ServerConfig()
        assert config.model_path == "lerobot/smolvla_base"
        assert config.device == "mps"
        assert config.host == "0.0.0.0"
        assert config.port == 8000
        assert "cube" in config.default_task

    def test_from_yaml_existing(self):
        """Test loading config from the existing config.yaml."""
        config_path = Path(__file__).parent.parent / "config.yaml"
        if not config_path.exists():
            pytest.skip("config.yaml not found")

        config = ServerConfig.from_yaml(config_path)
        assert config.model_path == "lerobot/smolvla_base"
        assert config.device == "mps"
        assert config.port == 8000

    def test_from_yaml_nonexistent(self, tmp_path):
        """Test loading config when YAML file doesn't exist returns defaults."""
        config = ServerConfig.from_yaml(tmp_path / "nonexistent.yaml")
        assert config.model_path == "lerobot/smolvla_base"
        assert config.device == "mps"
        assert config.port == 8000

    def test_from_yaml_partial(self, tmp_path):
        """Test loading config with partial YAML (missing fields get defaults)."""
        yaml_file = tmp_path / "partial.yaml"
        yaml_file.write_text('port: 9000\ndevice: "cpu"\n')

        config = ServerConfig.from_yaml(yaml_file)
        assert config.port == 9000
        assert config.device == "cpu"
        assert config.model_path == "lerobot/smolvla_base"  # default
