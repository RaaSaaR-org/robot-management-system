"""
@file g1_locomotion_env.py
@description MuJoCo locomotion env for the Unitree G1 (29 DOF) — the sim-to-sim
    counterpart of an Isaac Lab ``Isaac-Velocity-Flat-G1-v0`` policy.

This is deliberately a *separate* env from ``g1_env.G1Env`` (which is the
25 Hz, goal-relative *navigation* env). A locomotion (walking-gait) policy is
trained in Isaac Lab / PhysX and must be evaluated in a MuJoCo env whose physics
match Isaac's as closely as possible — different control rate, PD gains, and a
default standing pose. Sharing one class with the nav env would either regress
nav or accrete flags; keeping them separate keeps each honest.

What it matches to Isaac (all parametrized, carried in the policy manifest's
``control`` block so the trainer and gate agree — see ``locomotion_wrappers``):
  * **Control rate** — Isaac's velocity task steps the policy at 50 Hz (sim
    200 Hz / decimation 4). ``G1Env`` is 25 Hz. Here ``control_hz`` picks the
    sub-step count from the scene's physics timestep.
  * **PD gains** — the MJCF bakes ``kp=150 kv=5`` for every position actuator;
    Isaac uses per-joint stiffness/damping. ``pd_kp``/``pd_kv`` override the
    actuator gain/bias at load so the same position target yields Isaac's torque.
  * **Default joint pose** — Isaac initializes the G1 in a crouched stance and
    treats the policy action as an offset from it. The MJCF has no keyframe (home
    = zeros); ``default_joint_pos`` sets the reset pose and is the action offset.
  * **Base state** — a locomotion obs needs pelvis orientation and base linear/
    angular velocity, which the 29 joints do not carry. The freejoint (jnt 0)
    accessors below expose them (base-frame ang vel, projected gravity, base-frame
    lin vel), matching Isaac's ``base_ang_vel`` / ``projected_gravity`` /
    ``base_lin_vel`` observation terms.

MuJoCo is imported lazily-guarded (mirroring ``g1_env``): the class is always
importable (so the trainer host can import the layout constants without mujoco),
but constructing it without mujoco raises a clear error.

@status live
"""

from __future__ import annotations

import logging
from pathlib import Path

import gymnasium as gym
import numpy as np
from gymnasium import spaces

# Reuse the canonical 29-joint order + bundled scene from the nav env so the two
# envs never disagree on joint identity/order.
from .g1_env import (
    JOINT_NAMES,
    N_JOINTS,
    _DEFAULT_SCENE,
    _RENDER_HEIGHT,
    _RENDER_WIDTH,
)

logger = logging.getLogger(__name__)

_MUJOCO_AVAILABLE = False
try:
    import mujoco  # type: ignore[import-not-found]

    _MUJOCO_AVAILABLE = True
except ImportError:
    logger.warning(
        "MuJoCo not available — G1LocomotionEnv can be imported but not constructed"
    )

# Locomotion defaults (physics only; the observation contract lives in
# locomotion_wrappers). All overridable so the manifest's control block — filled
# from the real Isaac cfg on the GPU host — is authoritative.
_DEFAULT_CONTROL_HZ = 50.0
_MAX_STEPS = 1000
_FALL_Z = 0.5  # pelvis z below this => fallen (stricter than nav's 0.4)
_GRAVITY_HAT = np.array([0.0, 0.0, -1.0], dtype=np.float64)

# Per-episode reset jitter so N eval rollouts are not byte-identical (a
# deterministic policy in a deterministic sim otherwise makes simSuccessRate
# collapse to {0.0, 1.0}, giving the SimToRealValidation threshold no signal).
# Base jitter is YAW-only so the robot stays upright (projected gravity unchanged).
_JITTER = {"yaw": 0.1, "z": 0.02, "joint": 0.02}


