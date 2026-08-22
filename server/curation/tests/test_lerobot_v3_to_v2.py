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


def convert(source: Path, out: Path, *extra: str) -> tuple[int, dict]:
    result = subprocess.run(
        [sys.executable, str(CONVERT), str(source), str(out), *extra],
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


class TestMultiFile:
    """The (chunk_index, file_index) handling — the reason the converter exists.

    A real recording session splits at `data_files_size_in_mb`, so episode 0's
    rows are in `file-000.parquet` and episode 2's are in `file-002.parquet`
    with its OWN row numbering and its own video timeline. Every test above
    runs against a single-file fixture, where every one of those lookups
    happens to be `[0]` and a converter that ignored them entirely would pass.
    """

    def test_reads_each_episode_out_of_the_file_its_metadata_names(self, tmp_path: Path) -> None:
        make(tmp_path / "v3", "--version", "v3.0", "--files", "3")
        make(tmp_path / "v21")
        code, out = convert(tmp_path / "v3", tmp_path / "conv")
        assert code == 0, out
        assert out["episodes"] == 3

        # The same diff as the single-file round trip: three separate source
        # files have to produce the identical v2.1 tree.
        for episode in range(3):
            name = f"episode_{episode:06d}.parquet"
            ref = pq.read_table(tmp_path / "v21" / "data" / "chunk-000" / name).to_pydict()
            got = pq.read_table(tmp_path / "conv" / "data" / "chunk-000" / name).to_pydict()
            assert set(got) == set(ref), f"episode {episode} column set"
            for column in ref:
                assert got[column] == ref[column], f"episode {episode} column {column}"

    def test_a_missing_second_file_is_named_rather_than_skipped(self, tmp_path: Path) -> None:
        make(tmp_path / "v3", "--version", "v3.0", "--files", "3")
        (tmp_path / "v3" / "data" / "chunk-000" / "file-001.parquet").unlink()
        code, out = convert(tmp_path / "v3", tmp_path / "conv")
        assert code != 0
        assert out["error"] in {"DATA_MISSING", "DATA_INCOMPLETE"}, out
        assert not (tmp_path / "conv").exists()

    def test_the_chunk_it_writes_to_matches_the_chunks_size_it_declares(self, tmp_path: Path) -> None:
        # Every episode used to be written to chunk-000 while info.json declared
        # `chunks_size: 1000`, so a view of a >1000-episode dataset failed this
        # repo's own validator: it looks for episode 1000 under chunk-001, which
        # was never written. `--chunk-size 2` reproduces that at three episodes
        # instead of a thousand.
        make(tmp_path / "v3", "--version", "v3.0")
        code, out = convert(tmp_path / "v3", tmp_path / "conv", "--chunk-size", "2")
        assert code == 0, out

        info = json.loads((tmp_path / "conv" / "meta" / "info.json").read_text())
        assert info["chunks_size"] == 2
        assert info["total_chunks"] == 2
        assert (tmp_path / "conv" / "data" / "chunk-000" / "episode_000000.parquet").exists()
        assert (tmp_path / "conv" / "data" / "chunk-000" / "episode_000001.parquet").exists()
        # The one that used to land in chunk-000 and be unfindable.
        assert (tmp_path / "conv" / "data" / "chunk-001" / "episode_000002.parquet").exists()

    @requires_ffmpeg
    def test_cuts_each_episode_out_of_its_own_video_timeline(self, tmp_path: Path) -> None:
        # The trap: with one video the windows run 0.0-1.0, 1.0-2.1, 2.1-3.3.
        # Split across three, every episode's window starts at 0.0 in ITS file.
        # A converter that used a dataset-global cursor would seek past the end
        # of files 1 and 2 and cut nothing.
        make(tmp_path / "v3", "--version", "v3.0", "--files", "3", "--cameras", "cam_high")
        code, out = convert(tmp_path / "v3", tmp_path / "conv")
        assert code == 0, out
        assert out["videos"] == 3
        for episode, expected in enumerate([10, 11, 12]):
            path = (tmp_path / "conv" / "videos" / "chunk-000"
                    / "observation.images.cam_high" / f"episode_{episode:06d}.mp4")
            _, frames = probe(path)
            assert abs(frames - expected) <= 1, f"episode {episode}: {frames} frames, wanted {expected}"


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


@requires_ffmpeg
class TestVideoCutIsChecked:
    def test_refuses_a_source_video_shorter_than_the_metadata_claims(self, tmp_path: Path) -> None:
        # ffmpeg exits 0 for a window that starts past the end of the source —
        # it writes a video with no frames in it. The cut was never checked, so
        # this produced empty episode videos and reported ok:true, and the
        # dataset failed later in the player with nothing to play.
        make(tmp_path / "v3", "--version", "v3.0", "--cameras", "cam_high")
        src = (tmp_path / "v3" / "videos" / "observation.images.cam_high"
               / "chunk-000" / "file-000.mp4")
        assert src.exists()
        # Re-encode to a fifth of a second: episode 0's window still overlaps,
        # episodes 1 and 2 start past the end.
        assert FFMPEG is not None
        short = src.with_name("short.mp4")
        subprocess.run(
            [FFMPEG, "-y", "-loglevel", "error", "-i", str(src), "-t", "0.2",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", str(short)],
            check=True, capture_output=True,
        )
        short.replace(src)

        code, out = convert(tmp_path / "v3", tmp_path / "conv")
        assert code != 0, out
        assert out["error"] in {"VIDEO_EMPTY", "VIDEO_SHORT"}, out
        # And the failed run left nothing behind — neither a half-tree nor the
        # staging directory it was building in.
        assert not (tmp_path / "conv").exists()
        partials = list(tmp_path.glob(".conv.*.partial"))
        assert partials == [], partials


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
