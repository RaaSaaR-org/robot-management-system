"""Stub trainer — fakes a training run so the full worker loop can be
validated end-to-end without needing a GPU, dataset, or any ML stack.

Produces a tiny dummy artifact (metadata only) that the UI can display.
Phase 1a uses this; Phase 1b swaps in the real SmolVLA LoRA trainer.
"""

from __future__ import annotations

import json
import logging
import math
import time
from time import monotonic

from .base import (
    BaseTrainer,
    CancelledError,
    ProgressEvent,
    TrainerContext,
    TrainerResult,
    ProgressCallback,
)

log = logging.getLogger(__name__)


class StubTrainer(BaseTrainer):
    """Fakes 20 training steps with decreasing loss over ~20 seconds."""

    def train(
        self,
        ctx: TrainerContext,
        on_progress: ProgressCallback,
    ) -> TrainerResult:
        # Pull hyperparameters — respect what the user set, with sensible defaults
        total_epochs = int(ctx.hyperparameters.get("epochs") or 5)
        steps_per_epoch = int(ctx.hyperparameters.get("steps_per_epoch") or 4)
        total_steps = total_epochs * steps_per_epoch
        lr = float(ctx.hyperparameters.get("learning_rate") or 1e-4)

        log.info(
            "[Stub] job=%s device=%s epochs=%d steps/epoch=%d total=%d",
            ctx.job_id,
            ctx.device,
            total_epochs,
            steps_per_epoch,
            total_steps,
        )

        started = monotonic()
        start_loss = 2.5
        end_loss = 0.35
        for step in range(1, total_steps + 1):
            # Decreasing loss (exponential decay from start to end)
            frac = (step - 1) / max(1, total_steps - 1)
            loss = end_loss + (start_loss - end_loss) * math.exp(-3 * frac)
            epoch = ((step - 1) // steps_per_epoch) + 1

            event = ProgressEvent(
                step=step,
                total_steps=total_steps,
                epoch=epoch,
                total_epochs=total_epochs,
                loss=round(loss, 4),
                learning_rate=lr,
                accuracy=round(0.4 + 0.55 * (1 - math.exp(-2 * frac)), 4),
            )
            should_continue = on_progress(event)
            if not should_continue:
                log.info("[Stub] cancellation received at step %d", step)
                raise CancelledError(f"cancelled at step {step}")

            # Sleep so the UI has time to poll/render progress
            time.sleep(1.0)

        # Write a dummy artifact describing what "would have" trained
        artifact_path = ctx.work_dir / "model.safetensors.stub"
        metadata = {
            "job_id": ctx.job_id,
            "base_model": ctx.base_model,
            "fine_tune_method": ctx.fine_tune_method,
            "trainer": "stub",
            "final_loss": round(end_loss, 4),
            "total_steps": total_steps,
            "hyperparameters": ctx.hyperparameters,
            "note": "Phase 1a fake artifact — replace with real SmolVLA checkpoint in Phase 1b",
        }
        ctx.work_dir.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(json.dumps(metadata, indent=2))
        log.info("[Stub] wrote fake artifact to %s", artifact_path)

        return TrainerResult(
            artifact_path=artifact_path,
            final_metrics={
                "finalLoss": round(end_loss, 4),
                "validationLoss": round(end_loss * 1.05, 4),
                "trainingTimeSeconds": round(monotonic() - started, 1),
                "bestEpoch": total_epochs,
            },
        )
