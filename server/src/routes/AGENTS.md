# AGENTS.md - Server Routes

Express route handlers for all API endpoints.

## Overview

Routes handle HTTP requests and delegate to services. Follow RESTful conventions with A2A protocol extensions.

## Route Files

| File | Base Path | Purpose |
|------|-----------|---------|
| `robot.routes.ts` | `/api/robots` | Robot management |
| `conversation.routes.ts` | `/api/conversations` | A2A conversations |
| `message.routes.ts` | `/api/messages` | A2A messages |
| `task.routes.ts` | `/api/tasks` | Robot tasks |
| `compliance-log.routes.ts` | `/api/compliance/logs` | Compliance logging |
| `retention.routes.ts` | `/api/compliance/retention` | Retention policies |
| `legal-hold.routes.ts` | `/api/compliance/legal-holds` | Legal holds |
| `ropa.routes.ts` | `/api/compliance/ropa` | RoPA management |
| `provider-docs.routes.ts` | `/api/compliance/providers` | Technical documentation |
| `decision.routes.ts` | `/api/decisions` | AI decisions |
| `agent.routes.ts` | `/api/agents` | Agent discovery |
| `wellknown.routes.ts` | `/.well-known` | A2A agent card |

## Route Pattern

```typescript
import { Router, Request, Response } from 'express';

const router = Router();

// GET list
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await service.getAll();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch' });
  }
});

// GET by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await service.getById(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch' });
  }
});

// POST create
router.post('/', async (req: Request, res: Response) => {
  try {
    const result = await service.create(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create' });
  }
});

export { router as featureRoutes };
```

## Key Endpoints

### Robot Management (`robot.routes.ts`)
- `GET /api/robots` - List all robots
- `GET /api/robots/:id` - Get robot by ID
- `POST /api/robots/:id/register` - Register robot
- `POST /api/robots/:id/command` - Send command
- `DELETE /api/robots/:id` - Unregister robot

### Compliance (`compliance-log.routes.ts`)
- `GET /api/compliance/logs` - List logs (paginated)
- `GET /api/compliance/logs/:id` - Get log by ID
- `GET /api/compliance/verify` - Verify hash chain
- `GET /api/compliance/metrics` - Log metrics

### Technical Docs (`provider-docs.routes.ts`)
- `GET /api/compliance/providers` - List providers
- `GET /api/compliance/providers/docs` - All documents
- `GET /api/compliance/providers/docs/:id` - Get document
- `POST /api/compliance/providers/docs` - Create document
- `PUT /api/compliance/providers/docs/:id` - Update document
- `DELETE /api/compliance/providers/docs/:id` - Delete document
- `GET /api/compliance/providers/public/conformity` - Public conformity (no auth)

### AI Decisions (`decision.routes.ts`)
- `GET /api/decisions` - List decisions
- `GET /api/decisions/:id` - Decision with factors
- `GET /api/decisions/metrics` - Decision stats

## Mounting Routes

Routes are mounted in `app.ts`:

```typescript
app.use('/api/robots', robotRoutes);
app.use('/api/compliance/logs', complianceLogRoutes);
app.use('/api/compliance/retention', retentionRoutes);
app.use('/api/decisions', decisionRoutes);
```
