# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the NeoDEM codebase.

## Project Overview

NeoDEM is a distributed fleet management platform for autonomous robots. It consists of four main components:

| Component          | Location         | Description                          | Port  |
| ------------------ | ---------------- | ------------------------------------ | ----- |
| **App**            | `app/`           | React + Tauri frontend               | 1420  |
| **Server**         | `server/`        | Node.js A2A protocol server          | 3001  |
| **Robot Agent**    | `robot-agent/`   | AI-powered robot software            | 41243 |
| **VLA Server**     | `vla-server/`    | FastAPI VLA inference (SmolVLA, Pi0.5, GR00T) | 8000  |

## Component-Specific Guidance

Each component has its own `AGENTS.md` file with detailed guidance:

- `app/AGENTS.md` — Frontend development patterns, Zustand stores, Tailwind, routes
- `server/AGENTS.md` — Server routes, services, A2A protocol, database
- `robot-agent/AGENTS.md` — Genkit tools, robot state, telemetry, simulation
- `vla-server/README.md` — VLA model inference (SmolVLA, Pi0.5, GR00T)

**Always check the relevant AGENTS.md file when working in a specific component.**

## Agent Development Workflow

The project uses Claude Code subagents for automated development. The pipeline is:

```
claude --agent ship
├── Phase 1: implement (blue)   → picks next task, branches, codes, typechecks, creates PR
├── Phase 2: test-frontend (cyan) → Playwright MCP UI testing (only if app/ changed)
├── Phase 3: review (purple)    → code review, PR comment, fixes, merges via gh-igor
└── Phase 4: deploy (orange)    → pull main, restart systemd services, health checks
```

**Subagents:** defined in `.claude/agents/`

| Agent | File | Description |
|-------|------|-------------|
| **ship** | `ship.md` | Orchestrator — spawns the others, handles deploy |
| **implement** | `implement.md` | Implements next task from MissionControl |
| **review** | `review.md` | Reviews PR, posts findings on GitHub, merges |
| **test-frontend** | `test-frontend.md` | Tests UI via Playwright MCP (desktop + mobile) |

**Usage:**

```bash
claude --agent ship                  # Full pipeline: implement → test → review → deploy
claude --agent implement             # Just implement next task + create PR
claude --agent review                # Just review latest open PR
claude --agent test-frontend         # Just test frontend via Playwright
```

**Key tools:**

- `~/.local/bin/gh-igor` — GitHub CLI wrapper with auto-injected token (all PR operations)
- `~/.local/bin/github-token-igor` — generates GitHub App installation token
- `~/.local/bin/git-push-igor` — git push with auto token
- `mc` (MissionControl) — task management CLI (`source ~/.cargo/env` first)

**GitHub repo:** `RaaSaaR-org/robot-management-system`

## Quick Start Commands

### Start Components (Development)

```bash
# Terminal 1: Server (requires DATABASE_URL in server/.env)
cd server && npm run dev

# Terminal 2: Robot Agent (requires GEMINI_API_KEY in robot-agent/.env)
cd robot-agent && npm run dev

# Terminal 3: Frontend
cd app && npm run dev

# Optional: VLA Server (requires Python + GPU)
cd vla-server && python server.py
```

### Environment Setup

Each component needs a `.env` file. Copy from examples and fill in API keys:

```bash
# Server (SQLite for local dev, PostgreSQL for production)
cp server/.env.example server/.env

# Robot Agent (needs Gemini API key)
cp robot-agent/.env.example robot-agent/.env
# Edit robot-agent/.env and set GEMINI_API_KEY=your_key

# App (defaults work for local dev)
# VITE_API_BASE_URL defaults to http://localhost:3001/api
```

### Individual Component Commands

| Component  | Dev                             | Build           | Type Check          |
| ---------- | ------------------------------- | --------------- | ------------------- |
| **App**    | `cd app && npm run dev`         | `npm run build` | `npx tsc`           |
| **Server** | `cd server && npm run dev`      | `npm run build` | `npm run typecheck` |
| **Robot**  | `cd robot-agent && npm run dev` | `npm run build` | `npm run typecheck` |

Robot agent supports per-embodiment dev profiles:

