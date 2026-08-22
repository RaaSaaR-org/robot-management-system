"""Tests for the neural-trajectory generator package (TASK-182).

Run with the Windows venv:
  server/curation/.venv-win/Scripts/python.exe -m pytest tests/test_neural_traj.py
(cwd = server/curation; conftest.py puts the curation dir on sys.path)
"""
from __future__ import annotations

import json
from pathlib import Path

import pyarrow.parquet as pq
import pytest

from neural_traj.backends.wsl import WslBackend
from neural_traj.cli import main
from neural_traj.constants import (
    DATASET_SUBDIR,
    DEFAULT_PROMPTS,
    FPS,
    ROBOT_TYPE,
    STATE_DIM,
    VIDEO_KEY,
)
from neural_traj.errors import NeuralTrajError

EPISODES = 2


@pytest.fixture(scope="module")
def generated(tmp_path_factory) -> Path:
    """Run mock generate (2 episodes) + convert once for the whole module."""
    out = tmp_path_factory.mktemp("nt_out")
    rc = main(["--out", str(out), "--backend", "mock", "generate", "--episodes", str(EPISODES)])
    assert rc == 0
    rc = main(["--out", str(out), "convert"])
    assert rc == 0
    return out


# ---------------------------------------------------------------- generate

def test_generate_writes_raw_artifacts(generated: Path):
    raw = generated / "raw"
    manifest = json.loads((raw / "manifest.json").read_text())
    assert len(manifest) == EPISODES
    assert all(m["ok"] for m in manifest)
    for i, m in enumerate(manifest):
        gid = m["gen_id"]
        assert gid == f"neural-traj-{i:02d}"
        jobdir = raw / gid
        assert (jobdir / "video.mp4").stat().st_size > 0
        assert (jobdir / "request.json").exists()
        assert (jobdir / "result.json").exists()
        traj = json.loads((jobdir / "trajectory.json").read_text())
        assert traj["dim"] == STATE_DIM
        assert len(traj["states"]) == m["nframes"]
        assert len(traj["states"][0]) == STATE_DIM
        assert m["prompt"] == DEFAULT_PROMPTS[i % len(DEFAULT_PROMPTS)]


def test_generate_writes_provenance_mapping(generated: Path):
    prov = json.loads((generated / "raw" / "provenance.json").read_text())
    assert prov["backend"] == "mock"
    assert prov["seed"] == 0
    assert prov["created_at"]
    assert prov["episodes"] == {
        f"neural-traj-{i:02d}": DEFAULT_PROMPTS[i % len(DEFAULT_PROMPTS)]
        for i in range(EPISODES)
    }


def test_generate_is_deterministic(tmp_path: Path, generated: Path):
    out2 = tmp_path / "again"
    assert main(["--out", str(out2), "--backend", "mock", "generate", "--episodes", "1"]) == 0
    a = json.loads((generated / "raw" / "neural-traj-00" / "trajectory.json").read_text())
    b = json.loads((out2 / "raw" / "neural-traj-00" / "trajectory.json").read_text())
    assert a["states"] == b["states"]
    assert a["actions"] == b["actions"]


# ---------------------------------------------------------------- convert

def test_convert_info_json_contract(generated: Path):
    ds = generated / DATASET_SUBDIR
    info = json.loads((ds / "meta" / "info.json").read_text())
    assert info["codebase_version"] == "v2.1"
    assert info["robot_type"] == ROBOT_TYPE
    assert info["fps"] == FPS
    assert info["total_episodes"] == EPISODES
    assert info["total_frames"] > 0
    assert info["_synthetic"] is True
    assert "neural-trajectory (mock)" in info["_generator"]
    prov = info["_provenance"]
    assert prov["backend"] == "mock"
    assert prov["model"]
    assert prov["prompts"] == DEFAULT_PROMPTS[:EPISODES]
    assert prov["seed"] == 0
    assert prov["created_at"]
    feats = info["features"]
    assert feats["observation.state"]["shape"] == [STATE_DIM]
    assert feats["action"]["shape"] == [STATE_DIM]
    assert feats[VIDEO_KEY]["dtype"] == "video"


