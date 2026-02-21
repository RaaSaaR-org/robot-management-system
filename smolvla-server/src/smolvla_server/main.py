"""SmolVLA Remote Inference Server.

Loads a SmolVLA policy on Mac M1 (MPS) and serves predictions over HTTP
for a remote Raspberry Pi running SO-101 hardware.

Usage:
    python -m smolvla_server.main
    python -m smolvla_server.main --config path/to/config.yaml
"""

import argparse
import logging
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException

from .config import ServerConfig
from .protocol import ConfigResponse, HealthResponse, PredictRequest, PredictResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Global state
engine = None
config: ServerConfig | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup, cleanup on shutdown."""
    global engine, config

    config = app.state.config

    if config.stub:
        from .stub import StubInferenceEngine

        engine = StubInferenceEngine()
        logger.info("=" * 60)
        logger.info("SmolVLA Remote Inference Server (STUB MODE)")
        logger.info(f"  Listen: {config.host}:{config.port}")
        logger.info("=" * 60)
    else:
        from .inference import SmolVLAInferenceEngine

        engine = SmolVLAInferenceEngine(model_path=config.model_path, device=config.device)
        logger.info("=" * 60)
        logger.info("SmolVLA Remote Inference Server")
        logger.info(f"  Model:  {config.model_path}")
        logger.info(f"  Device: {config.device}")
        logger.info(f"  Listen: {config.host}:{config.port}")
        logger.info("=" * 60)

    try:
        engine.load()
        logger.info("Model loaded successfully. Server ready for predictions.")
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        raise

    yield

    logger.info("Server shutting down.")
    engine = None


app = FastAPI(
    title="SmolVLA Remote Inference",
    description="Serves SmolVLA predictions for remote robot control",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    return HealthResponse(
        status="ok" if engine and engine.policy else "not_ready",
        model_path=config.model_path if config else "",
        device=config.device if config else "",
        model_loaded=engine is not None and engine.policy is not None,
    )


@app.get("/config", response_model=ConfigResponse)
async def get_config():
    """Return model configuration for client setup."""
    if not engine or not engine.policy:
        raise HTTPException(status_code=503, detail="Model not loaded")

    return ConfigResponse(
        action_dim=engine.action_dim,
        chunk_size=engine.chunk_size,
        camera_names=engine.camera_names,
        state_dim=engine.state_dim,
    )


@app.post("/predict", response_model=PredictResponse)
async def predict(request: PredictRequest):
    """Run SmolVLA inference on an observation and return action chunk."""
    if not engine or not engine.policy:
        raise HTTPException(status_code=503, detail="Model not loaded")

    # Validate camera names
    expected_cameras = set(engine.camera_names)
    provided_cameras = set(request.images.keys())
    if not expected_cameras.issubset(provided_cameras):
        missing = expected_cameras - provided_cameras
        raise HTTPException(
            status_code=422,
            detail=f"Missing camera(s): {missing}. Expected: {expected_cameras}",
        )

    # Use request task or fall back to default
    task = request.task or config.default_task

    try:
        result = engine.predict(
            images=request.images,
            state=request.state,
            task=task,
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
    """Reset the policy's internal state (call between episodes)."""
    if engine:
        engine.reset()
    return {"status": "ok"}


def main():
    parser = argparse.ArgumentParser(description="SmolVLA Remote Inference Server")
    parser.add_argument(
        "--config",
        type=str,
        default="config.yaml",
        help="Path to server config YAML",
    )
    parser.add_argument(
        "--stub",
        action="store_true",
        default=None,
        help="Use stub engine (sine-wave actions, no ML dependencies)",
    )
    args = parser.parse_args()

    cfg = ServerConfig.from_yaml(args.config)
    if args.stub:
        cfg.stub = True
    app.state.config = cfg

    uvicorn.run(
        app,
        host=cfg.host,
        port=cfg.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
