"""
@file g1_env.py
@description Gymnasium environment wrapping MuJoCo for the Unitree G1 (29 DOF)
    inside a twin-derived room scene.

Mirrors envs/so101_tabletop_env.py but for the 29-DOF humanoid: 29 actuators,
a 58-dim proprioception state (29 joint positions + 29 velocities), a 224x224
head-camera-resolution RGB image, and a navigation-style reward (negative
distance from the pelvis XY to `goal_site`). The scene normally comes from a
digital twin via scene_builder.write_scene; if no scene_path is given we fall
back to the bundled mjcf/g1/g1_empty_scene.xml so the env is runnable for tests.

MuJoCo is imported lazily-guarded (mirroring mujoco_runner.py): the class is
always importable, but constructing it without mujoco raises a clear error.

@status live
"""

from __future__ import annotations

import logging
from pathlib import Path

import gymnasium as gym
import numpy as np
from gymnasium import spaces

logger = logging.getLogger(__name__)

# MuJoCo availability guard — mirrors mujoco_runner.py so this module imports
# even when mujoco is absent (e.g. ARM64/Pi); construction then raises.
_MUJOCO_AVAILABLE = False
try:
    import mujoco  # type: ignore[import-not-found]

    _MUJOCO_AVAILABLE = True
except ImportError:
    logger.warning("MuJoCo not available — G1Env can be imported but not constructed")

# Canonical 29-joint order (matches g1.yaml proprioception.joint_names and the
# actuator order in mjcf/g1/g1_29dof.xml).
JOINT_NAMES = [
    # Left leg
    "left_hip_pitch_joint",
    "left_hip_roll_joint",
    "left_hip_yaw_joint",
    "left_knee_joint",
    "left_ankle_pitch_joint",
    "left_ankle_roll_joint",
    # Right leg
    "right_hip_pitch_joint",
    "right_hip_roll_joint",
    "right_hip_yaw_joint",
    "right_knee_joint",
    "right_ankle_pitch_joint",
    "right_ankle_roll_joint",
    # Waist
    "waist_yaw_joint",
    "waist_roll_joint",
    "waist_pitch_joint",
    # Left arm
    "left_shoulder_pitch_joint",
    "left_shoulder_roll_joint",
    "left_shoulder_yaw_joint",
    "left_elbow_joint",
    "left_wrist_roll_joint",
    "left_wrist_pitch_joint",
    "left_wrist_yaw_joint",
    # Right arm
    "right_shoulder_pitch_joint",
    "right_shoulder_roll_joint",
    "right_shoulder_yaw_joint",
    "right_elbow_joint",
    "right_wrist_roll_joint",
    "right_wrist_pitch_joint",
    "right_wrist_yaw_joint",
]

N_JOINTS = len(JOINT_NAMES)  # 29

# Bundled standalone fallback scene (floor + G1 + goal_site).
_MJCF_DIR = Path(__file__).resolve().parent.parent / "mjcf"
_DEFAULT_SCENE = _MJCF_DIR / "g1" / "g1_empty_scene.xml"

# head_camera resolution from g1.yaml.
_RENDER_WIDTH = 224
_RENDER_HEIGHT = 224

# Physics: 500 Hz physics / 25 Hz control => 20 sub-steps per action.
_N_SUBSTEPS = 20

_MAX_STEPS = 400
_SUCCESS_THRESHOLD = 0.3  # meters (pelvis XY to goal)
_FALL_Z = 0.4  # pelvis z below this => fallen


