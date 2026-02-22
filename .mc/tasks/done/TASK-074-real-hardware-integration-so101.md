---
id: TASK-074
aliases:
- TASK-074
title: Real Hardware Integration — SO-101 Robot Arm
slug: real-hardware-integration-so101
status: done
priority: 1
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on: []
due_date: ''
created: 2026-02-21
updated: 2026-02-21
---


# Real Hardware Integration — SO-101 Robot Arm

## Description

The Robot Agent currently runs in **simulation only**. This task wires up the real SO-101 arm (on `/dev/ttyACM0`) and the Pi cameras to the VLA control loop, replacing simulated sensor/actuator data with real hardware I/O via LeRobot.

## Current State

- `robot-agent/src/robot/SimulationEngine.ts` — fake physics loop, all positions/states are simulated
- `robot-agent/src/vla/vla-controller.ts` — `ActionExecutor` and `ObservationGenerator` callbacks exist but are never connected to real hardware
- `robot-agent/smolvla/` — standalone Python client that uses LeRobot to drive real SO-101 (not integrated into main agent)
- No `.env.so101` file exists — must be created

## Details

### 1. Create `.env.so101`

File: `robot-agent/.env.so101`

```env
GEMINI_API_KEY=<key>
PORT=41245
SERVER_URL=http://<server_ip>:3001
ROBOT_ID=so101-igor-001
ROBOT_NAME=Igor
ROBOT_MODEL=SO-101
ROBOT_CLASS=lightweight
ROBOT_TYPE=so101
MAX_PAYLOAD_KG=0.5
ROBOT_DESCRIPTION=SO-101 6-DOF robot arm on Raspberry Pi 5
```

### 2. Real Hardware Bridge (Python subprocess or Node bindings)

Create `robot-agent/src/hardware/so101-bridge.ts` (or a Python sidecar) that:

- Opens `/dev/ttyACM0` via LeRobot `SO101Follower`
- Reads joint state → feeds into `ObservationGenerator`
- Receives action arrays → passes to `ActionExecutor` → `robot.send_action()`
- Uses calibration at `~/.cache/huggingface/lerobot/calibration/robots/so_follower/my_so101.json`

**Option A — Python sidecar (recommended for Pi):**
Extend `smolvla/` into a local gRPC or HTTP server that the Node agent calls. Uses the same stack as `vla-tests/pi05/client/client_pi.py`.

**Option B — Node.js serial (direct):**
Use `serialport` npm package to talk to Feetech servos directly. Harder, duplicates LeRobot logic.

**Recommended: Option A.** LeRobot already works and is calibrated.

### 3. Camera Integration

Replace simulated camera frames with real picamera2 frames:

- Camera 0: IMX477 (exterior view, 1280×720 → resize to 224×224)
- Camera 1: OV5647 (wrist cam candidate)
- Resize + pad via `openpi_client.image_tools.resize_with_pad(img, 224, 224)`

### 4. Wire into VLA Controller

In `robot-agent/src/index.ts` (or `agent-executor.ts`), instantiate `VLAController` with real callbacks:

```typescript
const controller = new VLAController({
  actionExecutor: async (action) => hardwareBridge.sendAction(action),
  observationGenerator: async () => hardwareBridge.getObservation(),
  embodimentTag: 'so101_arm',
  cloudEndpoint: process.env.VLA_SERVER_HOST ?? 'localhost:50051',
});
```

### 5. Safety

- Keep `SafetyMonitor` active — it already supports SO-101 torque/force limits
- Add joint limit clamping before sending to real servos
- Emergency stop must cut servo torque immediately via LeRobot `disconnect()`

### Key Files

| File | Action |
|---|---|
| `robot-agent/.env.so101` | Create |
| `robot-agent/src/hardware/so101-bridge.ts` | Create |
| `robot-agent/smolvla/src/smolvla_server/` | Extend as hardware sidecar |
| `robot-agent/src/vla/vla-controller.ts` | Wire real callbacks |
| `robot-agent/src/robot/SimulationEngine.ts` | Disable when `ROBOT_TYPE=so101` + real hardware detected |

## Test Strategy

1. `npm run dev:so101` — agent starts, connects to arm
2. `curl http://localhost:41245/api/v1/health` → `{ status: "ok" }`
3. `curl http://localhost:41245/api/v1/robots/so101-igor-001/telemetry` → real joint positions (not simulated)
4. Send command via A2A → arm physically moves
5. Emergency stop → servos lose torque immediately
