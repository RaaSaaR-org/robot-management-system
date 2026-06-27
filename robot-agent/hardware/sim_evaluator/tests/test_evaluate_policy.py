"""
@file test_evaluate_policy.py
@description Tests the sim-RL gate path (TASK-172.C Phase 3): PolicyBackend loads
    a policy.onnx + obs-norm stats and reproduces the train-time transform, and
    evaluate_policy.py rolls it out in MuJoCo emitting the same JSON schema as
    evaluate_vla.py. Uses a hand-built onnx graph — no torch / stable-baselines3.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))

mujoco = pytest.importorskip("mujoco")
onnx = pytest.importorskip("onnx")
pytest.importorskip("onnxruntime")

from envs.nav_wrappers import ACTION_DIM, NAV_OBS_DIM  # noqa: E402
from policy_backend import PolicyBackend  # noqa: E402


def _build_linear_onnx(path: Path, weight: np.ndarray, bias: np.ndarray) -> None:
    """Write a minimal onnx graph: action = obs @ weight + bias.

    Input  'obs'    float32 [N, 61]
    Output 'action' float32 [N, 29]
    """
    from onnx import TensorProto, helper, numpy_helper

    w_init = numpy_helper.from_array(weight.astype(np.float32), name="W")
    b_init = numpy_helper.from_array(bias.astype(np.float32), name="b")
    obs_in = helper.make_tensor_value_info("obs", TensorProto.FLOAT, [None, NAV_OBS_DIM])
    act_out = helper.make_tensor_value_info("action", TensorProto.FLOAT, [None, ACTION_DIM])
    matmul = helper.make_node("MatMul", ["obs", "W"], ["mm"])
    add = helper.make_node("Add", ["mm", "b"], ["action"])
    graph = helper.make_graph([matmul, add], "linear_policy", [obs_in], [act_out],
                              initializer=[w_init, b_init])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 9  # compatible with onnxruntime
    onnx.checker.check_model(model)
    onnx.save(model, str(path))


def test_policy_backend_identity_norm(tmp_path):
    """No obs_norm in manifest -> identity normalization; onnx output is returned."""
    rng = np.random.default_rng(0)
    weight = rng.standard_normal((NAV_OBS_DIM, ACTION_DIM)).astype(np.float32)
    bias = rng.standard_normal(ACTION_DIM).astype(np.float32)
    policy = tmp_path / "policy.onnx"
    _build_linear_onnx(policy, weight, bias)

    backend = PolicyBackend.from_artifacts(policy)  # no manifest
    obs = rng.standard_normal(NAV_OBS_DIM).astype(np.float32)
    action = backend.predict(obs)

    assert action.shape == (ACTION_DIM,)
    np.testing.assert_allclose(action, obs @ weight + bias, rtol=1e-4, atol=1e-4)


def test_policy_backend_applies_vecnormalize_formula(tmp_path):
    """obs_norm stats reproduce SB3 VecNormalize.normalize_obs exactly."""
    rng = np.random.default_rng(1)
    weight = np.zeros((NAV_OBS_DIM, ACTION_DIM), dtype=np.float32)
    bias = rng.standard_normal(ACTION_DIM).astype(np.float32)
    policy = tmp_path / "policy.onnx"
    _build_linear_onnx(policy, weight, bias)

    mean = rng.standard_normal(NAV_OBS_DIM).astype(np.float32)
    var = (rng.random(NAV_OBS_DIM).astype(np.float32) + 0.5)  # strictly positive
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({
        "kind": "sim_rl",
        "obs_norm": {"mean": mean.tolist(), "var": var.tolist(),
                     "clip": 10.0, "epsilon": 1e-8},
    }))

    backend = PolicyBackend.from_artifacts(policy, manifest)
    obs = rng.standard_normal(NAV_OBS_DIM).astype(np.float32)

    expected = np.clip((obs - mean) / np.sqrt(var + 1e-8), -10.0, 10.0)
    np.testing.assert_allclose(backend.normalize_obs(obs), expected, rtol=1e-5, atol=1e-5)
    # weight is zero -> action == bias regardless of obs (graph sanity)
    np.testing.assert_allclose(backend.predict(obs), bias, rtol=1e-4, atol=1e-4)


def test_evaluate_policy_end_to_end(tmp_path):
    """evaluate_policy.evaluate runs N rollouts and writes evaluate_vla's schema."""
    import evaluate_policy

    weight = np.zeros((NAV_OBS_DIM, ACTION_DIM), dtype=np.float32)
    bias = np.zeros(ACTION_DIM, dtype=np.float32)
    policy = tmp_path / "policy.onnx"
    _build_linear_onnx(policy, weight, bias)  # zero policy

    out = tmp_path / "results.json"
    frames = tmp_path / "frames"
    metrics = evaluate_policy.evaluate(
        policy_file=str(policy),
        episodes=2,
        max_steps=5,
        output_path=str(out),
        frames_dir=str(frames),
        scene_file=None,  # bundled g1_empty_scene.xml
    )

    assert metrics.total_episodes == 2
    data = json.loads(out.read_text())
    # Same schema as evaluate_vla.py (metrics.SimRunMetrics.to_dict + frames).
    for key in ("successRate", "avgStepsToCompletion", "collisionCount",
                "avgEpisodeDuration", "totalEpisodes", "successfulEpisodes"):
        assert key in data, f"missing {key}"
    assert data["totalEpisodes"] == 2
    assert isinstance(data["frames"], list) and len(data["frames"]) > 0
    assert (frames / "preview.jpg").exists()


def test_eval_env_varies_spawn_per_episode():
    """The gate's spawn-only DR gives each episode a different start pose, so
    success_rate samples a distribution instead of repeating one byte-identical
    rollout (TASK-172.C review finding) — and is reproducible for a fixed seed."""
    from envs.nav_wrappers import make_nav_env

    env = make_nav_env(
        scene_path=None,  # bundled g1_empty_scene.xml
        obs_mode="state",
        max_steps=5,
        shaped=False,
        domain_rand=True,
        dr_kwargs={
            "spawn_radius": 0.5,
            "friction_range": (1.0, 1.0),
            "mass_scale_range": (1.0, 1.0),
            "latency_steps_range": (0, 0),
        },
    )
    try:
        obs_a, _ = env.reset(seed=1)
        obs_b, _ = env.reset(seed=2)
        # Different seeds → different spawn → different goal-relative obs.
        assert not np.allclose(obs_a, obs_b)
        # Same seed → reproducible (deterministic gate).
        obs_a2, _ = env.reset(seed=1)
        np.testing.assert_allclose(obs_a, obs_a2)
    finally:
        env.close()
