"""
@file test_g1_env.py
@description Tests for the 29-DOF G1 gym env and the bundled G1 MJCF model.
    Skipped entirely when mujoco is not installed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

# Make the package importable when run as `pytest tests/`.
_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))

# Whole module requires mujoco.
mujoco = pytest.importorskip("mujoco")

from scene_builder import TwinSceneInput, TwinZoneSpec, write_scene  # noqa: E402


def test_bundled_g1_model_loads():
    """The standalone empty G1 scene (and thus mjcf/g1/g1_29dof.xml) loads."""
    scene = _ROOT / "mjcf" / "g1" / "g1_empty_scene.xml"
    m = mujoco.MjModel.from_xml_path(str(scene))
    assert m.nu == 29, f"expected 29 actuators, got {m.nu}"
    # 29 hinge joints + 1 freejoint
    assert m.njnt == 30, f"expected 30 joints, got {m.njnt}"


def test_g1_29dof_loads_via_scene():
    """g1_29dof.xml loads when included by a scene (it is an include file)."""
    # Build a tiny twin scene and load it — exercises the include path.
    scene = TwinSceneInput(
        aabb=(0.0, 0.0, 0.0, 2.0, 2.0, 2.5),
        zones=[
            TwinZoneSpec("dock", "charging",
                         [(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)]),
        ],
    )
    out = _ROOT / "mjcf" / "_test_twin_scene.xml"
    try:
        write_scene(scene, str(out), g1_include="g1/g1_29dof.xml")
        m = mujoco.MjModel.from_xml_path(str(out))
        assert m.nu == 29
        # head_camera should be available from the include.
        assert mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_CAMERA, "head_camera") != -1
        assert mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_SITE, "goal_site") != -1
    finally:
        out.unlink(missing_ok=True)


def test_g1_env_from_twin_scene(tmp_path):
    from envs.g1_env import G1Env

    scene = TwinSceneInput(
        aabb=(0.0, 0.0, 0.0, 2.0, 2.0, 2.5),
        zones=[
            TwinZoneSpec("dock", "charging",
                         [(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)]),
            TwinZoneSpec("bench", "workcell",
                         [(1.4, 1.4), (1.9, 1.4), (1.9, 1.9), (1.4, 1.9)]),
        ],
    )
    scene_file = tmp_path / "scene.mjcf.xml"
    # The g1_include must resolve from the scene file's directory, so the scene
    # file must live next to (or pointing at) the mjcf dir. Use an absolute
    # include path so it resolves from tmp_path.
    abs_include = str(_ROOT / "mjcf" / "g1" / "g1_29dof.xml")
    write_scene(scene, str(scene_file), g1_include=abs_include)

    env = G1Env(scene_path=str(scene_file), max_steps=10)
    try:
        assert env.action_space.shape == (29,)
        obs, info = env.reset()
        assert obs["state"].shape == (58,)
        assert obs["image"].shape == (224, 224, 3)
        assert obs["image"].dtype == np.uint8

        result = env.step(np.zeros(29, dtype=np.float32))
        assert len(result) == 5
        obs2, reward, terminated, truncated, info2 = result
        assert obs2["state"].shape == (58,)
        assert isinstance(reward, float)
        assert isinstance(terminated, bool)
        assert isinstance(truncated, bool)
        assert "success" in info2 and "distance" in info2
    finally:
        env.close()


def test_g1_env_fallback_scene():
    """G1Env with no scene_path uses the bundled empty scene."""
    from envs.g1_env import G1Env

    env = G1Env(max_steps=5)
    try:
        assert env.action_space.shape == (29,)
        obs, _info = env.reset()
        assert obs["state"].shape == (58,)
        # step until termination/truncation to confirm the loop runs.
        for _ in range(5):
            obs, reward, term, trunc, info = env.step(np.zeros(29, dtype=np.float32))
            if term or trunc:
                break
        assert isinstance(reward, float)
    finally:
        env.close()
