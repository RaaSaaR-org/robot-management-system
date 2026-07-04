"""
@file test_locomotion_parity.py
@description GPU-host-only tripwire: the observation an Isaac Lab
    ``Isaac-Velocity-Flat-G1-v0`` policy actually consumes must match what the
    MuJoCo gate reproduces via ``locomotion_wrappers`` on the *same* base state.
    This is the sim-to-sim (PhysX↔MuJoCo) obs-drift guard.

Skipped anywhere Isaac Lab is not installed (i.e. always on the Mac). It runs on
the pinned Linux/CUDA Isaac host as the correctness gate before trusting a
trained gait policy. See ``../sim-trainer/trainers/isaac_ppo.py`` for the pinned
task and the ``joint_order`` permutation the policy is trained against.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))

pytest.importorskip("isaaclab", reason="Isaac Lab only exists on the GPU host")
pytest.importorskip("mujoco")

from envs.locomotion_wrappers import LOCO_OBS_DIM  # noqa: E402


def test_isaac_obs_dim_matches_gate_contract():
    """The shipped Isaac task's *policy* obs dim must equal the gate contract.

    A mismatch here is the exact failure the trainer's build-time assert
    (``obs_dim == LOCO_OBS_DIM``) also catches — reproduced on the gate side so a
    contract drift is caught from either repo. Populated on the host, where the
    Isaac env is constructable.
    """
    import gymnasium as gym  # noqa: F401

    # On the host: build the Isaac env cfg exactly as isaac_ppo._load_cfgs does,
    # read env.observation_space["policy"].shape[-1], and assert == LOCO_OBS_DIM.
    # Left as an explicit skip until wired against the pinned Isaac Lab install so
    # the intent is discoverable without a silent pass.
    pytest.skip(
        f"wire against the pinned Isaac env on the GPU host; expected "
        f"policy obs dim == {LOCO_OBS_DIM}"
    )
