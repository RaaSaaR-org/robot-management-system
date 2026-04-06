"""NeoDEM dataset stats worker — NATS consumer that computes per-feature normalization stats.

Subscribes to `jobs.dataset.compute-stats` on the DATASET_VALIDATION JetStream stream.
For each job:
  1. Downloads Parquet files from RustFS
  2. Computes per-feature mean/std (action, observation.state, observation.images.*)
  3. Writes meta/stats.json in LeRobot v3 format back to RustFS
  4. PUTs to server to mark dataset as stats-ready

Run:
    uv run python stats_worker.py
"""

from __future__ import annotations

import json
import logging
import signal
import sys
import tempfile
import threading
import traceback
from pathlib import Path

import httpx
import numpy as np

from config import Config, require_python_311, _load_env_file

log = logging.getLogger("stats-worker")

# NATS subject and consumer matching server/src/messaging/streams.ts
NATS_SUBJECT = "jobs.dataset.compute-stats"
NATS_STREAM = "DATASET_VALIDATION"
NATS_CONSUMER = "dataset-validators"

# ---------------------------------------------------------------------- signal
_shutdown = threading.Event()


def _install_signal_handlers() -> None:
    def handle(signum: int, _frame) -> None:  # noqa: ANN001
        log.info("Received signal %d — requesting shutdown…", signum)
        _shutdown.set()

    signal.signal(signal.SIGINT, handle)
    signal.signal(signal.SIGTERM, handle)


# ---------------------------------------------------------------------- stats
def compute_dataset_stats(dataset_dir: Path) -> dict:
    """Compute per-feature normalization stats from Parquet files.

    Returns stats in LeRobot v3 format:
    {
      "action": {"mean": [...], "std": [...], "min": [...], "max": [...]},
      "observation.state": {"mean": [...], "std": [...], "min": [...], "max": [...]},
      "observation.images.top": {"dtype": "...", "shape": [...], ...},
      ...
    }
    """
    try:
        import pyarrow.parquet as pq
    except ImportError as e:
        raise RuntimeError("pyarrow is required — `uv pip install pyarrow`") from e

    stats: dict = {}

    # Find all parquet files under data/
    parquet_dir = dataset_dir / "data"
    if not parquet_dir.exists():
        # Try flat layout
        parquet_dir = dataset_dir

    parquet_files = sorted(parquet_dir.glob("**/*.parquet"))
    if not parquet_files:
        log.warning("No parquet files found in %s", dataset_dir)
        return {}

    log.info("Found %d parquet file(s) in %s", len(parquet_files), parquet_dir)

    # Collect numeric columns across all parquet files
    all_columns: dict[str, list[np.ndarray]] = {}

    for pf in parquet_files:
        try:
            table = pq.read_table(pf)
        except Exception as e:
            log.warning("Failed to read %s: %s", pf, e)
            continue

        for col_name in table.column_names:
            column = table.column(col_name)
            # Skip non-numeric columns (images stored as binary/struct)
            try:
                arr = column.to_numpy(zero_copy_only=False)
            except Exception:
                continue

            if col_name not in all_columns:
                all_columns[col_name] = []
            all_columns[col_name].append(arr)

    # Compute stats for action and observation.state columns
    for col_name, arrays in all_columns.items():
        # Identify feature type from column name
        feature_key = _classify_feature(col_name)
        if feature_key is None:
            continue

        try:
            combined = np.concatenate(arrays, axis=0)
        except (ValueError, TypeError):
            continue

        # For numeric arrays (action, state DOFs)
        if combined.dtype.kind in ("f", "i", "u"):
            # Handle both 1D and 2D arrays
            if combined.ndim == 1:
                combined = combined.reshape(-1, 1)

            stats[feature_key] = {
                "mean": combined.mean(axis=0).tolist(),
                "std": combined.std(axis=0).tolist(),
                "min": combined.min(axis=0).tolist(),
                "max": combined.max(axis=0).tolist(),
                "count": int(combined.shape[0]),
            }
            log.info(
                "Computed stats for %s: shape=%s mean=%s",
                feature_key,
                combined.shape,
                stats[feature_key]["mean"][:3],
            )

    # Handle image columns — just record shape/dtype
    _add_image_stats(stats, dataset_dir)

    return stats


