#!/usr/bin/env python3
"""Does this directory open as a LeRobot v3.0 dataset?

    python server/curation/check_lerobot_v3.py <dataset-dir>

Replays the steps `lerobot` takes when it loads a dataset, in the order it takes
them, and stops at the first thing it would have raised. It is deliberately a
TRANSCRIPTION of `lerobot/datasets/{utils,lerobot_dataset}.py` rather than a call
into `lerobot` itself: the whole point is to answer the question on a machine
that has no torch, no CUDA and no lerobot install — the same machine that
records the data.

Needs `pandas`, `pyarrow` and `datasets`. It exits 2, not 1, when they are
missing, so a caller can tell "not checked" from "checked and broken".

Why this exists. Every dataset the episode recorder produced up to TASK-215's
review was unloadable, and none of the unit tests noticed, because they all read
the tree back with the same library that wrote it. The one check that would have
caught it is the one lerobot itself performs: casting the data parquet to a
schema built from `info.json`, which fails on any column `features` does not
declare.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import pandas as pd
    from datasets import Dataset, Features, Sequence, Value
except ImportError as exc:  # pragma: no cover - environment, not logic
    print(f"SKIP  {exc}. Install pandas, pyarrow and datasets to run this check.")
    raise SystemExit(2) from exc


def fail(message: str) -> None:
    print(f"FAIL  {message}")
    raise SystemExit(1)


def ok(message: str) -> None:
    print(f"  ok  {message}")


def check(root: Path) -> None:
    # ---- load_info ---------------------------------------------------------
    info_path = root / "meta" / "info.json"
    if not info_path.exists():
        fail(f"no meta/info.json under {root}")
    info = json.loads(info_path.read_text())
    for key in ("codebase_version", "robot_type", "fps", "features", "data_path"):
        if key not in info:
            fail(f"info.json is missing {key!r}")
    if info["codebase_version"] != "v3.0":
        fail(f"codebase_version is {info['codebase_version']!r}, not 'v3.0'")
    ok(
        f"info.json  v3.0 · {info['robot_type']} · {info['fps']} fps · "
        f"{len(info['features'])} features"
    )

    # ---- the path templates lerobot formats --------------------------------
    # `CHUNK_FILE_PATTERN = "chunk-{chunk_index:03d}/file-{file_index:03d}"`.
    # A template carrying v2.1's `{episode_chunk}` raises KeyError here.
    try:
        data_rel = info["data_path"].format(chunk_index=0, file_index=0)
    except KeyError as exc:
        fail(f"data_path uses a placeholder lerobot does not supply: {exc}")
    if not (root / data_rel).exists():
        fail(f"data_path points at a file that is not there: {data_rel}")
    ok(f"data_path  -> {data_rel}")

    video_keys = [k for k, f in info["features"].items() if f.get("dtype") == "video"]
    if info.get("video_path"):
        for key in video_keys:
            try:
                rel = info["video_path"].format(video_key=key, chunk_index=0, file_index=0)
            except KeyError as exc:
                fail(f"video_path uses a placeholder lerobot does not supply: {exc}")
            if not (root / rel).exists():
                fail(f"video_path points at a file that is not there: {rel}")
            ok(f"video_path -> {rel}")
    elif video_keys:
        fail(f"{len(video_keys)} image features are declared but info.json has no video_path")

    # ---- load_tasks --------------------------------------------------------
    # `LeRobotDataset.__getitem__` ends with
    # `item["task"] = self.meta.tasks.iloc[task_idx].name`, so the instruction
    # has to be the parquet's INDEX. Written as an ordinary column, every sample
    # handed to a language-conditioned policy carries an integer instead.
    tasks_path = root / "meta" / "tasks.parquet"
    if not tasks_path.exists():
        fail("no meta/tasks.parquet")
    tasks = pd.read_parquet(tasks_path)
    if len(tasks) == 0:
        fail("meta/tasks.parquet is empty")
    first = tasks.iloc[0].name
    if not isinstance(first, str):
        fail(
            f"meta/tasks.parquet is not indexed by the task string — iloc[0].name is {first!r}. "
            "Policies would be handed that instead of the instruction."
        )
    ok(f"tasks      index[0] = {first!r}")

    # ---- load_episodes -----------------------------------------------------
    ep_path = root / "meta" / "episodes" / "chunk-000" / "file-000.parquet"
    if not ep_path.exists():
        fail("no meta/episodes/chunk-000/file-000.parquet")
    episodes = pd.read_parquet(ep_path)
    required = [
        "episode_index",
        "length",
        "dataset_from_index",
        "dataset_to_index",
        # `get_data_file_path` reads these two and formats `data_path` with them.
        "data/chunk_index",
        "data/file_index",
        "meta/episodes/chunk_index",
        "meta/episodes/file_index",
    ]
    for column in required:
        if column not in episodes.columns:
            fail(f"meta/episodes is missing {column!r} — lerobot reads it to find files")
    for key in video_keys:
        for suffix in ("from_timestamp", "to_timestamp", "chunk_index", "file_index"):
            column = f"videos/{key}/{suffix}"
            if column not in episodes.columns:
                fail(f"meta/episodes is missing {column!r} — the viewer slices video by it")
    ok(f"episodes   {len(episodes)} rows, every lookup column present")

    # ---- get_hf_features_from_features + Dataset.from_parquet --------------
    # THE check. lerobot casts the data parquet to a schema built from
    # `info.json.features`, and a column in the file that features does not
    # declare is a hard CastError.
    hf: dict[str, object] = {}
    for key, feature in info["features"].items():
        if feature.get("dtype") == "video":
            continue
        shape = tuple(feature["shape"])
        if len(shape) == 1 and shape[0] == 1:
            hf[key] = Value(feature["dtype"])
        elif len(shape) == 1:
            hf[key] = Sequence(length=shape[0], feature=Value(feature["dtype"]))
        else:
            fail(f"{key} declares a shape this check cannot build a schema for: {shape}")
    try:
        data = Dataset.from_parquet(str(root / data_rel), features=Features(hf))
    except Exception as exc:  # noqa: BLE001 - whatever lerobot would have seen
        fail(
            "the data parquet does not match info.json features:\n"
            f"      {type(exc).__name__}: {str(exc)[:600]}"
        )
    ok(f"data       {len(data)} rows cast to the declared schema")

    if info.get("total_frames") not in (None, len(data)):
        fail(f"info.json says {info['total_frames']} frames, the parquet has {len(data)}")

    row = data[0]
    width = info["features"]["observation.state"]["shape"][0]
    if len(row["observation.state"]) != width or len(row["action"]) != width:
        fail("observation.state / action are not the width info.json declares")
    spread = max(abs(a - b) for a, b in zip(row["action"], row["observation.state"]))
    ok(f"row 0      state and action {width} dims, max|action-state| = {spread:.4f}")

    print(f"\nOPENS AS LEROBOT v3.0: {root}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(64)
    check(Path(sys.argv[1]).expanduser().resolve())
