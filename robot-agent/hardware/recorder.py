"""
recorder.py — spawn and manage `lerobot-record` subprocesses for SO-101 teleop.

The sidecar calls into this module (via /record/* endpoints) to start/stop a
LeRobot teleoperation + dataset-capture session. Recording itself is entirely
delegated to the `lerobot-record` CLI — we just wrap the subprocess lifecycle
(spawn, SIGINT on stop, stdout parsing for progress, bounded log tail).

Datasets land at <dataset_root>/<repo_id>/ in LeRobot v3 format
(data/*.parquet + videos/*.mp4 + meta/info.json + meta/episodes.jsonl).
After recording stops, the dataset is auto-uploaded to RustFS (S3) and
the local copy is deleted to keep the pi's storage clean.
"""

from __future__ import annotations

import os
import re
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Optional


DEFAULT_DATASET_ROOT = os.environ.get(
    "SO101_DATASET_ROOT", str(Path.home() / "data" / "datasets")
)
DEFAULT_FOLLOWER_PORT = os.environ.get("SO101_FOLLOWER_PORT", "/dev/so101_follower")
DEFAULT_LEADER_PORT = os.environ.get("SO101_LEADER_PORT", "/dev/so101_leader")
DEFAULT_FOLLOWER_ID = os.environ.get("SO101_FOLLOWER_ID", "my_so101")
DEFAULT_LEADER_ID = os.environ.get("SO101_LEADER_ID", "my_so101_leader")

# Regexes for parsing lerobot-record stdout progress lines.
_EPISODE_RE = re.compile(r"episode[_\- ]?(\d+)", re.IGNORECASE)
_SAVED_RE = re.compile(r"(saved|wrote|finished)\s+episode", re.IGNORECASE)


