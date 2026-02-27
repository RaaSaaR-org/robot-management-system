# VLA Integration Guide

This guide covers the Vision-Language-Action inference pipeline: how the SO-101 robot arm executes learned skills using camera input and natural language instructions.

## Overview

The VLA pipeline has three components:

1. **VLA Server** (`vla-server/`) — FastAPI inference server, runs on a machine with GPU/MPS
2. **VLA Runner** (`robot-agent/hardware/vla_runner.py`) — Python control loop on the Pi, captures cameras, sends to VLA server, applies actions
3. **Safety Layer** (`robot-agent/hardware/vla_safety.py`) — rate limiter, joint validator, watchdog

```
┌──────────────┐    POST /predict     ┌──────────────┐
│  VLA Runner  │────────────────────►│  VLA Server  │
│  (Pi, 5 Hz)  │◄────────────────────│ (Mac, :8000) │
│              │    action chunks     │              │
│  cameras     │                      │  SmolVLA /   │
│  SO-101 arm  │                      │  GR00T N1    │
└──────────────┘                      └──────────────┘
```

## Supported Models

| Model | Backend | Device | Status |
|-------|---------|--------|--------|
| SmolVLA | `vla-server/models/smolvla.py` | MPS (Mac), CUDA, CPU | Active |
| GR00T N1 | `vla-server/models/groot.py` | NVIDIA GPU (ZMQ to PolicyServer) | Ready |
| pi0.5 | `vla-server/models/pi05.py` | — | Stub only (TASK-078) |

## Running the VLA Server

### SmolVLA on Mac (Apple Silicon)

```bash
cd vla-server
uv sync
uv run python server.py
# Listens on http://0.0.0.0:8000
```

Configuration via `config.yaml`:

```yaml
model: smolvla
model_path: lerobot/smolvla_base   # or path to fine-tuned checkpoint
device: mps
host: 0.0.0.0
port: 8000
stub: false
```

Environment overrides: `VLA_MODEL`, `VLA_DEVICE`, `VLA_PORT`, `VLA_MODEL_PATH`, `VLA_STUB`.

### GR00T N1

GR00T uses ZMQ to communicate with an Isaac-GR00T PolicyServer running on a machine with NVIDIA GPU.

```bash
# On the GPU server:
pip install "gr00t @ git+https://github.com/NVIDIA/Isaac-GR00T.git"
python run_gr00t_server.py --model nvidia/GR00T-N1.6-3B

# On the Pi (or Mac):
cd vla-server
uv pip install -e ".[groot]"
VLA_MODEL=groot VLA_HOST=<gpu-server-ip> uv run python server.py
```

GR00T-specific environment variables: `VLA_HOST` (default: `localhost`), `VLA_ZMQ_PORT` (default: `5555`).

### Stub Mode (no ML dependencies)

```bash
VLA_STUB=true uv run python server.py
```

Returns sine-wave actions. Useful for testing the pipeline without loading a model.

## Starting VLA Control

### Via Sidecar API

```bash
curl -X POST http://localhost:8765/vla/start \
  -H "Content-Type: application/json" \
  -d '{
    "instruction": "pick up the green cube",
    "serverUrl": "http://192.168.178.38:8000",
    "wristCameraIndex": 1,
    "hz": 5.0
  }'
```

### Via Robot Agent API

```bash
curl -X POST http://localhost:41245/api/v1/robots/so101-igor-001/vla/start \
  -H "Content-Type: application/json" \
  -d '{"instruction": "pick up the green cube"}'
```

### Stopping

```bash
curl -X POST http://localhost:8765/vla/stop
# or
curl -X POST http://localhost:41245/api/v1/robots/so101-igor-001/vla/stop
```

## Camera Setup

The VLA runner captures frames from PiCamera2 (CSI cameras on the Raspberry Pi).

| Camera | Index | Sensor | Purpose |
|--------|-------|--------|---------|
| Front | 0 | IMX477 | Main observation (always used) |
| Wrist | 1 | OV5647 | End-effector view (optional) |

