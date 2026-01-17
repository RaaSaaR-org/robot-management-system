# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the RoboMindOS codebase.

## Project Overview

RoboMindOS is a distributed fleet management platform for humanoid robots with EU AI Act compliance features and Vision-Language-Action (VLA) model integration for skill learning and deployment.

| Component          | Location         | Description                          | Port  |
| ------------------ | ---------------- | ------------------------------------ | ----- |
| **App**            | `app/`           | React + Tauri frontend               | 1420  |
| **Server**         | `server/`        | Node.js A2A protocol server          | 3001  |
| **Robot Agent**    | `robot-agent/`   | AI-powered robot software            | 41243 |
| **VLA Inference**  | `vla-inference/` | Python gRPC VLA model server         | 50051 |

## Component-Specific Guidance

Each component has its own `AGENTS.md` file with detailed guidance:

- `app/AGENTS.md` - Frontend development patterns, Zustand stores, Tailwind
- `server/AGENTS.md` - Server routes, services, Prisma database
- `robot-agent/AGENTS.md` - Genkit tools, robot state, safety monitoring
- `vla-inference/README.md` - VLA model serving, gRPC API, metrics

**Always check the relevant AGENTS.md file when working in a specific component.**

## Quick Start Commands

### Start Components (Development)

```bash
# Terminal 1: Server
cd server && npm run dev

# Terminal 2: Robot Agent (simulation)
cd robot-agent && npm run dev

# Terminal 3: Frontend
cd app && npm run dev

# Terminal 4: VLA Inference (optional, requires Python)
cd vla-inference && make run
```

### Individual Component Commands

| Component        | Dev                               | Build           | Type Check          |
| ---------------- | --------------------------------- | --------------- | ------------------- |
| **App**          | `cd app && npm run dev`           | `npm run build` | `npx tsc`           |
| **Server**       | `cd server && npm run dev`        | `npm run build` | `npm run typecheck` |
| **Robot**        | `cd robot-agent && npm run dev`   | `npm run build` | `npm run typecheck` |
| **VLA Inference**| `cd vla-inference && make run`    | Docker build    | N/A (Python)        |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RoboMindOS Architecture                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐        │
│  │     App      │ ◄─────► │    Server    │ ◄─────► │ Robot Agent  │        │
│  │  (React +    │  REST/  │  (Node.js    │   A2A   │  (Genkit AI) │        │
│  │   Tauri)     │   WS    │   Express)   │ Protocol│              │        │
│  └──────────────┘         └──────┬───────┘         └──────┬───────┘        │
│                                  │                        │                 │
│                                  │                        │ gRPC            │
│                                  ▼                        ▼                 │
│                           ┌──────────────┐         ┌──────────────┐        │
│                           │  PostgreSQL  │         │VLA Inference │        │
│                           │   + MLflow   │         │   (Python)   │        │
│                           └──────────────┘         └──────────────┘        │
│                                                                              │
│  Infrastructure: NATS (messaging) │ RustFS (object storage) │ Prometheus   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Communication Protocols:**

- App ↔ Server: REST API + WebSocket (real-time telemetry)
- Server ↔ Robot Agent: A2A (Agent-to-Agent) protocol
- Robot Agent ↔ VLA Inference: gRPC (Predict, StreamControl)

**Database:**

- Prisma ORM with PostgreSQL (server/prisma/schema.prisma)
- Run migrations: `cd server && npx prisma migrate dev`

See `docs/architecture.md` for comprehensive system architecture.

## Directory Structure