```bash
cd robot-agent
npm run dev          # Default (SimBot Light)
npm run dev:so101    # SO-ARM100 robot arm
npm run dev:h1       # Unitree H1 humanoid
```

### Robot Agent CLI (`roboctl`)

A CLI for controlling robot agents lives in `robot-agent/cli/`. See `robot-agent/cli/README.md` for full usage.

```bash
cd robot-agent/cli && npm run dev -- status       # Robot status
cd robot-agent/cli && npm run dev -- telemetry    # Live telemetry
cd robot-agent/cli && npm run dev -- move "Warehouse A"  # Send to zone
cd robot-agent/cli && npm run dev -- health       # Health check
cd robot-agent/cli && npm run dev                 # Interactive REPL mode

# Or install globally:
cd robot-agent/cli && npm link
roboctl status
roboctl telemetry
roboctl move "Warehouse A"
```

### Database Commands (Server)

```bash
cd server
npm run db:generate   # Generate Prisma client
npm run db:push       # Push schema to dev database
npm run db:migrate    # Run migrations
npm run db:studio     # Open Prisma Studio GUI
```

**Important:** The Prisma schema uses `provider = "postgresql"` for production. For local dev with SQLite, change it to `provider = "sqlite"` in `server/prisma/schema.prisma` and use `DATABASE_URL="file:./dev.db"`. Array fields are stored as JSON strings in SQLite.

## Architecture

**Communication Protocols:**

- App ↔ Server: REST API + WebSocket (`ws://localhost:3001/api/a2a/ws`)
- Server ↔ Robot: A2A (Agent-to-Agent) protocol + REST API
- Server → Robot: Push-model task distribution
- Robot Agent ↔ VLA Server: HTTP (FastAPI)
- Server ↔ NATS: Async messaging for training jobs (optional)
- Server ↔ RustFS: S3-compatible object storage for models/datasets (optional)

**Key Infrastructure:**

- **Database**: Prisma ORM — SQLite (local dev) or PostgreSQL (production); 83 models
- **Authentication**: JWT-based with RBAC (disabled in dev via `AUTH_DISABLED=true`)
- **AI**: Gemini 2.5 Flash for NL command interpretation (server) and robot agent reasoning
- **Storage**: RustFS/S3-compatible for model artifacts and datasets (optional, `server/src/storage/`)
- **Messaging**: NATS for async job queues and KV stores (optional, `server/src/messaging/`)
- **ML Pipeline**: MLflow integration for model registry (optional)

See `docs/architecture.md` for comprehensive system architecture.

## Directory Structure

