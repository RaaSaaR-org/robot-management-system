# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with the NeoDEM server.

## Project Overview

The A2A Protocol Server is the backend for NeoDEM. It implements the A2A (Agent-to-Agent) protocol to enable communication between the frontend application and robot agents. The server manages robot registration, conversations, tasks, zones, alerts, processes, compliance logging, incident management, GDPR, VLA training pipelines, and real-time events via WebSocket. Data is persisted via Prisma ORM (SQLite locally, PostgreSQL in production). The schema has 73 models.

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
- **Database**: Prisma ORM — SQLite (dev) or PostgreSQL (production) via `DATABASE_URL`
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
├── routes/               # 37 route files organized by domain
│   ├── auth.routes.ts         # Authentication
│   ├── robot.routes.ts        # Robot management
│   ├── alert.routes.ts        # Alert CRUD
│   ├── zone.routes.ts         # Zone/facility management
│   ├── command.routes.ts      # NL command interpretation
│   ├── process.routes.ts      # Process/workflow management
│   ├── patrol.routes.ts       # Patrol routes/runs/findings + photos (TASK-212)
│   ├── safety.routes.ts       # Safety monitoring
│   ├── conversation.routes.ts # A2A conversations
│   ├── message.routes.ts      # A2A messages
│   ├── task.routes.ts         # A2A tasks
│   ├── agent.routes.ts        # A2A agent discovery
│   ├── wellknown.routes.ts    # /.well-known/a2a
│   ├── compliance-log.routes.ts    # Compliance audit logs
│   ├── retention.routes.ts         # Retention policies
│   ├── legal-hold.routes.ts        # Legal holds
│   ├── ropa.routes.ts              # GDPR Art. 30 (RoPA)
│   ├── provider-docs.routes.ts     # Provider documentation
│   ├── compliance-tracker.routes.ts # Compliance dashboard
│   ├── gdpr.routes.ts              # GDPR self-service
│   ├── incident.routes.ts          # Incident management
│   ├── oversight.routes.ts         # Human oversight
│   ├── approval.routes.ts          # Approval workflows
│   ├── explainability.routes.ts    # AI decision transparency
│   ├── datasets.routes.ts          # Dataset management
│   ├── training.routes.ts          # Training jobs
│   ├── models.routes.ts            # Model registry
│   ├── deployments.routes.ts       # Fleet deployments
│   ├── skills.routes.ts            # Skill library
│   ├── embodiments.routes.ts       # Embodiment configs
│   ├── storage.routes.ts           # Object storage
│   ├── teleoperation.routes.ts     # Teleoperation
│   ├── training-docs.routes.ts     # Training documentation
│   ├── curation.routes.ts          # Data curation
│   ├── active-learning.routes.ts   # Active learning
│   ├── synthetic.routes.ts         # Synthetic data
│   ├── federated.routes.ts         # Federated learning
│   └── contributions.routes.ts     # Data contributions
├── services/             # 45 service files (singletons)
│   ├── RobotManager.ts        # Robot registry, health checks
│   ├── ConversationManager.ts # A2A conversations, orchestration
│   ├── AuthService.ts         # JWT auth
│   ├── AlertService.ts        # Alert CRUD + WebSocket
│   ├── ZoneService.ts         # Zone CRUD + geometry
│   ├── CommandInterpreter.ts  # NL → structured command (Gemini)
│   ├── ProcessManager.ts      # Multi-step workflow engine
│   ├── PatrolService.ts       # Patrol CRUD, ingest → alerts, proxies (TASK-212)
│   ├── PatrolSchedulerService.ts # Cron-fired patrols (utils/cron.ts shared with ProcessScheduler)
│   ├── PatrolPhotoStore.ts    # Patrol photos (S3 bucket or local dir)
│   ├── TaskDistributor.ts     # Push-model task scheduler
│   ├── SafetyService.ts       # Safety monitoring
│   ├── ComplianceLogService.ts     # Audit logging
│   ├── ComplianceTrackerService.ts # Compliance dashboard
│   ├── RetentionPolicyService.ts   # Retention management
│   ├── LegalHoldService.ts         # Legal holds
│   ├── RopaService.ts              # GDPR Art. 30
│   ├── ProviderDocumentationService.ts
│   ├── GDPRRequestService.ts       # GDPR self-service
│   ├── ConsentService.ts           # Consent management
│   ├── DataRestrictionService.ts   # Data restrictions
│   ├── IncidentService.ts          # Incident management
│   ├── NotificationWorkflowService.ts
│   ├── BreachAssessmentService.ts
│   ├── OversightService.ts         # Human oversight
│   ├── ApprovalWorkflowService.ts  # Approval workflows
│   ├── ExplainabilityService.ts    # AI decision transparency
│   ├── DatasetService.ts           # Dataset management
│   ├── DataQualityService.ts       # Data quality
│   ├── DataCurationService.ts      # Data curation
│   ├── DataAugmentationService.ts
│   ├── DataContributionService.ts
│   ├── TrainingJobService.ts       # Training jobs
│   ├── TrainingOrchestrator.ts     # Training pipeline
│   ├── ModelRegistryService.ts     # Model registry writes + skill link both ways (TASK-238)
│   ├── TrainingDataDocService.ts
│   ├── DeploymentService.ts        # Fleet deployment
│   ├── DeploymentMetricsService.ts
│   ├── SkillLibraryService.ts      # Skill library
│   ├── SkillExecutionService.ts
│   ├── EmbodimentService.ts        # Embodiment configs
│   ├── TeleoperationService.ts
│   ├── ActiveLearningService.ts
│   ├── SyntheticDataService.ts
│   ├── FederatedLearningService.ts
│   ├── A2AClient.ts, HttpClient.ts, LogExportService.ts
│   └── ...
├── repositories/         # 18 repositories (Prisma data access)
│   ├── RobotRepository.ts, AlertRepository.ts, ZoneRepository.ts
│   ├── ConversationRepository.ts, TaskRepository.ts, AgentRepository.ts
│   ├── UserRepository.ts, RefreshTokenRepository.ts, CommandRepository.ts
│   ├── ProcessRepository.ts, RobotTaskRepository.ts, EventRepository.ts
│   ├── ComplianceLogRepository.ts, DecisionRepository.ts
│   ├── IncidentRepository.ts, OversightRepository.ts
│   ├── ApprovalRepository.ts, VLARepository.ts
│   └── index.ts
├── database/             # Prisma client, schemas, seeds
├── middleware/            # JWT auth middleware
├── interfaces/            # Service interfaces for DI/testing
├── websocket/             # WebSocket server (event broadcast)
├── types/                 # 24 type definition files
├── utils/                 # Error hierarchy (AppError + subclasses)
├── storage/               # RustFS/S3-compatible object storage client
├── messaging/             # NATS messaging (job queues, KV, streams)
├── jobs/                  # Background jobs (retention cleanup, storage)
├── workers/               # Worker threads (dataset validation, training)
└── security/              # Encryption utilities
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

