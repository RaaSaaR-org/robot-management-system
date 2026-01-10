# AGENTS.md - Fleet Feature

Fleet-wide operations and management.

## Purpose

Provides fleet-level view and bulk operations for managing multiple robots simultaneously.

## Structure

```
fleet/
├── api/
│   └── fleetApi.ts          # API calls
├── components/
│   ├── FleetOverview.tsx        # Fleet summary dashboard
│   ├── FleetMap.tsx             # Spatial robot visualization
│   ├── BulkActions.tsx          # Multi-robot operations
│   └── FleetStats.tsx           # Fleet statistics
├── pages/
│   └── FleetPage.tsx            # Main fleet page
├── store/
│   └── fleetStore.ts            # Zustand store
├── types/
│   └── fleet.types.ts           # TypeScript types
└── index.ts
```

## Key Components

| Component | Purpose |
|-----------|---------|
| `FleetPage` | Main fleet management page |
| `FleetOverview` | Summary of all robots |
| `FleetMap` | Visual map of robot locations |
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
