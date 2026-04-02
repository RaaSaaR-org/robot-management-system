"""
MuJoCo simulation runner with automatic mock fallback.

If MuJoCo or the gym environment is unavailable, the runner falls back to
MOCK mode and generates realistic fake metrics. When available, it runs
real physics episodes using the SO101TabletopEnv.
"""

import logging
import random
from typing import Optional

from .metrics import SimRunMetrics, SuccessDetector

logger = logging.getLogger(__name__)

# Try importing MuJoCo and the gym environment
_MUJOCO_AVAILABLE = False
try:
    import mujoco  # type: ignore[import-not-found]
    import numpy as np
    from .envs.so101_tabletop_env import SO101TabletopEnv

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
        In native mode, runs real MuJoCo physics episodes.
        """
        if self.mock_mode:
            return self._generate_mock_metrics(rollout_count)

        return self._run_native(rollout_count)

    def _run_native(self, rollout_count: int) -> SimRunMetrics:
        """Run actual MuJoCo simulation episodes (no VLA server — random actions).

        This is useful for testing the physics environment independently.
        For VLA-connected evaluation, use evaluate_vla.py instead.
        """
        logger.info(
            f"Running {rollout_count} native MuJoCo rollouts "
            f"in environment '{self.environment}'"
        )

        env = SO101TabletopEnv(max_steps=200)
        successful = 0
        total_steps = 0
        total_collisions = 0
        total_duration = 0.0
        successful_steps = []

        import time

        for ep in range(rollout_count):
            obs, info = env.reset()
            ep_steps = 0
            ep_collisions = 0
            t_start = time.time()

            for step in range(200):
                # Random action within actuator limits
                action = env.action_space.sample()
                obs, reward, terminated, truncated, info = env.step(action)
                ep_steps += 1
                ep_collisions += info.get("collision_count", 0)

                if terminated or truncated:
                    break

            duration = time.time() - t_start
            total_duration += duration
            total_steps += ep_steps
            total_collisions += ep_collisions

            if info.get("success", False):
                successful += 1
                successful_steps.append(ep_steps)

            if (ep + 1) % 10 == 0 or ep == 0:
                logger.info(
                    f"  Episode {ep + 1}/{rollout_count}: "
                    f"steps={ep_steps}, success={info.get('success', False)}"
                )

        env.close()

        success_rate = successful / rollout_count if rollout_count > 0 else 0.0
        avg_steps = (
            sum(successful_steps) / len(successful_steps)
            if successful_steps
            else float(200)
        )
        avg_duration = total_duration / rollout_count if rollout_count > 0 else 0.0

        logger.info(
            f"Native MuJoCo evaluation complete: "
            f"success_rate={success_rate:.3f}, "
            f"avg_steps={avg_steps:.1f}, "
            f"collisions={total_collisions}"
        )

        return SimRunMetrics(
            success_rate=round(success_rate, 3),
            avg_steps_to_completion=round(avg_steps, 1),
            collision_count=total_collisions,
            avg_episode_duration=round(avg_duration, 2),
            total_episodes=rollout_count,
            successful_episodes=successful,
        )

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
