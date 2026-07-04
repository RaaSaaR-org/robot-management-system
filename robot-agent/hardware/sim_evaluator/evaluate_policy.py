"""
@file evaluate_policy.py
@description Closed-loop evaluation of a trained sim-RL navigation policy in
    MuJoCo (TASK-172.C Phase 3).

The RL counterpart of ``evaluate_vla.py``: instead of querying a VLA server it
loads a ``policy.onnx`` locally (``policy_backend.PolicyBackend``) and steps the
shared navigation env (``nav_wrappers.make_nav_env``) for N rollouts. It emits
the *same* stdout JSON lines and writes the *same* output schema
(``metrics.SimRunMetrics.to_dict()`` + ``frames``) as ``evaluate_vla.py``, so
``SimulationService`` consumes it identically and the resulting
``simSuccessRate`` flows through the sim-only ``SimToRealValidation`` gate.

Usage:
    python evaluate_policy.py \\
      --policy-file /path/policy.onnx \\
      --manifest-file /path/manifest.json \\
      --scene-file /path/scene.xml \\
      --episodes 10 --max-steps 200 \\
      --output /tmp/results.json --frames-dir /tmp/frames

@status live
"""

import argparse
import json
import logging
import os
import time

import numpy as np
from PIL import Image

from envs.nav_wrappers import make_nav_env
from metrics import SimRunMetrics
from policy_backend import PolicyBackend

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

FRAME_INTERVAL = 10

# manifest.control keys forwarded to make_locomotion_env (guards against extra /
# debug keys in the manifest reaching the env constructor).
_LOCO_CONTROL_KEYS = {
    "command", "action_scale", "default_joint_pos", "pd_gains", "control_hz",
    "joint_order", "obs_scales", "success_cfg",
}


def _read_manifest(manifest_file: str | None, policy_file: str) -> dict:
    """Load the policy manifest (defaults to manifest.json next to the policy).

    A missing/unreadable manifest falls back to ``{}`` — the caller then defaults
    to the nav env, preserving behaviour for pre-existing nav policies.
    """
    from pathlib import Path

    path = manifest_file
    if path is None:
        cand = Path(policy_file).parent / "manifest.json"
        path = str(cand) if cand.exists() else None
    if path and Path(path).exists():
        try:
            return json.loads(Path(path).read_text())
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Manifest %s unreadable (%s) — assuming nav env", path, e)
    return {}


def _build_eval_env(manifest: dict, scene_file, max_steps: int, eval_spawn_radius: float):
    """Dispatch the eval env on ``manifest['env']`` (default 'nav').

    The manifest is the sim-to-sim contract: a 'locomotion' policy rebuilds the
    Isaac-matched MuJoCo env from its ``control`` block; a 'nav' policy (or any
    manifest without ``env``) uses the unchanged navigation env.
    """
    env_kind = (manifest.get("env") or "nav").lower()
    if env_kind == "locomotion":
        from envs.locomotion_wrappers import make_locomotion_env

        control = {
            k: v for k, v in (manifest.get("control") or {}).items()
            if k in _LOCO_CONTROL_KEYS
        }
        logger.info("Building locomotion eval env from manifest control block")
        return make_locomotion_env(scene_path=scene_file, max_steps=max_steps, **control)

    # nav (default, unchanged) — spawn-only DR with nominal physics so the N
    # rollouts sample the success distribution the policy was trained on.
    return make_nav_env(
        scene_path=scene_file,
        obs_mode="state",
        max_steps=max_steps,
        shaped=False,
        domain_rand=True,
        dr_kwargs={
            "spawn_radius": eval_spawn_radius,
            "friction_range": (1.0, 1.0),
            "mass_scale_range": (1.0, 1.0),
            "latency_steps_range": (0, 0),
        },
    )


def save_frame(rgb_array: np.ndarray, path: str) -> None:
    Image.fromarray(rgb_array).save(path, format="JPEG", quality=90)


def emit_progress(episode: int, total: int):
    percent = int((episode / total) * 100)
    print(
        json.dumps(
            {"type": "progress", "episode": episode, "total": total, "percent": percent}
        ),
        flush=True,
    )


def emit_episode_result(episode: int, success: bool, steps: int):
    print(
        json.dumps(
            {
                "type": "episode_result",
                "episode": episode,
                "success": bool(success),
                "steps": int(steps),
            }
        ),
        flush=True,
    )


def run_episode(
    env,
    backend: PolicyBackend,
    max_steps: int,
    frames_dir: str | None = None,
    episode_num: int = 1,
    seed: int | None = None,
) -> dict:
    """Roll out one episode under the policy. Mirrors evaluate_vla.run_episode.

    ``seed`` makes the per-episode domain-randomized spawn reproducible, so the
    gate samples a fixed-but-varied set of start poses across rollouts.
    """
    obs, info = env.reset(seed=seed)
    base = env.unwrapped
    t_start = time.time()
    total_collisions = 0
    step_count = 0
    captured_frames: list[dict] = []

    if frames_dir:
        filename = f"ep{episode_num}_step000.jpg"
        save_frame(base.capture_frame(), os.path.join(frames_dir, filename))
        captured_frames.append({"episode": episode_num, "step": 0, "file": filename})

    while step_count < max_steps:
        action = backend.predict(obs)
        obs, reward, terminated, truncated, info = env.step(action)
        step_count += 1
        total_collisions += int(info.get("collision_count", 0))

        if frames_dir and step_count % FRAME_INTERVAL == 0:
            filename = f"ep{episode_num}_step{step_count:03d}.jpg"
            save_frame(base.capture_frame(), os.path.join(frames_dir, filename))
            captured_frames.append(
                {"episode": episode_num, "step": step_count, "file": filename}
            )

        if terminated or truncated:
            break

    if frames_dir and (step_count % FRAME_INTERVAL != 0):
        filename = f"ep{episode_num}_step{step_count:03d}.jpg"
        save_frame(base.capture_frame(), os.path.join(frames_dir, filename))
        captured_frames.append(
            {"episode": episode_num, "step": step_count, "file": filename}
        )

    return {
        "success": bool(info.get("success", False)),
        "steps": step_count,
        "collisions": total_collisions,
        "duration_s": time.time() - t_start,
        "frames": captured_frames,
    }


