# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the RoboMindOS codebase.

## Project Overview

RoboMindOS is a distributed fleet management platform for humanoid robots. It consists of three main components:

| Component       | Location       | Description                 | Port  |
| --------------- | -------------- | --------------------------- | ----- |
| **App**         | `app/`         | React + Tauri frontend      | 1420  |
| **Server**      | `server/`      | Node.js A2A protocol server | 3000  |
| **Robot Agent** | `robot-agent/` | AI-powered robot software   | 41243 |

## Component-Specific Guidance

Each component has its own `AGENTS.md` file with detailed guidance:

- `app/AGENTS.md` - Frontend development patterns, Zustand stores, Tailwind
- `server/AGENTS.md` - Server routes, services, A2A protocol
- `robot-agent/AGENTS.md` - Genkit tools, robot state, telemetry

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

- App ↔ Server: REST API + WebSocket
- Server ↔ Robot: A2A (Agent-to-Agent) protocol

See `docs/architecture.md` for comprehensive system architecture.

## Directory Structure

```
robo-mind-app/
├── app/                    # Frontend (React + Tauri)
│   ├── src/
│   │   ├── features/       # Feature modules (robots, fleet, command, etc.)
│   │   ├── shared/         # Shared components, hooks, utils
│   │   └── app/            # App shell, routing, providers
│   ├── src-tauri/          # Tauri (Rust) backend
│   └── AGENTS.md           # Frontend-specific guidance
│
├── server/                 # Backend (Node.js A2A Server)
│   ├── src/
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # Business logic
│   │   └── websocket/      # Real-time telemetry
│   └── AGENTS.md           # Server-specific guidance
│
├── robot-agent/            # Robot Software
│   ├── src/
│   │   ├── agent/          # A2A agent & Genkit AI
│   │   ├── robot/          # State, telemetry, types
│   │   ├── tools/          # AI tools (navigation, manipulation)
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
2. **Server** - API endpoints and services
3. **Robot** - AI tools and state (if applicable)
4. **Frontend** - Store, hooks, components, pages

### Key Patterns

| Component  | Pattern                 | Example                                               |
| ---------- | ----------------------- | ----------------------------------------------------- |
| **App**    | Feature-first + Zustand | `features/robots/store/robotsStore.ts`                |
| **Server** | Routes + Services       | `routes/robot.routes.ts` → `services/RobotManager.ts` |
| **Robot**  | Genkit Tools            | `tools/navigation.ts` with `ai.defineTool()`          |

## Key Dependencies

| Package               | Used In       | Purpose            |
| --------------------- | ------------- | ------------------ |
| `zustand`             | App           | State management   |
| `@tauri-apps/api`     | App           | Desktop APIs       |
| `express`             | Server, Robot | HTTP server        |
| `ws`                  | Server, Robot | WebSocket          |
| `@a2a-js/sdk`         | Robot         | A2A protocol       |
| `genkit`              | Robot         | AI framework       |
| `@genkit-ai/googleai` | Robot         | Gemini integration |

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

## Current Limitations

- **No database**: Server uses in-memory storage (Task 16)
- **No authentication**: All endpoints open (Task 11)
- **Simulation only**: Robot agent in simulation mode for dev
