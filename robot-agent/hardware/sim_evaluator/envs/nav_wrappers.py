"""
@file nav_wrappers.py
@description Shared Gymnasium wrappers that turn the raw 29-DOF ``G1Env`` into a
    goal-relative *navigation* learning problem (TASK-172.C, sim-RL Phase 2/3).

These wrappers are the **single source of truth** for the observation layout and
the reward shaping. The trainer (``../sim-trainer`` ``ppo_nav.py``) and the
deployment gate (``evaluate_policy.py``) both build their env through
``make_nav_env`` so train-time and eval-time observations are byte-for-byte
identical — that parity is what makes a trained ``policy.onnx`` consumable by the
sim-to-real validation gate.

Observation (``NavObsWrapper``), 61-dim float32:
    [ 29 joint qpos | 29 joint qvel | goal_dx | goal_dy | |goal| ]
where ``(goal_dx, goal_dy)`` is the world-frame vector from the pelvis to
``goal_site`` and ``|goal|`` its norm.

Reward (``ShapedRewardWrapper``): the base env reward is hard-coded to
``-distance``; learning G1 navigation from scratch is ill-posed without an alive
bonus (a random policy just falls and the episode ends). We replace it with
potential-based progress + an alive/standing bonus + keepout + energy + terminal
shaping. Acceptance is "beats random on a goal-at-spawn standing case", NOT a
walking robot.

Domain randomization (``DomainRandomizationWrapper``): spawn offset, friction,
body mass, and action latency — perturbed per-episode so the policy does not
overfit a single deterministic rollout.

@status live
"""

from __future__ import annotations

import logging
from collections import deque

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from .g1_env import N_JOINTS  # 29

logger = logging.getLogger(__name__)

# Observation layout — kept here so trainer + gate + manifest agree.
GOAL_OBS_DIM = 3  # goal_dx, goal_dy, |goal|
NAV_OBS_DIM = 2 * N_JOINTS + GOAL_OBS_DIM  # 61
ACTION_DIM = N_JOINTS  # 29

# A short, machine-readable description of the obs vector, emitted into the
# artifact manifest.json so a future serving path can reconstruct the layout.
OBS_LAYOUT = {
    "dim": NAV_OBS_DIM,
    "segments": [
        {"name": "qpos", "size": N_JOINTS},
        {"name": "qvel", "size": N_JOINTS},
        {"name": "goal_dx", "size": 1},
        {"name": "goal_dy", "size": 1},
        {"name": "goal_dist", "size": 1},
    ],
    "frame": "world",
}


class NavObsWrapper(gym.ObservationWrapper):
    """Flatten ``G1Env``'s dict obs into a 61-dim goal-relative nav vector.

    Works for both ``obs_mode='state'`` (training, no image) and
    ``'rgb_state'`` (eval, image present but ignored here): the goal-relative
    terms are read straight from the unwrapped env's MuJoCo state, so the image
    never participates in the policy observation.
    """

    def __init__(self, env: gym.Env):
        super().__init__(env)
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(NAV_OBS_DIM,), dtype=np.float32
        )

    def observation(self, observation: dict) -> np.ndarray:
        state = np.asarray(observation["state"], dtype=np.float32)
        base = self.env.unwrapped
        pelvis = base._get_pelvis_xy()
        goal = base._get_goal_xy()
        delta = (goal - pelvis).astype(np.float32)
        dist = np.float32(np.linalg.norm(delta))
        return np.concatenate([state, delta, [dist]]).astype(np.float32)


class ShapedRewardWrapper(gym.Wrapper):
    """Replace the env's ``-distance`` reward with shaped navigation reward.

    reward = progress_weight * (prev_dist - dist)      # potential-based progress
           + alive_bonus           (while standing)    # makes the problem well-posed
           - keepout_penalty * collision_count         # avoid keep-out / obstacles
           - energy_weight * ||action||^2              # smooth, low-effort control
           + goal_bonus            (on success)        # terminal shaping
           - fall_penalty          (on falling)

    The original env reward is preserved in ``info['env_reward']``.
    """

    def __init__(
        self,
        env: gym.Env,
        *,
        progress_weight: float = 10.0,
        alive_bonus: float = 0.5,
        keepout_penalty: float = 1.0,
        energy_weight: float = 0.001,
        goal_bonus: float = 50.0,
        fall_penalty: float = 10.0,
    ):
        super().__init__(env)
        self.progress_weight = progress_weight
        self.alive_bonus = alive_bonus
        self.keepout_penalty = keepout_penalty
        self.energy_weight = energy_weight
        self.goal_bonus = goal_bonus
        self.fall_penalty = fall_penalty
        self._prev_dist: float | None = None

    def reset(self, *, seed=None, options=None):
        obs, info = self.env.reset(seed=seed, options=options)
        base = self.env.unwrapped
        self._prev_dist = float(
            np.linalg.norm(base._get_goal_xy() - base._get_pelvis_xy())
        )
        return obs, info

    def step(self, action):
        obs, env_reward, terminated, truncated, info = self.env.step(action)

        dist = float(info.get("distance", self._prev_dist or 0.0))
        prev = self._prev_dist if self._prev_dist is not None else dist
        progress = prev - dist
        self._prev_dist = dist

        fallen = bool(info.get("fallen", False))
        success = bool(info.get("success", False))
        collisions = int(info.get("collision_count", 0))
        act = np.asarray(action, dtype=np.float64)

        reward = self.progress_weight * progress
        reward += 0.0 if fallen else self.alive_bonus
        reward -= self.keepout_penalty * collisions
        reward -= self.energy_weight * float(np.sum(act * act))
        if success:
            reward += self.goal_bonus
        if fallen:
            reward -= self.fall_penalty

        info["env_reward"] = float(env_reward)
        info["shaped_reward"] = float(reward)
        info["progress"] = float(progress)
        return obs, float(reward), terminated, truncated, info


