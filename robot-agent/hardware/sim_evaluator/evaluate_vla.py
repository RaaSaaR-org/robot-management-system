"""
@file evaluate_vla.py
@description Closed-loop VLA evaluation in MuJoCo simulation.

Connects a MuJoCo gym environment to the VLA inference server and runs
evaluation episodes. Outputs metrics as JSON for the Node.js server to consume.
Optionally captures key frames as JPEG images for visualization in the UI.

Usage:
    python evaluate_vla.py \\
      --vla-server http://localhost:8000 \\
      --episodes 10 \\
      --output /tmp/sim_results.json \\
      --frames-dir /tmp/sim_frames

Progress is printed to stdout as JSON lines:
    {"type": "progress", "episode": 3, "total": 10, "percent": 30}
    {"type": "episode_result", "episode": 3, "success": true, "steps": 42}
@status live
"""

import argparse
import base64
import io
import json
import logging
import os
import sys
import time

import numpy as np
from PIL import Image

from envs.so101_tabletop_env import SO101TabletopEnv
from metrics import SimRunMetrics

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Capture a frame every N steps (plus first and last)
FRAME_INTERVAL = 10


def encode_image_b64(rgb_array: np.ndarray) -> str:
    """Encode an RGB numpy array as base64 JPEG string."""
    img = Image.fromarray(rgb_array)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def save_frame(rgb_array: np.ndarray, path: str) -> None:
    """Save an RGB numpy array as a JPEG file."""
    img = Image.fromarray(rgb_array)
    img.save(path, format="JPEG", quality=90)


def emit_progress(episode: int, total: int):
    """Print a progress JSON line to stdout for the Node.js server."""
    percent = int((episode / total) * 100)
    msg = {"type": "progress", "episode": episode, "total": total, "percent": percent}
    print(json.dumps(msg), flush=True)


def emit_episode_result(episode: int, success: bool, steps: int):
    """Print an episode result JSON line to stdout."""
    msg = {"type": "episode_result", "episode": episode, "success": bool(success), "steps": int(steps)}
    print(json.dumps(msg), flush=True)


def connect_backend(server_url: str, timeout: float = 10.0):
    """Connect to VLA server via SmolVLABackend."""
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
    from backends.smolvla_backend import SmolVLABackend

    backend = SmolVLABackend(timeout=timeout)
    backend.connect(server_url, {"timeout": timeout})
    return backend


def run_episode(
    env,
    backend,
    task: str,
    max_steps: int,
    frames_dir: str | None = None,
    episode_num: int = 1,
    exec_horizon: int = 0,
) -> dict:
    """Run a single evaluation episode.

    Returns:
        dict with keys: success, steps, collisions, duration_s, frames
    """
    obs, info = env.reset()
    t_start = time.time()
    total_collisions = 0
    step_count = 0
    captured_frames: list[dict] = []

    # Capture first frame
    if frames_dir:
        filename = f"ep{episode_num}_step000.jpg"
        save_frame(obs["image"], os.path.join(frames_dir, filename))
        captured_frames.append({"episode": episode_num, "step": 0, "file": filename})

    # Reset VLA policy state
    try:
        import httpx
        httpx.post(f"{backend.server_url}/reset", timeout=5.0)
    except Exception:
        pass

    action_queue = []

    while step_count < max_steps:
        # Refill action queue if empty
        if not action_queue:
            img_b64 = encode_image_b64(obs["image"])
            state = obs["state"].tolist()
            images = {cam: img_b64 for cam in backend.camera_names}

            try:
                actions = backend.predict(images, np.array(state), task)
                action_queue = list(actions)
                # exec_horizon > 0: execute only the first N actions of each
                # chunk, then re-predict (receding-horizon execution).
                if exec_horizon > 0:
                    action_queue = action_queue[:exec_horizon]
            except Exception as e:
                logger.error(f"Predict failed at step {step_count}: {e}")
                break

        # Execute next action from chunk
        action = action_queue.pop(0)
        action = np.array(action, dtype=np.float32)

        obs, reward, terminated, truncated, info = env.step(action)
        step_count += 1
        total_collisions += info.get("collision_count", 0)

        # Capture frame at interval
        if frames_dir and step_count % FRAME_INTERVAL == 0:
            filename = f"ep{episode_num}_step{step_count:03d}.jpg"
            save_frame(obs["image"], os.path.join(frames_dir, filename))
            captured_frames.append({"episode": episode_num, "step": step_count, "file": filename})

        if terminated or truncated:
            break

    # Capture last frame (if not already captured at interval)
    if frames_dir and (step_count % FRAME_INTERVAL != 0):
        filename = f"ep{episode_num}_step{step_count:03d}.jpg"
        save_frame(obs["image"], os.path.join(frames_dir, filename))
        captured_frames.append({"episode": episode_num, "step": step_count, "file": filename})

    duration_s = time.time() - t_start
    success = info.get("success", False)

    return {
        "success": success,
        "steps": step_count,
        "collisions": total_collisions,
        "duration_s": duration_s,
        "frames": captured_frames,
    }


