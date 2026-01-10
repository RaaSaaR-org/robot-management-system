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

## Deployment

### Docker Compose (Local)

```bash
docker-compose up -d
```

### Kubernetes (Helm)

Container images are published to GitHub Container Registry on tagged releases:

- `ghcr.io/raasaar-org/robomind-app`
- `ghcr.io/raasaar-org/robomind-server`
- `ghcr.io/raasaar-org/robomind-robot-agent`

Deploy with Helm:

```bash
# Local/development
helm install robomind ./helm/robomind -f ./helm/robomind/values-local.yaml \
  --set postgres.auth.password=yourpassword \
  --set secrets.jwtSecret=yourjwtsecret

# Production
helm install robomind ./helm/robomind -f ./helm/robomind/values-production.yaml \
  --set postgres.auth.password=$DB_PASSWORD \
  --set secrets.jwtSecret=$JWT_SECRET \
  --set secrets.googleApiKey=$GOOGLE_API_KEY \
  --set secrets.geminiApiKey=$GEMINI_API_KEY
```

## Documentation

- `docs/prd.md` - Product requirements
- `docs/architecture.md` - System architecture
- `docs/brand.md` - Design system
- `app/AGENTS.md` - Frontend development guide
- `server/AGENTS.md` - Server development guide
- `robot-agent/AGENTS.md` - Robot agent development guide

## License

MIT
