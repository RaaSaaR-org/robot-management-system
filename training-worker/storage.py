"""S3-compatible (RustFS) storage client for datasets and artifacts."""

from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger(__name__)


class StorageClient:
    """Thin wrapper around boto3 for dataset fetch + artifact upload."""

    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        dataset_bucket: str,
        model_bucket: str,
    ) -> None:
        try:
            import boto3
            from botocore.client import Config as BotoConfig
        except ImportError as e:
            raise RuntimeError(
                "boto3 is required — `uv pip install boto3`"
            ) from e

        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=BotoConfig(signature_version="s3v4"),
            region_name="us-east-1",
        )
        self.dataset_bucket = dataset_bucket
        self.model_bucket = model_bucket
        self.endpoint = endpoint

    # ---------------------------------------------------------------- datasets
    def download_dataset(self, dataset_id: str, dest_dir: Path) -> Path:
        """Download all dataset files under `datasets/{dataset_id}/` to dest_dir.

        Returns the destination directory.
        """
        dest_dir.mkdir(parents=True, exist_ok=True)
        prefix = f"{dataset_id}/"
        log.info("Downloading dataset %s from %s/%s", dataset_id, self.dataset_bucket, prefix)

        paginator = self._client.get_paginator("list_objects_v2")
        count = 0
        for page in paginator.paginate(Bucket=self.dataset_bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                # strip the dataset_id/ prefix so we mirror the internal layout
                rel = key[len(prefix) :]
                if not rel:
                    continue
                local = dest_dir / rel
                local.parent.mkdir(parents=True, exist_ok=True)
                self._client.download_file(self.dataset_bucket, key, str(local))
                count += 1

        if count == 0:
            raise FileNotFoundError(
                f"No objects found under {self.dataset_bucket}/{prefix}"
            )
        log.info("Downloaded %d file(s) to %s", count, dest_dir)
        return dest_dir

    # ------------------------------------------------------------- model artifacts
    def upload_artifact(self, job_id: str, local_path: Path, name: str) -> str:
        """Upload a file to models/{job_id}/{name} — returns an s3:// URI."""
        key = f"{job_id}/{name}"
        log.info(
            "Uploading artifact %s → %s/%s (%d bytes)",
            local_path.name,
            self.model_bucket,
            key,
            local_path.stat().st_size,
        )
        self._client.upload_file(str(local_path), self.model_bucket, key)
        return f"s3://{self.model_bucket}/{key}"

    # ---------------------------------------------------------------- ensure
    def ensure_model_bucket(self) -> None:
        try:
            self._client.head_bucket(Bucket=self.model_bucket)
        except Exception:
            log.info("Creating model bucket: %s", self.model_bucket)
            self._client.create_bucket(Bucket=self.model_bucket)
