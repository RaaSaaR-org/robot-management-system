"""HTTP client for posting callbacks to the NeoDEM server.

Maps directly to POST /api/training/workers/{claim,heartbeat,progress,checkpoint,complete,failed}.
Uses exponential backoff retries — the worker's state is transient; the
server is authoritative. We must not drop callbacks on transient errors.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

log = logging.getLogger(__name__)

# Max retries for transient network errors on each callback.
_MAX_RETRIES = 4
_BACKOFF_BASE_SEC = 0.5


@dataclass
class ClaimedJob:
    """Minimal view of a training job the worker needs."""

    id: str
    dataset_id: str
    dataset_storage_path: str  # RustFS prefix, e.g. "6c103435-.../" — NOT the same as dataset_id
    dataset_lerobot_version: str | None
    base_model: str
    fine_tune_method: str
    hyperparameters: dict[str, Any]
    status: str
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_api(cls, payload: dict[str, Any]) -> "ClaimedJob":
        job = payload.get("job", payload)
        dataset = payload.get("dataset") or {}
        # storagePath comes from the server as "{uuid}/" — strip trailing slash
        storage_path = (dataset.get("storagePath") or job["datasetId"]).rstrip("/")
        return cls(
            id=job["id"],
            dataset_id=job["datasetId"],
            dataset_storage_path=storage_path,
            dataset_lerobot_version=dataset.get("lerobotVersion"),
            base_model=job["baseModel"],
            fine_tune_method=job.get("fineTuneMethod", "lora"),
            hyperparameters=job.get("hyperparameters", {}) or {},
            status=job.get("status", "running"),
            raw=job,
        )


class ServerClient:
    """Thin client around the worker HTTP callback API."""

    def __init__(
        self,
        base_url: str,
        worker_id: str,
        device: str = "cpu",
        timeout_sec: float = 15.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.worker_id = worker_id
        self.device = device
        self._http = httpx.Client(base_url=self.base_url, timeout=timeout_sec)

    # ------------------------------------------------------------------ claim
    def claim_next_job(self) -> ClaimedJob | None:
        """POST /api/training/workers/claim — returns a job or None (204).

        Sends `device` alongside `workerId` so the server can register
        idle workers in its in-memory registry (TASK-145).
        """
        resp = self._post(
            "/api/training/workers/claim",
            {"workerId": self.worker_id, "device": self.device},
        )
        if resp.status_code == 204:
            return None
        resp.raise_for_status()
        return ClaimedJob.from_api(resp.json())

    # -------------------------------------------------------------- heartbeat
    def heartbeat(self, job_id: str, gpu_util: float = 0.0, memory_util: float = 0.0) -> str:
        """POST /api/training/workers/heartbeat — returns status ('continue'|'stop').

        Includes worker_id + device so the server can track which workers
        are connected (TASK-145). gpu_util/memory_util are still 0.0 by
        default; real telemetry is a separate follow-up.
        """
        data = self._post_json(
            "/api/training/workers/heartbeat",
            {
                "jobId": job_id,
                "workerId": self.worker_id,
                "device": self.device,
                "gpuUtil": gpu_util,
                "memoryUtil": memory_util,
            },
        )
        return data.get("status", "continue")

    # ---------------------------------------------------------------- progress
    def progress(
        self,
        job_id: str,
        step_number: int,
        total_steps: int,
        current_epoch: int,
        total_epochs: int,
        loss: float,
        learning_rate: float,
        accuracy: float | None = None,
    ) -> dict[str, Any]:
        """POST /api/training/workers/progress — returns {status, eta}.

        Note: `current_epoch`/`total_epochs`/`accuracy` are kept in the
        Python signature for future use, but the server schema only accepts
        the flat {epoch, step, totalSteps, trainLoss, learningRate} shape.
        """
        _ = total_epochs  # future: pass to server once schema supports it
        _ = accuracy
        return self._post_json(
            "/api/training/workers/progress",
            {
                "jobId": job_id,
                "epoch": current_epoch,
                "step": step_number,
                "totalSteps": total_steps,
                "trainLoss": loss,
                "learningRate": learning_rate,
            },
        )

    # -------------------------------------------------------------- checkpoint
    def checkpoint(self, job_id: str, epoch: int, checkpoint_uri: str) -> None:
        self._post_json(
            "/api/training/workers/checkpoint",
            {"jobId": job_id, "epoch": epoch, "checkpointUri": checkpoint_uri},
        )

    # ---------------------------------------------------------------- complete
    def complete(
        self,
        job_id: str,
        artifact_uri: str,
        final_metrics: dict[str, Any],
    ) -> dict[str, Any]:
        return self._post_json(
            "/api/training/workers/complete",
            {
                "jobId": job_id,
                "artifactUri": artifact_uri,
                "finalMetrics": final_metrics,
            },
        )

    # ------------------------------------------------------------------ failed
    def failed(self, job_id: str, error_message: str, last_checkpoint: str | None = None) -> None:
        body: dict[str, Any] = {"jobId": job_id, "error": error_message}
        if last_checkpoint:
            body["lastCheckpoint"] = last_checkpoint
        self._post_json("/api/training/workers/failed", body)

    # ------------------------------------------------------------------- close
    def close(self) -> None:
        self._http.close()

    # ============================================================ internals
    def _post(self, path: str, body: dict[str, Any]) -> httpx.Response:
        last_err: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                return self._http.post(path, json=body)
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                last_err = e
                delay = _BACKOFF_BASE_SEC * (2**attempt)
                log.warning(
                    "POST %s failed (attempt %d/%d): %s — retrying in %.1fs",
                    path,
                    attempt + 1,
                    _MAX_RETRIES,
                    e,
                    delay,
                )
                time.sleep(delay)
        assert last_err is not None
        raise last_err

    def _post_json(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        resp = self._post(path, body)
        resp.raise_for_status()
        return resp.json() if resp.content else {}
