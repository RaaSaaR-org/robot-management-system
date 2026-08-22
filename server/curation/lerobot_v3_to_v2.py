#!/usr/bin/env python3
"""Convert a LeRobot v3.0 dataset tree into the v2.1 tree the viewer can read.

    python server/curation/lerobot_v3_to_v2.py <v3-dir> <out-dir> [--force]

WHY THIS EXISTS. Everything this platform writes is v3.0 — the robot agent's
episode recorder and `LeRobotExportService` both target it, because that is
where LeRobot went. Everything this platform READS is v2.1: the episode viewer,
the frame endpoint, the video streamer and the whole of `curate.py`. So the
datasets we produce are the ones we handle worst, and the conversion step that
closes the gap was, until now, a script in somebody's external Isaac-GR00T
checkout that `docs/vr-teleop-data-collection.md` calls mandatory. A mandatory
pipeline step that lives on one person's disk is not a pipeline.

WHAT ACTUALLY DIFFERS. Only aggregation, and it is the whole job:

    v2.1   data/chunk-000/episode_000007.parquet          one file per episode
           videos/chunk-000/<key>/episode_000007.mp4      one file per episode

    v3.0   data/chunk-000/file-000.parquet                MANY episodes per file
           videos/<key>/chunk-000/file-000.mp4            MANY episodes per file
           meta/episodes/chunk-000/file-000.parquet       says where each one is

v3.0 addresses an episode by a row range (`dataset_from_index`,
`dataset_to_index`) and a time window (`videos/<key>/from_timestamp`,
`.../to_timestamp`). Splitting on those two is the conversion. The frame columns
need no renumbering: v3.0 already stores `frame_index` and `timestamp` relative
to the episode and `index` globally, exactly as v2.1 does.

THE OUTPUT IS A CACHE, NOT A SECOND TRUTH. It is regenerable from the v3.0 tree
and safe to delete. Nothing should ever point a `Dataset` row's `storagePath` at
it as the storage of record.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
except ImportError as exc:  # pragma: no cover - environment, not logic
    print(json.dumps({"ok": False, "error": "DEPS_MISSING", "detail": str(exc)}))
    raise SystemExit(2) from exc

CODEBASE_VERSION_OUT = "v2.1"
CHUNK_SIZE = 1000
DATA_PATH_OUT = "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet"
VIDEO_PATH_OUT = "videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4"


class ConvertError(Exception):
    """A failure with a machine-readable code, so the UI can say which one."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


@dataclass
class Episode:
    index: int
    length: int
    from_index: int
    to_index: int
    tasks: list[str]
    data_chunk: int
    data_file: int
    #: video_key -> (from_timestamp, to_timestamp, chunk_index, file_index)
    videos: dict[str, tuple[float, float, int, int]]


def _find_ffmpeg() -> str:
    ffmpeg = os.environ.get("CURATION_FFMPEG") or shutil.which("ffmpeg")
    if not ffmpeg:
        # A structured code, not a stack trace: `FFMPEG_MISSING` is already what
        # the curation UI surfaces, and this is the same failure.
        raise ConvertError(
            "FFMPEG_MISSING",
            "ffmpeg is required to cut per-episode videos; set CURATION_FFMPEG or put it on PATH",
        )
    return ffmpeg


def _load_info(root: Path) -> dict[str, Any]:
    path = root / "meta" / "info.json"
    if not path.exists():
        raise ConvertError("NOT_A_DATASET", f"no meta/info.json under {root}")
    info = json.loads(path.read_text())
    version = str(info.get("codebase_version", ""))
    if not version.startswith("v3"):
        raise ConvertError(
            "NOT_V3",
            f"codebase_version is {version!r}; this converter reads v3.0 only",
        )
    return info


def _episode_shards(root: Path) -> list[Path]:
    base = root / "meta" / "episodes"
    if not base.is_dir():
        raise ConvertError("NO_EPISODE_META", "meta/episodes/ is missing — v3.0 stores episode rows there")
    shards = sorted(base.glob("chunk-*/file-*.parquet"))
    if not shards:
        raise ConvertError("NO_EPISODE_META", f"no chunk-*/file-*.parquet under {base}")
    return shards


