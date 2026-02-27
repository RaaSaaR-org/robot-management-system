"""
Tests for GR00T N1 model backend.

All tests run in stub mode — no ZMQ server or GPU required.
"""

import base64
import io
import os

import numpy as np
import pytest
from PIL import Image

from models.groot import ACTION_DIM, CHUNK_SIZE, GR00TModel


@pytest.fixture
def stub_model() -> GR00TModel:
    """GR00T model in stub mode, loaded and ready."""
    model = GR00TModel(stub=True)
    model.load()
    return model


@pytest.fixture
def dummy_image_b64() -> str:
    """Create a minimal valid JPEG as base64."""
    img = Image.new("RGB", (64, 64), color=(128, 128, 128))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


class TestGR00TStubPredict:
    def test_stub_returns_correct_shape(self, stub_model):
        result = stub_model.predict(
            images={},
            state=[0.0] * 6,
            task="pick up the object",
        )
        assert len(result.actions) == CHUNK_SIZE
        assert all(len(a) == ACTION_DIM for a in result.actions)

    def test_stub_inference_time_positive(self, stub_model):
        result = stub_model.predict(
            images={},
            state=[0.0] * 6,
            task="test",
        )
        assert result.inference_time_ms >= 0

    def test_stub_actions_vary_between_calls(self, stub_model):
        r1 = stub_model.predict(images={}, state=[0.0] * 6, task="test")
        r2 = stub_model.predict(images={}, state=[0.0] * 6, task="test")
        assert r1.actions[0] != r2.actions[0]

    def test_stub_with_partial_state(self, stub_model):
        result = stub_model.predict(
            images={},
            state=[1.0, 2.0],
            task="test",
        )
        assert len(result.actions) == CHUNK_SIZE
        assert len(result.actions[0]) == ACTION_DIM


class TestGR00TInfo:
    def test_info_model_name(self, stub_model):
        info = stub_model.info()
        assert info.action_dim == ACTION_DIM
        assert info.chunk_size == CHUNK_SIZE
        assert info.state_dim == 6
        assert "front" in info.cameras

    def test_info_before_load(self):
        model = GR00TModel(stub=True)
        info = model.info()
        assert info.action_dim == ACTION_DIM


class TestGR00TBuildObservation:
    def test_observation_with_image(self, dummy_image_b64):
        obs = GR00TModel._build_observation(
            images={"front": dummy_image_b64},
            state=[1.0, 2.0, 3.0, 4.0, 5.0, 0.5],
            task="pick up the cube",
        )
        assert "video.front" in obs
        assert obs["video.front"].shape == (224, 224, 3)
        assert obs["video.front"].dtype == np.uint8

    def test_observation_state_split(self, dummy_image_b64):
        obs = GR00TModel._build_observation(
            images={"front": dummy_image_b64},
            state=[1.0, 2.0, 3.0, 4.0, 5.0, 0.5],
            task="test",
        )
        np.testing.assert_array_equal(
            obs["state.single_arm"], np.array([1.0, 2.0, 3.0, 4.0, 5.0], dtype=np.float32)
        )
        np.testing.assert_array_equal(
            obs["state.gripper"], np.array([0.5], dtype=np.float32)
        )

    def test_observation_task_annotation(self, dummy_image_b64):
        obs = GR00TModel._build_observation(
            images={"front": dummy_image_b64},
            state=[0.0] * 6,
            task="move left",
        )
        assert obs["annotation.human.task_description"] == "move left"

    def test_observation_partial_state(self, dummy_image_b64):
        obs = GR00TModel._build_observation(
            images={"front": dummy_image_b64},
            state=[1.0, 2.0],
            task="test",
        )
        np.testing.assert_array_equal(
            obs["state.single_arm"], np.array([1.0, 2.0], dtype=np.float32)
        )
        np.testing.assert_array_equal(
            obs["state.gripper"], np.array([0.0], dtype=np.float32)
        )

    def test_observation_no_image(self):
        obs = GR00TModel._build_observation(
            images={}, state=[0.0] * 6, task="test"
        )
        assert "video.front" not in obs
        assert "state.single_arm" in obs


