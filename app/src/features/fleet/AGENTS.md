# AGENTS.md - Fleet Feature

Fleet-wide operations and management.

## Purpose

Provides fleet-level view and bulk operations for managing multiple robots simultaneously.

## Structure

```
fleet/
├── components/
│   ├── SiteMap.tsx              # Twin top-down: zones, bound robots, zone E-stop
│   └── FleetStats.tsx           # Fleet statistics
├── hooks/
│   └── useFleetStatus.ts        # Fleet status derived from robots + alerts
├── pages/
│   └── FleetPage.tsx            # Main fleet page
├── types/
│   └── fleet.types.ts           # TypeScript types
└── index.ts
```

Fleet zones no longer exist here (TASK-334): zones are authored on a digital
twin (`features/digitaltwin`) and `SiteMap` reads them from there.

## Key Components

| Component | Purpose |
|-----------|---------|
| `FleetPage` | Main fleet management page |
| `FleetOverview` | Summary of all robots |
| `SiteMap` | Fleet > Map and the dashboard: a twin top-down (`digitaltwin/components/TwinTopDown`) with its zones, the site-aligned robots bound to it, and zone E-stop by click |
| `BulkActions` | Execute commands on multiple robots |

## Key Types

```typescript
interface FleetSummary {
  totalRobots: number;
  online: number;
  offline: number;
  busy: number;
  charging: number;
  error: number;
}

interface FleetOperation {
  id: string;
  type: 'recall' | 'charge' | 'stop' | 'custom';
  targetRobots: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}
```

## Store Actions

- `fetchFleetSummary()` - Load fleet statistics
- `executeFleetOperation(operation)` - Run bulk operation
- `selectRobots(ids)` - Select robots for operations

## API Endpoints Used

- `GET /api/fleet/summary` - Fleet statistics
- `POST /api/fleet/operations` - Execute bulk operation
