"""Mock backend: deterministic, GPU-free neural-trajectory episodes (TASK-182).

Writes a small but *real* mp4 (moving colour gradient, imageio + bundled
ffmpeg) plus a smooth 28-dim random-walk state/action sequence per frame.
Everything is seeded, so two runs with the same seed produce identical
trajectories. Runs in a couple of seconds per episode — fast enough to
exercise the whole RMS job pipeline without a GPU.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from ..constants import FPS, STATE_DIM


class MockBackend:
    name = "mock"
    model = "mock-neural-trajectory (deterministic, no GPU)"

    NFRAMES = 45
    WIDTH = 320
    HEIGHT = 240

    def generate_episode(self, spec: dict, jobdir: Path) -> dict:
        """Write video.mp4 + trajectory.json for one episode into jobdir."""
        rng = np.random.default_rng(int(spec["seed"]))
        states, actions = self._trajectory(rng)
        self._write_video(rng, jobdir / "video.mp4")
        (jobdir / "trajectory.json").write_text(
            json.dumps(
                {
                    "fps": FPS,
                    "dim": STATE_DIM,
                    "states": [[float(x) for x in row] for row in states],
                    "actions": [[float(x) for x in row] for row in actions],
                }
            )
        )
        return {"nframes": self.NFRAMES, "width": self.WIDTH, "height": self.HEIGHT}

    # ------------------------------------------------------------------ helpers

    def _trajectory(self, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
        """Smooth 28-dim random walk (states) + next-step deltas (actions)."""
        steps = rng.normal(0.0, 0.02, size=(self.NFRAMES, STATE_DIM))
        kernel = np.ones(5) / 5.0  # box-smooth each joint channel over time
        smooth = np.apply_along_axis(
            lambda c: np.convolve(c, kernel, mode="same"), 0, steps
        )
        states = np.cumsum(smooth, axis=0)
        actions = np.vstack([np.diff(states, axis=0), np.zeros((1, STATE_DIM))])
        return states.astype(np.float32), actions.astype(np.float32)

    def _write_video(self, rng: np.random.Generator, mp4: Path) -> None:
        """45-frame moving-gradient clip; imageio-ffmpeg supplies the encoder."""
        import imageio.v2 as imageio  # lazy: only needed when generating

        phase0 = float(rng.uniform(0.0, 2.0 * np.pi))
        yy, xx = np.mgrid[0 : self.HEIGHT, 0 : self.WIDTH]
        writer = imageio.get_writer(str(mp4), fps=FPS, macro_block_size=16)
        try:
            for t in range(self.NFRAMES):
                phase = phase0 + 2.0 * np.pi * t / self.NFRAMES
                r = 127.5 * (1.0 + np.sin(xx / self.WIDTH * 2.0 * np.pi + phase))
                g = 127.5 * (1.0 + np.sin(yy / self.HEIGHT * 2.0 * np.pi - 1.3 * phase))
                b = 127.5 * (
                    1.0
                    + np.sin((xx + yy) / (self.WIDTH + self.HEIGHT) * 2.0 * np.pi + 0.7 * phase)
                )
                frame = np.stack([r, g, b], axis=-1).astype(np.uint8)
                writer.append_data(frame)
        finally:
            writer.close()