```
robot-management-system/
├── app/                    # Frontend (React + Tauri)
│   ├── src/
│   │   ├── features/       # 25 feature modules (see app/AGENTS.md)
│   │   │   ├── a2a/        # Agent-to-Agent chat & orchestration
│   │   │   ├── alerts/     # Alert management
│   │   │   ├── approvals/  # Human approval workflows (EU AI Act)
│   │   │   ├── auth/       # Authentication (login, register, etc.)
│   │   │   ├── command/    # NL command interface
│   │   │   ├── compliance/ # Audit logging viewer
│   │   │   ├── contributions/ # Data contribution portal
│   │   │   ├── dashboard/  # Fleet dashboard
│   │   │   ├── datacollection/ # Robot data collection
│   │   │   ├── deployment/ # VLA model deployment
│   │   │   ├── evaluation/ # Model evaluation
│   │   │   ├── explainability/ # AI decision transparency
│   │   │   ├── fleet/      # Fleet map & zone management
│   │   │   ├── fleetlearning/ # Federated learning
│   │   │   ├── gdpr/       # GDPR self-service portal
│   │   │   ├── incidents/  # Incident management
│   │   │   ├── oversight/  # Human oversight dashboard
│   │   │   ├── processes/  # Workflow/process management
│   │   │   ├── robots/     # Robot management, telemetry, 3D viewer
│   │   │   ├── safety/     # Safety monitoring
│   │   │   ├── settings/   # Theme & UI preferences
│   │   │   ├── simulation/ # Robot simulation
│   │   │   ├── training/   # VLA dataset & training management
│   │   │   └── updates/    # OTA updates
│   │   ├── shared/         # Shared components, hooks, utils, types
│   │   ├── app/            # Providers (Auth, Theme)
│   │   ├── api/            # Axios client with token refresh
│   │   ├── store/          # Zustand store factory
│   │   ├── components/     # Layout & landing page components
│   │   ├── pages/          # Top-level pages (Landing, Settings)
│   │   └── mocks/          # Mock data for development
│   ├── src-tauri/          # Tauri (Rust) backend
│   └── AGENTS.md
│
├── server/                 # Backend (Node.js A2A Server)
│   ├── src/
│   │   ├── routes/         # API endpoints (47 route files)
│   │   ├── services/       # Business logic (57 services)
│   │   ├── repositories/   # Data access layer (19 repositories)
│   │   ├── database/       # Prisma client, schemas, seeds
│   │   ├── middleware/      # Auth middleware
│   │   ├── interfaces/     # Service interfaces (DI/testing)
│   │   ├── websocket/      # Real-time events
│   │   ├── types/          # TypeScript definitions (25 type files)
│   │   ├── utils/          # Error hierarchy
│   │   ├── storage/        # RustFS/S3 object storage client
│   │   ├── messaging/      # NATS messaging (jobs, KV, streams)
│   │   ├── jobs/           # Background jobs (retention cleanup)
│   │   ├── workers/        # Worker threads (dataset validation, training)
│   │   └── security/       # Encryption utilities
│   ├── prisma/             # Prisma schema (83 models) & migrations
│   └── AGENTS.md
│
├── robot-agent/            # Robot Software
│   ├── src/
│   │   ├── agent/          # A2A agent & Genkit AI
│   │   ├── robot/          # State, simulation, telemetry, task queue
│   │   │   └── joint-configs/ # Per-robot-type joint configurations
│   │   ├── tools/          # AI tools (navigation, manipulation, status)
│   │   ├── embodiment/     # Embodiment configs (generic, h1, so101)
│   │   ├── safety/         # Safety monitor
│   │   ├── compliance/     # Compliance log client
│   │   ├── vla/            # VLA inference client (gRPC)
│   │   ├── api/            # REST & WebSocket
│   │   ├── config/         # Environment configuration
│   │   └── prompts/        # AI prompt templates
│   ├── smolvla/            # Python client for real SO-101 hardware via LeRobot
│   └── AGENTS.md
│
├── vla-server/             # Consolidated VLA Inference Server (Python)
│   ├── server.py           # Server entry point
│   ├── models/             # Model backends (SmolVLA, pi0.5, GR00T, etc.)
│   ├── pyproject.toml
│   └── README.md
│
├── helm/                   # Kubernetes Helm Chart
│   └── neodem/             # Chart with 30 resource templates
│
├── protos/                 # Shared protobuf definitions
│   └── vla_inference.proto
│
├── docs/                   # Documentation (14 files)
│   ├── architecture.md     # System architecture
│   ├── app-architecture.md # Frontend architecture (detailed)
│   ├── api.md              # API reference
│   ├── brand.md            # Colors, typography, design tokens
│   ├── deployment.md       # Deployment guide
│   ├── dev-workflow.md     # Development workflow
│   ├── vla-integration-guide.md
│   └── ...                 # Compliance, operations, processes
│
├── .claude/                # Claude Code configuration
│   └── agents/             # Subagent definitions (ship, implement, review, test-frontend)
│
└── .mc/                    # MissionControl (task management)
    ├── tasks/              # Task markdown files (todo/, done/)
    ├── config.yml          # MC configuration
    └── templates/          # Task/sprint templates
```

## Development Guidelines

### Code Style

- **TypeScript**: Strict mode, explicit types for public APIs
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

1. **Types** — Define shared interfaces
2. **Protos** — Protobuf definitions if gRPC is involved
3. **Server** — Database schema, repositories, services, routes
4. **Robot** — AI tools, embodiment configs, and state (if applicable)
5. **Frontend** — Store, hooks, components, pages

### Key Patterns

