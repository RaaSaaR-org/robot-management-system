"""
Metrics dataclasses for simulation evaluation results.
@status live
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SimRunMetrics:
    """Metrics from a single simulation run or aggregated across episodes."""

    success_rate: float = 0.0
    avg_steps_to_completion: float = 0.0
    collision_count: int = 0
    avg_episode_duration: float = 0.0
    sim_to_real_gap: Optional[float] = None
    total_episodes: int = 0
    successful_episodes: int = 0

    def to_dict(self) -> dict:
        return {
            "successRate": self.success_rate,
            "avgStepsToCompletion": self.avg_steps_to_completion,
            "collisionCount": self.collision_count,
            "avgEpisodeDuration": self.avg_episode_duration,
            "simToRealGap": self.sim_to_real_gap,
            "totalEpisodes": self.total_episodes,
            "successfulEpisodes": self.successful_episodes,
        }


@dataclass
class SuccessDetector:
    """Configurable success detection for simulation episodes."""

    target_position_threshold: float = 0.05  # meters
    max_allowed_collisions: int = 3
    max_episode_steps: int = 200

    def check_success(
        self,
        final_distance: float,
        collisions: int,
        steps: int,
    ) -> bool:
        """Check if an episode was successful based on thresholds."""
        if final_distance > self.target_position_threshold:
            return False
        if collisions > self.max_allowed_collisions:
            return False
        if steps >= self.max_episode_steps:
            return False
        return True
