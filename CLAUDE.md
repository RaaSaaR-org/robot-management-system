# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the NeoDEM codebase.

## Project Overview

NeoDEM is the open Physical AI platform covering the **complete lifecycle** — Collect → Train → Deploy → Evaluate → Operate → Comply — not just fleet operation. It's the integrating layer around LeRobot (LeRobotDataset format, HF Hub sync; trains Pi0/ACT/Diffusion/OpenVLA; serves models via the VLA Server). Fleet operation is one of six stages. It consists of four main components:

**Embodiment focus:** The platform is hardware-agnostic, but development and go-to-market focus on **cognitive humanoids, specialized on the Unitree G1** (incl. G1 EDU + Dex3-1 hands). The SO-101 arm was the bootstrap embodiment — still supported, but new feature work (sim, digital twin, RL, VLA, teleop, demos) defaults to the G1 humanoid.

| Component          | Location         | Description                          | Port  |
| ------------------ | ---------------- | ------------------------------------ | ----- |
| **App**            | `app/`           | React + Tauri frontend               | 1420  |
| **Server**         | `server/`        | Node.js A2A protocol server          | 3001  |
| **Robot Agent**    | `robot-agent/`   | AI-powered robot software            | 41243 |

## Component-Specific Guidance

Each component has its own `AGENTS.md` file with detailed guidance:

- `app/AGENTS.md` — Frontend development patterns, Zustand stores, Tailwind, routes
- `server/AGENTS.md` — Server routes, services, A2A protocol, database
- `robot-agent/AGENTS.md` — Genkit tools, robot state, telemetry, simulation

**Always check the relevant AGENTS.md file when working in a specific component.**

## Agent Development Workflow

The project uses Claude Code subagents for automated development. The pipeline is:

```
claude --agent ship
├── Phase 1: implement (blue)   → picks next task, branches, codes, typechecks, creates PR
├── Phase 2: test-frontend (cyan) → Playwright MCP UI testing (only if app/ changed)
├── Phase 3: review (purple)    → code review, PR comment, fixes, merges via gh
└── Phase 4: deploy (orange)    → pull main, restart systemd services, health checks
```

**Subagents:** defined in `.claude/agents/`

| Agent | File | Description |
|-------|------|-------------|
| **ship** | `ship.md` | Orchestrator — spawns the others, handles deploy |
| **implement** | `implement.md` | Implements the next task from `.mc/tasks/todo/` |
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

- `gh` — GitHub CLI; all PR operations go through it (`gh pr create`, `gh pr checks`, `gh pr merge`)
- `git push origin <branch>` — pushing a feature branch

