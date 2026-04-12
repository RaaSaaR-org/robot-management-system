# Training Pipeline Testing

End-to-end test for the training worker (HTTP polling worker, claim endpoint, RustFS dataset download, SmolVLA+LoRA fine-tuning, artifact upload).

## TL;DR

```bash
# Training worker is now a separate repo — run from there:
cd ../training-worker && ./scripts/test-e2e.sh
```

One script. Starts everything it needs. Runs a 3-step training job. Passes/fails with a clear report.

Takes ~40 seconds end-to-end once the SmolVLA base model is HF-cached (first run adds ~30s for the ~4GB model download).

## What the script does

1. **RustFS** — starts `neodem-rustfs` container via `docker compose` if not running
2. **Server** — starts `npm run dev` in `server/` if :3001 isn't responding
3. **Dataset** — if `lerobot/svla_so101_pickplace` isn't imported, imports it (~85MB of video files from HF Hub)
4. **Job** — cancels any pending jobs for that dataset, submits a fresh 3-step job with `batch_size=2`, `lora_rank=8`
5. **Worker** — starts `python worker.py` against localhost
6. **Wait** — polls the job status every 5s, times out at 300s
7. **Report** — prints loss values + S3 artifact URI on success

## Prerequisites

- Docker Desktop running
- Python 3.12+ venv in the separate `training-worker` repo with `lerobot[smolvla]` installed (see [setup](#setup) below)
- Node 22+ with `server/node_modules` (run `npm install` in `server/` once)
- `jq` (`brew install jq`)
- SQLite DB initialized: `cd server && npm run db:push` (one-time)

## Services used

| Service | URL | How started | When |
|---------|-----|-------------|------|
| RustFS | http://localhost:9000 | `docker compose up -d rustfs rustfs-init` | script auto-starts |
| Server | http://localhost:3001 | `cd server && npm run dev` | script auto-starts |
| Worker | (no port) | `cd ../training-worker && python worker.py` | script starts + stops |

Logs at `/tmp/neodem-server.log` and `/tmp/neodem-worker.log`.

## Known-good test dataset

`lerobot/svla_so101_pickplace` — 50 episodes, 11,939 frames, 2 cameras (up + side, video), 6-DOF SO-101 arm actions. Designed for SmolVLA, small enough to import quickly.

## Setup (one-time)

If the worker's venv doesn't exist yet:

```bash
# In the separate training-worker repo:
cd ../training-worker
uv venv --python 3.13
source .venv/bin/activate
uv pip install -e .
uv pip install "lerobot[smolvla] @ git+https://github.com/huggingface/lerobot"
```

Server database:

```bash
cd server
npm install   # if needed
npm run db:push
```

## Troubleshooting

### "Server failed to come up in 60s"

Check `/tmp/neodem-server.log`. Common causes:
- Port 3001 already bound by another process: `lsof -i:3001 -sTCP:LISTEN`
- SQLite DB not initialized: `cd server && npm run db:push`

### "All image features are missing from the batch"

The dataset's camera feature names don't match the policy's expected names. The trainer uses LeRobot's `make_policy(cfg, ds_meta=...)` which builds `cfg.input_features` from the dataset — if you added a new dataset whose cameras don't follow `observation.images.{name}` convention, this will break.

### "Job failed: 'observation.language.tokens'"

The tokenizer preprocessor wasn't applied. The trainer must use `make_pre_post_processors()` and call `preprocessor(batch)` before the forward pass.

### "tensor a (X) must match tensor b (X - 48)"

`48` is `tokenizer_max_length`. Set `pad_language_to="max_length"` in `SmolVLAConfig` (the default `"longest"` creates variable-size attention masks that mismatch the cached sequence length).

### "tuple object has no attribute 'backward'"

`SmolVLAPolicy.forward()` returns `(loss_tensor, loss_dict)`, not a dict. Unpack accordingly.

## Manual steps (when the script fails)

### Start services manually

```bash
# RustFS
docker compose up -d rustfs rustfs-init

# Server
cd server && npm run dev

# Worker (separate repo)
cd ../training-worker && source .venv/bin/activate
TRAINER_STUB=false python worker.py
```

### Import a dataset

```bash
curl -X POST http://localhost:3001/api/datasets/import/huggingface \
  -H 'Content-Type: application/json' \
  -d '{"repoId":"lerobot/svla_so101_pickplace","revision":"main","includeVideos":true}'
```

### Submit a training job

```bash
curl -X POST http://localhost:3001/api/training/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "datasetId":"<DATASET_UUID>",
    "baseModel":"smolvla",
    "fineTuneMethod":"lora",
    "hyperparameters":{"learning_rate":0.0001,"batch_size":2,"epochs":1,"lora_rank":8,"max_steps":3}
  }'
```

### Inspect RustFS contents

```python
import boto3
from botocore.client import Config as BotoConfig
c = boto3.client("s3", endpoint_url="http://localhost:9000",
    aws_access_key_id="rustfsadmin", aws_secret_access_key="rustfsadmin",
    config=BotoConfig(signature_version="s3v4"), region_name="us-east-1")
print([b["Name"] for b in c.list_buckets()["Buckets"]])
```
