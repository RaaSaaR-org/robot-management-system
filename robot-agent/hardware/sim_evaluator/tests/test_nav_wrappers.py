"""
@file test_nav_wrappers.py
@description Tests for the shared sim-RL navigation wrappers (TASK-172.C):
    61-dim obs layout, shaped reward (alive bonus), domain randomization, and
    the train/eval obs parity that makes a trained policy gate-consumable.
    Skipped entirely when mujoco is not installed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))

mujoco = pytest.importorskip("mujoco")

from envs.nav_wrappers import (  # noqa: E402
    NAV_OBS_DIM,
    OBS_LAYOUT,
    DomainRandomizationWrapper,
    make_nav_env,
)


def test_obs_layout_constant_matches_dim():
    assert NAV_OBS_DIM == 61
    assert OBS_LAYOUT["dim"] == 61
    assert sum(seg["size"] for seg in OBS_LAYOUT["segments"]) == 61


def test_nav_obs_shape_and_dtype_state_mode():
    env = make_nav_env(obs_mode="state", max_steps=5, shaped=True, domain_rand=False)
    try:
        obs, _ = env.reset(seed=0)
        assert obs.shape == (NAV_OBS_DIM,)
        assert obs.dtype == np.float32
        # No GL renderer should have been built in state mode.
        assert env.unwrapped.renderer is None
        obs2, reward, term, trunc, info = env.step(np.zeros(29, dtype=np.float32))
        assert obs2.shape == (NAV_OBS_DIM,)
        assert isinstance(reward, float)
        assert "shaped_reward" in info and "env_reward" in info
    finally:
        env.close()


def test_obs_parity_state_vs_rgb_state():
    """The 61-dim nav obs must be identical whether or not the image is rendered.

    This is the train(state)/eval(rgb_state) parity contract: the image never
    participates in the policy observation.
    """
    e_state = make_nav_env(obs_mode="state", max_steps=5, shaped=False, domain_rand=False)
    e_rgb = make_nav_env(obs_mode="rgb_state", max_steps=5, shaped=False, domain_rand=False)
    try:
        o_state, _ = e_state.reset(seed=123)
        o_rgb, _ = e_rgb.reset(seed=123)
        np.testing.assert_allclose(o_state, o_rgb, rtol=0, atol=0)
        # rgb_state can render frames; state cannot.
        assert e_rgb.unwrapped.render().shape == (224, 224, 3)
        with pytest.raises(RuntimeError):
            e_state.unwrapped.render()
    finally:
        e_state.close()
        e_rgb.close()


def test_goal_relative_terms():
    """Last 3 obs dims are [goal_dx, goal_dy, |goal|] consistent with each other."""
    env = make_nav_env(obs_mode="state", max_steps=5, shaped=False, domain_rand=False)
    try:
        obs, _ = env.reset(seed=0)
        dx, dy, dist = obs[-3], obs[-2], obs[-1]
        assert dist == pytest.approx(float(np.hypot(dx, dy)), abs=1e-4)
        assert dist > 0  # goal_site is ahead of the spawn in the empty scene
    finally:
        env.close()


def test_shaped_reward_has_alive_bonus_when_standing():
    """Standing still (zero action) at spawn earns ~alive_bonus, not -distance.

    Without the alive bonus the from-scratch nav problem is ill-posed; this guards
    that the shaping (not the raw env -distance reward) reaches the agent.
    """
    env = make_nav_env(
        obs_mode="state",
        max_steps=3,
        shaped=True,
        domain_rand=False,
        reward_kwargs={"alive_bonus": 0.5, "progress_weight": 10.0, "energy_weight": 0.0},
    )
    try:
        env.reset(seed=0)
        _, reward, _, _, info = env.step(np.zeros(29, dtype=np.float32))
        # env reward is -distance (clearly negative); shaped reward is dominated by
        # the alive bonus + small progress and is far above it.
        assert info["env_reward"] < 0
        assert reward > info["env_reward"]
        assert reward == pytest.approx(info["shaped_reward"], abs=1e-6)
    finally:
        env.close()


def test_domain_randomization_perturbs_spawn():
    """DR moves the spawn between episodes and restores nominal model params."""
    env = make_nav_env(
        obs_mode="state",
        max_steps=3,
        shaped=False,
        domain_rand=True,
        dr_kwargs={"spawn_radius": 0.5, "latency_steps_range": (0, 0)},
    )
    try:
        base = env.unwrapped
        adr = base._pelvis_qpos_adr

        env.reset(seed=1)
        xy1 = base.data.qpos[adr : adr + 2].copy()
        env.reset(seed=2)
        xy2 = base.data.qpos[adr : adr + 2].copy()
        # Different seeds -> different spawn positions (within the disc).
        assert not np.allclose(xy1, xy2)
        assert np.hypot(*xy1) <= 0.5 + 1e-6
    finally:
        env.close()


def test_domain_randomization_restores_base_params():
    """Friction/mass scale from a clean snapshot each episode (no compounding)."""
    from envs.g1_env import G1Env

    inner = G1Env(max_steps=3, obs_mode="state")
    dr = DomainRandomizationWrapper(
        inner, friction_range=(2.0, 2.0), mass_scale_range=(3.0, 3.0),
        latency_steps_range=(0, 0),
    )
    try:
        base_friction = inner.model.geom_friction.copy()
        base_mass = inner.model.body_mass.copy()
        dr.reset(seed=0)
        # Scaled by the fixed factor from the ORIGINAL snapshot.
        np.testing.assert_allclose(inner.model.geom_friction, base_friction * 2.0)
        np.testing.assert_allclose(inner.model.body_mass, base_mass * 3.0)
        dr.reset(seed=1)
        # Still 2x/3x the ORIGINAL — not 4x/9x — proving no compounding.
        np.testing.assert_allclose(inner.model.geom_friction, base_friction * 2.0)
        np.testing.assert_allclose(inner.model.body_mass, base_mass * 3.0)
    finally:
        dr.close()
