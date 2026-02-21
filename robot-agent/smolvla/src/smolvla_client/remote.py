"""HTTP client for communicating with the SmolVLA inference server."""

import logging
import time

import httpx

logger = logging.getLogger(__name__)


class RemoteInferenceClient:
    """Synchronous HTTP client for the SmolVLA inference server."""

    def __init__(
        self,
        server_url: str,
        timeout_s: float = 2.0,
        max_retries: int = 3,
        retry_delay_s: float = 0.5,
    ):
        self.server_url = server_url.rstrip("/")
        self.timeout_s = timeout_s
        self.max_retries = max_retries
        self.retry_delay_s = retry_delay_s
        self._client = httpx.Client(
            base_url=self.server_url,
            timeout=httpx.Timeout(timeout_s, connect=5.0),
        )

    def health_check(self) -> dict:
        """Check if the server is ready."""
        resp = self._client.get("/health")
        resp.raise_for_status()
        return resp.json()

    def get_config(self) -> dict:
        """Fetch model configuration from server."""
        resp = self._client.get("/config")
        resp.raise_for_status()
        return resp.json()

    def predict(
        self, images: dict[str, str], state: list[float], task: str
    ) -> dict | None:
        """Send observation to server and get action chunk.

        Retries on failure up to max_retries times.

        Args:
            images: camera_name -> base64 JPEG
            state: current joint positions
            task: task description string

        Returns:
            Response dict with 'actions', 'timestamp', 'inference_time_ms',
            or None if all retries exhausted.
        """
        payload = {"images": images, "state": state, "task": task}

        for attempt in range(1, self.max_retries + 1):
            try:
                resp = self._client.post("/predict", json=payload)
                resp.raise_for_status()
                return resp.json()
            except httpx.TimeoutException:
                logger.warning(
                    f"Prediction timeout (attempt {attempt}/{self.max_retries})"
                )
            except httpx.HTTPStatusError as e:
                logger.error(
                    f"Server error {e.response.status_code}: {e.response.text} "
                    f"(attempt {attempt}/{self.max_retries})"
                )
            except httpx.ConnectError:
                logger.error(
                    f"Cannot reach server at {self.server_url} "
                    f"(attempt {attempt}/{self.max_retries})"
                )

            if attempt < self.max_retries:
                time.sleep(self.retry_delay_s)

        logger.error("All prediction retries exhausted. Returning None.")
        return None

    def reset_policy(self) -> None:
        """Tell the server to reset the policy state (between episodes)."""
        try:
            resp = self._client.post("/reset")
            resp.raise_for_status()
        except Exception as e:
            logger.warning(f"Failed to reset policy on server: {e}")

    def close(self) -> None:
        """Close the HTTP client."""
        self._client.close()


class AsyncRemoteInferenceClient:
    """Async HTTP client for overlapped inference.

    Use this when overlap_inference is enabled: start prediction request
    while still executing previous action chunk.
    """

    def __init__(
        self,
        server_url: str,
        timeout_s: float = 2.0,
    ):
        self.server_url = server_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.server_url,
            timeout=httpx.Timeout(timeout_s, connect=5.0),
        )

    async def predict(
        self, images: dict[str, str], state: list[float], task: str
    ) -> dict | None:
        """Async version of predict for overlapped inference."""
        payload = {"images": images, "state": state, "task": task}
        try:
            resp = await self._client.post("/predict", json=payload)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f"Async prediction failed: {e}")
            return None

    async def close(self) -> None:
        await self._client.aclose()
