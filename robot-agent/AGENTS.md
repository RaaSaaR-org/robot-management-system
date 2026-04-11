# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with the NeoDEM Robot Agent.

## Project Overview

The Robot Agent is software that runs directly on humanoid robots, implementing the A2A (Agent-to-Agent) protocol for communication with NeoDEM. It uses Genkit with Gemini AI to interpret natural language commands and execute robot actions.

For development and demos, the agent includes a **simulation mode** that emulates robot behavior (movement, battery, sensors, joint states) without physical hardware.

## Commands

### Development

```bash
npm run dev          # Start agent with hot reload (default: SimBot-01, port 41243)
npm run dev:light    # Start as NimbleBot (lightweight, port 41243)
npm run dev:heavy    # Start as TitanBot (heavy-duty, port 41244)
npm run dev:so101    # Start as ArmBot (SO-ARM100, port 41245)
```

### Build

```bash
npm run build        # Compile TypeScript to dist/
npm start            # Run production build
```

### Type Checking

```bash
npm run typecheck    # Run TypeScript compiler (noEmit mode)
```

### Testing

```bash
npm test             # Run tests with vitest (watch mode)
npm run test:run     # Run tests once
```

### Protobuf

```bash
npm run proto:build  # Rebuild gRPC stubs from protos/vla_inference.proto
```

## Architecture

### Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **AI**: Genkit with Google Gemini 2.5 Flash
- **Protocol**: A2A SDK (@a2a-js/sdk)
- **gRPC**: VLA inference client (@grpc/grpc-js)
- **Real-time**: WebSocket (ws)
- **Language**: TypeScript (ESM modules)

### Entry Point

- **Main**: `src/index.ts` - Express server with A2A SDK integration

### Default Port

- HTTP/WebSocket: `41243` (configurable via `PORT` env)

### State Management Architecture

The robot uses a **facade + delegation** pattern:

```
RobotStateManager (facade)
├── CommandExecutor     # Executes move/pickup/drop/stop/charge commands
├── SimulationEngine    # Physics loop (100ms tick): movement, battery, heading
├── StatePublisher      # Observer pattern: subscribe to state changes
└── TaskQueue           # Server-pushed task queue (max 5, priority-sorted)
```

## Project Structure

```
robot-agent/src/
├── index.ts              # Main entry point, Express + A2A setup
├── config/
│   └── config.ts         # Environment configuration & validation
├── agent/
│   ├── agent-card.ts     # A2A AgentCard definition (3 skills)
│   ├── agent-executor.ts # A2A message processing (Genkit, LRU context cache)
│   └── genkit.ts         # Genkit/Gemini AI setup (gemini-2.5-flash)
├── robot/
│   ├── types.ts          # All type definitions (RobotStatus, CommandType, etc.)
│   ├── state.ts          # RobotStateManager facade (coordinates subsystems)
│   ├── CommandExecutor.ts    # Command execution with validation & history
│   ├── SimulationEngine.ts   # Physics loop (position, battery, heading)
│   ├── StatePublisher.ts     # Observer/pub-sub for state changes
│   ├── TaskQueue.ts          # Server-pushed task queue with priority
│   ├── telemetry.ts          # Sensor data generation & alert detection
│   └── joint-configs/
│       ├── index.ts          # Joint config dispatcher (by robot type)
│       ├── h1.config.ts      # Unitree H1 - 19 joints
│       └── so101.config.ts   # SO-ARM100 SO101 - 6 joints
├── api/
│   ├── rest-routes.ts    # REST API endpoints (NeoDEM compatible)
│   └── websocket.ts      # WebSocket telemetry streaming (2s interval)
├── tools/
│   ├── navigation.ts     # Genkit tools: moveToLocation, stopMovement, goToCharge, returnHome
│   ├── manipulation.ts   # Genkit tools: pickupObject, dropObject
│   └── status.ts         # Genkit tools: getRobotStatus, emergencyStop
├── embodiment/            # Embodiment abstraction layer
│   ├── embodiment-loader.ts  # YAML config loader with hot-reload (chokidar)
│   ├── camera-config.ts      # Camera configuration per embodiment
│   ├── joint-mapper.ts       # Joint name mapping across embodiments
│   ├── normalizer.ts         # Action/observation space normalization
│   ├── types.ts
│   ├── configs/
│   │   ├── generic.yaml      # Default generic embodiment
│   │   ├── h1.yaml           # Unitree H1 humanoid config
│   │   └── so101.yaml        # SO-ARM100 arm config
│   └── __tests__/            # Unit tests (vitest)
├── safety/
│   ├── SafetyMonitor.ts      # Safety monitoring & protective stop
│   └── types.ts
├── compliance/
│   └── ComplianceLogClient.ts # HTTP client for server compliance API
├── vla/                       # VLA inference client (gRPC)
│   ├── vla-client.ts          # gRPC client for VLA inference server
│   ├── vla-controller.ts      # VLA action execution controller
│   ├── vla-model-manager.ts   # Model loading & switching
│   ├── action-buffer.ts       # Action buffering & smoothing
│   ├── action-interpolator.ts # Interpolation between actions
│   ├── metrics.ts             # Inference metrics collection
│   ├── types.ts
│   └── proto/                 # Local proto copy
└── prompts/
    └── robot_agent.prompt # AI system prompt template (Dotprompt)
```

