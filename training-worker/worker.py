"""NeoDEM training worker — poll server, claim jobs, run trainers, post callbacks.

Phase 1a (current): uses StubTrainer to validate the full loop.
Phase 1b (next):    swap in the HF Transformers + PEFT LoRA trainer for SmolVLA.

Run:
    uv run python worker.py                    # uses env / .env
    TRAINER_STUB=true uv run python worker.py  # force stub mode (default for now)
"""

from __future__ import annotations

import logging
import signal
import sys
import tempfile
import threading
import time
import traceback
from pathlib import Path

from callbacks import ClaimedJob, ServerClient
from config import Config, require_python_311
from trainers import BaseTrainer, CancelledError, ProgressEvent, StubTrainer, TrainerContext
from trainers.base import TrainerResult

log = logging.getLogger("worker")


# ---------------------------------------------------------------------- signal
_shutdown = threading.Event()


def _install_signal_handlers() -> None:
    def handle(signum: int, _frame) -> None:  # noqa: ANN001
        log.info("Received signal %d — requesting shutdown…", signum)
        _shutdown.set()

    signal.signal(signal.SIGINT, handle)
    signal.signal(signal.SIGTERM, handle)


# ------------------------------------------------------------------- heartbeat
class HeartbeatThread(threading.Thread):
    """Fires heartbeats every N seconds; flags cancellation in shared state."""

    def __init__(
        self,
        server: ServerClient,
        job_id: str,
        interval_sec: float,
        cancel_flag: threading.Event,
    ) -> None:
        super().__init__(daemon=True, name=f"heartbeat-{job_id[:8]}")
        self.server = server
        self.job_id = job_id
        self.interval_sec = interval_sec
        self.cancel_flag = cancel_flag
        self._stop = threading.Event()

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                status = self.server.heartbeat(self.job_id)
                if status == "stop":
                    log.info("Heartbeat: server requested cancel for job %s", self.job_id)
                    self.cancel_flag.set()
                    break
            except Exception as e:  # noqa: BLE001
                log.warning("Heartbeat failed: %s", e)
            self._stop.wait(self.interval_sec)

    def stop(self) -> None:
        self._stop.set()


# ------------------------------------------------------------------ trainer pick
def _pick_trainer(cfg: Config) -> BaseTrainer:
    if cfg.stub_mode:
        log.info("Using StubTrainer (Phase 1a fake training loop)")
        return StubTrainer()

    # Phase 1b: import the real trainer lazily so stub mode doesn't require
    # torch/transformers to be installed.
    try:
        from trainers.smolvla_lora import SmolVLALoraTrainer
    except ImportError as e:
        log.error(
            "Real trainer requested but ML dependencies missing (%s). "
            "Install with `uv pip install -e .`",
            e,
        )
        sys.exit(2)
    return SmolVLALoraTrainer()


