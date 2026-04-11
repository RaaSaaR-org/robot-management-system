"""
@file so101_tabletop_env.py
@description Gymnasium environment wrapping MuJoCo for SO-101 tabletop manipulation.

Loads the SO-101 MJCF model on a table with a graspable cube and a target zone.
Provides offscreen rendering for VLA inference and standard gym step/reset API.
@status live
"""

import logging
from pathlib import Path

import gymnasium as gym
import mujoco
import numpy as np
from gymnasium import spaces

logger = logging.getLogger(__name__)

# Joint names matching the MJCF actuator order and VLA action space
JOINT_NAMES = [
    "shoulder_pan",
    "shoulder_lift",
    "elbow_flex",
    "wrist_flex",
    "wrist_roll",
    "gripper",
]

# Scene file relative to this module
_MJCF_DIR = Path(__file__).resolve().parent.parent / "mjcf"
_DEFAULT_SCENE = _MJCF_DIR / "so101_tabletop_scene.xml"

# Rendering
_RENDER_WIDTH = 640
_RENDER_HEIGHT = 480

# Physics: 500 Hz physics / 5 Hz control = 100 sub-steps per action
_N_SUBSTEPS = 100

# Episode limits
_MAX_STEPS = 200
_SUCCESS_THRESHOLD = 0.05  # meters