def _read_episodes(root: Path, video_keys: list[str]) -> list[Episode]:
    rows: list[Episode] = []
    for shard in _episode_shards(root):
        table = pq.read_table(shard)
        cols = table.column_names
        for required in ("episode_index", "length", "dataset_from_index", "dataset_to_index"):
            if required not in cols:
                raise ConvertError("EPISODE_META_INCOMPLETE", f"{shard.name} has no {required!r} column")
        data = table.to_pydict()
        for i in range(table.num_rows):
            videos: dict[str, tuple[float, float, int, int]] = {}
            for key in video_keys:
                prefix = f"videos/{key}"
                if f"{prefix}/from_timestamp" not in cols:
                    continue
                videos[key] = (
                    float(data[f"{prefix}/from_timestamp"][i]),
                    float(data[f"{prefix}/to_timestamp"][i]),
                    int(data.get(f"{prefix}/chunk_index", [0] * table.num_rows)[i] or 0),
                    int(data.get(f"{prefix}/file_index", [0] * table.num_rows)[i] or 0),
                )
            tasks = data.get("tasks", [None] * table.num_rows)[i]
            rows.append(Episode(
                index=int(data["episode_index"][i]),
                length=int(data["length"][i]),
                from_index=int(data["dataset_from_index"][i]),
                to_index=int(data["dataset_to_index"][i]),
                tasks=[str(t) for t in (tasks or [])],
                # These two are how v3.0 says which data file holds the episode.
                # Absent in the earliest trees this repo wrote, and there was
                # only ever one file then, so 0/0 is the right default.
                data_chunk=int(data.get("data/chunk_index", [0] * table.num_rows)[i] or 0),
                data_file=int(data.get("data/file_index", [0] * table.num_rows)[i] or 0),
                videos=videos,
            ))
    rows.sort(key=lambda e: e.index)
    return rows


def _read_tasks(root: Path) -> list[str]:
    """The task strings, by task_index.

    v3.0 indexes `meta/tasks.parquet` BY THE TASK STRING — `LeRobotDataset`
    ends `__getitem__` with `self.meta.tasks.iloc[task_idx].name`, so the
    instruction is the index and `task_index` is the column. v2.1's
    `meta/tasks.jsonl` is the other way round, which is why this cannot be a
    file copy.
    """
    path = root / "meta" / "tasks.parquet"
    if not path.exists():
        jsonl = root / "meta" / "tasks.jsonl"
        if not jsonl.exists():
            raise ConvertError("NO_TASKS", "neither meta/tasks.parquet nor meta/tasks.jsonl is present")
        by_index: dict[int, str] = {}
        for line in jsonl.read_text().splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            by_index[int(row["task_index"])] = str(row["task"])
        return [by_index.get(i, "") for i in range(max(by_index) + 1)] if by_index else []

    table = pq.read_table(path)
    data = table.to_pydict()
    if "task_index" not in data:
        raise ConvertError("NO_TASKS", "meta/tasks.parquet has no task_index column")
    # The strings live in whichever column is not `task_index` — the pandas
    # index round-trips through parquet as a named column (`__index_level_0__`
    # when it was unnamed), so the name is not something to rely on.
    text_col = next((c for c in table.column_names if c != "task_index"), None)
    if text_col is None:
        raise ConvertError("NO_TASKS", "meta/tasks.parquet carries no task strings")
    out: dict[int, str] = {}
    for i in range(table.num_rows):
        out[int(data["task_index"][i])] = str(data[text_col][i])
    return [out.get(i, "") for i in range(max(out) + 1)] if out else []


def _data_files(root: Path, info: dict[str, Any]) -> dict[tuple[int, int], Path]:
    template = str(info.get("data_path", ""))
    found: dict[tuple[int, int], Path] = {}
    for path in sorted((root / "data").glob("chunk-*/file-*.parquet")):
        chunk = int(path.parent.name.split("-")[1])
        file_index = int(path.stem.split("-")[1])
        found[(chunk, file_index)] = path
    if not found:
        raise ConvertError("NO_DATA", f"no data/chunk-*/file-*.parquet under {root} (data_path={template!r})")
    return found


def _slice_episode(table: pa.Table, episode: Episode) -> pa.Table:
    """The episode's rows, taken by `episode_index` rather than by arithmetic.

    `dataset_from_index` is global across the whole dataset while a row offset
    is local to one file, and the two agree only while there is exactly one data
    file. Selecting on the column the rows themselves carry is right in both
    cases, and it is checked against the declared length below.
    """
    if "episode_index" not in table.column_names:
        raise ConvertError("DATA_INCOMPLETE", "the data parquet has no episode_index column")
    mask = pa.compute.equal(table["episode_index"], pa.scalar(episode.index, type=table.schema.field("episode_index").type))
    return table.filter(mask)