### Patrol (`/api/patrol` + `/api/robots`, TASK-212) — auth required

Routes are the source of record (Prisma `PatrolRoute`/`PatrolRun`/`PatrolFinding`, tenant-scoped);
the robot executes and reports via `POST /api/robots/:id/agent-mode/events` (`agent:patrol:*`,
`agent:finding:*`), which `PatrolService.ingest` persists and turns into alerts (one per finding,
one warning per skipped run) + compliance `system_event`s. Ingest is serialised per `runId` and
refuses stale run snapshots (a late `leg` can never move a finished run back to `running`).
`PatrolSchedulerService` fires
cron-scheduled routes every 30 s (`PATROL_SCHEDULER_ENABLED`, retry once after `PATROL_RETRY_MIN`).

| Method | Path                                                  | Description                                            |
| ------ | ----------------------------------------------------- | ------------------------------------------------------ |
| GET    | `/api/patrol/routes?robotId=`                         | List routes                                            |
| POST   | `/api/patrol/routes`                                  | Create route (name, robotId?, checkpoints, cronExpression?, enabled?, timeWindows?, homePlaceId?) |
| GET    | `/api/patrol/routes/:id`                              | Get route                                              |
| PUT    | `/api/patrol/routes/:id`                              | Update route (partial)                                 |
| DELETE | `/api/patrol/routes/:id`                              | Delete route (runs + findings are kept: `PatrolRun.routeId` has no FK) |
| GET    | `/api/patrol/routes/:id/export/vda5050.json`          | VDA5050-style order (nodes = checkpoints, edges)       |
| GET    | `/api/patrol/routes/:id/baseline?window=`             | Latest baseline run + photo keys per checkpoint        |
| POST   | `/api/patrol/routes/:id/start`                        | `{robotId?, mode, origin?}` → PatrolStartResult (502 + skipped run when unreachable) |
| POST   | `/api/patrol/routes/:id/abort`                        | `{robotId?, reason?}` → `{ok, runId?}`                 |
| POST   | `/api/patrol/cron/validate`                           | `{cronExpression}` → `{valid, nextRuns[5], error?}`    |
| GET    | `/api/patrol/places?robotId=`                         | Robot's known places (proxy `GET /api/v1/robots/:id/places`) |
| GET    | `/api/patrol/runs?routeId=&robotId=&status=&limit=`   | Runs, newest first                                     |
| GET    | `/api/patrol/runs/:runId`                             | Run + findings                                         |
| POST   | `/api/patrol/runs/:runId/promote`                     | Make this run the baseline (proxy to robot)            |
| GET    | `/api/patrol/findings?status=&routeId=&robotId=&runId=` | Findings                                             |
| GET    | `/api/patrol/findings/:id`                            | Finding                                                |
| POST   | `/api/patrol/findings/:id/acknowledge`                | Status acknowledged (+ its alert)                      |
| POST   | `/api/patrol/findings/:id/normal`                     | Status dismissed_normal, robot baseline taught (`robotNotified`) |
| POST   | `/api/patrol/findings/:id/escalate`                   | Status escalated (+ incident when available)           |
| POST   | `/api/robots/:id/agent-mode/patrol`                   | `{routeId, mode?, origin?}` — spec-named start alias   |
| POST   | `/api/robots/:id/agent-mode/patrol/abort`             | Abort on that robot                                    |
| PUT    | `/api/robots/:id/patrol-runs/:runId/photos/:key`      | Robot photo upload `{imageB64, contentType, kind, checkpointId, routeId, capturedAt}` |
| GET    | `/api/robots/:id/patrol-runs/:runId/photos/:key`      | Photo (image/jpeg) for the UI                          |
| GET    | `/api/robots/:id/patrol-runs/:runId/photos`           | Photo metadata list for a run                          |