class Recorder:
    """Wraps a single `lerobot-record` subprocess with auto-upload to RustFS."""

    def __init__(self) -> None:
        self._proc: Optional[subprocess.Popen[str]] = None
        self._lock = threading.Lock()
        self._reader_thread: Optional[threading.Thread] = None

        self._started_at: float = 0.0
        self._repo_id: str = ""
        self._task: str = ""
        self._dataset_path: Optional[str] = None
        self._num_episodes: int = 0
        self._episodes_done: int = 0
        self._current_episode: int = 0
        self._log_tail: list[str] = []
        self._last_error: Optional[str] = None

        # Dataset metadata (read from info.json after recording)
        self._total_frames: int = 0
        self._total_episodes: int = 0

        # S3 upload state
        self._uploader: Optional[Any] = None
        self._s3_path: Optional[str] = None

    # ------------------------------------------------------------------ status

    @property
    def is_running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def status(self) -> dict[str, Any]:
        running = self.is_running
        elapsed = time.time() - self._started_at if self._started_at else 0.0
        exit_code = self._proc.returncode if (self._proc and not running) else None

        # Merge upload status
        upload_info: dict[str, Any] = {"upload_status": "idle", "s3_path": self._s3_path}
        if self._uploader:
            upload_info.update(self._uploader.status())

        return {
            "running": running,
            "pid": self._proc.pid if self._proc else None,
            "exit_code": exit_code,
            "repo_id": self._repo_id,
            "task": self._task,
            "dataset_path": self._dataset_path,
            "num_episodes": self._num_episodes,
            "episodes_done": self._episodes_done,
            "current_episode": self._current_episode,
            "elapsed_s": round(elapsed, 1),
            "started_at": self._started_at or None,
            "total_frames": self._total_frames,
            "total_episodes": self._total_episodes,
            "last_error": self._last_error,
            "log_tail": self._log_tail[-20:],
            **upload_info,
        }

    # ------------------------------------------------------------------- start

    def start(
        self,
        *,
        repo_id: str,
        task: str,
        num_episodes: int,
        episode_time_s: float,
        fps: int,
        cameras: dict[str, dict[str, Any]],
        follower_port: str = DEFAULT_FOLLOWER_PORT,
        leader_port: str = DEFAULT_LEADER_PORT,
        follower_id: str = DEFAULT_FOLLOWER_ID,
        leader_id: str = DEFAULT_LEADER_ID,
        dataset_root: Optional[str] = None,
        reset_time_s: float = 5.0,
    ) -> dict[str, Any]:
        with self._lock:
            if self.is_running:
                return {"ok": False, "error": "recorder already running"}

            root = dataset_root or DEFAULT_DATASET_ROOT
            dataset_path = str(Path(root) / repo_id)
            Path(dataset_path).parent.mkdir(parents=True, exist_ok=True)

            cameras_arg = _format_cameras(cameras)
            cmd = [
                "lerobot-record",
                "--robot.type=so101_follower",
                f"--robot.port={follower_port}",
                f"--robot.id={follower_id}",
                f"--robot.cameras={cameras_arg}",
                "--teleop.type=so101_leader",
                f"--teleop.port={leader_port}",
                f"--teleop.id={leader_id}",
                f"--dataset.repo_id={repo_id}",
                f"--dataset.num_episodes={num_episodes}",
                f"--dataset.episode_time_s={episode_time_s}",
                f"--dataset.reset_time_s={reset_time_s}",
                f"--dataset.fps={fps}",
                f"--dataset.single_task={task}",
                f"--dataset.root={dataset_path}",
                "--dataset.push_to_hub=false",
                "--dataset.video=true",
                "--display_data=false",
            ]

            # Reset state
            self._started_at = time.time()
            self._repo_id = repo_id
            self._task = task
            self._dataset_path = dataset_path
            self._num_episodes = num_episodes
            self._episodes_done = 0
            self._current_episode = 0
            self._log_tail = []
            self._last_error = None
            self._total_frames = 0
            self._total_episodes = 0
            self._uploader = None
            self._s3_path = None

            try:
                self._proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    bufsize=1,
                    text=True,
                    env=os.environ.copy(),
                )
            except FileNotFoundError as e:
                self._last_error = f"lerobot-record not found on PATH: {e}"
                return {"ok": False, "error": self._last_error}
            except Exception as e:
                self._last_error = f"spawn failed: {e}"
                return {"ok": False, "error": self._last_error}

            self._reader_thread = threading.Thread(
                target=self._reader_loop, daemon=True
            )
            self._reader_thread.start()

            print(
                f"[Recorder] started pid={self._proc.pid} repo_id={repo_id} "
                f"episodes={num_episodes} fps={fps} → {dataset_path}",
                flush=True,
            )
            return {
                "ok": True,
                "pid": self._proc.pid,
                "dataset_path": dataset_path,
                "repo_id": repo_id,
                "cmd": cmd,
            }

    # -------------------------------------------------------------------- stop

    def stop(self, timeout: float = 20.0) -> dict[str, Any]:
        with self._lock:
            proc = self._proc
            if proc is None or proc.poll() is not None:
                # Process already exited — trigger upload if not already started
                if proc and proc.returncode == 0 and self._dataset_path and not self._uploader:
                    self._start_upload()
                return {
                    "ok": True,
                    "already_stopped": True,
                    "episodes_recorded": self._episodes_done,
                    "dataset_path": self._dataset_path,
                    "exit_code": proc.returncode if proc else None,
                }

            # SIGINT lets lerobot-record finalize the current episode + write
            # meta files cleanly. It traps Ctrl-C.
            try:
                proc.send_signal(signal.SIGINT)
            except Exception as e:
                self._last_error = f"SIGINT failed: {e}"

            try:
                proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                print("[Recorder] SIGINT timed out, sending SIGTERM", flush=True)
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    print("[Recorder] SIGTERM timed out, sending SIGKILL", flush=True)
                    proc.kill()
                    proc.wait()

            print(
                f"[Recorder] stopped exit={proc.returncode} "
                f"episodes_done={self._episodes_done}",
                flush=True,
            )

            # Auto-upload to RustFS if recording succeeded
            if proc.returncode == 0 and self._dataset_path:
                self._start_upload()

            return {
                "ok": True,
                "exit_code": proc.returncode,
                "episodes_recorded": self._episodes_done,
                "dataset_path": self._dataset_path,
            }

    # -------------------------------------------------------------- metadata

    def _read_dataset_info(self) -> None:
        """Read total_frames/total_episodes from LeRobot's info.json after recording."""
        if not self._dataset_path:
            return
        import json as _json
        info_path = Path(self._dataset_path) / "meta" / "info.json"
        try:
            if info_path.exists():
                info = _json.loads(info_path.read_text())
                self._total_frames = info.get("total_frames", 0)
                self._total_episodes = info.get("total_episodes", 0)
                self._episodes_done = self._total_episodes
                print(f"[Recorder] Dataset info: {self._total_frames} frames, {self._total_episodes} episodes", flush=True)
        except Exception as e:
            print(f"[Recorder] Failed to read info.json: {e}", flush=True)

    # ----------------------------------------------------------------- upload

    def _start_upload(self) -> None:
        """Kick off async upload of dataset to RustFS after recording."""
        from uploader import AsyncUploader
        s3_prefix = f"datasets/{self._repo_id}"
        self._s3_path = s3_prefix
        self._uploader = AsyncUploader()
        self._uploader.start(
            local_path=self._dataset_path or "",
            s3_prefix=s3_prefix,
            delete_after=True,
        )
        print(f"[Recorder] Upload started → s3://{s3_prefix}/", flush=True)

    # ------------------------------------------------------------------ reader

    def _reader_loop(self) -> None:
        """Drain subprocess stdout; parse progress lines; keep bounded tail."""
        proc = self._proc
        if proc is None or proc.stdout is None:
            return
        try:
            for line in proc.stdout:
                line = line.rstrip()
                if not line:
                    continue
                self._log_tail.append(line)
                if len(self._log_tail) > 200:
                    self._log_tail = self._log_tail[-100:]

                m = _EPISODE_RE.search(line)
                if m:
                    try:
                        self._current_episode = int(m.group(1))
                    except ValueError:
                        pass
                if _SAVED_RE.search(line):
                    self._episodes_done += 1

                print(f"[Recorder] {line}", flush=True)
        except Exception as e:
            self._last_error = f"reader loop error: {e}"
            print(f"[Recorder] reader loop error: {e}", flush=True)

        # Process stdout ended → process exited.
        if proc.wait() == 0 and self._dataset_path:
            self._read_dataset_info()
            if not self._uploader:
                print("[Recorder] Process exited cleanly, starting auto-upload", flush=True)
                self._start_upload()


# --------------------------------------------------------------------- helpers


def _format_cameras(cameras: dict[str, dict[str, Any]]) -> str:
    """Render the cameras dict as LeRobot's inline-yaml CLI syntax.

    LeRobot parses `--robot.cameras='{wrist: {type: opencv, ...}, top: {...}}'`.
    We accept a plain dict and coerce sane defaults per camera. Values must be
    yaml-safe literals (ints, simple strings without commas or braces).
    """
    parts: list[str] = []
    for name, cfg in cameras.items():
        index_or_path = cfg.get("index_or_path", cfg.get("index", 0))
        fields = {
            "type": cfg.get("type", "opencv"),
            "index_or_path": index_or_path,
            "width": int(cfg.get("width", 640)),
            "height": int(cfg.get("height", 480)),
            "fps": int(cfg.get("fps", 30)),
        }
        inner = ", ".join(f"{k}: {v}" for k, v in fields.items())
        parts.append(f"{name}: {{{inner}}}")
    return "{" + ", ".join(parts) + "}"


# Module-level singleton used by the sidecar.
recorder = Recorder()
