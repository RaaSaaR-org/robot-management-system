# AGENTS.md - Safety Feature

Safety monitoring and emergency controls.

## Purpose

Provides safety monitoring dashboard, emergency stop controls, and safety event history.

## Structure

```
safety/
├── api/
│   └── safetyApi.ts         # API calls
├── components/
│   ├── SafetyDashboard.tsx      # Safety overview
│   ├── EmergencyStop.tsx        # Emergency stop button
│   ├── SafetyEventList.tsx      # Safety event history
│   └── SafetyStatusCard.tsx     # Robot safety status
├── pages/
│   └── SafetyPage.tsx           # Main safety page
├── store/
│   └── safetyStore.ts           # Zustand store
├── types/
│   └── safety.types.ts          # TypeScript types
└── index.ts
```

## Key Components

| Component | Purpose |
|-----------|---------|
| `SafetyDashboard` | Overview of fleet safety status |
| `EmergencyStop` | Big red button for emergency stop |
| `SafetyEventList` | History of safety events |
| `SafetyStatusCard` | Per-robot safety indicators |

## Key Types

```typescript
type SafetyLevel = 'safe' | 'caution' | 'warning' | 'danger' | 'critical';

interface SafetyEvent {
  id: string;
  robotId: string;
  eventType: 'emergency_stop' | 'protective_stop' | 'collision_warning' | 'boundary_violation';
  level: SafetyLevel;
  description: string;
  timestamp: string;
  resolved: boolean;
}

interface SafetyStatus {
  robotId: string;
  level: SafetyLevel;
  activeWarnings: string[];
  lastCheck: string;
}
```

## Store Actions

- `fetchSafetyStatus()` - Load fleet safety status
- `triggerEmergencyStop(robotId)` - Emergency stop
- `triggerFleetStop()` - Stop all robots
- `fetchSafetyEvents()` - Load safety history

## API Endpoints Used

- `GET /api/safety/status` - Fleet safety status
- `POST /api/robots/:id/emergency-stop` - Emergency stop
- `GET /api/safety/events` - Safety event history
