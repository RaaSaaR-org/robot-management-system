"""
@file g1_apple_env.py
@description Gymnasium environment for the fixed-base Unitree G1 EDU + Dex3-1
    apple-to-plate task ("g1_apple_pnp"): move the red apple onto the white
    plate on the black-tablecloth table — replicating the NVIDIA GR00T E2E
    apple workflow (nvidia/GR00T-N1.7-AppleToPlate).

Mirrors envs/g1_pickplace_env.py structurally but implements the 43-state /
31-action contract of C:\\Unitree\\_data\\apple_pnp\\CONTRACT.md
(meta/modality.json of the AppleToPlate dataset):
  * obs["state"]  : 43-dim float32 joint POSITIONS (radians) in the dataset
    layout [left_leg 0:6 | right_leg 6:12 | waist 12:15 | left_arm 15:22 |
    right_arm 22:29 | left_hand 29:36 | right_hand 36:43]. Hands use the
    Unitree Dex3 SDK enumeration with the REAL left/right asymmetry (left:
    thumb,middle,index / right: thumb,index,middle — verified against the
    dataset's min/max ranges vs the model's joint limits; do not "fix" it).
  * obs["image"]  : (480, 640, 3) uint8 RGB from the scene-level `ego_camera`
    (the dataset's single head-mounted D435 `ego_view`), passed through a
    camera-realism stage (blur + affine color match vs real dataset frames +
    sensor noise; disable via G1_APPLE_RAW_RENDER=1) so the real-data-only
    policy sees in-distribution image statistics.
  * action        : 31-dim ABSOLUTE joint-position targets
    [L-arm 7 | R-arm 7 | L-hand 7 | R-hand 7 | waist 3], clipped to each
    actuator's ctrlrange. Leg actuators are held at their initial standing
    pose every step (legs are never commanded; the base is fixed).
  * control rate  : 16 mj_step sub-steps @ 0.002 s = 31.25 Hz (training data
    is 30 fps).

Success (NVIDIA sim parity): apple geom in CONTACT with the plate geom AND
apple linear speed < 0.1 m/s. Failure termination: apple z < 0.5 (fell off
the table).

MuJoCo is imported lazily-guarded (mirrors g1_pickplace_env.py): the module
always imports; construction without mujoco raises a clear error.

@status live
"""

from __future__ import annotations

import logging
from pathlib import Path

import os

import gymnasium as gym
import numpy as np
from gymnasium import spaces
from PIL import Image, ImageFilter

logger = logging.getLogger(__name__)

_MUJOCO_AVAILABLE = False
try:
    import mujoco  # type: ignore[import-not-found]

    _MUJOCO_AVAILABLE = True
except ImportError:
    logger.warning(
        "MuJoCo not available — G1ApplePnPEnv can be imported but not constructed"
    )

# --------------------------------------------------------------------- contract
# meta/modality.json state layout, 43-dim. Leg order per side is the standard
# G1 29-DoF SDK order: hip_pitch, hip_roll, hip_yaw, knee, ankle_pitch,
# ankle_roll. Waist is SDK indices 12,13,14 = yaw, roll, pitch.
LEFT_LEG_JOINT_NAMES = [
    "left_hip_pitch_joint",
    "left_hip_roll_joint",
    "left_hip_yaw_joint",
    "left_knee_joint",
    "left_ankle_pitch_joint",
    "left_ankle_roll_joint",
]
RIGHT_LEG_JOINT_NAMES = [
    "right_hip_pitch_joint",
    "right_hip_roll_joint",
    "right_hip_yaw_joint",
    "right_knee_joint",
    "right_ankle_pitch_joint",
    "right_ankle_roll_joint",
]
WAIST_JOINT_NAMES = [
    "waist_yaw_joint",
    "waist_roll_joint",
    "waist_pitch_joint",
]
LEFT_ARM_JOINT_NAMES = [
    "left_shoulder_pitch_joint",
    "left_shoulder_roll_joint",
    "left_shoulder_yaw_joint",
    "left_elbow_joint",
    "left_wrist_roll_joint",
    "left_wrist_pitch_joint",
    "left_wrist_yaw_joint",
]
RIGHT_ARM_JOINT_NAMES = [
    "right_shoulder_pitch_joint",
    "right_shoulder_roll_joint",
    "right_shoulder_yaw_joint",
    "right_elbow_joint",
    "right_wrist_roll_joint",
    "right_wrist_pitch_joint",
    "right_wrist_yaw_joint",
]
# Dex3 SDK enumeration. The LEFT/RIGHT ordering asymmetry is REAL (left:
# thumb,middle,index / right: thumb,index,middle — unitree_lerobot
# G1_DEX3_CONFIG). Verified against the AppleToPlate dataset: left-hand dims
# 3..6 are negative-only (matches the model's left middle/index ranges
# [-1.57,0]/[-1.75,0]) and right-hand dims 3..6 positive-only. Do not "fix" it.
LEFT_HAND_JOINT_NAMES = [
    "left_hand_thumb_0_joint",
    "left_hand_thumb_1_joint",
    "left_hand_thumb_2_joint",
    "left_hand_middle_0_joint",
    "left_hand_middle_1_joint",
    "left_hand_index_0_joint",
    "left_hand_index_1_joint",
]
RIGHT_HAND_JOINT_NAMES = [
    "right_hand_thumb_0_joint",
    "right_hand_thumb_1_joint",
    "right_hand_thumb_2_joint",
    "right_hand_index_0_joint",
    "right_hand_index_1_joint",
    "right_hand_middle_0_joint",
    "right_hand_middle_1_joint",
]

