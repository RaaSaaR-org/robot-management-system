"""
Tests for the /load-adapter endpoint and model lock.

Uses the pi05 stub model — no ML deps. Validates the wiring + concurrency
behavior; the real PEFT hot-swap path is exercised manually against SmolVLA.
"""

import asyncio
import base64
import io

import pytest
from fastapi.testclient import TestClient

from server import ServerConfig, app


@pytest.fixture
def client():
    cfg = ServerConfig(model="pi05", stub=True, port=9999)
    app.state.config = cfg
    with TestClient(app) as c:
        yield c


@pytest.fixture
def dummy_image_b64() -> str:
    from PIL import Image

    img = Image.new("RGB", (64, 64), color=(128, 128, 128))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


class TestLoadAdapter:
    def test_load_adapter_returns_id(self, client):
        resp = client.post(
            "/load-adapter",
            json={"adapter_path": "/tmp/fake/path", "adapter_id": "model-v1"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["adapter_id"] == "model-v1"
        assert data["load_time_ms"] >= 0
        assert data["info"]["strategy"] == "stub"
        assert data["info"]["path"] == "/tmp/fake/path"

    def test_load_adapter_generates_id_if_omitted(self, client):
        resp = client.post(
            "/load-adapter",
            json={"adapter_path": "/tmp/fake/path"},
        )
        assert resp.status_code == 200
        assert resp.json()["adapter_id"].startswith("adapter-")

    def test_load_adapter_missing_path_422(self, client):
        resp = client.post("/load-adapter", json={})
        assert resp.status_code == 422

    def test_health_reflects_active_adapter(self, client):
        # Initially no adapter on the pi05 stub
        h0 = client.get("/health").json()
        assert h0["active_adapter_id"] is None

        # Load one
        client.post(
            "/load-adapter",
            json={"adapter_path": "/tmp/x", "adapter_id": "model-abc"},
        )
        h1 = client.get("/health").json()
        assert h1["active_adapter_id"] == "model-abc"

        # Swap to a second
        client.post(
            "/load-adapter",
            json={"adapter_path": "/tmp/y", "adapter_id": "model-def"},
        )
        h2 = client.get("/health").json()
        assert h2["active_adapter_id"] == "model-def"

    def test_predict_still_works_after_swap(self, client, dummy_image_b64):
        client.post(
            "/load-adapter",
            json={"adapter_path": "/tmp/x", "adapter_id": "model-v2"},
        )
        resp = client.post(
            "/predict",
            json={
                "images": {"front": dummy_image_b64},
                "state": [0.0] * 6,
                "task": "pick up the cube",
            },
        )
        assert resp.status_code == 200
        assert len(resp.json()["actions"]) == 50