# -------------------------------------------------------------- single job run
def _run_one_job(cfg: Config, server: ServerClient, trainer: BaseTrainer, job: ClaimedJob) -> None:
    log.info(
        "▶ Running job %s — dataset=%s base=%s method=%s",
        job.id,
        job.dataset_id,
        job.base_model,
        job.fine_tune_method,
    )

    cancel_flag = threading.Event()
    heartbeat = HeartbeatThread(server, job.id, cfg.heartbeat_interval_sec, cancel_flag)
    heartbeat.start()

    # Per-job scratch dir
    with tempfile.TemporaryDirectory(prefix=f"neodem-job-{job.id}-") as tmp:
        work_dir = Path(tmp)
        ctx = TrainerContext(
            job_id=job.id,
            dataset_id=job.dataset_id,
            dataset_storage_path=job.dataset_storage_path,
            dataset_lerobot_version=job.dataset_lerobot_version,
            base_model=job.base_model,
            fine_tune_method=job.fine_tune_method,
            hyperparameters=job.hyperparameters,
            device=cfg.device,
            work_dir=work_dir,
            hf_cache_dir=Path(cfg.hf_cache_dir),
        )

        # Progress callback — streams updates to the server
        def on_progress(ev: ProgressEvent) -> bool:
            try:
                result = server.progress(
                    job_id=job.id,
                    step_number=ev.step,
                    total_steps=ev.total_steps,
                    current_epoch=ev.epoch,
                    total_epochs=ev.total_epochs,
                    loss=ev.loss,
                    learning_rate=ev.learning_rate,
                    accuracy=ev.accuracy,
                )
                if result.get("status") == "cancel":
                    log.info("Progress callback signalled cancel")
                    return False
            except Exception as e:  # noqa: BLE001
                log.warning("Progress POST failed at step %d: %s", ev.step, e)
            # Also honour heartbeat-driven cancellation
            return not cancel_flag.is_set() and not _shutdown.is_set()

        try:
            result: TrainerResult = trainer.train(ctx, on_progress)
        except CancelledError as e:
            heartbeat.stop()
            log.info("Job %s cancelled by server: %s — skipping /failed POST", job.id, e)
            # The server already set status='cancelled' via /jobs/:id/cancel.
            # Posting /failed here would clobber that state.
            return
        except Exception as e:  # noqa: BLE001
            heartbeat.stop()
            log.error("Job %s failed: %s\n%s", job.id, e, traceback.format_exc())
            try:
                server.failed(job.id, f"{type(e).__name__}: {e}")
            except Exception as e2:  # noqa: BLE001
                log.error("Failed to POST /failed: %s", e2)
            return

        heartbeat.stop()

        # Upload artifact to RustFS, then POST /complete
        try:
            artifact_uri = _upload_artifact(cfg, job.id, result.artifact_path)
        except Exception as e:  # noqa: BLE001
            log.error("Artifact upload failed: %s", e)
            try:
                server.failed(job.id, f"artifact upload failed: {e}")
            except Exception:
                pass
            return

        try:
            server.complete(
                job_id=job.id,
                artifact_uri=artifact_uri,
                final_metrics=result.final_metrics,
            )
            log.info("✓ Job %s completed — artifact=%s", job.id, artifact_uri)
        except Exception as e:  # noqa: BLE001
            log.error("Failed to POST /complete for job %s: %s", job.id, e)


def _upload_artifact(cfg: Config, job_id: str, artifact_path: Path) -> str:
    """Upload artifact to RustFS and return its URI.

    Stub mode writes a tiny metadata file — still worth uploading so the
    whole flow (including model bucket access) is exercised.
    """
    from storage import StorageClient

    storage = StorageClient(
        endpoint=cfg.rustfs_endpoint,
        access_key=cfg.rustfs_access_key,
        secret_key=cfg.rustfs_secret_key,
        dataset_bucket=cfg.rustfs_bucket_datasets,
        model_bucket=cfg.rustfs_bucket_models,
    )
    storage.ensure_model_bucket()
    return storage.upload_artifact(job_id, artifact_path, artifact_path.name)


# -------------------------------------------------------------------- main loop
def main() -> None:
    require_python_311()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    _install_signal_handlers()

    cfg = Config.from_env()
    log.info("NeoDEM training worker starting — %s", cfg.summary())

    trainer = _pick_trainer(cfg)
    server = ServerClient(cfg.server_url, cfg.worker_id, device=cfg.device)

    idle_prints = 0
    try:
        while not _shutdown.is_set():
            try:
                job = server.claim_next_job()
            except Exception as e:  # noqa: BLE001
                log.warning("Claim poll failed: %s — sleeping", e)
                _shutdown.wait(cfg.poll_interval_sec)
                continue

            if job is None:
                # No jobs — throttle log output
                if idle_prints % 12 == 0:
                    log.info("No pending jobs — polling every %.1fs", cfg.poll_interval_sec)
                idle_prints += 1
                _shutdown.wait(cfg.poll_interval_sec)
                continue

            idle_prints = 0
            _run_one_job(cfg, server, trainer, job)
    finally:
        server.close()
        log.info("Worker stopped cleanly.")


if __name__ == "__main__":
    main()