class TestGR00TCombineActions:
    def test_combine_2d(self):
        arm = np.array([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]], dtype=np.float32)
        grip = np.array([[0.1], [0.2]], dtype=np.float32)
        result = GR00TModel._combine_actions(arm, grip)
        assert len(result) == 2
        assert len(result[0]) == 6
        assert result[0] == [1.0, 2.0, 3.0, 4.0, 5.0, pytest.approx(0.1, abs=1e-5)]
        assert result[1] == [6.0, 7.0, 8.0, 9.0, 10.0, pytest.approx(0.2, abs=1e-5)]

    def test_combine_1d(self):
        arm = [1, 2, 3, 4, 5]
        grip = [0.5]
        result = GR00TModel._combine_actions(arm, grip)
        assert len(result) == 1
        assert len(result[0]) == 6

    def test_combine_truncates_to_action_dim(self):
        arm = np.array([[1, 2, 3, 4, 5, 6]], dtype=np.float32)
        grip = np.array([[0.5]], dtype=np.float32)
        result = GR00TModel._combine_actions(arm, grip)
        assert len(result[0]) == 6  # truncated from 7


class TestGR00TReset:
    def test_reset_stub_no_error(self, stub_model):
        stub_model.reset()  # should not raise

    def test_reset_restores_step(self, stub_model):
        stub_model.predict(images={}, state=[0.0] * 6, task="test")
        assert stub_model._step > 0
        stub_model.reset()
        assert stub_model._step == 0


class TestGR00TLoadState:
    def test_not_loaded_before_load(self):
        model = GR00TModel(stub=True)
        assert model.is_loaded is False

    def test_loaded_after_load(self):
        model = GR00TModel(stub=True)
        model.load()
        assert model.is_loaded is True

    def test_predict_before_load_raises(self):
        model = GR00TModel(stub=True)
        with pytest.raises(RuntimeError, match="not loaded"):
            model.predict(images={}, state=[0.0] * 6, task="test")

    def test_double_load_warns(self, stub_model, caplog):
        import logging

        with caplog.at_level(logging.WARNING):
            stub_model.load()
        assert "already loaded" in caplog.text


class TestServerWithGR00T:
    """Integration tests: GR00T model via FastAPI server in stub mode."""

    @pytest.fixture
    def client(self, monkeypatch):
        monkeypatch.setenv("VLA_STUB", "true")
        from server import ServerConfig, app, create_model
        from fastapi.testclient import TestClient

        cfg = ServerConfig(model="groot", stub=True, port=9998)
        app.state.config = cfg
        with TestClient(app) as c:
            yield c

    def test_health_groot(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["model_loaded"] is True
        assert data["model"] == "groot"

    def test_config_groot(self, client):
        resp = client.get("/config")
        assert resp.status_code == 200
        data = resp.json()
        assert data["action_dim"] == ACTION_DIM
        assert data["chunk_size"] == CHUNK_SIZE

    def test_predict_groot_stub(self, client, dummy_image_b64):
        resp = client.post("/predict", json={
            "images": {"front": dummy_image_b64},
            "state": [0.0] * 6,
            "task": "pick up the object",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["actions"]) == CHUNK_SIZE
        assert len(data["actions"][0]) == ACTION_DIM
        assert data["inference_time_ms"] >= 0

    def test_reset_groot(self, client):
        resp = client.post("/reset")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestModelFactory:
    def test_create_groot_model(self, monkeypatch):
        monkeypatch.setenv("VLA_STUB", "true")
        from server import ServerConfig, create_model

        cfg = ServerConfig(model="groot", stub=True)
        model = create_model(cfg)
        assert isinstance(model, GR00TModel)
        assert model.stub is True

    def test_create_groot_custom_host(self, monkeypatch):
        monkeypatch.setenv("VLA_HOST", "192.168.1.100")
        monkeypatch.setenv("VLA_ZMQ_PORT", "6666")
        monkeypatch.setenv("VLA_STUB", "true")
        from server import ServerConfig, create_model

        cfg = ServerConfig(model="groot")
        model = create_model(cfg)
        assert isinstance(model, GR00TModel)
        assert model.host == "192.168.1.100"
        assert model.port == 6666
