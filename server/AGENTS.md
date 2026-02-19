# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with the RoboMindOS server.

## Project Overview

The A2A Protocol Server is the backend for RoboMindOS. It implements the A2A (Agent-to-Agent) protocol to enable communication between the frontend application and robot agents. The server manages robot registration, conversations, tasks, zones, alerts, processes, and real-time events via WebSocket. Data is persisted in SQLite via Prisma ORM.

## Commands

### Development

```bash
npm run dev          # Start server with hot reload (tsx watch)
```

### Build

```bash
npm run build        # Compile TypeScript to dist/
npm start            # Run production build
```

### Type Checking

```bash
npm run typecheck    # Run TypeScript compiler (noEmit mode)
```

### Database

```bash
npm run db:generate  # Generate Prisma client from schema
npm run db:push      # Push schema changes to dev database
npm run db:migrate   # Run migrations (production)
npm run db:studio    # Open Prisma Studio GUI (browser)
```

## Architecture

### Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: Prisma ORM + SQLite (configurable via `DATABASE_URL`)
- **Authentication**: JWT (bcryptjs + jsonwebtoken), disabled in dev via `AUTH_DISABLED=true`
- **Protocol**: A2A (Agent-to-Agent)
- **Real-time**: WebSocket (ws)
- **AI**: Google Gemini 2.0 Flash (NL command interpretation)
- **Language**: TypeScript (ESM modules)

### Entry Points

- **Main**: `src/index.ts` - Server bootstrap (DB connect, seed, start)
- **App**: `src/app.ts` - Express app configuration, middleware, route mounting

### Default Port

- HTTP/WebSocket: `3001` (configurable via `PORT` env)

## Project Structure

```
server/src/
├── index.ts              # Server entry point
├── app.ts                # Express app setup, middleware, route mounting
├── routes/
│   ├── auth.routes.ts         # Authentication endpoints
│   ├── robot.routes.ts        # Robot management endpoints
│   ├── alert.routes.ts        # Alert CRUD endpoints
│   ├── zone.routes.ts         # Zone/facility management
│   ├── command.routes.ts      # NL command interpretation
│   ├── process.routes.ts      # Process/workflow management
│   ├── conversation.routes.ts # A2A conversation endpoints
│   ├── message.routes.ts      # A2A message endpoints
│   ├── task.routes.ts         # A2A task endpoints
│   ├── agent.routes.ts        # A2A agent discovery endpoints
│   └── wellknown.routes.ts    # /.well-known/a2a discovery
├── services/
│   ├── AuthService.ts         # JWT auth (register, login, tokens)
│   ├── RobotManager.ts        # Robot registry, health checks, commands
│   ├── ConversationManager.ts # A2A conversations, messages, orchestration
│   ├── AlertService.ts        # Alert CRUD with WebSocket broadcast
│   ├── ZoneService.ts         # Zone CRUD with geometry validation
│   ├── CommandInterpreter.ts  # NL command → structured command (Gemini)
│   ├── ProcessManager.ts      # Multi-step workflow engine
│   ├── TaskDistributor.ts     # Push-model task scheduler (2s interval)
│   ├── A2AClient.ts           # HTTP client for robot A2A agents
│   └── HttpClient.ts          # Centralized Axios wrapper
├── repositories/
│   ├── RobotRepository.ts
│   ├── ConversationRepository.ts
│   ├── TaskRepository.ts
│   ├── AgentRepository.ts
│   ├── EventRepository.ts
│   ├── UserRepository.ts
│   ├── RefreshTokenRepository.ts
│   ├── AlertRepository.ts
│   ├── ZoneRepository.ts
│   ├── CommandRepository.ts
│   ├── ProcessRepository.ts
│   ├── RobotTaskRepository.ts
│   └── index.ts
├── database/
│   ├── client.ts             # Prisma client singleton
│   ├── index.ts              # Connect/disconnect
│   ├── schemas.ts            # Zod-based JSON parsing for DB fields
│   ├── types.ts              # DB <-> domain type converters
│   └── seedZones.ts          # Default zone seeding
├── middleware/
│   └── auth.middleware.ts    # JWT auth, optional auth, role-based access
├── interfaces/
│   ├── IRobotManager.ts      # DI interface for RobotManager
│   ├── IConversationManager.ts # DI interface for ConversationManager
│   ├── IProcessManager.ts    # DI interface for ProcessManager
│   └── index.ts
├── websocket/
│   └── index.ts              # WebSocket server (events broadcast)
├── types/
│   └── index.ts              # TypeScript type definitions
└── utils/
    └── errors.ts             # Typed error hierarchy (AppError, NotFoundError, etc.)
```

## API Endpoints

### Health Check (public)

- `GET /health` - Returns `{ status: 'ok', timestamp }`

### Authentication (`/api/auth`) — rate-limited: 20 req/15 min

