"""
@file locomotion_wrappers.py
@description Gymnasium wrappers that turn the raw ``G1LocomotionEnv`` into an
    Isaac-Lab-compatible *locomotion* (walking-gait) learning problem, and the
    **single source of truth** for the locomotion observation layout + the
    physics/control contract (TASK-172.C Isaac-Lab path).

This mirrors ``nav_wrappers`` but for locomotion. The Isaac Lab trainer
(``../sim-trainer`` ``isaac_ppo.py``) imports the layout + defaults here and
writes them into the policy ``manifest.json`` (``env: "locomotion"`` + a
``control`` block); the deployment gate (``evaluate_policy.py``) reads that
manifest and rebuilds the *matching* MuJoCo env through ``make_locomotion_env``.
That round-trip is the sim-to-sim (PhysX↔MuJoCo) contract: any change to the obs
scaling, action mapping, control rate, or command flows through the manifest with
no gate code change.

Observation (``LocomotionObsWrapper``), 96-dim float32, in **Isaac policy joint
order** (``joint_order``; default identity == canonical ``JOINT_NAMES``):
    [ base_ang_vel(3) | projected_gravity(3) | velocity_command(3)
      | (joint_pos − default)(29) | joint_vel(29) | last_action(29) ]
Base linear velocity is intentionally **dropped** from the policy obs (the
standard blind-transfer choice — it lives only in Isaac's critic obs, which is
never exported). Every per-term scale below must match Isaac's ``ObservationsCfg``
so a fixed sim state yields the same normalized obs at train and eval.

Module top stays **mujoco-free** (mujoco is imported only inside functions / the
lazily-imported env) so the Isaac trainer host — which need not have mujoco —
can import ``LOCO_OBS_DIM`` / ``LOCO_OBS_LAYOUT`` / ``DEFAULT_CONTROL`` for the
manifest.

@status live
"""

from __future__ import annotations

import copy
import logging

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from .g1_env import N_JOINTS  # 29

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Observation layout — the contract. joint_pos/joint_vel/last_action are each
# N_JOINTS (29); base_lin_vel is omitted (blind transfer).
# ---------------------------------------------------------------------------
ACTION_DIM = N_JOINTS  # 29
LOCO_OBS_DIM = 3 + 3 + 3 + 3 * N_JOINTS  # 96

LOCO_OBS_LAYOUT = {
    "dim": LOCO_OBS_DIM,
    "segments": [
        {"name": "base_ang_vel", "size": 3},
        {"name": "projected_gravity", "size": 3},
        {"name": "velocity_command", "size": 3},
        {"name": "joint_pos_rel", "size": N_JOINTS},
        {"name": "joint_vel", "size": N_JOINTS},
        {"name": "last_action", "size": N_JOINTS},
    ],
    "frame": "base",
    "joint_order": "isaac",  # see control.joint_order for the concrete mapping
}

# Isaac ``ObservationsCfg`` per-term scales for the velocity task (base_lin_vel's
# 2.0 is omitted with the term). Verify against the pinned Isaac Lab cfg on the host.
DEFAULT_OBS_SCALES = {
    "base_ang_vel": 0.25,
    "projected_gravity": 1.0,
    "velocity_command": 1.0,
    "joint_pos": 1.0,
    "joint_vel": 0.05,
    "actions": 1.0,
}

# Isaac G1 crouched init stance (rad), canonical JOINT_NAMES order. Placeholder
# stand-in — corrected against ``G1_CFG.init_state.joint_pos`` on the GPU host.
DEFAULT_JOINT_POS = np.array(
    [
        -0.20, 0.0, 0.0, 0.42, -0.23, 0.0,   # left leg
        -0.20, 0.0, 0.0, 0.42, -0.23, 0.0,   # right leg
        0.0, 0.0, 0.0,                        # waist yaw/roll/pitch
        0.20, 0.20, 0.0, 0.87, 0.0, 0.0, 0.0,   # left arm
        0.20, -0.20, 0.0, 0.87, 0.0, 0.0, 0.0,  # right arm
    ],
    dtype=np.float64,
)

# Isaac treats the policy action as an offset from the default stance, scaled.
DEFAULT_ACTION_SCALE = 0.25
DEFAULT_CONTROL_HZ = 50.0
# Forward walk command [vx, vy, wz] (m/s, m/s, rad/s).
DEFAULT_COMMAND = np.array([1.0, 0.0, 0.0], dtype=np.float64)

# PD gains: None => keep the MJCF's kp=150/kv=5. Isaac uses per-joint
# stiffness/damping; set these from the Isaac actuator cfg on the host.
DEFAULT_PD_GAINS: dict | None = None

