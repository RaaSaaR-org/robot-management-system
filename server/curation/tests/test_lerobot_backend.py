"""Tests for the `--backend lerobot` path (v3.0 datasets, lerobot >= 0.6).

Creates a tiny state-only v3 dataset with the real lerobot API in a temp dir,
then drives curate.py as a subprocess. Skipped when lerobot is not importable
(the dependency-light CI path).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import CURATION_DIR

CURATE = CURATION_DIR / "curate.py"

lerobot = pytest.importorskip("lerobot")

FPS = 10
FEATURES = {
    "observation.state": {"dtype": "float32", "shape": [3], "names": None},
    "action": {"dtype": "float32", "shape": [3], "names": None},
}


def run_curate(*args: str) -> tuple[int, dict]:
    result = subprocess.run(
        [sys.executable, str(CURATE), *args], capture_output=True, text=True,
    )
    lines = [l for l in result.stdout.strip().splitlines() if l.strip()]
    assert lines, f"no stdout from curate.py; stderr: {result.stderr[-2000:]}"
    return result.returncode, json.loads(lines[-1])


@pytest.fixture(scope="module")
def v3_dataset(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A 3-episode, state-only LeRobot v3 dataset (no videos, fast to build)."""
    import numpy as np
    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    root = tmp_path_factory.mktemp("v3ds") / "src"
    ds = LeRobotDataset.create(
        repo_id="local/curation_test",
        fps=FPS,
        features=FEATURES,
        root=root,
        robot_type="test_bot",
        use_videos=False,
    )
    for ep in range(3):
        n = 8 + ep
        for i in range(n):
            vec = np.asarray([ep + i * 0.1, i * 0.2, 1.0], dtype=np.float32)
            ds.add_frame({
                "observation.state": vec,
                "action": vec,
                "task": "test task",
            })
        ds.save_episode()
    ds.finalize()
    return root


def test_delete_episodes_via_lerobot_backend(v3_dataset: Path, tmp_path: Path) -> None:
    out = tmp_path / "out"
    code, summary = run_curate(
        "delete", "--backend", "lerobot",
        "--dataset", str(v3_dataset), "--output", str(out), "--episodes", "1",
    )
    assert code == 0, summary
    assert summary["ok"] is True
    assert summary["backend"] == "lerobot"
    assert summary["total_episodes"] == 2
    assert summary["total_frames"] == 8 + 10  # episodes 0 (8) and 2 (10) survive
    assert summary["stats_recompute_required"] is False

    # output is a valid v3 dataset with the curation marker
    info = json.loads((out / "meta" / "info.json").read_text())
    assert info["total_episodes"] == 2
    assert info["_curation"]["backend"] == "lerobot"

    # source untouched
    src_info = json.loads((v3_dataset / "meta" / "info.json").read_text())
    assert src_info["total_episodes"] == 3

    # the edited dataset loads cleanly with lerobot itself
    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    edited = LeRobotDataset(repo_id="local/curation_test_curated", root=out)
    assert edited.meta.total_episodes == 2
    assert edited.meta.total_frames == 18


def test_trim_via_lerobot_backend_is_unsupported(v3_dataset: Path, tmp_path: Path) -> None:
    code, result = run_curate(
        "trim", "--backend", "lerobot",
        "--dataset", str(v3_dataset), "--output", str(tmp_path / "out"),
        "--episode", "0", "--start", "1", "--end", "5",
    )
    assert code == 1
    assert result["ok"] is False
    assert result["code"] == "V3_TRIM_UNSUPPORTED"
    assert "trim not supported for v3.0" in result["error"]