def evaluate(
    policy_file: str,
    episodes: int,
    max_steps: int,
    manifest_file: str | None = None,
    output_path: str | None = None,
    frames_dir: str | None = None,
    scene_file: str | None = None,
    seed: int = 0,
    eval_spawn_radius: float = 0.5,
) -> SimRunMetrics:
    """Run a full policy evaluation and return aggregated metrics."""
    logger.info(
        "Starting policy evaluation: policy=%s, episodes=%d, max_steps=%d, scene=%s",
        policy_file,
        episodes,
        max_steps,
        scene_file,
    )

    if frames_dir:
        os.makedirs(frames_dir, exist_ok=True)

    backend = PolicyBackend.from_artifacts(policy_file, manifest_file)

    # The manifest picks the env: a 'locomotion' policy rebuilds the Isaac-matched
    # MuJoCo locomotion env from its control block; anything else (incl. legacy nav
    # policies with no ``env`` field) uses the unchanged 61-dim navigation env. The
    # gate steps in obs_mode='state' (frames captured on demand) either way.
    manifest = _read_manifest(manifest_file, policy_file)
    env = _build_eval_env(manifest, scene_file, max_steps, eval_spawn_radius)

    if frames_dir:
        env.reset(seed=seed)
        save_frame(env.unwrapped.capture_frame(), os.path.join(frames_dir, "preview.jpg"))
        logger.info("Scene preview saved to %s/preview.jpg", frames_dir)

    results = []
    all_frames: list[dict] = []
    try:
        for ep in range(1, episodes + 1):
            logger.info("Episode %d/%d", ep, episodes)
            result = run_episode(env, backend, max_steps, frames_dir, ep, seed=seed + ep)
            all_frames.extend(result.pop("frames", []))
            results.append(result)
            emit_episode_result(ep, result["success"], result["steps"])
            emit_progress(ep, episodes)
            logger.info(
                "  -> success=%s, steps=%d, collisions=%d, duration=%.1fs",
                result["success"],
                result["steps"],
                result["collisions"],
                result["duration_s"],
            )
    finally:
        env.close()

    successful = [r for r in results if r["success"]]
    total = len(results)
    success_rate = len(successful) / total if total > 0 else 0.0
    avg_steps = (
        sum(r["steps"] for r in successful) / len(successful)
        if successful
        else float(max_steps)
    )
    total_collisions = sum(r["collisions"] for r in results)
    avg_duration = sum(r["duration_s"] for r in results) / total if total > 0 else 0.0

    metrics = SimRunMetrics(
        success_rate=round(success_rate, 3),
        avg_steps_to_completion=round(avg_steps, 1),
        collision_count=total_collisions,
        avg_episode_duration=round(avg_duration, 2),
        total_episodes=total,
        successful_episodes=len(successful),
    )

    logger.info("Evaluation complete: %s", metrics)
    if output_path:
        output = metrics.to_dict()
        output["frames"] = all_frames
        with open(output_path, "w") as f:
            json.dump(output, f, indent=2)
        logger.info("Results written to %s", output_path)

    return metrics


def main():
    parser = argparse.ArgumentParser(
        description="Closed-loop sim-RL navigation policy evaluation in MuJoCo"
    )
    parser.add_argument("--policy-file", required=True, help="Path to policy.onnx")
    parser.add_argument(
        "--manifest-file",
        default=None,
        help="Path to manifest.json carrying obs-norm stats (defaults to "
        "manifest.json next to the policy file)",
    )
    parser.add_argument(
        "--scene-file",
        default=None,
        help="Path to a twin-derived MJCF scene (falls back to the bundled "
        "g1_empty_scene.xml)",
    )
    parser.add_argument("--episodes", type=int, default=10)
    parser.add_argument("--max-steps", type=int, default=200)
    parser.add_argument("--output", default=None, help="Path to write results JSON")
    parser.add_argument(
        "--frames-dir", default=None, help="Directory to save captured JPEG frames"
    )
    parser.add_argument(
        "--seed", type=int, default=0,
        help="Base seed for the reproducible per-episode spawn randomization",
    )
    parser.add_argument(
        "--eval-spawn-radius", type=float, default=0.5,
        help="Radius (m) of the per-episode spawn jitter the gate samples over",
    )
    # Accepted for parity with evaluate_vla.py's CLI; the policy env is always G1.
    parser.add_argument("--embodiment", default="g1")
    args = parser.parse_args()

    metrics = evaluate(
        policy_file=args.policy_file,
        episodes=args.episodes,
        max_steps=args.max_steps,
        manifest_file=args.manifest_file,
        output_path=args.output,
        frames_dir=args.frames_dir,
        scene_file=args.scene_file,
        seed=args.seed,
        eval_spawn_radius=args.eval_spawn_radius,
    )

    print(json.dumps({"type": "result", **metrics.to_dict()}), flush=True)


if __name__ == "__main__":
    main()