The runner fetches camera names from the VLA server's `GET /config` endpoint and maps them to available hardware cameras. Images are captured at 640x480, base64-encoded as JPEG (quality 85), and sent in the `images` dict.

### Camera Name Mapping

The VLA server reports required cameras in `/config` (e.g., `["front"]` or `["front", "wrist"]`). The runner maps:
- First camera name -> CSI cam 0 (front)
- Second camera name -> CSI cam `wristCameraIndex` (default: 1)

## Safety Pipeline

Actions pass through a 4-layer safety pipeline before reaching the robot:

### 1. Action Validator
Checks joint limits per SO-101 specs:

| Joint | Min | Max |
|-------|-----|-----|
| shoulder_pan | -150 deg | 150 deg |
| shoulder_lift | -180 deg | 180 deg |
| elbow_flex | -180 deg | 180 deg |
| wrist_flex | -180 deg | 180 deg |
| wrist_roll | -180 deg | 180 deg |
| gripper | 0 deg | 100 deg |

Out-of-range values are clipped (not rejected) to keep the arm moving safely.

### 2. Rate Limiter
Caps per-step joint delta to **10 degrees** (configurable via `POST /safety/config`). On VLA start, the rate limiter is seeded with the robot's current joint positions to prevent a large jump on the first action.

### 3. Network Watchdog
Monitors inference latency with a sliding window. If >50% of recent requests exceed the timeout threshold (default 100ms), triggers a safe stop.

### 4. Graceful Degradation
On safety failure, posts `POST /vla/stop` to the sidecar and holds the last known safe position.

### Runtime Safety Config

```bash
curl -X POST http://localhost:8765/safety/config \
  -H "Content-Type: application/json" \
  -d '{"max_delta_degrees": 5.0, "watchdog_timeout_ms": 50000}'
```

## Fine-Tuning

### Data Collection

Use the bilateral teleoperation WebSocket (`ws://localhost:41245/ws/bilateral-teleop`) or the data collection UI in the app to record demonstration episodes.

### Training Recommendations

- ~50 episodes per skill is a good starting point
- Use both front and wrist cameras during collection
- The SmolVLA base model (`lerobot/smolvla_base`) is a good starting checkpoint
- Fine-tuned checkpoints can be pointed to via `model_path` in `config.yaml`

### Using a Fine-Tuned Model

```yaml
# config.yaml
model: smolvla
model_path: /path/to/fine-tuned/checkpoint
device: mps
```

Or via environment variable:

```bash
VLA_MODEL_PATH=/path/to/checkpoint uv run python server.py
```

## Inference API Details

### POST /predict

Request:
```json
{
  "images": {
    "front": "<base64 JPEG>",
    "wrist": "<base64 JPEG>"
  },
  "state": [0.0, 45.0, -30.0, 10.0, 0.0, 50.0],
  "task": "pick up the green cube"
}
```

Response:
```json
{
  "actions": [
    [1.2, 44.5, -29.0, 11.0, 0.5, 50.0],
    [2.4, 43.8, -28.0, 12.0, 1.0, 50.0]
  ],
  "timestamp": 1709000000.123,
  "inference_time_ms": 45.2
}
```

Each action is a 6-element array: `[shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper]` in degrees.

## Troubleshooting

### VLA server returns 503
Model not loaded. Check `GET /health` for `model_loaded: false`. Verify model path exists and device is available.

### Large jump on first VLA action
The rate limiter should be seeded from current robot state. Check that the sidecar's `GET /state` returns real joint positions (not simulated).

### Camera not found
Verify CSI cameras are connected: `libcamera-hello --list-cameras`. PiCamera2 must be installed: `pip install picamera2`.

### Inference too slow
SmolVLA on Apple MPS: ~40-80ms per inference. If slower, check that no other processes are using the GPU. GR00T on NVIDIA GPU should be <20ms.

### wrist_roll jitter
Known hardware issue: wrist_roll cable can cause erratic readings. Limit wrist_roll to +/-90 degrees in the safety config or validator.