# 43-dim STATE layout (observation only — legs are read, never commanded).
STATE_JOINT_NAMES = (
    LEFT_LEG_JOINT_NAMES
    + RIGHT_LEG_JOINT_NAMES
    + WAIST_JOINT_NAMES
    + LEFT_ARM_JOINT_NAMES
    + RIGHT_ARM_JOINT_NAMES
    + LEFT_HAND_JOINT_NAMES
    + RIGHT_HAND_JOINT_NAMES
)
N_STATE_JOINTS = len(STATE_JOINT_NAMES)  # 43

# 31-dim ACTION layout: [L-arm 7 | R-arm 7 | L-hand 7 | R-hand 7 | waist 3]
# (contract: policy action keys left_arm, right_arm, left_hand, right_hand,
# waist flattened in this order; navigate/base_height/efforts are ignored).
ACTION_JOINT_NAMES = (
    LEFT_ARM_JOINT_NAMES
    + RIGHT_ARM_JOINT_NAMES
    + LEFT_HAND_JOINT_NAMES
    + RIGHT_HAND_JOINT_NAMES
    + WAIST_JOINT_NAMES
)
N_ACTION_JOINTS = len(ACTION_JOINT_NAMES)  # 31

LEG_JOINT_NAMES = LEFT_LEG_JOINT_NAMES + RIGHT_LEG_JOINT_NAMES

# Fallback reset pose for the COMMANDED joints (ACTION_JOINT_NAMES
# order: [L-arm 7 | R-arm 7 | L-hand 7 | R-hand 7 | waist 3]) — the mean t=0
# state of the first 50 AppleToPlate episodes. Real episodes never start from
# the zero home pose (arms hang OUT of the ego frame), and the policy's arm
# actions are RELATIVE (decoded against submitted state), so the sim must
# start in-distribution. NOTE: by default reset() now samples an ACTUAL
# episode t=0 pose from apple_start_poses.json (see below) — the mean of many
# distinct start poses is itself a pose no demo ever visited, and the policy
# can freeze there (near-zero relative deltas = fixed point). This constant
# remains as fallback when the JSON is missing.
INIT_ACTION_POSE = np.array(
    [
        # left_arm: sh_pitch, sh_roll, sh_yaw, elbow, wr_roll, wr_pitch, wr_yaw
        -0.372, 0.764, 0.620, 1.199, -0.547, -0.611, 0.024,
        # right_arm
        -0.736, -0.619, -0.268, 1.183, 0.134, 0.355, 0.247,
        # left_hand (thumb0..2, middle0/1, index0/1)
        -0.054, 0.072, 0.068, -0.068, -0.057, -0.067, -0.082,
        # right_hand (thumb0..2, index0/1, middle0/1)
        -0.022, 0.050, -0.058, 0.059, 0.042, 0.048, 0.058,
        # waist: yaw, roll, pitch
        -0.122, 0.005, -0.002,
    ]
)

