#!/usr/bin/env python3
"""Episode-level curation for LeRobot v2.1 on-disk datasets: trim and delete.

Non-destructive: always writes a NEW dataset directory, leaving the source
untouched (the original Unitree desktop editor mutates in place — we must not).

This is the dependency-light path (pyarrow + pandas only) used for the in-app
curation GUI and for local testing without torch/lerobot. It handles the common
single-parquet-per-episode v2.1 layout and recomputes episode/frame/global
indices and meta exactly the way lerobot's ``delete_episodes`` does.

For v3 chunked/video datasets, route through lerobot's own
``lerobot.datasets.dataset_tools.delete_episodes`` instead (see --backend).

Subcommands
-----------
  delete  --episodes 1,3            remove whole episodes
  trim    --episode 2 --start 5 --end 15   keep frames [start, end) of one episode

Both emit a JSON summary on stdout so the Node server can parse the result.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import pyarrow.parquet as pq
import pyarrow as pa


def _load_info(root: Path) -> dict:
    return json.loads((root / "meta" / "info.json").read_text())


def _episode_parquet(root: Path, info: dict, episode_index: int) -> Path:
    rel = info["data_path"].format(episode_chunk=0, episode_index=episode_index)
    return root / rel


def _rebuild(src: Path, dst: Path, plan: list[dict], note: str) -> dict:
    """Write a new dataset from a plan of (source_episode_index, start, end) slices.

    Episodes are renumbered 0..N-1 in plan order; frame_index and the global
    index are recomputed; meta is rewritten. Stats are NOT recomputed here and
    are flagged for the stats worker.
    """
    info = _load_info(src)
    fps = info["fps"]
    if dst.exists():
        shutil.rmtree(dst)
    (dst / "data" / "chunk-000").mkdir(parents=True, exist_ok=True)
    (dst / "meta").mkdir(parents=True, exist_ok=True)

    # task -> index map from source, preserved
    tasks = {}
    tasks_path = src / "meta" / "tasks.jsonl"
    if tasks_path.exists():
        for line in tasks_path.read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                tasks[row["task_index"]] = row["task"]

    src_episodes = {}
    for line in (src / "meta" / "episodes.jsonl").read_text().splitlines():
        if line.strip():
            row = json.loads(line)
            src_episodes[row["episode_index"]] = row

    global_index = 0
    new_episodes_meta = []
    total_frames = 0

    for new_ep, step in enumerate(plan):
        old_ep = step["episode"]
        table = pq.read_table(_episode_parquet(src, info, old_ep))
        n = table.num_rows
        start = step.get("start", 0)
        end = step.get("end", n)
        start = max(0, start)
        end = min(n, end if end is not None else n)
        if end <= start:
            raise ValueError(f"empty slice for episode {old_ep}: [{start}, {end})")
        table = table.slice(start, end - start)
        length = table.num_rows

        frame_index = pa.array(list(range(length)), type=pa.int64())
        episode_index = pa.array([new_ep] * length, type=pa.int64())
        index = pa.array(list(range(global_index, global_index + length)), type=pa.int64())
        timestamp = pa.array([round(i / fps, 6) for i in range(length)], type=pa.float32())

        cols = {name: table.column(name) for name in table.column_names}
        cols["frame_index"] = frame_index
        cols["episode_index"] = episode_index
        cols["index"] = index
        if "timestamp" in cols:
            cols["timestamp"] = timestamp
        new_table = pa.table(cols)
        pq.write_table(new_table, dst / "data" / "chunk-000" / f"episode_{new_ep:06d}.parquet")

        src_meta = src_episodes.get(old_ep, {})
        new_episodes_meta.append({
            "episode_index": new_ep,
            "tasks": src_meta.get("tasks", []),
            "length": length,
        })
        global_index += length
        total_frames += length

    # write meta
    new_info = dict(info)
    new_info["total_episodes"] = len(plan)
    new_info["total_frames"] = total_frames
    new_info["total_chunks"] = 1
    new_info["splits"] = {"train": f"0:{len(plan)}"}
    new_info["_curation"] = {"note": note, "stats_recompute_required": True}
    (dst / "meta" / "info.json").write_text(json.dumps(new_info, indent=2))
    with (dst / "meta" / "episodes.jsonl").open("w") as fh:
        for e in new_episodes_meta:
            fh.write(json.dumps(e) + "\n")
    if tasks:
        with (dst / "meta" / "tasks.jsonl").open("w") as fh:
            for i, t in sorted(tasks.items()):
                fh.write(json.dumps({"task_index": i, "task": t}) + "\n")

    return {
        "ok": True,
        "operation": note,
        "output": str(dst),
        "total_episodes": len(plan),
        "total_frames": total_frames,
        "stats_recompute_required": True,
    }


def cmd_delete(args) -> dict:
    src = Path(args.dataset)
    info = _load_info(src)
    total = info["total_episodes"]
    to_delete = set(int(x) for x in args.episodes.split(",") if x.strip() != "")
    invalid = to_delete - set(range(total))
    if invalid:
        raise ValueError(f"invalid episode indices: {sorted(invalid)} (dataset has {total})")
    keep = [i for i in range(total) if i not in to_delete]
    if not keep:
        raise ValueError("cannot delete all episodes")
    plan = [{"episode": i} for i in keep]
    note = f"delete episodes {sorted(to_delete)}"
    return _rebuild(src, Path(args.output), plan, note)


def cmd_trim(args) -> dict:
    src = Path(args.dataset)
    info = _load_info(src)
    total = info["total_episodes"]
    if args.episode < 0 or args.episode >= total:
        raise ValueError(f"episode {args.episode} out of range (dataset has {total})")
    plan = []
    for i in range(total):
        if i == args.episode:
            plan.append({"episode": i, "start": args.start, "end": args.end})
        else:
            plan.append({"episode": i})
    note = f"trim episode {args.episode} to [{args.start}, {args.end})"
    return _rebuild(src, Path(args.output), plan, note)


def main() -> None:
    ap = argparse.ArgumentParser(description="Curate (trim/delete) a LeRobot v2.1 dataset")
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("delete", help="delete whole episodes")
    d.add_argument("--dataset", required=True)
    d.add_argument("--output", required=True)
    d.add_argument("--episodes", required=True, help="comma-separated episode indices")
    d.set_defaults(func=cmd_delete)

    t = sub.add_parser("trim", help="keep frames [start, end) of one episode")
    t.add_argument("--dataset", required=True)
    t.add_argument("--output", required=True)
    t.add_argument("--episode", type=int, required=True)
    t.add_argument("--start", type=int, default=0)
    t.add_argument("--end", type=int, default=None)
    t.set_defaults(func=cmd_trim)

    args = ap.parse_args()
    try:
        result = args.func(args)
        print(json.dumps(result))
    except Exception as exc:  # noqa: BLE001 - surface as JSON for the caller
        print(json.dumps({"ok": False, "error": str(exc)}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
