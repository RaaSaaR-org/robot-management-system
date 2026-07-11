#!/usr/bin/env python3
"""Episode-level curation for LeRobot on-disk datasets: trim, delete, suggest.

Non-destructive: always writes a NEW dataset directory, leaving the source
untouched (the original Unitree desktop editor mutates in place — we must not).

Backends
--------
``native`` (default) is the dependency-light path (pyarrow + pandas only) used
for the in-app curation GUI and for local testing without torch/lerobot. It
handles the common single-parquet-per-episode **v2.1** layout: it recomputes
episode/frame/global indices and meta exactly the way lerobot's
``delete_episodes`` does, copies/renumbers the per-episode camera videos, re-cuts
trimmed videos frame-accurately with ffmpeg, and recomputes ``meta/stats.json``.

``lerobot`` routes ``delete`` through lerobot's own
``lerobot.datasets.dataset_tools.delete_episodes`` (lerobot >= 0.6), which
understands the **v3.0** chunked/concatenated-video layout. ``trim`` has no
lerobot equivalent yet and returns a structured ``V3_TRIM_UNSUPPORTED`` error.

Subcommands
-----------
  delete   --episodes 1,3                        remove whole episodes
  trim     --episode 2 --start 5 --end 15        keep frames [start, end) of one episode
  suggest  [--episode N]                         heuristic trim/delete suggestions

All commands emit a JSON summary on stdout so the Node server can parse the
result; failures emit ``{"ok": false, "error": ..., "code": ...}`` and exit 1.

Environment
-----------
  CURATION_FFMPEG   path to an ffmpeg binary (falls back to ``ffmpeg`` on PATH).
                    Required only when trimming an episode of a video dataset.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

import pyarrow.parquet as pq
import pyarrow as pa


class CurationError(Exception):
    """Curation failure with an optional machine-readable code."""

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------------------
# Shared helpers (v2.1 on-disk layout)
# ---------------------------------------------------------------------------

def _load_info(root: Path) -> dict:
    return json.loads((root / "meta" / "info.json").read_text())


def _episode_parquet(root: Path, info: dict, episode_index: int) -> Path:
    rel = info["data_path"].format(episode_chunk=0, episode_index=episode_index)
    return root / rel


def _video_keys(info: dict) -> list[str]:
    """Camera/video feature keys, sorted for deterministic processing."""
    feats = info.get("features") or {}
    return sorted(k for k, f in feats.items() if isinstance(f, dict) and f.get("dtype") == "video")


def _video_path(root: Path, info: dict, video_key: str, episode_index: int) -> Path | None:
    template = info.get("video_path")
    if not template:
        return None
    rel = template.format(episode_chunk=0, video_key=video_key, episode_index=episode_index)
    return root / rel


def _find_ffmpeg() -> str | None:
    env = os.environ.get("CURATION_FFMPEG")
    if env:
        if Path(env).exists():
            return env
        return shutil.which(env)  # allow a bare command name
    return shutil.which("ffmpeg")


def _cut_video(ffmpeg: str, src: Path, dst: Path, start: int, count: int, fps: float) -> None:
    """Frame-accurate re-cut of ``src`` keeping ``count`` frames from ``start``.

    Uses the ``trim`` filter (exact by frame index) + libx264 re-encode; a
    stream copy (``-c copy``) is NOT frame-accurate (keyframe-aligned only).
    Timestamps are regenerated (``setpts=N/fps/TB`` + ``-r fps``) so the output
    decodes to exactly ``count`` frames — without the explicit output rate the
    mp4 muxer drops the final frame on decode.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    vf = f"trim=start_frame={start}:end_frame={start + count},setpts=N/{fps}/TB"
    cmd = [
        ffmpeg, "-y", "-loglevel", "error",
        "-i", str(src),
        "-vf", vf,
        "-r", str(fps),
        "-frames:v", str(count),
        "-an",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(dst),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        tail = (result.stderr or "").strip()[-400:]
        raise CurationError(f"ffmpeg failed cutting {src.name}: {tail}", code="FFMPEG_FAILED")


def _copy_video(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


# ---------------------------------------------------------------------------
# Stats recompute (v2.1)
# ---------------------------------------------------------------------------

def _compute_stats(dst: Path) -> dict:
    """Recompute per-feature min/max/mean/std from the output parquet files.

    Mirrors the LeRobot ``meta/stats.json`` shape (per-dimension arrays for
    vector features, single-element arrays for scalars). Population std
    (ddof=0), like lerobot's own aggregation. Video features live in mp4s, not
    parquet, so image stats are not recomputed here.
    """
    import numpy as np

    acc: dict[str, dict] = {}
    files = sorted((dst / "data" / "chunk-000").glob("episode_*.parquet"))
    for f in files:
        table = pq.read_table(f)
        for name in table.column_names:
            values = table.column(name).to_pylist()
            try:
                arr = np.asarray(values, dtype=np.float64)
            except (TypeError, ValueError):
                continue  # non-numeric feature (e.g. strings)
            if arr.ndim == 1:
                arr = arr[:, None]
            elif arr.ndim != 2:
                continue
            a = acc.get(name)
            if a is None:
                acc[name] = {
                    "count": arr.shape[0],
                    "sum": arr.sum(axis=0),
                    "sumsq": (arr ** 2).sum(axis=0),
                    "min": arr.min(axis=0),
                    "max": arr.max(axis=0),
                }
            else:
                a["count"] += arr.shape[0]
                a["sum"] += arr.sum(axis=0)
                a["sumsq"] += (arr ** 2).sum(axis=0)
                a["min"] = np.minimum(a["min"], arr.min(axis=0))
                a["max"] = np.maximum(a["max"], arr.max(axis=0))

    stats: dict[str, dict] = {}
    for name, a in acc.items():
        mean = a["sum"] / a["count"]
        var = a["sumsq"] / a["count"] - mean ** 2
        std = np.sqrt(np.maximum(var, 0.0))
        stats[name] = {
            "mean": mean.tolist(),
            "std": std.tolist(),
            "min": a["min"].tolist(),
            "max": a["max"].tolist(),
        }
    return stats


# ---------------------------------------------------------------------------
# Native (v2.1) rebuild
# ---------------------------------------------------------------------------

def _rebuild(src: Path, dst: Path, plan: list[dict], note: str, recompute_stats: bool) -> dict:
    """Write a new dataset from a plan of (source_episode_index, start, end) slices.

    Episodes are renumbered 0..N-1 in plan order; frame_index and the global
    index are recomputed; per-episode camera videos are copied/renumbered (and
    re-cut with ffmpeg for trimmed episodes); meta is rewritten and
    ``meta/stats.json`` recomputed from the output parquet files.
    """
    info = _load_info(src)
    fps = info["fps"]
    if dst.exists():
        shutil.rmtree(dst)
    (dst / "data" / "chunk-000").mkdir(parents=True, exist_ok=True)
    (dst / "meta").mkdir(parents=True, exist_ok=True)

    video_keys = _video_keys(info)
    ffmpeg: str | None = None  # resolved lazily, only when a video must be re-cut

    # task -> index map from source, preserved
    tasks = {}
    tasks_path = src / "meta" / "tasks.jsonl"
    if tasks_path.exists():
        for line in tasks_path.read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                tasks[row["task_index"]] = row["task"]

    src_episodes = {}
    episodes_jsonl = src / "meta" / "episodes.jsonl"
    if episodes_jsonl.exists():
        for line in episodes_jsonl.read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                src_episodes[row["episode_index"]] = row

    global_index = 0
    new_episodes_meta = []
    total_frames = 0
    total_videos = 0

    for new_ep, step in enumerate(plan):
        old_ep = step["episode"]
        table = pq.read_table(_episode_parquet(src, info, old_ep))
        n = table.num_rows
        start = step.get("start", 0)
        end = step.get("end", n)
        start = max(0, start)
        end = min(n, end if end is not None else n)
        if end <= start:
            raise CurationError(f"empty slice for episode {old_ep}: [{start}, {end})", code="EMPTY_SLICE")
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

        # Copy / renumber / re-cut this episode's camera videos for every key.
        is_partial = start > 0 or end < n
        for key in video_keys:
            src_vid = _video_path(src, info, key, old_ep)
            if src_vid is None or not src_vid.exists():
                continue
            dst_vid = _video_path(dst, info, key, new_ep)
            assert dst_vid is not None
            if is_partial:
                if ffmpeg is None:
                    ffmpeg = _find_ffmpeg()
                    if ffmpeg is None:
                        raise CurationError(
                            "dataset has videos but no ffmpeg is available to re-cut the "
                            "trimmed episode. Set CURATION_FFMPEG to an ffmpeg binary "
                            "(or put ffmpeg on PATH).",
                            code="FFMPEG_MISSING",
                        )
                _cut_video(ffmpeg, src_vid, dst_vid, start, length, fps)
            else:
                _copy_video(src_vid, dst_vid)
            total_videos += 1

        src_meta = src_episodes.get(old_ep, {})
        new_episodes_meta.append({
            "episode_index": new_ep,
            "tasks": src_meta.get("tasks", []),
            "length": length,
        })
        global_index += length
        total_frames += length

    # write meta
    stats_recompute_required = True
    if recompute_stats:
        stats = _compute_stats(dst)
        (dst / "meta" / "stats.json").write_text(json.dumps(stats, indent=2))
        stats_recompute_required = False

    new_info = dict(info)
    new_info["total_episodes"] = len(plan)
    new_info["total_frames"] = total_frames
    new_info["total_chunks"] = 1
    new_info["total_videos"] = total_videos
    new_info["splits"] = {"train": f"0:{len(plan)}"}
    new_info["_curation"] = {"note": note, "stats_recompute_required": stats_recompute_required}
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
        "total_videos": total_videos,
        "stats_recompute_required": stats_recompute_required,
        "backend": "native",
    }


# ---------------------------------------------------------------------------
# lerobot backend (v3.0 chunked / concatenated-video datasets)
# ---------------------------------------------------------------------------

def _delete_lerobot(src: Path, dst: Path, to_delete: list[int]) -> dict:
    try:
        from lerobot.datasets.lerobot_dataset import LeRobotDataset
        from lerobot.datasets.dataset_tools import delete_episodes
    except ImportError as exc:  # pragma: no cover - depends on interpreter
        raise CurationError(
            f"lerobot backend unavailable in this interpreter: {exc}. "
            "Point CURATION_LEROBOT_PYTHON at a Python with lerobot>=0.6 installed.",
            code="LEROBOT_MISSING",
        )

    src = src.resolve()
    dst = dst.resolve()
    if dst.exists():
        shutil.rmtree(dst)

    dataset = LeRobotDataset(repo_id=f"local/{src.name}", root=src)
    new_dataset = delete_episodes(
        dataset,
        episode_indices=sorted(to_delete),
        output_dir=dst,
        repo_id=f"local/{src.name}_curated",
    )
    meta = new_dataset.meta

    note = f"delete episodes {sorted(to_delete)}"
    # Persist the curation marker in the output info.json (lerobot keeps
    # per-episode stats consistent itself, so no recompute is required).
    info_path = dst / "meta" / "info.json"
    try:
        info = json.loads(info_path.read_text())
        info["_curation"] = {"note": note, "backend": "lerobot", "stats_recompute_required": False}
        info_path.write_text(json.dumps(info, indent=2))
    except OSError:
        pass

    return {
        "ok": True,
        "operation": note,
        "output": str(dst),
        "total_episodes": meta.total_episodes,
        "total_frames": meta.total_frames,
        "stats_recompute_required": False,
        "backend": "lerobot",
    }


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

def _parse_episodes(spec: str, total: int | None = None) -> list[int]:
    to_delete = sorted({int(x) for x in spec.split(",") if x.strip() != ""})
    if total is not None:
        invalid = [i for i in to_delete if i < 0 or i >= total]
        if invalid:
            raise CurationError(
                f"invalid episode indices: {invalid} (dataset has {total})",
                code="INVALID_EPISODES",
            )
    return to_delete


def cmd_delete(args) -> dict:
    src = Path(args.dataset)
    if args.backend == "lerobot":
        return _delete_lerobot(src, Path(args.output), _parse_episodes(args.episodes))

    info = _load_info(src)
    total = info["total_episodes"]
    to_delete = set(_parse_episodes(args.episodes, total))
    keep = [i for i in range(total) if i not in to_delete]
    if not keep:
        raise CurationError("cannot delete all episodes", code="EMPTY_RESULT")
    plan = [{"episode": i} for i in keep]
    note = f"delete episodes {sorted(to_delete)}"
    return _rebuild(src, Path(args.output), plan, note, recompute_stats=not args.no_recompute_stats)


def cmd_trim(args) -> dict:
    if args.backend == "lerobot":
        raise CurationError(
            "trim not supported for v3.0 datasets yet",
            code="V3_TRIM_UNSUPPORTED",
        )
    src = Path(args.dataset)
    info = _load_info(src)
    total = info["total_episodes"]
    if args.episode < 0 or args.episode >= total:
        raise CurationError(
            f"episode {args.episode} out of range (dataset has {total})",
            code="INVALID_EPISODES",
        )
    plan = []
    for i in range(total):
        if i == args.episode:
            plan.append({"episode": i, "start": args.start, "end": args.end})
        else:
            plan.append({"episode": i})
    note = f"trim episode {args.episode} to [{args.start}, {args.end})"
    return _rebuild(src, Path(args.output), plan, note, recompute_stats=not args.no_recompute_stats)


def cmd_suggest(args) -> dict:
    """Motion-based heuristic curation suggestions (Phase-2 "video-use", offline part).

    Deterministic, pure pyarrow/pandas/numpy — no VLM. Looks at the ``action``
    column (fallback ``observation.state``) of each episode:

      * leading/trailing frames whose mean |delta| per frame stays below
        ``--idle-threshold`` for at least ``--min-idle-frames`` frames
        -> suggested trim range,
      * near-zero total motion or fewer than ``--min-frames`` frames
        -> suggested delete.
    """
    import numpy as np

    src = Path(args.dataset)
    info = _load_info(src)
    total = info["total_episodes"]
    if args.episode is not None:
        if args.episode < 0 or args.episode >= total:
            raise CurationError(
                f"episode {args.episode} out of range (dataset has {total})",
                code="INVALID_EPISODES",
            )
        episodes = [args.episode]
    else:
        episodes = list(range(total))

    thr = args.idle_threshold
    suggestions: list[dict] = []

    for ep in episodes:
        table = pq.read_table(_episode_parquet(src, info, ep))
        col = "action" if "action" in table.column_names else "observation.state"
        if col not in table.column_names:
            continue
        arr = np.asarray(table.column(col).to_pylist(), dtype=np.float64)
        if arr.ndim == 1:
            arr = arr[:, None]
        n = arr.shape[0]

        if n < args.min_frames:
            suggestions.append({
                "episode": ep,
                "kind": "delete",
                "reason": f"episode too short ({n} < {args.min_frames} frames)",
                "confidence": 0.8,
            })
            continue

        # per-frame motion: mean |delta| between consecutive frames (length n-1)
        diffs = np.abs(np.diff(arr, axis=0)).mean(axis=1)
        mean_motion = float(diffs.mean())
        if mean_motion <= thr:
            suggestions.append({
                "episode": ep,
                "kind": "delete",
                "reason": f"near-zero motion over the whole episode (mean |delta| {mean_motion:.2e} <= {thr:.2e})",
                "confidence": 0.9,
            })
            continue

        lead = 0
        while lead < len(diffs) and diffs[lead] < thr:
            lead += 1
        trail = 0
        while trail < len(diffs) - lead and diffs[len(diffs) - 1 - trail] < thr:
            trail += 1

        if lead >= args.min_idle_frames or trail >= args.min_idle_frames:
            start = lead if lead >= args.min_idle_frames else 0
            end = n - trail if trail >= args.min_idle_frames else n
            frac = (start + (n - end)) / n
            suggestions.append({
                "episode": ep,
                "kind": "trim",
                "start": int(start),
                "end": int(end),
                "reason": (
                    f"idle padding: {lead} leading / {trail} trailing frames below "
                    f"motion threshold {thr:.0e}"
                ),
                "confidence": round(min(0.95, 0.5 + frac), 2),
            })

    return {
        "ok": True,
        "operation": "suggest",
        "dataset": str(src),
        "suggestions": suggestions,
        "params": {
            "idle_threshold": thr,
            "min_idle_frames": args.min_idle_frames,
            "min_frames": args.min_frames,
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Curate (trim/delete/suggest) a LeRobot dataset")
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("delete", help="delete whole episodes")
    d.add_argument("--dataset", required=True)
    d.add_argument("--output", required=True)
    d.add_argument("--episodes", required=True, help="comma-separated episode indices")
    d.add_argument("--backend", choices=["native", "lerobot"], default="native",
                   help="native = v2.1 pyarrow path; lerobot = v3.0 via lerobot.datasets.dataset_tools")
    d.add_argument("--no-recompute-stats", action="store_true",
                   help="skip the meta/stats.json recompute (native backend only)")
    d.set_defaults(func=cmd_delete)

    t = sub.add_parser("trim", help="keep frames [start, end) of one episode")
    t.add_argument("--dataset", required=True)
    t.add_argument("--output", required=True)
    t.add_argument("--episode", type=int, required=True)
    t.add_argument("--start", type=int, default=0)
    t.add_argument("--end", type=int, default=None)
    t.add_argument("--backend", choices=["native", "lerobot"], default="native")
    t.add_argument("--no-recompute-stats", action="store_true",
                   help="skip the meta/stats.json recompute")
    t.set_defaults(func=cmd_trim)

    s = sub.add_parser("suggest", help="heuristic trim/delete suggestions (no edits)")
    s.add_argument("--dataset", required=True)
    s.add_argument("--episode", type=int, default=None, help="restrict to one episode")
    s.add_argument("--idle-threshold", type=float, default=1e-3,
                   help="mean |delta| per frame below this counts as idle")
    s.add_argument("--min-idle-frames", type=int, default=5,
                   help="minimum leading/trailing idle run to suggest a trim")
    s.add_argument("--min-frames", type=int, default=10,
                   help="episodes shorter than this are suggested for delete")
    s.set_defaults(func=cmd_suggest)

    args = ap.parse_args()
    try:
        result = args.func(args)
        print(json.dumps(result))
    except CurationError as exc:
        print(json.dumps({"ok": False, "error": str(exc), "code": exc.code}))
        raise SystemExit(1)
    except Exception as exc:  # noqa: BLE001 - surface as JSON for the caller
        print(json.dumps({"ok": False, "error": str(exc)}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