### File Header Convention

Every source file has a top-of-file header block. TypeScript uses a JSDoc
block, Python uses a module docstring. Both should include an `@status`
tag so future readers can tell live code from orphaned/dead code at a
glance:

```ts
/**
 * @file skill-executor.ts
 * @description Closed-loop skill executor — observe → predict → execute
 * @feature vla
 * @status live
 */
```

```python
"""
vla_runner.py — Thread-based VLA control loop at 5 Hz.
@status live
"""
```

**`@status` values:**

| Tag | Meaning |
|---|---|
| `live` | Reachable from a real entry point and runs in normal use |
| `live-conditional` | Live only when an env var / feature flag is on (e.g. `FEDERATED_ENABLED`, hardware sidecar present) |
| `test` | Test file (`*.test.ts`, `hardware/tests/test_*.py`) — CI only |
| `orphaned` | Imported/referenced by live code but no caller or launcher exercises it — broken wire |
| `dead` | No importer, no caller anywhere. Safe to delete. |

When adding a new file, tag it. When moving code from live to orphaned
(or vice versa), update the tag. `scripts/annotate-status.mjs` handled
the initial bulk pass; subsequent maintenance is manual.

## AI Tools (Genkit)

All 8 tools are registered with Genkit and available to the AI agent:

### Navigation (4 tools)

| Tool | Input | Description |
|------|-------|-------------|
| `moveToLocation` | `{ x?, y?, zone? }` | Move to coordinates or named zone. Resolves zone names via server zone API (cached 60s). Validates against restricted zones. |
| `stopMovement` | `{ reason? }` | Stop current movement |
| `goToCharge` | `{ priority? }` | Navigate to charging station (fetched from server zones) |
| `returnHome` | `{ priority? }` | Navigate to home position |

### Manipulation (2 tools)

| Tool | Input | Description |
|------|-------|-------------|
| `pickupObject` | `{ objectId }` | Pick up an object (validates payload capacity) |
| `dropObject` | `{ gentle? }` | Drop held object |

### Status (2 tools)

| Tool | Input | Description |
|------|-------|-------------|
| `getRobotStatus` | `{ verbose? }` | Get full robot status, battery, location |
| `emergencyStop` | `{ reason? }` | Immediate emergency stop |

### Zone Resolution

Navigation tools fetch zones from `GET {serverUrl}/api/zones` and derive named locations from zone center points. Results are cached for 60 seconds. Fallback locations when server is unavailable: `home: {x:0, y:0}`, `charging_station: {x:5, y:20}`.

## Simulation Engine

The simulation runs at **100ms tick intervals** with these behaviors:

- **Movement**: Interpolates position towards target at 2.0 units/second
- **Heading**: Computed as `atan2(dy, dx)` in degrees
- **Battery drain**: 0.01%/s idle, 0.02%/s while busy
- **Battery charge**: 0.5%/s when at charging station
- **Battery warnings**: Warning at < 20%, error state at < 5%
- **Telemetry**: Full sensor suite (sonar, bumpers, IMU, motor currents, gripper) + joint states

### Joint Animations

