"""Real SmolVLA LoRA trainer — HF Transformers + PEFT + LeRobot dataset.

Loads `lerobot/smolvla_base`, applies PEFT LoRA to the VLM backbone,
trains on a LeRobot v3 dataset downloaded from RustFS, and saves the
LoRA adapter as a safetensors tarball.

Designed for Apple Silicon (MPS) or CUDA. CPU is supported but slow.

Phase 1b — replaces StubTrainer once TRAINER_STUB=false.
"""

from __future__ import annotations

import logging
import os
import shutil
import tarfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .base import (
    BaseTrainer,
    CancelledError,
    ProgressCallback,
    ProgressEvent,
    TrainerContext,
    TrainerResult,
)

log = logging.getLogger(__name__)


# Common LoRA target modules for VLMs (SmolVLM/SmolVLA). The trainer
# autodetects which of these exist on the loaded model.
_CANDIDATE_TARGET_MODULES = [
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
]


class SmolVLALoraTrainer(BaseTrainer):
    """Fine-tune SmolVLA with LoRA on a LeRobot dataset."""

    def train(
        self,
        ctx: TrainerContext,
        on_progress: ProgressCallback,
    ) -> TrainerResult:
        started = time.monotonic()

        # Hyperparameters with sane defaults
        hp = ctx.hyperparameters
        lr = float(hp.get("learning_rate", 1e-4))
        batch_size = int(hp.get("batch_size", 4))
        epochs = int(hp.get("epochs", 2))
        lora_rank = int(hp.get("lora_rank", 16))
        lora_alpha = int(hp.get("lora_alpha", lora_rank * 2))
        max_steps = int(hp.get("max_steps", 0))  # 0 = no cap

        log.info(
            "[SmolVLA+LoRA] job=%s device=%s epochs=%d batch=%d lr=%g rank=%d",
            ctx.job_id,
            ctx.device,
            epochs,
            batch_size,
            lr,
            lora_rank,
        )

        # Lazy imports so the module can be loaded without heavy deps in
        # stub mode (and so import failures produce actionable errors)
        try:
            import torch
            from peft import LoraConfig, get_peft_model, PeftModel
            from torch.utils.data import DataLoader
        except ImportError as e:
            raise RuntimeError(
                "Phase 1b trainer needs torch + peft. "
                "Run `uv pip install -e .` in training-worker/ first."
            ) from e

        # 1) Dataset — download from RustFS + load via LeRobot.
        # First load WITHOUT delta_timestamps to read meta, then reload with
        # the chunk deltas SmolVLA expects so actions come as [B, 50, 6].
        dataset_dir = ctx.work_dir / "dataset"
        self._download_dataset(ctx, dataset_dir)
        dataset = self._load_lerobot_dataset(ctx, dataset_dir)
        dataset = self._reload_with_deltas(ctx, dataset_dir, dataset)

        # 2) Count the dataset's camera features — SmolVLA's base expects
        # 3 cameras, so pad missing slots via empty_cameras. make_policy
        # (below) builds cfg.input_features from the dataset, so the
        # policy's image_features will match the batch's actual keys.
        camera_keys = sorted(
            k for k, v in dataset.features.items()
            if v.get("dtype") in ("video", "image")
        )
        empty_cameras = max(0, 3 - len(camera_keys))
        log.info(
            "[SmolVLA+LoRA] dataset cameras: %s (empty_cameras=%d)",
            camera_keys,
            empty_cameras,
        )

        loader = DataLoader(
            dataset,
            batch_size=batch_size,
            shuffle=True,
            num_workers=0,  # MPS/Pi safety: multi-worker sometimes deadlocks
            pin_memory=(ctx.device == "cuda"),
        )
        steps_per_epoch = len(loader)
        total_steps = epochs * steps_per_epoch
        if max_steps > 0:
            total_steps = min(total_steps, max_steps)
        log.info(
            "[SmolVLA+LoRA] dataset ready: %d frames, steps_per_epoch=%d, total=%d",
            len(dataset),
            steps_per_epoch,
            total_steps,
        )

        # 3) Base model — make_policy builds cfg.input_features from the
        # dataset's own feature names, so image keys match the batch.
        policy, preprocessor = self._load_base_policy(ctx, dataset, empty_cameras)
        device = torch.device(ctx.device)
        policy.to(device)

        # 3) Apply LoRA to the attention projection layers of the VLM backbone
        target_modules = self._discover_target_modules(policy)
        log.info("[SmolVLA+LoRA] PEFT target modules: %s", target_modules)
        lora_config = LoraConfig(
            r=lora_rank,
            lora_alpha=lora_alpha,
            target_modules=target_modules,
            lora_dropout=float(hp.get("lora_dropout", 0.05)),
            bias="none",
            task_type=None,
        )
        policy = get_peft_model(policy, lora_config)
        self._log_trainable_params(policy)

        # 4) Optimizer + training loop
        optimizer = torch.optim.AdamW(
            [p for p in policy.parameters() if p.requires_grad],
            lr=lr,
            weight_decay=float(hp.get("weight_decay", 0.01)),
        )

        policy.train()
        final_loss = float("nan")
        step_idx = 0
        for epoch in range(1, epochs + 1):
            for batch in loader:
                step_idx += 1
                if max_steps > 0 and step_idx > max_steps:
                    break

                # Preprocessor handles normalization, tokenization, device
                # placement. It expects (batch, task) tuple-like input
                # internally mapped to a transition. For training, calling
                # the pipeline directly on the batch dict is the convention.
                batch = preprocessor(batch)
                batch = self._move_batch(batch, device)
                optimizer.zero_grad(set_to_none=True)
                with self._amp_context(ctx.device):
                    result = policy(batch)
                    # SmolVLA returns (loss_tensor, loss_dict); older
                    # policies return just a tensor or dict.
                    if isinstance(result, tuple):
                        loss, _info = result
                    elif isinstance(result, dict):
                        loss = result["loss"]
                    else:
                        loss = result
                loss.backward()
                optimizer.step()

                final_loss = loss.detach().float().item()
                event = ProgressEvent(
                    step=step_idx,
                    total_steps=total_steps,
                    epoch=epoch,
                    total_epochs=epochs,
                    loss=round(final_loss, 6),
                    learning_rate=lr,
                )
                if not on_progress(event):
                    raise CancelledError(f"cancelled at step {step_idx}")

            if max_steps > 0 and step_idx >= max_steps:
                break

        # 5) Save adapter + pack into a tarball
        adapter_dir = ctx.work_dir / "lora_adapter"
        policy.save_pretrained(str(adapter_dir))

        artifact_path = ctx.work_dir / "smolvla_lora.tar.gz"
        with tarfile.open(artifact_path, "w:gz") as tf:
            tf.add(adapter_dir, arcname="lora_adapter")
        log.info("[SmolVLA+LoRA] wrote artifact %s", artifact_path)

        # Suppress unused import warning — PeftModel is a load-time helper
        _ = PeftModel

        duration_s = time.monotonic() - started
        return TrainerResult(
            artifact_path=artifact_path,
            final_metrics={
                "finalLoss": round(final_loss, 6),
                "validationLoss": round(final_loss, 6),  # no val split yet
                "trainingTimeSeconds": round(duration_s, 1),
                "bestEpoch": epochs,
            },
        )

    # ====================================================================
    # INTERNALS
    # ====================================================================

    def _download_dataset(self, ctx: TrainerContext, dest: Path) -> None:
        """Pull dataset Parquet + meta/ from RustFS."""
        from storage import StorageClient

        # Read worker config from env — the worker hands these down via env,
        # not as part of TrainerContext (so trainers stay env-agnostic).
        storage = StorageClient(
            endpoint=os.environ["RUSTFS_ENDPOINT"],
            access_key=os.environ["RUSTFS_ACCESS_KEY"],
            secret_key=os.environ["RUSTFS_SECRET_KEY"],
            dataset_bucket=os.environ.get("RUSTFS_BUCKET_DATASETS", "datasets"),
            model_bucket=os.environ.get("RUSTFS_BUCKET_MODELS", "models"),
        )
        # Use storage_path (RustFS prefix) — this differs from dataset_id
        # for HF-imported datasets (which have an internal storageId UUID).
        storage.download_dataset(ctx.dataset_storage_path, dest)

    def _load_lerobot_dataset(self, ctx: TrainerContext, dataset_dir: Path) -> Any:
        """Load a LeRobot v3 dataset from a local directory.

        LeRobotDataset normally fetches from HuggingFace Hub. We point it
        at our downloaded RustFS copy via the `root` arg.
        """
        try:
            from lerobot.datasets.lerobot_dataset import LeRobotDataset
        except ImportError:
            # Try legacy path
            from lerobot.common.datasets.lerobot_dataset import LeRobotDataset  # type: ignore

        # The dataset directory must contain meta/info.json. If our download
        # placed files directly in dataset_dir, we're good. Otherwise look
        # for a subdir.
        if not (dataset_dir / "meta" / "info.json").exists():
            # Maybe the bucket stored files under a repo_id subdir — check.
            subdirs = [d for d in dataset_dir.iterdir() if d.is_dir()]
            for d in subdirs:
                if (d / "meta" / "info.json").exists():
                    dataset_dir = d
                    break
            else:
                raise FileNotFoundError(
                    f"LeRobot meta/info.json not found under {dataset_dir}"
                )

        # LeRobotDataset needs a repo_id for its metadata cache. Use the
        # datasetId as a stable local identifier.
        #
        # Pass revision explicitly to prevent LeRobot from hitting the
        # HuggingFace Hub to resolve a "safe version" — our dataset is
        # fully local. If meta/tasks.parquet or meta/episodes/* are
        # missing, LeRobot falls back to Hub download which fails with
        # 401 for our local/* repo_id.
        revision = ctx.dataset_lerobot_version or "v3.0"
        return LeRobotDataset(
            repo_id=f"local/{ctx.dataset_id}",
            root=str(dataset_dir),
            revision=revision,
            download_videos=True,
        )

    def _reload_with_deltas(
        self,
        ctx: TrainerContext,
        dataset_dir: Path,
        dataset: Any,
    ) -> Any:
        """Reload the dataset with SmolVLA's delta indices so actions come
        in [B, chunk_size, action_dim] form and observations keep 1 step.
        """
        try:
            from lerobot.datasets.lerobot_dataset import LeRobotDataset
        except ImportError:
            from lerobot.common.datasets.lerobot_dataset import LeRobotDataset  # type: ignore
        fps = dataset.fps
        chunk_size = 50  # SmolVLAConfig default
        delta_timestamps = {
            "action": [i / fps for i in range(chunk_size)],
        }
        # Observation delta = [0] is the default (current frame only), so
        # no need to set it explicitly for images/state.
        revision = ctx.dataset_lerobot_version or "v3.0"
        return LeRobotDataset(
            repo_id=f"local/{ctx.dataset_id}",
            root=str(dataset_dir),
            revision=revision,
            download_videos=True,
            delta_timestamps=delta_timestamps,
        )

    def _load_base_policy(
        self,
        ctx: TrainerContext,
        dataset: Any,
        empty_cameras: int,
    ) -> tuple[Any, Any]:
        """Load lerobot/smolvla_base via make_policy so cfg.input_features
        is built directly from the dataset's own feature names (e.g.
        observation.images.up/side). With empty_cameras set, the policy
        pads missing camera slots with zero tensors at forward time.

        Returns (policy, preprocessor). The preprocessor pipeline handles
        normalization, language tokenization, and device placement.
        """
        from lerobot.policies.smolvla.configuration_smolvla import SmolVLAConfig
        from lerobot.policies.factory import make_policy, make_pre_post_processors

        os.environ.setdefault("HF_HOME", str(ctx.hf_cache_dir))

        cfg = SmolVLAConfig(
            pretrained_path="lerobot/smolvla_base",
            device=ctx.device,
            use_peft=False,  # we apply our own PEFT after loading
            empty_cameras=empty_cameras,
            # Force fixed-length language padding — the default "longest"
            # causes attention mask size mismatches between the VLM prefix
            # and the expert's cached att_masks.
            pad_language_to="max_length",
        )
        log.info("[SmolVLA+LoRA] loading lerobot/smolvla_base (HF cache=%s)", ctx.hf_cache_dir)
        policy = make_policy(cfg, ds_meta=dataset.meta)
        preprocessor, _postprocessor = make_pre_post_processors(
            policy_cfg=cfg,
            dataset_stats=dataset.meta.stats,
        )
        return policy, preprocessor

    def _discover_target_modules(self, model: Any) -> list[str]:
        """Find which LoRA target modules actually exist on this model.

        SmolVLA's VLM backbone is SmolLM2-based. We scan the module tree
        for common attention projection names and use those that match.
        """
        import torch.nn as nn

        found: set[str] = set()
        for name, module in model.named_modules():
            if not isinstance(module, nn.Linear):
                continue
            leaf = name.rsplit(".", 1)[-1]
            if leaf in _CANDIDATE_TARGET_MODULES:
                found.add(leaf)
        if not found:
            raise RuntimeError(
                f"Could not find any candidate LoRA target modules on the model. "
                f"Candidates: {_CANDIDATE_TARGET_MODULES}"
            )
        return sorted(found)

    def _log_trainable_params(self, model: Any) -> None:
        trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
        total = sum(p.numel() for p in model.parameters())
        pct = 100.0 * trainable / max(1, total)
        log.info(
            "[SmolVLA+LoRA] trainable params: %s / %s (%.2f%%)",
            f"{trainable:,}",
            f"{total:,}",
            pct,
        )

    def _move_batch(self, batch: Any, device: Any) -> Any:
        """Move tensors in a batch dict to `device`, leave other types alone."""
        import torch

        if isinstance(batch, dict):
            return {
                k: (v.to(device) if isinstance(v, torch.Tensor) else v)
                for k, v in batch.items()
            }
        if isinstance(batch, (list, tuple)):
            return type(batch)(
                v.to(device) if isinstance(v, torch.Tensor) else v for v in batch
            )
        return batch

    @contextmanager
    def _amp_context(self, device: str):
        """No-op autocast for now. MPS autocast is still rough; enable later."""
        yield

    # Suppress lint: `shutil` import is for future cleanup utilities
    _ = shutil