def _classify_feature(col_name: str) -> str | None:
    """Map parquet column names to LeRobot v3 feature keys."""
    name = col_name.lower()

    if name == "action" or name.startswith("action"):
        return "action"
    if name in ("observation.state", "state", "observation_state"):
        return "observation.state"
    if name.startswith("observation.images.") or name.startswith("observation_images_"):
        # Normalize to dot notation
        return name.replace("_", ".")
    if name.startswith("observation.state"):
        return "observation.state"

    return None


def _add_image_stats(stats: dict, dataset_dir: Path) -> None:
    """Add image metadata (shape, dtype) for image features from info.json or parquet."""
    info_path = dataset_dir / "meta" / "info.json"
    if not info_path.exists():
        return

    try:
        info = json.loads(info_path.read_text())
    except Exception:
        return

    features = info.get("features", {})
    for key, feat in features.items():
        if "images" in key and key not in stats:
            shape = feat.get("shape") or feat.get("shapes", {}).get("observation.images", [])
            dtype = feat.get("dtype", "uint8")
            if shape:
                stats[key] = {
                    "dtype": dtype,
                    "shape": shape,
                    "channels_first": len(shape) >= 3 and shape[0] <= 4,
                }


# ---------------------------------------------------------------------- RustFS I/O
def download_dataset(cfg: Config, storage_path: str, dest_dir: Path) -> Path:
    """Download dataset files from RustFS."""
    from storage import StorageClient

    storage = StorageClient(
        endpoint=cfg.rustfs_endpoint,
        access_key=cfg.rustfs_access_key,
        secret_key=cfg.rustfs_secret_key,
        dataset_bucket=cfg.rustfs_bucket_datasets,
        model_bucket=cfg.rustfs_bucket_models,
    )
    return storage.download_dataset(storage_path, dest_dir)


def upload_stats_json(cfg: Config, storage_path: str, stats: dict) -> None:
    """Write meta/stats.json back to RustFS."""
    try:
        import boto3
        from botocore.client import Config as BotoConfig
    except ImportError as e:
        raise RuntimeError("boto3 is required — `uv pip install boto3`") from e

    client = boto3.client(
        "s3",
        endpoint_url=cfg.rustfs_endpoint,
        aws_access_key_id=cfg.rustfs_access_key,
        aws_secret_access_key=cfg.rustfs_secret_key,
        config=BotoConfig(signature_version="s3v4"),
        region_name="us-east-1",
    )

    key = f"{storage_path.rstrip('/')}/meta/stats.json"
    body = json.dumps(stats, indent=2).encode("utf-8")

    client.put_object(
        Bucket=cfg.rustfs_bucket_datasets,
        Key=key,
        Body=body,
        ContentType="application/json",
    )
    log.info("Uploaded stats.json to %s/%s", cfg.rustfs_bucket_datasets, key)


# ---------------------------------------------------------------------- server callback
def post_stats_to_server(cfg: Config, dataset_id: str, stats: dict) -> None:
    """PUT to server to update dataset with computed stats."""
    url = f"{cfg.server_url}/api/datasets/{dataset_id}"
    with httpx.Client(timeout=15.0) as client:
        resp = client.put(url, json={"statsJson": stats})
        resp.raise_for_status()
    log.info("Updated dataset %s with stats on server", dataset_id)


# ---------------------------------------------------------------------- job processing
def process_stats_job(cfg: Config, payload: dict) -> None:
    """Process a single stats computation job."""
    dataset_id = payload["datasetId"]
    storage_path = payload["storagePath"]

    log.info("▶ Computing stats for dataset %s (storagePath=%s)", dataset_id, storage_path)

    with tempfile.TemporaryDirectory(prefix=f"neodem-stats-{dataset_id[:8]}-") as tmp:
        work_dir = Path(tmp)

        # 1. Download dataset from RustFS
        dataset_dir = download_dataset(cfg, storage_path, work_dir / "dataset")
        log.info("Downloaded dataset to %s", dataset_dir)

        # 2. Compute per-feature stats
        stats = compute_dataset_stats(dataset_dir)
        if not stats:
            log.warning("No stats computed for dataset %s — no numeric features found", dataset_id)
            return

        # 3. Upload meta/stats.json to RustFS
        upload_stats_json(cfg, storage_path, stats)

        # 4. POST to server to mark dataset as stats-ready
        post_stats_to_server(cfg, dataset_id, stats)

    log.info("✓ Stats computation complete for dataset %s", dataset_id)


