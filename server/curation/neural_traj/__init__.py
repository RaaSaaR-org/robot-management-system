"""TASK-182 — DreamGen-style neural-trajectory synthetic data generator.

Second generator mode alongside ``cosmos3_synth.py`` (forward dynamics):
instead of action-conditioned rollouts on a WidowX bridge embodiment, this
package produces *language-prompted* neural trajectories for the Unitree G1
EDU + Dex3-1 target embodiment (28-dim = 14 arm + 14 hand joints) following
the DreamGen recipe (post-trained video world model + IDM pseudo-labels).

Backends:
  mock   Deterministic, GPU-free generator (real mp4 + smooth 28-dim
         random-walk trajectories) so the whole RMS job pipeline
         (generate -> convert -> register -> dataset visible) is testable
         today without a GPU.
  wsl    Real GR00T-dreams pipeline in WSL2 (TASK-182 stages 1-3): one episode
         per invocation of ``76_dreams_one_episode.sh`` (Cosmos-Predict2-2B LoRA
         + IDM). Needs the GPU stack + post-trained checkpoints, so it is
         unavailable on the mock-only dev box.

Run as a module with cwd = server/curation:
  python -m neural_traj --out OUT --backend mock generate --episodes 2
  python -m neural_traj --out OUT convert
"""
from __future__ import annotations

from .constants import (
    CODEBASE_VERSION,
    DATASET_SUBDIR,
    DEFAULT_PROMPTS,
    FPS,
    MODEL_NAME,
    ROBOT_TYPE,
    STATE_DIM,
    VIDEO_KEY,
)
from .errors import NeuralTrajError

__all__ = [
    "CODEBASE_VERSION",
    "DATASET_SUBDIR",
    "DEFAULT_PROMPTS",
    "FPS",
    "MODEL_NAME",
    "NeuralTrajError",
    "ROBOT_TYPE",
    "STATE_DIM",
    "VIDEO_KEY",
]
