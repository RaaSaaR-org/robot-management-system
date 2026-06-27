"""
@file policy_backend.py
@description Local, torch-free inference backend for a trained sim-RL navigation
    policy (TASK-172.C Phase 3).

The sim-to-real validation gate must be able to *run* a policy without a VLA
server and without the training stack. ``evaluate_vla.py`` cannot: it only ever
sends ``(images, state, task)`` to an HTTP VLA backend and can't feed the 61-dim
goal-relative nav observation. This backend loads a ``policy.onnx`` exported by
the trainer and the observation-normalization statistics (the ``VecNormalize``
``obs_rms`` mean/var, persisted into ``manifest.json``), then reproduces the
train-time transform:

    normalized = clip((obs - mean) / sqrt(var + eps), -clip_obs, clip_obs)
    action     = onnx(normalized)

The normalization is computed in float64 to match SB3's ``VecNormalize`` (whose
``obs_rms`` mean/var are float64), so a fixed observation is normalized
identically at train and eval time — the parity contract from
``nav_wrappers.make_nav_env``. (The action itself is run through onnxruntime, not
the original torch policy, so it is numerically equivalent rather than bit-exact.)
Inference uses onnxruntime only — no torch, no stable-baselines3 — so the gate
runs anywhere MuJoCo runs.

@status live
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)


class PolicyBackend:
    """Run a trained navigation policy from ``policy.onnx`` + obs-norm stats."""

    def __init__(
        self,
        session,
        *,
        obs_mean: np.ndarray | None = None,
        obs_var: np.ndarray | None = None,
        clip_obs: float = 10.0,
        epsilon: float = 1e-8,
    ):
        self._session = session
        self._input_name = session.get_inputs()[0].name
        self._output_name = session.get_outputs()[0].name
        # float64 to mirror SB3 RunningMeanStd (mean/var are float64); the
        # transform downcasts to float32 only at the end, like VecNormalize.
        self._obs_mean = None if obs_mean is None else np.asarray(obs_mean, dtype=np.float64)
        self._obs_var = None if obs_var is None else np.asarray(obs_var, dtype=np.float64)
        self.clip_obs = float(clip_obs)
        self.epsilon = float(epsilon)

    # --------------------------------------------------------------- factory
    @classmethod
    def from_artifacts(
        cls,
        policy_file: str | Path,
        manifest_file: str | Path | None = None,
    ) -> "PolicyBackend":
        """Load a backend from ``policy.onnx`` and an optional ``manifest.json``.

        The manifest's ``obs_norm`` block (``mean``/``var``/``clip``/``epsilon``)
        carries the frozen ``VecNormalize`` statistics. When it is absent the
        observation passes through unnormalized (identity) — correct for a policy
        trained without ``VecNormalize`` (e.g. the stub).
        """
        try:
            import onnxruntime as ort
        except ImportError as e:  # pragma: no cover - dependency guard
            raise RuntimeError(
                "onnxruntime is required to run a policy.onnx — `uv pip install onnxruntime`"
            ) from e

        policy_file = Path(policy_file)
        if not policy_file.exists():
            raise FileNotFoundError(f"policy file not found: {policy_file}")

        session = ort.InferenceSession(
            str(policy_file), providers=["CPUExecutionProvider"]
        )

        obs_mean = obs_var = None
        clip_obs, epsilon = 10.0, 1e-8
        if manifest_file is None:
            cand = policy_file.parent / "manifest.json"
            manifest_file = cand if cand.exists() else None
        if manifest_file and Path(manifest_file).exists():
            # A truncated/partial manifest (e.g. an interrupted download) must
            # not crash the whole gate run — fall back to identity normalization
            # rather than propagating a JSONDecodeError. float64 to match SB3.
            try:
                manifest = json.loads(Path(manifest_file).read_text())
            except (json.JSONDecodeError, OSError) as e:
                logger.warning(
                    "Manifest %s unreadable (%s) — using identity normalization",
                    manifest_file,
                    e,
                )
                manifest = {}
            norm = manifest.get("obs_norm") or {}
            if norm.get("mean") is not None and norm.get("var") is not None:
                obs_mean = np.asarray(norm["mean"], dtype=np.float64)
                obs_var = np.asarray(norm["var"], dtype=np.float64)
                clip_obs = float(norm.get("clip", 10.0))
                epsilon = float(norm.get("epsilon", 1e-8))
                logger.info("Loaded obs-norm stats (%d dims) from manifest", obs_mean.shape[0])
            else:
                logger.info("Manifest has no obs_norm — using identity normalization")

        return cls(
            session,
            obs_mean=obs_mean,
            obs_var=obs_var,
            clip_obs=clip_obs,
            epsilon=epsilon,
        )

    # --------------------------------------------------------------- inference
    def normalize_obs(self, obs: np.ndarray) -> np.ndarray:
        """Apply the frozen ``VecNormalize`` transform (identity if no stats).

        Computed in float64 to mirror SB3's ``VecNormalize._normalize_obs``
        (mean/var are float64; only the result is cast to float32), so the gate
        normalizes observations identically to training.
        """
        if self._obs_mean is None or self._obs_var is None:
            return np.asarray(obs, dtype=np.float32)
        obs64 = np.asarray(obs, dtype=np.float64)
        normed = (obs64 - self._obs_mean) / np.sqrt(self._obs_var + self.epsilon)
        return np.clip(normed, -self.clip_obs, self.clip_obs).astype(np.float32)

    def predict(self, obs: np.ndarray) -> np.ndarray:
        """Map a single 61-dim observation to a 29-dim action (deterministic)."""
        normed = self.normalize_obs(obs)
        batched = normed.reshape(1, -1).astype(np.float32)
        out = self._session.run([self._output_name], {self._input_name: batched})[0]
        return np.asarray(out, dtype=np.float32).reshape(-1)
