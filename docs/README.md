# NeoDEM

NeoDEM is a fleet management platform for autonomous robots. It handles robot registration, telemetry, AI-driven task execution, VLA (Vision-Language-Action) model inference, and EU AI Act compliance logging. The current deployment runs a single SO-101 robot arm on a Raspberry Pi 5.

## System Requirements

- Raspberry Pi 5 (8 GB) or x86 Linux machine
- Node.js 22+
- Python 3.11+ with `uv` package manager
- SO-101 robot arm on `/dev/ttyACM0` (for hardware mode)
- IMX477 camera (front, CSI cam 0) + OV5647 camera (wrist, CSI cam 1)
- Mac with Apple Silicon for SmolVLA inference (or NVIDIA GPU for GR00T)

## Services

| Service | Port | Description |
|---------|------|-------------|
| App | `http://localhost:1420` | React + Tauri frontend |
| Server | `http://localhost:3001` | Node.js API server (Express, Prisma, SQLite) |
| Robot Agent | `http://localhost:41245` | A2A agent for SO-101 |
| Hardware Sidecar | `http://localhost:8765` | Python bridge to SO-101 arm |
| VLA Server | `http://<mac-ip>:8000` | SmolVLA / GR00T inference (FastAPI) |

## Quick Start (systemd)

All services are configured as systemd units on the Pi:

```bash
# Start all
sudo systemctl start neodem-server neodem-app so101-sidecar neodem-agent

# Check status
sudo systemctl status neodem-server neodem-app so101-sidecar neodem-agent

# View logs
journalctl -u neodem-agent -f
```

Boot order: `neodem-server` -> `so101-sidecar` -> `neodem-agent`. The app has no dependencies.

## Quick Start (manual dev)

```bash
# Terminal 1: Server
cd server && npm run dev

# Terminal 2: Sidecar (needs uv + Python env)
uv run python robot-agent/hardware/so101_sidecar.py

# Terminal 3: Robot Agent (SO-101 profile)
cd robot-agent && npm run dev:so101

# Terminal 4: Frontend
cd app && npm run dev

# Terminal 5: VLA Server (on Mac)
cd vla-server && uv run python server.py
```

## Environment Files

Each component needs a `.env` file. Copy from examples:

```bash
cp server/.env.example server/.env          # Set DATABASE_URL, JWT_SECRET
cp robot-agent/.env.example robot-agent/.env # Set GEMINI_API_KEY
```

The robot agent uses `.env.so101` for SO-101 configuration (port 41245, robot type, VLA settings).

## Screenshots

### Fleet Dashboard
![Fleet Dashboard](screenshots/dashboard.png)

### Robot Fleet
![Robot Fleet](screenshots/robots.png)

### H1 Robot Detail
![Robot Detail](screenshots/robot-h1-detail.png)

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](architecture.md) | Services, data flow, infrastructure |
| [API Reference](api.md) | HTTP endpoints for all services |
| [VLA Integration](vla-integration-guide.md) | VLA models, camera setup, inference pipeline |
| [Robot Integration](robot-integration-guide.md) | SO-101 setup, calibration, sidecar |
| [Dev Workflow](dev-workflow.md) | Code conventions, feature structure |
| [App Architecture](app-architecture.md) | Frontend patterns, Zustand, routes |
| [Brand Guide](brand.md) | Colors, typography, design tokens |
| [Deployment](deployment.md) | Kubernetes / Helm deployment |
