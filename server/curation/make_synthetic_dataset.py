#!/usr/bin/env python3
"""Generate a tiny, valid LeRobot v2.1 on-disk dataset for testing curation.

Produces the parquet + meta layout that ``curate.py`` operates on, without
needing torch/lerobot. Useful for developing and testing the trim/delete
curation tooling on a Mac with no real robot data.

Layout produced (use_videos=False to stay light):
  <root>/meta/info.json
  <root>/meta/episodes.jsonl
  <root>/meta/tasks.jsonl
  <root>/data/chunk-000/episode_000000.parquet ...
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

CODEBASE_VERSION = "v2.1"
CHUNK_SIZE = 1000


def build(root: Path, num_episodes: int, frames: int, action_dim: int, fps: int, robot_type: str) -> None:
    data_dir = root / "data" / "chunk-000"
    meta_dir = root / "meta"
    data_dir.mkdir(parents=True, exist_ok=True)
    meta_dir.mkdir(parents=True, exist_ok=True)

    state_dim = action_dim
    tasks = ["pick up the cube", "place the cube"]
    episodes_meta = []
    global_index = 0

    for ep in range(num_episodes):
        ep_len = frames + ep  # vary length slightly per episode
        task_index = ep % len(tasks)
        cols = {
            "observation.state": [],
            "action": [],
            "timestamp": [],
            "frame_index": [],
            "episode_index": [],
            "index": [],
            "task_index": [],
        }
        for f in range(ep_len):
            phase = (f / max(ep_len - 1, 1)) * 2 * math.pi
            vec = [round(math.sin(phase + j * 0.1), 4) for j in range(action_dim)]
            cols["observation.state"].append(vec)
            cols["action"].append(vec)
            cols["timestamp"].append(round(f / fps, 6))
            cols["frame_index"].append(f)
            cols["episode_index"].append(ep)
            cols["index"].append(global_index)
            cols["task_index"].append(task_index)
            global_index += 1

        table = pa.table({
            "observation.state": pa.array(cols["observation.state"], type=pa.list_(pa.float32())),
            "action": pa.array(cols["action"], type=pa.list_(pa.float32())),
            "timestamp": pa.array(cols["timestamp"], type=pa.float32()),
            "frame_index": pa.array(cols["frame_index"], type=pa.int64()),
            "episode_index": pa.array(cols["episode_index"], type=pa.int64()),
            "index": pa.array(cols["index"], type=pa.int64()),
            "task_index": pa.array(cols["task_index"], type=pa.int64()),
        })
        pq.write_table(table, data_dir / f"episode_{ep:06d}.parquet")
        episodes_meta.append({"episode_index": ep, "tasks": [tasks[task_index]], "length": ep_len})

    info = {
        "codebase_version": CODEBASE_VERSION,
        "robot_type": robot_type,
        "fps": fps,
        "total_episodes": num_episodes,
        "total_frames": global_index,
        "total_tasks": len(tasks),
        "total_videos": 0,
        "total_chunks": 1,
        "chunks_size": CHUNK_SIZE,
        "data_path": "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet",
        "video_path": None,
        "splits": {"train": f"0:{num_episodes}"},
        "features": {
            "observation.state": {"dtype": "float32", "shape": [state_dim], "names": None},
            "action": {"dtype": "float32", "shape": [action_dim], "names": None},
            "timestamp": {"dtype": "float32", "shape": [1], "names": None},
            "frame_index": {"dtype": "int64", "shape": [1], "names": None},
            "episode_index": {"dtype": "int64", "shape": [1], "names": None},
            "index": {"dtype": "int64", "shape": [1], "names": None},
            "task_index": {"dtype": "int64", "shape": [1], "names": None},
        },
    }
    (meta_dir / "info.json").write_text(json.dumps(info, indent=2))
    with (meta_dir / "episodes.jsonl").open("w") as fh:
        for e in episodes_meta:
            fh.write(json.dumps(e) + "\n")
    with (meta_dir / "tasks.jsonl").open("w") as fh:
        for i, t in enumerate(tasks):
            fh.write(json.dumps({"task_index": i, "task": t}) + "\n")

    print(f"Wrote synthetic dataset: {num_episodes} episodes, {global_index} frames -> {root}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate a synthetic LeRobot v2.1 dataset")
    ap.add_argument("root", type=Path)
    ap.add_argument("--episodes", type=int, default=4)
    ap.add_argument("--frames", type=int, default=20)
    ap.add_argument("--action-dim", type=int, default=43)  # G1 EDU + Dex3
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--robot-type", default="unitree_g1_edu_dex3")
    args = ap.parse_args()
    build(args.root, args.episodes, args.frames, args.action_dim, args.fps, args.robot_type)


if __name__ == "__main__":
    main()
