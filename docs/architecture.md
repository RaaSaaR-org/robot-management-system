# NeoDEM: RoboMindOS — System Architecture

> *"The body cannot live without the mind."* — Morpheus

**Version**: 2.0
**Last Updated**: January 2025

---

## System Overview

NeoDEM is a distributed system for managing fleets of humanoid robots. It combines Vision-Language-Action (VLA) model integration for skill learning with EU AI Act compliance — enabling the "awakening of the machine" while keeping it transparent and aligned.

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
    │                          │             │        │  (Oracle)   │        │
    │                          └─────────────┘        └─────────────┘        │
    │                               :5432                  :50051            │
    │                                                                         │
    │   ─────────────────────────────────────────────────────────────────    │
    │   Infrastructure:  NATS :4222  │  RustFS :9000  │  Prometheus :9090    │
    └─────────────────────────────────────────────────────────────────────────┘
```

---

## Component Architecture

### 1. App (Frontend)

The operator interface for managing and monitoring the fleet.

| Aspect | Details |
|--------|---------|
| **Location** | `app/` |
| **Stack** | React 18, TypeScript, Tailwind CSS, Zustand |
| **Wrapper** | Tauri 2.0 (desktop) |
| **Port** | 1420 (development), 80 (production) |
| **Build** | Vite |

**Key Features:**

- Fleet dashboard with real-time robot positions
- Natural language command interface
- VLA model training UI
- Skill library and deployment
- Live telemetry visualization
- EU AI Act compliance logging
- Emergency stop controls

**Architecture Pattern:** Feature-first organization with Zustand stores.

```
app/src/
├── features/
│   ├── robots/         # Robot management
│   ├── fleet/          # Fleet overview & map
│   ├── training/       # VLA training UI
│   ├── deployment/     # Model deployment
│   ├── command/        # NL command interface
│   ├── compliance/     # EU AI Act logging
│   ├── explainability/ # AI decision viewer
│   ├── safety/         # Safety monitoring
│   └── alerts/         # Alert system
├── shared/             # Shared components, hooks, utils
└── app/                # App shell, routing, providers
```

---

### 2. Server (Backend)

Central orchestration server implementing the A2A protocol.

| Aspect | Details |
|--------|---------|
| **Location** | `server/` |
| **Stack** | Node.js, Express, Prisma, TypeScript |
| **Protocol** | A2A (Agent-to-Agent) |
| **Port** | 3001 |
| **Database** | PostgreSQL |

**Key Features:**

- Robot registration and discovery
- A2A conversation management
- VLA training orchestration
- Model deployment to fleet
- Skill library management
- EU AI Act compliance logging
- MLflow integration

**Architecture Pattern:** Routes + Services with repository layer.

```
server/src/
├── routes/              # API endpoints
│   ├── robot.routes.ts
│   ├── training.routes.ts
│   ├── deployment.routes.ts
│   └── compliance.routes.ts
├── services/            # Business logic
│   ├── RobotManager.ts
│   ├── TrainingOrchestrator.ts
│   ├── DeploymentService.ts
│   ├── SkillLibraryService.ts
│   └── ComplianceLogger.ts
├── repositories/        # Data access
├── websocket/           # Real-time communication
└── types/               # TypeScript definitions
```

---

### 3. Robot Agent

AI-powered software that runs on each robot (or in simulation).

| Aspect | Details |
|--------|---------|
| **Location** | `robot-agent/` |
| **Stack** | Node.js, Genkit, Gemini AI |
| **Protocol** | A2A SDK |
| **Port** | 41243+ |
| **Modes** | Production (hardware) / Simulation (dev) |

**Key Features:**

- Natural language command interpretation
- VLA model inference client
- A2A protocol compliance
- Robot state management
- Telemetry streaming
- Safety monitoring & E-stop

**Architecture Pattern:** AI agent with Genkit tools.

```
robot-agent/src/
├── agent/           # A2A agent & AI
│   ├── agent-card.ts
│   ├── agent-executor.ts
│   └── genkit.ts
├── robot/           # Robot state & telemetry
├── tools/           # Genkit AI tools
│   ├── navigation.ts
│   ├── manipulation.ts
│   └── vla-skill.ts
├── vla/             # VLA inference client
│   ├── client.ts
│   └── controller.ts
├── safety/          # Safety monitoring
└── compliance/      # Compliance logging client
```

---

### 4. VLA Inference Server (The Oracle)

> *"I'm going to let you in on a little secret. Being The One is just like being in love."* — The Oracle

Vision-Language-Action model serving for skill execution.

| Aspect | Details |
|--------|---------|
| **Location** | `vla-inference/` |
| **Stack** | Python, gRPC, PyTorch |
| **Protocol** | gRPC (Predict, StreamControl) |
| **Port** | 50051 (gRPC), 9090 (metrics) |
| **Models** | pi0.6, OpenVLA, GR00T |

**Key Features:**

- Multi-model support (factory pattern)
- Streaming action predictions
- GPU acceleration (CUDA)
- Prometheus metrics
- Health checks

**Architecture Pattern:** gRPC servicer with model factory.

```
vla-inference/
├── server.py           # Async gRPC server
├── servicer.py         # gRPC service implementation
├── config.py           # Configuration
├── metrics.py          # Prometheus metrics
├── models/
│   ├── __init__.py     # Model factory
│   ├── pi0.py          # pi0.6 model
│   ├── openvla.py      # OpenVLA 7B
│   └── groot.py        # GR00T (stub)
└── protos/             # Generated gRPC code
```

---

## Communication Protocols

### A2A Protocol (Agent-to-Agent)

Primary protocol for server-robot communication.

```
┌──────────┐                    ┌──────────────┐
│  Server  │                    │ Robot Agent  │
└────┬─────┘                    └──────┬───────┘
     │                                 │
     │  GET /.well-known/agent-card.json
     │────────────────────────────────>│
     │         AgentCard               │
     │<────────────────────────────────│
     │                                 │
     │  POST / (A2A Message)           │
     │────────────────────────────────>│
     │                                 │
     │         Task Created            │
     │<────────────────────────────────│
     │                                 │
