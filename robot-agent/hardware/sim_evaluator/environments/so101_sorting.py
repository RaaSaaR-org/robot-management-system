"""
SO-101 Sorting environment configuration.

Defines the simulation environment for object sorting tasks
with the SO-101 robot arm and color-coded bins.
@status live
"""

SO101_SORTING_CONFIG = {
    "id": "so101_sorting",
    "name": "SO-101 Sorting",
    "description": "Object sorting task environment for SO-101 with color-coded bins",
    "backend": "mujoco",
    "mjcf_path": "assets/so101_sorting.xml",  # Placeholder path
    "workspace_bounds": {
        "x_min": -0.4,
        "x_max": 0.4,
        "y_min": -0.3,
        "y_max": 0.3,
        "z_min": 0.0,
        "z_max": 0.4,
    },
    "bins": [
        {"id": "bin_red", "color": "red", "position": [-0.25, 0.15, 0.0]},
        {"id": "bin_blue", "color": "blue", "position": [0.0, 0.15, 0.0]},
        {"id": "bin_green", "color": "green", "position": [0.25, 0.15, 0.0]},
    ],
    "objects": [
        {"type": "cube", "size": 0.03, "color": "red", "spawn_zone": "center"},
        {"type": "cube", "size": 0.03, "color": "blue", "spawn_zone": "center"},
        {"type": "cube", "size": 0.03, "color": "green", "spawn_zone": "center"},
        {"type": "cylinder", "radius": 0.015, "height": 0.04, "color": "red", "spawn_zone": "center"},
        {"type": "cylinder", "radius": 0.015, "height": 0.04, "color": "blue", "spawn_zone": "center"},
    ],
    "camera": {
        "position": [0.0, -0.6, 0.6],
        "target": [0.0, 0.0, 0.1],
        "fov": 65,
    },
    "physics": {
        "timestep": 0.002,
        "gravity": [0.0, 0.0, -9.81],
        "friction": 1.0,
    },
    "episode": {
        "max_steps": 300,
        "success_threshold": 0.04,  # all objects in correct bins
        "partial_reward": True,  # reward per correctly sorted object
    },
}
