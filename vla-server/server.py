"""
@file server.py
@description Consolidated VLA inference server — FastAPI HTTP.

Replaces smolvla-server/ and vla-inference/ with a single, model-agnostic
HTTP server. Supports SmolVLA, pi0.5 (stub), and future model backends.

Usage:
    uv run python server.py                       # defaults from config.yaml
    uv run python server.py --stub                # stub mode (no ML deps)
    VLA_DEVICE=cuda uv run python server.py       # CUDA override

HTTP API:
    GET  /health  -> {"status":"ok","model_loaded":true,"device":"mps"}
    GET  /config  -> {"action_dim":6,"cameras":["front"],"chunk_size":50}
    POST /predict -> {images, state, task} -> {actions, timestamp, inference_time_ms}
    POST /reset   -> {} -> {"ok":true}
"""

import argparse
import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from models.base import VLAModel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ── Config ───────────────────────────────────────────────────────

@dataclass
class ServerConfig:
    model: str = "smolvla"          # "smolvla" | "pi05" | "groot"
    model_path: str = "lerobot/smolvla_base"
    device: str = "mps"
    host: str = "0.0.0.0"
    port: int = 8000
    default_task: str = "Pick up the object."
    stub: bool = False
    # LoRA adapter (s3:// URI, local dir, or .tar.gz). Wraps base with PeftModel.
    adapter_path: str | None = None
    # Dataset stats.json for MEAN_STD un-normalization of actions.
    dataset_stats_path: str | None = None
    # Override camera feature names + empty camera padding.
    camera_names: list[str] | None = None
    empty_cameras: int | None = None
    # S3/RustFS credentials for s3:// paths.
    rustfs_endpoint: str | None = None
    rustfs_access_key: str | None = None
    rustfs_secret_key: str | None = None

    @classmethod
    def from_yaml(cls, path: str | Path = "config.yaml") -> "ServerConfig":
        path = Path(path)
        if path.exists():
            with open(path) as f:
                data = yaml.safe_load(f) or {}
            return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
        return cls()


# ── Pydantic models ──────────────────────────────────────────────

class PredictRequest(BaseModel):
    image_b64: str | None = Field(
        None, description="Backward-compat: single base64-encoded JPEG (treated as front)"
    )
    images: dict[str, str] | None = Field(
        None, description="camera_name -> base64-encoded JPEG"
    )
    state: list[float] = Field(
        ..., description="Current joint positions"
    )
    task: str = Field(
        ..., description="Natural language instruction"
    )

    def resolved_images(self) -> dict[str, str]:
        """Return images dict, converting image_b64 to front if needed."""
        if self.images:
            return self.images
        if self.image_b64:
            return {"front": self.image_b64}
        return {}


class PredictResponse(BaseModel):
    actions: list[list[float]]
    timestamp: float
    inference_time_ms: float


class HealthResponse(BaseModel):
    status: str = "ok"
    model: str = ""
    model_loaded: bool = False
    device: str = ""
    active_adapter_id: str | None = None


class LoadAdapterRequest(BaseModel):
    adapter_path: str = Field(
        ..., description="s3:// URI, absolute local path, or .tar.gz path"
    )
    adapter_id: str | None = Field(
        None, description="Caller-supplied identifier (e.g. modelVersionId)"
    )


class LoadAdapterResponse(BaseModel):
    adapter_id: str
    loaded_at: float
    load_time_ms: float
    info: dict


class ConfigResponse(BaseModel):
    action_dim: int
    chunk_size: int
    cameras: list[str]
    state_dim: int


# ── Model factory ────────────────────────────────────────────────

def create_model(config: ServerConfig) -> VLAModel:
    """Create the appropriate model backend."""
    if config.model == "groot":
        from models.groot import GR00TModel

        host = os.environ.get("VLA_HOST", "localhost")
        port = int(os.environ.get("VLA_ZMQ_PORT", "5555"))
        stub = config.stub or os.environ.get("VLA_STUB", "").lower() in ("1", "true")
        return GR00TModel(host=host, port=port, stub=stub)

    if config.stub or config.model == "pi05":
        from models.pi05 import Pi05Model
        return Pi05Model(model_path=config.model_path, device=config.device)

    if config.model == "smolvla":
        from models.smolvla import SmolVLAModel
        return SmolVLAModel(
            model_path=config.model_path,
            device=config.device,
            adapter_path=config.adapter_path,
            dataset_stats_path=config.dataset_stats_path,
            camera_names_override=config.camera_names,
            empty_cameras_override=config.empty_cameras,
            rustfs_endpoint=config.rustfs_endpoint,
            rustfs_access_key=config.rustfs_access_key,
            rustfs_secret_key=config.rustfs_secret_key,
        )

    raise ValueError(f"Unknown model: {config.model}")


