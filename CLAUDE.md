# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the RoboMindOS codebase.

## Project Overview

RoboMindOS is a distributed fleet management platform for humanoid robots with EU AI Act compliance features. It consists of three main components:

| Component       | Location       | Description                 | Port  |
| --------------- | -------------- | --------------------------- | ----- |
| **App**         | `app/`         | React + Tauri frontend      | 1420  |
| **Server**      | `server/`      | Node.js A2A protocol server | 3001  |
| **Robot Agent** | `robot-agent/` | AI-powered robot software   | 41243 |

## Component-Specific Guidance

Each component has its own `AGENTS.md` file with detailed guidance:

- `app/AGENTS.md` - Frontend development patterns, Zustand stores, Tailwind
- `server/AGENTS.md` - Server routes, services, Prisma database
- `robot-agent/AGENTS.md` - Genkit tools, robot state, safety monitoring

**Always check the relevant AGENTS.md file when working in a specific component.**

## Quick Start Commands

### HowTo Start Components (Development)

```bash
# Terminal 1: Server
cd server && npm run dev

# Terminal 2: Robot Agent (simulation)
cd robot-agent && npm run dev

# Terminal 3: Frontend
cd app && npm run dev
```

### Individual Component Commands

| Component  | Dev                             | Build           | Type Check          |
| ---------- | ------------------------------- | --------------- | ------------------- |
| **App**    | `cd app && npm run dev`         | `npm run build` | `npx tsc`           |
| **Server** | `cd server && npm run dev`      | `npm run build` | `npm run typecheck` |
| **Robot**  | `cd robot-agent && npm run dev` | `npm run build` | `npm run typecheck` |

## Architecture

**Communication Protocols:**

- App <-> Server: REST API + WebSocket
- Server <-> Robot: A2A (Agent-to-Agent) protocol

**Database:**

- Prisma ORM with SQLite (server/prisma/schema.prisma)
- Run migrations: `cd server && npx prisma migrate dev`

See `docs/architecture.md` for comprehensive system architecture.

## Directory Structure

```
robot-management-system/
├── app/                    # Frontend (React + Tauri)
│   ├── src/
│   │   ├── features/       # Feature modules (see app/src/features/AGENTS.md)
│   │   │   ├── compliance/   # EU AI Act compliance logging
│   │   │   ├── explainability/ # AI decision transparency
│   │   │   ├── robots/       # Robot management
│   │   │   ├── fleet/        # Fleet operations
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
│   │   ├── repositories/   # Database access layer
│   │   ├── types/          # TypeScript type definitions
│   │   └── websocket/      # Real-time telemetry
│   └── AGENTS.md           # Server-specific guidance
│
├── robot-agent/            # Robot Software
│   ├── src/
│   │   ├── agent/          # A2A agent & Genkit AI
│   │   ├── robot/          # State, telemetry, types
│   │   ├── tools/          # AI tools (navigation, manipulation)
│   │   ├── safety/         # Safety monitoring & emergency stop
│   │   ├── compliance/     # Compliance logging client
│   │   └── api/            # REST & WebSocket
│   └── AGENTS.md           # Robot-specific guidance
│
├── docs/                   # Documentation
│   ├── architecture.md     # System architecture
│   ├── app-architecture.md # Frontend architecture (detailed)
│   ├── prd.md              # Product requirements
│   └── brand.md            # Design system
│
└── .taskmaster/            # Task management
    └── tasks/tasks.json    # Project tasks
```

## Key Features

### Compliance & Regulatory (EU AI Act)

- **Compliance Logging**: Tamper-evident audit trail (Art. 12)
- **Hash Chain Verification**: Cryptographic integrity verification
- **RoPA Management**: Records of Processing Activities (GDPR Art. 30)
- **Technical Documentation**: Per AI Act Annex IV, MR Annex IV, CRA Annex V
- **Retention Policies**: Configurable per event type (up to 10 years)
- **Legal Holds**: Prevent deletion during investigations

### AI Explainability

- **Decision Viewer**: Inspect AI decisions with reasoning
- **Confidence Metrics**: Model confidence and safety scores
- **Factor Analysis**: Input factors and their influence
- **Timeline**: Historical decision tracking

### Safety Features

- **Safety Monitor**: Real-time safety classification
- **Emergency Stop**: Immediate robot halt capability
- **Protective Stop**: Automatic safety interventions
- **Safety Events**: Logged with full context

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
2. **Server** - API endpoints, services, database models
3. **Robot** - AI tools and state (if applicable)
4. **Frontend** - Store, hooks, components, pages

### Key Patterns

| Component  | Pattern                 | Example                                               |
| ---------- | ----------------------- | ----------------------------------------------------- |
| **App**    | Feature-first + Zustand | `features/robots/store/robotsStore.ts`                |
| **Server** | Routes + Services       | `routes/robot.routes.ts` -> `services/RobotManager.ts` |
| **Robot**  | Genkit Tools            | `tools/navigation.ts` with `ai.defineTool()`          |

## Key Dependencies

| Package               | Used In       | Purpose              |
| --------------------- | ------------- | -------------------- |
| `zustand`             | App           | State management     |
| `@tauri-apps/api`     | App           | Desktop APIs         |
| `express`             | Server, Robot | HTTP server          |
| `prisma`              | Server        | Database ORM         |
| `ws`                  | Server, Robot | WebSocket            |
| `@a2a-js/sdk`         | Robot         | A2A protocol         |
| `genkit`              | Robot         | AI framework         |
| `@genkit-ai/googleai` | Robot         | Gemini integration   |

## Task Management

Project tasks are tracked in `.taskmaster/tasks/tasks.json`. Use task-master CLI:

```bash
npx task-master list          # List all tasks
npx task-master next          # Get next task to work on
npx task-master show <id>     # Show task details
```

## Documentation

| Document                                         | Description                       |
| ------------------------------------------------ | --------------------------------- |
| `docs/architecture.md`                           | Full system architecture          |
| `docs/app-architecture.md`                       | Frontend patterns (detailed)      |
| `docs/prd.md`                                    | Product requirements              |
| `docs/brand.md`                                  | Colors, typography, design tokens |
| `docs/humanoid-robot-communication-protocols.md` | A2A protocol details              |

## Current Status

- **Database**: Prisma with SQLite (migrations in server/prisma/migrations)
- **Authentication**: Not yet implemented (planned)
- **Simulation**: Robot agent runs in simulation mode for development
