"""Tests for curate.py (native v2.1 backend): delete/trim with videos, stats
recompute, ffmpeg error handling, and the `suggest` heuristics.

Video tests need ffmpeg (CURATION_FFMPEG env var or `ffmpeg` on PATH) and are
skipped otherwise.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from conftest import CURATION_DIR, find_ffmpeg

CURATE = CURATION_DIR / "curate.py"
MAKE_DS = CURATION_DIR / "make_synthetic_dataset.py"
FFMPEG = find_ffmpeg()

requires_ffmpeg = pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not available (set CURATION_FFMPEG)")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def run_curate(*args: str, env: dict | None = None) -> tuple[int, dict]:
    """Run curate.py, return (exit_code, parsed last-line JSON)."""
    import os

    full_env = dict(os.environ)
    if env:
        full_env.update(env)
    result = subprocess.run(
        [sys.executable, str(CURATE), *args],
        capture_output=True, text=True, env=full_env,
    )
    lines = [l for l in result.stdout.strip().splitlines() if l.strip()]
    assert lines, f"no stdout from curate.py; stderr: {result.stderr}"
    return result.returncode, json.loads(lines[-1])


def make_dataset(root: Path, episodes: int = 4, frames: int = 20, cameras: str = "") -> None:
    args = [
        sys.executable, str(MAKE_DS), str(root),
        "--episodes", str(episodes), "--frames", str(frames), "--action-dim", "6",
    ]
    if cameras:
        args += ["--cameras", cameras]
    subprocess.run(args, check=True, capture_output=True, text=True)


def video_path(root: Path, cam: str, ep: int) -> Path:
    return root / "videos" / "chunk-000" / f"observation.images.{cam}" / f"episode_{ep:06d}.mp4"


def count_video_frames(path: Path) -> int:
    """Count decoded frames with ffmpeg (no ffprobe needed)."""
    assert FFMPEG is not None
    result = subprocess.run(
        [FFMPEG, "-i", str(path), "-map", "0:v:0", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    matches = re.findall(r"frame=\s*(\d+)", result.stderr)
    assert matches, f"could not count frames of {path}: {result.stderr[-400:]}"
    return int(matches[-1])


def episode_lengths(root: Path) -> list[int]:
    lengths = []
    for line in (root / "meta" / "episodes.jsonl").read_text().splitlines():
        if line.strip():
            lengths.append(json.loads(line)["length"])
    return lengths


def snapshot(root: Path) -> dict[str, float]:
    return {str(p.relative_to(root)): p.stat().st_mtime for p in sorted(root.rglob("*")) if p.is_file()}


# ---------------------------------------------------------------------------
# delete: video copy + renumber
# ---------------------------------------------------------------------------

@requires_ffmpeg
def test_delete_renumbers_videos_for_every_camera(tmp_path: Path) -> None:
    src = tmp_path / "src"
    make_dataset(src, episodes=4, frames=8, cameras="top,wrist")
    before = snapshot(src)

    out = tmp_path / "out"
    code, summary = run_curate(
        "delete", "--dataset", str(src), "--output", str(out), "--episodes", "1,3",
    )
    assert code == 0 and summary["ok"] is True

    # episodes 0 and 2 survive, renumbered to 0 and 1 (lengths 8 and 10)
    assert summary["total_episodes"] == 2
    assert episode_lengths(out) == [8, 10]

    for cam in ("top", "wrist"):
        assert video_path(out, cam, 0).exists()
        assert video_path(out, cam, 1).exists()
        assert not video_path(out, cam, 2).exists()
        assert not video_path(out, cam, 3).exists()
        # frame counts follow the surviving episodes (make_synthetic adds +ep per episode)
        assert count_video_frames(video_path(out, cam, 0)) == 8
        assert count_video_frames(video_path(out, cam, 1)) == 10

    info = json.loads((out / "meta" / "info.json").read_text())
    assert info["total_videos"] == 4  # 2 episodes x 2 cameras

    # source is untouched
    assert snapshot(src) == before


# ---------------------------------------------------------------------------
# trim: frame-accurate video re-cut
# ---------------------------------------------------------------------------

@requires_ffmpeg
def test_trim_recuts_video_frame_accurately(tmp_path: Path) -> None:
    src = tmp_path / "src"
    make_dataset(src, episodes=3, frames=20, cameras="top")
    before = snapshot(src)

    out = tmp_path / "out"
    code, summary = run_curate(
        "trim", "--dataset", str(src), "--output", str(out),
        "--episode", "1", "--start", "5", "--end", "15",
    )
    assert code == 0 and summary["ok"] is True
    # ep1 originally 21 frames -> 10 kept; eps 0/2 untouched (20 / 22)
    assert episode_lengths(out) == [20, 10, 22]
    assert summary["total_frames"] == 52

    assert count_video_frames(video_path(out, "top", 0)) == 20
    assert count_video_frames(video_path(out, "top", 1)) == 10
    assert count_video_frames(video_path(out, "top", 2)) == 22

    # trimmed parquet is reindexed from 0 with recomputed timestamps
    table = pq.read_table(out / "data" / "chunk-000" / "episode_000001.parquet")
    assert table.column("frame_index").to_pylist() == list(range(10))
    ts = table.column("timestamp").to_pylist()
    assert ts[0] == pytest.approx(0.0)
    assert ts[-1] == pytest.approx(9 / 30, abs=1e-4)

    assert snapshot(src) == before


def test_trim_video_dataset_without_ffmpeg_fails_clearly(tmp_path: Path) -> None:
    if FFMPEG is None:
        pytest.skip("needs ffmpeg to build the video fixture")
    src = tmp_path / "src"
    make_dataset(src, episodes=2, frames=12, cameras="top")

    out = tmp_path / "out"
    code, summary = run_curate(
        "trim", "--dataset", str(src), "--output", str(out),
        "--episode", "0", "--start", "2", "--end", "8",
        env={"CURATION_FFMPEG": str(tmp_path / "nonexistent-ffmpeg.exe")},
    )
    assert code == 1
    assert summary["ok"] is False
    assert summary["code"] == "FFMPEG_MISSING"
    assert "CURATION_FFMPEG" in summary["error"]


# ---------------------------------------------------------------------------
# stats recompute
# ---------------------------------------------------------------------------

def test_delete_recomputes_stats_correctly(tmp_path: Path) -> None:
    src = tmp_path / "src"
    make_dataset(src, episodes=4, frames=10)

    out = tmp_path / "out"
    code, summary = run_curate(
        "delete", "--dataset", str(src), "--output", str(out), "--episodes", "0,2",
    )
    assert code == 0
    assert summary["stats_recompute_required"] is False

    stats = json.loads((out / "meta" / "stats.json").read_text())
    info = json.loads((out / "meta" / "info.json").read_text())
    assert info["_curation"]["stats_recompute_required"] is False

    # hand-compute the expected stats from the OUTPUT parquets
    arrays = []
    for f in sorted((out / "data" / "chunk-000").glob("episode_*.parquet")):
        arrays.append(np.asarray(pq.read_table(f).column("action").to_pylist(), dtype=np.float64))
    all_rows = np.concatenate(arrays, axis=0)

    got = stats["action"]
    np.testing.assert_allclose(got["mean"], all_rows.mean(axis=0), atol=1e-9)
    np.testing.assert_allclose(got["std"], all_rows.std(axis=0), atol=1e-9)
    np.testing.assert_allclose(got["min"], all_rows.min(axis=0), atol=1e-9)
    np.testing.assert_allclose(got["max"], all_rows.max(axis=0), atol=1e-9)

    # vector features carry per-dimension arrays; scalars a single element
    assert len(got["mean"]) == 6
    assert len(stats["timestamp"]["mean"]) == 1
    assert "frame_index" in stats


def test_no_recompute_stats_flag(tmp_path: Path) -> None:
    src = tmp_path / "src"
    make_dataset(src, episodes=3, frames=10)

    out = tmp_path / "out"
    code, summary = run_curate(
        "delete", "--dataset", str(src), "--output", str(out),
        "--episodes", "1", "--no-recompute-stats",
    )
    assert code == 0
    assert summary["stats_recompute_required"] is True
    assert not (out / "meta" / "stats.json").exists()
    info = json.loads((out / "meta" / "info.json").read_text())
    assert info["_curation"]["stats_recompute_required"] is True


def test_stats_carry_over_video_features_from_source(tmp_path: Path) -> None:
    """Image/video feature stats can't be recomputed from parquet — they must be
    carried over from the source meta/stats.json, while parquet-backed features
    (e.g. `action`) are recomputed and must NOT be carried over."""
    src = tmp_path / "src"
    make_dataset(src, episodes=3, frames=10)

    image_stats = {
        "mean": [[[0.48]], [[0.45]], [[0.41]]],
        "std": [[[0.22]], [[0.23]], [[0.21]]],
        "min": [[[0.0]], [[0.0]], [[0.0]]],
        "max": [[[1.0]], [[1.0]], [[1.0]]],
    }
    stale_action_stats = {"mean": [999.0] * 6, "std": [999.0] * 6, "min": [999.0] * 6, "max": [999.0] * 6}
    (src / "meta" / "stats.json").write_text(json.dumps({
        "observation.images.top": image_stats,
        "action": stale_action_stats,
    }))

    out = tmp_path / "out"
    code, summary = run_curate(
        "delete", "--dataset", str(src), "--output", str(out), "--episodes", "1",
    )
    assert code == 0
    assert summary["stats_recompute_required"] is False

    stats = json.loads((out / "meta" / "stats.json").read_text())
    # video-feature stats survive the rebuild unchanged
    assert stats["observation.images.top"] == image_stats
    # parquet-backed features are freshly recomputed, not carried over
    assert stats["action"]["mean"] != stale_action_stats["mean"]


def test_trim_stats_match_trimmed_data(tmp_path: Path) -> None:
    src = tmp_path / "src"
    make_dataset(src, episodes=2, frames=12)

    out = tmp_path / "out"
    code, _ = run_curate(
        "trim", "--dataset", str(src), "--output", str(out),
        "--episode", "0", "--start", "3", "--end", "9",
    )
    assert code == 0

    stats = json.loads((out / "meta" / "stats.json").read_text())
    arrays = []
    for f in sorted((out / "data" / "chunk-000").glob("episode_*.parquet")):
        arrays.append(np.asarray(pq.read_table(f).column("observation.state").to_pylist(), dtype=np.float64))
    all_rows = np.concatenate(arrays, axis=0)
    np.testing.assert_allclose(stats["observation.state"]["mean"], all_rows.mean(axis=0), atol=1e-9)
    np.testing.assert_allclose(stats["observation.state"]["std"], all_rows.std(axis=0), atol=1e-9)


# ---------------------------------------------------------------------------
# suggest heuristics
# ---------------------------------------------------------------------------

def write_manual_dataset(root: Path, episodes: list[np.ndarray], fps: int = 30) -> None:
    """Write a minimal v2.1 dataset whose `action` column is given per episode."""
    (root / "data" / "chunk-000").mkdir(parents=True)
    (root / "meta").mkdir(parents=True)
    episodes_meta = []
    global_index = 0
    for ep, arr in enumerate(episodes):
        n, dim = arr.shape
        table = pa.table({
            "observation.state": pa.array(arr.tolist(), type=pa.list_(pa.float32())),
            "action": pa.array(arr.tolist(), type=pa.list_(pa.float32())),
            "timestamp": pa.array([round(i / fps, 6) for i in range(n)], type=pa.float32()),
            "frame_index": pa.array(list(range(n)), type=pa.int64()),
            "episode_index": pa.array([ep] * n, type=pa.int64()),
            "index": pa.array(list(range(global_index, global_index + n)), type=pa.int64()),
            "task_index": pa.array([0] * n, type=pa.int64()),
        })
        pq.write_table(table, root / "data" / "chunk-000" / f"episode_{ep:06d}.parquet")
        episodes_meta.append({"episode_index": ep, "tasks": ["t"], "length": n})
        global_index += n
    info = {
        "codebase_version": "v2.1",
        "robot_type": "test",
        "fps": fps,
        "total_episodes": len(episodes),
        "total_frames": global_index,
        "total_tasks": 1,
        "total_videos": 0,
        "total_chunks": 1,
        "chunks_size": 1000,
        "data_path": "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet",
        "video_path": None,
        "splits": {"train": f"0:{len(episodes)}"},
        "features": {
            "observation.state": {"dtype": "float32", "shape": [episodes[0].shape[1]], "names": None},
            "action": {"dtype": "float32", "shape": [episodes[0].shape[1]], "names": None},
        },
    }
    (root / "meta" / "info.json").write_text(json.dumps(info))
    with (root / "meta" / "episodes.jsonl").open("w") as fh:
        for e in episodes_meta:
            fh.write(json.dumps(e) + "\n")
    (root / "meta" / "tasks.jsonl").write_text(json.dumps({"task_index": 0, "task": "t"}) + "\n")


def ramp(n: int, dim: int = 4, step: float = 0.05) -> np.ndarray:
    """Motion in every frame: each row moves by `step` in every dimension."""
    return np.arange(n, dtype=np.float64)[:, None] * step * np.ones((1, dim))


def test_suggest_flags_idle_padding_and_dead_episodes(tmp_path: Path) -> None:
    dim = 4
    # ep0: 10 leading idle frames + motion + 6 trailing idle frames (n=30).
    # ramp(14) starts at 0, i.e. frame 10 still equals the zero padding, so the
    # first moving diff is diff[10] -> lead=10; the last moving diff is
    # diff[22] (frame 23 == frame 24 == ... == frame 29) -> trail=6.
    moving = ramp(14, dim)
    ep0 = np.concatenate([
        np.zeros((10, dim)),           # frames 0..9
        moving,                        # frames 10..23 (frame 10 == 0)
        np.repeat(moving[-1:], 6, 0),  # frames 24..29 identical
    ])
    assert ep0.shape[0] == 30
    ep1 = np.zeros((25, dim))          # no motion at all -> delete
    ep2 = ramp(5, dim)                 # too short -> delete
    ep3 = ramp(30, dim)                # healthy -> no suggestion

    root = tmp_path / "ds"
    write_manual_dataset(root, [ep0, ep1, ep2, ep3])

    code, result = run_curate("suggest", "--dataset", str(root))
    assert code == 0 and result["ok"] is True

    by_ep = {s["episode"]: s for s in result["suggestions"]}
    assert set(by_ep) == {0, 1, 2}

    s0 = by_ep[0]
    assert s0["kind"] == "trim"
    assert s0["start"] == 10  # 10 leading idle diffs
    assert s0["end"] == 24    # 6 trailing idle diffs -> keep [10, 24)
    assert 0 < s0["confidence"] <= 0.95

    assert by_ep[1]["kind"] == "delete"
    assert "near-zero motion" in by_ep[1]["reason"]
    assert by_ep[2]["kind"] == "delete"
    assert "too short" in by_ep[2]["reason"]


def test_suggest_single_episode_and_determinism(tmp_path: Path) -> None:
    root = tmp_path / "ds"
    write_manual_dataset(root, [np.zeros((25, 3)), ramp(30, 3)])

    code, result = run_curate("suggest", "--dataset", str(root), "--episode", "0")
    assert code == 0
    assert [s["episode"] for s in result["suggestions"]] == [0]

    _, again = run_curate("suggest", "--dataset", str(root), "--episode", "0")
    assert result["suggestions"] == again["suggestions"]


def test_suggest_out_of_range_episode(tmp_path: Path) -> None:
    root = tmp_path / "ds"
    write_manual_dataset(root, [ramp(15, 3)])
    code, result = run_curate("suggest", "--dataset", str(root), "--episode", "7")
    assert code == 1
    assert result["code"] == "INVALID_EPISODES"


# ---------------------------------------------------------------------------
# regression: original non-video behavior still holds
# ---------------------------------------------------------------------------

def test_delete_reindexes_and_keeps_source(tmp_path: Path) -> None:
    src = tmp_path / "src"
    make_dataset(src, episodes=4, frames=20)
    out = tmp_path / "out"
    code, summary = run_curate(
        "delete", "--dataset", str(src), "--output", str(out), "--episodes", "1,3",
    )
    assert code == 0
    assert summary["total_episodes"] == 2
    assert summary["total_frames"] == 20 + 22

    # global index contiguous across surviving episodes
    idx = []
    for f in sorted((out / "data" / "chunk-000").glob("episode_*.parquet")):
        idx += pq.read_table(f).column("index").to_pylist()
    assert idx == list(range(len(idx)))

    # source unchanged
    src_info = json.loads((src / "meta" / "info.json").read_text())
    assert src_info["total_episodes"] == 4


def test_delete_all_episodes_rejected(tmp_path: Path) -> None:
    src = tmp_path / "src"
    make_dataset(src, episodes=2, frames=10)
    code, result = run_curate(
        "delete", "--dataset", str(src), "--output", str(tmp_path / "out"), "--episodes", "0,1",
    )
    assert code == 1
    assert result["code"] == "EMPTY_RESULT"


# ---------------------------------------------------------------------------
# more than one chunk (TASK-479)
# ---------------------------------------------------------------------------

def rechunk(root: Path, chunks_size: int, *, move: bool = True) -> None:
    """Declare `chunks_size` in info.json and (with `move`) put each episode's
    parquet and videos in chunk `episode // chunks_size`, as LeRobot v2.1 and
    the v3.0 converter do. `move=False` leaves everything in chunk-000 — the
    tree an older converter wrote."""
    info_path = root / "meta" / "info.json"
    info = json.loads(info_path.read_text())
    total = info["total_episodes"]
    info["chunks_size"] = chunks_size
    info["total_chunks"] = (total - 1) // chunks_size + 1
    info_path.write_text(json.dumps(info))
    if not move:
        return
    for ep in range(total):
        chunk = f"chunk-{ep // chunks_size:03d}"
        if chunk == "chunk-000":
            continue
        for old in list(root.glob(f"**/chunk-000/**/episode_{ep:06d}.*")):
            new = root / Path(*[chunk if part == "chunk-000" else part for part in old.relative_to(root).parts])
            new.parent.mkdir(parents=True, exist_ok=True)
            old.rename(new)


def data_files(root: Path) -> list[str]:
    return sorted(str(p.relative_to(root / "data")) for p in (root / "data").rglob("*.parquet"))


def test_rechunk_fixture_leaves_the_first_chunk(tmp_path: Path) -> None:
    src = tmp_path / "src"
    make_dataset(src, episodes=5, frames=8)
    rechunk(src, 2)
    assert data_files(src) == [
        "chunk-000/episode_000000.parquet", "chunk-000/episode_000001.parquet",
        "chunk-001/episode_000002.parquet", "chunk-001/episode_000003.parquet",
        "chunk-002/episode_000004.parquet",
    ]


def test_delete_reads_and_writes_every_chunk(tmp_path: Path) -> None:
    # Episodes 2..4 are in chunk-001 and chunk-002; curate.py read every
    # episode from chunk-000 and failed on the first one that is not there.
    src = tmp_path / "src"
    make_dataset(src, episodes=5, frames=8)  # lengths 8, 9, 10, 11, 12
    rechunk(src, 2)
    before = snapshot(src)

    out = tmp_path / "out"
    code, summary = run_curate(
        "delete", "--dataset", str(src), "--output", str(out), "--episodes", "1",
    )
    assert code == 0 and summary["ok"] is True, summary
    assert episode_lengths(out) == [8, 10, 11, 12]

    # The output declares chunks_size 2, so it is written two episodes a chunk.
    assert data_files(out) == [
        "chunk-000/episode_000000.parquet", "chunk-000/episode_000001.parquet",
        "chunk-001/episode_000002.parquet", "chunk-001/episode_000003.parquet",
    ]
    info = json.loads((out / "meta" / "info.json").read_text())
    assert info["chunks_size"] == 2
    assert info["total_chunks"] == 2
    assert info["total_episodes"] == 4

    # Each surviving episode is the source episode it came from, renumbered.
    index = []
    for new_ep, old_ep in enumerate([0, 2, 3, 4]):
        got = pq.read_table(out / "data" / f"chunk-{new_ep // 2:03d}" / f"episode_{new_ep:06d}.parquet")
        ref = pq.read_table(src / "data" / f"chunk-{old_ep // 2:03d}" / f"episode_{old_ep:06d}.parquet")
        assert got.column("action").to_pylist() == ref.column("action").to_pylist()
        assert set(got.column("episode_index").to_pylist()) == {new_ep}
        index += got.column("index").to_pylist()
    assert index == list(range(8 + 10 + 11 + 12))

    # Stats cover every chunk of the output, not only chunk-000.
    stats = json.loads((out / "meta" / "stats.json").read_text())
    assert stats["episode_index"]["max"] == [3]
    assert stats["index"]["max"] == [40]

    assert snapshot(src) == before


@requires_ffmpeg
def test_trim_and_delete_move_videos_across_chunks(tmp_path: Path) -> None:
    src = tmp_path / "src"
    make_dataset(src, episodes=4, frames=8, cameras="top")  # lengths 8, 9, 10, 11
    rechunk(src, 2)
    key = "observation.images.top"
    assert (src / "videos" / "chunk-001" / key / "episode_000003.mp4").exists()

    trimmed = tmp_path / "trimmed"
    code, summary = run_curate(
        "trim", "--dataset", str(src), "--output", str(trimmed),
        "--episode", "3", "--start", "2", "--end", "7",
    )
    assert code == 0 and summary["ok"] is True, summary
    assert episode_lengths(trimmed) == [8, 9, 10, 5]
    assert count_video_frames(trimmed / "videos" / "chunk-001" / key / "episode_000003.mp4") == 5
    assert count_video_frames(trimmed / "videos" / "chunk-001" / key / "episode_000002.mp4") == 10

    out = tmp_path / "out"
    code, summary = run_curate(
        "delete", "--dataset", str(src), "--output", str(out), "--episodes", "0,1",
    )
    assert code == 0 and summary["ok"] is True, summary
    # Source episodes 2 and 3 (chunk-001) become 0 and 1 (chunk-000).
    assert count_video_frames(out / "videos" / "chunk-000" / key / "episode_000000.mp4") == 10
    assert count_video_frames(out / "videos" / "chunk-000" / key / "episode_000001.mp4") == 11
    assert not (out / "videos" / "chunk-001").exists()
    assert summary["total_videos"] == 2


def test_suggest_reads_episodes_past_the_first_chunk(tmp_path: Path) -> None:
    root = tmp_path / "ds"
    write_manual_dataset(root, [ramp(30, 3), ramp(30, 3), np.zeros((25, 3)), ramp(30, 3), ramp(5, 3)])
    rechunk(root, 2)

    code, result = run_curate("suggest", "--dataset", str(root))
    assert code == 0 and result["ok"] is True, result
    assert {s["episode"]: s["kind"] for s in result["suggestions"]} == {2: "delete", 4: "delete"}

    code, result = run_curate("suggest", "--dataset", str(root), "--episode", "4")
    assert code == 0
    assert [s["episode"] for s in result["suggestions"]] == [4]


def test_a_tree_kept_in_chunk_000_is_still_read(tmp_path: Path) -> None:
    # An older v3.0 -> v2.1 view: chunks_size declared, every episode in chunk-000.
    src = tmp_path / "src"
    make_dataset(src, episodes=3, frames=8)
    rechunk(src, 2, move=False)

    out = tmp_path / "out"
    code, summary = run_curate(
        "delete", "--dataset", str(src), "--output", str(out), "--episodes", "0",
    )
    assert code == 0 and summary["ok"] is True, summary
    assert episode_lengths(out) == [9, 10]
    assert data_files(out) == ["chunk-000/episode_000000.parquet", "chunk-000/episode_000001.parquet"]
