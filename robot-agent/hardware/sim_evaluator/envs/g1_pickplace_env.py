"""
@file g1_pickplace_env.py
@description Gymnasium environment for the fixed-base Unitree G1 EDU + Dex3-1
    tabletop pick-place task ("g1_pickplace"): put the dark bottle into the
    yellow crate on the table.

Mirrors envs/g1_env.py structurally but implements the SHARED WS contract for
the n187_real_only_14k GR00T checkpoint:
  * obs["state"]  : 28-dim float32 joint POSITIONS (radians) — arms(14) then
    hands(14) in the Unitree_G1_Dex3 dataset order (note the REAL left/right
    Dex3 finger asymmetry, see HAND_JOINT_NAMES).
  * obs["image"]  : (480, 640, 3) uint8 RGB from the torso-mounted
    `head_camera` (the policy's single "cam_right_high" view).
  * action        : 28-dim ABSOLUTE joint-position targets, same order,
    clipped to each actuator's ctrlrange. Legs + waist actuators held at 0
    (the base is fixed; the include keeps all 43 position actuators).
  * control rate  : 16 mj_step sub-steps @ 0.002 s = 31.25 Hz (training data
    is 30 fps).

Success: bottle CENTER inside the crate-interior box (SUCCESS_BOX_*).
Failure termination: bottle z < 0.5 (fell off the table).

MuJoCo is imported lazily-guarded (mirrors g1_env.py): the module always
imports; construction without mujoco raises a clear error.

@status live
"""

from __future__ import annotations

import logging
from pathlib import Path

import gymnasium as gym
import numpy as np
from gymnasium import spaces

logger = logging.getLogger(__name__)

_MUJOCO_AVAILABLE = False
try:
    import mujoco  # type: ignore[import-not-found]

    _MUJOCO_AVAILABLE = True
except ImportError:
    logger.warning(
        "MuJoCo not available — G1PickPlaceEnv can be imported but not constructed"
    )

# --------------------------------------------------------------------- contract
# Dataset joint order (Unitree_G1_Dex3): "arms" = 14 (left 7 then right 7).
ARM_JOINT_NAMES = [
    "left_shoulder_pitch_joint",
    "left_shoulder_roll_joint",
    "left_shoulder_yaw_joint",
    "left_elbow_joint",
    "left_wrist_roll_joint",
    "left_wrist_pitch_joint",
    "left_wrist_yaw_joint",
    "right_shoulder_pitch_joint",
    "right_shoulder_roll_joint",
    "right_shoulder_yaw_joint",
    "right_elbow_joint",
    "right_wrist_roll_joint",
    "right_wrist_pitch_joint",
    "right_wrist_yaw_joint",
]

# "hands" = 14. The LEFT/RIGHT ordering asymmetry is REAL — it comes from
# unitree_lerobot G1_DEX3_CONFIG (left: thumb,middle,index / right:
# thumb,index,middle). Do not "fix" it.
HAND_JOINT_NAMES = [
    # left Dex3
    "left_hand_thumb_0_joint",
    "left_hand_thumb_1_joint",
    "left_hand_thumb_2_joint",
    "left_hand_middle_0_joint",
    "left_hand_middle_1_joint",
    "left_hand_index_0_joint",
    "left_hand_index_1_joint",
    # right Dex3 (thumb, INDEX, MIDDLE — asymmetric on purpose)
    "right_hand_thumb_0_joint",
    "right_hand_thumb_1_joint",
    "right_hand_thumb_2_joint",
    "right_hand_index_0_joint",
    "right_hand_index_1_joint",
    "right_hand_middle_0_joint",
    "right_hand_middle_1_joint",
]

POLICY_JOINT_NAMES = ARM_JOINT_NAMES + HAND_JOINT_NAMES
N_POLICY_JOINTS = len(POLICY_JOINT_NAMES)  # 28

# Success box = crate interior (world frame), from the Isaac g1_pickplace scene.
SUCCESS_BOX_X = (0.28, 0.96)
SUCCESS_BOX_Y = (0.24, 0.57)
SUCCESS_BOX_Z = (0.81, 0.90)
CRATE_CENTER_XY = (
    (SUCCESS_BOX_X[0] + SUCCESS_BOX_X[1]) / 2.0,  # 0.62
    (SUCCESS_BOX_Y[0] + SUCCESS_BOX_Y[1]) / 2.0,  # 0.405
)

