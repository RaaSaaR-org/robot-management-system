#!/usr/bin/env python3
"""Generate a tiny LeRobot dataset on disk — v2.1 or v3.0, sound or broken.

Produces the parquet + meta layout that ``curate.py`` operates on, without
needing torch/lerobot. Useful for developing and testing the trim/delete
curation tooling on a Mac with no real robot data.

Layout produced (videos optional to stay light):
  <root>/meta/info.json
  <root>/meta/episodes.jsonl
  <root>/meta/tasks.jsonl
  <root>/data/chunk-000/episode_000000.parquet ...
  <root>/videos/chunk-000/observation.images.<cam>/episode_000000.mp4  (with --cameras)

With ``--cameras`` a tiny real mp4 (testsrc pattern, one video frame per data
frame) is emitted per episode and camera via ffmpeg (``CURATION_FFMPEG`` env
var, falling back to ``ffmpeg`` on PATH) so the video-aware curation path can
be exercised in tests.

``--version v3.0`` emits the layout this platform actually writes (TASK-217):
one aggregated parquet and one aggregated mp4 per chunk, with
``meta/episodes/chunk-000/file-000.parquet`` carrying the row ranges and time
windows that say where each episode is inside them.

  <root>/meta/info.json
  <root>/meta/tasks.parquet              (INDEXED BY THE TASK STRING)
  <root>/meta/episodes/chunk-000/file-000.parquet
  <root>/data/chunk-000/file-000.parquet
  <root>/videos/observation.images.<cam>/chunk-000/file-000.mp4

``--break <kind>`` damages the result in one specific, named way, because a
validator that fails everything for the wrong reason is no better than one that
passes everything. The kinds are listed in ``BREAKAGES``.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

CODEBASE_VERSION = "v2.1"
CODEBASE_VERSION_V3 = "v3.0"
CHUNK_SIZE = 1000
VIDEO_PATH_TEMPLATE = "videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4"
DATA_PATH_TEMPLATE_V3 = "data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet"
VIDEO_PATH_TEMPLATE_V3 = "videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4"

#: Each one damages the dataset in exactly one way a validator should name.
BREAKAGES = {
    "missing-parquet": "delete a data file info.json still names",
    "truncated-video": "leave a camera's mp4 as a zero-byte file",
    "wrong-state-width": "write observation.state one element narrower than declared",
    "no-images": "drop every camera feature, leaving a state-only dataset",
    "episode-count": "claim one more episode in info.json than the metadata holds",
    "undeclared-column": "add a data column info.json features does not declare",
}


def _find_ffmpeg() -> str:
    ffmpeg = os.environ.get("CURATION_FFMPEG") or shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("--cameras requires ffmpeg: set CURATION_FFMPEG or put ffmpeg on PATH")
    return ffmpeg


def _write_video(ffmpeg: str, dst: Path, frames: int, fps: int) -> None:
    """Emit a tiny mp4 with exactly ``frames`` frames (testsrc pattern)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg, "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", f"testsrc=size=64x64:rate={fps}",
        "-frames:v", str(frames),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(dst),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def build(
    root: Path,
    num_episodes: int,
    frames: int,
    action_dim: int,
    fps: int,
    robot_type: str,
    cameras: list[str] | None = None,
) -> None:
    data_dir = root / "data" / "chunk-000"
    meta_dir = root / "meta"
    data_dir.mkdir(parents=True, exist_ok=True)
    meta_dir.mkdir(parents=True, exist_ok=True)

    state_dim = action_dim
    tasks = ["pick up the cube", "place the cube"]
    episodes_meta = []
    global_index = 0
    cameras = cameras or []
    ffmpeg = _find_ffmpeg() if cameras else None
    total_videos = 0

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

        for cam in cameras:
            assert ffmpeg is not None
            rel = VIDEO_PATH_TEMPLATE.format(
                episode_chunk=0, video_key=f"observation.images.{cam}", episode_index=ep
            )
            _write_video(ffmpeg, root / rel, ep_len, fps)
            total_videos += 1

    video_features = {
        f"observation.images.{cam}": {
            "dtype": "video",
            "shape": [64, 64, 3],
            "names": ["height", "width", "channel"],
            "info": {"video.fps": fps, "video.codec": "h264", "video.pix_fmt": "yuv420p"},
        }
        for cam in cameras
    }

    info = {
        "codebase_version": CODEBASE_VERSION,
        "robot_type": robot_type,
        "fps": fps,
        "total_episodes": num_episodes,
        "total_frames": global_index,
        "total_tasks": len(tasks),
        "total_videos": total_videos,
        "total_chunks": 1,
        "chunks_size": CHUNK_SIZE,
        "data_path": "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet",
        "video_path": VIDEO_PATH_TEMPLATE if cameras else None,
        "splits": {"train": f"0:{num_episodes}"},
        "features": {
            **video_features,
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


def build_v3(
    root: Path,
    num_episodes: int,
    frames: int,
    action_dim: int,
    fps: int,
    robot_type: str,
    cameras: list[str] | None = None,
    break_kind: str | None = None,
) -> None:
    """The v3.0 layout: one file per chunk, episodes addressed inside it.

    Deliberately built from the SAME series as :func:`build`, so a v3.0 fixture
    and the v2.1 fixture made from the same arguments hold identical numbers and
    the converter can be diffed against one from the other.
    """
    data_dir = root / "data" / "chunk-000"
    meta_dir = root / "meta"
    ep_meta_dir = meta_dir / "episodes" / "chunk-000"
    data_dir.mkdir(parents=True, exist_ok=True)
    ep_meta_dir.mkdir(parents=True, exist_ok=True)

    state_dim = action_dim
    narrow = break_kind == "wrong-state-width"
    cameras = [] if break_kind == "no-images" else (cameras or [])
    tasks = ["pick up the cube", "place the cube"]
    ffmpeg = _find_ffmpeg() if cameras else None

    cols: dict[str, list] = {
        "observation.state": [], "action": [], "timestamp": [], "frame_index": [],
        "episode_index": [], "index": [], "task_index": [],
    }
    episode_rows: list[dict] = []
    global_index = 0
    video_cursor = 0.0

    for ep in range(num_episodes):
        ep_len = frames + ep  # the same varying length `build` uses
        task_index = ep % len(tasks)
        start = global_index
        for f in range(ep_len):
            phase = (f / max(ep_len - 1, 1)) * 2 * math.pi
            vec = [round(math.sin(phase + j * 0.1), 4) for j in range(action_dim)]
            # One element short of what `features` declares — a dataset that
            # cannot train the robot it claims, and the error it produces at
            # training time names neither number.
            cols["observation.state"].append(vec[:-1] if narrow else vec)
            cols["action"].append(vec)
            cols["timestamp"].append(round(f / fps, 6))
            cols["frame_index"].append(f)
            cols["episode_index"].append(ep)
            cols["index"].append(global_index)
            cols["task_index"].append(task_index)
            global_index += 1

        row: dict = {
            "episode_index": ep,
            "length": ep_len,
            "tasks": [tasks[task_index]],
            "dataset_from_index": start,
            "dataset_to_index": global_index,
            "data/chunk_index": 0,
            "data/file_index": 0,
            "meta/episodes/chunk_index": 0,
            "meta/episodes/file_index": 0,
        }
        duration = ep_len / fps
        for cam in cameras:
            key = f"observation.images.{cam}"
            row[f"videos/{key}/from_timestamp"] = round(video_cursor, 6)
            row[f"videos/{key}/to_timestamp"] = round(video_cursor + duration, 6)
            row[f"videos/{key}/chunk_index"] = 0
            row[f"videos/{key}/file_index"] = 0
        video_cursor += duration
        episode_rows.append(row)

    table_cols = {
        "observation.state": pa.array(cols["observation.state"], type=pa.list_(pa.float32())),
        "action": pa.array(cols["action"], type=pa.list_(pa.float32())),
        "timestamp": pa.array(cols["timestamp"], type=pa.float32()),
        "frame_index": pa.array(cols["frame_index"], type=pa.int64()),
        "episode_index": pa.array(cols["episode_index"], type=pa.int64()),
        "index": pa.array(cols["index"], type=pa.int64()),
        "task_index": pa.array(cols["task_index"], type=pa.int64()),
    }
    if break_kind == "undeclared-column":
        # The exact shape of the bug that made every dataset TASK-215 produced
        # unloadable: lerobot casts the data parquet against `info.json`
        # features and a column features does not declare is a hard CastError.
        table_cols["next_done"] = pa.array([False] * global_index, type=pa.bool_())
    pq.write_table(pa.table(table_cols), data_dir / "file-000.parquet")

    ep_table = {k: pa.array([r[k] for r in episode_rows]) for k in episode_rows[0]}
    pq.write_table(pa.table(ep_table), ep_meta_dir / "file-000.parquet")

    total_videos = 0
    for cam in cameras:
        assert ffmpeg is not None
        key = f"observation.images.{cam}"
        rel = VIDEO_PATH_TEMPLATE_V3.format(video_key=key, chunk_index=0, file_index=0)
        dst = root / rel
        _write_video(ffmpeg, dst, global_index, fps)
        total_videos += 1
        if break_kind == "truncated-video":
            dst.write_bytes(b"")

    video_features = {
        f"observation.images.{cam}": {
            "dtype": "video",
            "shape": [64, 64, 3],
            "names": ["height", "width", "channel"],
            "info": {"video.fps": fps, "video.codec": "h264", "video.pix_fmt": "yuv420p"},
        }
        for cam in cameras
    }
    info = {
        "codebase_version": CODEBASE_VERSION_V3,
        "robot_type": robot_type,
        "fps": fps,
        "total_episodes": num_episodes + (1 if break_kind == "episode-count" else 0),
        "total_frames": global_index,
        "total_tasks": len(tasks),
        "total_videos": total_videos,
        "total_chunks": 1,
        "chunks_size": CHUNK_SIZE,
        "data_path": DATA_PATH_TEMPLATE_V3,
        "video_path": VIDEO_PATH_TEMPLATE_V3 if cameras else None,
        "splits": {"train": f"0:{num_episodes}"},
        "features": {
            **video_features,
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

    # tasks.parquet INDEXED BY THE TASK STRING. `LeRobotDataset.__getitem__`
    # ends with `self.meta.tasks.iloc[task_idx].name`, so a dataset that writes
    # the instruction as an ordinary column hands every language-conditioned
    # policy an integer instead of the sentence.
    tasks_table = pa.table({
        "task": pa.array(tasks, type=pa.string()),
        "task_index": pa.array(list(range(len(tasks))), type=pa.int64()),
    })
    import pyarrow.parquet  # noqa: F401  (already imported; kept explicit for readers)
    pq.write_table(
        tasks_table.replace_schema_metadata({
            b"pandas": json.dumps({
                "index_columns": ["task"],
                "column_indexes": [],
                "columns": [
                    {"name": "task", "field_name": "task", "pandas_type": "unicode",
                     "numpy_type": "object", "metadata": None},
                    {"name": "task_index", "field_name": "task_index", "pandas_type": "int64",
                     "numpy_type": "int64", "metadata": None},
                ],
                "creator": {"library": "pyarrow", "version": pa.__version__},
                "pandas_version": None,
            }).encode(),
        }),
        meta_dir / "tasks.parquet",
    )
    with (meta_dir / "tasks.jsonl").open("w") as fh:
        for i, t in enumerate(tasks):
            fh.write(json.dumps({"task_index": i, "task": t}) + "\n")

    if break_kind == "missing-parquet":
        (data_dir / "file-000.parquet").unlink()

    print(f"Wrote synthetic v3.0 dataset: {num_episodes} episodes, {global_index} frames -> {root}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate a synthetic LeRobot dataset")
    ap.add_argument("root", type=Path)
    ap.add_argument("--episodes", type=int, default=4)
    ap.add_argument("--frames", type=int, default=20)
    ap.add_argument("--action-dim", type=int, default=43)  # G1 EDU + Dex3
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--robot-type", default="unitree_g1_edu_dex3")
    ap.add_argument("--version", choices=["v2.1", "v3.0"], default="v2.1")
    ap.add_argument(
        "--break", dest="break_kind", choices=sorted(BREAKAGES), default=None,
        help="; ".join(f"{k}: {v}" for k, v in sorted(BREAKAGES.items())),
    )
    ap.add_argument(
        "--cameras",
        default="",
        help="comma-separated camera names; emits a tiny real mp4 per episode/camera via ffmpeg",
    )
    args = ap.parse_args()
    cameras = [c.strip() for c in args.cameras.split(",") if c.strip()]
    if args.version == "v3.0":
        build_v3(args.root, args.episodes, args.frames, args.action_dim, args.fps,
                 args.robot_type, cameras, args.break_kind)
    else:
        if args.break_kind:
            raise SystemExit("--break is only implemented for --version v3.0")
        build(args.root, args.episodes, args.frames, args.action_dim, args.fps,
              args.robot_type, cameras)


if __name__ == "__main__":
    main()