| Component  | Pattern                      | Example                                               |
| ---------- | ---------------------------- | ----------------------------------------------------- |
| **App**    | Feature-first + Zustand      | `features/robots/store/robotsStore.ts`                |
| **Server** | Routes > Services > Repos    | `routes/robot.routes.ts` > `services/RobotManager.ts` > `repositories/RobotRepository.ts` |
| **Robot**  | Genkit Tools + State Manager | `tools/navigation.ts` with `ai.defineTool()`          |

## Key Dependencies

| Package                 | Used In       | Purpose                    |
| ----------------------- | ------------- | -------------------------- |
| `zustand` + `immer`     | App           | State management           |
| `axios`                 | App, Server   | HTTP client                |
| `three` + `@react-three/fiber` | App    | 3D robot model viewer      |
| `react-router-dom`      | App           | Client-side routing        |
| `@tauri-apps/api`       | App           | Desktop APIs               |
| `recharts`              | App           | Charts & graphs            |
| `express`               | Server, Robot | HTTP server                |
| `ws`                    | Server, Robot | WebSocket                  |
| `@prisma/client`        | Server        | Database ORM               |
| `jsonwebtoken`          | Server        | JWT authentication         |
| `nats`                  | Server        | Async messaging            |
| `@aws-sdk/client-s3`    | Server        | RustFS/S3 object storage   |
| `@google/generative-ai` | Server, Robot | Gemini AI                  |
| `genkit`                | Robot         | AI framework               |
| `@a2a-js/sdk`           | Robot         | A2A protocol               |
| `@grpc/grpc-js`         | Robot         | VLA inference gRPC client  |
| `lerobot`               | VLA Server    | VLA model loading + robot hardware |

## Task Management

Project tasks are tracked in `.mc/tasks/` using MissionControl (mc CLI). Tasks are markdown files with YAML frontmatter, organized in `todo/` and `done/` folders.

```bash
source ~/.cargo/env          # make mc available
mc task board                 # Show kanban board
mc task next                  # Get next actionable task
mc list tasks                 # List all tasks
mc show TASK-001              # Show task details
mc task move TASK-001 done    # Move task to done
mc new task "Title" --priority 2 --tags core  # Create new task
```

### Task Authoring Guidelines

**Tasks must be self-contained.** Anyone reading a task should have all context needed to implement it without needing to cross-reference other documents or ask questions.

Every task description must include:

1. **Description**: 1-2 sentence summary of what needs to be done and why
2. **Details**: Full implementation guidance with:
   - **Current state**: What exists today (file paths, current behavior)
   - **Per-component sections**: Separate `### Server`, `### Frontend`, `### Robot Agent` sections as needed
   - **Key files**: Explicit list of files to create or modify with full relative paths
3. **Test Strategy**: How to verify the implementation works

Guidelines:
- **Independent**: Each task should be implementable on its own. Include file paths, API shapes, and relevant context inline
- **Specific**: Reference exact file paths (`app/src/features/fleet/components/FleetMap.tsx`), not vague locations
- **Scoped**: One task = one coherent deliverable
- **Tagged**: Use `core`, `extended`, or `compliance` tags. Add `deferred` for deprioritized items
- **Dependencies**: Use `depends_on` with `[[TASK-NNN]]` links for hard blockers only

## Documentation

| Document                         | Description                       |
| -------------------------------- | --------------------------------- |
| `docs/architecture.md`           | Full system architecture          |
| `docs/app-architecture.md`       | Frontend patterns (detailed)      |
| `docs/api.md`                    | API reference                     |
| `docs/brand.md`                  | Colors, typography, design tokens |
| `docs/deployment.md`             | Deployment guide (Helm/K8s)       |
| `docs/dev-workflow.md`           | Development workflow              |
| `docs/vla-integration-guide.md`  | VLA integration (SmolVLA, pi0.5, GR00T) |
| `docs/regulatory-compliance.md`  | EU AI Act, GDPR compliance        |

## Current Limitations

- **Simulation only**: Robot agent runs in simulation mode for development
- **SQLite locally**: Prisma schema targets PostgreSQL but local dev uses SQLite with JSON-encoded arrays
- **Auth disabled in dev**: JWT auth exists but bypassed via `AUTH_DISABLED=true`
- **Optional infra**: NATS, RustFS, and MLflow are optional — services log warnings and disable features when unavailable