# ---------------------------------------------------------------------- NATS consumer
def run_nats_consumer(cfg: Config) -> None:
    """Connect to NATS and consume stats jobs from JetStream."""
    try:
        import nats as nats_py
    except ImportError as e:
        raise RuntimeError(
            "nats-py is required — `uv pip install nats-py`"
        ) from e

    import asyncio

    async def _run() -> None:
        nats_url = cfg.nats_servers
        log.info("Connecting to NATS at %s", nats_url)

        nc = await nats_py.connect(servers=nats_url)
        js = nc.jetstream()
        log.info("Connected to NATS JetStream")

        # Bind to the existing durable consumer created by the server
        try:
            sub = await js.pull_subscribe(
                subject=NATS_SUBJECT,
                durable=NATS_CONSUMER,
                stream=NATS_STREAM,
            )
            log.info(
                "Subscribed to %s (stream=%s, consumer=%s)",
                NATS_SUBJECT,
                NATS_STREAM,
                NATS_CONSUMER,
            )
        except Exception as e:
            log.error("Failed to subscribe to JetStream: %s", e)
            log.info("Make sure the server has created the DATASET_VALIDATION stream first.")
            await nc.close()
            return

        idle_prints = 0
        while not _shutdown.is_set():
            try:
                msgs = await sub.fetch(batch=1, timeout=5)
            except asyncio.TimeoutError:
                if idle_prints % 12 == 0:
                    log.info("No stats jobs — waiting…")
                idle_prints += 1
                continue
            except Exception as e:
                log.warning("Fetch error: %s", e)
                if idle_prints % 12 == 0:
                    log.info("No stats jobs — waiting…")
                idle_prints += 1
                await asyncio.sleep(2)
                continue

            for msg in msgs:
                idle_prints = 0
                try:
                    payload = json.loads(msg.data.decode())
                    log.info("Received stats job: %s", payload)
                    process_stats_job(cfg, payload)
                    await msg.ack()
                    log.info("Job ACKed successfully")
                except Exception as e:
                    log.error("Stats job failed: %s\n%s", e, traceback.format_exc())
                    # NAK so it can be retried (up to max_deliver=3)
                    await msg.nak()

        await nc.close()
        log.info("NATS connection closed")

    asyncio.run(_run())


# ---------------------------------------------------------------------- fallback HTTP polling
def run_http_poller(cfg: Config) -> None:
    """Fallback: poll server for stats jobs when NATS is unavailable.

    Since there's no dedicated polling endpoint for stats jobs yet, this
    just logs a message. The primary mode is NATS consumption.
    """
    log.warning(
        "NATS not available — stats worker requires NATS JetStream. "
        "Make sure NATS is running and NATS_SERVERS is configured."
    )
    _shutdown.wait()


# ---------------------------------------------------------------------- main
def main() -> None:
    require_python_311()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    _install_signal_handlers()

    # Load env from training-worker/.env
    _load_env_file(Path(__file__).parent / ".env")

    cfg = Config.from_env()
    log.info("NeoDEM stats worker starting — server=%s", cfg.server_url)

    # Check if NATS is reachable, fall back to HTTP if not
    try:
        import nats as nats_py  # noqa: F401

        run_nats_consumer(cfg)
    except ImportError:
        log.warning("nats-py not installed — falling back to HTTP mode")
        run_http_poller(cfg)
    except Exception as e:
        log.error("Stats worker failed: %s", e)
        sys.exit(1)

    log.info("Stats worker stopped cleanly.")


if __name__ == "__main__":
    main()
