# RoboMindOS

A fleet management platform for humanoid robots with Vision-Language-Action (VLA) model training, deployment, and EU AI Act compliance.

## Overview

RoboMindOS enables operators to manage, monitor, and control humanoid robot fleets through an intuitive interface. The platform supports:

- **Natural Language Commands** - Control robots with instructions like "Pick up the red cup"
- **VLA Model Training** - Fine-tune vision-language-action models on your robot's data
- **Fleet-Wide Deployment** - Train once, deploy skills across your entire fleet
- **EU AI Act Compliance** - Built-in audit logging, explainability, and documentation

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RoboMindOS                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐        │
│  │     App      │ ◄─────► │    Server    │ ◄─────► │ Robot Agent  │        │
│  │  (React +    │  REST/  │  (Node.js)   │   A2A   │  (Genkit AI) │        │
│  │   Tauri)     │   WS    │              │         │              │        │
│  └──────────────┘         └──────┬───────┘         └──────┬───────┘        │
│                                  │                        │                 │
│                                  ▼                        ▼ gRPC            │
│                           ┌──────────────┐         ┌──────────────┐        │
│                           │  PostgreSQL  │         │VLA Inference │        │
│                           │   + MLflow   │         │   (Python)   │        │
│                           └──────────────┘         └──────────────┘        │
│                                                                              │
│  Infrastructure: NATS │ RustFS │ Prometheus                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Component          | Description                           | Port  |
|--------------------|---------------------------------------|-------|
| **App**            | React + Tauri desktop application     | 1420  |
| **Server**         | Node.js A2A protocol server           | 3001  |
| **Robot Agent**    | AI-powered robot control software     | 41243 |
| **VLA Inference**  | Python gRPC server for VLA models     | 50051 |

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

## Features

### Robot Fleet Management
- **Fleet Dashboard** - Real-time overview of all robots
- **Live Telemetry** - Battery, position, sensor data via WebSocket
- **Task Management** - Create, monitor, and cancel robot tasks
- **Safety Controls** - Emergency stop, exclusion zones

### VLA Model Training
- **Dataset Management** - Upload and curate training demonstrations
- **Training Jobs** - Fine-tune VLA models with MLflow tracking
- **Skill Library** - Reusable skills learned from demonstrations
- **Active Learning** - Intelligent sample selection

### Data Flywheel
- **Teleoperation** - Record demonstrations via VR or keyboard
- **Data Contribution** - Robots contribute successful completions
- **Federated Learning** - Privacy-preserving fleet-wide improvement
- **Synthetic Data** - Augmentation and sim-to-real transfer

### EU AI Act Compliance
- **Compliance Logging** - Tamper-evident audit trail
- **Explainability** - AI decision transparency and reasoning
- **RoPA Management** - Records of Processing Activities
- **Technical Documentation** - Per AI Act Annex IV

## Deployment

### Docker Compose (Local)

```bash
docker-compose up -d
```

### Kubernetes (Helm)

Container images are published to GitHub Container Registry:

- `ghcr.io/raasaar-org/robomind-app`
- `ghcr.io/raasaar-org/robomind-server`
- `ghcr.io/raasaar-org/robomind-robot-agent`
- `ghcr.io/raasaar-org/robomind-vla-inference`

Deploy with Helm:

```bash
# Local/development
helm install robomind ./helm/robomind -f ./helm/robomind/values-local.yaml \
  --set postgres.auth.password=yourpassword \
  --set secrets.jwtSecret=yourjwtsecret

# Production
helm install robomind ./helm/robomind -f ./helm/robomind/values-production.yaml \
  --set postgres.auth.password=$DB_PASSWORD \
  --set secrets.jwtSecret=$JWT_SECRET \
  --set secrets.googleApiKey=$GOOGLE_API_KEY \
  --set secrets.geminiApiKey=$GEMINI_API_KEY
```

## Project Structure

```
robot-management-system/
├── app/                 # React + Tauri frontend
├── server/              # Node.js A2A server
├── robot-agent/         # Robot control software
├── vla-inference/       # Python VLA model server
├── protos/              # Protocol Buffer definitions
├── helm/robomind/       # Kubernetes Helm chart
├── config/              # Configuration files
└── docs/                # Documentation
```

## VLA Models

RoboMindOS supports multiple Vision-Language-Action model architectures:

| Model | Parameters | Speed | License |
|-------|-----------|-------|---------|
| **π0.6** (pi0) | 3B + 300M | 50 Hz | Apache 2.0 |
| **OpenVLA** | 7B | 4-71 Hz | Llama Community |
| **GR00T** | 2B+ | 23-26 Hz | Contact NVIDIA |

See `docs/VLA-integration-guide.md` for detailed integration guidance.

## Documentation

| Document | Description |
|----------|-------------|
| `docs/architecture.md` | System architecture |
| `docs/VLA-integration-guide.md` | VLA model integration |
| `docs/deployment.md` | Kubernetes deployment |
| `docs/prd.md` | Product requirements |
| `docs/brand.md` | Design system |
| `CLAUDE.md` | AI assistant guidance |

### Component Guides

| Guide | Description |
|-------|-------------|
| `app/AGENTS.md` | Frontend development |
| `server/AGENTS.md` | Server development |
| `robot-agent/AGENTS.md` | Robot agent development |
| `vla-inference/README.md` | VLA inference server |

## Development

### Code Style

- TypeScript with strict mode
- Named exports (no default exports)
- JSDoc file headers with `@file`, `@description`, `@feature`

### Commands

| Component | Dev | Build | Type Check |
|-----------|-----|-------|------------|
| App | `npm run dev` | `npm run build` | `npx tsc` |
| Server | `npm run dev` | `npm run build` | `npm run typecheck` |
| Robot Agent | `npm run dev` | `npm run build` | `npm run typecheck` |
| VLA Inference | `make run` | `docker build` | - |

### Task Management

```bash
npx task-master list     # List all tasks
npx task-master next     # Get next task
npx task-master show 1   # Show task details
```

## Contributing

1. Check `.taskmaster/tasks/tasks.json` for open tasks
2. Read the relevant `AGENTS.md` for the component
3. Follow the code style guidelines
4. Submit a PR with a clear description

## License

MIT
