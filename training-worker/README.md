# NeoDEM Training Worker

Python worker that polls the NeoDEM server for training jobs, runs them, and streams progress + checkpoints back over HTTP. Designed to run on a machine with a GPU (or Mac MPS) separate from the server.

## Architecture

```
  ┌─────────────────────────────┐          ┌──────────────────┐
  │  Worker (Mac MPS / CUDA)    │          │  Server (Pi)     │
  │  ───────────────────        │   HTTP   │  ───────────     │
  │  poll /workers/claim     ──────────→  │  Express + DB    │
  │     ← job payload           │←────────│                  │
  │                             │          │                  │
  │  POST /workers/progress  ──────────→  │                  │
  │  POST /workers/complete  ──────────→  │                  │
  │  GET  datasets (S3)      ──────────→  │  RustFS          │
  │  PUT  artifacts  (S3)    ──────────→  │                  │
  └─────────────────────────────┘          └──────────────────┘
```

The worker does **not** need NATS access — all coordination happens over the server's HTTP API. It only needs network reach to:
- The NeoDEM server (port 3001)
- RustFS / S3-compatible storage (port 9000)

## Two modes

| Mode | What it does | When to use |
|------|--------------|-------------|
| **Stub** (Phase 1a) | Emits 20 fake progress ticks + writes a tiny metadata artifact | Validate the full worker loop end-to-end without a GPU |
| **Real** (Phase 1b) | HF Transformers + PEFT LoRA fine-tune of SmolVLA | Actual training runs |

## Setup (on your Mac)

```bash
cd training-worker

# Create venv and install
uv venv
source .venv/bin/activate
uv pip install -e .

# Configure
cp .env.example .env
# Edit .env: point NEODEM_SERVER_URL + RUSTFS_ENDPOINT at the Pi's IP

# Run in stub mode (no GPU / no ML deps needed)
TRAINER_STUB=true uv run python worker.py
```

## What you'll see

```
HH:MM:SS [INFO] worker: NeoDEM training worker starting — server=... worker_id=... device=mps stub=True poll=5.0s
HH:MM:SS [INFO] worker: Using StubTrainer (Phase 1a fake training loop)
HH:MM:SS [INFO] worker: No pending jobs — polling every 5.0s
```

Submit a training job via the UI (`/training` → "New Training Job") and the worker will pick it up:

```
HH:MM:SS [INFO] worker: ▶ Running job abc123 — dataset=xyz base=smolvla method=lora
HH:MM:SS [INFO] trainers.stub: [Stub] job=abc123 device=mps epochs=5 steps/epoch=4 total=20
HH:MM:SS [INFO] trainers.stub: [Stub] wrote fake artifact to /tmp/.../model.safetensors.stub
HH:MM:SS [INFO] worker: ✓ Job abc123 completed — artifact=s3://models/abc123/model.safetensors.stub
```

Watch the progress bar advance in the UI.

## Configuration

All config via env vars or a `.env` file — see `.env.example`.

| Variable | Default | Notes |
|----------|---------|-------|
| `NEODEM_SERVER_URL` | `http://localhost:3001` | Pi's URL when running on Mac |
| `WORKER_ID` | `worker-<hostname>` | Identifies this worker in logs |
| `POLL_INTERVAL_SEC` | `5` | How often to check for new jobs |
| `RUSTFS_ENDPOINT` | `http://localhost:9000` | Pi's RustFS URL when running on Mac |
| `TRAINING_DEVICE` | `cpu` | `mps` on Mac, `cuda` on Linux GPU |
| `TRAINER_STUB` | `false` | Set `true` during Phase 1a validation |

## Phase 1b — Real SmolVLA LoRA trainer

To run actual fine-tuning (not the stub), you need the full ML stack **and** LeRobot.

```bash
# Inside the existing venv
cd training-worker
source .venv/bin/activate

# Install the ML dependencies listed in pyproject.toml
uv pip install -e .

# LeRobot isn't on PyPI — install from source
git clone https://github.com/huggingface/lerobot /tmp/lerobot
uv pip install -e "/tmp/lerobot[smolvla]"

# Switch off stub mode
export TRAINER_STUB=false
uv run python worker.py
```

The first run will download `lerobot/smolvla_base` (~4GB) from HuggingFace into `HF_CACHE_DIR` (default `~/.cache/neodem-worker`).

### What the real trainer does

1. Downloads the LeRobot-format dataset from RustFS (`datasets/<datasetId>/**`) into a temp dir.
2. Loads it with `LeRobotDataset(root=...)` (bypassing HuggingFace Hub).
3. Loads the base policy: `SmolVLAPolicy.from_pretrained("lerobot/smolvla_base")`.
4. Autodetects LoRA target modules on the model (`q_proj`, `v_proj`, etc.) and wraps with PEFT.
5. Trains with AdamW, streams per-step loss back to the server via `/workers/progress`.
6. Saves the LoRA adapter with `save_pretrained()`, packs it into `smolvla_lora.tar.gz`.
7. Uploads the tarball to `s3://models/<jobId>/smolvla_lora.tar.gz`.

### Expected performance

- **Mac MPS (M1/M2/M3)**: OK for small rank-8 LoRA runs on short datasets. Single step ≈ 1-3s for batch 4.
- **Linux CUDA**: target production environment. Single step ≈ 0.2-0.5s for batch 16.
- **CPU**: not recommended — single step can take 30s+.

### Hyperparameter knobs

| Key | Default | Notes |
|---|---|---|
| `learning_rate` | 1e-4 | AdamW learning rate |
| `batch_size` | 4 | per-device batch |
| `epochs` | 2 | full passes through the dataset |
| `lora_rank` | 16 | adapter rank (higher = more capacity) |
| `lora_alpha` | 2×rank | PEFT scaling factor |
| `lora_dropout` | 0.05 | PEFT dropout |
| `weight_decay` | 0.01 | optimizer regularization |
| `max_steps` | 0 | hard step cap (0 = no cap) — useful for quick sanity runs |

## Adding new trainers

Drop a new class into `trainers/` that subclasses `BaseTrainer` from `trainers/base.py`. Route to it in `worker._pick_trainer()`.

## Development

```bash
# Lint
ruff check .

# Test (requires httpx mock server)
pytest
```