class G1Env(gym.Env):
    """Unitree G1 navigation/reach environment inside a twin room.

    Observation space:
        - image: RGB (224, 224, 3) from the head camera
        - state: 58-dim [29 joint positions, 29 joint velocities]

    Action space:
        - 29-dim position targets for the actuators (radians)

    Reward: negative XY distance from the pelvis to `goal_site` (progress).
    terminated on reaching the goal (within success_threshold) or falling.
    """

    metadata = {"render_modes": ["rgb_array"], "render_fps": 25}

    def __init__(
        self,
        render_mode: str = "rgb_array",
        scene_path: str | Path | None = None,
        max_steps: int = _MAX_STEPS,
        success_threshold: float = _SUCCESS_THRESHOLD,
        obs_mode: str = "rgb_state",
    ):
        super().__init__()
        if not _MUJOCO_AVAILABLE:
            raise RuntimeError(
                "G1Env requires MuJoCo, which is not installed. Install `mujoco>=3.0` "
                "or run via the mock-fallback runners (mujoco_runner.py)."
            )

        if obs_mode not in ("rgb_state", "state"):
            raise ValueError(
                f"obs_mode must be 'rgb_state' or 'state', got {obs_mode!r}"
            )
        # obs_mode == 'state' is the sim-RL training path (TASK-172.C): it skips
        # rendering entirely so SubprocVecEnv workers never build a GL context —
        # the dominant per-step cost and a headless-Mac crash source. The 58-dim
        # proprioception state is still produced; NavObsWrapper turns it into the
        # 61-dim goal-relative nav observation. 'rgb_state' (default) is unchanged
        # and byte-identical to the historical behaviour.
        self.obs_mode = obs_mode

        self.render_mode = render_mode
        self.max_steps = max_steps
        self.success_threshold = success_threshold
        self._step_count = 0

        # A G1 scene normally comes from a twin; fall back to the bundled empty
        # scene so the env is runnable standalone.
        scene = Path(scene_path) if scene_path else _DEFAULT_SCENE
        if not scene.exists():
            raise FileNotFoundError(
                f"G1 MJCF scene not found: {scene}. A G1 scene must come from a "
                f"twin (scene_builder.write_scene) or the bundled "
                f"g1/g1_empty_scene.xml fallback."
            )

        self.model = mujoco.MjModel.from_xml_path(str(scene))
        self.data = mujoco.MjData(self.model)
        # Only build the GL renderer when images are actually consumed. In
        # 'state' mode (training) this is skipped: each SubprocVecEnv worker would
        # otherwise open its own GL context.
        self.renderer = (
            mujoco.Renderer(self.model, _RENDER_HEIGHT, _RENDER_WIDTH)
            if self.obs_mode == "rgb_state"
            else None
        )

        # Joint qpos/qvel addresses, looked up by name.
        self._joint_qpos_indices: list[int] = []
        self._joint_qvel_indices: list[int] = []
        for name in JOINT_NAMES:
            jid = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, name)
            if jid == -1:
                raise ValueError(f"Joint '{name}' not found in MJCF {scene.name}")
            self._joint_qpos_indices.append(int(self.model.jnt_qposadr[jid]))
            self._joint_qvel_indices.append(int(self.model.jnt_dofadr[jid]))

        # Pelvis (freejoint root body) for pose / fall checks.
        self._pelvis_body_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_BODY, "pelvis"
        )
        if self._pelvis_body_id == -1:
            raise ValueError("Body 'pelvis' not found in G1 MJCF")

        # Goal site (navigation target).
        self._goal_site_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_SITE, "goal_site"
        )
        if self._goal_site_id == -1:
            raise ValueError("Site 'goal_site' not found in scene MJCF")

        # Camera: prefer a head_camera, fall back to front, fall back to default.
        self._camera = "head_camera"
        if mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_CAMERA, "head_camera") == -1:
            self._camera = (
                "front"
                if mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_CAMERA, "front") != -1
                else -1
            )

        # Action space from the 29 actuator ctrl ranges (order = canonical).
        if self.model.nu < N_JOINTS:
            raise ValueError(
                f"Scene has {self.model.nu} actuators, expected >= {N_JOINTS} (G1)"
            )
        ctrl_low = self.model.actuator_ctrlrange[:N_JOINTS, 0].copy()
        ctrl_high = self.model.actuator_ctrlrange[:N_JOINTS, 1].copy()
        self.action_space = spaces.Box(
            low=ctrl_low.astype(np.float32),
            high=ctrl_high.astype(np.float32),
            dtype=np.float32,
        )

        # Observation: head-camera image (rgb_state only) + 58-dim proprioception.
        state_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(2 * N_JOINTS,),
            dtype=np.float32,
        )
        if self.obs_mode == "rgb_state":
            self.observation_space = spaces.Dict(
                {
                    "image": spaces.Box(
                        low=0,
                        high=255,
                        shape=(_RENDER_HEIGHT, _RENDER_WIDTH, 3),
                        dtype=np.uint8,
                    ),
                    "state": state_space,
                }
            )
        else:
            self.observation_space = spaces.Dict({"state": state_space})

        # Home pose = zeros (neutral standing).
        self._home_qpos = np.zeros(N_JOINTS, dtype=np.float64)
        self._pelvis_qpos_adr = int(self.model.jnt_qposadr[0])  # freejoint is jnt 0
        self._spawn_z = float(self.model.body_pos[self._pelvis_body_id][2]) or 0.793

        logger.info(
            "G1Env initialized: scene=%s, action_dim=%d, state_dim=%d, "
            "render=%dx%d, camera=%s",
            scene.name,
            self.action_space.shape[0],
            2 * N_JOINTS,
            _RENDER_WIDTH,
            _RENDER_HEIGHT,
            self._camera,
        )

    # ------------------------------------------------------------------ reset
    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self._step_count = 0

        mujoco.mj_resetData(self.model, self.data)

        # Home joint pose.
        for i, idx in enumerate(self._joint_qpos_indices):
            self.data.qpos[idx] = self._home_qpos[i]

        # Place the pelvis (freejoint) above the floor at the spawn point.
        adr = self._pelvis_qpos_adr
        self.data.qpos[adr + 0] = 0.0  # x
        self.data.qpos[adr + 1] = 0.0  # y
        self.data.qpos[adr + 2] = self._spawn_z  # z (standing height)
        self.data.qpos[adr + 3] = 1.0  # quat w
        self.data.qpos[adr + 4] = 0.0  # quat x
        self.data.qpos[adr + 5] = 0.0  # quat y
        self.data.qpos[adr + 6] = 0.0  # quat z

        mujoco.mj_forward(self.model, self.data)

        obs = self._get_obs()
        info = self._get_info()
        return obs, info

    # ------------------------------------------------------------------- step
    def step(self, action):
        self._step_count += 1

        action = np.asarray(action, dtype=np.float64)
        action = np.clip(
            action,
            self.model.actuator_ctrlrange[:N_JOINTS, 0],
            self.model.actuator_ctrlrange[:N_JOINTS, 1],
        )
        self.data.ctrl[:N_JOINTS] = action

        for _ in range(_N_SUBSTEPS):
            mujoco.mj_step(self.model, self.data)

        obs = self._get_obs()
        info = self._get_info()

        pelvis_xy = self._get_pelvis_xy()
        goal_xy = self._get_goal_xy()
        distance = float(np.linalg.norm(pelvis_xy - goal_xy))
        pelvis_z = float(self.data.xpos[self._pelvis_body_id][2])

        reward = -distance
        reached = distance < self.success_threshold
        fallen = pelvis_z < _FALL_Z

        terminated = bool(reached or fallen)
        truncated = self._step_count >= self.max_steps
        success = bool(reached and not fallen)

        info["success"] = success
        info["distance"] = distance
        info["steps"] = self._step_count
        info["collision_count"] = self._count_collisions()
        info["fallen"] = fallen
        info["pelvis_z"] = pelvis_z

        return obs, float(reward), terminated, truncated, info

    # ----------------------------------------------------------------- render
    def render(self):
        if self.renderer is None:
            raise RuntimeError(
                "render() called on a 'state'-mode G1Env (no GL renderer was "
                "built). Construct with obs_mode='rgb_state' to capture frames."
            )
        if self._camera == -1:
            self.renderer.update_scene(self.data)
        else:
            self.renderer.update_scene(self.data, camera=self._camera)
        return self.renderer.render()

    def capture_frame(self) -> np.ndarray:
        """Render an RGB frame on demand, lazily building a renderer if needed.

        For the eval gate, which steps in ``obs_mode='state'`` (so ``_get_obs``
        does not render every step — most frames are discarded by
        ``NavObsWrapper``) but still wants periodic frames for the UI. Unlike
        ``render()``, which deliberately raises in ``'state'`` mode to catch
        training-time misuse (a GL context must never be created in a
        SubprocVecEnv worker), this is the explicit opt-in capture path: only the
        single-process gate ever calls it.
        """
        if self.renderer is None:
            self.renderer = mujoco.Renderer(self.model, _RENDER_HEIGHT, _RENDER_WIDTH)
        if self._camera == -1:
            self.renderer.update_scene(self.data)
        else:
            self.renderer.update_scene(self.data, camera=self._camera)
        return self.renderer.render()

    def close(self):
        if hasattr(self, "renderer") and self.renderer is not None:
            self.renderer.close()
            self.renderer = None

    # ----------------------------------------------------------------- internals
    def _get_obs(self):
        pos = np.array(
            [self.data.qpos[idx] for idx in self._joint_qpos_indices],
            dtype=np.float32,
        )
        vel = np.array(
            [self.data.qvel[idx] for idx in self._joint_qvel_indices],
            dtype=np.float32,
        )
        state = np.concatenate([pos, vel]).astype(np.float32)
        if self.obs_mode == "state":
            return {"state": state}
        return {"image": self.render(), "state": state}

    def _get_info(self):
        return {
            "pelvis_xy": self._get_pelvis_xy().tolist(),
            "goal_xy": self._get_goal_xy().tolist(),
            "steps": self._step_count,
        }

    def _get_pelvis_xy(self) -> np.ndarray:
        return self.data.xpos[self._pelvis_body_id][:2].copy()

    def _get_goal_xy(self) -> np.ndarray:
        return self.data.site_xpos[self._goal_site_id][:2].copy()

    def _count_collisions(self) -> int:
        """Count contacts that involve the floor's exclusion partner — i.e. any
        robot-to-environment contact above the feet. Cheap heuristic: count
        contacts whose normal force exceeds a small threshold and that are not
        foot-floor. We approximate by counting non-floor contacts."""
        floor_geom_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_GEOM, "floor"
        )
        count = 0
        for i in range(self.data.ncon):
            c = self.data.contact[i]
            if floor_geom_id in (c.geom1, c.geom2):
                continue  # floor contacts (feet) are expected, not collisions
            count += 1
        return count
