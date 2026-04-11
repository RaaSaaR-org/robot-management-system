"""
uploader.py — Upload a local dataset directory to RustFS (S3-compatible storage).

After a recording finishes, the sidecar calls upload_dataset() to push the
LeRobot dataset tree to RustFS, then deletes the local copy. This makes the
dataset immediately available for the training worker.

Env vars (same credentials as the Mac server):
  RUSTFS_ENDPOINT   — e.g. http://192.168.178.40:9000
  RUSTFS_ACCESS_KEY — e.g. rustfsadmin
  RUSTFS_SECRET_KEY — e.g. rustfsadmin
  RUSTFS_BUCKET     — e.g. datasets (default)
@status live
"""

from __future__ import annotations

import mimetypes
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any, Optional


RUSTFS_ENDPOINT = os.environ.get("RUSTFS_ENDPOINT", "")
RUSTFS_ACCESS_KEY = os.environ.get("RUSTFS_ACCESS_KEY", "")
RUSTFS_SECRET_KEY = os.environ.get("RUSTFS_SECRET_KEY", "")
RUSTFS_BUCKET = os.environ.get("RUSTFS_BUCKET", "training-datasets")


def _get_s3_client():
    """Lazy-init boto3 S3 client."""
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3",
        endpoint_url=RUSTFS_ENDPOINT,
        aws_access_key_id=RUSTFS_ACCESS_KEY,
        aws_secret_access_key=RUSTFS_SECRET_KEY,
        region_name="us-east-1",
        config=Config(signature_version="s3v4"),
    )


def upload_dataset(
    local_path: str,
    s3_prefix: str,
    bucket: str = RUSTFS_BUCKET,
    delete_after: bool = True,
) -> dict[str, Any]:
    """Upload all files under local_path to s3://bucket/s3_prefix/...

    Returns {ok, files_uploaded, total_bytes, s3_path, error?}.
    """
    if not RUSTFS_ENDPOINT:
        return {"ok": False, "error": "RUSTFS_ENDPOINT not configured"}

    root = Path(local_path)
    if not root.exists():
        return {"ok": False, "error": f"Local path does not exist: {local_path}"}

    try:
        s3 = _get_s3_client()

        # Ensure bucket exists
        try:
            s3.head_bucket(Bucket=bucket)
        except Exception:
            try:
                s3.create_bucket(Bucket=bucket)
                print(f"[Uploader] Created bucket: {bucket}", flush=True)
            except Exception as e:
                print(f"[Uploader] Bucket create failed (may already exist): {e}", flush=True)

        files = [f for f in root.rglob("*") if f.is_file()]
        total_bytes = 0
        uploaded = 0

        for f in files:
            relative = f.relative_to(root)
            key = f"{s3_prefix}/{relative}"
            ct = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
            size = f.stat().st_size
            s3.upload_file(str(f), bucket, key, ExtraArgs={"ContentType": ct})
            total_bytes += size
            uploaded += 1

        s3_path = f"{s3_prefix}"
        print(
            f"[Uploader] Uploaded {uploaded} files ({total_bytes/1024:.0f} KB) "
            f"→ s3://{bucket}/{s3_path}/",
            flush=True,
        )

        # Clean up local files
        if delete_after:
            shutil.rmtree(root, ignore_errors=True)
            print(f"[Uploader] Deleted local: {local_path}", flush=True)

        return {
            "ok": True,
            "files_uploaded": uploaded,
            "total_bytes": total_bytes,
            "s3_path": s3_path,
            "bucket": bucket,
        }

    except Exception as e:
        print(f"[Uploader] Upload failed: {e}", flush=True)
        return {"ok": False, "error": str(e)}


class AsyncUploader:
    """Runs upload_dataset in a background thread, exposing status."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._status: str = "idle"  # idle | uploading | done | error
        self._result: Optional[dict] = None
        self._thread: Optional[threading.Thread] = None

    @property
    def is_uploading(self) -> bool:
        return self._status == "uploading"

    def start(self, local_path: str, s3_prefix: str, bucket: str = RUSTFS_BUCKET, delete_after: bool = True) -> None:
        with self._lock:
            if self._status == "uploading":
                return
            self._status = "uploading"
            self._result = None

        def _run():
            result = upload_dataset(local_path, s3_prefix, bucket, delete_after)
            with self._lock:
                self._result = result
                self._status = "done" if result.get("ok") else "error"

        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "upload_status": self._status,
                "upload_result": self._result,
            }

    def reset(self) -> None:
        with self._lock:
            self._status = "idle"
            self._result = None
