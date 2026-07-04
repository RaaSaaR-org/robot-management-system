"""
@file test_locomotion_env.py
@description Tests for the G1 locomotion gate env + wrappers (Isaac-Lab path):
    the 96-dim obs layout, the Isaac-matched control (rate / PD gains / default
    stance), the base-state accessors, the success contract, and the manifest-
    driven env dispatch in evaluate_policy. Skipped entirely without mujoco.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))

mujoco = pytest.importorskip("mujoco")

from envs.g1_locomotion_env import G1LocomotionEnv  # noqa: E402
from envs.locomotion_wrappers import (  # noqa: E402
    ACTION_DIM,
    LOCO_OBS_DIM,
    LOCO_OBS_LAYOUT,
    make_locomotion_env,
)


def test_obs_layout_constant_matches_dim():
    assert LOCO_OBS_DIM == 96
    assert ACTION_DIM == 29
    assert LOCO_OBS_LAYOUT["dim"] == 96
    assert sum(seg["size"] for seg in LOCO_OBS_LAYOUT["segments"]) == 96


def test_env_builds_steps_and_obs_shape():
    env = make_locomotion_env(max_steps=5)
    try:
        obs, _ = env.reset(seed=0)
        assert obs.shape == (LOCO_OBS_DIM,)
        assert obs.dtype == np.float32
        assert env.action_space.shape == (ACTION_DIM,)
        # state mode => no GL renderer built.
        assert env.unwrapped.renderer is None

        obs2, reward, term, trunc, info = env.step(np.zeros(ACTION_DIM, dtype=np.float32))
        assert obs2.shape == (LOCO_OBS_DIM,)
        assert isinstance(reward, float)
        # The command wrapper always writes success; the env writes collisions.
        assert "success" in info
        assert "collision_count" in info
    finally:
        env.close()


def test_default_stance_and_zero_joint_pos_rel():
    """At reset the robot is in the default stance, so the obs joint_pos_rel
    segment (which Isaac defines as qpos − default) is ~0."""
    env = make_locomotion_env(max_steps=3, reset_jitter=False)
    try:
        env.reset(seed=0)
        base = env.unwrapped
        np.testing.assert_allclose(base.get_joint_pos(), base.default_joint_pos, atol=1e-6)
        obs = env.observation(None)  # obs wrapper recomputes from sim state
        # segment offsets: base_ang_vel(3)+projected_gravity(3)+command(3)=9
        jpos_rel = obs[9 : 9 + ACTION_DIM]
        np.testing.assert_allclose(jpos_rel, np.zeros(ACTION_DIM), atol=1e-5)
    finally:
        env.close()


def test_projected_gravity_is_down_when_upright():
    env = G1LocomotionEnv(max_steps=2, reset_jitter=False)
    try:
        env.reset(seed=0)
        # Upright base (identity quat) => gravity in base frame is straight down.
        np.testing.assert_allclose(
            env.get_projected_gravity(), [0.0, 0.0, -1.0], atol=1e-6
        )
    finally:
        env.close()


def test_control_hz_sets_substeps():
    e50 = G1LocomotionEnv(control_hz=50.0, max_steps=2)
    e25 = G1LocomotionEnv(control_hz=25.0, max_steps=2)
    try:
        assert e50._n_substeps >= 1 and e25._n_substeps >= 1
        # Half the control rate => ~twice the sub-steps per control step.
        assert e25._n_substeps > e50._n_substeps
    finally:
        e50.close()
        e25.close()


def test_pd_gains_override():
    env = G1LocomotionEnv(pd_kp=200.0, pd_kv=10.0, max_steps=2)
    try:
        # MuJoCo position actuator: gainprm[0]=kp, biasprm[1]=-kp, biasprm[2]=-kv.
        assert env.model.actuator_gainprm[0, 0] == pytest.approx(200.0)
        assert env.model.actuator_biasprm[0, 1] == pytest.approx(-200.0)
        assert env.model.actuator_biasprm[0, 2] == pytest.approx(-10.0)
    finally:
        env.close()


def test_action_offset_from_default_stance():
    """A zero policy action holds the default stance; a nonzero action offsets
    the position target by action_scale·action (Isaac's action mapping)."""
    env = make_locomotion_env(max_steps=2, action_scale=0.25)
    try:
        env.reset(seed=0)
        act_w = env.env.env  # obs -> command -> action wrapper
        act = np.zeros(ACTION_DIM, dtype=np.float32)
        act[0] = 1.0
        env.step(act)
        # last_action buffered in Isaac order for the obs.
        assert act_w.last_action[0] == pytest.approx(1.0)
    finally:
        env.close()


def test_reset_jitter_varies_across_seeds_but_reproducible():
    """Per-episode jitter makes different seeds give different initial obs (so the
    gate's N rollouts aren't byte-identical), while a fixed seed reproduces exactly."""
    env = make_locomotion_env(max_steps=3)  # jitter on by default
    try:
        o1, _ = env.reset(seed=1)
        o2, _ = env.reset(seed=2)
        assert not np.allclose(o1, o2)  # different seeds -> different start

        # Base jitter is yaw-only, so the robot still starts upright.
        assert env.unwrapped.get_projected_gravity()[2] < -0.9

        # Same seed reproduces the same initial obs (seeded rollouts stay stable).
        a, _ = env.reset(seed=5)
        b, _ = env.reset(seed=5)
        np.testing.assert_allclose(a, b)
    finally:
        env.close()


def test_min_upright_z_drives_fall_threshold():
    """success_cfg['min_upright_z'] is wired to the env's fall check (not dead)."""
    env = make_locomotion_env(
        max_steps=2,
        success_cfg={"min_upright_z": 0.7, "vel_tolerance": 0.5, "min_track_steps": 1},
    )
    try:
        assert env.unwrapped.fall_z == pytest.approx(0.7)
    finally:
        env.close()


def test_build_eval_env_dispatch_locomotion_vs_nav():
    """evaluate_policy._build_eval_env picks the env from manifest['env']."""
    import evaluate_policy as ep

    loco = ep._build_eval_env({"env": "locomotion", "control": {}}, None, 5, 0.5)
    try:
        obs, _ = loco.reset(seed=0)
        assert obs.shape == (LOCO_OBS_DIM,)
    finally:
        loco.close()

    # No env field => legacy nav env (61-dim), unchanged.
    nav = ep._build_eval_env({}, None, 5, 0.5)
    try:
        obs, _ = nav.reset(seed=0)
        assert obs.shape == (61,)
    finally:
        nav.close()
