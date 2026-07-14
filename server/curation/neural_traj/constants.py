"""Shared constants for the neural-trajectory generator (TASK-182)."""
from __future__ import annotations

# Target embodiment: Unitree G1 EDU (29 DoF) + Dex3-1 hands.
# 28-dim action/state = 14 arm joints (2x7) + 14 hand joints (2x7).
ROBOT_TYPE = "Unitree_G1_Dex3"
STATE_DIM = 28
ACTION_DIM = 28
FPS = 30

# Single camera stream matching the G1 teleop recordings.
VIDEO_KEY = "observation.images.cam_right_high"

CODEBASE_VERSION = "v2.1"
CHUNK_SIZE = 1000
DATASET_SUBDIR = "lerobot_neural_g1"

# World model of the DreamGen recipe (post-trained video WM + IDM labels).
MODEL_NAME = "GR00T-Dreams/Cosmos-Predict2-2B"

DEFAULT_PROMPTS = [
    "Pick up the red cube and place it in the box.",
    "Grasp the bottle with the right hand and hand it over to the left hand.",
    "Open the drawer, take out the tool, and put it on the table.",
]
