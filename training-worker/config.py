"""Configuration loaded from environment (with .env file support)."""

from __future__ import annotations

import os
import socket
import sys
from dataclasses import dataclass
from pathlib import Path


def _load_env_file(path: Path) -> None:
    """Minimal .env loader — supports KEY=VALUE lines."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        # Strip inline comments (outside of quotes)
        if value and value[0] not in ('"', "'"):
            hash_idx = value.find("#")
            if hash_idx != -1:
                value = value[:hash_idx].rstrip()
        value = value.strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


@dataclass
class Config:
    """Worker configuration."""

    # Server + identity
    server_url: str
    worker_id: str
    poll_interval_sec: float

    # RustFS / S3-compatible storage
    rustfs_endpoint: str
    rustfs_access_key: str
    rustfs_secret_key: str
    rustfs_bucket_datasets: str
    rustfs_bucket_models: str

    # Training
    device: str  # "mps" | "cuda" | "cpu"
    hf_cache_dir: str
    checkpoint_interval_steps: int

    # NATS (for stats worker)
    nats_servers: str

    # Behaviour
    stub_mode: bool  # Phase 1a: fake trainer
    heartbeat_interval_sec: float

    @classmethod
    def from_env(cls) -> "Config":
        # Load .env file from worker dir if present
        _load_env_file(Path(__file__).parent / ".env")

        return cls(
            server_url=os.environ.get("NEODEM_SERVER_URL", "http://localhost:3001"),
            worker_id=os.environ.get("WORKER_ID", f"worker-{socket.gethostname()}"),
            poll_interval_sec=float(os.environ.get("POLL_INTERVAL_SEC", "5")),
            rustfs_endpoint=os.environ.get("RUSTFS_ENDPOINT", "http://localhost:9000"),
            rustfs_access_key=os.environ.get("RUSTFS_ACCESS_KEY", "rustfsadmin"),
            rustfs_secret_key=os.environ.get("RUSTFS_SECRET_KEY", "rustfsadmin"),
            rustfs_bucket_datasets=os.environ.get("RUSTFS_BUCKET_DATASETS", "datasets"),
            rustfs_bucket_models=os.environ.get("RUSTFS_BUCKET_MODELS", "models"),
            nats_servers=os.environ.get("NATS_SERVERS", "nats://localhost:4222"),
            device=os.environ.get("TRAINING_DEVICE", "cpu"),
            hf_cache_dir=os.environ.get("HF_CACHE_DIR", str(Path.home() / ".cache" / "neodem-worker")),
            checkpoint_interval_steps=int(os.environ.get("CHECKPOINT_INTERVAL_STEPS", "100")),
            stub_mode=os.environ.get("TRAINER_STUB", "false").lower() in ("1", "true", "yes"),
            heartbeat_interval_sec=float(os.environ.get("HEARTBEAT_INTERVAL_SEC", "30")),
        )

    def summary(self) -> str:
        return (
            f"server={self.server_url} worker_id={self.worker_id} "
            f"device={self.device} stub={self.stub_mode} "
            f"poll={self.poll_interval_sec}s"
        )


def require_python_311() -> None:
    if sys.version_info < (3, 11):
        raise RuntimeError("Python 3.11+ is required")