Photos: `PatrolPhotoStore` — S3 bucket `patrol-photos` when RustFS is configured, else
`PATROL_PHOTO_DIR` (default `./data/patrol-photos`). Retention sweep hourly
(`src/jobs/patrol-photo-cleanup.ts`): control 72 h (`PATROL_PHOTO_RETENTION_H`), baseline/finding
30 d (`PATROL_PHOTO_RETENTION_DAYS`).

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

### Compliance & Governance

- `/api/compliance` — Compliance audit logs (CRUD, chain verification, export)
- `/api/compliance/retention` — Retention policies
- `/api/compliance/legal-holds` — Legal holds on audit logs
- `/api/compliance/ropa` — GDPR Art. 30 Records of Processing Activities
- `/api/compliance/providers` — Provider documentation
- `/api/compliance/tracker` — Compliance dashboard (gaps, deadlines, risk assessments)
- `/api/gdpr` — GDPR self-service (data access/deletion/portability requests)
- `/api/incidents` — Incident management & regulatory reporting
- `/api/oversight` — Human oversight dashboard (anomaly detection)
- `/api/approvals` — Human approval workflows
- `/api/explainability` — AI decision transparency
- `/api/safety` — Safety monitoring

### ML & Training Pipeline

- `/api/datasets` — Dataset management
- `/api/training` — Training job orchestration
- `/api/models` — Model registry (versions, metrics, lineage, checkpoints)
- `/api/deployments` — Fleet deployment (canary, blue-green, rolling)
- `/api/skills` — Skill library management
- `/api/embodiments` — Robot type/embodiment configs
- `/api/storage` — Object storage (presigned URLs)
- `/api/teleoperation` — Teleoperation sessions
- `/api/curation` — Data curation pipelines
- `/api/active-learning` — Active learning strategies
- `/api/synthetic` — Synthetic data generation
- `/api/federated` — Federated learning
- `/api/contributions` — Data contribution portal
- `/api/training-docs` — Training data documentation

