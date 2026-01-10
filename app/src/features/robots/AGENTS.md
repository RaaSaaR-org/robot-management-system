# AGENTS.md - Robots Feature

Robot management and monitoring feature.

## Purpose

Displays robot fleet status, enables robot control, and shows real-time telemetry data.

## Structure

```
robots/
├── api/
│   └── robotsApi.ts         # API calls
├── components/
│   ├── RobotCard.tsx            # Robot summary card
│   ├── RobotList.tsx            # Robot grid/list
│   ├── RobotDetail.tsx          # Detailed robot view
│   ├── TelemetryDisplay.tsx     # Real-time telemetry
│   ├── BatteryIndicator.tsx     # Battery status
│   └── StatusBadge.tsx          # Status indicator
├── hooks/
│   └── useRobotWebSocket.ts     # WebSocket telemetry hook
├── pages/
│   └── RobotsPage.tsx           # Main robots page
├── store/
│   └── robotsStore.ts           # Zustand store
├── types/
│   └── robots.types.ts          # TypeScript types
└── index.ts
```

## Key Components

| Component | Purpose |
|-----------|---------|
| `RobotsPage` | Main page with robot list |
| `RobotCard` | Summary card showing status, battery, location |
| `RobotDetail` | Full robot details with telemetry |
| `TelemetryDisplay` | Real-time sensor data |

## Key Types

```typescript
interface Robot {
  id: string;
  name: string;
  model: string;
  status: 'online' | 'offline' | 'busy' | 'charging' | 'error';
  battery: number;
  position: { x: number; y: number; zone: string };
  lastSeen: string;
}

interface Telemetry {
  robotId: string;
  timestamp: string;
  battery: number;
  position: Position;
  velocity: number;
  sensors: SensorData;
}
```

## WebSocket Integration

Uses `useRobotWebSocket` hook for real-time telemetry:

```typescript
const { telemetry, isConnected } = useRobotWebSocket(robotId);
```

## Store Actions

- `fetchRobots()` - Load all robots
- `fetchRobot(id)` - Load single robot
- `updateTelemetry(data)` - Update from WebSocket
- `sendCommand(robotId, command)` - Send command to robot

## API Endpoints Used

- `GET /api/robots` - List robots
- `GET /api/robots/:id` - Robot details
- `POST /api/robots/:id/command` - Send command
- `ws://server/api/a2a/ws` - Telemetry stream