# ── App ──────────────────────────────────────────────────────────

engine: VLAModel | None = None
config: ServerConfig | None = None
# Serializes /predict and /load-adapter so an in-flight inference cannot read
# a partially-mutated model during a hot-swap.
model_lock: asyncio.Lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine, config
    config = app.state.config
    engine = create_model(config)

    logger.info("=" * 60)
    logger.info("VLA Inference Server")
    logger.info(f"  Model:  {config.model} ({config.model_path})")
    logger.info(f"  Device: {config.device}")
    logger.info(f"  Stub:   {config.stub}")
    logger.info(f"  Listen: {config.host}:{config.port}")
    logger.info("=" * 60)

    try:
        engine.load()
        logger.info("Model loaded. Server ready.")
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        raise

    yield
    logger.info("Shutting down.")
    engine = None


app = FastAPI(
    title="VLA Inference Server",
    description="Consolidated VLA inference (SmolVLA, pi0.5, GR00T N1, ...)",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok" if engine and engine.is_loaded else "not_ready",
        model=config.model if config else "",
        model_loaded=engine is not None and engine.is_loaded,
        device=config.device if config else "",
        active_adapter_id=engine.active_adapter_id if engine else None,
    )


@app.get("/config", response_model=ConfigResponse)
async def get_config():
    if not engine or not engine.is_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")
    model_info = engine.info()
    return ConfigResponse(
        action_dim=model_info.action_dim,
        chunk_size=model_info.chunk_size,
        cameras=model_info.cameras,
        state_dim=model_info.state_dim,
    )


@app.post("/predict", response_model=PredictResponse)
async def predict(request: PredictRequest):
    if not engine or not engine.is_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")

    images = request.resolved_images()

    # Validate that all required cameras are present (extra cameras like wrist are OK)
    model_info = engine.info()
    expected = set(model_info.cameras)
    provided = set(images.keys())
    if not expected.issubset(provided):
        missing = expected - provided
        raise HTTPException(
            status_code=422,
            detail=f"Missing camera(s): {missing}. Expected: {expected}",
        )

    task = request.task or (config.default_task if config else "")

    async with model_lock:
        try:
            result = await asyncio.to_thread(
                engine.predict, images, request.state, task
            )
        except Exception as e:
            logger.error(f"Inference error: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Inference failed: {e}")

    return PredictResponse(
        actions=result.actions,
        timestamp=time.time(),
        inference_time_ms=result.inference_time_ms,
    )


@app.post("/reset")
async def reset_policy():
    if engine:
        engine.reset()
    return {"ok": True}


@app.post("/load-adapter", response_model=LoadAdapterResponse)
async def load_adapter(request: LoadAdapterRequest):
    """Hot-swap a LoRA adapter onto the loaded base model.

    Body:
        adapter_path: s3:// URI, absolute local path, or .tar.gz path
        adapter_id: optional caller-supplied identifier (e.g. modelVersionId)

    Returns:
        adapter_id, loaded_at, load_time_ms, info dict
    """
    if not engine or not engine.is_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")

    async with model_lock:
        t_start = time.perf_counter()
        try:
            result = await asyncio.to_thread(
                engine.load_adapter, request.adapter_path, request.adapter_id
            )
        except NotImplementedError as e:
            raise HTTPException(status_code=501, detail=str(e))
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=f"Adapter not found: {e}")
        except Exception as e:
            logger.error(f"Adapter load failed: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Adapter load failed: {e}")
        load_time_ms = (time.perf_counter() - t_start) * 1000

    return LoadAdapterResponse(
        adapter_id=result["adapter_id"],
        loaded_at=time.time(),
        load_time_ms=load_time_ms,
        info=result.get("info", {}),
    )


# ── CLI ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="VLA Inference Server")
    parser.add_argument("--config", default="config.yaml", help="Path to config YAML")
    parser.add_argument("--stub", action="store_true", help="Stub mode (no ML deps)")
    args = parser.parse_args()

    cfg = ServerConfig.from_yaml(args.config)

    # Env overrides
    if env_device := os.environ.get("VLA_DEVICE"):
        cfg.device = env_device
    if env_model := os.environ.get("VLA_MODEL"):
        cfg.model = env_model
    if env_model_path := os.environ.get("VLA_MODEL_PATH"):
        cfg.model_path = env_model_path
    if env_port := os.environ.get("VLA_PORT"):
        cfg.port = int(env_port)

    if args.stub:
        cfg.stub = True

    app.state.config = cfg

    import uvicorn
    uvicorn.run(app, host=cfg.host, port=cfg.port, log_level="info")


if __name__ == "__main__":
    main()
