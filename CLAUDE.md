# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the RoboMindOS codebase.

## Project Overview

RoboMindOS is a distributed fleet management platform for humanoid robots. It consists of three main components:

| Component       | Location       | Description                 | Port  |
| --------------- | -------------- | --------------------------- | ----- |
| **App**         | `app/`         | React + Tauri frontend      | 1420  |
| **Server**      | `server/`      | Node.js A2A protocol server | 3001  |
| **Robot Agent** | `robot-agent/` | AI-powered robot software   | 41243 |

## Component-Specific Guidance

Each component has its own `AGENTS.md` file with detailed guidance:

- `app/AGENTS.md` - Frontend development patterns, Zustand stores, Tailwind
- `server/AGENTS.md` - Server routes, services, A2A protocol, database
- `robot-agent/AGENTS.md` - Genkit tools, robot state, telemetry, simulation

**Always check the relevant AGENTS.md file when working in a specific component.**

## Quick Start Commands

### Starting Components (Development)

```bash
# Terminal 1: Server (requires DATABASE_URL and optionally GOOGLE_API_KEY in server/.env)
cd server && npm run dev

# Terminal 2: Robot Agent (requires GEMINI_API_KEY in robot-agent/.env)
cd robot-agent && npm run dev

# Terminal 3: Frontend
cd app && npm run dev
```

### Environment Setup

Each component needs a `.env` file. Copy from examples and fill in API keys:

```bash
# Server (SQLite database, JWT auth disabled in dev)
cp server/.env.example server/.env  # if no .env exists

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

### Database Commands (Server)

```bash
cd server
npm run db:generate   # Generate Prisma client
npm run db:push       # Push schema to dev database
npm run db:migrate    # Run migrations
npm run db:studio     # Open Prisma Studio GUI
```

## Architecture

**Communication Protocols:**

- App <-> Server: REST API + WebSocket (`ws://localhost:3001/api/a2a/ws`)
- Server <-> Robot: A2A (Agent-to-Agent) protocol + REST API
- Server -> Robot: Push-model task distribution

**Key Infrastructure:**

- **Database**: Prisma ORM + SQLite (server)
- **Authentication**: JWT-based with role-based access control (disabled in dev via `AUTH_DISABLED=true`)
- **AI**: Gemini 2.5 Flash for NL command interpretation (server) and robot agent reasoning (robot-agent)

See `docs/architecture.md` for comprehensive system architecture.

## Directory Structure

```
robo-mind-app/
├── app/                    # Frontend (React + Tauri)
│   ├── src/
│   │   ├── features/       # Feature modules
│   │   │   ├── a2a/        # Agent-to-Agent chat & orchestration
│   │   │   ├── alerts/     # Alert management
│   │   │   ├── auth/       # Authentication (login, register, etc.)
│   │   │   ├── command/    # NL command interface
│   │   │   ├── dashboard/  # Fleet dashboard
│   │   │   ├── fleet/      # Fleet map & zone management
│   │   │   ├── processes/  # Workflow/process management
│   │   │   ├── robots/     # Robot management & telemetry
│   │   │   └── settings/   # Theme & UI preferences
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
│   │   ├── routes/         # API endpoints (11 route files)
│   │   ├── services/       # Business logic (10 services)
│   │   ├── repositories/   # Data access layer (Prisma)
│   │   ├── database/       # Prisma client, schemas, seeds
│   │   ├── middleware/      # Auth, rate limiting
│   │   ├── interfaces/     # Service interfaces (DI/testing)
│   │   ├── websocket/      # Real-time events
│   │   ├── types/          # TypeScript definitions
│   │   └── utils/          # Error hierarchy
│   ├── prisma/             # Prisma schema & migrations
│   └── AGENTS.md
│
├── robot-agent/            # Robot Software
│   ├── src/
│   │   ├── agent/          # A2A agent & Genkit AI
│   │   ├── robot/          # State, simulation, telemetry, tasks
│   │   ├── tools/          # AI tools (navigation, manipulation, status)
│   │   ├── api/            # REST & WebSocket
│   │   ├── config/         # Environment configuration
│   │   └── prompts/        # AI prompt templates
│   └── AGENTS.md
│
├── docs/                   # Documentation
│   ├── architecture.md     # System architecture
│   ├── app-architecture.md # Frontend architecture (detailed)
│   ├── prd.md              # Product requirements
│   └── brand.md            # Design system
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

1. **Types** - Define shared interfaces
2. **Server** - Database schema, repositories, services, routes
3. **Robot** - AI tools and state (if applicable)
4. **Frontend** - Store, hooks, components, pages

### Key Patterns

| Component  | Pattern                      | Example                                               |
| ---------- | ---------------------------- | ----------------------------------------------------- |
| **App**    | Feature-first + Zustand      | `features/robots/store/robotsStore.ts`                |
| **Server** | Routes + Services + Repos    | `routes/robot.routes.ts` -> `services/RobotManager.ts` -> `repositories/RobotRepository.ts` |
| **Robot**  | Genkit Tools + State Manager | `tools/navigation.ts` with `ai.defineTool()`          |

## Key Dependencies

| Package                 | Used In       | Purpose                    |
| ----------------------- | ------------- | -------------------------- |
| `zustand`               | App           | State management           |
| `immer`                 | App           | Immutable state updates    |
| `axios`                 | App, Server   | HTTP client                |
| `@tauri-apps/api`       | App           | Desktop APIs               |
| `three`                 | App           | 3D robot model viewer      |
| `react-router-dom`      | App           | Client-side routing        |
| `express`               | Server, Robot | HTTP server                |
| `ws`                    | Server, Robot | WebSocket                  |
| `@prisma/client`        | Server        | Database ORM               |
| `jsonwebtoken`          | Server        | JWT authentication         |
| `@google/generative-ai` | Server, Robot | Gemini AI                  |
| `genkit`                | Robot         | AI framework               |
| `@a2a-js/sdk`           | Robot         | A2A protocol               |

## Task Management

Project tasks are tracked in `.mc/tasks/` using MissionControl (mc CLI). Tasks are markdown files with YAML frontmatter, organized in `todo/` and `done/` folders.

```bash
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
- **Independent**: Each task should be implementable on its own. Include file paths, API shapes, and relevant context inline — don't assume the reader has read other tasks
- **Specific**: Reference exact file paths (`app/src/features/fleet/components/FleetMap.tsx`), not vague locations ("the fleet module")
- **Scoped**: One task = one coherent deliverable. If it spans 3+ components, that's fine, but it should be one logical feature
- **Tagged**: Use `core`, `extended`, or `compliance` tags. Add `deferred` for deprioritized items
- **Dependencies**: Use `depends_on` with `[[TASK-NNN]]` links for hard blockers only

## Documentation

| Document                                         | Description                       |
| ------------------------------------------------ | --------------------------------- |
| `docs/architecture.md`                           | Full system architecture          |
| `docs/app-architecture.md`                       | Frontend patterns (detailed)      |
| `docs/prd.md`                                    | Product requirements              |
| `docs/brand.md`                                  | Colors, typography, design tokens |
| `docs/humanoid-robot-communication-protocols.md` | A2A protocol details              |

## Current Limitations

- **Simulation only**: Robot agent runs in simulation mode for development
- **SQLite**: Server uses file-based SQLite; production should migrate to PostgreSQL
- **Auth disabled in dev**: JWT auth exists but bypassed via `AUTH_DISABLED=true`
