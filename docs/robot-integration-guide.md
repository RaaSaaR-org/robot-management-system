# Robot Integration Guide

This guide covers integrating physical robots with NeoDEM:

- **[SO-101](#so-101-overview)** — 6-DOF arm, serial sidecar. Production-tested.
- **[Unitree G1 EDU (Dex3-1)](#unitree-g1-edu-dex3-1)** — 43-DOF humanoid, DDS sidecar. ⚠️ hardware-pending — see TASK-169 (`.mc/tasks/todo/TASK-169-lab-bringup-unitree-g1-edu-hardware.md`) for the safety-staged lab bring-up.

The pattern is the same for both: a Python **hardware sidecar** exposes a small HTTP API that the Node.js robot agent talks to (`HARDWARE_SIDECAR_URL`); only the underlying driver differs (serial vs. Unitree DDS).

## SO-101 Overview

| | |
|---|---|
| Type | 6-DOF robot arm |
| Joints | shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper |
| Serial Port | `/dev/ttyACM0` |
| Power | AC powered (`batteryLevel: null`) |
| Max Payload | 0.5 kg |
| Interface | LeRobot `SO101Follower` via Python |

## Hardware Setup

1. Connect the SO-101 arm via USB to the Raspberry Pi
2. Verify the serial port is available:
   ```bash
   ls /dev/ttyACM*
   # Should show /dev/ttyACM0
   ```
3. Ensure the user has permission to access the port:
   ```bash
   sudo usermod -a -G dialout $USER
   # Log out and back in
   ```

## Calibration

Calibration maps raw servo values to joint angles. Run this once per arm (or after mechanical changes):

```bash
lerobot-calibrate \
  --robot.type=so101_follower \
  --robot.id=my_so101 \
  --robot.port=/dev/ttyACM0
```

Follow the on-screen instructions to move each joint to its limits. The calibration file is saved to:

```
~/.cache/huggingface/lerobot/calibration/robots/so_follower/my_so101.json
```

The sidecar and VLA runner read this file automatically via LeRobot.

## Sidecar Service

The hardware sidecar (`robot-agent/hardware/so101_sidecar.py`) is a lightweight HTTP server on port 8765 that bridges the Node.js robot agent and the physical arm.

### Starting

```bash
# Via systemd (production)
sudo systemctl start so101-sidecar
sudo systemctl status so101-sidecar

# Manual (development)
uv run python robot-agent/hardware/so101_sidecar.py
```

### How It Works

- **On-demand connection**: The sidecar only opens the serial port when a request arrives. After 5 seconds of inactivity, it releases the port automatically.
- **Port sharing**: This allows other tools (LeRobot CLI, teleoperation scripts) to use `/dev/ttyACM0` when the dashboard isn't actively reading state.
- **VLA delegation**: When VLA is started via `POST /vla/start`, the sidecar spawns a `VLARunner` thread that takes over arm control. The sidecar's `POST /action` endpoint is disabled during VLA sessions.

### Key Endpoints

```bash
# Check connection
curl http://localhost:8765/health
# {"status": "ok", "connected": false, "port": "/dev/ttyACM0"}

# Read joint positions
curl http://localhost:8765/state
# {"joints": [{"name": "shoulder_pan", "position": 0.0, ...}, ...], "simulated": false}

# Send joint command (degrees)
curl -X POST http://localhost:8765/action \
  -H "Content-Type: application/json" \
  -d '{"shoulder_pan": 0, "shoulder_lift": 45, "elbow_flex": -30, "wrist_flex": 10, "wrist_roll": 0, "gripper": 50}'

# Release port for other tools
curl http://localhost:8765/disconnect
```

### Simulated Fallback

If the arm is not connected or the serial port is unavailable, `GET /state` returns simulated joint positions (`"simulated": true`). This allows the dashboard and agent to run without hardware.

## Robot Agent Configuration

The agent uses `.env.so101` for SO-101 specific settings:

```env
PORT=41245
ROBOT_ID=so101-igor-001
ROBOT_NAME=Igor
ROBOT_MODEL=SO-101
ROBOT_TYPE=so101
ROBOT_CLASS=lightweight
MAX_PAYLOAD_KG=0.5
VLA_ROBOT_PORT=/dev/ttyACM0
```

Start the agent with the SO-101 profile:

```bash
cd robot-agent
npm run dev:so101
```

Or via systemd:

```bash
sudo systemctl start neodem-agent
```

The systemd unit uses `--env-file=.env.so101` automatically.

## Unitree G1 EDU (Dex3-1)

> ⚠️ **Hardware-pending / untested.** The G1 sidecar is written to spec against
> lerobot's `unitree_g1` driver + Unitree SDK2 (DDS) but has **not** been run on a
> physical robot. The G1 is a **bipedal humanoid that must balance** — do not send
> raw position commands to a standing robot. Follow the staged, safety-first
> bring-up in **TASK-169** (`.mc/tasks/todo/TASK-169-lab-bringup-unitree-g1-edu-hardware.md`):
> install → read-only → teleop → sim → closed-loop AI. Keep the robot on a
> gantry/harness for any NeoDEM-driven motion.

### Overview

| | |
|---|---|
| Type | 43-DOF humanoid (29 G1 body + 2× Dex3-1 hands, 7 DOF each) |
| Embodiment tag | `unitree_g1_edu_dex3` |
| Action / proprio dims | 43 / 86 |
| Interface | LeRobot `unitree_g1` robot + teleoperator over Unitree DDS |
| Power | Battery |
| Configs | `robot-agent/src/embodiment/configs/g1_edu.yaml`, `src/robot/joint-configs/g1-edu.config.ts` |

### Sidecar Service

The G1 sidecar (`robot-agent/hardware/g1_sidecar.py`) mirrors the SO-101 HTTP
contract on **port 8767**, so the existing robot agent / SkillExecutor work
unchanged — only the driver differs (Unitree DDS instead of serial).

```bash
# Manual (development)
uv run python robot-agent/hardware/g1_sidecar.py
```

It talks to the robot over a DDS network interface (configure to match your unit):

```env
G1_ROBOT_IP=192.168.123.164   # G1 default
G1_NET_INTERFACE=eth0         # interface facing the robot
G1_SIDECAR_PORT=8767
G1_ROBOT_ID=my_g1_edu
```

### Key Endpoints

```bash
curl http://localhost:8767/health          # {"status":"ok","connected":true/false}
curl http://localhost:8767/state           # 43 joint positions
# /action, /record/start|stop|status — same shape as the SO-101 sidecar
```

### Robot Agent Configuration

The agent uses `.env.g1-edu`:

```env
PORT=41245
ROBOT_ID=sim-robot-g1-edu
ROBOT_MODEL=Unitree G1 EDU (Dex3-1)
ROBOT_TYPE=g1_edu
HARDWARE_SIDECAR_URL=http://localhost:8767
```

Start the agent with the G1 EDU profile (simulation by default):

```bash
cd robot-agent
npm run dev:g1-edu
```

## State Persistence

The agent saves robot state to `robot-agent/data/state.json` on shutdown (SIGTERM). On startup, it restores from this file. If the state file accumulates errors or stale data:

```bash
sudo systemctl stop neodem-agent
rm robot-agent/data/state.json
sudo systemctl start neodem-agent
```

## Adding a New Robot Type

To integrate a different robot (e.g., Unitree H1, Go2):

1. Add the type to `robot-agent/src/robot/types.ts` (`RobotType` union)
2. Create joint config in `robot-agent/src/robot/joint-configs/` (+ register in its `index.ts`)
3. Add telemetry simulation in `robot-agent/src/robot/telemetry.ts`
4. Copy URDF + meshes to `app/public/assets/robots/{type}/`
5. Add URDF path in `app/src/features/robots/components/visualization/RobotModel.tsx`
6. Keep `app/src/features/robots/types/robots.types.ts` in sync
7. Add an embodiment config + `.env.{type}` profile and `dev:{type}`/`start:{type}` scripts in `robot-agent/package.json`
8. Seed the robot type (action/proprio dims) in `server/src/scripts/seed-robot-types.ts`
9. For real hardware, add a sidecar (see `g1_sidecar.py`) exposing the standard sidecar HTTP contract

See the existing H1, SO-101, and **G1 EDU** implementations as reference (G1 EDU is the most complete recent example, steps 1–9).

## Known Issues

### wrist_roll Cable Problem

The wrist_roll joint cable can cause erratic position readings and jitter during VLA control. Workaround: limit wrist_roll range to +/-90 degrees in the safety validator or via `POST /safety/config`:

```bash
curl -X POST http://localhost:8765/safety/config \
  -H "Content-Type: application/json" \
  -d '{"max_delta_degrees": 5.0}'
```

### Serial Port Busy

If you get "port busy" errors, another process is holding `/dev/ttyACM0`. Check with:

```bash
fuser /dev/ttyACM0
```

Common causes: a previous sidecar process didn't shut down, or the LeRobot CLI is running. Kill the process or wait for the 5-second idle timeout.

### Agent State File Bloat

The state file (`robot-agent/data/state.json`) can accumulate error entries over time. If the agent behaves unexpectedly after restarts, delete the state file and restart.

### batteryLevel: null

The SO-101 is AC-powered. `batteryLevel` is `null` throughout the stack (database, API, frontend). This is intentional — the `??` operator was fixed to handle null correctly (not fall back to a default).
