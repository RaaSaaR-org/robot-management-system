# RoboMindOS System Architecture

> **Version**: 1.0
> **Last Updated**: December 2025

---

## System Overview

RoboMindOS is a distributed system for managing fleets of humanoid robots. It consists of three main components that communicate via the A2A (Agent-to-Agent) protocol.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              OPERATORS                                   │
│                         (Desktop/Mobile/Web)                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP/WebSocket
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                          ┌─────────────────┐                            │
│                          │      APP        │                            │
│                          │  React + Tauri  │                            │
│                          │   Port: 1420    │                            │
│                          └────────┬────────┘                            │
│                                   │                                     │
│                                   │ REST/WebSocket                      │
│                                   ▼                                     │
│                          ┌─────────────────┐                            │
│                          │     SERVER      │                            │
│                          │  Node.js A2A    │                            │
│                          │   Port: 3000    │                            │
│                          └────────┬────────┘                            │
│                                   │                                     │
│                    CLOUD/ON-PREM  │ A2A Protocol                        │
│                                   │                                     │
└───────────────────────────────────┼─────────────────────────────────────┘
                                    │
           ┌────────────────────────┼────────────────────────┐
           │                        │                        │
           ▼                        ▼                        ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  ROBOT AGENT    │      │  ROBOT AGENT    │      │  ROBOT AGENT    │
│   Port: 41243   │      │   Port: 41244   │      │   Port: 41245   │
│                 │      │                 │      │                 │
│  ┌───────────┐  │      │  ┌───────────┐  │      │  ┌───────────┐  │
│  │  MindOs   │  │      │  │  MindOs   │  │      │  │  MindOs   │  │
│  │    AI     │  │      │  │    AI     │  │      │  │    AI     │  │
│  └───────────┘  │      │  └───────────┘  │      │  └───────────┘  │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         ▼                        ▼                        ▼
   ┌───────────┐           ┌───────────┐           ┌───────────┐
   │  ROBOT 1  │           │  ROBOT 2  │           │  ROBOT 3  │
   │ Hardware  │           │ Hardware  │           │ Hardware  │
   └───────────┘           └───────────┘           └───────────┘
```

---

## Component Architecture

### 1. App (Frontend)

The user-facing application for operators to manage and monitor robots.

| Aspect       | Details                                     |
| ------------ | ------------------------------------------- |
| **Location** | `app/`                                      |
| **Stack**    | React 18, TypeScript, Tailwind CSS, Zustand |
| **Wrapper**  | Tauri 2.0 (desktop), Capacitor (mobile)     |
| **Port**     | 1420 (development)                          |
| **Build**    | Vite                                        |

**Key Features:**

- Fleet dashboard with real-time robot positions
- Natural language command interface
- Live telemetry visualization
- Task management and monitoring
- Emergency stop controls

**Architecture Pattern:** Feature-first organization with Zustand stores per feature.

```
app/src/
├── features/
│   ├── robots/      # Robot management
│   ├── fleet/       # Fleet overview & map
│   ├── command/     # NL command interface
│   ├── alerts/      # Alert system
│   ├── tasks/       # Task management
│   └── settings/    # User preferences
├── shared/          # Shared components, hooks, utils
└── app/             # App shell, routing, providers
```

---

### 2. Server (Backend)

Central orchestration server implementing the A2A protocol.

| Aspect       | Details                      |
| ------------ | ---------------------------- |
| **Location** | `server/`                    |
| **Stack**    | Node.js, Express, TypeScript |
| **Protocol** | A2A (Agent-to-Agent)         |
| **Port**     | 3000                         |
| **Storage**  | In-memory (database planned) |

**Key Features:**

- Robot registration and discovery
- A2A conversation management
- Command routing to robots
- Telemetry aggregation
- Task orchestration

**Architecture Pattern:** Service-oriented with route handlers and manager services.

```
server/src/
├── routes/          # API endpoints
│   ├── robot.routes.ts
│   ├── conversation.routes.ts
│   ├── task.routes.ts
│   └── agent.routes.ts
├── services/        # Business logic
│   ├── RobotManager.ts
│   ├── ConversationManager.ts
│   └── A2AClient.ts
├── websocket/       # Real-time communication
└── types/           # TypeScript definitions
```

---

### 3. Robot Agent

Software that runs on each robot, providing AI-powered command processing.

| Aspect       | Details                                  |
| ------------ | ---------------------------------------- |
| **Location** | `robot-agent/`                           |
| **Stack**    | Node.js, Express, Genkit, Gemini AI      |
| **Protocol** | A2A SDK                                  |
| **Port**     | 41243+ (one per robot)                   |
| **Modes**    | Production (hardware) / Simulation (dev) |

**Key Features:**

- Natural language command interpretation
- A2A protocol compliance
- Robot state management
- Telemetry streaming
- Tool execution (navigation, manipulation)

**Architecture Pattern:** AI agent with Genkit tools for robot actions.

```
robot-agent/src/
├── agent/           # A2A agent & AI
│   ├── agent-card.ts
│   ├── agent-executor.ts
│   └── genkit.ts
├── robot/           # Robot state & telemetry
│   ├── state.ts
│   ├── telemetry.ts
│   └── types.ts
├── tools/           # Genkit AI tools
│   ├── navigation.ts
│   ├── manipulation.ts
│   └── status.ts
└── api/             # REST & WebSocket
```

---

## Communication Protocols

### A2A Protocol (Agent-to-Agent)

The primary protocol for server-robot communication, enabling multi-turn conversations and task management.

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
     │  GET /tasks/:id (polling)       │
     │────────────────────────────────>│
     │         Task Status             │
     │<────────────────────────────────│
     │                                 │
```

