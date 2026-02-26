"""
Simulation evaluator package for MuJoCo/Isaac Lab policy testing.

Provides runners for different simulation backends with automatic mock
fallback when native libraries are not available (e.g. on ARM64/Pi).
"""

from .mujoco_runner import MuJoCoRunner
from .isaac_runner import IsaacRunner
from .metrics import SimRunMetrics, SuccessDetector

__all__ = ["MuJoCoRunner", "IsaacRunner", "SimRunMetrics", "SuccessDetector"]
