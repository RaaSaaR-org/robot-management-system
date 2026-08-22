"""WSL backend: real GR00T-dreams pipeline (TASK-182 stages 1-3, proven 2026-07-14).

One episode = one invocation of ``76_dreams_one_episode.sh`` inside a WSL distro
(``NEURAL_TRAJ_WSL_DISTRO``, user root): Cosmos-Predict2-2B
(LoRA post-trained on real G1 teleop) generates the video from a real seed
frame + the language prompt, then the GR00T-dreams IDM (checkpoint-20000,
holdout MAE 0.079 rad / 5.5 % normalized) pseudo-labels 28-dim actions.
The script writes ``video.mp4`` + ``trajectory.json`` + ``meta.json`` straight
into the (Windows) jobdir via its ``/mnt/c/...`` view.

Requirements: ``NEURAL_TRAJ_WSL_DISTRO`` must name an existing distro with the
post-trained checkpoints in place, and the GPU must be free (~24 GB; ~4-6 min
per episode including model load). The prompt is passed base64-encoded —
wsl.exe mangles quoted spaces.
"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
from pathlib import Path

from ..constants import MODEL_NAME
from ..errors import NeuralTrajError

# Both are deployment-specific: this repo carries no machine-local names or paths.
_SCRIPT = os.environ.get(
    "NEURAL_TRAJ_WSL_SCRIPT", "/root/unitree/vla-training/scripts/76_dreams_one_episode.sh"
)
_DISTRO = os.environ.get("NEURAL_TRAJ_WSL_DISTRO", "Ubuntu")


def _to_wsl_path(p: Path) -> str:
    """C:\\foo\\bar -> /mnt/c/foo/bar (jobdirs live on the Windows side)."""
    s = str(p.resolve())
    m = re.match(r"^([A-Za-z]):[\\/](.*)$", s)
    if not m:
        return s.replace("\\", "/")
    drive, rest = m.group(1).lower(), m.group(2).replace("\\", "/")
    return f"/mnt/{drive}/{rest}"


class WslBackend:
    name = "wsl"
    model = MODEL_NAME

    DISTRO = _DISTRO
    USER = "root"

    def build_command(self, spec: dict, jobdir: Path) -> list[str]:
        """The wsl.exe invocation for one episode."""
        prompt_b64 = base64.b64encode(str(spec["prompt"]).encode("utf-8")).decode("ascii")
        inner = f"bash {_SCRIPT} {prompt_b64} {int(spec['seed'])} {_to_wsl_path(jobdir)}"
        return ["wsl", "-d", self.DISTRO, "-u", self.USER, "--", "bash", "-lc", inner]

    def generate_episode(self, spec: dict, jobdir: Path) -> dict:
        cmd = self.build_command(spec, jobdir)
        timeout_s = int(os.environ.get("NEURAL_TRAJ_WSL_TIMEOUT_S", "1800"))
        try:
            # wsl.exe can emit UTF-16/odd bytes — never let decoding crash the job
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_s,
                check=False,
            )
        except FileNotFoundError as e:  # no wsl.exe — not on the GPU box
            raise NeuralTrajError(f"wsl.exe not available: {e}") from e
        except subprocess.TimeoutExpired as e:
            raise NeuralTrajError(f"wsl episode timed out after {timeout_s}s") from e
        if proc.returncode != 0:
            tail = (proc.stdout or "")[-400:] + (proc.stderr or "")[-400:]
            raise NeuralTrajError(
                f"wsl pipeline failed (rc={proc.returncode}): {tail.strip()}"
            )
        meta_file = jobdir / "meta.json"
        if not (jobdir / "video.mp4").exists() or not (jobdir / "trajectory.json").exists():
            raise NeuralTrajError("wsl pipeline finished without video.mp4/trajectory.json")
        if meta_file.exists():
            meta = json.loads(meta_file.read_text())
        else:  # fall back to the trajectory for the frame count
            traj = json.loads((jobdir / "trajectory.json").read_text())
            meta = {"nframes": len(traj.get("states", [])), "width": 768, "height": 432}
        return {
            "nframes": int(meta["nframes"]),
            "width": int(meta["width"]),
            "height": int(meta["height"]),
        }