def evaluate(
    server_url: str,
    environment: str,
    task: str,
    episodes: int,
    max_steps: int,
    output_path: str | None = None,
    frames_dir: str | None = None,
    scene_file: str | None = None,
    embodiment: str = "so101",
    exec_horizon: int = 0,
) -> SimRunMetrics:
    """Run a full evaluation and return aggregated metrics."""

    logger.info(
        f"Starting evaluation: server={server_url}, env={environment}, "
        f"episodes={episodes}, max_steps={max_steps}, "
        f"embodiment={embodiment}, scene_file={scene_file}"
    )

    # Create frames directory
    if frames_dir:
        os.makedirs(frames_dir, exist_ok=True)

    # Create environment.
    # g1_dex3 path: the fixed-base G1+Dex3 tabletop pick-place env (WS2).
    # scene_file is optional and defaults to the bundled pick-place scene.
    # G1 path: a twin-derived scene file OR an explicit g1 embodiment selects the
    # 29-DOF humanoid env. Otherwise keep the default SO-101 tabletop env.
    if embodiment == "g1_apple_pnp":
        # g1_apple_pnp path: NVIDIA GR00T E2E apple-to-plate parity env
        # (43-dim state / 31-dim action, bundled g1_apple_pnp_scene.xml).
        from envs.g1_apple_env import G1ApplePnPEnv

        env = G1ApplePnPEnv(scene_path=scene_file, max_steps=max_steps)
    elif embodiment == "g1_dex3":
        from envs.g1_pickplace_env import G1PickPlaceEnv

        env = G1PickPlaceEnv(scene_path=scene_file, max_steps=max_steps)
    elif scene_file or embodiment == "g1":
        # Import lazily so the SO-101 path never depends on the G1 env loading.
        from envs.g1_env import G1Env

        env = G1Env(scene_path=scene_file, max_steps=max_steps)
    else:
        env = SO101TabletopEnv(max_steps=max_steps)

    # Connect to VLA server
    backend = connect_backend(server_url)
    logger.info(f"Connected to VLA server, cameras={backend.camera_names}")

    # Render scene preview before episodes start
    if frames_dir:
        preview_obs, _ = env.reset()
        save_frame(preview_obs["image"], os.path.join(frames_dir, "preview.jpg"))
        logger.info(f"Scene preview saved to {frames_dir}/preview.jpg")

    results = []
    all_frames: list[dict] = []
    try:
        for ep in range(1, episodes + 1):
            logger.info(f"Episode {ep}/{episodes}")
            result = run_episode(
                env, backend, task, max_steps, frames_dir, ep, exec_horizon
            )
            all_frames.extend(result.pop("frames", []))
            results.append(result)

            emit_episode_result(ep, result["success"], result["steps"])
            emit_progress(ep, episodes)

            logger.info(
                f"  -> success={result['success']}, steps={result['steps']}, "
                f"collisions={result['collisions']}, duration={result['duration_s']:.1f}s"
            )
    finally:
        backend.disconnect()
        env.close()

    # Aggregate metrics
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

    logger.info(f"Evaluation complete: {metrics}")
    if frames_dir:
        logger.info(f"Captured {len(all_frames)} frames in {frames_dir}")

    # Write output JSON (including frames manifest)
    if output_path:
        output = metrics.to_dict()
        output["frames"] = all_frames
        with open(output_path, "w") as f:
            json.dump(output, f, indent=2)
        logger.info(f"Results written to {output_path}")

    return metrics


def main():
    parser = argparse.ArgumentParser(description="Closed-loop VLA evaluation in MuJoCo")
    parser.add_argument(
        "--vla-server",
        default="http://localhost:8000",
        help="VLA inference server URL",
    )
    parser.add_argument(
        "--environment",
        default="so101_tabletop",
        help="Environment name",
    )
    parser.add_argument(
        "--task",
        default="Pick up the red cube and place it on the target.",
        help="Task instruction for the VLA policy",
    )
    parser.add_argument(
        "--episodes",
        type=int,
        default=10,
        help="Number of evaluation episodes",
    )
    parser.add_argument(
        "--max-steps",
        type=int,
        default=200,
        help="Maximum steps per episode",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Path to write results JSON",
    )
    parser.add_argument(
        "--frames-dir",
        default=None,
        help="Directory to save captured frames (JPEG images)",
    )
    parser.add_argument(
        "--scene-file",
        default=None,
        help="Path to a local MJCF scene file (e.g. a twin-derived G1 scene). "
        "When set, the G1 environment is used.",
    )
    parser.add_argument(
        "--embodiment",
        default="so101",
        help="Robot embodiment: 'so101' (default), 'g1' (29-DOF humanoid), "
        "'g1_dex3' (fixed-base G1+Dex3 tabletop pick-place), or "
        "'g1_apple_pnp' (fixed-base G1+Dex3 apple-to-plate, NVIDIA workflow).",
    )
    parser.add_argument(
        "--exec-horizon",
        type=int,
        default=0,
        help="Execute only the first N actions of each predicted chunk before "
        "re-predicting (0 = execute the full chunk, default).",
    )
    args = parser.parse_args()

    metrics = evaluate(
        server_url=args.vla_server,
        environment=args.environment,
        task=args.task,
        episodes=args.episodes,
        max_steps=args.max_steps,
        output_path=args.output,
        frames_dir=args.frames_dir,
        scene_file=args.scene_file,
        embodiment=args.embodiment,
        exec_horizon=args.exec_horizon,
    )

    # Also print final metrics as JSON line for the server
    final = {"type": "result", **metrics.to_dict()}
    print(json.dumps(final), flush=True)


if __name__ == "__main__":
    main()