| Method | Path                         | Description              |
| ------ | ---------------------------- | ------------------------ |
| POST   | `/api/auth/register`         | Register new user        |
| POST   | `/api/auth/login`            | Login (email + password) |
| POST   | `/api/auth/logout`           | Logout (requires auth)   |
| POST   | `/api/auth/refresh`          | Refresh access token     |
| GET    | `/api/auth/me`               | Get current user         |
| POST   | `/api/auth/forgot-password`  | Request password reset   |
| POST   | `/api/auth/reset-password`   | Reset with token         |
| POST   | `/api/auth/change-password`  | Change password          |

### Robots (`/api/robots`) — auth required

| Method | Path                          | Description            |
| ------ | ----------------------------- | ---------------------- |
| GET    | `/api/robots/`                | List all robots        |
| GET    | `/api/robots/:id`             | Get single robot       |
| POST   | `/api/robots/register`        | Register robot by URL  |
| DELETE | `/api/robots/:id`             | Unregister robot       |
| POST   | `/api/robots/:id/command`     | Send command to robot  |
| GET    | `/api/robots/:id/telemetry`   | Get robot telemetry    |

### Alerts (`/api/alerts`) — auth required

| Method | Path                              | Description              |
| ------ | --------------------------------- | ------------------------ |
| GET    | `/api/alerts/`                    | List alerts (filterable) |
| GET    | `/api/alerts/active`              | Unacknowledged alerts    |
| GET    | `/api/alerts/counts`              | Counts by severity       |
| GET    | `/api/alerts/history`             | Alert history            |
| GET    | `/api/alerts/:id`                 | Get single alert         |
| POST   | `/api/alerts/`                    | Create alert             |
| PATCH  | `/api/alerts/:id/acknowledge`     | Acknowledge alert        |
| DELETE | `/api/alerts/:id`                 | Delete alert             |
| DELETE | `/api/alerts/clear/acknowledged`  | Clear acknowledged       |
| DELETE | `/api/alerts/clear/all`           | Clear all alerts         |

### Zones (`/api/zones`) — auth required

| Method | Path                          | Description                     |
| ------ | ----------------------------- | ------------------------------- |
| GET    | `/api/zones/`                 | List zones (filter: floor, type)|
| GET    | `/api/zones/at-point`         | Find zone at x,y,floor         |
| GET    | `/api/zones/named-locations`  | Zone centers as named locations |
| GET    | `/api/zones/floor/:floor`     | All zones on a floor            |
| GET    | `/api/zones/:id`              | Get single zone                 |
| POST   | `/api/zones/`                 | Create zone                     |
| PUT    | `/api/zones/:id`              | Update zone                     |
| DELETE | `/api/zones/:id`              | Delete zone                     |

### Command Interpretation (`/api/command`) — auth required

| Method | Path                       | Description                 |
| ------ | -------------------------- | --------------------------- |
| POST   | `/api/command/interpret`   | Interpret NL command (Gemini) |
| GET    | `/api/command/history`     | Command history              |
| GET    | `/api/command/:id`         | Get single interpretation    |
| PATCH  | `/api/command/:id/status`  | Update command status        |

### Processes (`/api/processes`) — auth required

| Method | Path                                    | Description              |
| ------ | --------------------------------------- | ------------------------ |
| GET    | `/api/processes/`                       | List process definitions |
| POST   | `/api/processes/`                       | Create definition        |
| GET    | `/api/processes/:id`                    | Get definition           |
| PUT    | `/api/processes/:id`                    | Update definition        |
| POST   | `/api/processes/:id/publish`            | Publish definition       |
| POST   | `/api/processes/:id/start`              | Start process instance   |
| GET    | `/api/processes/instances/list`         | List instances           |
| GET    | `/api/processes/instances/:id`          | Get instance             |
| PUT    | `/api/processes/instances/:id/pause`    | Pause instance           |
| PUT    | `/api/processes/instances/:id/resume`   | Resume instance          |
| PUT    | `/api/processes/instances/:id/cancel`   | Cancel instance          |
| GET    | `/api/processes/tasks/list`             | List robot tasks         |
| POST   | `/api/processes/tasks`                  | Create robot task        |
| PUT    | `/api/processes/tasks/:id/status`       | Update task status       |
| GET    | `/api/processes/tasks/queue/stats`      | Queue statistics         |

### A2A Protocol (`/api/a2a/*`) — auth required

