# System Architecture

NeoDEM is a distributed system with five services. In development, all run on a Raspberry Pi 5 except the VLA inference server, which runs on a separate machine with GPU/MPS.

```
┌─────────────┐     REST/WS      ┌─────────────┐      A2A        ┌──────────────┐
│     App      │◄───────────────►│   Server     │◄──────────────►│ Robot Agent   │
│  React/Tauri │                 │  Express     │                │  Genkit AI    │
│    :1420     │                 │    :3001     │                │    :41245     │
└─────────────┘                  └──────┬───────┘                └──────┬───────┘
                                        │                               │
                                        ▼                               ▼
                                 ┌─────────────┐                ┌──────────────┐
                                 │   SQLite     │                │   Sidecar    │
                                 │  (Prisma)    │                │  Python HTTP │
                                 │  dev.db      │                │    :8765     │
                                 └─────────────┘                └──────┬───────┘
                                                                       │
                                                             ┌─────────┴─────────┐
                                                             │                   │
                                                        ┌────▼────┐       ┌──────▼──────┐
                                                        │ SO-101  │       │ VLA Server  │
                                                        │/dev/tty │       │    :8000    │
                                                        │ ACM0    │       │  (remote)   │
                                                        └─────────┘       └─────────────┘
```

## Services

### App (Frontend)

| | |
|---|---|
| Location | `app/` |
| Stack | React 18, TypeScript, Tailwind CSS, Zustand, Vite |
| Port | 1420 |
| Wrapper | Tauri 2.0 (desktop) |

Feature-first organization: `app/src/features/{name}/`. 21 feature modules including fleet dashboard, robot management, VLA training, A2A chat, compliance logging, and GDPR self-service.

### Server (Backend)

| | |
|---|---|
| Location | `server/` |
| Stack | Node.js, Express, Prisma ORM, TypeScript |
| Port | 3001 |
| Database | SQLite (dev: `server/prisma/dev.db`), PostgreSQL (production) |
| Auth | JWT with MFA (TOTP). Disabled in dev via `AUTH_DISABLED=true` |

Architecture: Routes -> Services -> Repositories. 37 route files, 45 services, 18 repositories, 73 Prisma models.

Key endpoints:
- `GET /health` — health check
- `GET /.well-known/a2a/agent_card.json` — A2A discovery
- `/api/auth/*` — authentication (register, login, MFA)
- `/api/robots/*` — robot management
- `/api/a2a/*` — A2A conversations, messages, tasks
- `/api/training/*` — VLA training jobs
- `/api/datasets/*` — dataset management
- `/api/deployments/*` — VLA model deployment
- `ws://localhost:3001/api/a2a/ws` — WebSocket for real-time events

See [api.md](api.md) for the full endpoint list.

### Robot Agent

| | |
|---|---|
| Location | `robot-agent/` |
| Stack | Node.js, Genkit (Gemini 2.5 Flash), A2A SDK |
| Port | 41245 (SO-101 profile) |
| Config | `.env.so101` |

AI-powered agent that interprets natural language commands, manages robot state, and orchestrates VLA inference. Persists state to `robot-agent/data/state.json` on shutdown.

Key endpoints:
- `GET /.well-known/agent-card.json` — A2A agent card
- `/api/v1/robots/:id/*` — telemetry, commands, tasks, safety, VLA control
- `/api/v1/health` — health check
- `ws://localhost:41245/ws/telemetry/:robotId` — telemetry stream
- `ws://localhost:41245/ws/bilateral-teleop` — ALOHA-style teleoperation

### Hardware Sidecar

| | |
|---|---|
| Location | `robot-agent/hardware/so101_sidecar.py` |
| Stack | Python, BaseHTTPRequestHandler |
| Port | 8765 |

Lightweight HTTP bridge between the Node.js agent and the SO-101 arm hardware. Manages serial port access with on-demand connection and 5-second idle timeout (releases `/dev/ttyACM0` for other tools like LeRobot CLI).

Key endpoints:
- `GET /health` — connection status
- `GET /state` — current joint positions
- `POST /action` — send joint commands
- `POST /vla/start` — start VLA control loop
- `POST /vla/stop` — stop VLA control
- `GET /vla/status` — VLA runner status
- `GET /safety/status` — safety metrics

### VLA Server (Inference)

| | |
|---|---|
| Location | `vla-server/` |
| Stack | Python, FastAPI, Uvicorn |
| Port | 8000 |
| Models | SmolVLA (active), GR00T N1 (ZMQ), pi0.5 (stub) |

Runs on a separate machine (Mac with Apple Silicon for SmolVLA, or NVIDIA GPU for GR00T). Provides a unified HTTP inference API for multiple VLA model backends.

Key endpoints:
- `GET /health` — model load status
- `GET /config` — model metadata (action_dim, cameras, chunk_size)
- `POST /predict` — run inference (images + state + instruction -> actions)
- `POST /reset` — reset model state between episodes

## Fleet Map

![Fleet Map](screenshots/fleet-map.png)

## Communication Protocols

| Path | Protocol | Purpose |
|------|----------|---------|
| App <-> Server | REST + WebSocket | UI operations, real-time telemetry |
| Server <-> Agent | A2A (HTTP) | Task distribution, commands |
| Agent <-> Sidecar | HTTP | Hardware control, VLA orchestration |
| Sidecar <-> SO-101 | Serial (LeRobot) | Joint commands via `/dev/ttyACM0` |
| Sidecar <-> VLA Server | HTTP | Inference requests (POST /predict) |
| VLA Server <-> GR00T | ZMQ (port 5555) | GR00T N1 model inference |

## Hardware

### SO-101 Robot Arm
- 6 DOF: shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper
- Serial port: `/dev/ttyACM0`
- Power: AC (no battery, `batteryLevel: null`)
- Max payload: 0.5 kg

### Cameras
- **Front camera** (cam 0): IMX477 (CSI), used for VLA inference
- **Wrist camera** (cam 1): OV5647 (CSI), optional for VLA inference
- Capture: 640x480, resized to 224x224 for inference

## Database

SQLite for development (`server/prisma/dev.db`), PostgreSQL for production. Prisma ORM with 73 models. Array fields stored as JSON strings in SQLite.

```bash
cd server
npm run db:generate   # Generate Prisma client
npm run db:push       # Push schema to dev database
npm run db:migrate    # Run migrations (production)
npm run db:studio     # Open Prisma Studio GUI
```

## Systemd Services

All four services run as systemd units on the Raspberry Pi:

| Unit | Working Directory | After |
|------|-------------------|-------|
| `robomind-server` | `server/` | network.target |
| `robomind-app` | `app/` | network.target |
| `so101-sidecar` | — | — |
| `robomind-agent` | `robot-agent/` | robomind-server, so101-sidecar |

```bash
sudo systemctl status robomind-server robomind-agent robomind-app so101-sidecar
journalctl -u robomind-agent -f --no-pager
```

## Optional Infrastructure

These are configured but not required for local development:

| Service | Purpose | Status |
|---------|---------|--------|
| NATS (4222) | Async job queues, KV stores | Optional, logs warning if unavailable |
| RustFS/S3 (9000) | Object storage for models/datasets | Optional |
| MLflow (5000) | Experiment tracking, model registry | Optional |