class SO101TabletopEnv(gym.Env):
    """SO-101 tabletop manipulation environment.

    The robot must pick up a red cube and place it on the green target zone.

    Observation space:
        - image: RGB array (480, 640, 3) from the front camera
        - state: 6-dim joint positions in radians

    Action space:
        - 6-dim position targets for the actuators (radians)
    """

    metadata = {"render_modes": ["rgb_array"], "render_fps": 5}

    def __init__(
        self,
        render_mode: str = "rgb_array",
        scene_path: str | Path | None = None,
        max_steps: int = _MAX_STEPS,
        success_threshold: float = _SUCCESS_THRESHOLD,
    ):
        super().__init__()
        self.render_mode = render_mode
        self.max_steps = max_steps
        self.success_threshold = success_threshold
        self._step_count = 0

        # Load MuJoCo model
        scene = Path(scene_path) if scene_path else _DEFAULT_SCENE
        if not scene.exists():
            raise FileNotFoundError(f"MJCF scene not found: {scene}")

        self.model = mujoco.MjModel.from_xml_path(str(scene))
        self.data = mujoco.MjData(self.model)

        # Offscreen renderer
        self.renderer = mujoco.Renderer(self.model, _RENDER_HEIGHT, _RENDER_WIDTH)

        # Look up joint and body IDs
        self._joint_qpos_indices = []
        for name in JOINT_NAMES:
            jid = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, name)
            if jid == -1:
                raise ValueError(f"Joint '{name}' not found in MJCF")
            self._joint_qpos_indices.append(self.model.jnt_qposadr[jid])

        self._cube_body_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_BODY, "cube"
        )
        if self._cube_body_id == -1:
            raise ValueError("Body 'cube' not found in MJCF")

        self._target_site_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_SITE, "target_site"
        )

        self._cube_geom_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_GEOM, "cube_geom"
        )

        # Action space from actuator ctrl ranges
        ctrl_low = self.model.actuator_ctrlrange[:6, 0].copy()
        ctrl_high = self.model.actuator_ctrlrange[:6, 1].copy()
        self.action_space = spaces.Box(
            low=ctrl_low.astype(np.float32),
            high=ctrl_high.astype(np.float32),
            dtype=np.float32,
        )

        # Observation space
        self.observation_space = spaces.Dict(
            {
                "image": spaces.Box(
                    low=0, high=255, shape=(_RENDER_HEIGHT, _RENDER_WIDTH, 3), dtype=np.uint8
                ),
                "state": spaces.Box(
                    low=-np.pi, high=np.pi, shape=(6,), dtype=np.float32
                ),
            }
        )

        # Home joint positions (neutral resting pose)
        self._home_qpos = np.zeros(6, dtype=np.float64)

        logger.info(
            f"SO101TabletopEnv initialized: scene={scene.name}, "
            f"action_dim={self.action_space.shape[0]}, "
            f"render={_RENDER_WIDTH}x{_RENDER_HEIGHT}"
        )

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self._step_count = 0

        # Reset MuJoCo state
        mujoco.mj_resetData(self.model, self.data)

        # Set robot to home pose
        for i, idx in enumerate(self._joint_qpos_indices):
            self.data.qpos[idx] = self._home_qpos[i]

        # Randomize cube position on the table
        cube_jnt_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_JOINT, "cube_joint"
        )
        cube_qpos_adr = self.model.jnt_qposadr[cube_jnt_id]

        if self.np_random is not None:
            cx = self.np_random.uniform(0.08, 0.2)
            cy = self.np_random.uniform(-0.08, 0.08)
        else:
            cx, cy = 0.15, 0.0

        self.data.qpos[cube_qpos_adr] = cx       # x
        self.data.qpos[cube_qpos_adr + 1] = cy   # y
        self.data.qpos[cube_qpos_adr + 2] = 0.025  # z (on table)
        # Quaternion identity (w, x, y, z)
        self.data.qpos[cube_qpos_adr + 3] = 1.0
        self.data.qpos[cube_qpos_adr + 4] = 0.0
        self.data.qpos[cube_qpos_adr + 5] = 0.0
        self.data.qpos[cube_qpos_adr + 6] = 0.0

        # Forward kinematics
        mujoco.mj_forward(self.model, self.data)

        obs = self._get_obs()
        info = self._get_info()
        return obs, info

    def step(self, action):
        self._step_count += 1

        # Clip action to actuator range
        action = np.clip(
            action,
            self.model.actuator_ctrlrange[:6, 0],
            self.model.actuator_ctrlrange[:6, 1],
        )

        # Apply action to actuators
        self.data.ctrl[:6] = action

        # Step physics
        for _ in range(_N_SUBSTEPS):
            mujoco.mj_step(self.model, self.data)

        obs = self._get_obs()
        info = self._get_info()

        # Compute reward and termination
        cube_pos = self._get_cube_pos()
        target_pos = self._get_target_pos()
        distance = np.linalg.norm(cube_pos - target_pos)

        reward = -distance  # negative distance as reward
        terminated = distance < self.success_threshold
        truncated = self._step_count >= self.max_steps

        info["success"] = terminated
        info["cube_distance"] = float(distance)
        info["collision_count"] = self._count_cube_collisions()
        info["steps"] = self._step_count

        return obs, float(reward), terminated, truncated, info

    def render(self):
        """Render the front camera view as an RGB array."""
        self.renderer.update_scene(self.data, camera="front")
        return self.renderer.render()

    def close(self):
        if hasattr(self, "renderer") and self.renderer is not None:
            self.renderer.close()
            self.renderer = None

    def _get_obs(self):
        """Build observation dict with image and joint state."""
        image = self.render()
        state = np.array(
            [self.data.qpos[idx] for idx in self._joint_qpos_indices],
            dtype=np.float32,
        )
        return {"image": image, "state": state}

    def _get_info(self):
        """Build info dict with cube and target positions."""
        cube_pos = self._get_cube_pos()
        target_pos = self._get_target_pos()
        return {
            "cube_pos": cube_pos.tolist(),
            "target_pos": target_pos.tolist(),
            "steps": self._step_count,
        }

    def _get_cube_pos(self) -> np.ndarray:
        """Get cube world position from body xpos."""
        return self.data.xpos[self._cube_body_id].copy()

    def _get_target_pos(self) -> np.ndarray:
        """Get target site world position."""
        return self.data.site_xpos[self._target_site_id].copy()

    def _count_cube_collisions(self) -> int:
        """Count contacts involving the cube geom (excluding table)."""
        count = 0
        table_geom_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_GEOM, "table_top"
        )
        for i in range(self.data.ncon):
            contact = self.data.contact[i]
            geom1, geom2 = contact.geom1, contact.geom2
            if self._cube_geom_id in (geom1, geom2):
                other = geom2 if geom1 == self._cube_geom_id else geom1
                # Don't count cube-table contact as collision
                if other != table_geom_id:
                    count += 1
        return count
