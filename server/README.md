# RoboMindOS Server

The backend server for RoboMindOS, implementing the A2A (Agent-to-Agent) protocol to enable communication between the frontend application and robot agents.

## Features

- **A2A Protocol**: Full implementation of the Agent-to-Agent protocol for robot communication
- **Robot Management**: Register, discover, and manage robot agents
- **Real-time Telemetry**: WebSocket streaming of robot sensor data
- **Conversation Management**: Track multi-turn conversations with robots
- **Task Orchestration**: Manage and monitor robot tasks

## Prerequisites

- Node.js 18+

## Quick Start

1. **Install dependencies:**

```bash
cd server
npm install
```

2. **Start the server:**

```bash
npm run dev
```

The server will start on `http://localhost:3000`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot reload (development) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run production build |
| `npm run typecheck` | Type check without emitting |

## API Endpoints

### A2A Protocol

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/.well-known/agent-card.json` | Server agent card |
| `POST` | `/conversations` | Start new conversation |
| `GET` | `/conversations/:id` | Get conversation details |
| `POST` | `/conversations/:id/messages` | Send A2A message |
| `GET` | `/conversations/:id/events` | SSE event stream |

### Robot Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/robots` | List all registered robots |
| `POST` | `/robots/:id/register` | Register robot from agent URL |
| `DELETE` | `/robots/:id` | Unregister robot |
| `GET` | `/robots/:id` | Get robot details |
| `POST` | `/robots/:id/command` | Send command to robot |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/tasks` | List all tasks |
| `GET` | `/tasks/:id` | Get task details |
| `POST` | `/tasks/:id/cancel` | Cancel a task |

### WebSocket

- `ws://localhost:3000/ws` - Real-time telemetry streaming

## Architecture

```
server/src/
├── index.ts              # Server entry point
├── app.ts                # Express app configuration
├── routes/
│   ├── conversation.routes.ts
│   ├── message.routes.ts
│   ├── agent.routes.ts
│   ├── robot.routes.ts
│   ├── wellknown.routes.ts
│   └── task.routes.ts
├── services/
│   ├── A2AClient.ts      # Robot agent communication
│   ├── ConversationManager.ts
│   └── RobotManager.ts
├── websocket/
│   └── index.ts
└── types/
    └── index.ts
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |

## Integration with Robot Agents

The server discovers and communicates with robot agents via the A2A protocol:

1. **Discovery**: Fetch agent card from `http://robot-host/.well-known/agent-card.json`
2. **Registration**: Store robot details and capabilities
3. **Communication**: Send/receive A2A messages for commands and status
4. **Telemetry**: Subscribe to real-time sensor data via WebSocket

### Register a Robot

```bash
curl -X POST http://localhost:3000/robots/robot-001/register \
  -H "Content-Type: application/json" \
  -d '{"agentUrl": "http://localhost:41243"}'
```

### Send a Command

```bash
curl -X POST http://localhost:3000/robots/robot-001/command \
  -H "Content-Type: application/json" \
  -d '{"type": "move", "payload": {"destination": {"zone": "Warehouse A"}}}'
```

## Current Limitations

- **In-memory storage**: Data is lost on server restart
- **No authentication**: All endpoints are currently open

These will be addressed in upcoming features (database persistence, authentication).

## License

MIT
