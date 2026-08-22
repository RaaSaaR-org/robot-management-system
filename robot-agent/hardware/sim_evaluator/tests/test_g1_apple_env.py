"""
@file test_g1_apple_env.py
@description Verification suite for G1ApplePnPEnv (NVIDIA GR00T E2E apple
    workflow parity): observation contract, stability under a held pose,
    success/failure triggers, and ego-camera visibility of apple + plate.

Run:  cd robot-agent/hardware/sim_evaluator && uv run python -m pytest tests/test_g1_apple_env.py -v
      (or: uv run python tests/test_g1_apple_env.py)
@status live
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

mujoco = pytest.importorskip("mujoco")

from envs.g1_apple_env import (  # noqa: E402
    APPLE_FALL_Z,
    G1ApplePnPEnv,
    N_ACTION_JOINTS,
    N_STATE_JOINTS,
    STATE_JOINT_NAMES,
)

# Optional debug render target (used by the apple_pnp workstream).
# Set APPLE_PNP_SCENE_CHECK_DIR to an existing directory to get scene_check.jpg written there.
_SCENE_CHECK_DIR = os.environ.get("APPLE_PNP_SCENE_CHECK_DIR", "")


def _hold_action(obs: dict) -> np.ndarray:
    """31-dim action that re-commands the CURRENT pose (zero-delta):
    [L-arm 7 | R-arm 7 | L-hand 7 | R-hand 7 | waist 3] from the 43-dim state
    [legs 0:12 | waist 12:15 | L-arm 15:22 | R-arm 22:29 | L-hand 29:36 |
    R-hand 36:43]."""
    s = obs["state"]
    return np.concatenate([s[15:22], s[22:29], s[29:36], s[36:43], s[12:15]]).astype(
        np.float32
    )


@pytest.fixture(scope="module")
def env():
    e = G1ApplePnPEnv()
    yield e
    e.close()


def test_contract_dims():
    assert N_STATE_JOINTS == 43
    assert N_ACTION_JOINTS == 31
    # Spot-check the modality.json layout.
    assert STATE_JOINT_NAMES[0] == "left_hip_pitch_joint"
    assert STATE_JOINT_NAMES[12] == "waist_yaw_joint"
    assert STATE_JOINT_NAMES[15] == "left_shoulder_pitch_joint"
    assert STATE_JOINT_NAMES[22] == "right_shoulder_pitch_joint"
    assert STATE_JOINT_NAMES[29] == "left_hand_thumb_0_joint"
    # Dex3 asymmetry (left: thumb,middle,index / right: thumb,index,middle).
    assert STATE_JOINT_NAMES[32] == "left_hand_middle_0_joint"
    assert STATE_JOINT_NAMES[36] == "right_hand_thumb_0_joint"
    assert STATE_JOINT_NAMES[39] == "right_hand_index_0_joint"


def test_obs_shapes_and_dtypes(env):
    obs, info = env.reset(seed=0)
    assert set(obs.keys()) == {"image", "state"}
    assert obs["image"].shape == (480, 640, 3)
    assert obs["image"].dtype == np.uint8
    assert obs["state"].shape == (43,)
    assert obs["state"].dtype == np.float32
    assert np.all(np.isfinite(obs["state"]))
    assert "success" in info and "collision_count" in info and "distance" in info
    assert info["success"] is False


def test_state_layout_maps_named_joints(env):
    """Perturbing a joint's qpos must show up at its contract state index."""
    env.reset(seed=0)
    checks = {12: "waist_yaw_joint", 18: "left_elbow_joint", 39: "right_hand_index_0_joint"}
    for idx, name in checks.items():
        jid = mujoco.mj_name2id(env.model, mujoco.mjtObj.mjOBJ_JOINT, name)
        adr = int(env.model.jnt_qposadr[jid])
        old = env.data.qpos[adr]
        env.data.qpos[adr] = old + 0.123
        mujoco.mj_forward(env.model, env.data)
        state = env._get_obs()["state"]
        assert abs(float(state[idx]) - (old + 0.123)) < 1e-5, (idx, name)
        env.data.qpos[adr] = old
        mujoco.mj_forward(env.model, env.data)