```

### gRPC (Robot ↔ VLA Inference)

High-performance streaming for VLA predictions.

```
┌──────────────┐                    ┌──────────────┐
│ Robot Agent  │                    │ VLA Inference│
└──────┬───────┘                    └──────┬───────┘
       │                                   │
       │  Predict(image, instruction)      │
       │──────────────────────────────────>│
       │         ActionPrediction          │
       │<──────────────────────────────────│
       │                                   │
       │  StreamControl(stream of images)  │
       │──────────────────────────────────>│
       │         Stream of actions         │
       │<──────────────────────────────────│
       │                                   │
```

### WebSocket

Real-time telemetry and events.

| Event | Description |
|-------|-------------|
| `telemetry` | Position, battery, sensors |
| `status` | Robot state changes |
| `alert` | Warnings and errors |
| `task` | Task progress updates |
| `compliance` | Audit log events |

---

## Data Flow

### Skill Upload Flow ("I know Kung Fu")

```
1. Operator uploads training demonstrations
   │
   ▼
2. Server stores in RustFS, creates dataset
   │
   ▼
3. Training job submitted to orchestrator
   │
   ▼
4. VLA model fine-tuned (MLflow tracking)
   │
   ▼
5. Model deployed to VLA Inference server
   │
   ▼
6. Skill added to Skill Library
   │
   ▼
7. Robot agents load new skill via gRPC
   │
   ▼
8. Fleet "knows Kung Fu"
```

### Command Execution Flow

```
1. User: "Pick up the red cup"
   │
   ▼
2. Server routes to Robot Agent via A2A
   │
   ▼
3. Genkit AI interprets command
   │
   ▼
4. VLA skill invoked if available
   │
   ▼