| Method | Path                              | Description                  |
| ------ | --------------------------------- | ---------------------------- |
| POST   | `/api/a2a/conversation/create`    | Create conversation          |
| POST   | `/api/a2a/conversation/list`      | List conversations           |
| GET    | `/api/a2a/conversation/:id`       | Get conversation             |
| DELETE | `/api/a2a/conversation/:id`       | Delete conversation          |
| POST   | `/api/a2a/message/send`           | Send message to agent        |
| POST   | `/api/a2a/message/orchestrate`    | Auto-route via orchestrator  |
| POST   | `/api/a2a/message/list`           | List messages                |
| POST   | `/api/a2a/agent/register`         | Register external agent      |
| POST   | `/api/a2a/agent/list`             | List registered agents       |
| GET    | `/api/a2a/agent/:name`            | Get agent by name            |
| DELETE | `/api/a2a/agent/:name`            | Unregister agent             |
| POST   | `/api/a2a/task/list`              | List A2A tasks               |
| GET    | `/api/a2a/task/:id`               | Get A2A task                 |

### Well-Known (public)

| Method | Path                                            | Description              |
| ------ | ----------------------------------------------- | ------------------------ |
| GET    | `/.well-known/a2a/`                             | Discovery endpoint       |
| GET    | `/.well-known/a2a/agent_card.json`              | Fleet-level agent card   |
| GET    | `/.well-known/a2a/robots/:robotId/agent_card.json` | Per-robot agent card  |

### WebSocket

- `ws://localhost:3001/api/a2a/ws` - Real-time event streaming

**Outbound events**: `robot_registered`, `robot_unregistered`, `robot_status_changed`, `robot_telemetry`, `robot_health_check`, `alert_created`, `alert_acknowledged`, `alert_deleted`, `zone_created`, `zone_updated`, `zone_deleted`, `task_event`, `process:*`, `task:*`, `robot:work_assigned`

**Inbound messages**: `ping` (returns pong), `subscribe` (subscribes to all events)

## Development Guidelines

### Service Pattern

Services are singleton managers with DB-backed persistence:

| Service | Singleton | Purpose |
|---------|-----------|---------|
| `RobotManager` | `robotManager` | Robot registry, health checks (30s), command forwarding |
| `ConversationManager` | `conversationManager` | A2A conversations, orchestration, agent routing |
| `AuthService` | `authService` | JWT auth (access 15m, refresh 7d) |
| `AlertService` | `alertService` | Alert CRUD, WebSocket broadcast |
| `ZoneService` | `zoneService` | Zone CRUD, geometry validation |
| `CommandInterpreter` | `commandInterpreter` | NL -> structured command (Gemini, keyword fallback) |
| `ProcessManager` | `processManager` | Multi-step workflow engine |
| `TaskDistributor` | `taskDistributor` | Push-model task scheduler (2s interval) |

### Repository Pattern

All data access goes through repositories in `repositories/`. Each wraps Prisma queries and handles JSON field serialization via `database/schemas.ts` and `database/types.ts`.

### Middleware

- **`authMiddleware`**: Validates JWT Bearer token. When `AUTH_DISABLED=true`, injects mock admin user.
- **`roleMiddleware(...roles)`**: Role-based access (`admin`, `operator`, `viewer`).
- **Rate limiting**: 100 req/min on `/api/*`, 20 req/15 min on `/api/auth`.

### Error Handling

Typed error hierarchy in `utils/errors.ts`: `BadRequestError`, `AuthenticationError`, `NotFoundError`, `ConflictError`, `ValidationError`, etc. All extend `AppError` with HTTP status code and error code.

### File Header Convention

```typescript
/**
 * @file filename.ts
 * @description One-line purpose description
 */
```

## Key Dependencies

| Package                 | Purpose                        |
| ----------------------- | ------------------------------ |
| `express`               | HTTP server framework          |
| `@prisma/client`        | Database ORM                   |
| `ws`                    | WebSocket server               |
| `jsonwebtoken`          | JWT signing/verification       |
| `bcryptjs`              | Password hashing               |
| `express-rate-limit`    | Rate limiting middleware        |
| `@google/generative-ai` | Gemini for command interpretation |
| `axios`                 | HTTP client for robot comms    |
| `cors`                  | CORS middleware                 |
| `uuid`                  | ID generation                  |
| `zod`                   | Schema validation              |

## Environment Variables

| Variable           | Default                           | Description                    |
| ------------------ | --------------------------------- | ------------------------------ |
| `PORT`             | `3001`                            | Server port                    |
| `DATABASE_URL`     | `file:./dev.db`                   | Prisma connection string       |
| `JWT_SECRET`       | `dev-secret-change-in-production` | JWT signing key                |
| `JWT_ACCESS_EXPIRES` | `15m`                           | Access token TTL               |
| `JWT_REFRESH_EXPIRES` | `7d`                           | Refresh token TTL              |
| `AUTH_DISABLED`    | `true` (dev)                      | Bypass JWT auth in development |
| `GOOGLE_API_KEY`   | —                                 | Gemini API key (NL commands)   |
| `CORS_ORIGINS`     | `localhost:1420,5173,3000`        | Comma-separated CORS origins   |

## Related Documentation

- `../docs/architecture.md` - System architecture
- `../robot-agent/AGENTS.md` - Robot agent documentation
- `../app/AGENTS.md` - Frontend documentation
