# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with the RoboMindOS server.

## Project Overview

The A2A Protocol Server is the backend for RoboMindOS. It implements the A2A (Agent-to-Agent) protocol to enable communication between the frontend application and robot agents. The server manages robot registration, conversations, tasks, and real-time telemetry via WebSocket.

## Commands

### Development

```bash
npm run dev          # Start server with hot reload (tsx watch)
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

## Architecture

### Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Protocol**: A2A (Agent-to-Agent)
- **Real-time**: WebSocket (ws)
- **Language**: TypeScript (ESM modules)

### Entry Points

- **Main**: `src/index.ts` - Server bootstrap
- **App**: `src/app.ts` - Express app configuration and middleware

### Default Port

- HTTP/WebSocket: `3000` (configurable via PORT env)

## Project Structure

```
server/src/
├── index.ts              # Server entry point
├── app.ts                # Express app setup, middleware, route mounting
├── routes/
│   ├── conversation.routes.ts  # A2A conversation endpoints
│   ├── message.routes.ts       # A2A message endpoints
│   ├── agent.routes.ts         # Agent discovery endpoints
│   ├── robot.routes.ts         # Robot management endpoints
│   ├── wellknown.routes.ts     # /.well-known/agent-card.json
│   └── task.routes.ts          # A2A task endpoints
├── services/
│   ├── A2AClient.ts            # Client for communicating with robot agents
│   ├── ConversationManager.ts  # Manages A2A conversations, tasks, events
│   └── RobotManager.ts         # Robot registration and state management
├── websocket/
│   └── index.ts                # WebSocket server for real-time telemetry
└── types/
    └── index.ts                # TypeScript type definitions
```

## Development Guidelines

### Route Pattern

Routes follow REST conventions with A2A protocol extensions:
- `GET /conversations` - List conversations
- `POST /conversations` - Create conversation
- `POST /conversations/:id/messages` - Send message (A2A)
- `GET /robots` - List registered robots
- `POST /robots/:id/register` - Register robot

### Service Pattern

Services are singleton managers:
- `ConversationManager` - In-memory Map storage for conversations, tasks, events
- `RobotManager` - In-memory Map storage for registered robots
- `A2AClient` - HTTP client for robot agent communication

### Current Limitations

- **In-memory storage**: All data lost on restart (Task 16 will add database)
- **No authentication**: All endpoints are open (Task 11 will add auth)

### File Header Convention

```typescript
/**
 * @file filename.ts
 * @description One-line purpose description
 */
```

## Key Endpoints

### A2A Protocol
- `GET /.well-known/agent-card.json` - Server agent card
- `POST /conversations` - Start conversation
- `POST /conversations/:id/messages` - Send A2A message
- `GET /conversations/:id/events` - SSE event stream

### Robot Management
- `GET /robots` - List all robots
- `POST /robots/:id/register` - Register robot from agent URL
- `DELETE /robots/:id` - Unregister robot
- `POST /robots/:id/command` - Send command to robot

### WebSocket
- `ws://localhost:3000/ws` - Telemetry streaming

## Key Dependencies

- **express**: HTTP server framework
- **ws**: WebSocket server
- **cors**: CORS middleware
- **axios**: HTTP client for robot communication
- **uuid**: Unique ID generation

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |

## Related Documentation

- `../docs/architecture.md` - System architecture
- `../robot-agent/README.md` - Robot agent documentation