# Episode success (locomotion): stayed upright the whole episode AND mean forward
# base velocity tracked the command within tolerance.
DEFAULT_SUCCESS_CFG = {
    "min_upright_z": 0.5,      # pelvis z (m) below which the robot has fallen
    "vel_tolerance": 0.5,      # |mean_fwd_vel − command_vx| must be within this
    "min_track_steps": 25,     # need at least this many steps to judge tracking
}

# The full physics/control contract the trainer writes into manifest.control and
# the gate reads back. joint_order maps Isaac action index -> canonical joint
# index; None == identity (Isaac joints already in canonical order).
DEFAULT_CONTROL = {
    "control_hz": DEFAULT_CONTROL_HZ,
    "action_scale": DEFAULT_ACTION_SCALE,
    "default_joint_pos": DEFAULT_JOINT_POS.tolist(),
    "pd_gains": DEFAULT_PD_GAINS,
    "command": DEFAULT_COMMAND.tolist(),
    "joint_order": None,
    "obs_scales": DEFAULT_OBS_SCALES,
    "success_cfg": DEFAULT_SUCCESS_CFG,
}


def _resolve_joint_order(joint_order) -> list[int]:
    if joint_order is None:
        return list(range(N_JOINTS))
    order = [int(i) for i in joint_order]
    if len(order) != N_JOINTS or sorted(order) != list(range(N_JOINTS)):
        raise ValueError(
            f"joint_order must be a permutation of 0..{N_JOINTS - 1}, got {order!r}"
        )
    return order


class LocomotionActionWrapper(gym.Wrapper):
    """Map a policy action (Isaac joint order) to a MuJoCo position target.

    ``target[canonical] = default_joint_pos[canonical] + action_scale * action``.
    The raw policy action (Isaac order) is buffered as ``last_action`` for the obs.
    """

    def __init__(self, env, *, action_scale, default_joint_pos, joint_order):
        super().__init__(env)
        self.action_scale = float(action_scale)
        self.default_joint_pos = np.asarray(default_joint_pos, dtype=np.float64)
        self.joint_order = _resolve_joint_order(joint_order)
        self.last_action = np.zeros(len(self.joint_order), dtype=np.float64)
        self.action_space = spaces.Box(
            low=-1.0, high=1.0, shape=(len(self.joint_order),), dtype=np.float32
        )

    def reset(self, *, seed=None, options=None):
        self.last_action = np.zeros(len(self.joint_order), dtype=np.float64)
        return self.env.reset(seed=seed, options=options)

    def step(self, action):
        act = np.asarray(action, dtype=np.float64).reshape(-1)
        self.last_action = act.copy()
        target = self.default_joint_pos.copy()
        for k, canonical in enumerate(self.joint_order):
            target[canonical] = (
                self.default_joint_pos[canonical] + self.action_scale * act[k]
            )
        return self.env.step(target)


class VelocityCommandWrapper(gym.Wrapper):
    """Hold the velocity command and score locomotion success.

    Success (written to ``info['success']`` on the terminal step) = never fell AND
    mean forward base velocity is within ``vel_tolerance`` of the commanded vx.
    """

    def __init__(self, env, *, command, success_cfg):
        super().__init__(env)
        self.command = np.asarray(command, dtype=np.float64).reshape(3)
        self.cfg = dict(success_cfg)
        self._ever_fell = False
        self._vel_sum = 0.0
        self._n = 0

    def reset(self, *, seed=None, options=None):
        self._ever_fell = False
        self._vel_sum = 0.0
        self._n = 0
        return self.env.reset(seed=seed, options=options)

    def step(self, action):
        obs, reward, terminated, truncated, info = self.env.step(action)
        self._ever_fell = self._ever_fell or bool(info.get("fallen", False))
        self._vel_sum += float(info.get("forward_velocity", 0.0))
        self._n += 1

        if terminated or truncated:
            mean_fwd = self._vel_sum / self._n if self._n else 0.0
            tracked = (
                self._n >= int(self.cfg.get("min_track_steps", 25))
                and abs(mean_fwd - float(self.command[0]))
                <= float(self.cfg.get("vel_tolerance", 0.5))
            )
            info["success"] = bool((not self._ever_fell) and tracked)
            info["mean_forward_velocity"] = mean_fwd
        else:
            info["success"] = False
        return obs, reward, terminated, truncated, info