```
robot-management-system/
├── app/                    # Frontend (React + Tauri)
│   ├── src/
│   │   ├── features/       # Feature modules
│   │   │   ├── compliance/   # EU AI Act compliance logging
│   │   │   ├── explainability/ # AI decision transparency
│   │   │   ├── robots/       # Robot management
│   │   │   ├── fleet/        # Fleet operations
│   │   │   ├── training/     # VLA model training UI
│   │   │   ├── deployment/   # Model deployment UI
│   │   │   ├── datacollection/ # Training data collection
│   │   │   ├── fleetlearning/  # Federated learning UI
│   │   │   ├── contributions/  # Data contribution tracking
│   │   │   ├── command/      # Natural language commands
│   │   │   ├── alerts/       # Alert system
│   │   │   └── safety/       # Safety monitoring
│   │   ├── shared/         # Shared components, hooks, utils
│   │   └── app/            # App shell, routing, providers
│   ├── src-tauri/          # Tauri (Rust) backend
│   └── AGENTS.md           # Frontend-specific guidance
│
├── server/                 # Backend (Node.js A2A Server)
│   ├── prisma/             # Database schema and migrations
│   ├── src/
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # Business logic
│   │   │   ├── TrainingOrchestrator.ts  # VLA training jobs
│   │   │   ├── DeploymentService.ts     # Model deployment
│   │   │   ├── DatasetService.ts        # Training datasets
│   │   │   ├── MLflowService.ts         # MLflow integration
│   │   │   ├── SkillLibraryService.ts   # Skill management
│   │   │   ├── FederatedLearningService.ts # Fleet learning
│   │   │   └── ...
│   │   ├── repositories/   # Database access layer
│   │   ├── types/          # TypeScript type definitions
│   │   ├── storage/        # Object storage (RustFS)
│   │   ├── messaging/      # NATS messaging
│   │   └── websocket/      # Real-time telemetry
│   └── AGENTS.md           # Server-specific guidance
│
├── robot-agent/            # Robot Software
│   ├── src/
│   │   ├── agent/          # A2A agent & Genkit AI
│   │   ├── robot/          # State, telemetry, types
│   │   ├── tools/          # AI tools (navigation, manipulation)
│   │   ├── vla/            # VLA inference client
│   │   ├── embodiment/     # Robot embodiment definitions
│   │   ├── safety/         # Safety monitoring & emergency stop
│   │   ├── compliance/     # Compliance logging client
│   │   └── api/            # REST & WebSocket
│   └── AGENTS.md           # Robot-specific guidance
│
├── vla-inference/          # VLA Model Server (Python)
│   ├── server.py           # Async gRPC server
│   ├── servicer.py         # gRPC service implementation
│   ├── config.py           # Configuration management
│   ├── metrics.py          # Prometheus metrics
│   ├── models/             # Model implementations
│   │   ├── pi0.py          # π0.6 model
│   │   ├── openvla.py      # OpenVLA 7B
│   │   └── groot.py        # GR00T (stub)
│   ├── Dockerfile          # Multi-stage build
│   └── README.md           # VLA server documentation
│
├── protos/                 # Protocol Buffer definitions
│   └── vla_inference.proto # VLA gRPC service definition
│
├── helm/robomind/          # Kubernetes Helm chart
│   ├── templates/
│   │   ├── app-deployment.yaml
│   │   ├── server-deployment.yaml
│   │   ├── robot-agent-deployment.yaml
│   │   ├── vla-inference-deployment.yaml
│   │   ├── postgres-statefulset.yaml
│   │   ├── mlflow-deployment.yaml
│   │   ├── nats-statefulset.yaml
│   │   └── rustfs-statefulset.yaml
│   └── values.yaml
│
├── config/                 # Configuration files
│   └── postgres-init/      # Database initialization
│
├── docs/                   # Documentation
│   ├── architecture.md     # System architecture
│   ├── VLA-integration-guide.md # VLA model integration
│   ├── deployment.md       # Deployment guide
│   ├── prd.md              # Product requirements
│   └── brand.md            # Design system
│
└── .taskmaster/            # Task management
    └── tasks/tasks.json    # Project tasks
```

## Key Features

### VLA Model Training & Deployment

- **Training Orchestrator**: Manage VLA fine-tuning jobs with MLflow tracking
- **Dataset Management**: Upload, curate, and version training data
- **Skill Library**: Reusable skills learned from demonstrations
- **Fleet Deployment**: Deploy trained models across robot fleets
- **Active Learning**: Intelligent sample selection for efficient training

### Data Flywheel

- **Teleoperation Recording**: Capture demonstrations via VR/keyboard
- **Data Contribution**: Robots contribute successful task completions
- **Federated Learning**: Privacy-preserving fleet-wide model improvement
- **Synthetic Data**: Augmentation and simulation-to-real transfer

### Compliance & Regulatory (EU AI Act)

