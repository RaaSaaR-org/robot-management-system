# NeoDEM — The Open Physical AI Platform

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green?logo=node.js)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![EU AI Act Ready](https://img.shields.io/badge/EU%20AI%20Act-Ready-green)](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
[![LeRobot Compatible](https://img.shields.io/badge/LeRobot-Compatible-orange?logo=huggingface)](https://github.com/huggingface/lerobot)
[![HuggingFace Hub](https://img.shields.io/badge/HuggingFace-Hub-yellow?logo=huggingface)](https://huggingface.co/)

The Open Physical AI Platform — the complete lifecycle from first demonstration to compliant production.
**Collect → Train → Deploy → Evaluate → Operate → Comply** — open source.

[Getting Started](#quick-start) | [Documentation](#documentation) | [Architecture](#architecture) | [Contributing](#contributing)

</div>

---

## Live Demo

> **[Open Live Demo](https://raasaar-org.github.io/robot-management-system/)** — Fully interactive demo with simulated H1 humanoid fleet (no backend required)

[![Check](https://github.com/RaaSaaR-org/robot-management-system/actions/workflows/check.yml/badge.svg)](https://github.com/RaaSaaR-org/robot-management-system/actions/workflows/check.yml)
[![Deploy Demo to GitHub Pages](https://github.com/RaaSaaR-org/robot-management-system/actions/workflows/deploy-demo.yml/badge.svg)](https://github.com/RaaSaaR-org/robot-management-system/actions/workflows/deploy-demo.yml)

---

## What is NeoDEM?

NeoDEM is the first open-source platform covering the complete Physical AI pipeline — from recording human demonstrations to deploying trained VLA models in compliant production. No other open-source tool covers the full lifecycle.

**The problem:** Today's Physical AI tooling is fragmented. LeRobot handles training (CLI-only). Physical Intelligence builds models (closed-source). NVIDIA Isaac simulates (cloud-only). No single platform connects it all — and none are EU AI Act compliant.

**The solution:** NeoDEM is the integrating layer. A web-based, hardware-agnostic platform that covers the six stages of the Physical AI lifecycle:

| Stage | What you get |
|-------|-------------|
| 🎮 **Collect** | Record demonstrations via teleoperation, kinesthetic teaching, or VR. LeRobotDataset format, HuggingFace Hub sync. |
| 🧠 **Train** | Fine-tune VLA models (Pi0, ACT, Diffusion Policy, OpenVLA) with one click. Local or cloud GPU. |
| 🚀 **Deploy** | Model Registry, canary rollouts, A/B testing, auto-rollback. Know exactly what runs on which robot. |
| 📊 **Evaluate** | Real-world success rate tracking, episode replay, error analysis, model comparison. |
| 🤖 **Operate** | Fleet dashboard, natural language control via A2A Protocol, real-time telemetry, safety controls. |
| ✅ **Comply** | EU AI Act compliance logging, decision audit trails, risk assessment — ready for August 2026. |

Whether you're running a single SO-101 arm or a warehouse of humanoids, NeoDEM gives you one unified interface to manage the entire Physical AI lifecycle.

---

## Architecture

```
                                    NeoDEM Platform
    ┌─────────────────────────────────────────────────────────────────────────┐
    │                                                                         │
    │   ┌─────────────┐        ┌─────────────┐        ┌─────────────┐        │
    │   │             │  REST  │             │  A2A   │             │        │
    │   │     App     │◄──────►│   Server    │◄──────►│ Robot Agent │        │
    │   │  React/Tauri│   WS   │   Node.js   │Protocol│  Genkit AI  │        │
    │   │             │        │             │        │             │        │
    │   └─────────────┘        └──────┬──────┘        └──────┬──────┘        │
    │         :1420                   │                      │               │
    │                                 │                      │ HTTP          │
    │                                 ▼                      ▼               │
    │                          ┌─────────────┐        ┌─────────────┐        │
    │                          │ PostgreSQL  │        │     VLA     │        │
    │                          │             │        │   Server    │        │
    │                          │             │        │   FastAPI   │        │
    │                          └─────────────┘        └─────────────┘        │
    │                               :5432                  :8000             │
    │                                                                         │
    │   ─────────────────────────────────────────────────────────────────    │
    │   Infrastructure:  NATS :4222  │  RustFS :9000  │  Prometheus :9090    │
    └─────────────────────────────────────────────────────────────────────────┘
```

| Component         | Tech Stack        | Port  | Description                                |
| ----------------- | ----------------- | ----- | ------------------------------------------ |
| **App**           | React + Tauri     | 1420  | Desktop/web dashboard for Physical AI ops  |
| **Server**        | Node.js + Express | 3001  | A2A protocol server, REST API, WebSocket   |
| **Robot Agent**   | Node.js + Genkit  | 41243 | AI-powered robot control software          |
| **VLA Server**    | Python + FastAPI   | 8000  | Vision-Language-Action model serving       |

## Platform Overview

NeoDEM covers the complete **Collect → Train → Deploy → Evaluate → Operate → Comply** lifecycle:

```
        ┌─────────────────────────────────────────────────────────────┐
        │                    NeoDEM Platform                                   │
        │                                                                      │
        │  Collect        Train         Deploy        Evaluate                 │
        │  ───────        ─────         ──────        ────────                 │
        │  Teleoperation  Training UI   Model         Success Rate             │
        │  Kinesthetic    Orchestration Registry      Episode Replay           │
        │  VR Control     Fine-Tune     Canary        Error Analysis           │
        │  Dataset Hub    Fine-Tune     Rollout       A/B Testing              │
        │                                                                      │
        │  Operate                          Comply                             │
        │  ───────                          ──────                             │
        │  Fleet Dashboard · NL Control     EU AI Act Logging · Audit Trail    │
        │  Safety · Telemetry               Risk Assessment · GDPR             │
        └─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.11+ (for VLA inference)
- Docker & Docker Compose
- PostgreSQL (or use Docker)

### 1. Start Infrastructure

```bash
docker-compose up -d postgres nats rustfs
```

### 2. Start the Server

```bash
cd server
npm install
npx prisma migrate dev
npm run dev
```

### 3. Start a Robot Agent (Simulation)

```bash
cd robot-agent
npm install
cp .env.example .env  # Add your GEMINI_API_KEY
npm run dev
```

### 4. Start the Frontend

```bash
cd app
npm install
npm run dev
```

Open http://localhost:1420 to access the dashboard.

### 5. (Optional) Start VLA Inference Server

```bash
cd vla-inference
make install
make proto
make run
```

---

## Features

### Operate — Fleet Operations

| Feature         | Description                                             |
| --------------- | ------------------------------------------------------- |
| Fleet Dashboard | Real-time overview of all robots with status indicators |
| Live Telemetry  | Battery, position, sensor data streamed via WebSocket   |
| Task Management | Create, monitor, and cancel robot tasks                 |
| Safety Controls | Emergency stop, exclusion zones, protective stops       |

### VLA Model Training

| Feature            | Description                                          |
| ------------------ | ---------------------------------------------------- |
| Dataset Management | Upload and curate training demonstrations            |
| Training Jobs      | Fine-tune VLA models, track jobs in Prisma |
| Skill Library      | Reusable skills learned from demonstrations          |
| Active Learning    | Intelligent sample selection for efficient training  |

### Data Flywheel

| Feature            | Description                                     |
| ------------------ | ----------------------------------------------- |
| Teleoperation      | Record demonstrations via VR or keyboard        |
| Data Contribution  | Robots contribute successful task completions   |
| Federated Learning | Privacy-preserving fleet-wide model improvement |
| Synthetic Data     | Augmentation and sim-to-real transfer           |

### EU AI Act Compliance

| Feature            | Description                                     |
| ------------------ | ----------------------------------------------- |
| Compliance Logging | Tamper-evident audit trail (Art. 12)            |
| Explainability     | AI decision transparency with reasoning chains  |
| RoPA Management    | Records of Processing Activities (GDPR Art. 30) |
| Technical Docs     | Per AI Act Annex IV, MR Annex IV, CRA Annex V   |

### Multi-Tenancy (Optional)

Serve multiple customer organizations from a single NeoDEM deployment with row-level
data isolation — each organization sees only its own robots, datasets, and training
jobs while sharing the same server and UI. **Off by default** (zero overhead for
single-customer pilots); flip a feature flag to turn it on:

```bash
# server/.env
MULTI_TENANCY_ENABLED=true
```

| Feature            | Description                                     |
| ------------------ | ----------------------------------------------- |
| Organizations UI   | Dedicated admin page to create + manage customer tenants |
| Tenant Badge       | TopBar pill always shows the current organization |
| One-Click Sample   | "Load sample (Acme Robotics)" button for live demos |
| Isolation Boundary | Per-tenant stat tiles (Users / Robots / Datasets / Jobs) show the data boundary visually |
| Seamless Fallback  | When the flag is off, no UI changes — identical to single-tenant mode |

Same pattern as NATS + RustFS: opt-in, gracefully disabled when the flag is off, zero
migration headache if you decide not to use it. Full technical details — architecture,
how to add more tenant-scoped models, the `runAsPlatform` escape hatch, troubleshooting
— in [`docs/multi-tenancy.md`](docs/multi-tenancy.md).

---

## Screenshots

![Dashboard](docs/screenshots/dashboard.png)
*Fleet dashboard with real-time robot status, telemetry, and task management.*

![VLA Training](docs/screenshots/vla-training.png)
*VLA model training interface with dataset management and experiment tracking.*

---

## VLA Models

NeoDEM supports multiple Vision-Language-Action model architectures:

| Model           | Parameters | Inference Speed | Best For                      |
| --------------- | ---------- | --------------- | ----------------------------- |
| **pi0** (pi0.6) | 3B + 300M  | 50 Hz           | Real-time control, production |
| **OpenVLA**     | 7B         | 4-71 Hz         | High accuracy, research       |
| **GR00T**       | 2B+        | 23-26 Hz        | NVIDIA ecosystem              |

See [`docs/VLA-integration-guide.md`](docs/VLA-integration-guide.md) for detailed integration guidance.

---

## Deployment

### Docker Compose (Development)

```bash
docker-compose up -d
```

### Kubernetes (Production)

Container images are published to GitHub Container Registry:

```
ghcr.io/neodem/app
ghcr.io/neodem/server
ghcr.io/neodem/robot-agent
ghcr.io/neodem/vla-inference
```

Deploy with Helm:

```bash
# Development
helm install neodem ./helm/neodem \
  --set postgres.auth.password=yourpassword \
  --set secrets.jwtSecret=yourjwtsecret

# Production (with autoscaling, network policies, PDBs)
helm install neodem ./helm/neodem \
  -f ./helm/neodem/values-production.yaml \
  --set postgres.auth.password=$DB_PASSWORD \
  --set secrets.jwtSecret=$JWT_SECRET \
  --set secrets.geminiApiKey=$GEMINI_API_KEY
```

Production features:

- HorizontalPodAutoscalers (server: 2-10, app: 2-5 replicas)
- PodDisruptionBudgets for zero-downtime upgrades
- NetworkPolicies for pod-to-pod security
- ReadOnlyRootFilesystem with tmpfs mounts

---

## Project Structure

```
neodem/
├── app/                    # React + Tauri frontend
│   ├── src/features/       # Feature modules (robots, training, compliance...)
│   └── AGENTS.md           # Frontend development guide
├── server/                 # Node.js A2A server
│   ├── src/services/       # Business logic (Training, Deployment...)
│   ├── prisma/             # Database schema
│   └── AGENTS.md           # Server development guide
├── robot-agent/            # Robot control software
│   ├── src/tools/          # Genkit AI tools (navigation, manipulation...)
│   ├── src/vla/            # VLA inference client
│   └── AGENTS.md           # Robot agent development guide
├── vla-inference/          # Python VLA model server
│   ├── models/             # Model implementations (pi0, openvla, groot)
│   └── README.md           # VLA server documentation
├── protos/                 # Protocol Buffer definitions
├── helm/neodem/          # Kubernetes Helm chart
├── docs/                   # Documentation
└── CLAUDE.md               # AI assistant guidance
```

---

## Development

### Code Style

- TypeScript with strict mode
- Named exports (no default exports)
- JSDoc file headers with `@file`, `@description`, `@feature`

### Commands

| Component     | Dev           | Build           | Type Check          |
| ------------- | ------------- | --------------- | ------------------- |
| App           | `npm run dev` | `npm run build` | `npx tsc`           |
| Server        | `npm run dev` | `npm run build` | `npm run typecheck` |
| Robot Agent   | `npm run dev` | `npm run build` | `npm run typecheck` |
| VLA Inference | `make run`    | `docker build`  | `mypy`              |

---

## Documentation

| Document                                                         | Description                   |
| ---------------------------------------------------------------- | ----------------------------- |
| [`docs/architecture.md`](docs/architecture.md)                   | System architecture deep-dive |
| [`docs/VLA-integration-guide.md`](docs/VLA-integration-guide.md) | VLA model integration         |
| [`docs/multi-tenancy.md`](docs/multi-tenancy.md)                 | Row-level multi-tenancy (flag, isolation, Organizations UI) |
| [`docs/deployment.md`](docs/deployment.md)                       | Kubernetes deployment guide   |
| [`docs/brand.md`](docs/brand.md)                                 | Design system and theming     |
| [`CLAUDE.md`](CLAUDE.md)                                         | AI assistant guidance         |

---

## Contributing

We welcome contributions of all kinds! Here's how to get started:

1. **Fork the repository** and clone it locally
2. **Pick an issue** — look for [`good first issue`](https://github.com/RaaSaaR-org/robot-management-system/labels/good%20first%20issue) labels
3. **Read the relevant `AGENTS.md`** for the component you're working on (`app/`, `server/`, or `robot-agent/`)
4. **Create a feature branch** from `main`
5. **Follow the code style** — TypeScript strict mode, named exports, JSDoc headers
6. **Submit a PR** with a clear description of what changed and why

### Development Setup

```bash
git clone https://github.com/RaaSaaR-org/robot-management-system.git
cd robot-management-system
```

Then follow the [Quick Start](#quick-start) instructions above.

### Code of Conduct

Please be respectful and constructive in all interactions. We are committed to providing a welcoming and inclusive experience for everyone.

---

<div align="center">

**NeoDEM** — The Open Physical AI Platform

MIT License | Copyright (c) 2025 NeoDEM Contributors

</div>
