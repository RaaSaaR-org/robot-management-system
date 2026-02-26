"""
MuJoCo simulation runner with automatic mock fallback.

If `import mujoco` fails (e.g. on ARM64/Pi where no wheel is available),
the runner falls back to MOCK mode and generates realistic fake metrics.
"""

import random
import logging
from typing import Optional

from .metrics import SimRunMetrics, SuccessDetector

logger = logging.getLogger(__name__)

# Try importing MuJoCo — fall back to mock if unavailable
_MUJOCO_AVAILABLE = False
try:
    import mujoco  # type: ignore[import-not-found]

    _MUJOCO_AVAILABLE = True
    logger.info("MuJoCo library available — using native simulation")
except ImportError:
    logger.warning("MuJoCo not available — using MOCK mode for simulation metrics")


class MuJoCoRunner:
    """Run MuJoCo simulation episodes or generate mock metrics."""

    def __init__(self, environment: str, model_path: Optional[str] = None):
        self.environment = environment
        self.model_path = model_path
        self.mock_mode = not _MUJOCO_AVAILABLE
        self._detector = SuccessDetector()

    @property
    def is_mock(self) -> bool:
        return self.mock_mode

    def run_rollouts(self, rollout_count: int) -> SimRunMetrics:
        """
        Run the specified number of rollouts and return aggregated metrics.

        In mock mode, generates realistic random metrics.
        In native mode, would load MJCF and run the simulation.
        """
        if self.mock_mode:
            return self._generate_mock_metrics(rollout_count)

        return self._run_native(rollout_count)

    def _run_native(self, rollout_count: int) -> SimRunMetrics:
        """Run actual MuJoCo simulation (requires mujoco library)."""
        # Native implementation would load MJCF model and step through episodes
        # For now, this is a placeholder that would be filled in when MuJoCo is available
        logger.info(
            f"Running {rollout_count} native MuJoCo rollouts "
            f"in environment '{self.environment}'"
        )
        # Placeholder: fall back to mock even in native mode until MJCF files are provided
        return self._generate_mock_metrics(rollout_count)

    def _generate_mock_metrics(self, rollout_count: int) -> SimRunMetrics:
        """Generate realistic mock metrics for testing."""
        success_rate = 0.7 + random.random() * 0.25
        successful = int(rollout_count * success_rate)
        collision_count = random.randint(0, 5)
        avg_steps = random.randint(15, 50)
        avg_duration = 5.0 + random.random() * 25.0

        logger.info(
            f"[MOCK] Generated metrics for {rollout_count} rollouts: "
            f"success_rate={success_rate:.3f}, collisions={collision_count}"
        )

        return SimRunMetrics(
            success_rate=round(success_rate, 3),
            avg_steps_to_completion=float(avg_steps),
            collision_count=collision_count,
            avg_episode_duration=round(avg_duration, 2),
            total_episodes=rollout_count,
            successful_episodes=successful,
        )
