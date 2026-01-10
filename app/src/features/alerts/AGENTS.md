# AGENTS.md - Alerts Feature

Alert and notification management.

## Purpose

Displays system alerts, robot warnings, and safety notifications. Enables alert acknowledgment and filtering.

## Structure

```
alerts/
├── api/
│   └── alertsApi.ts         # API calls
├── components/
│   ├── AlertList.tsx            # Alert list display
│   ├── AlertCard.tsx            # Individual alert card
│   ├── AlertFilters.tsx         # Filter controls
│   └── AlertBadge.tsx           # Unread count badge
├── pages/
│   └── AlertsPage.tsx           # Main alerts page
├── store/
│   └── alertsStore.ts           # Zustand store
├── types/
│   └── alerts.types.ts          # TypeScript types
└── index.ts
```

## Key Components

| Component | Purpose |
|-----------|---------|
| `AlertsPage` | Main alerts page with filtering |
| `AlertList` | Scrollable alert list |
| `AlertCard` | Alert with severity, message, timestamp |
| `AlertFilters` | Filter by severity, robot, date |

## Key Types

```typescript
type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

interface Alert {
  id: string;
  robotId: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
  source: 'robot' | 'system' | 'safety';
}
```

## Store Actions

- `fetchAlerts()` - Load alerts
- `acknowledgeAlert(id)` - Mark alert as read
- `dismissAlert(id)` - Remove alert
- `setFilters(filters)` - Apply filters

## API Endpoints Used

- `GET /api/alerts` - List alerts
- `PUT /api/alerts/:id/acknowledge` - Acknowledge alert
- `DELETE /api/alerts/:id` - Dismiss alert