# Real per-episode t=0 poses sampled evenly from the 402 AppleToPlate
# episodes' parquet observation.state[0]. Each entry: {"action": 31 dims in
# ACTION_JOINT_NAMES order, "legs": 12 dims in LEG_JOINT_NAMES order}.
# reset() picks one via the seeded RNG so every episode starts from a pose
# the policy has actually seen demos start from — INCLUDING the legs: the
# real standing legs are far from zero (knee ~1.0 rad, hip pitch ~-0.5) and
# they are part of the 43-dim state the policy conditions on; holding them
# at the model home pose (all zeros) is state the policy has never seen.
_START_POSES_PATH = Path(__file__).resolve().parent / "apple_start_poses.json"
try:
    import json as _json

    START_POSES: list[dict] | None = [
        {
            "action": np.asarray(p["action"], dtype=np.float64),
            "legs": np.asarray(p["legs"], dtype=np.float64),
        }
        for p in _json.loads(_START_POSES_PATH.read_text())
    ]
except (OSError, ValueError, KeyError, TypeError):
    logger.warning("apple_start_poses.json missing/invalid — falling back to mean pose")
    START_POSES = None

# Success: apple geom touching the plate geom AND apple slower than this
# (NVIDIA sim parity, CONTRACT.md).
APPLE_SUCCESS_SPEED = 0.1

# ... AND resting ON TOP of the plate, not leaning against its rim: apple
# center resting on the plate top (z=0.77) is ~0.806; resting on the cloth
# beside the plate is ~0.786. The FK-true layout puts the apple ~2 cm from
# the rim, so a side-nudge into the rim must not count as success.
APPLE_ON_PLATE_MIN_Z = 0.795

# Apple fell off the table below this z => episode failure.
APPLE_FALL_Z = 0.5

# Apple spawn (bottom rests just above the tablecloth at z=0.75; settles to
# center z ~= 0.786) with +/- this much uniform xy jitter on reset.
# Position = mean left-fingertip centroid at the GRASP moment of 15 real
# episodes, FK'd through this model (scratchpad fk_grasp.py): the demos
# grasped at (-0.194, 0.396) +/- (0.05, 0.03) — the old spawn (-0.22, 0.46)
# sat 6 cm beyond every demo grasp and the policy reached short of it.
APPLE_SPAWN_XY = (-0.19, 0.40)
APPLE_SPAWN_Z = 0.789
APPLE_JITTER = 0.02

# Environment geometry geoms that count as collisions when touched by the robot.
_ENV_GEOM_NAMES = (
    "floor",
    "table",
    "plate",
)

_MJCF_DIR = Path(__file__).resolve().parent.parent / "mjcf"
_DEFAULT_SCENE = _MJCF_DIR / "g1_apple_pnp_scene.xml"

# Policy camera: native dataset resolution (ego_view is 480x640 RGB, D435).
_RENDER_WIDTH = 640
_RENDER_HEIGHT = 480

# ----------------------------------------------------- camera realism (Option A)
# The policy was finetuned exclusively on REAL D435 frames; raw rasterized
# renders are far out of distribution. Together with the textured scene
# (mjcf/textures/) this post-processing maps the render statistics onto the
# real ego_view statistics. Affine constants were fit per channel so the
# textured sim t=0 render's mean/std match the pooled t=0 frames of dataset
# episodes 0/50/100/200/300/401 (lifts blacks — the D435's washed
# low-contrast look). Disable via G1_APPLE_RAW_RENDER=1 or camera_realism=False.
_COLOR_GAIN = np.array([0.8515, 0.8725, 0.8987], dtype=np.float32)
_COLOR_BIAS = np.array([22.58, 19.63, 14.85], dtype=np.float32)
_BLUR_RADIUS = 0.7  # px — real optics are visibly softer than a rasterizer
_NOISE_STD = 2.5  # 8-bit counts of per-pixel Gaussian sensor noise

# 16 sub-steps @ 0.002 s => 31.25 Hz control (training data is 30 fps).
_N_SUBSTEPS = 16

# Settle batches on reset (30 x 16 sub-steps = 0.96 s sim time).
_N_SETTLE_BATCHES = 30

_MAX_STEPS = 600


