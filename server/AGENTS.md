# AGENTS.md - Server Application

This file provides guidance for AI agents working with the RoboMindOS server.

## Overview

Node.js backend implementing A2A (Agent-to-Agent) protocol with Prisma database, compliance logging, and real-time WebSocket communication.

## Commands

```bash
npm run dev          # Start server with hot reload (tsx watch)
npm run build        # Compile TypeScript to dist/
npm start            # Run production build
npm run typecheck    # Run TypeScript compiler
npx prisma migrate dev    # Run database migrations
npx prisma generate       # Generate Prisma client
```

## Architecture

| Layer | Technology | Purpose |
|-------|------------|---------|
| Framework | Express.js | HTTP server |
| Database | Prisma + SQLite | Data persistence |
| Protocol | A2A SDK | Robot communication |
| Real-time | WebSocket (ws) | Telemetry streaming |
| Language | TypeScript (ESM) | Type safety |

**Default Port**: 3001

## Project Structure

```
src/
├── index.ts              # Server entry point
├── app.ts                # Express app setup, middleware
├── routes/               # API endpoints (see routes/AGENTS.md)
│   ├── robot.routes.ts         # Robot management
│   ├── conversation.routes.ts  # A2A conversations
│   ├── compliance-log.routes.ts # Compliance logging
│   ├── retention.routes.ts     # Retention policies
│   ├── legal-hold.routes.ts    # Legal holds
│   ├── ropa.routes.ts          # RoPA management
│   ├── provider-docs.routes.ts # Technical documentation
│   └── decision.routes.ts      # AI decisions
├── services/             # Business logic (see services/AGENTS.md)
│   ├── RobotManager.ts         # Robot state management
│   ├── ConversationManager.ts  # A2A conversations
│   ├── ComplianceLogService.ts # Compliance logging
│   ├── RetentionPolicyService.ts # Retention management
│   ├── LegalHoldService.ts     # Legal hold management
│   ├── RopaService.ts          # RoPA management
│   ├── ProviderDocumentationService.ts # Tech docs
│   └── CommandInterpreter.ts   # AI command processing
├── repositories/         # Database access layer
│   ├── index.ts                # Prisma client export
│   └── ComplianceLogRepository.ts
├── types/                # TypeScript definitions
│   ├── index.ts                # Core types
│   ├── compliance.types.ts     # Compliance types
│   └── retention.types.ts      # Retention/document types
├── jobs/                 # Background jobs
│   └── RetentionCleanupJob.ts  # Scheduled cleanup
├── security/             # Security utilities
│   └── HashChain.ts            # Cryptographic hash chain
└── websocket/            # Real-time communication
    └── index.ts                # WebSocket server
```

## Database (Prisma)

Schema location: `prisma/schema.prisma`

### Key Models

| Model | Purpose |
|-------|---------|
| `ComplianceLog` | Tamper-evident audit trail |
| `Decision` | AI decision records with explainability |
| `RetentionPolicy` | Per-event-type retention rules |
| `LegalHold` | Litigation hold records |
| `RopaEntry` | GDPR processing activities |
| `ProviderDocumentation` | Technical documentation |

### Database Commands

```bash
npx prisma migrate dev     # Create/apply migrations
npx prisma migrate reset   # Reset database
npx prisma studio          # Open database GUI
npx prisma generate        # Regenerate client
```

## Key API Endpoints

### Robot Management
- `GET /api/robots` - List robots
- `POST /api/robots/:id/register` - Register robot
- `POST /api/robots/:id/command` - Send command

### Compliance Logging
- `GET /api/compliance/logs` - List compliance logs
- `GET /api/compliance/verify` - Verify hash chain
- `GET /api/compliance/metrics` - Log metrics

### Retention & Legal Hold
- `GET /api/compliance/retention` - List retention policies
- `PUT /api/compliance/retention/:eventType` - Set policy
- `POST /api/compliance/legal-holds` - Create hold

### RoPA (GDPR Art. 30)
- `GET /api/compliance/ropa` - List processing activities
- `POST /api/compliance/ropa` - Create entry
- `GET /api/compliance/ropa/report` - Generate report

### Technical Documentation
- `GET /api/compliance/providers` - List providers
- `GET /api/compliance/providers/docs` - All documentation
- `POST /api/compliance/providers/docs` - Add document
- `GET /api/compliance/providers/public/conformity` - Public conformity (no auth)

### AI Decisions
- `GET /api/decisions` - List decisions
- `GET /api/decisions/:id` - Decision details with factors
- `GET /api/decisions/metrics` - Decision metrics

### WebSocket
- `ws://localhost:3001/api/a2a/ws` - Robot telemetry stream

## Development Guidelines

### Service Pattern

Services are singleton managers with business logic:

```typescript
class FeatureService {
  private static instance: FeatureService;

  static getInstance(): FeatureService {
    if (!FeatureService.instance) {
      FeatureService.instance = new FeatureService();
    }
    return FeatureService.instance;
  }

  async doSomething(): Promise<Result> {
    // Business logic here
  }
}
```

### Route Pattern

Routes handle HTTP and delegate to services:

```typescript
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await service.getAll();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch' });
  }
});
```

### Compliance Logging

All significant events should be logged:

```typescript
await complianceLogService.logEvent({
  sessionId,
  robotId,
  eventType: 'ai_decision',
  severity: 'info',
  payload: { description: 'Command interpreted', ... },
});
```

## Key Dependencies

- `express` - HTTP framework
- `@prisma/client` - Database ORM
- `ws` - WebSocket server
- `cors` - CORS middleware
- `uuid` - ID generation
- `node-cron` - Scheduled jobs

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `DATABASE_URL` | Prisma database URL | `file:./dev.db` |

## Related Documentation

- `prisma/schema.prisma` - Database schema
- `../docs/architecture.md` - System architecture
- `../robot-agent/AGENTS.md` - Robot agent reference
