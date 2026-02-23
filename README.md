# NeoDEM — Robot Fleet Management Platform

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green?logo=node.js)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A2A-protocol fleet management for humanoid robots — with VLA model training,
EU AI Act compliance, and natural language control.

[Getting Started](#quick-start) | [Documentation](#documentation) | [Architecture](#architecture) | [Contributing](#contributing)

</div>

---

## What is NeoDEM?

NeoDEM is an open-source platform for managing fleets of autonomous robots. It connects a React/Tauri dashboard, a Node.js server, and AI-powered robot agents via the A2A (Agent-to-Agent) protocol — enabling operators to issue natural language commands, train and deploy Vision-Language-Action models, and maintain full EU AI Act compliance. Whether you're running a single robot arm or a warehouse full of humanoids, NeoDEM gives you one unified interface to monitor, control, and improve your fleet.

---

## Architecture

```
                                    NeoDEM: RoboMindOS
    ┌─────────────────────────────────────────────────────────────────────────┐
    │                                                                         │
    │   ┌─────────────┐        ┌─────────────┐        ┌─────────────┐        │
    │   │             │  REST  │             │  A2A   │             │        │
    │   │     App     │◄──────►│   Server    │◄──────►│ Robot Agent │        │
    │   │  React/Tauri│   WS   │   Node.js   │Protocol│  Genkit AI  │        │
    │   │             │        │             │        │             │        │
    │   └─────────────┘        └──────┬──────┘        └──────┬──────┘        │
    │         :1420                   │                      │               │
    │                                 │                      │ gRPC          │
    │                                 ▼                      ▼               │
    │                          ┌─────────────┐        ┌─────────────┐        │
    │                          │ PostgreSQL  │        │     VLA     │        │
    │                          │  + MLflow   │        │  Inference  │        │
    │                          │             │        │   Python    │        │
    │                          └─────────────┘        └─────────────┘        │
    │                               :5432                  :50051            │
    │                                                                         │
    │   ─────────────────────────────────────────────────────────────────    │
    │   Infrastructure:  NATS :4222  │  RustFS :9000  │  Prometheus :9090    │
    └─────────────────────────────────────────────────────────────────────────┘
```

| Component         | Tech Stack        | Port  | Description                                |
| ----------------- | ----------------- | ----- | ------------------------------------------ |
| **App**           | React + Tauri     | 1420  | Desktop/web dashboard for fleet management |
| **Server**        | Node.js + Express | 3001  | A2A protocol server, REST API, WebSocket   |
| **Robot Agent**   | Node.js + Genkit  | 41243 | AI-powered robot control software          |
| **VLA Inference** | Python + gRPC     | 50051 | Vision-Language-Action model serving       |

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

### Robot Fleet Management

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
| Training Jobs      | Fine-tune VLA models with MLflow experiment tracking |
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
helm install neodem ./helm/robomind \
  --set postgres.auth.password=yourpassword \
  --set secrets.jwtSecret=yourjwtsecret

# Production (with autoscaling, network policies, PDBs)
helm install neodem ./helm/robomind \
  -f ./helm/robomind/values-production.yaml \
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
│   ├── src/services/       # Business logic (Training, Deployment, MLflow...)
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
├── helm/robomind/          # Kubernetes Helm chart
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

**NeoDEM** — Open-source fleet management for autonomous robots

MIT License | Copyright (c) 2025 NeoDEM Contributors

</div>