5. Robot Agent → VLA Inference (gRPC)
   │
   ▼
6. VLA model predicts actions (50 Hz)
   │
   ▼
7. Robot executes actions
   │
   ▼
8. Telemetry streamed back via WebSocket
```

---

## Infrastructure

### Databases & Storage

| Service | Purpose | Port |
|---------|---------|------|
| **PostgreSQL** | Primary database (Prisma ORM) | 5432 |
| **MLflow** | Experiment tracking, model registry | 5000 |
| **RustFS** | S3-compatible object storage | 9000 |
| **NATS** | Message queue for async tasks | 4222 |

### Monitoring

| Service | Purpose | Port |
|---------|---------|------|
| **Prometheus** | Metrics collection | 9090 |
| **Grafana** | Dashboards (optional) | 3000 |

---

## Deployment Architecture

### Development

```
┌──────────────────────────────────────────────────┐
│                  Developer Machine               │
│                                                  │
│  ┌─────────┐   ┌─────────┐   ┌──────────────┐   │
│  │   App   │   │ Server  │   │ Robot Agent  │   │
│  │  :1420  │   │  :3001  │   │    :41243    │   │
│  └─────────┘   └─────────┘   └──────────────┘   │
│                                                  │
│  docker-compose up -d postgres nats rustfs       │
└──────────────────────────────────────────────────┘
```

### Production (Kubernetes)

```
┌─────────────────────────────────────────────────────────────┐
│                      Kubernetes Cluster                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │     App     │  │   Server    │  │ Robot Agent │         │
│  │  (2-5 pods) │  │ (2-10 pods) │  │  (1+ pods)  │         │
│  │     HPA     │  │     HPA     │  │             │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ PostgreSQL  │  │    NATS     │  │   RustFS    │         │
│  │ StatefulSet │  │ StatefulSet │  │ StatefulSet │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐                          │
│  │   MLflow    │  │VLA Inference│  (GPU nodes)             │
│  │             │  │    (GPU)    │                          │
│  └─────────────┘  └─────────────┘                          │
│                                                              │
│  NetworkPolicies │ PodDisruptionBudgets │ Secrets          │
└─────────────────────────────────────────────────────────────┘
```

---

## Security Architecture

### Authentication & Authorization

| Layer | Implementation |
|-------|----------------|
| **User Auth** | JWT tokens |
| **Robot Auth** | API keys |
| **RBAC** | Admin, Operator, Viewer roles |

### Transport Security

- TLS/HTTPS for all connections
- WSS for WebSocket
- gRPC with TLS for VLA inference

### EU AI Act Compliance

| Requirement | Implementation |
|-------------|----------------|
| **Art. 12 Logging** | Tamper-evident audit trail |
| **Art. 13 Transparency** | AI decision explainability |
| **Art. 14 Human Oversight** | Emergency stop, supervision |
| **GDPR Art. 30** | Records of Processing Activities |

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | React, TypeScript, Tailwind | UI |
| **Desktop** | Tauri 2.0 (Rust) | Native wrapper |
| **Server** | Node.js, Express, Prisma | API & orchestration |
| **Protocol** | A2A | Agent communication |
| **AI** | Genkit, Gemini | NL interpretation |
| **VLA** | Python, PyTorch, gRPC | Vision-Language-Action |
| **Real-time** | WebSocket, NATS | Streaming |
| **Database** | PostgreSQL | Persistence |
| **Storage** | RustFS (S3) | Object storage |
| **ML Ops** | MLflow | Experiment tracking |
| **Orchestration** | Kubernetes, Helm | Deployment |

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [VLA Integration Guide](./VLA-integration-guide.md) | VLA model integration |
| [Deployment Guide](./deployment.md) | Kubernetes deployment |
| [Brand Guide](./brand.md) | Visual design system |
| [PRD](./prd.md) | Product requirements |

---

<div align="center">

**NeoDEM** — *Overseeing the Awakening of the Machine*

</div>