# Bottle fell off the table below this z => episode failure.
BOTTLE_FALL_Z = 0.5

# Bottle spawn (bottom rests just above the tabletop; settles to center
# z ~= 0.924) with +/- this much uniform xy jitter on reset.
BOTTLE_SPAWN_XY = (-0.35, 0.40)
BOTTLE_SPAWN_Z = 0.929
BOTTLE_JITTER = 0.05

# Environment geometry geoms that count as collisions when touched by the robot.
_ENV_GEOM_NAMES = (
    "floor",
    "table",
    "crate_floor",
    "crate_wall_xneg",
    "crate_wall_xpos",
    "crate_wall_yneg",
    "crate_wall_ypos",
)

_MJCF_DIR = Path(__file__).resolve().parent.parent / "mjcf"
_DEFAULT_SCENE = _MJCF_DIR / "g1_dex3_pickplace_scene.xml"

# Policy camera: native dataset resolution (cam_right_high is 480x640 RGB).
_RENDER_WIDTH = 640
_RENDER_HEIGHT = 480

# 16 sub-steps @ 0.002 s => 31.25 Hz control (training data is 30 fps).
_N_SUBSTEPS = 16

# Settle batches on reset (30 x 16 sub-steps = 0.96 s sim time).
_N_SETTLE_BATCHES = 30

_MAX_STEPS = 400


