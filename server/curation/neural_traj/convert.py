"""RAW_DIR -> LeRobot v2.1 on-disk dataset converter (TASK-182).

Produces ``<out>/lerobot_neural_g1`` in the exact layout the RMS dataset
validator accepts (DatasetService.validateStructure — see the fixture test
``server/src/services/__tests__/synthetic-dataset-validation.test.ts``):

  meta/info.json            (+ ``_synthetic``/``_generator``/``_provenance``)
  meta/episodes.json        (array — the validator checks this exact name)
  meta/episodes.jsonl       (LeRobot tooling compatibility)
  meta/tasks.jsonl
  meta/stats.json
  data/chunk-000/episode_NNNNNN.parquet
  videos/observation.images.cam_right_high/chunk-000/episode_NNNNNN.mp4
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from .constants import (
    ACTION_DIM,
    CHUNK_SIZE,
    CODEBASE_VERSION,
    DATASET_SUBDIR,
    FPS,
    MODEL_NAME,
    ROBOT_TYPE,
    STATE_DIM,
    VIDEO_KEY,
)


def convert_dataset(out_root: Path) -> int:
    raw_dir = out_root / "raw"
    dataset_dir = out_root / DATASET_SUBDIR
    manifest_path = raw_dir / "manifest.json"
    if not manifest_path.exists():
        print(f"ERROR: no manifest at {manifest_path} — run `generate` first.")
        return 2
    manifest = [m for m in json.loads(manifest_path.read_text()) if m.get("ok")]
    if not manifest:
        print("ERROR: no successful generations to convert.")
        return 1

    provenance: dict = {}
    prov_path = raw_dir / "provenance.json"
    if prov_path.exists():
        provenance = json.loads(prov_path.read_text())
    backend = provenance.get("backend", "mock")

    if dataset_dir.exists():
        shutil.rmtree(dataset_dir)
    data_dir = dataset_dir / "data" / "chunk-000"
    meta_dir = dataset_dir / "meta"
    data_dir.mkdir(parents=True, exist_ok=True)
    meta_dir.mkdir(parents=True, exist_ok=True)

    tasks: list[str] = []
    episodes_meta: list[dict] = []
    global_index = 0
    total_videos = 0
    vid_w = vid_h = None

    for m in manifest:
        # episode index = number converted so far, so a skipped episode never
        # leaves a gap in the on-disk episode_NNNNNN sequence.
        ep = len(episodes_meta)
        try:
            jobdir = raw_dir / m["gen_id"]
            mp4 = jobdir / "video.mp4"
            if not mp4.exists():
                raise FileNotFoundError(f"missing {mp4}")
            traj = json.loads((jobdir / "trajectory.json").read_text())
            states = traj["states"]
            actions = traj["actions"]
            nframes = len(states)
            if nframes <= 0 or len(actions) != nframes:
                raise ValueError(f"trajectory length mismatch in {jobdir}")
            if any(len(row) != STATE_DIM for row in states):
                raise ValueError(f"state rows are not {STATE_DIM}-dim in {jobdir}")
            if vid_w is None:
                vid_w, vid_h = int(m["width"]), int(m["height"])

            task = m["prompt"]
            if task not in tasks:
                tasks.append(task)
            task_index = tasks.index(task)

            table = pa.table(
                {
                    "observation.state": pa.array(
                        [[float(x) for x in row] for row in states],
                        type=pa.list_(pa.float32()),
                    ),
                    "action": pa.array(
                        [[float(x) for x in row] for row in actions],
                        type=pa.list_(pa.float32()),
                    ),
                    "timestamp": pa.array(
                        [round(f / FPS, 6) for f in range(nframes)], type=pa.float32()
                    ),
                    "frame_index": pa.array(list(range(nframes)), type=pa.int64()),
                    "episode_index": pa.array([ep] * nframes, type=pa.int64()),
                    "index": pa.array(
                        list(range(global_index, global_index + nframes)), type=pa.int64()
                    ),
                    "task_index": pa.array([task_index] * nframes, type=pa.int64()),
                }
            )
            pq.write_table(table, data_dir / f"episode_{ep:06d}.parquet")

            vid_out = dataset_dir / "videos" / VIDEO_KEY / "chunk-000"
            vid_out.mkdir(parents=True, exist_ok=True)
            shutil.copy(mp4, vid_out / f"episode_{ep:06d}.mp4")
            total_videos += 1
            global_index += nframes  # only commit frame count on full success

            episodes_meta.append({"episode_index": ep, "tasks": [task], "length": nframes})
            print(f"  ep{ep}: {nframes} frames, {vid_w}x{vid_h}  <- {m['gen_id']}", flush=True)
        except Exception as e:
            # isolate per-episode failures so one bad episode can't abort the batch.
            print(f"  WARN: skipping {m.get('gen_id')}: {type(e).__name__}: {e}", flush=True)
            continue

    n_episodes = len(episodes_meta)
    if n_episodes == 0:
        print("ERROR: no episodes converted successfully.")
        return 1

    info = {
        "codebase_version": CODEBASE_VERSION,
        "robot_type": ROBOT_TYPE,
        "fps": FPS,
        "total_episodes": n_episodes,
        "total_frames": global_index,
        "total_tasks": len(tasks),
        "total_videos": total_videos,
        "total_chunks": 1,
        "chunks_size": CHUNK_SIZE,
        "data_path": "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet",
        "video_path": "videos/{video_key}/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.mp4",
        "splits": {"train": f"0:{n_episodes}"},
        "features": {
            VIDEO_KEY: {
                "dtype": "video",
                "shape": [vid_h, vid_w, 3],
                "names": ["height", "width", "channel"],
            },
            "observation.state": {"dtype": "float32", "shape": [STATE_DIM], "names": None},
            "action": {"dtype": "float32", "shape": [ACTION_DIM], "names": None},
            "timestamp": {"dtype": "float32", "shape": [1], "names": None},
            "frame_index": {"dtype": "int64", "shape": [1], "names": None},
            "episode_index": {"dtype": "int64", "shape": [1], "names": None},
            "index": {"dtype": "int64", "shape": [1], "names": None},
            "task_index": {"dtype": "int64", "shape": [1], "names": None},
        },
        # Provenance (TASK-182 AC): synthetic tag + generator + full provenance.
        "_synthetic": True,
        "_generator": f"{MODEL_NAME} neural-trajectory ({backend})",
        "_provenance": {
            "backend": backend,
            "model": provenance.get("model", MODEL_NAME),
            "prompts": tasks,
            "seed": provenance.get("seed", 0),
            "created_at": provenance.get("created_at"),
        },
    }
    (meta_dir / "info.json").write_text(json.dumps(info, indent=2))
    # episodes.json (array) — validateStructure checks for this exact name;
    # episodes.jsonl kept too for LeRobot tooling compatibility.
    (meta_dir / "episodes.json").write_text(json.dumps(episodes_meta, indent=2))
    with (meta_dir / "episodes.jsonl").open("w") as fh:
        for e in episodes_meta:
            fh.write(json.dumps(e) + "\n")
    with (meta_dir / "tasks.jsonl").open("w") as fh:
        for i, tname in enumerate(tasks):
            fh.write(json.dumps({"task_index": i, "task": tname}) + "\n")

    # stats.json (mean/std/min/max per feature), recomputed from the parquet.
    st_all: list[list[float]] = []
    ac_all: list[list[float]] = []
    for ep in range(n_episodes):
        tt = pq.read_table(data_dir / f"episode_{ep:06d}.parquet")
        st_all += tt.column("observation.state").to_pylist()
        ac_all += tt.column("action").to_pylist()
    st_np, ac_np = np.array(st_all, dtype=float), np.array(ac_all, dtype=float)
    stats = {
        "observation.state": {
            "mean": st_np.mean(0).tolist(),
            "std": (st_np.std(0) + 1e-8).tolist(),
            "min": st_np.min(0).tolist(),
            "max": st_np.max(0).tolist(),
        },
        "action": {
            "mean": ac_np.mean(0).tolist(),
            "std": (ac_np.std(0) + 1e-8).tolist(),
            "min": ac_np.min(0).tolist(),
            "max": ac_np.max(0).tolist(),
        },
    }
    (meta_dir / "stats.json").write_text(json.dumps(stats, indent=2))

    print(f"\n== convert DONE: {n_episodes} episodes, {global_index} frames -> {dataset_dir} ==", flush=True)
    print("   layout: meta/info.json, meta/episodes.json(+.jsonl), meta/tasks.jsonl, meta/stats.json,")
    print(f"           data/chunk-000/episode_*.parquet, videos/{VIDEO_KEY}/chunk-000/*.mp4")
    return 0