class G1ApplePnPEnv(gym.Env):
    """Fixed-base G1+Dex3 tabletop apple-to-plate (NVIDIA GR00T E2E parity).

    Observation space:
        - image: RGB (480, 640, 3) uint8 from `ego_camera`
        - state: 43-dim float32 joint positions (STATE_JOINT_NAMES order)

    Action space:
        - 31-dim absolute joint-position targets (radians),
          ACTION_JOINT_NAMES order. Legs are held at their initial pose.
    """

    metadata = {"render_modes": ["rgb_array"], "render_fps": 31}

    def __init__(
        self,
        render_mode: str = "rgb_array",
        scene_path: str | Path | None = None,
        max_steps: int = _MAX_STEPS,
        camera_realism: bool | None = None,
    ):
        super().__init__()
        if not _MUJOCO_AVAILABLE:
            raise RuntimeError(
                "G1ApplePnPEnv requires MuJoCo, which is not installed. "
                "Install `mujoco>=3.0`."
            )

        self.render_mode = render_mode
        self.max_steps = max_steps
        self._step_count = 0
        # Camera realism defaults ON (the policy only knows real frames);
        # G1_APPLE_RAW_RENDER=1 or camera_realism=False restores raw renders.
        if camera_realism is None:
            camera_realism = os.environ.get("G1_APPLE_RAW_RENDER", "0") != "1"
        self.camera_realism = bool(camera_realism)

        scene = Path(scene_path) if scene_path else _DEFAULT_SCENE
        if not scene.exists():
            raise FileNotFoundError(
                f"G1 apple-to-plate MJCF scene not found: {scene}. Expected the "
                f"bundled mjcf/g1_apple_pnp_scene.xml."
            )

        self.model = mujoco.MjModel.from_xml_path(str(scene))
        self.data = mujoco.MjData(self.model)
        self.renderer = mujoco.Renderer(self.model, _RENDER_HEIGHT, _RENDER_WIDTH)

        # Resolve all 43 state joints (and the 31 commanded actuators + 12
        # held leg actuators) BY NAME. Hard-fail with the full missing list so
        # a model/scene mismatch is obvious.
        missing = [
            n
            for n in STATE_JOINT_NAMES
            if mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, n) == -1
        ]
        missing += [
            f"{n} (actuator)"
            for n in ACTION_JOINT_NAMES + LEG_JOINT_NAMES
            if mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_ACTUATOR, n) == -1
        ]
        if missing:
            raise ValueError(
                "G1ApplePnPEnv: scene is missing required joints/actuators "
                f"(AppleToPlate modality.json order): {missing}"
            )

        self._state_qpos_indices: list[int] = []
        for name in STATE_JOINT_NAMES:
            jid = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, name)
            self._state_qpos_indices.append(int(self.model.jnt_qposadr[jid]))

        self._actuator_ids = [
            mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_ACTUATOR, name)
            for name in ACTION_JOINT_NAMES
        ]
        self._action_qpos_indices = [
            int(
                self.model.jnt_qposadr[
                    mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, name)
                ]
            )
            for name in ACTION_JOINT_NAMES
        ]
        self._actuator_ids_np = np.asarray(self._actuator_ids, dtype=np.intp)
        self._ctrl_low = self.model.actuator_ctrlrange[self._actuator_ids_np, 0].copy()
        self._ctrl_high = self.model.actuator_ctrlrange[self._actuator_ids_np, 1].copy()

        # Leg actuators are held at the initial standing pose every step
        # (captured on reset — legs are never commanded, CONTRACT.md).
        self._leg_actuator_ids = np.asarray(
            [
                mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_ACTUATOR, name)
                for name in LEG_JOINT_NAMES
            ],
            dtype=np.intp,
        )
        self._leg_qpos_indices = [
            int(
                self.model.jnt_qposadr[
                    mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, name)
                ]
            )
            for name in LEG_JOINT_NAMES
        ]
        self._leg_hold = np.zeros(len(LEG_JOINT_NAMES))

        # Apple freejoint qpos/dof addresses + body/geom ids.
        apple_jid = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_JOINT, "apple_freejoint"
        )
        if apple_jid == -1:
            raise ValueError("Joint 'apple_freejoint' not found in scene MJCF")
        self._apple_qpos_adr = int(self.model.jnt_qposadr[apple_jid])
        self._apple_dof_adr = int(self.model.jnt_dofadr[apple_jid])
        self._apple_body_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_BODY, "apple"
        )
        self._apple_geom_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_GEOM, "apple"
        )
        if self._apple_geom_id == -1:
            raise ValueError("Geom 'apple' not found in scene MJCF")
        self._plate_geom_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_GEOM, "plate"
        )
        if self._plate_geom_id == -1:
            raise ValueError("Geom 'plate' not found in scene MJCF")
        self._plate_center_xy = self.model.geom_pos[self._plate_geom_id, :2].copy()

        # Camera: the scene-level ego camera (dataset `ego_view` match). The
        # robot include's head_camera (fovy 89, aimed at the old crate) is NOT
        # used.
        if mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_CAMERA, "ego_camera") == -1:
            raise ValueError("Camera 'ego_camera' not found in scene MJCF")
        self._camera = "ego_camera"

        # Collision bookkeeping: robot geoms = geoms of bodies in the pelvis
        # subtree; env geoms = floor/table/plate. Apple contacts never count.
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
        # The fixed base pose (z=0.76 vs the 0.793 free-standing height) puts
        # the foot region at/inside the floor — a scene artifact, not a policy
        # collision (the scene also contact-EXCLUDES ankle<->world pairs so the
        # artifact cannot bend the legs). Exclude all ankle (foot) geoms from
        # the collision METRIC, mirroring g1_pickplace_env.py's intent.
        for b in robot_bodies:
            bname = mujoco.mj_id2name(self.model, mujoco.mjtObj.mjOBJ_BODY, b) or ""
            if "ankle" in bname:
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
                    shape=(N_STATE_JOINTS,),
                    dtype=np.float32,
                ),
            }
        )

        logger.info(
            "G1ApplePnPEnv initialized: scene=%s, action_dim=%d, state_dim=%d, "
            "render=%dx%d, camera=%s",
            scene.name,
            N_ACTION_JOINTS,
            N_STATE_JOINTS,
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

        # Whole-body start = a REAL episode's t=0 state (seed-deterministic
        # pick from apple_start_poses.json; fallback: dataset-mean
        # INIT_ACTION_POSE with home-pose legs) — qpos AND actuator targets,
        # so the position actuators hold the pose from the first sub-step.
        # Legs are held at their (real) start values for the whole episode.
        if START_POSES is not None:
            picked = START_POSES[int(self.np_random.integers(len(START_POSES)))]
            pose = picked["action"]
            self.data.qpos[self._leg_qpos_indices] = picked["legs"]
        else:
            pose = INIT_ACTION_POSE
        self._leg_hold = self.data.qpos[self._leg_qpos_indices].copy()
        init_pose = np.clip(pose, self._ctrl_low, self._ctrl_high)
        self.data.qpos[self._action_qpos_indices] = init_pose

        # Apple: spawn with +/- APPLE_JITTER xy jitter. Resample jitters that
        # start in contact with the robot (the nominal spawn is contact-free;
        # at the zero pose the LEFT Dex3 fingertips hover near the spawn) or
        # with the PLATE (the FK-true layout puts the apple ~2 cm from the
        # plate rim — a jittered spawn touching the plate would count as an
        # instant false success).
        adr = self._apple_qpos_adr
        for _attempt in range(20):
            jitter = self.np_random.uniform(-APPLE_JITTER, APPLE_JITTER, size=2)
            self.data.qpos[adr + 0] = APPLE_SPAWN_XY[0] + jitter[0]
            self.data.qpos[adr + 1] = APPLE_SPAWN_XY[1] + jitter[1]
            self.data.qpos[adr + 2] = APPLE_SPAWN_Z
            self.data.qpos[adr + 3 : adr + 7] = (1.0, 0.0, 0.0, 0.0)
            self.data.qvel[:] = 0.0
            mujoco.mj_forward(self.model, self.data)
            touches_bad = any(
                self._apple_geom_id in (int(c.geom1), int(c.geom2))
                and (
                    int(c.geom1) in self._robot_geom_ids
                    or int(c.geom2) in self._robot_geom_ids
                    or self._plate_geom_id in (int(c.geom1), int(c.geom2))
                )
                for c in [self.data.contact[i] for i in range(self.data.ncon)]
            )
            if not touches_bad:
                break
        else:
            # Fall back to the contact-free nominal spawn.
            self.data.qpos[adr + 0] = APPLE_SPAWN_XY[0]
            self.data.qpos[adr + 1] = APPLE_SPAWN_XY[1]
            self.data.qpos[adr + 2] = APPLE_SPAWN_Z
            self.data.qpos[adr + 3 : adr + 7] = (1.0, 0.0, 0.0, 0.0)
            self.data.qvel[:] = 0.0
            mujoco.mj_forward(self.model, self.data)

        # Hold the initial pose and let the apple settle onto the cloth.
        self.data.ctrl[:] = 0.0
        self.data.ctrl[self._actuator_ids_np] = init_pose
        self.data.ctrl[self._leg_actuator_ids] = self._leg_hold
        for _ in range(_N_SETTLE_BATCHES * _N_SUBSTEPS):
            mujoco.mj_step(self.model, self.data)

        obs = self._get_obs()
        info = self._get_info()
        return obs, info

    # ------------------------------------------------------------------- step
    def step(self, action):
        self._step_count += 1

        action = np.asarray(action, dtype=np.float64).reshape(-1)
        if action.shape[0] != N_ACTION_JOINTS:
            raise ValueError(
                f"Expected {N_ACTION_JOINTS}-dim action "
                f"[L-arm 7 | R-arm 7 | L-hand 7 | R-hand 7 | waist 3], "
                f"got shape {action.shape}"
            )
        action = np.clip(action, self._ctrl_low, self._ctrl_high)
        self.data.ctrl[self._actuator_ids_np] = action
        # Legs are held at the initial standing pose every step.
        self.data.ctrl[self._leg_actuator_ids] = self._leg_hold

        for _ in range(_N_SUBSTEPS):
            mujoco.mj_step(self.model, self.data)

        obs = self._get_obs()
        info = self._get_info()

        apple = info["apple_pos"]
        success = info["success"]
        fell = apple[2] < APPLE_FALL_Z

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
    def _camera_realism(self, img: np.ndarray) -> np.ndarray:
        """Map a raw render onto the real D435 ego_view statistics:
        optics blur -> per-channel affine (fit vs real dataset frames) ->
        sensor noise (seeded via the env's np_random)."""
        soft = Image.fromarray(img).filter(ImageFilter.GaussianBlur(_BLUR_RADIUS))
        out = np.asarray(soft, dtype=np.float32) * _COLOR_GAIN + _COLOR_BIAS
        out += self.np_random.normal(0.0, _NOISE_STD, out.shape).astype(np.float32)
        return np.clip(out, 0.0, 255.0).astype(np.uint8)

    def _get_obs(self):
        state = self.data.qpos[self._state_qpos_indices].astype(np.float32)
        img = self.render()
        if self.camera_realism:
            img = self._camera_realism(img)
        return {"image": img, "state": state}

    def _apple_pos(self) -> np.ndarray:
        return self.data.xpos[self._apple_body_id].copy()

    def _apple_speed(self) -> float:
        """Linear speed of the apple freejoint (m/s)."""
        lin = self.data.qvel[self._apple_dof_adr : self._apple_dof_adr + 3]
        return float(np.linalg.norm(lin))

    def _apple_on_plate(self) -> bool:
        """True when the apple geom is in contact with the plate geom."""
        for i in range(self.data.ncon):
            c = self.data.contact[i]
            pair = (int(c.geom1), int(c.geom2))
            if self._apple_geom_id in pair and self._plate_geom_id in pair:
                return True
        return False

    def _get_info(self):
        apple = self._apple_pos()
        speed = self._apple_speed()
        distance = float(
            np.hypot(
                apple[0] - self._plate_center_xy[0],
                apple[1] - self._plate_center_xy[1],
            )
        )
        success = bool(
            self._apple_on_plate()
            and speed < APPLE_SUCCESS_SPEED
            and apple[2] > APPLE_ON_PLATE_MIN_Z
        )
        return {
            "success": success,
            "collision_count": self._count_collisions(),
            "distance": distance,
            "apple_pos": apple.tolist(),
            "apple_speed": speed,
        }

    def _count_collisions(self) -> int:
        """Contacts where one geom is a ROBOT geom and the other is
        floor/table/plate. Apple-anything and hand-apple contacts do not
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