class G1LocomotionEnv(gym.Env):
    """Unitree G1 locomotion env in a flat/twin MuJoCo scene.

    Action: 29-dim **position targets** (radians), canonical ``JOINT_NAMES``
    order — identical semantics to ``G1Env`` so the offset+scale mapping lives in
    the wrapper, not here. Observation: 29 joint pos + 29 joint vel (the wrapper
    augments this with base state + command into the Isaac policy obs).

    Reward is a placeholder (forward base velocity) — the gate scores
    ``info['success']`` written by the command wrapper, not reward.
    """

    metadata = {"render_modes": ["rgb_array"], "render_fps": 50}

    def __init__(
        self,
        render_mode: str = "rgb_array",
        scene_path: str | Path | None = None,
        max_steps: int = _MAX_STEPS,
        obs_mode: str = "state",
        *,
        control_hz: float = _DEFAULT_CONTROL_HZ,
        default_joint_pos: np.ndarray | None = None,
        pd_kp: np.ndarray | None = None,
        pd_kv: np.ndarray | None = None,
        fall_z: float = _FALL_Z,
        reset_jitter: bool = True,
    ):
        super().__init__()
        if not _MUJOCO_AVAILABLE:
            raise RuntimeError(
                "G1LocomotionEnv requires MuJoCo, which is not installed. Install "
                "`mujoco>=3.0` (only the gate host needs it; the Isaac trainer host "
                "imports the layout constants, which need no mujoco)."
            )
        if obs_mode not in ("rgb_state", "state"):
            raise ValueError(f"obs_mode must be 'rgb_state' or 'state', got {obs_mode!r}")

        self.obs_mode = obs_mode
        self.render_mode = render_mode
        self.max_steps = max_steps
        self.fall_z = float(fall_z)
        self.reset_jitter = bool(reset_jitter)
        self._step_count = 0

        scene = Path(scene_path) if scene_path else _DEFAULT_SCENE
        if not scene.exists():
            raise FileNotFoundError(
                f"G1 MJCF scene not found: {scene}. A G1 scene must come from a twin "
                f"(scene_builder.write_scene) or the bundled g1/g1_empty_scene.xml."
            )

        self.model = mujoco.MjModel.from_xml_path(str(scene))
        self.data = mujoco.MjData(self.model)
        self.renderer = (
            mujoco.Renderer(self.model, _RENDER_HEIGHT, _RENDER_WIDTH)
            if self.obs_mode == "rgb_state"
            else None
        )

        # Sub-steps per control step: hit control_hz from the scene's physics dt.
        physics_dt = float(self.model.opt.timestep)
        self._n_substeps = max(1, int(round((1.0 / float(control_hz)) / physics_dt)))
        self.control_hz = float(control_hz)

        # Joint qpos/qvel addresses in canonical order.
        self._joint_qpos_indices: list[int] = []
        self._joint_qvel_indices: list[int] = []
        for name in JOINT_NAMES:
            jid = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, name)
            if jid == -1:
                raise ValueError(f"Joint '{name}' not found in MJCF {scene.name}")
            self._joint_qpos_indices.append(int(self.model.jnt_qposadr[jid]))
            self._joint_qvel_indices.append(int(self.model.jnt_dofadr[jid]))

        self._pelvis_body_id = mujoco.mj_name2id(
            self.model, mujoco.mjtObj.mjOBJ_BODY, "pelvis"
        )
        if self._pelvis_body_id == -1:
            raise ValueError("Body 'pelvis' not found in G1 MJCF")

        # Freejoint (jnt 0) qpos/qvel addresses for the base pose + twist.
        self._pelvis_qpos_adr = int(self.model.jnt_qposadr[0])
        self._pelvis_qvel_adr = int(self.model.jnt_dofadr[0])
        self._spawn_z = float(self.model.body_pos[self._pelvis_body_id][2]) or 0.793

        if self.model.nu < N_JOINTS:
            raise ValueError(
                f"Scene has {self.model.nu} actuators, expected >= {N_JOINTS} (G1)"
            )
        self._ctrl_low = self.model.actuator_ctrlrange[:N_JOINTS, 0].copy()
        self._ctrl_high = self.model.actuator_ctrlrange[:N_JOINTS, 1].copy()
        self.action_space = spaces.Box(
            low=self._ctrl_low.astype(np.float32),
            high=self._ctrl_high.astype(np.float32),
            dtype=np.float32,
        )

        state_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(2 * N_JOINTS,), dtype=np.float32
        )
        if self.obs_mode == "rgb_state":
            self.observation_space = spaces.Dict(
                {
                    "image": spaces.Box(
                        low=0, high=255,
                        shape=(_RENDER_HEIGHT, _RENDER_WIDTH, 3), dtype=np.uint8,
                    ),
                    "state": state_space,
                }
            )
        else:
            self.observation_space = spaces.Dict({"state": state_space})

        # Default stance = action offset + reset pose (zeros unless Isaac's crouch
        # is supplied). Clipped to joint limits defensively.
        home = (
            np.zeros(N_JOINTS, dtype=np.float64)
            if default_joint_pos is None
            else np.asarray(default_joint_pos, dtype=np.float64)
        )
        if home.shape != (N_JOINTS,):
            raise ValueError(
                f"default_joint_pos must have shape ({N_JOINTS},), got {home.shape}"
            )
        self.default_joint_pos = np.clip(home, self._ctrl_low, self._ctrl_high)

        if pd_kp is not None or pd_kv is not None:
            self._apply_pd_gains(pd_kp, pd_kv)

        # Camera for on-demand frame capture (gate UI); optional.
        self._camera = "head_camera"
        if mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_CAMERA, "head_camera") == -1:
            self._camera = (
                "front"
                if mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_CAMERA, "front") != -1
                else -1
            )

        logger.info(
            "G1LocomotionEnv: scene=%s control_hz=%.1f substeps=%d gains=%s stance=%s",
            scene.name, self.control_hz, self._n_substeps,
            "isaac" if (pd_kp is not None or pd_kv is not None) else "mjcf",
            "crouch" if default_joint_pos is not None else "zeros",
        )

    # ------------------------------------------------------------------ gains
    def _apply_pd_gains(self, pd_kp, pd_kv) -> None:
        """Override the position actuators' PD gains to Isaac's stiffness/damping.

        A MuJoCo ``position`` actuator computes force = kp*(target - q) - kv*qdot
        via gainprm[0]=kp, biasprm[1]=-kp, biasprm[2]=-kv. Setting those per joint
        makes the same position target produce Isaac's torque.
        """
        kp = None if pd_kp is None else np.broadcast_to(np.asarray(pd_kp, float), (N_JOINTS,))
        kv = None if pd_kv is None else np.broadcast_to(np.asarray(pd_kv, float), (N_JOINTS,))
        for i in range(N_JOINTS):
            if kp is not None:
                self.model.actuator_gainprm[i, 0] = kp[i]
                self.model.actuator_biasprm[i, 1] = -kp[i]
            if kv is not None:
                self.model.actuator_biasprm[i, 2] = -kv[i]

    # ------------------------------------------------------------------ reset
    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self._step_count = 0
        mujoco.mj_resetData(self.model, self.data)

        for i, idx in enumerate(self._joint_qpos_indices):
            self.data.qpos[idx] = self.default_joint_pos[i]

        adr = self._pelvis_qpos_adr
        self.data.qpos[adr + 0] = 0.0
        self.data.qpos[adr + 1] = 0.0
        self.data.qpos[adr + 2] = self._spawn_z
        self.data.qpos[adr + 3] = 1.0  # quat w
        self.data.qpos[adr + 4] = 0.0
        self.data.qpos[adr + 5] = 0.0
        self.data.qpos[adr + 6] = 0.0

        # Per-episode jitter (seeded via self.np_random) so the gate's N rollouts
        # sample a success distribution instead of repeating one trajectory. Base
        # jitter is yaw-only (stays upright); height + small joint noise vary the
        # initial pose. Skipped (reset_jitter=False) for deterministic unit tests.
        if self.reset_jitter:
            rng = self.np_random
            yaw = float(rng.uniform(-_JITTER["yaw"], _JITTER["yaw"]))
            self.data.qpos[adr + 3] = np.cos(yaw / 2.0)
            self.data.qpos[adr + 6] = np.sin(yaw / 2.0)
            self.data.qpos[adr + 2] += float(rng.uniform(-_JITTER["z"], _JITTER["z"]))
            for idx in self._joint_qpos_indices:
                self.data.qpos[idx] += float(rng.normal(0.0, _JITTER["joint"]))

        mujoco.mj_forward(self.model, self.data)
        return self._get_obs(), self._get_info()

    # ------------------------------------------------------------------- step
    def step(self, action):
        self._step_count += 1
        target = np.clip(
            np.asarray(action, dtype=np.float64), self._ctrl_low, self._ctrl_high
        )
        self.data.ctrl[:N_JOINTS] = target

        for _ in range(self._n_substeps):
            mujoco.mj_step(self.model, self.data)

        obs = self._get_obs()
        info = self._get_info()

        pelvis_z = float(self.data.xpos[self._pelvis_body_id][2])
        fallen = pelvis_z < self.fall_z
        fwd_vel = float(self._get_base_lin_vel()[0])

        terminated = bool(fallen)
        truncated = self._step_count >= self.max_steps
        reward = fwd_vel - (10.0 if fallen else 0.0)  # placeholder; gate scores success

        info["pelvis_z"] = pelvis_z
        info["fallen"] = fallen
        info["forward_velocity"] = fwd_vel
        info["steps"] = self._step_count
        info["collision_count"] = self._count_collisions()
        return obs, float(reward), terminated, truncated, info

    # ----------------------------------------------------------- base accessors
    def _base_rotation(self) -> np.ndarray:
        """3x3 body-to-world rotation of the pelvis."""
        return np.asarray(self.data.xmat[self._pelvis_body_id], dtype=np.float64).reshape(3, 3)

    def get_base_ang_vel(self) -> np.ndarray:
        """Base angular velocity in the *base* frame (rad/s).

        MuJoCo stores a free joint's rotational qvel in the local body frame, so
        this is already Isaac's ``base_ang_vel`` (root_ang_vel_b).
        """
        adr = self._pelvis_qvel_adr
        return np.asarray(self.data.qvel[adr + 3 : adr + 6], dtype=np.float64).copy()

    def get_base_lin_vel(self) -> np.ndarray:
        """Base linear velocity in the *base* frame (m/s). MuJoCo stores the
        free-joint linear qvel in the world frame, so rotate it into base."""
        return self._get_base_lin_vel()

    def _get_base_lin_vel(self) -> np.ndarray:
        adr = self._pelvis_qvel_adr
        world_lin = np.asarray(self.data.qvel[adr + 0 : adr + 3], dtype=np.float64)
        return self._base_rotation().T @ world_lin

    def get_projected_gravity(self) -> np.ndarray:
        """Gravity unit vector expressed in the base frame = R^T @ [0,0,-1].

        Equals the negated third row of the base rotation matrix — Isaac's
        ``projected_gravity`` observation term.
        """
        return self._base_rotation().T @ _GRAVITY_HAT

    def get_joint_pos(self) -> np.ndarray:
        return np.array(
            [self.data.qpos[i] for i in self._joint_qpos_indices], dtype=np.float64
        )

    def get_joint_vel(self) -> np.ndarray:
        return np.array(
            [self.data.qvel[i] for i in self._joint_qvel_indices], dtype=np.float64
        )

    # ----------------------------------------------------------------- internals
    def _get_obs(self):
        pos = np.array(
            [self.data.qpos[i] for i in self._joint_qpos_indices], dtype=np.float32
        )
        vel = np.array(
            [self.data.qvel[i] for i in self._joint_qvel_indices], dtype=np.float32
        )
        state = np.concatenate([pos, vel]).astype(np.float32)
        if self.obs_mode == "state":
            return {"state": state}
        return {"image": self.render(), "state": state}

    def _get_info(self):
        return {"steps": self._step_count}

    def _count_collisions(self) -> int:
        floor_geom_id = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_GEOM, "floor")
        count = 0
        for i in range(self.data.ncon):
            c = self.data.contact[i]
            if floor_geom_id in (c.geom1, c.geom2):
                continue
            count += 1
        return count

    # ----------------------------------------------------------------- render
    def render(self):
        if self.renderer is None:
            raise RuntimeError(
                "render() on a 'state'-mode env (no GL renderer). Use capture_frame()."
            )
        return self._render_frame()

    def capture_frame(self) -> np.ndarray:
        """Render a frame on demand, lazily building a renderer (gate UI path)."""
        if self.renderer is None:
            self.renderer = mujoco.Renderer(self.model, _RENDER_HEIGHT, _RENDER_WIDTH)
        return self._render_frame()

    def _render_frame(self) -> np.ndarray:
        if self._camera == -1:
            self.renderer.update_scene(self.data)
        else:
            self.renderer.update_scene(self.data, camera=self._camera)
        return self.renderer.render()

    def close(self):
        if getattr(self, "renderer", None) is not None:
            self.renderer.close()
            self.renderer = None
