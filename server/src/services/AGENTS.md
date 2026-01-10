# AGENTS.md - Server Services

Business logic layer with singleton service classes.

## Overview

Services encapsulate business logic and data access. Most are singleton instances with static `getInstance()` method.

## Service Files

| Service | Purpose |
|---------|---------|
| `RobotManager.ts` | Robot registration and state |
| `ConversationManager.ts` | A2A conversation handling |
| `A2AClient.ts` | HTTP client for robot communication |
| `ComplianceLogService.ts` | Compliance logging with hash chain |
| `RetentionPolicyService.ts` | Retention policy management |
| `LegalHoldService.ts` | Legal hold management |
| `RopaService.ts` | RoPA (GDPR Art. 30) management |
| `ProviderDocumentationService.ts` | Technical documentation |
| `CommandInterpreter.ts` | AI command processing |
| `LogExportService.ts` | Log export functionality |

## Service Pattern

```typescript
class FeatureService {
  private static instance: FeatureService;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): FeatureService {
    if (!FeatureService.instance) {
      FeatureService.instance = new FeatureService();
    }
    return FeatureService.instance;
  }

  async getAll(): Promise<Item[]> {
    return prisma.item.findMany();
  }

  async create(data: CreateInput): Promise<Item> {
    return prisma.item.create({ data });
  }
}

export const featureService = FeatureService.getInstance();
```

## Key Services

### ComplianceLogService

Manages tamper-evident audit trail:

```typescript
// Log an event
await complianceLogService.logEvent({
  sessionId: 'session-123',
  robotId: 'robot-001',
  eventType: 'ai_decision',
  severity: 'info',
  payload: { description: 'Command executed' },
});

// Verify hash chain
const result = await complianceLogService.verifyHashChain();
// Returns: { isValid: true, totalLogs: 100, verifiedLogs: 100, brokenLinks: [] }
```

### ProviderDocumentationService

Manages technical documentation:

```typescript
// Add documentation
await providerDocService.addDocumentation({
  providerName: 'RoboMindOS',
  modelVersion: '1.0.0',
  documentType: 'sbom',
  content: 'SBOM content...',
  validFrom: new Date(),
});

// Get valid documentation
const docs = await providerDocService.getValidDocumentation();
```

### RetentionPolicyService

Manages data retention:

```typescript
// Set retention policy
await retentionService.setPolicy({
  eventType: 'ai_decision',
  retentionDays: 3650, // 10 years
  description: 'EU AI Act requirement',
});

// Run cleanup
const { deleted, skipped } = await retentionService.runCleanup();
```

### RobotManager

Manages robot fleet:

```typescript
// Register robot
await robotManager.registerRobot({
  id: 'robot-001',
  name: 'SimBot-01',
  agentUrl: 'http://localhost:41243',
});

// Send command
const result = await robotManager.sendCommand('robot-001', 'move to warehouse');
```

## Database Access

Services use Prisma client from `repositories/index.ts`:

```typescript
import { prisma } from '../repositories';

const logs = await prisma.complianceLog.findMany({
  where: { eventType: 'ai_decision' },
  orderBy: { timestamp: 'desc' },
});
```

## Error Handling

Services should throw typed errors:

```typescript
class ServiceError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

throw new ServiceError('Robot not found', 'ROBOT_NOT_FOUND');
```