def test_smoke_200_steps_hold_pose(env):
    """(a) 200 zero-delta steps holding the initial pose: no explosion, no
    collapse, no NaN."""
    obs, reset_info = env.reset(seed=1)
    initial_state = obs["state"].copy()
    initial_collisions = reset_info["collision_count"]
    action = _hold_action(obs)
    max_qvel = 0.0
    for _ in range(200):
        obs, reward, terminated, truncated, info = env.step(action)
        assert np.all(np.isfinite(obs["state"])), "state exploded to NaN/inf"
        max_qvel = max(max_qvel, float(np.max(np.abs(env.data.qvel))))
        assert not terminated, f"unexpected termination: {info}"
    # Bounded joint velocities (no physics explosion).
    assert max_qvel < 5.0, f"joint velocities unbounded: max |qvel| = {max_qvel:.2f}"
    # Robot holds its standing pose (position actuators): every state joint
    # stays close to where it started. Legs included — they are held at the
    # real t=0 pose by the leg_hold actuator class (kp 8000 + lifted force
    # clamp); without it the hips sag ~0.35 rad off a fixed pelvis.
    drift = np.max(np.abs(obs["state"] - initial_state))
    assert drift < 0.15, f"robot collapsed/drifted: max joint drift {drift:.3f} rad"
    # The apple stayed on the table and the idle robot starts nothing NEW.
    # Not ==0: the real t=0 pose legitimately rests the right hand on the
    # table, so the scene begins in contact. What must not happen is the idle
    # robot drifting into fresh contacts.
    assert info["apple_pos"][2] > 0.7
    assert info["collision_count"] <= initial_collisions, (
        f"idle robot gained contacts: {initial_collisions} -> "
        f"{info['collision_count']}"
    )


def test_success_trigger_apple_on_plate(env):
    """(b) Teleport the apple onto the plate with ~zero velocity => success."""
    obs, _ = env.reset(seed=2)
    action = _hold_action(obs)
    adr = env._apple_qpos_adr
    plate_xy = env._plate_center_xy
    # Rest the apple on the plate top (plate top z + apple half-height + 1 mm).
    plate_top = float(
        env.model.geom_pos[env._plate_geom_id, 2]
        + env.model.geom_size[env._plate_geom_id, 1]
    )
    env.data.qpos[adr + 0] = plate_xy[0]
    env.data.qpos[adr + 1] = plate_xy[1]
    env.data.qpos[adr + 2] = plate_top + 0.037
    env.data.qpos[adr + 3 : adr + 7] = (1.0, 0.0, 0.0, 0.0)
    env.data.qvel[env._apple_dof_adr : env._apple_dof_adr + 6] = 0.0
    mujoco.mj_forward(env.model, env.data)

    success = False
    for _ in range(5):
        obs, reward, terminated, truncated, info = env.step(action)
        if terminated:
            success = info["success"]
            break
    assert success is True, f"expected success after teleport onto plate: {info}"
    assert info["apple_speed"] < 0.1
    assert reward == 1.0


def test_failure_apple_falls_off_table(env):
    """(c) Teleport the apple off the table => failure termination (fell)."""
    obs, _ = env.reset(seed=3)
    action = _hold_action(obs)
    adr = env._apple_qpos_adr
    # Free air beside the table (table is y >= 0.2), below the fall threshold.
    env.data.qpos[adr + 0] = 0.9
    env.data.qpos[adr + 1] = -0.5
    env.data.qpos[adr + 2] = 0.3
    env.data.qvel[env._apple_dof_adr : env._apple_dof_adr + 6] = 0.0
    mujoco.mj_forward(env.model, env.data)

    obs, reward, terminated, truncated, info = env.step(action)
    assert terminated, "expected failure termination after the apple fell"
    assert info["fell"] is True
    assert info["success"] is False
    assert info["apple_pos"][2] < APPLE_FALL_Z


def test_ego_camera_shows_apple_and_plate(env):
    """(d) Render one ego frame: red apple pixels AND white plate pixels must
    both be present in the tabletop (lower ~70%) region."""
    obs, _ = env.reset(seed=4)
    img = obs["image"]
    lower = img[int(0.3 * img.shape[0]) :, :, :].astype(np.int32)
    red = (lower[:, :, 0] > 140) & (lower[:, :, 1] < 90) & (lower[:, :, 2] < 90)
    white = (lower[:, :, 0] > 190) & (lower[:, :, 1] > 190) & (lower[:, :, 2] > 190)
    assert int(red.sum()) > 200, f"apple not visible: {int(red.sum())} red px"
    assert int(white.sum()) > 1000, f"plate not visible: {int(white.sum())} white px"

    if _SCENE_CHECK_DIR and os.path.isdir(_SCENE_CHECK_DIR):
        from PIL import Image

        Image.fromarray(img).save(
            os.path.join(_SCENE_CHECK_DIR, "scene_check.jpg"), quality=92
        )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