**Agent Card**: Each agent exposes `/.well-known/agent-card.json` describing its capabilities.

**Message Types**:

- `message/send` - Send command to agent
- `task/get` - Get task status
- `task/cancel` - Cancel running task

---

### REST API

Used for app-to-server communication and robot management.

| Endpoint                      | Method | Description        |
| ----------------------------- | ------ | ------------------ |
| `/robots`                     | GET    | List all robots    |
| `/robots/:id/register`        | POST   | Register robot     |
| `/robots/:id/command`         | POST   | Send command       |
| `/conversations`              | POST   | Start conversation |
| `/conversations/:id/messages` | POST   | Send message       |

---

### WebSocket

Real-time streaming for telemetry and events.

```
┌─────────┐         ┌──────────┐         ┌─────────────┐
│   App   │◄───────►│  Server  │◄───────►│ Robot Agent │
└─────────┘   WS    └──────────┘   WS    └─────────────┘
              │                    │
         Aggregated           Per-Robot
         Telemetry            Telemetry
```

**Events**:

- `telemetry` - Sensor data (position, battery, etc.)
- `status` - Robot status changes
- `alert` - Warning/error notifications
- `task` - Task progress updates

---

## Data Flow

### Command Flow

```
1. User enters command: "Move Robot-01 to Warehouse A"
   │
   ▼
2. App sends to Server: POST /robots/robot-01/command
   │
   ▼
3. Server creates A2A conversation with Robot Agent
   │
   ▼
4. Robot Agent's Gemini AI interprets command
   │
   ▼
5. Genkit tool executes: navigation.move_to_location()
   │
   ▼
6. Robot hardware moves (or simulation updates)
   │
   ▼
7. Telemetry streams position updates via WebSocket
   │
   ▼
8. App displays real-time robot movement on map
```

### Telemetry Flow

```
Robot Sensors
     │
     ▼ (100ms intervals)
Robot Agent generates telemetry
     │
     ▼ (WebSocket)
Server aggregates from all robots
     │
     ▼ (WebSocket)
App updates UI (position, battery, status)
```

---

## Deployment Architecture

### Development

```
┌──────────────────────────────────────────────────┐
│                  Developer Machine               │
│                                                  │
│  ┌─────────┐   ┌─────────┐   ┌──────────────┐   │
│  │   App   │   │ Server  │   │ Robot Agent  │   │
│  │  :1420  │   │  :3000  │   │ :41243-41250 │   │
│  └─────────┘   └─────────┘   └──────────────┘   │
│       │             │               │            │
│       └─────────────┴───────────────┘            │
│                 localhost                        │
└──────────────────────────────────────────────────┘
```

### Production

```
┌─────────────────────────────────────────────────────────────┐
│                         CLOUD                                │
│  ┌─────────────────┐        ┌─────────────────────────┐     │
│  │   CDN / Edge    │        │     Server Cluster      │     │
│  │  (App Assets)   │        │  (Load Balanced A2A)    │     │
│  └─────────────────┘        └───────────┬─────────────┘     │
│                                         │                    │
└─────────────────────────────────────────┼────────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
                    ▼                     ▼                     ▼
            ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
            │   Robot 1   │       │   Robot 2   │       │   Robot N   │
            │   (Local)   │       │   (Local)   │       │   (Local)   │
            └─────────────┘       └─────────────┘       └─────────────┘
```

---

## Security Architecture

### Current State (Development)

- No authentication (all endpoints open)
- No encryption (HTTP, not HTTPS)
- In-memory storage (no persistence)

### Planned (Production)

```
┌─────────────────────────────────────────────────────────────┐
│                      SECURITY LAYERS                         │
├─────────────────────────────────────────────────────────────┤
│  Authentication                                              │
│  ├── JWT tokens for user sessions                           │
│  ├── API keys for robot agents                              │
│  └── OAuth2 for third-party integrations                    │
├─────────────────────────────────────────────────────────────┤
│  Authorization                                               │
│  ├── Role-based access (Admin, Operator, Viewer)            │
│  ├── Robot-level permissions                                │
│  └── Zone-based restrictions                                │
├─────────────────────────────────────────────────────────────┤
│  Transport                                                   │
│  ├── TLS/HTTPS for all connections                          │
│  ├── WSS for WebSocket                                      │
│  └── Certificate pinning for robots                         │
├─────────────────────────────────────────────────────────────┤
│  Safety                                                      │
│  ├── Command validation and sanitization                    │
│  ├── Rate limiting                                          │
│  ├── Emergency stop override                                │
│  └── Audit logging                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Technology Stack Summary

| Layer         | Technology                  | Purpose             |
| ------------- | --------------------------- | ------------------- |
| **Frontend**  | React, TypeScript, Tailwind | UI                  |
| **Desktop**   | Tauri 2.0 (Rust)            | Native wrapper      |
| **Mobile**    | Capacitor                   | iOS/Android         |
| **Server**    | Node.js, Express            | API & orchestration |
| **Protocol**  | A2A                         | Agent communication |
| **AI**        | Genkit, Gemini              | NL interpretation   |
| **Real-time** | WebSocket                   | Telemetry streaming |
| **Database**  | SQLite/PostgreSQL (planned) | Persistence         |

---

## Related Documentation

- [Frontend Architecture](./app-architecture.md) - Detailed React/Tauri patterns
- [PRD](./prd.md) - Product requirements
- [Brand Guide](./brand.md) - Visual design system
- [A2A Protocol](./humanoid-robot-communication-protocols.md) - Protocol details
