"""
@file evaluate_vla.py
@description Closed-loop VLA evaluation in MuJoCo simulation.

Connects a MuJoCo gym environment to the VLA inference server and runs
evaluation episodes. Outputs metrics as JSON for the Node.js server to consume.

Usage:
    python evaluate_vla.py \\
      --vla-server http://localhost:8000 \\
      --environment so101_tabletop \\
      --task "Pick up the red cube and place it on the target" \\
      --episodes 10 \\
      --output /tmp/sim_results.json

Progress is printed to stdout as JSON lines:
    {"type": "progress", "episode": 3, "total": 10, "percent": 30}
    {"type": "episode_result", "episode": 3, "success": true, "steps": 42}
"""

import argparse
import base64
import io
import json
import logging
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


def encode_image_b64(rgb_array: np.ndarray) -> str:
    """Encode an RGB numpy array as base64 JPEG string."""
    img = Image.fromarray(rgb_array)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


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
    # Import from sibling package
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
    from backends.smolvla_backend import SmolVLABackend

    backend = SmolVLABackend(timeout=timeout)
    backend.connect(server_url, {"timeout": timeout})
    return backend


def run_episode(
    env: SO101TabletopEnv,
    backend,
    task: str,
    max_steps: int,
) -> dict:
    """Run a single evaluation episode.

    Returns:
        dict with keys: success, steps, collisions, duration_s
    """
    obs, info = env.reset()
    t_start = time.time()
    total_collisions = 0
    step_count = 0

    # Reset VLA policy state
    try:
        import httpx
        httpx.post(f"{backend.server_url}/reset", timeout=5.0)
    except Exception:
        pass  # reset is optional

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
            except Exception as e:
                logger.error(f"Predict failed at step {step_count}: {e}")
                break

        # Execute next action from chunk
        action = action_queue.pop(0)
        action = np.array(action, dtype=np.float32)

        obs, reward, terminated, truncated, info = env.step(action)
        step_count += 1
        total_collisions += info.get("collision_count", 0)

        if terminated or truncated:
            break

    duration_s = time.time() - t_start
    success = info.get("success", False)

    return {
        "success": success,
        "steps": step_count,
        "collisions": total_collisions,
        "duration_s": duration_s,
    }


def evaluate(
    server_url: str,
    environment: str,
    task: str,
    episodes: int,
    max_steps: int,
    output_path: str | None = None,
) -> SimRunMetrics:
    """Run a full evaluation and return aggregated metrics."""

    logger.info(
        f"Starting evaluation: server={server_url}, env={environment}, "
        f"episodes={episodes}, max_steps={max_steps}"
    )

    # Create environment
    env = SO101TabletopEnv(max_steps=max_steps)

    # Connect to VLA server
    backend = connect_backend(server_url)
    logger.info(f"Connected to VLA server, cameras={backend.camera_names}")

    results = []
    try:
        for ep in range(1, episodes + 1):
            logger.info(f"Episode {ep}/{episodes}")
            result = run_episode(env, backend, task, max_steps)
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

    # Write output JSON
    if output_path:
        with open(output_path, "w") as f:
            json.dump(metrics.to_dict(), f, indent=2)
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
    args = parser.parse_args()

    metrics = evaluate(
        server_url=args.vla_server,
        environment=args.environment,
        task=args.task,
        episodes=args.episodes,
        max_steps=args.max_steps,
        output_path=args.output,
    )

    # Also print final metrics as JSON line for the server
    final = {"type": "result", **metrics.to_dict()}
    print(json.dumps(final), flush=True)


if __name__ == "__main__":
    main()
