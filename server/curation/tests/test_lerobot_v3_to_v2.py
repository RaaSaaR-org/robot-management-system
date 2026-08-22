"""Tests for lerobot_v3_to_v2.py — the converter that makes a v3.0 dataset readable.

The central test is a DIFF, not a self-check: `make_synthetic_dataset.py` can
emit v2.1 and v3.0 from the same arguments and the same series, so converting
the v3.0 one has to reproduce the v2.1 one. A converter tested only against its
own output proves that it is deterministic, which is not the question.

Video tests need ffmpeg (CURATION_FFMPEG env var or `ffmpeg` on PATH) and are
skipped otherwise.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pyarrow.parquet as pq
import pytest

from conftest import CURATION_DIR, find_ffmpeg

CONVERT = CURATION_DIR / "lerobot_v3_to_v2.py"
MAKE_DS = CURATION_DIR / "make_synthetic_dataset.py"
FFMPEG = find_ffmpeg()

requires_ffmpeg = pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not available (set CURATION_FFMPEG)")

# Small and odd on purpose: 3 episodes of 10, 11 and 12 frames, so an off-by-one
# in the row ranges cannot hide behind equal-length episodes.
COMMON = ["--episodes", "3", "--frames", "10", "--action-dim", "6", "--fps", "10"]


def make(root: Path, *extra: str) -> None:
    result = subprocess.run(
        [sys.executable, str(MAKE_DS), str(root), *COMMON, *extra],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr


def convert(source: Path, out: Path) -> tuple[int, dict]:
    result = subprocess.run(
        [sys.executable, str(CONVERT), str(source), str(out)],
        capture_output=True, text=True,
    )
    lines = [l for l in result.stdout.strip().splitlines() if l.strip()]
    assert lines, f"no stdout from the converter; stderr: {result.stderr}"
    return result.returncode, json.loads(lines[-1])


def probe(path: Path) -> tuple[float, int]:
    """(duration, frame count) of an mp4, counting frames rather than trusting metadata."""
    assert FFMPEG is not None
    ffprobe = str(Path(FFMPEG).with_name("ffprobe"))
    result = subprocess.run(
        [ffprobe, "-v", "error", "-count_frames", "-select_streams", "v:0",
         "-show_entries", "stream=nb_read_frames,duration", "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    stream = json.loads(result.stdout)["streams"][0]
    return float(stream.get("duration", 0)), int(stream.get("nb_read_frames", 0))


class TestRoundTrip:
    def test_reproduces_the_v21_dataset_built_from_the_same_series(self, tmp_path: Path) -> None:
        # THE test. Both fixtures come from the same generator with the same
        # arguments, so every number in one has a counterpart in the other.
        make(tmp_path / "v3", "--version", "v3.0")
        make(tmp_path / "v21")
        code, out = convert(tmp_path / "v3", tmp_path / "conv")
        assert code == 0, out
        assert out["episodes"] == 3

        reference = json.loads((tmp_path / "v21" / "meta" / "info.json").read_text())
        converted = json.loads((tmp_path / "conv" / "meta" / "info.json").read_text())
        for key in ("codebase_version", "robot_type", "fps", "total_episodes",
                    "total_frames", "data_path", "chunks_size"):
            assert converted[key] == reference[key], key

        ref_eps = [json.loads(l) for l in (tmp_path / "v21" / "meta" / "episodes.jsonl").read_text().splitlines() if l.strip()]
        got_eps = [json.loads(l) for l in (tmp_path / "conv" / "meta" / "episodes.jsonl").read_text().splitlines() if l.strip()]
        assert got_eps == ref_eps

    def test_every_frame_of_every_episode_matches_row_for_row(self, tmp_path: Path) -> None:
        make(tmp_path / "v3", "--version", "v3.0")
        make(tmp_path / "v21")
        convert(tmp_path / "v3", tmp_path / "conv")

        for episode in range(3):
            name = f"episode_{episode:06d}.parquet"
            ref = pq.read_table(tmp_path / "v21" / "data" / "chunk-000" / name).to_pydict()
            got = pq.read_table(tmp_path / "conv" / "data" / "chunk-000" / name).to_pydict()
            assert set(got) == set(ref), f"episode {episode} column set"
            for column in ref:
                assert got[column] == ref[column], f"episode {episode} column {column}"

    def test_the_episodes_it_writes_are_the_lengths_the_metadata_declared(self, tmp_path: Path) -> None:
        # 10, 11 and 12 — `make_synthetic_dataset` varies the length per episode
        # precisely so a converter that splits evenly is caught.
        make(tmp_path / "v3", "--version", "v3.0")
        convert(tmp_path / "v3", tmp_path / "conv")
        lengths = [
            pq.read_table(tmp_path / "conv" / "data" / "chunk-000" / f"episode_{i:06d}.parquet").num_rows
            for i in range(3)
        ]
        assert lengths == [10, 11, 12]

    def test_tasks_come_back_as_strings_not_indices(self, tmp_path: Path) -> None:
        # v3.0 indexes tasks.parquet BY the instruction and v2.1 lists it as a
        # column, so this is the one piece of metadata that cannot be copied.
        make(tmp_path / "v3", "--version", "v3.0")
        convert(tmp_path / "v3", tmp_path / "conv")
        rows = [json.loads(l) for l in (tmp_path / "conv" / "meta" / "tasks.jsonl").read_text().splitlines() if l.strip()]
        assert rows == [
            {"task_index": 0, "task": "pick up the cube"},
            {"task_index": 1, "task": "place the cube"},
        ]
        episodes = [json.loads(l) for l in (tmp_path / "conv" / "meta" / "episodes.jsonl").read_text().splitlines() if l.strip()]
        assert episodes[0]["tasks"] == ["pick up the cube"]
        assert episodes[1]["tasks"] == ["place the cube"]


@requires_ffmpeg
class TestVideo:
    def test_cuts_one_mp4_per_episode_at_the_declared_windows(self, tmp_path: Path) -> None:
        make(tmp_path / "v3", "--version", "v3.0", "--cameras", "cam_high")
        code, out = convert(tmp_path / "v3", tmp_path / "conv")
        assert code == 0, out
        assert out["videos"] == 3

        key = "observation.images.cam_high"
        source_duration, source_frames = probe(
            tmp_path / "v3" / "videos" / key / "chunk-000" / "file-000.mp4")
        assert source_frames == 33  # 10 + 11 + 12, one video frame per data row

        counts = []
        for episode in range(3):
            path = tmp_path / "conv" / "videos" / "chunk-000" / key / f"episode_{episode:06d}.mp4"
            assert path.exists(), path
            duration, frames = probe(path)
            counts.append(frames)
        # Within one frame, per the acceptance criterion — measured exact here.
        assert counts == [10, 11, 12], counts
        assert sum(counts) == source_frames

    def test_does_not_stream_copy_the_cut(self, tmp_path: Path) -> None:
        # A `-c copy` cut snaps to the nearest keyframe, which puts most of one
        # episode at the front of the next. The frame counts above would still
        # look plausible; what would not is the first frame's content. testsrc
        # counts visibly, so episode 1 starting at the same picture as episode 0
        # is exactly the failure this catches.
        make(tmp_path / "v3", "--version", "v3.0", "--cameras", "cam_high")
        convert(tmp_path / "v3", tmp_path / "conv")
        key = "observation.images.cam_high"
        assert FFMPEG is not None

        def first_frame(path: Path, out: Path) -> bytes:
            subprocess.run(
                [FFMPEG, "-y", "-loglevel", "error", "-i", str(path),
                 "-frames:v", "1", str(out)],
                check=True, capture_output=True,
            )
            return out.read_bytes()

        a = first_frame(tmp_path / "conv" / "videos" / "chunk-000" / key / "episode_000000.mp4",
                        tmp_path / "a.png")
        b = first_frame(tmp_path / "conv" / "videos" / "chunk-000" / key / "episode_000001.mp4",
                        tmp_path / "b.png")
        assert a != b, "episode 1 starts on the same picture as episode 0 — the cut snapped to a keyframe"


class TestRefusals:
    def test_refuses_a_v21_tree(self, tmp_path: Path) -> None:
        make(tmp_path / "v21")
        code, out = convert(tmp_path / "v21", tmp_path / "conv")
        assert code == 1
        assert out["error"] == "NOT_V3"

    def test_refuses_a_directory_that_is_not_a_dataset(self, tmp_path: Path) -> None:
        (tmp_path / "empty").mkdir()
        code, out = convert(tmp_path / "empty", tmp_path / "conv")
        assert code == 1
        assert out["error"] == "NOT_A_DATASET"

    def test_will_not_silently_replace_an_existing_output(self, tmp_path: Path) -> None:
        make(tmp_path / "v3", "--version", "v3.0")
        (tmp_path / "conv").mkdir()
        code, out = convert(tmp_path / "v3", tmp_path / "conv")
        assert code == 1
        assert out["error"] == "OUTPUT_EXISTS"

    def test_says_which_file_is_missing_rather_than_producing_a_short_dataset(self, tmp_path: Path) -> None:
        make(tmp_path / "v3", "--version", "v3.0", "--break", "missing-parquet")
        code, out = convert(tmp_path / "v3", tmp_path / "conv")
        assert code == 1
        assert out["error"] == "NO_DATA"
        # And it left nothing half-written behind.
        assert not (tmp_path / "conv").exists()
