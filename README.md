# RoboMindOS

A fleet management platform for humanoid robots with natural language command processing.

## Overview

RoboMindOS enables operators to manage, monitor, and control humanoid robots through an intuitive interface with natural language commands. The system uses the A2A (Agent-to-Agent) protocol for robot communication and Gemini AI for command interpretation.

## Architecture

```
robo-mind-app/
├── app/           # Frontend (React + Tauri desktop app)
├── server/        # Backend (Node.js A2A server)
├── robot-agent/   # Robot software (runs on robots or as simulator)
└── docs/          # Documentation
```

| Component | Description | Port |
|-----------|-------------|------|
| **App** | React frontend with Tauri desktop wrapper | 1420 |
| **Server** | A2A protocol server, robot management | 3000 |
| **Robot Agent** | Robot software with AI command processing | 41243 |

## Quick Start

### 1. Start the Server

```bash
cd server
npm install
npm run dev
```

### 2. Start a Robot Agent (Simulation)

```bash
cd robot-agent
npm install
cp .env.example .env  # Add your GEMINI_API_KEY
npm run dev
```

### 3. Start the Frontend

```bash
cd app
npm install
npm run dev
```

Open http://localhost:1420 to access the dashboard.

## Features

- **Fleet Dashboard**: Real-time overview of all robots
- **Natural Language Commands**: "Move to Warehouse A", "Pick up the box"
- **Live Telemetry**: Battery, position, sensor data via WebSocket
- **Task Management**: Create, monitor, and cancel robot tasks
- **Safety Controls**: Emergency stop, exclusion zones

## Documentation

- `docs/prd.md` - Product requirements
- `docs/architecture.md` - System architecture
- `docs/brand.md` - Design system
- `app/AGENTS.md` - Frontend development guide
- `server/AGENTS.md` - Server development guide
- `robot-agent/AGENTS.md` - Robot agent development guide

## License

MIT