### WebSocket

- `ws://localhost:3001/api/a2a/ws` - Real-time event streaming

**Outbound events**: `robot_registered`, `robot_unregistered`, `robot_status_changed`, `robot_telemetry`, `robot_health_check`, `alert_created`, `alert_acknowledged`, `alert_deleted`, `zone_created`, `zone_updated`, `zone_deleted`, `task_event`, `process:*`, `task:*`, `robot:work_assigned`, `agent:*` (incl. `agent:patrol:started|leg|finished` carrying `patrol`, `agent:finding:detected|confirmed` carrying `finding` + `patrol`)

**Inbound messages**: `ping` (returns pong), `subscribe` (subscribes to all events)

## Development Guidelines

### Service Pattern

Services are singleton managers with DB-backed persistence. Core services:

| Service | Singleton | Purpose |
|---------|-----------|---------|
| `RobotManager` | `robotManager` | Robot registry, health checks (30s), command forwarding |
| `ConversationManager` | `conversationManager` | A2A conversations, orchestration, agent routing |
| `AuthService` | `authService` | JWT auth (access 15m, refresh 7d) |
| `AlertService` | `alertService` | Alert CRUD, WebSocket broadcast |
| `ZoneService` | `zoneService` | Zone CRUD, geometry validation |
| `CommandInterpreter` | `commandInterpreter` | NL → structured command (Gemini, keyword fallback) |
| `ProcessManager` | `processManager` | Multi-step workflow engine |
| `TaskDistributor` | `taskDistributor` | Push-model task scheduler (2s interval) |

Additional service groups (45 total):
- **Compliance**: `ComplianceLogService`, `ComplianceTrackerService`, `RetentionPolicyService`, `LegalHoldService`, `RopaService`, `ProviderDocumentationService`
- **GDPR**: `GDPRRequestService`, `ConsentService`, `DataRestrictionService`
- **Incidents**: `IncidentService`, `NotificationWorkflowService`, `BreachAssessmentService`
- **Oversight**: `OversightService`, `ApprovalWorkflowService`, `ExplainabilityService`
- **ML/Training**: `DatasetService`, `TrainingJobService`, `TrainingOrchestrator`, `DeploymentService`, `SkillLibraryService`, `EmbodimentService`
- **Data Pipeline**: `DataQualityService`, `DataCurationService`, `DataAugmentationService`, `ActiveLearningService`, `SyntheticDataService`, `FederatedLearningService`, `DataContributionService`

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

| Package                 | Purpose                         |
| ----------------------- | ------------------------------- |
| `express`               | HTTP server framework           |
| `@prisma/client`        | Database ORM (SQLite/PostgreSQL)|
| `ws`                    | WebSocket server                |
| `jsonwebtoken`          | JWT signing/verification        |
| `bcryptjs`              | Password hashing                |
| `express-rate-limit`    | Rate limiting middleware         |
| `@google/generative-ai` | Gemini for command interpretation|
| `axios`                 | HTTP client for robot comms     |
| `nats`                  | Async messaging (optional)      |
| `@aws-sdk/client-s3`    | RustFS/S3 object storage (optional)|
| `zod` + `ajv`           | Schema validation               |
| `cors`, `uuid`, `yaml`  | Middleware, IDs, config parsing |

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
| `PATROL_SCHEDULER_ENABLED` | `true`                    | Cron-fired patrol runs (TASK-212) |
| `PATROL_RETRY_MIN` | `10`                              | Retry once after N min when a scheduled patrol was refused/unreachable |
| `PATROL_PHOTO_DIR` | `./data/patrol-photos`            | Local patrol photo dir (no RustFS) |
| `PATROL_PHOTO_RETENTION_H` | `72`                      | Control-photo retention, hours |
| `PATROL_PHOTO_RETENTION_DAYS` | `30`                   | Baseline/finding photo retention, days |

## Related Documentation

- `../docs/architecture.md` - System architecture
- `../robot-agent/AGENTS.md` - Robot agent documentation
- `../app/AGENTS.md` - Frontend documentation