class DomainRandomizationWrapper(gym.Wrapper):
    """Per-episode domain randomization: spawn / friction / mass / action latency.

    Goal randomization is achieved *via the spawn offset*: the ``goal_site`` is
    baked into the MJCF at build time and cannot be moved at run time, so moving
    the robot's spawn around the room is the equivalent perturbation from the
    policy's goal-relative point of view.

    Latency models actuation delay by buffering actions ``latency`` control
    steps before they reach the simulator.
    """

    def __init__(
        self,
        env: gym.Env,
        *,
        spawn_radius: float = 0.5,
        friction_range: tuple[float, float] = (0.8, 1.2),
        mass_scale_range: tuple[float, float] = (0.9, 1.1),
        latency_steps_range: tuple[int, int] = (0, 2),
        enabled: bool = True,
    ):
        super().__init__(env)
        self.spawn_radius = spawn_radius
        self.friction_range = friction_range
        self.mass_scale_range = mass_scale_range
        self.latency_steps_range = latency_steps_range
        self.enabled = enabled

        base = self.env.unwrapped
        # Snapshot the nominal model params so each episode randomizes from a
        # clean baseline rather than compounding.
        self._base_friction = base.model.geom_friction.copy()
        self._base_mass = base.model.body_mass.copy()
        self._action_buffer: deque = deque()

    def reset(self, *, seed=None, options=None):
        obs, info = self.env.reset(seed=seed, options=options)
        if not self.enabled:
            return obs, info

        import mujoco  # available wherever G1Env is constructable

        base = self.env.unwrapped
        rng = self.np_random

        # Friction + mass: scale from the nominal snapshot.
        f_scale = rng.uniform(*self.friction_range)
        m_scale = rng.uniform(*self.mass_scale_range)
        base.model.geom_friction[:] = self._base_friction * f_scale
        base.model.body_mass[:] = self._base_mass * m_scale

        # Spawn offset: nudge the pelvis freejoint within a disc.
        adr = base._pelvis_qpos_adr
        ang = rng.uniform(0.0, 2.0 * np.pi)
        r = self.spawn_radius * np.sqrt(rng.uniform(0.0, 1.0))
        base.data.qpos[adr + 0] = r * np.cos(ang)
        base.data.qpos[adr + 1] = r * np.sin(ang)
        mujoco.mj_forward(base.model, base.data)

        # Action latency buffer.
        latency = int(rng.integers(self.latency_steps_range[0],
                                   self.latency_steps_range[1] + 1))
        self._action_buffer = deque(maxlen=latency + 1)
        self._latency = latency

        # Recompute info AFTER the spawn perturbation so the returned obs/info
        # pair is consistent — the inner reset captured info at the un-perturbed
        # (0,0) spawn (Gymnasium reset-contract correctness).
        return base._get_obs(), base._get_info()

    def step(self, action):
        if self.enabled and getattr(self, "_latency", 0) > 0:
            self._action_buffer.append(np.asarray(action, dtype=np.float64))
            # Apply the oldest buffered action once the buffer is primed.
            applied = self._action_buffer[0]
            return self.env.step(applied)
        return self.env.step(action)


def make_nav_env(
    scene_path: str | None = None,
    *,
    obs_mode: str = "state",
    max_steps: int = 400,
    shaped: bool = True,
    domain_rand: bool = False,
    dr_kwargs: dict | None = None,
    reward_kwargs: dict | None = None,
) -> gym.Env:
    """Build the canonical G1 navigation env used by BOTH trainer and gate.

    Layering (inner → outer): ``G1Env`` → [DomainRandomization] → [ShapedReward]
    → ``NavObsWrapper``. ``NavObsWrapper`` is always outermost so the policy sees
    the 61-dim vector regardless of obs_mode / shaping / DR.

    - Training: ``obs_mode='state'`` (no GL), ``shaped=True``, ``domain_rand=True``.
    - Gate/eval: ``obs_mode='rgb_state'`` (so frames can be captured),
      ``shaped=False`` (we only score success, not reward), ``domain_rand=False``.
    The 61-dim observation is identical across both — that is the parity contract.
    """
    from .g1_env import G1Env

    env: gym.Env = G1Env(scene_path=scene_path, max_steps=max_steps, obs_mode=obs_mode)
    if domain_rand:
        env = DomainRandomizationWrapper(env, **(dr_kwargs or {}))
    if shaped:
        env = ShapedRewardWrapper(env, **(reward_kwargs or {}))
    env = NavObsWrapper(env)
    return env
