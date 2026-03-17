"""
@file smolvla_backend.py
@description HTTP backend for the consolidated vla-server (SmolVLA / Pi0 / GR00T).
@feature hardware/backends

Extracts the HTTP request logic from vla_runner.py into a standalone
VLABackend implementation. The control loop in vla_runner.py delegates
all server communication to this backend.

Usage:
    backend = SmolVLABackend(timeout=10.0)
    backend.connect("http://192.168.178.40:8000")
    actions = backend.predict(images, state, "pick up the green object")
    backend.disconnect()
"""

import logging
import time

import numpy as np

from .base import VLABackend

logger = logging.getLogger(__name__)


class SmolVLABackend(VLABackend):
    """HTTP backend that talks to vla-server /predict endpoint."""

    def __init__(self, timeout: float = 10.0):
        self._timeout = timeout
        self._client = None
        self._server_url: str = ""
        self._camera_names: list[str] = ["front"]
        self._connected = False

    def connect(self, server_url: str, config: dict | None = None) -> None:
        """Connect to the VLA server by verifying /health.

        Also fetches /config to learn expected camera names.

        Args:
            server_url: Base URL (e.g. "http://192.168.178.40:8000").
            config: Optional dict with 'timeout' override.
        """
        import httpx

        self._server_url = server_url.rstrip("/")
        timeout = (config or {}).get("timeout", self._timeout)
        self._client = httpx.Client(timeout=timeout)

        # Verify server is reachable
        try:
            resp = self._client.get(f"{self._server_url}/health")
            resp.raise_for_status()
        except Exception as e:
            self._client.close()
            self._client = None
            raise ConnectionError(
                f"Cannot reach VLA server at {self._server_url}/health: {e}"
            ) from e

        # Fetch camera names from server config
        try:
            cfg_resp = self._client.get(f"{self._server_url}/config")
            cfg_resp.raise_for_status()
            self._camera_names = cfg_resp.json().get("cameras", ["front"])
        except Exception as e:
            logger.warning(f"Could not fetch /config, defaulting to ['front']: {e}")
            self._camera_names = ["front"]

        self._connected = True
        logger.info(
            f"SmolVLABackend connected to {self._server_url} "
            f"(cameras={self._camera_names})"
        )

    def predict(
        self,
        images: dict[str, np.ndarray],
        state: np.ndarray,
        prompt: str,
    ) -> list[np.ndarray]:
        """POST /predict with images, state, and task instruction.

        Images values can be base64 strings (from _capture_b64) or numpy arrays.
        State can be a list or numpy array of joint positions.

        Returns:
            List of action arrays (each is a list[float] from the server).
        """
        if not self._connected or self._client is None:
            raise RuntimeError("SmolVLABackend is not connected")

        # Convert numpy arrays to lists for JSON serialization
        images_payload = {}
        for cam_name, img in images.items():
            if isinstance(img, np.ndarray):
                images_payload[cam_name] = img.tolist()
            else:
                # Already a base64 string or list
                images_payload[cam_name] = img

        state_list = state.tolist() if isinstance(state, np.ndarray) else list(state)

        try:
            resp = self._client.post(
                f"{self._server_url}/predict",
                json={
                    "images": images_payload,
                    "state": state_list,
                    "task": prompt,
                },
            )
            resp.raise_for_status()
            actions = resp.json()["actions"]
            return actions
        except Exception as e:
            raise RuntimeError(f"SmolVLABackend predict failed: {e}") from e

    def predict_with_latency(
        self,
        images: dict[str, np.ndarray],
        state: np.ndarray,
        prompt: str,
    ) -> tuple[list[np.ndarray], float]:
        """Like predict(), but also returns latency in milliseconds.

        Used by the control loop for watchdog tracking.
        """
        t_start = time.time()
        actions = self.predict(images, state, prompt)
        latency_ms = (time.time() - t_start) * 1000
        return actions, latency_ms

    def disconnect(self) -> None:
        """Close the HTTP client."""
        if self._client is not None:
            try:
                self._client.close()
            except Exception:
                pass
            self._client = None
        self._connected = False
        logger.info("SmolVLABackend disconnected")

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def camera_names(self) -> list[str]:
        """Camera names expected by the server (fetched during connect)."""
        return self._camera_names

    @property
    def server_url(self) -> str:
        return self._server_url