- **Compliance Logging**: Tamper-evident audit trail (Art. 12)
- **Hash Chain Verification**: Cryptographic integrity verification
- **RoPA Management**: Records of Processing Activities (GDPR Art. 30)
- **Technical Documentation**: Per AI Act Annex IV, MR Annex IV, CRA Annex V
- **Retention Policies**: Configurable per event type (up to 10 years)

### AI Explainability

- **Decision Viewer**: Inspect AI decisions with reasoning
- **Confidence Metrics**: Model confidence and safety scores
- **Factor Analysis**: Input factors and their influence

### Safety Features

- **Safety Monitor**: Real-time safety classification
- **Emergency Stop**: Immediate robot halt capability
- **Protective Stop**: Automatic safety interventions

## Development Guidelines

### Code Style

- **TypeScript**: Strict mode, explicit types for public APIs
- **Python**: Type hints, docstrings (vla-inference)
- **Named exports**: No default exports
- **File headers**: Include `@file`, `@description`, `@feature` JSDoc

```typescript
/**
 * @file RobotCard.tsx
 * @description Card component displaying robot status
 * @feature robots
 */
```

### Feature Development Order

When building features across the stack:

1. **Types** - Define shared interfaces
2. **Proto** - Define gRPC messages (if VLA-related)
3. **Server** - API endpoints, services, database models
4. **VLA Inference** - Model integration (if applicable)
5. **Robot** - AI tools, VLA client integration
6. **Frontend** - Store, hooks, components, pages

### Key Patterns

| Component        | Pattern                 | Example                                               |
| ---------------- | ----------------------- | ----------------------------------------------------- |
| **App**          | Feature-first + Zustand | `features/robots/store/robotsStore.ts`                |
| **Server**       | Routes + Services       | `routes/robot.routes.ts` → `services/RobotManager.ts` |
| **Robot**        | Genkit Tools            | `tools/navigation.ts` with `ai.defineTool()`          |
| **VLA Inference**| Model Factory           | `models/__init__.py` → `create_model("pi0")`          |

## Key Dependencies

| Package               | Used In        | Purpose                    |
| --------------------- | -------------- | -------------------------- |
| `zustand`             | App            | State management           |
| `@tauri-apps/api`     | App            | Desktop APIs               |
| `express`             | Server, Robot  | HTTP server                |
| `prisma`              | Server         | Database ORM               |
| `ws`                  | Server, Robot  | WebSocket                  |
| `@a2a-js/sdk`         | Robot          | A2A protocol               |
| `genkit`              | Robot          | AI framework               |
| `@genkit-ai/googleai` | Robot          | Gemini integration         |
| `grpcio`              | VLA Inference  | gRPC server                |
| `prometheus-client`   | VLA Inference  | Metrics                    |

## Infrastructure

### Local Development

```bash
docker-compose up -d postgres nats rustfs
```

### Kubernetes (Helm)

```bash
# Local/development
helm install robomind ./helm/robomind -f ./helm/robomind/values-local.yaml

# Production
helm install robomind ./helm/robomind -f ./helm/robomind/values-production.yaml
```

### Services

| Service        | Purpose                              | Port  |
| -------------- | ------------------------------------ | ----- |
| PostgreSQL     | Primary database                     | 5432  |
| NATS           | Message queue                        | 4222  |
| RustFS         | Object storage (S3-compatible)       | 9000  |
| MLflow         | Experiment tracking                  | 5000  |
| Prometheus     | Metrics collection                   | 9090  |

## Task Management

Project tasks are tracked in `.taskmaster/tasks/tasks.json`. Use task-master CLI:

```bash
npx task-master list          # List all tasks
npx task-master next          # Get next task to work on
npx task-master show <id>     # Show task details
```

## Documentation

| Document                          | Description                       |
| --------------------------------- | --------------------------------- |
| `docs/architecture.md`            | Full system architecture          |
| `docs/VLA-integration-guide.md`   | VLA model integration guide       |
| `docs/deployment.md`              | Kubernetes deployment guide       |
| `docs/prd.md`                     | Product requirements              |
| `docs/brand.md`                   | Colors, typography, design tokens |

## Current Status

- **Database**: Prisma with PostgreSQL (migrations in server/prisma/migrations)
- **VLA Models**: π0.6, OpenVLA supported; GR00T planned
- **Authentication**: JWT-based (in development)
- **Simulation**: Robot agent runs in simulation mode for development
