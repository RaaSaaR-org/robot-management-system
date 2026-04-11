"""
@file smolvla.py
@description SmolVLA model backend via LeRobot.

Loads a SmolVLA policy checkpoint and runs inference.
Supports MPS (Apple Silicon), CUDA, and CPU devices.
Optional LoRA adapter loading + dataset stats for normalization.

Ported from smolvla-server/src/smolvla_server/inference.py and
vla-inference/models/smolvla.py — consolidated into one implementation.
"""

import base64
import gc
import io
import json
import logging
import shutil
import tarfile
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import torch
from PIL import Image

from .base import ModelConfig, PredictResult, VLAModel

logger = logging.getLogger(__name__)

# SO-101 defaults
ACTION_DIM = 6
CHUNK_SIZE = 10
STATE_DIM = 6


class SmolVLAModel(VLAModel):
    """SmolVLA via LeRobot policy API.

    Supports optional LoRA adapter loading on top of the base model and
    MEAN_STD normalization/un-normalization using saved dataset stats.
    """

    def __init__(
        self,
        model_path: str = "lerobot/smolvla_base",
        device: str = "cpu",
        adapter_path: str | None = None,
        dataset_stats_path: str | None = None,
        camera_names_override: list[str] | None = None,
        empty_cameras_override: int | None = None,
        rustfs_endpoint: str | None = None,
        rustfs_access_key: str | None = None,
        rustfs_secret_key: str | None = None,
    ):
        self.model_path = model_path
        self.device = device
        self.adapter_path = adapter_path
        self._dataset_stats_path = dataset_stats_path
        self._camera_names_override = camera_names_override
        self._empty_cameras_override = empty_cameras_override
        self._rustfs_endpoint = rustfs_endpoint
        self._rustfs_access_key = rustfs_access_key
        self._rustfs_secret_key = rustfs_secret_key
        self._state_mean: np.ndarray | None = None
        self._state_std: np.ndarray | None = None
        self._action_mean: np.ndarray | None = None
        self._action_std: np.ndarray | None = None
        self._adapter_scratch_dir: Path | None = None
        self._active_adapter_id: str | None = None
        # Track adapters loaded via hot-swap so we can set_adapter() between them.
        self._loaded_adapter_names: set[str] = set()
        self.policy = None
        self._action_dim = ACTION_DIM
        self._chunk_size = CHUNK_SIZE
        self._state_dim = STATE_DIM

    def load(self) -> None:
        if self.policy is not None:
            logger.warning("SmolVLA already loaded, skipping")
            return

        logger.info(f"Loading SmolVLA from {self.model_path} on {self.device}")

        # Pattern A: lerobot >= 0.4 (policies moved to lerobot.policies.*)
        try:
            from lerobot.policies.smolvla.modeling_smolvla import SmolVLAPolicy

            self.policy = SmolVLAPolicy.from_pretrained(self.model_path)
        except (ImportError, AttributeError):
            # Pattern B: lerobot < 0.4 (lerobot.common.policies.*)
            try:
                from lerobot.common.policies.smolvla.modeling_smolvla import SmolVLAPolicy as SmolVLAPolicyLegacy

                self.policy = SmolVLAPolicyLegacy.from_pretrained(self.model_path)
            except (ImportError, AttributeError) as e:
                raise RuntimeError(
                    f"Could not load SmolVLA. Tried lerobot.policies and lerobot.common.policies. "
                    f"Check LeRobot installation. Error: {e}"
                ) from e

        # Optional: wrap with a LoRA adapter
        if self.adapter_path:
            self._wrap_with_adapter()
            # Treat the startup adapter as id "default" so hot-swaps can replace it.
            self._loaded_adapter_names.add("default")
            self._active_adapter_id = "default"

        # Optional: override camera feature names
        if self._camera_names_override is not None:
            self._apply_camera_override()

        # Optional: load dataset stats for normalization
        if self._dataset_stats_path:
            self._load_dataset_stats()

        self.policy.to(self.device)
        self.policy.eval()

        # Extract dimensions from config
        try:
            cfg = self._policy_config()
            self._action_dim = getattr(
                cfg,
                "action_dim",
                getattr(cfg, "output_shapes", {}).get("action", [ACTION_DIM])[0]
                if hasattr(cfg, "output_shapes")
                else ACTION_DIM,
            )
            self._chunk_size = getattr(
                cfg, "chunk_size", getattr(cfg, "n_action_steps", CHUNK_SIZE)
            )
            self._state_dim = getattr(
                cfg,
                "state_dim",
                getattr(cfg, "input_shapes", {}).get("observation.state", [STATE_DIM])[0]
                if hasattr(cfg, "input_shapes")
                else STATE_DIM,
            )
        except Exception:
            logger.warning("Could not read model config dims, using SO-101 defaults")

        logger.info(
            f"SmolVLA loaded: action_dim={self._action_dim}, "
            f"chunk_size={self._chunk_size}, state_dim={self._state_dim}"
        )

    def predict(
        self,
        images: dict[str, str],
        state: list[float],
        task: str,
    ) -> PredictResult:
        if self.policy is None:
            raise RuntimeError("Model not loaded. Call load() first.")

        t_start = time.perf_counter()
        obs = self._build_observation(images, state, task)

        with torch.no_grad():
            action = self.policy.select_action(obs)

        if isinstance(action, torch.Tensor):
            action_np = action.cpu().numpy()
        elif isinstance(action, np.ndarray):
            action_np = action
        else:
            action_np = np.array(action)

        if action_np.ndim == 1:
            action_np = action_np.reshape(1, -1)

        # Un-normalize actions back to raw units (MEAN_STD inverse).
        if self._action_mean is not None and self._action_std is not None:
            action_np = action_np * self._action_std + self._action_mean

        inference_time_ms = (time.perf_counter() - t_start) * 1000
        return PredictResult(actions=action_np.tolist(), inference_time_ms=inference_time_ms)

    def reset(self) -> None:
        if self.policy is not None and hasattr(self.policy, "reset"):
            self.policy.reset()

    # ------------------------------------------------------------ config helpers
    def _base_policy(self):
        """Return the underlying SmolVLAPolicy, unwrapping PEFT if present."""
        p = self.policy
        if p is None:
            return None
        if hasattr(p, "base_model") and hasattr(p.base_model, "model"):
            inner = p.base_model.model
            if hasattr(inner, "config") and hasattr(inner.config, "image_features"):
                return inner
        return p

    def _policy_config(self):
        """Return the underlying SmolVLAConfig, unwrapping PEFT if present."""
        inner = self._base_policy()
        return getattr(inner, "config", None) if inner is not None else None

    def info(self) -> ModelConfig:
        cameras = ["front"]
        if self.policy is not None:
            try:
                cfg = self._policy_config()
                if hasattr(cfg, "image_features") and cfg.image_features:
                    cameras = [
                        k.replace("observation.images.", "")
                        for k in cfg.image_features
                        if k.startswith("observation.images.")
                    ]
                elif hasattr(cfg, "camera_names"):
                    cameras = list(cfg.camera_names)
                elif hasattr(cfg, "input_shapes"):
                    cameras = [
                        k.replace("observation.images.", "")
                        for k in cfg.input_shapes
                        if k.startswith("observation.images.")
                    ]
            except Exception:
                pass
        return ModelConfig(
            action_dim=self._action_dim,
            chunk_size=self._chunk_size,
            cameras=cameras,
            state_dim=self._state_dim,
        )

    @property
    def is_loaded(self) -> bool:
        return self.policy is not None

    @property
    def active_adapter_id(self) -> str | None:
        return self._active_adapter_id

    def load_adapter(self, adapter_path: str, adapter_id: str | None = None) -> dict:
        """Hot-swap a LoRA adapter.

        If `self.policy` is already a `PeftModel`, register the new adapter via
        `load_adapter(name=...)` + `set_adapter(name)`. Otherwise, fall back to
        the slower path of wrapping the base policy fresh.

        Returns:
            {adapter_id, info: {strategy, path, total_loaded}}
        """
        if self.policy is None:
            raise RuntimeError("Base model not loaded; cannot apply adapter")

        from peft import PeftModel

        adapter_dir = self._resolve_adapter_dir(adapter_path)
        name = adapter_id or f"adapter-{int(time.time() * 1000)}"

        if isinstance(self.policy, PeftModel):
            # Fast path: hot-swap via PEFT's adapter registry.
            if name in self._loaded_adapter_names:
                # Already registered — just activate it.
                logger.info(f"Activating already-loaded adapter '{name}'")
                self.policy.set_adapter(name)
            else:
                logger.info(f"Loading adapter '{name}' from {adapter_dir}")
                self.policy.load_adapter(str(adapter_dir), adapter_name=name)
                self.policy.set_adapter(name)
                self._loaded_adapter_names.add(name)
            strategy = "peft_set_adapter"
        else:
            # Slow path: base policy is unwrapped — wrap it fresh with this adapter.
            logger.info(f"Wrapping base policy with adapter '{name}' from {adapter_dir}")
            self.policy = PeftModel.from_pretrained(
                self.policy, str(adapter_dir), adapter_name=name
            )
            self.policy.to(self.device)
            self.policy.eval()
            self._loaded_adapter_names.add(name)
            strategy = "peft_from_pretrained"

        self._active_adapter_id = name
        logger.info(f"Adapter '{name}' active (strategy={strategy})")
        return {
            "adapter_id": name,
            "info": {
                "strategy": strategy,
                "path": adapter_path,
                "total_loaded": len(self._loaded_adapter_names),
            },
        }

    def unload(self) -> None:
        """Release model and clear GPU/MPS memory."""
        if self.policy is None:
            return
        logger.info("Unloading SmolVLA")
        del self.policy
        self.policy = None
        if self._adapter_scratch_dir and self._adapter_scratch_dir.exists():
            shutil.rmtree(self._adapter_scratch_dir, ignore_errors=True)
            self._adapter_scratch_dir = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
            torch.mps.empty_cache()
        gc.collect()

    # ------------------------------------------------------------ adapter loading
    def _wrap_with_adapter(self) -> None:
        """Wrap the loaded base policy with a PEFT LoRA adapter."""
        from peft import PeftModel

        adapter_dir = self._resolve_adapter_dir(self.adapter_path)
        logger.info(f"Applying LoRA adapter from {adapter_dir}")
        self.policy = PeftModel.from_pretrained(self.policy, str(adapter_dir))
        logger.info("LoRA adapter applied successfully")

    def _resolve_adapter_dir(self, path: str) -> Path:
        if path.startswith("s3://"):
            return self._download_and_unpack_s3(path)
        p = Path(path)
        if p.is_dir():
            return self._find_adapter_dir(p)
        if p.is_file() and p.suffix in (".gz", ".tar", ".tgz"):
            return self._unpack_tarball(p)
        raise FileNotFoundError(f"Adapter path not found: {path}")

    def _download_and_unpack_s3(self, s3_uri: str) -> Path:
        import boto3
        from botocore.client import Config as BotoConfig

        parsed = urlparse(s3_uri)
        bucket, key = parsed.netloc, parsed.path.lstrip("/")
        if not self._rustfs_endpoint:
            raise RuntimeError("adapter_path is s3:// but rustfs_endpoint not configured")
        logger.info(f"Downloading adapter from {s3_uri}")
        client = boto3.client(
            "s3", endpoint_url=self._rustfs_endpoint,
            aws_access_key_id=self._rustfs_access_key,
            aws_secret_access_key=self._rustfs_secret_key,
            config=BotoConfig(signature_version="s3v4"), region_name="us-east-1",
        )
        scratch = Path(tempfile.mkdtemp(prefix="smolvla-adapter-"))
        self._adapter_scratch_dir = scratch
        tar_path = scratch / "adapter.tar.gz"
        client.download_file(bucket, key, str(tar_path))
        logger.info(f"Downloaded {tar_path.stat().st_size} bytes")
        return self._unpack_tarball(tar_path, dest=scratch / "unpacked")

    def _unpack_tarball(self, tar_path: Path, dest: Path | None = None) -> Path:
        if dest is None:
            dest = Path(tempfile.mkdtemp(prefix="smolvla-adapter-"))
            self._adapter_scratch_dir = dest
        dest.mkdir(parents=True, exist_ok=True)
        with tarfile.open(tar_path, "r:*") as tf:
            tf.extractall(dest)
        return self._find_adapter_dir(dest)

    def _find_adapter_dir(self, root: Path) -> Path:
        if (root / "adapter_config.json").exists():
            return root
        for sub in root.iterdir():
            if sub.is_dir() and (sub / "adapter_config.json").exists():
                return sub
        raise FileNotFoundError(f"No adapter_config.json under {root}")

    # ------------------------------------------------------------ camera override
    def _apply_camera_override(self) -> None:
        """Rewrite cfg.image_features to use provided camera names."""
        try:
            from lerobot.configs.types import FeatureType, PolicyFeature
        except ImportError:
            logger.warning("Cannot import PolicyFeature — camera override skipped")
            return

        cfg = self._policy_config()
        if cfg is None or not cfg.image_features:
            return
        sample_shape = next(iter(cfg.image_features.values())).shape
        new_features = {
            f"observation.images.{name}": PolicyFeature(type=FeatureType.VISUAL, shape=sample_shape)
            for name in self._camera_names_override
        }
        cfg.input_features = {
            k: v for k, v in cfg.input_features.items()
            if not k.startswith("observation.images.")
        }
        cfg.input_features.update(new_features)
        if self._empty_cameras_override is not None:
            cfg.empty_cameras = self._empty_cameras_override
        logger.info(f"Camera override: {self._camera_names_override} (empty={cfg.empty_cameras})")

    # ------------------------------------------------------------ dataset stats
    def _load_dataset_stats(self) -> None:
        """Load MEAN_STD normalization stats for state + action."""
        path = self._dataset_stats_path
        if path.startswith("s3://"):
            import boto3
            from botocore.client import Config as BotoConfig
            parsed = urlparse(path)
            client = boto3.client(
                "s3", endpoint_url=self._rustfs_endpoint,
                aws_access_key_id=self._rustfs_access_key,
                aws_secret_access_key=self._rustfs_secret_key,
                config=BotoConfig(signature_version="s3v4"), region_name="us-east-1",
            )
            raw = client.get_object(Bucket=parsed.netloc, Key=parsed.path.lstrip("/"))["Body"].read()
            stats = json.loads(raw)
        else:
            stats = json.loads(Path(path).read_text())

        if "observation.state" in stats:
            self._state_mean = np.array(stats["observation.state"]["mean"], dtype=np.float32)
            self._state_std = np.array(stats["observation.state"]["std"], dtype=np.float32)
        if "action" in stats:
            self._action_mean = np.array(stats["action"]["mean"], dtype=np.float32)
            self._action_std = np.array(stats["action"]["std"], dtype=np.float32)
        logger.info(f"Dataset stats loaded (state_mean={self._state_mean is not None}, action_mean={self._action_mean is not None})")

    # ------------------------------------------------------------ observation building
    def _build_observation(
        self, images: dict[str, str], state: list[float], task: str
    ) -> dict:
        """Convert raw inputs to LeRobot observation dict."""
        _cfg = self._policy_config()
        _img_features = getattr(_cfg, "image_features", None) or {}
        if self.policy is not None and _img_features:
            expected = [
                k.replace("observation.images.", "")
                for k in _img_features
                if k.startswith("observation.images.")
            ]
            if expected:
                provided_vals = list(images.values())
                if provided_vals:
                    images = {
                        cam: provided_vals[i % len(provided_vals)]
                        for i, cam in enumerate(expected)
                    }

        obs: dict = {}
        for camera_name, b64_jpeg in images.items():
            jpeg_bytes = base64.b64decode(b64_jpeg)
            pil_image = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
            img_array = np.array(pil_image, dtype=np.float32) / 255.0
            img_tensor = torch.from_numpy(img_array).permute(2, 0, 1).unsqueeze(0)
            obs[f"observation.images.{camera_name}"] = img_tensor.to(self.device)

        state_padded = list(state)
        if len(state_padded) < self._state_dim:
            state_padded += [0.0] * (self._state_dim - len(state_padded))
        state_arr = np.array(state_padded[: self._state_dim], dtype=np.float32)
        if self._state_mean is not None and self._state_std is not None:
            state_arr = (state_arr - self._state_mean) / (self._state_std + 1e-8)
        obs["observation.state"] = torch.from_numpy(state_arr).unsqueeze(0).to(self.device)

        # Tokenize task string
        base = self._base_policy()
        tokenizer = base.model.vlm_with_expert.processor.tokenizer
        max_len = getattr(base.config, "tokenizer_max_length", 48)
        tokenized = tokenizer(
            task, max_length=max_len, truncation=True,
            padding="max_length", return_tensors="pt",
        )
        obs["observation.language.tokens"] = tokenized["input_ids"].to(self.device)
        obs["observation.language.attention_mask"] = tokenized["attention_mask"].bool().to(self.device)

        return obs