**Tasks** live in `.mc/tasks/` as Markdown files — there is no task CLI. See
[Task Management](#task-management) for how to read, create and close one.

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

# VLA Server and Training Worker are now separate repos — see ../vla-server/ and ../training-worker/
```

### Testing

```bash
./scripts/test-all.sh              # typecheck + unit tests + playwright
./scripts/test-all.sh --skip-pw    # everything except playwright
```

`test-all.sh` runs, in order: typecheck (server, app, robot-agent), vitest
(server, app, robot-agent), the `sim_g1_dds` pytest suite, the curation +
LeRobot-converter pytest suite, the hardware-sidecar pytest suite, and the
Playwright UI tests. Every stage runs even when an earlier one fails, so one
invocation gives the whole picture.

Three stages need their own interpreter, and **all three report as SKIPPED
rather than failed when it is missing** — so a run that says "all tests passed"
may have run none of them:

- `SIM_PYTHON` → the cyclonedds+mujoco venv described in
  `robot-agent/hardware/sim_g1_dds/README.md`
- `CURATION_PYTHON` → a venv with pyarrow + pandas + pytest, described in
  `server/curation/README.md`. Defaults to `server/curation/.venv/bin/python`
  when that exists, so creating it there needs no env var. The server looks in
  the same place when it converts a v3.0 dataset to a readable view.
- `HARDWARE_PYTHON` → `robot-agent/hardware/tests/` (the `g1_sidecar.py`
  point-cloud/frame-convention tests). Needs only numpy + pytest, and falls back
  to either venv above when neither env var is set, so it usually needs no
  setup. `tests/test_backends.py` and `tests/test_vla_runner.py` are excluded
  from the stage — they need `httpx`, which no documented interpreter has.

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
npm run dev:g1       # Unitree G1 humanoid
npm run dev:g1-edu   # Unitree G1 EDU + Dex3-1 hands (43 DOF)
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
- Robot Agent ↔ VLA Server: HTTP (FastAPI) — VLA Server is now a separate repo
- Server ↔ NATS: Async messaging for training jobs (optional)
- Server ↔ RustFS: S3-compatible object storage for models/datasets (optional)
- Server ↔ Training Worker: HTTP polling — Training Worker is now a separate repo

**Key Infrastructure:**

- **Database**: Prisma ORM — SQLite (local dev) or PostgreSQL (production); 83 models
- **Authentication**: JWT-based with RBAC (disabled in dev via `AUTH_DISABLED=true`)
- **AI**: Gemini 2.5 Flash for NL command interpretation (server) and robot agent reasoning
- **Storage**: RustFS/S3-compatible for model artifacts and datasets (optional, `server/src/storage/`)
- **Messaging**: NATS for async job queues and KV stores (optional, `server/src/messaging/`)

See `docs/architecture.md` for comprehensive system architecture.

## Directory Structure

```
robot-management-system/
├── app/                    # Frontend (React + Tauri)
│   ├── src/
│   │   ├── features/       # 25 feature modules (see app/AGENTS.md)
│   │   │   ├── a2a/        # Agent-to-Agent chat & orchestration
│   │   │   ├── agentmode/  # Agent Mode chat + live block timeline (/agent)
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
│   │   ├── agent-mode/     # Agent Mode: local-LLM planner + block executor (LocoClient)
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
│   ├── hardware/
│   │   ├── g1_sidecar.py   # DDS<->HTTP bridge to a real G1 (adds /loco/* for Agent Mode)
│   │   ├── sim_g1_dds/     # MuJoCo sim that speaks the real Unitree wire protocol
│   │   └── sim_evaluator/  # MJCF scenes (incl. g1_dex3_room_scene.xml)
│   ├── smolvla/            # Python client for real SO-101 hardware via LeRobot
│   └── AGENTS.md
│
├── vla-server/             # EXTRACTED — pointer README only (see ../vla-server/)
├── training-worker/        # EXTRACTED — pointer README only (see ../training-worker/)
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
└── .mc/                    # Task backlog (Markdown + YAML frontmatter)
    ├── tasks/              # Task files, split into todo/ and done/
    ├── config.yml          # Allowed statuses, priorities, id prefixes
    └── templates/          # Task/sprint/proposal templates
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
| `lerobot`               | VLA Server (separate repo) | VLA model loading + robot hardware |

## Task Management

Project tasks live in `.mc/tasks/` as Markdown files with YAML frontmatter. There is
no CLI for them — read, write and move the files directly. `todo/` holds everything
unfinished, `done/` holds what shipped.

```bash
ls .mc/tasks/todo/                                   # the backlog
cat .mc/tasks/todo/TASK-201-*.md                     # read one task
grep -l 'status: in-progress' .mc/tasks/todo/*.md    # what is being worked on
```

**Creating one:** copy `.mc/templates/task.md` to
`.mc/tasks/todo/TASK-NNN-<slug>.md`, taking the next free number, and fill in the
frontmatter. `.mc/config.yml` lists the allowed values: `status` is one of `backlog`,
`todo`, `in-progress`, `review`, `done`, `cancelled`; `priority` runs 1 (critical) to
4 (low).

**Closing one takes two steps** — the folder alone does not set the status:

```bash
git mv .mc/tasks/todo/TASK-NNN-*.md .mc/tasks/done/
# then edit the frontmatter in that file: status: todo → status: done
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
| `docs/multi-tenancy.md`          | Row-level multi-tenancy — flag, Prisma `$extends` isolation, `runAsPlatform`, Organizations UI (TASK-155) |
| `docs/vla-integration-guide.md`  | VLA integration (SmolVLA, pi0.5, GR00T) |
| `docs/training-run-export.md`    | Exporting a run to a cluster this server cannot reach |
| `docs/regulatory-compliance.md`  | EU AI Act, GDPR compliance        |

## Current Limitations

- **Simulation only**: Robot agent runs in simulation mode for development
- **SQLite locally**: Prisma schema targets PostgreSQL but local dev uses SQLite with JSON-encoded arrays
- **Auth disabled in dev**: JWT auth exists but bypassed via `AUTH_DISABLED=true`
- **Optional infra**: NATS and RustFS are optional — services log warnings and disable features when unavailable