class LocomotionObsWrapper(gym.ObservationWrapper):
    """Build the 96-dim Isaac locomotion policy obs from MuJoCo state.

    Reads the base twist / projected gravity / joint state from the unwrapped
    ``G1LocomotionEnv``, the command from the ``VelocityCommandWrapper``, and the
    last action from the ``LocomotionActionWrapper`` — reordered into Isaac joint
    order and scaled to match Isaac's ObservationManager.
    """

    def __init__(self, env, *, action_wrapper, command_wrapper, obs_scales, joint_order):
        super().__init__(env)
        self._act = action_wrapper
        self._cmd = command_wrapper
        self._scales = dict(obs_scales)
        self._order = _resolve_joint_order(joint_order)
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(LOCO_OBS_DIM,), dtype=np.float32
        )

    def observation(self, _observation) -> np.ndarray:
        base = self.env.unwrapped
        order = self._order
        s = self._scales
        default = self._act.default_joint_pos

        ang_vel = base.get_base_ang_vel() * s["base_ang_vel"]
        grav = base.get_projected_gravity() * s["projected_gravity"]
        cmd = self._cmd.command * s["velocity_command"]

        q = base.get_joint_pos()
        qd = base.get_joint_vel()
        jpos = (q[order] - default[order]) * s["joint_pos"]
        jvel = qd[order] * s["joint_vel"]
        last = self._act.last_action * s["actions"]

        return np.concatenate([ang_vel, grav, cmd, jpos, jvel, last]).astype(np.float32)


def make_locomotion_env(
    scene_path: str | None = None,
    *,
    command=None,
    action_scale: float | None = None,
    default_joint_pos=None,
    pd_gains: dict | None = None,
    control_hz: float | None = None,
    joint_order=None,
    obs_scales: dict | None = None,
    success_cfg: dict | None = None,
    max_steps: int = 1000,
    domain_rand: bool = False,
    reset_jitter: bool = True,
    obs_mode: str = "state",
) -> gym.Env:
    """Build the canonical G1 locomotion env used by the gate (and mirrored by the
    Isaac trainer's obs contract). Kwargs default to ``DEFAULT_CONTROL`` so a
    manifest ``control`` block that carries only a subset still resolves.

    Layering (inner → outer): ``G1LocomotionEnv`` → ``LocomotionActionWrapper`` →
    ``VelocityCommandWrapper`` → ``LocomotionObsWrapper`` (outermost → the policy
    always sees the 96-dim vector).
    """
    from .g1_locomotion_env import G1LocomotionEnv

    command = DEFAULT_COMMAND if command is None else command
    action_scale = DEFAULT_ACTION_SCALE if action_scale is None else action_scale
    default_joint_pos = (
        DEFAULT_JOINT_POS if default_joint_pos is None else np.asarray(default_joint_pos, float)
    )
    control_hz = DEFAULT_CONTROL_HZ if control_hz is None else control_hz
    obs_scales = DEFAULT_OBS_SCALES if obs_scales is None else obs_scales
    success_cfg = DEFAULT_SUCCESS_CFG if success_cfg is None else success_cfg
    pd_gains = DEFAULT_PD_GAINS if pd_gains is None else pd_gains
    pd_kp = (pd_gains or {}).get("kp")
    pd_kv = (pd_gains or {}).get("kv")

    if domain_rand:
        # Gate-side domain randomization is intentionally not applied: Isaac does
        # train-time randomization (event manager); the gate scores nominal physics.
        logger.info("[locomotion] domain_rand requested but gate uses nominal physics")

    # min_upright_z is the SAME threshold the env uses for fall detection, so the
    # success contract's upright bound actually drives info['fallen'] (no dead knob).
    fall_z = float(success_cfg.get("min_upright_z", DEFAULT_SUCCESS_CFG["min_upright_z"]))

    env: gym.Env = G1LocomotionEnv(
        scene_path=scene_path,
        max_steps=max_steps,
        obs_mode=obs_mode,
        control_hz=control_hz,
        default_joint_pos=default_joint_pos,
        pd_kp=pd_kp,
        pd_kv=pd_kv,
        fall_z=fall_z,
        reset_jitter=reset_jitter,
    )
    act_w = LocomotionActionWrapper(
        env, action_scale=action_scale, default_joint_pos=default_joint_pos,
        joint_order=joint_order,
    )
    cmd_w = VelocityCommandWrapper(act_w, command=command, success_cfg=success_cfg)
    obs_w = LocomotionObsWrapper(
        cmd_w, action_wrapper=act_w, command_wrapper=cmd_w,
        obs_scales=obs_scales, joint_order=joint_order,
    )
    return obs_w


def build_control_manifest(**overrides) -> dict:
    """Return a deep copy of ``DEFAULT_CONTROL`` with any overrides applied — the
    trainer uses this to populate ``manifest.control`` (single source of truth)."""
    control = copy.deepcopy(DEFAULT_CONTROL)
    control.update({k: v for k, v in overrides.items() if v is not None})
    return control
