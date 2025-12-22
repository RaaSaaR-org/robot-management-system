# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with the RoboMind Robot Agent.

## Project Overview

The Robot Agent is software that runs directly on humanoid robots, implementing the A2A (Agent-to-Agent) protocol for communication with RoboMindOS. It uses Genkit with Gemini AI to interpret natural language commands and execute robot actions.

For development and demos, the agent includes a **simulation mode** that emulates robot behavior without physical hardware.

## Commands

### Development

```bash
npm run dev          # Start agent with hot reload
npm run dev:light    # Start with light model config (.env.light)
npm run dev:heavy    # Start with heavy model config (.env.heavy)
```

### Build

```bash
npm run build        # Compile TypeScript to dist/
npm start            # Run production build
npm start:light      # Run with light model config
npm start:heavy      # Run with heavy model config
```

### Type Checking

```bash
npm run typecheck    # Run TypeScript compiler (noEmit mode)
```

## Architecture

### Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **AI**: Genkit with Google Gemini
- **Protocol**: A2A SDK (@a2a-js/sdk)
- **Real-time**: WebSocket (ws)
- **Language**: TypeScript (ESM modules)

### Entry Point

- **Main**: `src/index.ts` - Express server with A2A SDK integration

### Default Port

- HTTP/WebSocket: `41243` (configurable via PORT env)

## Project Structure

```
robot-agent/src/
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
│   └── telemetry.ts      # Sensor data generation
├── api/
│   ├── rest-routes.ts    # REST API endpoints (RoboMindOS compatible)
│   └── websocket.ts      # WebSocket telemetry streaming
├── tools/
│   ├── navigation.ts     # Genkit tools: move, stop, return_home
│   ├── manipulation.ts   # Genkit tools: pickup, drop
│   └── status.ts         # Genkit tools: get_status, get_location
└── prompts/
    └── robot_agent.prompt # AI system prompt template
```

## Development Guidelines

### Genkit Tool Pattern

Tools are defined using Genkit's `defineTool()`:

```typescript
const moveTool = ai.defineTool(
  {
    name: 'move_to_location',
    description: 'Move robot to coordinates or zone',
    inputSchema: z.object({ x: z.number(), y: z.number() }),
    outputSchema: z.object({ success: z.boolean() }),
  },
  async (input) => {
    // Implementation
  }
);
```

### Robot State

Robot state is managed in `robot/state.ts`:
- Position (x, y, zone, floor)
- Status (idle, moving, charging, error)
- Battery level
- Held objects
- Command history

### Simulation vs Production

- **Simulation**: State changes with timing delays, virtual sensors
- **Production**: Would interface with actual robot hardware APIs

### File Header Convention

```typescript
/**
 * @file filename.ts
 * @description One-line purpose description
 */
```

## Key Endpoints

### A2A Protocol
- `GET /.well-known/agent-card.json` - Robot agent card
- `POST /` - A2A message handler (via SDK)

### REST API (RoboMindOS Compatible)
- `GET /api/v1/robots/:id` - Get robot details
- `POST /api/v1/robots/:id/command` - Send command
- `GET /api/v1/robots/:id/telemetry` - Get current telemetry
- `GET /api/v1/register` - Get registration info
- `GET /api/v1/health` - Health check

### WebSocket
- `ws://localhost:41243/ws/telemetry/:robotId` - Real-time telemetry

## Key Dependencies

- **@a2a-js/sdk**: A2A protocol implementation
- **genkit**: Google AI framework
- **@genkit-ai/googleai**: Gemini model integration
- **express**: HTTP server
- **ws**: WebSocket server

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Google Gemini API key | Required |
| `PORT` | Server port | `41243` |
| `ROBOT_ID` | Unique robot identifier | `sim-robot-001` |
| `ROBOT_NAME` | Display name | `SimBot-01` |
| `ROBOT_MODEL` | Robot model | `SimBot H1` |
| `INITIAL_X` | Starting X coordinate | `10.0` |
| `INITIAL_Y` | Starting Y coordinate | `10.0` |
| `INITIAL_ZONE` | Starting zone | `Warehouse A` |

## Related Documentation

- `./README.md` - Full robot agent documentation
- `../server/AGENTS.md` - Server documentation
- `../docs/architecture.md` - System architecture