class G1PickPlaceEnv(gym.Env):
    """Fixed-base G1+Dex3 tabletop pick-place (bottle -> crate).

    Observation space:
        - image: RGB (480, 640, 3) uint8 from `head_camera`
        - state: 28-dim float32 joint positions (POLICY_JOINT_NAMES order)

    Action space:
        - 28-dim absolute joint-position targets (radians), same order.
    """

    metadata = {"render_modes": ["rgb_array"], "render_fps": 31}

    def __init__(
        self,
        render_mode: str = "rgb_array",
        scene_path: str | Path | None = None,
        max_steps: int = _MAX_STEPS,
    ):
        super().__init__()
        if not _MUJOCO_AVAILABLE:
            raise RuntimeError(
                "G1PickPlaceEnv requires MuJoCo, which is not installed. "
                "Install `mujoco>=3.0`."
            )

        self.render_mode = render_mode
        self.max_steps = max_steps
        self._step_count = 0

        scene = Path(scene_path) if scene_path else _DEFAULT_SCENE
        if not scene.exists():
            raise FileNotFoundError(
                f"G1 pick-place MJCF scene not found: {scene}. Expected the "
                f"bundled mjcf/g1_dex3_pickplace_scene.xml."
            )

        self.model = mujoco.MjModel.from_xml_path(str(scene))
        self.data = mujoco.MjData(self.model)
        self.renderer = mujoco.Renderer(self.model, _RENDER_HEIGHT, _RENDER_WIDTH)

        # Resolve the 28 policy joints + their actuators BY NAME. Hard-fail
        # with the full missing list so a model/scene mismatch is obvious.
        missing = [
            n
            for n in POLICY_JOINT_NAMES
            if mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, n) == -1
        ]
        missing += [
            f"{n} (actuator)"
            for n in POLICY_JOINT_NAMES
            if mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_ACTUATOR, n) == -1
        ]
        if missing:
            raise ValueError(
                "G1PickPlaceEnv: scene is missing required joints/actuators "
                f"(dataset order Unitree_G1_Dex3): {missing}"
            )

        self._joint_qpos_indices: list[int] = []
        self._actuator_ids: list[int] = []
        for name in POLICY_JOINT_NAMES:
            jid = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, name)
            self._joint_qpos_indices.append(int(self.model.jnt_qposadr[jid]))
            self._actuator_ids.append(
                mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_ACTUATOR, name)
            )
        self._actuator_ids_np = np.asarray(self._actuator_ids, dtype=np.intp)
        self._ctrl_low = self.model.actuator_ctrlrange[self._actuator_ids_np, 0].copy()
        self._ctrl_high = self.model.actuator_ctrlrange[self._actuator_ids_np, 1].copy()

        # Non-policy actuators (legs + waist) are held at 0.
        self._held_actuator_ids = np.asarray(
            [i for i in range(self.model.nu) if i not in set(self._actuator_ids)],
            dtype=np.intp,
        )

        # Bottle freejoint qpos address + body id.
        bottle_jid = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_JOINT, "bottle_freejoint"
        )
        if bottle_jid == -1:
            raise ValueError("Joint 'bottle_freejoint' not found in scene MJCF")
        self._bottle_qpos_adr = int(self.model.jnt_qposadr[bottle_jid])
        self._bottle_body_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_BODY, "bottle"
        )

        # Camera.
        if mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_CAMERA, "head_camera") == -1:
            raise ValueError("Camera 'head_camera' not found in scene MJCF")
        self._camera = "head_camera"

        # Collision bookkeeping: robot geoms = geoms of bodies in the pelvis
        # subtree; env geoms = table/crate/floor. Bottle contacts never count.
        pelvis_body_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_BODY, "pelvis"
        )
        if pelvis_body_id == -1:
            raise ValueError("Body 'pelvis' not found in scene MJCF")
        robot_bodies = self._subtree_body_ids(pelvis_body_id)
        self._robot_geom_ids = {
            g
            for g in range(self.model.ngeom)
            if int(self.model.geom_bodyid[g]) in robot_bodies
        }
        # The fixed base pose (z=0.76 vs the 0.793 free-standing height) leaves
        # the foot spheres permanently ~3 cm inside the floor — a scene
        # artifact, not a policy collision. Exclude ankle_roll (foot) geoms
        # from the collision METRIC only (physics is unaffected).
        for b in robot_bodies:
            bname = mujoco.mj_id2name(self.model, mujoco.mjtObj.mjOBJ_BODY, b) or ""
            if "ankle_roll" in bname:
                for g in range(self.model.ngeom):
                    if int(self.model.geom_bodyid[g]) == b:
                        self._robot_geom_ids.discard(g)
        self._env_geom_ids = set()
        for gname in _ENV_GEOM_NAMES:
            gid = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_GEOM, gname)
            if gid != -1:
                self._env_geom_ids.add(gid)

        self.action_space = spaces.Box(
            low=self._ctrl_low.astype(np.float32),
            high=self._ctrl_high.astype(np.float32),
            dtype=np.float32,
        )
        self.observation_space = spaces.Dict(
            {
                "image": spaces.Box(
                    low=0,
                    high=255,
                    shape=(_RENDER_HEIGHT, _RENDER_WIDTH, 3),
                    dtype=np.uint8,
                ),
                "state": spaces.Box(
                    low=-np.inf,
                    high=np.inf,
                    shape=(N_POLICY_JOINTS,),
                    dtype=np.float32,
                ),
            }
        )

        logger.info(
            "G1PickPlaceEnv initialized: scene=%s, action_dim=%d, state_dim=%d, "
            "render=%dx%d, camera=%s",
            scene.name,
            N_POLICY_JOINTS,
            N_POLICY_JOINTS,
            _RENDER_WIDTH,
            _RENDER_HEIGHT,
            self._camera,
        )

    def _subtree_body_ids(self, root: int) -> set[int]:
        ids = {root}
        for b in range(root + 1, self.model.nbody):
            if int(self.model.body_parentid[b]) in ids:
                ids.add(b)
        return ids

    # ------------------------------------------------------------------ reset
    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self._step_count = 0

        mujoco.mj_resetData(self.model, self.data)

        # All joints default 0 after reset (fixed base, zero home pose).
        # Bottle: spawn upright with +/- BOTTLE_JITTER xy jitter. At the zero
        # pose the LEFT Dex3 fingertips sit at world (-0.30, 0.41, 0.83-0.88),
        # i.e. inside the jitter region — a spawn overlapping the hand gets
        # knocked over during settling. Resample jitters that start in contact
        # with the robot (the nominal spawn itself is contact-free).
        adr = self._bottle_qpos_adr
        bottle_geom_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_GEOM, "bottle_geom"
        )
        for _attempt in range(20):
            jitter = np.random.uniform(-BOTTLE_JITTER, BOTTLE_JITTER, size=2)
            self.data.qpos[adr + 0] = BOTTLE_SPAWN_XY[0] + jitter[0]
            self.data.qpos[adr + 1] = BOTTLE_SPAWN_XY[1] + jitter[1]
            self.data.qpos[adr + 2] = BOTTLE_SPAWN_Z
            self.data.qpos[adr + 3 : adr + 7] = (1.0, 0.0, 0.0, 0.0)
            self.data.qvel[:] = 0.0
            mujoco.mj_forward(self.model, self.data)
            touches_robot = any(
                bottle_geom_id in (int(c.geom1), int(c.geom2))
                and (
                    int(c.geom1) in self._robot_geom_ids
                    or int(c.geom2) in self._robot_geom_ids
                )
                for c in [self.data.contact[i] for i in range(self.data.ncon)]
            )
            if not touches_robot:
                break
        else:
            # Fall back to the contact-free nominal spawn.
            self.data.qpos[adr + 0] = BOTTLE_SPAWN_XY[0]
            self.data.qpos[adr + 1] = BOTTLE_SPAWN_XY[1]
            self.data.qpos[adr + 2] = BOTTLE_SPAWN_Z
            self.data.qpos[adr + 3 : adr + 7] = (1.0, 0.0, 0.0, 0.0)
            self.data.qvel[:] = 0.0
            mujoco.mj_forward(self.model, self.data)

        # Hold everything at 0 and let the bottle settle onto the table.
        self.data.ctrl[:] = 0.0
        for _ in range(_N_SETTLE_BATCHES * _N_SUBSTEPS):
            mujoco.mj_step(self.model, self.data)

        obs = self._get_obs()
        info = self._get_info()
        return obs, info

    # ------------------------------------------------------------------- step
    def step(self, action):
        self._step_count += 1

        action = np.asarray(action, dtype=np.float64).reshape(-1)
        if action.shape[0] != N_POLICY_JOINTS:
            raise ValueError(
                f"Expected {N_POLICY_JOINTS}-dim action, got shape {action.shape}"
            )
        action = np.clip(action, self._ctrl_low, self._ctrl_high)
        self.data.ctrl[self._actuator_ids_np] = action
        self.data.ctrl[self._held_actuator_ids] = 0.0

        for _ in range(_N_SUBSTEPS):
            mujoco.mj_step(self.model, self.data)

        obs = self._get_obs()
        info = self._get_info()

        bottle = info["bottle_pos"]
        success = info["success"]
        fell = bottle[2] < BOTTLE_FALL_Z

        reward = 1.0 if success else -info["distance"]
        terminated = bool(success or fell)
        truncated = self._step_count >= self.max_steps

        info["fell"] = bool(fell)
        info["steps"] = self._step_count

        return obs, float(reward), terminated, truncated, info

    # ----------------------------------------------------------------- render
    def render(self):
        self.renderer.update_scene(self.data, camera=self._camera)
        return self.renderer.render()

    def close(self):
        if getattr(self, "renderer", None) is not None:
            self.renderer.close()
            self.renderer = None

    # -------------------------------------------------------------- internals
    def _get_obs(self):
        state = self.data.qpos[self._joint_qpos_indices].astype(np.float32)
        return {"image": self.render(), "state": state}

    def _bottle_pos(self) -> np.ndarray:
        return self.data.xpos[self._bottle_body_id].copy()

    def _is_success(self, bottle: np.ndarray) -> bool:
        return bool(
            SUCCESS_BOX_X[0] <= bottle[0] <= SUCCESS_BOX_X[1]
            and SUCCESS_BOX_Y[0] <= bottle[1] <= SUCCESS_BOX_Y[1]
            and SUCCESS_BOX_Z[0] <= bottle[2] <= SUCCESS_BOX_Z[1]
        )

    def _get_info(self):
        bottle = self._bottle_pos()
        distance = float(
            np.hypot(bottle[0] - CRATE_CENTER_XY[0], bottle[1] - CRATE_CENTER_XY[1])
        )
        return {
            "success": self._is_success(bottle),
            "collision_count": self._count_collisions(),
            "distance": distance,
            "bottle_pos": bottle.tolist(),
        }

    def _count_collisions(self) -> int:
        """Contacts where one geom is a ROBOT geom and the other is
        table/crate/floor. Bottle-anything and hand-bottle contacts do not
        count (they are the task, not collisions)."""
        count = 0
        for i in range(self.data.ncon):
            c = self.data.contact[i]
            g1, g2 = int(c.geom1), int(c.geom2)
            if (g1 in self._robot_geom_ids and g2 in self._env_geom_ids) or (
                g2 in self._robot_geom_ids and g1 in self._env_geom_ids
            ):
                count += 1
        return count