- **H1 (humanoid)**: 19-joint walking gait animation at 2.0Hz cycle; idle sway at 0.3Hz
- **SO101 (arm)**: 6-joint working/holding/rest poses at 0.5Hz cycle

## Task Queue (Server-Pushed)

The robot accepts tasks pushed from the server's `TaskDistributor`:

- **Max queue size**: 5
- **Priority order**: critical(4) > high(3) > normal(2) > low(1)
- **Supported actions**: `move_to_location`, `pickup_object`, `drop_object`, `charge`, `return_home`, `wait`, `inspect`, `custom`
- **Rejects tasks** when robot is in `error` or `maintenance` state

## Key Endpoints

### A2A Protocol

- `GET /.well-known/agent-card.json` - Robot agent card
- `POST /` - A2A message handler (via SDK)

### REST API (`/api/v1`)

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/robots/:id` | Get robot details |
| POST   | `/api/v1/robots/:id/command` | Send command |
| GET    | `/api/v1/robots/:id/telemetry` | Get current telemetry |
| POST   | `/api/v1/robots/:id/tasks` | Accept pushed task (202) |
| GET    | `/api/v1/robots/:id/tasks` | Get task queue |
| DELETE | `/api/v1/robots/:id/tasks/:taskId` | Cancel task |
| POST   | `/api/v1/robots/:id/reset` | Reset robot state |
| GET    | `/api/v1/register` | Registration info for server |
| GET    | `/api/v1/health` | Health check |

### WebSocket

- `ws://localhost:41243/ws/telemetry/:robotId` - Real-time telemetry (every 2s) + alerts on state change

## Key Dependencies

| Package                 | Purpose                     |
| ----------------------- | --------------------------- |
| `@a2a-js/sdk`          | A2A protocol implementation |
| `genkit`                | Google AI framework         |
| `@genkit-ai/googleai`  | Gemini model integration    |
| `@grpc/grpc-js`        | gRPC client (VLA inference) |
| `@grpc/proto-loader`   | Protobuf loading            |
| `express`               | HTTP server                 |
| `ws`                    | WebSocket server            |
| `axios`                 | HTTP client (zone fetching) |
| `chokidar`              | File watching (config hot-reload) |
| `yaml`                  | YAML config parsing         |
| `async-mutex`           | Concurrency control         |

## Environment Variables

| Variable           | Default            | Description                    |
| ------------------ | ------------------ | ------------------------------ |
| `GEMINI_API_KEY`   | (required)         | Google Gemini API key          |
| `PORT`             | `41243`            | Server port                    |
| `SERVER_URL`       | `http://localhost:3001` | NeoDEM server URL     |
| `ROBOT_ID`         | `sim-robot-001`    | Unique robot identifier        |
| `ROBOT_NAME`       | `SimBot-01`        | Display name                   |
| `ROBOT_MODEL`      | `SimBot H1`        | Model string                   |
| `ROBOT_CLASS`      | `standard`         | `lightweight \| standard \| heavy-duty` |
| `ROBOT_TYPE`       | `h1`               | `h1 \| so101 \| generic`      |
| `MAX_PAYLOAD_KG`   | `10`               | Max payload capacity (kg)      |
| `ROBOT_DESCRIPTION`| (generic)          | AI prompt context              |
| `INITIAL_X`        | `10.0`             | Starting X coordinate          |
| `INITIAL_Y`        | `10.0`             | Starting Y coordinate          |
| `INITIAL_ZONE`     | `Warehouse A`      | Starting zone name             |
| `INITIAL_FLOOR`    | `1`                | Starting floor                 |

### Pre-configured Profiles

| File          | Robot     | Class       | Type  | Port  | Payload |
| ------------- | --------- | ----------- | ----- | ----- | ------- |
| `.env`        | SimBot-01 | standard    | h1    | 41243 | 10kg    |
| `.env.light`  | NimbleBot | lightweight | h1    | 41243 | 5kg     |
| `.env.heavy`  | TitanBot  | heavy-duty  | h1    | 41244 | 50kg    |
| `.env.so101`  | ArmBot    | lightweight | SO101 | 41245 | 0.5kg   |

## Related Documentation

- `../server/AGENTS.md` - Server documentation
- `../app/AGENTS.md` - Frontend documentation
- `../docs/architecture.md` - System architecture
