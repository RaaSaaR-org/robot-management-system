"""
SO-101 Tabletop environment configuration.

Defines the simulation environment for tabletop manipulation tasks
with the SO-101 robot arm.
"""

SO101_TABLETOP_CONFIG = {
    "id": "so101_tabletop",
    "name": "SO-101 Tabletop",
    "description": "Tabletop manipulation environment for SO-101 robot arm with common objects",
    "backend": "mujoco",
    "mjcf_path": "assets/so101_tabletop.xml",  # Placeholder path
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
        {"type": "cylinder", "radius": 0.02, "height": 0.06, "color": "blue"},
        {"type": "sphere", "radius": 0.03, "color": "green"},
    ],
    "camera": {
        "position": [0.0, -0.5, 0.5],
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