def _count_frames(ffmpeg: str, path: Path) -> int | None:
    """Frames in an mp4, or None when the probe is unavailable.

    `ffprobe` sits next to `ffmpeg`; when it does not, the check is skipped
    rather than the conversion refused.
    """
    probe = Path(ffmpeg).with_name("ffprobe")
    if not probe.exists():
        return None
    result = subprocess.run(
        [str(probe), "-v", "error", "-count_frames", "-select_streams", "v:0",
         "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return None
    try:
        return int(result.stdout.strip().split(",")[0])
    except (ValueError, IndexError):
        return None


def _write_video_segment(
    ffmpeg: str,
    src: Path,
    dst: Path,
    start_s: float,
    end_s: float,
    expect_frames: int | None = None,
) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    duration = max(0.0, end_s - start_s)
    # `-ss` BEFORE `-i` seeks fast and, since ffmpeg 2.1, accurately when the
    # output is re-encoded. Re-encoding rather than `-c copy` is the point: a
    # stream copy snaps the cut to the nearest keyframe, which for a 30 s
    # recording of 3 episodes puts most of episode 1 at the front of episode 2.
    cmd = [
        ffmpeg, "-y", "-loglevel", "error",
        "-ss", f"{start_s:.6f}",
        "-i", str(src),
        "-t", f"{duration:.6f}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-an",
        str(dst),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise ConvertError("FFMPEG_FAILED", f"cutting {dst.name}: {result.stderr.strip()[:400]}")

    # The cut was never checked. ffmpeg exits 0 for a window that starts past
    # the end of the source — it just writes a video with no frames in it — so a
    # source mp4 shorter than the episode metadata claims produced empty episode
    # videos and the converter still reported ok:true.
    if not dst.exists() or dst.stat().st_size == 0:
        raise ConvertError("VIDEO_EMPTY", f"cutting {dst.name} produced an empty file")
    frames = _count_frames(ffmpeg, dst)
    if frames is not None:
        if frames == 0:
            raise ConvertError(
                "VIDEO_EMPTY",
                f"{dst.name}: the {start_s:.3f}-{end_s:.3f}s window cut zero frames out of "
                f"{src.name} — the source is shorter than the episode metadata says",
            )
        # One frame of slack: a cut on a non-keyframe boundary can land either
        # side, and that is not a broken conversion.
        if expect_frames is not None and abs(frames - expect_frames) > 1:
            raise ConvertError(
                "VIDEO_SHORT",
                f"{dst.name}: cut {frames} frames for an episode of {expect_frames}",
            )


def convert(
    source: Path,
    out: Path,
    force: bool = False,
    chunk_size: int = CHUNK_SIZE,
) -> dict[str, Any]:
    source = source.expanduser().resolve()
    out = out.expanduser().resolve()
    if out.exists() and not force:
        raise ConvertError("OUTPUT_EXISTS", f"{out} already exists; pass --force to replace it")
    # NOT `shutil.rmtree(out)` here. The server always passes --force, so
    # deleting the destination up front meant a conversion that then failed —
    # a missing video, ffmpeg gone — had already destroyed the working view an
    # operator was reading. The old tree stays until the new one is complete.

    info = _load_info(source)
    features = dict(info.get("features") or {})
    video_keys = [k for k, f in features.items() if (f or {}).get("dtype") == "video"]
    episodes = _read_episodes(source, video_keys)
    if not episodes:
        raise ConvertError("NO_EPISODES", "meta/episodes carries no rows")
    tasks = _read_tasks(source)
    data_files = _data_files(source, info)

    ffmpeg = _find_ffmpeg() if video_keys else None

    # Written to a sibling and moved into place, so a converter that dies
    # halfway does not leave a half-tree that the reader treats as a cache hit.
    #
    # The name carries this process's pid: two servers converting the same
    # dataset shared one staging path, and each deleted the other's work
    # mid-write — which surfaced as a bogus FFMPEG_FAILED on a sound archive.
    staging = out.parent / f".{out.name}.{os.getpid()}.partial"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)

    # Any failure from here removes the staging tree; the success path renames
    # it into place, so there is nothing left either way. A failed conversion
    # used to leave `.<name>.partial` behind, and every retry made another one.
    try:
        (staging / "meta").mkdir(parents=True, exist_ok=True)

        loaded: dict[tuple[int, int], pa.Table] = {}
        chunks_written: set[int] = set()
        episodes_meta: list[dict[str, Any]] = []
        total_frames = 0
        total_videos = 0

        for episode in episodes:
            key = (episode.data_chunk, episode.data_file)
            if key not in loaded:
                path = data_files.get(key)
                if path is None:
                    raise ConvertError(
                        "DATA_MISSING",
                        f"episode {episode.index} names data chunk {key} and no such file exists",
                    )
                loaded[key] = pq.read_table(path)
            rows = _slice_episode(loaded[key], episode)
            if rows.num_rows != episode.length:
                raise ConvertError(
                    "LENGTH_MISMATCH",
                    f"episode {episode.index}: meta says {episode.length} frames, the data parquet holds "
                    f"{rows.num_rows}",
                )
            # The chunk is computed, not hardcoded. Every episode used to be written
            # to chunk-000 while `info.json` declared `chunks_size: 1000`, so a view
            # of a >1000-episode dataset failed this repo's own validator: it looks
            # for episode 1000 under chunk-001, which never existed.
            episode_chunk = episode.index // chunk_size
            chunks_written.add(episode_chunk)
            data_rel = DATA_PATH_OUT.format(
                episode_chunk=episode_chunk, episode_index=episode.index,
            )
            (staging / data_rel).parent.mkdir(parents=True, exist_ok=True)
            pq.write_table(rows, staging / data_rel)
            total_frames += rows.num_rows

            task_names = episode.tasks
            if not task_names and "task_index" in rows.column_names and rows.num_rows:
                first = int(rows["task_index"][0].as_py())
                task_names = [tasks[first]] if 0 <= first < len(tasks) else []
            episodes_meta.append({
                "episode_index": episode.index,
                "tasks": task_names,
                "length": rows.num_rows,
            })

            for video_key, (start, end, chunk, file_index) in episode.videos.items():
                assert ffmpeg is not None
                src = source / "videos" / video_key / f"chunk-{chunk:03d}" / f"file-{file_index:03d}.mp4"
                if not src.exists():
                    raise ConvertError(
                        "VIDEO_MISSING",
                        f"episode {episode.index} names {src.relative_to(source)} and it is not there",
                    )
                rel = VIDEO_PATH_OUT.format(
                    episode_chunk=episode_chunk, video_key=video_key, episode_index=episode.index,
                )
                _write_video_segment(
                    ffmpeg, src, staging / rel, start, end, expect_frames=episode.length,
                )
                total_videos += 1

        out_info = dict(info)
        out_info["codebase_version"] = CODEBASE_VERSION_OUT
        out_info["data_path"] = DATA_PATH_OUT
        out_info["video_path"] = VIDEO_PATH_OUT if video_keys else None
        out_info["total_episodes"] = len(episodes_meta)
        out_info["total_frames"] = total_frames
        out_info["total_videos"] = total_videos
        out_info["total_tasks"] = len(tasks)
        out_info["total_chunks"] = max(chunks_written) + 1 if chunks_written else 1
        out_info["chunks_size"] = chunk_size
        out_info["splits"] = {"train": f"0:{len(episodes_meta)}"}
        # Where this view came from, so a stray directory is identifiable as cache
        # rather than as somebody's dataset.
        out_info["_neodem_converted_from"] = {"version": info.get("codebase_version"), "path": str(source)}
        (staging / "meta" / "info.json").write_text(json.dumps(out_info, indent=2))

        with (staging / "meta" / "episodes.jsonl").open("w") as fh:
            for row in episodes_meta:
                fh.write(json.dumps(row) + "\n")
        with (staging / "meta" / "tasks.jsonl").open("w") as fh:
            for i, task in enumerate(tasks):
                fh.write(json.dumps({"task_index": i, "task": task}) + "\n")

        stats = source / "meta" / "stats.json"
        if stats.exists():
            shutil.copyfile(stats, staging / "meta" / "stats.json")

        out.parent.mkdir(parents=True, exist_ok=True)
        # The destination is replaced only now, with a complete tree in hand.
        if out.exists():
            shutil.rmtree(out)
        try:
            staging.rename(out)
        except OSError:
            # Another process finished the same conversion between the rmtree and
            # this rename. The view is content-addressed and deterministic, so its
            # tree is ours; take it and drop the duplicate.
            if not (out / "meta" / "info.json").exists():
                raise
            shutil.rmtree(staging, ignore_errors=True)

        return {
            "ok": True,
            "source": str(source),
            "out": str(out),
            "episodes": len(episodes_meta),
            "frames": total_frames,
            "videos": total_videos,
            "video_keys": video_keys,
        }
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    ap = argparse.ArgumentParser(description="Convert a LeRobot v3.0 tree to v2.1")
    ap.add_argument("source", type=Path, help="the v3.0 dataset directory")
    ap.add_argument("out", type=Path, help="where to write the v2.1 view")
    ap.add_argument("--force", action="store_true", help="replace an existing output directory")
    ap.add_argument(
        "--chunk-size", type=int, default=CHUNK_SIZE,
        help=f"episodes per output chunk directory (default {CHUNK_SIZE}); "
             "this is what info.json declares as chunks_size, so the two cannot disagree",
    )
    args = ap.parse_args()
    try:
        result = convert(args.source, args.out, force=args.force, chunk_size=args.chunk_size)
    except ConvertError as exc:
        print(json.dumps({"ok": False, "error": exc.code, "detail": exc.detail}))
        raise SystemExit(1) from exc
    print(json.dumps(result))


if __name__ == "__main__":
    main()
