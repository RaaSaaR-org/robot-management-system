# RoboMind Robot Agent

The Robot Agent software that runs directly on humanoid robots, enabling A2A (Agent-to-Agent) protocol communication and natural language command processing via RoboMindOS.

**For development and demo purposes**, this agent includes a simulation mode that emulates robot movement, sensors, and actions without requiring physical hardware.

## Features

- **A2A Protocol Support**: Full A2A agent implementation with AgentCard, streaming, and task management
- **Natural Language Commands**: Process commands via Gemini AI (e.g., "Move to Warehouse A", "Pick up the box")
- **RoboMindOS Compatible**: REST API endpoints that integrate with the RoboMindOS control system
- **Real-time Telemetry**: WebSocket streaming of robot sensor data and status
- **Simulation Mode**: Built-in simulation for development and demos (movement, battery, manipulation)

## Operating Modes

### Production Mode (Physical Robot)
When deployed on actual robot hardware, the agent interfaces with:
- Robot motor controllers and actuators
- Physical sensors (LIDAR, cameras, IMU, etc.)
- Battery management systems
- Safety systems and emergency stop hardware

### Simulation Mode (Development/Demo)
For development and demonstrations without physical hardware:
- Simulated movement with realistic timing
- Virtual battery drain and charging
- Mock object detection and manipulation
- All API endpoints function identically to production

## Prerequisites

- Node.js 18+
- Google Gemini API key

## Quick Start

1. **Install dependencies:**

```bash
cd robot-agent
npm install
```

2. **Configure environment:**

```bash
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

3. **Start the agent:**

```bash
npm run dev
```

The server will start on `http://localhost:41243` by default.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Google Gemini API key (required for AI features) | - |
| `PORT` | Server port | `41243` |
| `ROBOT_ID` | Unique robot identifier | `sim-robot-001` |
| `ROBOT_NAME` | Display name for the robot | `SimBot-01` |
| `ROBOT_MODEL` | Robot model name | `SimBot H1` |
| `INITIAL_X` | Starting X coordinate | `10.0` |
| `INITIAL_Y` | Starting Y coordinate | `10.0` |
| `INITIAL_ZONE` | Starting zone name | `Warehouse A` |
| `INITIAL_FLOOR` | Starting floor | `1` |

## Endpoints

### A2A Protocol

- **Agent Card**: `GET /.well-known/agent-card.json`
- **A2A Messages**: `POST /` (handled by A2A SDK)

### REST API (RoboMindOS Compatible)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/robots/:id` | Get robot details |
| `POST` | `/api/v1/robots/:id/command` | Send command to robot |
| `GET` | `/api/v1/robots/:id/telemetry` | Get current telemetry |
| `GET` | `/api/v1/robots/:id/commands` | Get command history |
| `GET` | `/api/v1/register` | Get registration info for RoboMindOS |
| `GET` | `/api/v1/health` | Health check |

### WebSocket

- **Telemetry Stream**: `ws://localhost:41243/ws/telemetry/{robotId}`

## Robot Capabilities

### Navigation
- Move to coordinates: `{ "type": "move", "payload": { "destination": { "x": 25, "y": 15 } } }`
- Move to zone: `{ "type": "move", "payload": { "destination": { "zone": "Warehouse A" } } }`
- Return home: `{ "type": "return_home" }`
- Go to charging station: `{ "type": "charge" }`
- Stop movement: `{ "type": "stop" }`
- Emergency stop: `{ "type": "emergency_stop" }`

### Manipulation
- Pick up object: `{ "type": "pickup", "payload": { "objectId": "box-123" } }`
- Drop object: `{ "type": "drop" }`

## Named Locations

The robot knows these pre-defined locations:
- `home` - Home base (0, 0)
- `charging_station` - Charging bay (5, 0)
- `warehouse_a` - Warehouse A (25, 15)
- `warehouse_b` - Warehouse B (25, 35)
- `loading_dock` - Loading dock (45, 25)
- `entrance` - Building entrance (50, 0)
- `exit` - Building exit (50, 50)

## Integration with RoboMindOS

### Option 1: Manual Registration

Fetch registration info and add to the main app:

```bash
curl http://localhost:41243/api/v1/register
```

Response includes robot details and all endpoints.

### Option 2: Discovery

The main app can discover robots by:
1. Checking ports 41243-41250 for agents
2. Fetching agent cards to identify robot agents
3. Auto-registering compatible agents

## Example Commands via A2A

Using the A2A protocol with natural language:

```
"Move to Warehouse A"
"What is your current location?"
"Pick up box-123"
"Drop what you're holding"
"Go to the charging station"
"Emergency stop!"
```

## Example Commands via REST API

```bash
# Get robot status
curl http://localhost:41243/api/v1/robots/sim-robot-001

# Send move command
curl -X POST http://localhost:41243/api/v1/robots/sim-robot-001/command \
  -H "Content-Type: application/json" \
  -d '{"type": "move", "payload": {"destination": {"x": 25, "y": 15, "zone": "Warehouse A"}}}'

# Get telemetry
curl http://localhost:41243/api/v1/robots/sim-robot-001/telemetry
```

## Project Structure

```
robot-agent/
├── src/
│   ├── index.ts              # Main entry point
│   ├── config/
│   │   └── config.ts         # Environment configuration
│   ├── agent/
│   │   ├── agent-card.ts     # A2A AgentCard definition
│   │   ├── agent-executor.ts # A2A message processing
│   │   └── genkit.ts         # Genkit/Gemini setup
│   ├── robot/
│   │   ├── types.ts          # Type definitions
│   │   ├── state.ts          # State management & simulation
│   │   └── telemetry.ts      # Telemetry generation
│   ├── api/
│   │   ├── rest-routes.ts    # REST API endpoints
│   │   └── websocket.ts      # WebSocket telemetry
│   ├── tools/
│   │   ├── navigation.ts     # Genkit navigation tools
│   │   ├── manipulation.ts   # Genkit manipulation tools
│   │   └── status.ts         # Genkit status tools
│   └── prompts/
│       └── robot_agent.prompt # AI prompt template
├── package.json
├── tsconfig.json
└── .env.example
```

## Running Multiple Robots (Simulation)

For development, you can run multiple simulated robots on different ports:

```bash
# Terminal 1
ROBOT_ID=robot-001 ROBOT_NAME=Atlas-01 PORT=41243 npm run dev

# Terminal 2
ROBOT_ID=robot-002 ROBOT_NAME=Atlas-02 PORT=41244 npm run dev
```

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Type check
npm run typecheck

# Build for production
npm run build

# Run production build
npm start
```

## License

MIT
