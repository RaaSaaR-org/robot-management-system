# Deployment Feature Module

This module provides the frontend for VLA fleet deployment management, skill library browsing, and canary deployment configuration.

## Structure

```
deployment/
├── api/
│   └── deploymentApi.ts     # API client for deployments, skills, chains
├── components/
│   ├── CanaryConfig.tsx     # 5-step deployment wizard
│   ├── DeploymentCard.tsx   # Deployment summary card
│   ├── DeploymentProgress.tsx # Per-robot deployment grid
│   ├── DeploymentStatus.tsx # Full deployment status with metrics
│   ├── DeploymentStatusBadge.tsx # Status badge component
│   ├── ModelBrowser.tsx     # Model version list grouped by skill
│   ├── ModelVersionCard.tsx # Model version display card
│   ├── RobotSelector.tsx    # Multi-select for robot types/zones
│   ├── RollbackConfirmation.tsx # Rollback modal with reason
│   ├── SkillBrowser.tsx     # Skill list with filters
│   ├── SkillCard.tsx        # Skill summary card
│   ├── SkillEditor.tsx      # Skill create/edit modal
│   └── SkillStatusBadge.tsx # Skill status badge
├── hooks/
│   ├── useDeployment.ts     # Single deployment operations
│   ├── useDeploymentMetrics.ts # Metrics polling
│   ├── useDeploymentProgress.ts # WebSocket subscription
│   ├── useDeployments.ts    # Deployment list operations
│   ├── useModelVersions.ts  # Model versions fetching
│   ├── useSkillChains.ts    # Skill chain operations
│   └── useSkills.ts         # Skill CRUD operations
├── pages/
│   ├── DeploymentDetailPage.tsx # Single deployment view
│   ├── DeploymentsPage.tsx  # Deployment list/management
│   └── SkillsPage.tsx       # Skills and chains management
├── store/
│   └── deploymentStore.ts   # Zustand store with Immer
├── types/
│   └── deployment.types.ts  # TypeScript type definitions
└── index.ts                 # Public exports
```

## Key Patterns

### Store Usage

The deployment store uses Zustand with Immer for immutable updates:

```typescript
import { useDeploymentStore } from '../store';

// Select state
const deployments = useDeploymentStore((state) => state.deployments);
const isLoading = useDeploymentStore((state) => state.deploymentsLoading);

// Use actions
const { fetchDeployments, createDeployment } = useDeploymentStore();
```

### Hooks

Use the provided hooks for data fetching and state management:

```typescript
import { useDeployments } from '../hooks';

function MyComponent() {
  const { deployments, activeDeployments, fetchDeployments, createDeployment } = useDeployments();

  useEffect(() => {
    fetchDeployments();
  }, [fetchDeployments]);
}
```

### Real-time Updates

Use `useDeploymentProgress` for WebSocket subscriptions:

```typescript
import { useDeploymentProgress } from '../hooks';

function DeploymentView() {
  // Subscribes to deployment events and updates store
  useDeploymentProgress();
}
```

## API Endpoints

### Deployments
- `POST /api/deployments` - Create deployment
- `GET /api/deployments` - List deployments
- `GET /api/deployments/:id` - Get deployment
- `POST /api/deployments/:id/start` - Start deployment
- `POST /api/deployments/:id/promote` - Promote to production
- `POST /api/deployments/:id/rollback` - Rollback deployment
- `POST /api/deployments/:id/cancel` - Cancel deployment
- `GET /api/deployments/:id/metrics` - Get deployment metrics

### Skills
- `POST /api/skills` - Create skill
- `GET /api/skills` - List skills
- `GET /api/skills/:id` - Get skill
- `PUT /api/skills/:id` - Update skill
- `DELETE /api/skills/:id` - Delete skill
- `POST /api/skills/:id/publish` - Publish skill
- `POST /api/skills/:id/deprecate` - Deprecate skill
- `POST /api/skills/:id/archive` - Archive skill

### Skill Chains
- `POST /api/skills/chains` - Create chain
- `GET /api/skills/chains` - List chains
- `POST /api/skills/chains/:id/activate` - Activate chain
- `POST /api/skills/chains/:id/archive` - Archive chain

## Canary Deployment Flow

1. **Select Model** - Choose a staging model version
2. **Configure Stages** - Set traffic percentages (5% → 20% → 50% → 100%)
3. **Set Thresholds** - Define error rate, latency, failure rate limits
4. **Target Robots** - Optionally filter by robot type or zone
5. **Review & Deploy** - Confirm and start deployment

## Types

Key types defined in `types/deployment.types.ts`:

- `Deployment` - Full deployment entity
- `DeploymentStatus` - pending | deploying | canary | production | failed | rolled_back | completed | cancelled
- `SkillDefinition` - Skill with parameters and capabilities
- `SkillChain` - Sequence of skills for complex tasks
- `CanaryStage` - Traffic percentage and duration
- `RollbackThresholds` - Error, latency, failure rate limits

## Routes

- `/deployments` - Deployment list page
- `/deployments/:id` - Deployment detail page
- `/skills` - Skills management page