def test_convert_meta_and_data_files(generated: Path):
    ds = generated / DATASET_SUBDIR
    meta = ds / "meta"
    episodes = json.loads((meta / "episodes.json").read_text())
    assert [e["episode_index"] for e in episodes] == list(range(EPISODES))
    assert (meta / "episodes.jsonl").exists()
    tasks = [json.loads(l) for l in (meta / "tasks.jsonl").read_text().splitlines()]
    assert len(tasks) == EPISODES  # 2 distinct cycled prompts
    stats = json.loads((meta / "stats.json").read_text())
    for key in ("observation.state", "action"):
        assert len(stats[key]["mean"]) == STATE_DIM
        assert len(stats[key]["std"]) == STATE_DIM

    total = 0
    for ep, emeta in enumerate(episodes):
        t = pq.read_table(ds / "data" / "chunk-000" / f"episode_{ep:06d}.parquet")
        assert t.num_rows == emeta["length"]
        assert len(t.column("observation.state")[0].as_py()) == STATE_DIM
        assert len(t.column("action")[0].as_py()) == STATE_DIM
        assert (ds / "videos" / VIDEO_KEY / "chunk-000" / f"episode_{ep:06d}.mp4").exists()
        total += t.num_rows
    info = json.loads((meta / "info.json").read_text())
    assert info["total_frames"] == total


def test_convert_without_manifest_fails_cleanly(tmp_path: Path):
    assert main(["--out", str(tmp_path / "empty"), "convert"]) == 2


# ---------------------------------------------------------------- wsl backend
# Real pipeline (NEURAL_TRAJ_WSL_DISTRO); tests never spawn wsl.exe — subprocess is
# faked so they stay GPU-free and green on any machine.

def test_wsl_backend_command_shape(tmp_path: Path):
    import base64

    be = WslBackend()
    prompt = "Pick up the red cube"
    cmd = be.build_command({"prompt": prompt, "seed": 3}, tmp_path)
    assert cmd[:7] == ["wsl", "-d", be.DISTRO, "-u", "root", "--", "bash"]
    assert cmd[7] == "-lc"
    inner = cmd[8]
    assert "76_dreams_one_episode.sh" in inner
    b64 = inner.split("76_dreams_one_episode.sh ")[1].split(" ")[0]
    assert base64.b64decode(b64).decode() == prompt
    assert " 3 " in inner
    assert "/mnt/" in inner or inner.endswith(str(tmp_path))


def test_wsl_backend_failure_raises_clean_error(tmp_path: Path, monkeypatch):
    import subprocess as sp

    def fake_run(*a, **k):
        return sp.CompletedProcess(a[0], returncode=1, stdout="boom", stderr="")

    monkeypatch.setattr("neural_traj.backends.wsl.subprocess.run", fake_run)
    be = WslBackend()
    with pytest.raises(NeuralTrajError, match="rc=1"):
        be.generate_episode({"prompt": "x", "seed": 0}, tmp_path)
    # over the CLI: clean rc=2, no traceback
    rc = main(["--out", str(tmp_path / "wsl"), "--backend", "wsl", "generate", "--episodes", "1"])
    assert rc == 2


def test_wsl_backend_success_reads_outputs(tmp_path: Path, monkeypatch):
    import subprocess as sp

    def fake_run(cmd, **k):
        (tmp_path / "video.mp4").write_bytes(b"\x00")
        (tmp_path / "trajectory.json").write_text(
            json.dumps({"fps": 16, "dim": STATE_DIM, "states": [[0.0] * STATE_DIM] * 5,
                        "actions": [[0.0] * STATE_DIM] * 5})
        )
        (tmp_path / "meta.json").write_text(json.dumps({"nframes": 5, "width": 768, "height": 432}))
        return sp.CompletedProcess(cmd, returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr("neural_traj.backends.wsl.subprocess.run", fake_run)
    be = WslBackend()
    result = be.generate_episode({"prompt": "x", "seed": 0}, tmp_path)
    assert result == {"nframes": 5, "width": 768, "height": 432}
