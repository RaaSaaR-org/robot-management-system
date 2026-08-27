# VLA Integration Guide

This guide covers the Vision-Language-Action inference pipeline: how the SO-101 robot arm executes learned skills using camera input and natural language instructions.

## Overview

The VLA pipeline has three components:

1. **VLA Server** (separate repo, see `../vla-server/`) — FastAPI inference server, runs on a machine with GPU/MPS
2. **Skill Executor** (`robot-agent/src/vla/skill-executor.ts`) — the live closed loop, in TypeScript. Captures frames and joint state through the sidecar, calls `/predict`, delta-clips and applies the actions. One loop for sim and hardware; optionally overlapping inference with execution (see [Real-Time Chunking](#real-time-chunking-rtc)).
3. **Safety Layer** (`robot-agent/hardware/vla_safety.py`) — rate limiter, joint validator, watchdog

>  `robot-agent/hardware/vla_runner.py` is the **previous** Python control loop.
> TASK-146 moved the agent's closed loop into TypeScript and TASK-184 removed
> the agent's last calls to the sidecar `/vla/*` surface — but the runner is
> **not orphaned**. `so101_sidecar.py` imports it at module level to serve
> `/vla/start|stop|status`, and `sim_evaluator/evaluate_vla.py` uses its
> backends; it is `@status support` and must not be deleted while those stand.
> It carries its own RTC implementation and reads its own env vars, notably
> `VLA_RTC_CHUNK_OVERLAP`, which the agent does not. Note that
> **`VLA_RTC_ENABLED` is read by both**, with different parsers — the agent
> accepts only `true`, the runner also `1`/`yes` — so on an SO-101 host
> exporting it turns RTC on in the runner as well as in the agent.

```
┌──────────────┐    POST /predict     ┌──────────────┐
│Skill Executor│────────────────────►│  VLA Server  │
│  (agent,5 Hz)│◄────────────────────│ (Mac, :8000) │
│              │    action chunks     │              │
│  cameras     │                      │  SmolVLA /   │
│  SO-101 arm  │                      │  GR00T N1    │
└──────────────┘                      └──────────────┘
```

## Supported Models

| Model | Backend | Device | Status |
|-------|---------|--------|--------|
| SmolVLA | `models/smolvla.py` (in vla-server repo) | MPS (Mac), CUDA, CPU | Active |
| GR00T N1 | `models/groot.py` (in vla-server repo) | NVIDIA GPU (ZMQ to PolicyServer) | Ready |
| pi0.5 | `models/pi05.py` (in vla-server repo) | — | Stub only (TASK-078) |

## Running the VLA Server

### SmolVLA on Mac (Apple Silicon)

```bash
# In the separate vla-server repo (see ../vla-server/)
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

# On the Pi (or Mac) — in the separate vla-server repo:
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

## Real-Time Chunking (RTC)

**Status: off by default. Sim-validated only — never run on a real robot.**

The rollout loop in `robot-agent/src/vla/skill-executor.ts` is serial by
default: it pops actions from the current chunk, and when the queue empties it
blocks on `/predict` and refills. The robot holds still for that whole round
trip, once every `chunk_size` steps. On GR00T-class chunk sizes that is a
visible pause at every boundary.

RTC (`VLA_RTC_ENABLED=true`, TASK-183) asks for chunk N+1 while chunk N is
still executing, and crossfades the two where they meet. Turning it on changes
nothing else: every RTC branch in the loop is gated, and with it off the loop
runs the statements, issues the HTTP calls, and produces the response bodies it
produced before the feature existed.

### Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `VLA_RTC_ENABLED` | `false` | RTC on for this agent. Exactly `true`; anything else is off. |
| `VLA_RTC_OVERLAP` | `0.25` | Fraction of a chunk still queued that fires the prefetch. Must be in (0, 1] — out-of-range values are rejected at boot with a warning and the default is used, never clamped. |
| `VLA_RTC_BLEND_STEPS` | `5` | Upper bound on the boundary crossfade, in steps. `0` means prefetch with a hard splice, which is the A/B control that separates the prefetch's win from the blend's. |

`VLA_RTC_CHUNK_OVERLAP` is **not** this knob. It counts whole steps and is read
only by `robot-agent/hardware/vla_runner.py`, which carries its own RTC
implementation and is still live as `@status support` (see above). The agent
warns at boot when the old name is set and RTC is on. `VLA_RTC_ENABLED`,
by contrast, is read by **both**.

### What it reports

A run with RTC on carries an `rtc` block on the `/skills/execute` response and
in the per-episode metadata POSTed to `/api/evaluation/episodes`; a run with
RTC off carries neither. Both of those are asserted, in
`robot-agent/src/api/__tests__/skill-rtc-payload.test.ts`.

The same counters are also appended to three log lines — `[Skill]` in the
executor, `[RobotStateManager/VLA] Loop finished` (the `/vla/start` entry
point, which has no response body and no emitter) and `[AgentMode/VLA]` for a
`demo` block. Those three are gated on the same `result.rtc`, but **no test
covers them**: nothing in `robot-agent/src/robot/__tests__/` or
`robot-agent/src/agent-mode/__tests__/` exercises an RTC run.

`chunkTransitions` counts chunks that entered the queue after the first;
`stalledTransitions` is how many of those the robot had to sit through with an
empty queue, and is the number RTC exists to drive to zero. `prefetchSkipped`
counts boundaries where RTC measured the round trip and declined — see below.

### Two limits, and where the numbers come from

Both figures below come from the test suite (`skill-executor.test.ts`) against
a scripted vla-server, run on Vitest's virtual clock at the 200 ms loop period
so that every number is an exact, reproducible integer rather than a stopwatch
reading. **They are sim numbers against a mock. Nothing here was measured on a
robot, and nothing here was measured against a real GR00T or SmolVLA backend.**

They are also all at 5 Hz. `LOOP_PERIOD_MS = 200` in `skill-executor.ts` is a
module constant with no env var or run option behind it, so this loop cannot
currently be run at any other rate, and none of the tuning below has been
checked at one.

**RTC declines when it would lose.** A merged chunk is shorter than the one the
backend answered with, because the actions covering the timesteps that elapsed
during inference are dropped. So every merge brings the next boundary forward:
prefetching buys shorter waits at the price of more of them. At chunk 8 /
overlap 0.25 / 16 steps, RTC wins at 600 ms of `/predict` — 3600 ms against the
serial 4200 ms, zero stall, exactly one round trip saved — and the trade turns
negative at 1.2 s. That cut-off is not a rollout measurement: it is a property
of `rtcPrefetchPaysOff` and `RTC_PAYOFF_MARGIN` at the shipped chunk and
overlap, and it is asserted on the function directly. The loop therefore
measures the round trip and refuses the prefetch past that point, taking the
plain serial boundary instead — at 1200/1800/2500 ms the sweep shows RTC
matching serial to the millisecond, with the declined boundaries counted in
`prefetchSkipped`. A run that is all skips is RTC telling you the inference
server is too slow for it to help.

**The crossfade is narrower than it looks.** A prefetched chunk is merged as
soon as it lands, and `blendChunks` can only fade against actions still in the
queue. So the fade reaches `chunk_size × VLA_RTC_OVERLAP × 200 ms` of latency
and no further — 400 ms at the shipped defaults. Over 16 steps that is exactly
4 blended steps at 100 ms of latency and **0 at 600 ms**; at `VLA_RTC_OVERLAP`
0.5 it is 6 at 600 ms. All three are asserted exactly. Past the reach the
boundary is still free but it is a hard splice, so TASK-183's "no discontinuity
larger than the `clipAction` bound" is **not met at the shipped default** — and
note that the second half of that criterion is not tested at all: no assertion
anywhere compares a boundary discontinuity against `MAX_DELTA_DEGREES`. Raising
`VLA_RTC_OVERLAP` to 0.5, or shortening the loop period, would buy the reach
back at the cost of more `/predict` calls per step; neither has been done here.
`VLA_RTC_BLEND_STEPS` is an upper bound on the fade, not a promise of one.

### RTC and the sidecar

RTC is the rollout loop's first attempt at doing two things at once, so it is
worth being explicit about what it overlaps and what it does not.

The `/predict` it overlaps with execution belongs to vla-server — a different
process, usually a different machine. **The observation does not.** On hardware
an observation is `/cameras`, a `/snapshot` per camera and `/state/fast` —
three calls with a single camera, N + 2 with N — and the loop's action send is
one more. Those
are captured on the loop's own thread, before its sleep, so the executor issues
**at most one sidecar request at a time**, in the loop's own order, with RTC on
or off. The capture is subtracted from that step's sleep rather than added to
it, so the `/action` cadence is unchanged **as long as the capture fits inside
the loop period**. The subtraction clamps at zero: a sidecar capture slower than
`LOOP_PERIOD_MS` stretches that one step by the overrun, and the executor logs a
warning naming the excess. This has not been measured on a robot.

This is not decoration:

- `g1_sidecar.py` serialises every DDS touch on a single `robot_lock`, and its
  `/action` ramp is only physically correct "when the caller drives `/action`
  at ~`G1_CONTROL_HZ`" — a state read contending for that lock jitters exactly
  that cadence.
- Under the `sentry` rollout strategy on SO-101, `lerobot-record` owns the
  cameras and the follower serial port, and the sidecar re-opens them on demand
  for the loop's snapshot/state/action calls.
- TASK-169 landed on this same read path immediately before this work, because
  a concurrent read raced cyclonedds into a half-built IDL type.

Covered by `skill-executor.test.ts` → "RTC never gives the sidecar a second
caller": a prefetch overlapping an action send, an abort mid-prefetch, and a
prefetch whose capture fails. All three run against a **mocked** sidecar, and
assert call ordering and concurrency rather than elapsed time.

Two honest caveats. First, `captureHardware` still fans its snapshots and
`/state/fast` out through one `Promise.all` — that pair has overlapped since
TASK-146, predates RTC, and is untouched here. Second, `HardwareClient`'s own
2-second telemetry poll is a separate, pre-existing caller of the sidecar and
is likewise untouched. The claim is about the rollout loop, not about the
process as a whole.

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
