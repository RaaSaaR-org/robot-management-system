#!/usr/bin/env python3
"""
HuggingFace dataset push script — called via Node.js child_process.

Reads JSON config from stdin, downloads dataset files from MinIO/RustFS,
uploads them to HuggingFace Hub, and reports progress/result to stdout.
"""

import json
import os
import sys
import tempfile
import traceback

import boto3
from huggingface_hub import HfApi


def emit(data: dict) -> None:
    """Write a JSON line to stdout for the Node.js parent process."""
    print(json.dumps(data), flush=True)


def progress(step: str, message: str) -> None:
    emit({"type": "progress", "step": step, "message": message})


def main() -> None:
    try:
        raw = sys.stdin.read()
        config = json.loads(raw)
    except (json.JSONDecodeError, Exception) as e:
        emit({"success": False, "error": f"Invalid input: {e}"})
        sys.exit(1)

    dataset_id = config.get("datasetId", "")
    storage_path = config.get("storagePath", "")
    repo_id = config.get("repoId", "")
    token = config.get("token", "")
    private = config.get("private", False)

    if not repo_id or not token:
        emit({"success": False, "error": "repoId and token are required"})
        sys.exit(1)

    # RustFS/MinIO connection
    endpoint = os.environ.get("RUSTFS_ENDPOINT", "http://localhost:9000")
    access_key = os.environ.get("RUSTFS_ACCESS_KEY", "rustfsadmin")
    secret_key = os.environ.get("RUSTFS_SECRET_KEY", "rustfsadmin")
    bucket = os.environ.get("RUSTFS_BUCKET", "training-datasets")

    tmp_dir = None
    try:
        # Step 1: Connect to MinIO and list objects
        progress("connecting", "Connecting to storage...")
        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="us-east-1",
        )

        # List all objects under storagePath prefix
        progress("listing", f"Listing files under {storage_path}...")
        prefix = storage_path if storage_path.endswith("/") else storage_path + "/"
        objects = []
        continuation_token = None

        while True:
            kwargs = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            resp = s3.list_objects_v2(**kwargs)
            for obj in resp.get("Contents", []):
                key = obj["Key"]
                # Skip the prefix directory itself
                rel_path = key[len(prefix):]
                if rel_path:
                    objects.append((key, rel_path))
            if not resp.get("IsTruncated"):
                break
            continuation_token = resp["NextContinuationToken"]

        if not objects:
            emit({"success": False, "error": f"No files found under {storage_path}"})
            sys.exit(1)

        progress("downloading", f"Downloading {len(objects)} files from storage...")

        # Step 2: Download to temp directory
        tmp_dir = tempfile.mkdtemp(prefix="hf_push_")
        for i, (key, rel_path) in enumerate(objects):
            local_path = os.path.join(tmp_dir, rel_path)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            s3.download_file(bucket, key, local_path)
            if (i + 1) % 10 == 0 or i == len(objects) - 1:
                progress(
                    "downloading",
                    f"Downloaded {i + 1}/{len(objects)} files",
                )

        # Step 3: Upload to HuggingFace Hub
        progress("uploading", f"Uploading to HuggingFace: {repo_id}...")
        api = HfApi(token=token)

        # Create or ensure repo exists
        api.create_repo(
            repo_id=repo_id,
            repo_type="dataset",
            private=private,
            exist_ok=True,
        )

        api.upload_folder(
            folder_path=tmp_dir,
            repo_id=repo_id,
            repo_type="dataset",
        )

        url = f"https://huggingface.co/datasets/{repo_id}"
        progress("done", f"Published at {url}")
        emit({"success": True, "url": url})

    except Exception as e:
        tb = traceback.format_exc()
        emit({"success": False, "error": str(e), "traceback": tb})
        sys.exit(1)
    finally:
        # Step 4: Cleanup temp dir
        if tmp_dir and os.path.exists(tmp_dir):
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
