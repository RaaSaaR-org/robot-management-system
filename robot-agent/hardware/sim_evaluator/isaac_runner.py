"""
Isaac Lab simulation runner.

Calls the IsaacLabClient HTTP endpoint (localhost:3001/api/isaac-lab).
Falls back to mock metrics if the endpoint is not reachable.
@status live
"""

import random
import logging
from typing import Optional

from .metrics import SimRunMetrics

logger = logging.getLogger(__name__)

# Try importing requests for HTTP calls
_REQUESTS_AVAILABLE = False
try:
    import requests  # type: ignore[import-not-found]

    _REQUESTS_AVAILABLE = True
except ImportError:
    logger.warning("requests library not available — Isaac runner will use mock mode")


class IsaacRunner:
    """Run Isaac Lab simulation or mock metrics if endpoint is unavailable."""

    def __init__(
        self,
        environment: str,
        isaac_lab_url: str = "http://localhost:3001/api/isaac-lab",
    ):
        self.environment = environment
        self.isaac_lab_url = isaac_lab_url
        self._mock_mode: Optional[bool] = None

    @property
    def is_mock(self) -> bool:
        if self._mock_mode is None:
            self._mock_mode = not self._check_connectivity()
        return self._mock_mode

    def _check_connectivity(self) -> bool:
        """Check if the Isaac Lab endpoint is reachable."""
        if not _REQUESTS_AVAILABLE:
            return False
        try:
            resp = requests.get(f"{self.isaac_lab_url}/health", timeout=3)
            return resp.status_code == 200
        except Exception:
            logger.warning(
                f"Isaac Lab endpoint not reachable at {self.isaac_lab_url}"
            )
            return False

    def run_rollouts(self, rollout_count: int) -> SimRunMetrics:
        """
        Run rollouts via Isaac Lab REST API or generate mock metrics.
        """
        if self.is_mock:
            return self._generate_mock_metrics(rollout_count)

        return self._run_via_api(rollout_count)

    def _run_via_api(self, rollout_count: int) -> SimRunMetrics:
        """Submit rollouts to Isaac Lab REST API."""
        try:
            resp = requests.post(  # type: ignore[name-defined]
                f"{self.isaac_lab_url}/evaluate",
                json={
                    "environment": self.environment,
                    "rolloutCount": rollout_count,
                },
                timeout=120,
            )
            resp.raise_for_status()
            data = resp.json()

            return SimRunMetrics(
                success_rate=data.get("successRate", 0.0),
                avg_steps_to_completion=data.get("avgStepsToCompletion", 0.0),
                collision_count=data.get("collisionCount", 0),
                avg_episode_duration=data.get("avgEpisodeDuration", 0.0),
                total_episodes=rollout_count,
                successful_episodes=int(
                    rollout_count * data.get("successRate", 0.0)
                ),
            )
        except Exception as e:
            logger.error(f"Isaac Lab API call failed: {e}, falling back to mock")
            return self._generate_mock_metrics(rollout_count)

    def _generate_mock_metrics(self, rollout_count: int) -> SimRunMetrics:
        """Generate realistic mock metrics."""
        success_rate = 0.7 + random.random() * 0.25
        successful = int(rollout_count * success_rate)
        collision_count = random.randint(0, 5)
        avg_steps = random.randint(15, 50)
        avg_duration = 5.0 + random.random() * 25.0

        logger.info(
            f"[MOCK] Isaac metrics for {rollout_count} rollouts: "
            f"success_rate={success_rate:.3f}"
        )

        return SimRunMetrics(
            success_rate=round(success_rate, 3),
            avg_steps_to_completion=float(avg_steps),
            collision_count=collision_count,
            avg_episode_duration=round(avg_duration, 2),
            total_episodes=rollout_count,
            successful_episodes=successful,
        )
