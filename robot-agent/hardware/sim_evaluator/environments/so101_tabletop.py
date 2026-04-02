"""
SO-101 Tabletop environment configuration.

Defines the simulation environment for tabletop manipulation tasks
with the SO-101 robot arm.
"""

import os

_MJCF_DIR = os.path.join(os.path.dirname(__file__), "..", "mjcf")

SO101_TABLETOP_CONFIG = {
    "id": "so101_tabletop",
    "name": "SO-101 Tabletop",
    "description": "Tabletop manipulation environment for SO-101 robot arm with common objects",
    "backend": "mujoco",
    "mjcf_path": os.path.join(_MJCF_DIR, "so101_tabletop_scene.xml"),
    "workspace_bounds": {
        "x_min": -0.3,
        "x_max": 0.3,
        "y_min": -0.3,
        "y_max": 0.3,
        "z_min": 0.0,
        "z_max": 0.4,
    },
    "objects": [
        {"type": "cube", "size": 0.04, "color": "red"},
    ],
    "camera": {
        "position": [0.0, -0.45, 0.45],
        "target": [0.0, 0.0, 0.15],
        "fov": 60,
    },
    "physics": {
        "timestep": 0.002,
        "gravity": [0.0, 0.0, -9.81],
        "friction": 1.0,
    },
    "episode": {
        "max_steps": 200,
        "success_threshold": 0.05,  # meters to target
    },
}
