# AGENTS.md - Robot Agent

This file provides guidance for AI agents working with the RoboMind Robot Agent.

## Overview

AI-powered robot software implementing A2A protocol. Uses Genkit with Gemini for natural language command interpretation. Includes safety monitoring, compliance logging, and simulation mode for development.

## Commands

```bash
npm run dev          # Start agent with hot reload
npm run dev:light    # Start with light model config (.env.light)
npm run dev:heavy    # Start with heavy model config (.env.heavy)
npm run build        # Compile TypeScript to dist/
npm run typecheck    # Run TypeScript compiler
```

## Architecture

| Layer | Technology | Purpose |
|-------|------------|---------|
| AI Framework | Genkit | Tool orchestration |
| AI Model | Google Gemini | Command interpretation |
| Protocol | A2A SDK | Server communication |
| Framework | Express.js | HTTP server |
| Real-time | WebSocket (ws) | Telemetry streaming |

**Default Port**: 41243

## Project Structure

```
src/
├── index.ts              # Main entry point, Express + A2A setup
├── config/
│   └── config.ts         # Environment configuration
├── agent/
│   ├── agent-card.ts     # A2A AgentCard definition
│   ├── agent-executor.ts # A2A message processing with Genkit
│   └── genkit.ts         # Genkit/Gemini AI setup
├── robot/
│   ├── types.ts          # Robot type definitions
│   ├── state.ts          # Robot state management & simulation
│   └── telemetry/        # Sensor data generation
├── tools/                # Genkit AI tools
│   ├── navigation.ts     # move, stop, return_home
│   ├── manipulation.ts   # pickup, drop, place
│   └── status.ts         # get_status, get_location
├── safety/               # Safety monitoring system
│   └── SafetyMonitor.ts  # Real-time safety classification
├── compliance/           # Compliance logging client
│   └── ComplianceClient.ts # Logs to server
├── api/
│   ├── rest-routes.ts    # REST API endpoints
│   └── websocket.ts      # WebSocket telemetry streaming
└── prompts/
    └── robot_agent.prompt # AI system prompt template
```

## Key Features

### Safety Monitoring (`safety/SafetyMonitor.ts`)

Real-time safety classification and intervention:

```typescript
// Safety levels
type SafetyLevel = 'safe' | 'caution' | 'warning' | 'danger' | 'critical';

// Monitor evaluates commands before execution
const result = safetyMonitor.evaluateCommand(command, robotState);
if (result.level === 'critical') {
  await safetyMonitor.triggerEmergencyStop();
}
```

**Safety checks include:**
- Command safety classification
- Robot state validation (battery, position, speed)
- Environmental hazard detection
- Force limit monitoring
- Communication timeout handling

### Compliance Logging (`compliance/ComplianceClient.ts`)

Logs all events to server for regulatory compliance:

```typescript
await complianceClient.logEvent({
  eventType: 'ai_decision',
  severity: 'info',
  payload: {
    description: 'Navigation command interpreted',
    inputText: userCommand,
    outputAction: 'move_to_location',
    confidence: 0.95,
    safetyClassification: 'safe',
  },
});
```

### Genkit Tools (`tools/`)

AI tools for robot control:

| Tool | File | Purpose |
|------|------|---------|
| `move_to_location` | navigation.ts | Move to coordinates |
| `stop` | navigation.ts | Stop movement |
| `return_home` | navigation.ts | Return to base |
| `pickup_object` | manipulation.ts | Pick up item |
| `drop_object` | manipulation.ts | Drop held item |
| `get_status` | status.ts | Current robot state |
| `get_location` | status.ts | Position info |

### Robot State (`robot/state.ts`)

Manages robot state (position, status, battery, held objects):

```typescript
interface RobotState {
  id: string;
  position: { x: number; y: number; zone: string };
  status: 'idle' | 'moving' | 'working' | 'charging' | 'error';
  battery: number;
  heldObjects: string[];
}
```

## Development Guidelines

### Genkit Tool Pattern

```typescript
const moveTool = ai.defineTool(
  {
    name: 'move_to_location',
    description: 'Move robot to coordinates or named zone',
    inputSchema: z.object({
      x: z.number().optional(),
      y: z.number().optional(),
      zone: z.string().optional(),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
    }),
  },
  async (input) => {
    // Validate with safety monitor
    const safetyResult = safetyMonitor.evaluateMovement(input);
    if (!safetyResult.safe) {
      return { success: false, message: safetyResult.reason };
    }

    // Execute movement
    await robotState.moveTo(input);

    // Log to compliance
    await complianceClient.logEvent({ ... });

    return { success: true, message: 'Movement started' };
  }
);
```

### Safety-First Development

1. Always check safety before executing commands
2. Log all actions to compliance system
3. Handle emergency stop gracefully
4. Validate robot state before operations

## API Endpoints

### A2A Protocol
- `GET /.well-known/agent-card.json` - Robot agent card
- `POST /` - A2A message handler (via SDK)

### REST API
- `GET /api/v1/robots/:id` - Robot details
- `POST /api/v1/robots/:id/command` - Send command
- `GET /api/v1/robots/:id/telemetry` - Current telemetry
- `POST /api/v1/robots/:id/emergency-stop` - Emergency stop
- `GET /api/v1/health` - Health check

### WebSocket
- `ws://localhost:41243/ws/telemetry/:robotId` - Real-time telemetry

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Google Gemini API key | Required |
| `PORT` | Server port | `41243` |
| `ROBOT_ID` | Unique robot identifier | `sim-robot-001` |
| `ROBOT_NAME` | Display name | `SimBot-01` |
| `SERVER_URL` | RoboMindOS server URL | `http://localhost:3001` |
| `INITIAL_X` | Starting X coordinate | `10.0` |
| `INITIAL_Y` | Starting Y coordinate | `10.0` |
| `INITIAL_ZONE` | Starting zone | `Warehouse A` |

## Key Dependencies

- `@a2a-js/sdk` - A2A protocol implementation
- `genkit` - Google AI framework
- `@genkit-ai/googleai` - Gemini integration
- `express` - HTTP server
- `ws` - WebSocket server
- `zod` - Schema validation

## Related Documentation

- `./README.md` - Full robot agent documentation
- `../server/AGENTS.md` - Server API reference
- `../docs/architecture.md` - System architecture
