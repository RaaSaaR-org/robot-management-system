"""Tests for `DatasetViewService.materialize` (TASK-240, last acceptance criterion).

`materialize` is TypeScript, but it does not itself touch a dataset: it turns a
view's resolved selection into a sequence of `curate.py` invocations — one
`delete` pass for the COMPLEMENT of the selection, then one `trim` pass per
trimmed episode, each into a `<output>.step-N` scratch directory that is removed
afterwards, with the last pass writing the output directory. What that plan is
worth can therefore be decided here, where the real dataset lives.

`plan_materialize` below is a line-for-line port of the planning half of
`server/src/services/DatasetViewService.ts::materialize`; `run_plan` executes it
exactly as `EpisodeCurationService` does. `test_service_still_plans_the_rank...`
guards the port against the TypeScript drifting away from it.

**What "byte-equivalent" means here.** For a selection with no trims the plan is
a single `delete` of the complement, so the claim is literal: every file in the
output has the same bytes as the file `curate.py delete` writes on its own,
mp4s included (`delete` copies videos, it does not re-encode them), and
`curate.py` is deterministic enough for that to hold run to run. Once an
episode is trimmed a literal comparison stops meaning anything — the trimmed
camera video is re-encoded by ffmpeg and no reference command produces the same
directory — so equivalence is defined on the content instead: per-episode frame
counts, every parquet payload column equal to the corresponding slice of the
parent's own episode, `frame_index` / `episode_index` / `index` / `timestamp`
renumbered the way `curate.py` renumbers them, the metadata files, the
recomputed stats, and the decoded frame count of each video.

Video tests need ffmpeg (CURATION_FFMPEG env var or `ffmpeg` on PATH) and are
skipped otherwise.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import pytest

from conftest import CURATION_DIR, find_ffmpeg

CURATE = CURATION_DIR / "curate.py"
MAKE_DS = CURATION_DIR / "make_synthetic_dataset.py"
SERVICE_TS = CURATION_DIR.parents[0] / "src" / "services" / "DatasetViewService.ts"
FFMPEG = find_ffmpeg()

requires_ffmpeg = pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not available (set CURATION_FFMPEG)")

FPS = 30
#: `make_synthetic_dataset.py` writes `frames + episode_index` frames per episode.
PARENT_LENGTHS = [60, 61, 62, 63, 64, 65]


# ---------------------------------------------------------------------------
# Fixtures and readers (same shape as test_curate.py)
# ---------------------------------------------------------------------------

def make_dataset(root: Path, episodes: int = 6, frames: int = 60, cameras: str = "") -> None:
    args = [
        sys.executable, str(MAKE_DS), str(root),
        "--episodes", str(episodes), "--frames", str(frames), "--action-dim", "6",
        "--fps", str(FPS),
    ]
    if cameras:
        args += ["--cameras", cameras]
    subprocess.run(args, check=True, capture_output=True, text=True)


def run_curate(*args: str) -> tuple[int, dict]:
    """Run curate.py, return (exit_code, parsed last-line JSON)."""
    result = subprocess.run(
        [sys.executable, str(CURATE), *args], capture_output=True, text=True,
    )
    lines = [l for l in result.stdout.strip().splitlines() if l.strip()]
    assert lines, f"no stdout from curate.py; stderr: {result.stderr}"
    return result.returncode, json.loads(lines[-1])


def episode_lengths(root: Path) -> list[int]:
    return [
        json.loads(l)["length"]
        for l in (root / "meta" / "episodes.jsonl").read_text().splitlines()
        if l.strip()
    ]


def episode_tasks(root: Path) -> list[list[str]]:
    return [
        json.loads(l)["tasks"]
        for l in (root / "meta" / "episodes.jsonl").read_text().splitlines()
        if l.strip()
    ]


def episode_table(root: Path, episode: int):
    return pq.read_table(root / "data" / "chunk-000" / f"episode_{episode:06d}.parquet")


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


def file_hashes(root: Path) -> dict[str, str]:
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*")) if p.is_file()
    }


# ---------------------------------------------------------------------------
# The port: DatasetViewService.materialize's planning half
# ---------------------------------------------------------------------------

def plan_materialize(
    total: int,
    episodes: list[dict],
    *,
    trim_position: str = "rank",
) -> list[tuple]:
    """The curate.py calls `materialize` emits for a resolved selection.

    Ported from `DatasetViewService.materialize`. `episodes` are the entries
    `resolve()` returns — `episodeIndex` in the ROOT, optional `start` /`end`.

    `trim_position` exists only for the negative control: `"rank"` is the real
    behavior (the episode's rank among the kept indices, because `delete`
    renumbers survivors ascending), `"parent"` is the bug this test suite is
    here to catch — the parent's own index, which silently trims a different
    episode.
    """
    selected: list[int] = []
    for ep in episodes:
        index = ep["episodeIndex"]
        if index < 0 or index >= total:
            raise ValueError(f"VIEW_EPISODE_OUT_OF_RANGE: {index} of {total}")
        if index in selected:
            raise ValueError(f"VIEW_DUPLICATE_EPISODE: {index}")
        selected.append(index)

    ascending = sorted(selected)
    to_delete = [i for i in range(total) if i not in ascending]

    trims = [
        (
            ascending.index(ep["episodeIndex"]) if trim_position == "rank" else ep["episodeIndex"],
            ep.get("start") or 0,
            ep.get("end"),
        )
        for ep in episodes
        if (ep.get("start") or 0) > 0 or ep.get("end") is not None
    ]

    if not to_delete and not trims:
        raise ValueError("VIEW_IS_WHOLE_PARENT")

    steps: list[tuple] = []
    if to_delete:
        steps.append(("delete", to_delete))
    steps.extend(("trim", position, start, end) for position, start, end in trims)
    return steps


def run_plan(steps: list[tuple], src: Path, out: Path) -> None:
    """Execute a plan the way `materialize` does: scratch dirs, last pass wins."""
    scratch: list[Path] = []
    current = src
    try:
        for i, step in enumerate(steps):
            last = i == len(steps) - 1
            dst = out if last else Path(f"{out}.step-{i}")
            if not last:
                scratch.append(dst)
            if step[0] == "delete":
                args = [
                    "delete", "--dataset", str(current), "--output", str(dst),
                    "--episodes", ",".join(str(i) for i in step[1]),
                ]
            else:
                _, position, start, end = step
                args = [
                    "trim", "--dataset", str(current), "--output", str(dst),
                    "--episode", str(position), "--start", str(start),
                ]
                if end is not None:
                    args += ["--end", str(end)]
            code, summary = run_curate(*args)
            assert code == 0 and summary["ok"] is True, f"curate.py failed on {args}: {summary}"
            current = dst
    finally:
        for path in scratch:
            shutil.rmtree(path, ignore_errors=True)


# ---------------------------------------------------------------------------
# The equivalence check
# ---------------------------------------------------------------------------

def verify_materialized(out: Path, src: Path, selection: list[dict], *, cameras: tuple[str, ...] = ()) -> None:
    """Assert `out` holds exactly the selection's frames, as curate.py writes them.

    This is the "byte-equivalent" of the acceptance criterion made checkable in
    the presence of a trim: the payload columns of every output episode are the
    parent's own rows for that episode and frame range, the bookkeeping columns
    are renumbered the way `curate.py` renumbers them, and the metadata agrees.
    """
    parent_lengths = episode_lengths(src)
    kept = sorted(ep["episodeIndex"] for ep in selection)
    by_index = {ep["episodeIndex"]: ep for ep in selection}

    windows: list[tuple[int, int, int]] = []  # (root episode, start, end)
    for root_ep in kept:
        entry = by_index[root_ep]
        start = entry.get("start") or 0
        end = entry.get("end")
        end = parent_lengths[root_ep] if end is None else min(end, parent_lengths[root_ep])
        windows.append((root_ep, start, end))

    expected_lengths = [end - start for _, start, end in windows]
    assert episode_lengths(out) == expected_lengths, (
        f"episode lengths {episode_lengths(out)} != selection's {expected_lengths}"
    )

    global_index = 0
    for position, (root_ep, start, end) in enumerate(windows):
        got = episode_table(out, position)
        want = episode_table(src, root_ep)
        length = end - start
        for column in ("observation.state", "action", "task_index"):
            assert got.column(column).to_pylist() == want.column(column).to_pylist()[start:end], (
                f"output episode {position} column {column} is not root episode "
                f"{root_ep} frames [{start}, {end})"
            )
        assert got.column("frame_index").to_pylist() == list(range(length))
        assert got.column("episode_index").to_pylist() == [position] * length
        assert got.column("index").to_pylist() == list(range(global_index, global_index + length))
        timestamps = got.column("timestamp").to_pylist()
        assert timestamps == pytest.approx([round(i / FPS, 6) for i in range(length)], abs=1e-4)
        global_index += length

    # metadata
    info = json.loads((out / "meta" / "info.json").read_text())
    assert info["total_episodes"] == len(kept)
    assert info["total_frames"] == sum(expected_lengths)
    assert info["splits"] == {"train": f"0:{len(kept)}"}
    assert info["fps"] == FPS
    src_info = json.loads((src / "meta" / "info.json").read_text())
    assert info["robot_type"] == src_info["robot_type"]
    assert info["features"] == src_info["features"]
    assert episode_tasks(out) == [episode_tasks(src)[root_ep] for root_ep, _, _ in windows]
    assert (out / "meta" / "tasks.jsonl").read_text() == (src / "meta" / "tasks.jsonl").read_text()

    # stats were recomputed from the episodes that actually survived
    stats = json.loads((out / "meta" / "stats.json").read_text())
    rows = np.concatenate([
        np.asarray(episode_table(out, i).column("action").to_pylist(), dtype=np.float64)
        for i in range(len(kept))
    ], axis=0)
    np.testing.assert_allclose(stats["action"]["mean"], rows.mean(axis=0), atol=1e-9)
    np.testing.assert_allclose(stats["action"]["max"], rows.max(axis=0), atol=1e-9)

    # videos: frame counts follow the windows (a re-encoded mp4 has no stable bytes)
    for cam in cameras:
        assert info["total_videos"] == len(kept) * len(cameras)
        for position, (_, start, end) in enumerate(windows):
            assert count_video_frames(video_path(out, cam, position)) == end - start
        assert not video_path(out, cam, len(kept)).exists()

    # scratch directories are gone
    leftovers = sorted(p.name for p in out.parent.glob(f"{out.name}.step-*"))
    assert leftovers == [], f"materialize left scratch directories behind: {leftovers}"

    # the parent is untouched
    assert episode_lengths(src) == parent_lengths


# ---------------------------------------------------------------------------
# 1. The plain case: a selection with no trims IS one `curate.py delete`
# ---------------------------------------------------------------------------

def test_plan_for_a_plain_selection_is_one_delete_of_the_complement() -> None:
    steps = plan_materialize(6, [{"episodeIndex": i} for i in (0, 2, 3, 5)])
    assert steps == [("delete", [1, 4])]


def test_plain_selection_matches_curate_delete_byte_for_byte(tmp_path: Path) -> None:
    src = tmp_path / "src"
    make_dataset(src)
    assert episode_lengths(src) == PARENT_LENGTHS

    selection = [{"episodeIndex": i} for i in (0, 2, 3, 5)]
    materialized = tmp_path / "view"
    run_plan(plan_materialize(len(PARENT_LENGTHS), selection), src, materialized)

    reference = tmp_path / "reference"
    code, summary = run_curate(
        "delete", "--dataset", str(src), "--output", str(reference), "--episodes", "1,4",
    )
    assert code == 0 and summary["ok"] is True

    got, want = file_hashes(materialized), file_hashes(reference)
    assert sorted(got) == sorted(want)
    differing = sorted(k for k in want if got[k] != want[k])
    assert differing == [], f"files differ from `curate.py delete`: {differing}"

    # and the result is the selection, not merely a copy of some other run
    assert episode_lengths(materialized) == [60, 62, 63, 65]
    verify_materialized(materialized, src, selection)


@requires_ffmpeg
def test_plain_selection_matches_curate_delete_with_videos(tmp_path: Path) -> None:
    """The same claim with camera videos in the tree: `delete` copies mp4s
    rather than re-encoding them, so byte equality still covers every file."""
    src = tmp_path / "src"
    make_dataset(src, episodes=4, frames=8, cameras="top,wrist")

    selection = [{"episodeIndex": i} for i in (1, 2)]
    materialized = tmp_path / "view"
    run_plan(plan_materialize(4, selection), src, materialized)

    reference = tmp_path / "reference"
    code, _ = run_curate(
        "delete", "--dataset", str(src), "--output", str(reference), "--episodes", "0,3",
    )
    assert code == 0

    got, want = file_hashes(materialized), file_hashes(reference)
    assert sorted(got) == sorted(want)
    assert [k for k in want if got[k] != want[k]] == []
    assert any(k.endswith(".mp4") for k in want)


# ---------------------------------------------------------------------------
# 2. The rank arithmetic: a trim on an episode that is not the first kept one
# ---------------------------------------------------------------------------

def test_trim_position_is_the_rank_among_kept_episodes() -> None:
    selection = [
        {"episodeIndex": 0},
        {"episodeIndex": 2},
        {"episodeIndex": 3, "start": 10, "end": 40},
        {"episodeIndex": 5},
    ]
    # root episode 3 is the THIRD kept episode -> position 2 after the delete
    assert plan_materialize(6, selection) == [("delete", [1, 4]), ("trim", 2, 10, 40)]


def test_trim_lands_on_the_episode_the_selection_named(tmp_path: Path) -> None:
    src = tmp_path / "src"
    make_dataset(src)

    selection = [
        {"episodeIndex": 0},
        {"episodeIndex": 2},
        {"episodeIndex": 3, "start": 10, "end": 40},
        {"episodeIndex": 5},
    ]
    out = tmp_path / "view"
    run_plan(plan_materialize(len(PARENT_LENGTHS), selection), src, out)

    # only the named episode lost frames; every other kept episode is whole
    assert episode_lengths(out) == [60, 62, 30, 65]
    # the trimmed episode is root episode 3's frames 10..39, not another one's
    trimmed = episode_table(out, 2).column("action").to_pylist()
    assert trimmed == episode_table(src, 3).column("action").to_pylist()[10:40]
    assert trimmed != episode_table(src, 5).column("action").to_pylist()[10:40]

    verify_materialized(out, src, selection)


def test_two_trims_keep_their_positions_across_passes(tmp_path: Path) -> None:
    """Each trim pass rewrites the whole directory but neither deletes nor
    reorders episodes, so a rank computed once stays valid for every pass."""
    src = tmp_path / "src"
    make_dataset(src)

    selection = [
        {"episodeIndex": 1},
        {"episodeIndex": 2, "start": 5, "end": 25},
        {"episodeIndex": 4},
        {"episodeIndex": 5, "start": 30},
    ]
    assert plan_materialize(len(PARENT_LENGTHS), selection) == [
        ("delete", [0, 3]),
        ("trim", 1, 5, 25),
        ("trim", 3, 30, None),
    ]

    out = tmp_path / "view"
    run_plan(plan_materialize(len(PARENT_LENGTHS), selection), src, out)

    assert episode_lengths(out) == [61, 20, 64, 35]
    verify_materialized(out, src, selection)


def test_trim_with_no_deletions_uses_the_parent_indices_unchanged(tmp_path: Path) -> None:
    """When nothing is deleted the rank IS the parent index — the arithmetic has
    to survive that degenerate case too, or a trim-only view breaks."""
    src = tmp_path / "src"
    make_dataset(src, episodes=3, frames=20)

    selection = [
        {"episodeIndex": 0},
        {"episodeIndex": 1},
        {"episodeIndex": 2, "start": 4, "end": 14},
    ]
    assert plan_materialize(3, selection) == [("trim", 2, 4, 14)]

    out = tmp_path / "view"
    run_plan(plan_materialize(3, selection), src, out)
    assert episode_lengths(out) == [20, 21, 10]
    verify_materialized(out, src, selection)


@requires_ffmpeg
def test_trim_recuts_only_the_named_episodes_video(tmp_path: Path) -> None:
    src = tmp_path / "src"
    make_dataset(src, episodes=4, frames=8, cameras="top")

    selection = [
        {"episodeIndex": 0},
        {"episodeIndex": 2, "start": 2, "end": 7},
        {"episodeIndex": 3},
    ]
    assert plan_materialize(4, selection) == [("delete", [1]), ("trim", 1, 2, 7)]

    out = tmp_path / "view"
    run_plan(plan_materialize(4, selection), src, out)

    assert episode_lengths(out) == [8, 5, 11]
    verify_materialized(out, src, selection, cameras=("top",))


# ---------------------------------------------------------------------------
# 3. Negative control: the bug these tests exist to catch
# ---------------------------------------------------------------------------

def test_parent_index_instead_of_kept_rank_trims_the_wrong_episode(tmp_path: Path) -> None:
    """Proof that the checks above can fail.

    Planning the trim with the parent's own episode index instead of its rank
    among the kept episodes is still a VALID curate.py call — episode 3 exists
    in a four-episode output — so nothing errors. It just trims root episode 5
    instead of root episode 3. `verify_materialized` must notice.
    """
    src = tmp_path / "src"
    make_dataset(src)

    selection = [
        {"episodeIndex": 0},
        {"episodeIndex": 2},
        {"episodeIndex": 3, "start": 10, "end": 40},
        {"episodeIndex": 5},
    ]
    buggy = plan_materialize(len(PARENT_LENGTHS), selection, trim_position="parent")
    assert buggy == [("delete", [1, 4]), ("trim", 3, 10, 40)]

    out = tmp_path / "buggy"
    run_plan(buggy, src, out)

    # the wrong episode lost the frames, and it is the last one, not the third
    assert episode_lengths(out) == [60, 62, 63, 30]
    with pytest.raises(AssertionError):
        verify_materialized(out, src, selection)


def test_a_stale_parent_total_silently_keeps_unselected_episodes(tmp_path: Path) -> None:
    """Why `materialize` must not take the episode count from the database.

    `plan_materialize` derives the delete from `total`, and `curate.py` cannot
    check it: `delete` validates the indices it is TOLD to delete against
    `meta/info.json` — [1, 3] are perfectly valid here — and has no way to know
    what was meant to be KEPT. So a `Dataset.demonstrationCount` that has gone
    stale (six episodes on disk, a row that still says four) does not fail. It
    silently ships episodes 4 and 5, which nobody selected, into the output.

    `DatasetViewService.rootEpisodeCount` therefore reads `total_episodes` out
    of the root's own `meta/info.json` and refuses the whole plan when the two
    disagree. This test pins what happens when nothing refuses it.
    """
    src = tmp_path / "src"
    make_dataset(src)
    assert episode_lengths(src) == PARENT_LENGTHS

    selection = [{"episodeIndex": 0}, {"episodeIndex": 2}]
    steps = plan_materialize(4, selection)  # 4: the stale count
    assert steps == [("delete", [1, 3])]

    out = tmp_path / "view"
    run_plan(steps, src, out)

    # A four-episode dataset for a two-episode selection.
    assert episode_lengths(out) == [60, 62, 64, 65]
    with pytest.raises(AssertionError):
        verify_materialized(out, src, selection)

    # And planned against the truth on disk, the same selection is right.
    honest = tmp_path / "honest"
    run_plan(plan_materialize(len(PARENT_LENGTHS), selection), src, honest)
    assert episode_lengths(honest) == [60, 62]
    verify_materialized(honest, src, selection)


def test_each_pass_overwrites_the_curation_note(tmp_path: Path) -> None:
    """Why `materialize` restates the plan in `_curation` after a multi-pass run.

    `_rebuild` writes `info["_curation"]` from scratch on every invocation, so
    the trim pass erases the delete pass's note. What lands on disk records the
    last `curate.py` call and nothing about the selection that produced the
    directory — the delete of the complement, which is the whole point of a
    view, leaves no trace at all.
    """
    src = tmp_path / "src"
    make_dataset(src)

    selection = [
        {"episodeIndex": 1},
        {"episodeIndex": 2, "start": 5, "end": 25},
        {"episodeIndex": 4},
    ]
    steps = plan_materialize(len(PARENT_LENGTHS), selection)
    assert steps == [("delete", [0, 3, 5]), ("trim", 1, 5, 25)]

    out = tmp_path / "view"
    run_plan(steps, src, out)
    verify_materialized(out, src, selection)

    curation = json.loads((out / "meta" / "info.json").read_text())["_curation"]
    assert curation["note"] == "trim episode 1 to [5, 25)"
    assert "delete" not in curation["note"]


# ---------------------------------------------------------------------------
# Drift guard: the port above must keep describing the TypeScript
# ---------------------------------------------------------------------------

def test_service_still_plans_the_rank_among_kept_indices() -> None:
    """`plan_materialize` is a port, and a port rots silently.

    If `materialize` stops deriving the trim position from the ascending kept
    indices, everything above still passes while testing a plan the service no
    longer emits — so pin the two load-bearing expressions.
    """
    if not SERVICE_TS.exists():  # pragma: no cover - the python suite can run alone
        pytest.skip(f"{SERVICE_TS} not present")
    source = SERVICE_TS.read_text()
    assert "ascending.indexOf(ep.episodeIndex)" in source, (
        "DatasetViewService.materialize no longer derives the trim position from the "
        "rank among kept episodes; plan_materialize in this file must be updated with it"
    )
    assert re.search(r"const ascending = \[\.\.\.selected\]\.sort", source)
    assert "if (!ascending.includes(i)) toDelete.push(i)" in source
