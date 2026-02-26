# VLA Server

Consolidated VLA inference server for RoboMindOS. Replaces the previous `smolvla-server/` and `vla-inference/` directories with a single FastAPI HTTP server that supports multiple model backends.

## Supported Models

| Model   | Status | Device       | Description                    |
|---------|--------|--------------|--------------------------------|
| SmolVLA | Ready  | MPS/CUDA/CPU | SmolVLA via LeRobot            |
| pi0.5   | Stub   | CUDA         | pi0.5 via LeRobot (TASK-078)   |

## Setup

### Mac (Apple Silicon — MPS)

```bash
cd vla-server

# Create venv and install base deps
uv venv && source .venv/bin/activate
uv pip install -e ".[smolvla]"

# Install LeRobot with SmolVLA support
git clone https://github.com/huggingface/lerobot.git /tmp/lerobot
cd /tmp/lerobot && uv pip install -e ".[smolvla]"
cd -

# Configure
cp config.yaml.example config.yaml
# Edit config.yaml: device: mps

# Run
uv run python server.py
```

### Linux (NVIDIA GPU — CUDA)

```bash
cd vla-server

uv venv && source .venv/bin/activate
uv pip install -e ".[smolvla]"

# Install LeRobot
git clone https://github.com/huggingface/lerobot.git /tmp/lerobot
cd /tmp/lerobot && uv pip install -e ".[smolvla]"
cd -

# Configure
cp config.yaml.example config.yaml
# Edit config.yaml: device: cuda

# Or use env override:
VLA_DEVICE=cuda uv run python server.py
```

### Stub Mode (No ML Dependencies)

For testing without torch/LeRobot — returns sine-wave actions:

```bash
cd vla-server
uv pip install -e .
uv run python server.py --stub
```

## HTTP API

| Method | Endpoint  | Description                                          |
|--------|-----------|------------------------------------------------------|
| GET    | /health   | `{"status":"ok","model_loaded":true,"device":"mps"}` |
| GET    | /config   | `{"action_dim":6,"cameras":["front"],"chunk_size":10}` |
| POST   | /predict  | `{images, state, task}` -> `{actions, timestamp, inference_time_ms}` |
| POST   | /reset    | Reset policy state between episodes                  |

### /predict Request

```json
{
  "images": {"front": "<base64-encoded JPEG>"},
  "state": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  "task": "pick up the green object"
}
```

### /predict Response

```json
{
  "actions": [[0.1, 0.2, 0.3, 0.4, 0.5, 0.6], ...],
  "timestamp": 1709000000.123,
  "inference_time_ms": 4.5
}
```

## Environment Variables

| Variable         | Description                | Default              |
|------------------|----------------------------|----------------------|
| `VLA_DEVICE`     | Override device            | from config.yaml     |
| `VLA_MODEL`      | Override model backend     | from config.yaml     |
| `VLA_MODEL_PATH` | Override model path        | from config.yaml     |
| `VLA_PORT`       | Override server port       | from config.yaml     |

## Tests

```bash
uv pip install -e ".[dev]"
pytest tests/
```
