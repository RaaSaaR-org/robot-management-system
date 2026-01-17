# AI Operations Guide

This guide is designed for AI assistants working with the RoboMindOS codebase. It provides comprehensive information about all services, their ports, how to access and test them, and common operational tasks.

## Quick Reference: Service Endpoints

### Docker Compose (Local Development)

| Service | Port | Protocol | Health Check | Purpose |
|---------|------|----------|--------------|---------|
| **App** | 80 | HTTP | `GET /` | React frontend |
| **Server** | 3001 | HTTP/WS | `GET /health` | Node.js API |
| **Robot Agent** | 41243 | HTTP | `GET /health` | Simulated robot |
| **PostgreSQL** | 5432 | TCP | `pg_isready` | Database |
| **NATS** | 4222 | NATS | `GET :8222/healthz` | Message queue |
| **NATS Monitor** | 8222 | HTTP | - | NATS monitoring UI |
| **RustFS S3** | 9000 | HTTP (S3) | - | Object storage API |
| **RustFS Console** | 9001 | HTTP | `GET /rustfs/console/index.html` | Storage UI |
| **MLflow** | 5000 | HTTP | `GET /health` | Model registry |
| **VLA Inference** | 50051 | gRPC | gRPC health | VLA model server |
| **VLA Metrics** | 9090 | HTTP | - | Prometheus metrics |

---

## Service Details

### 1. App (Frontend)

**Technology:** React + Vite (served via nginx in Docker)

**Endpoints:**
```bash
# Main application
curl http://localhost/

# Static assets
curl http://localhost/assets/
```

**Development (without Docker):**
```bash
cd app && npm run dev
# Runs on http://localhost:1420
```

**Testing:**
```bash
cd app
npm run typecheck    # TypeScript check
npm run lint         # ESLint
npm run build        # Production build
```

---

### 2. Server (API)

**Technology:** Node.js + Express + Prisma

**Base URL:** `http://localhost:3001`

**Key Endpoints:**
```bash
# Health check
curl http://localhost:3001/health

# API documentation (if available)
curl http://localhost:3001/api

# A2A Protocol discovery
curl http://localhost:3001/.well-known/a2a.json

# Robots API
curl http://localhost:3001/api/robots

# WebSocket (real-time telemetry)
# Connect to: ws://localhost:3001/api/a2a/ws
```

**Database Operations:**
```bash
cd server

# Run migrations
npx prisma migrate dev

# Open Prisma Studio (database UI)
npx prisma studio

# Generate Prisma client
npx prisma generate

# Reset database (WARNING: deletes data)
npx prisma migrate reset
```

**Development:**
```bash
cd server && npm run dev
```

**Testing:**
```bash
cd server
npm run typecheck    # TypeScript check
npm run build        # Build
```

---

### 3. Robot Agent

**Technology:** Node.js + Genkit AI + A2A Protocol

**Base URL:** `http://localhost:41243`

**Key Endpoints:**
```bash
# Health check
curl http://localhost:41243/health

# Robot state
curl http://localhost:41243/state

# A2A agent card
curl http://localhost:41243/.well-known/agent.json
```

**Send Commands:**
```bash
# Natural language command via A2A
curl -X POST http://localhost:41243/api/a2a/message \
  -H "Content-Type: application/json" \
  -d '{"message": "move forward 2 meters"}'
```

**Development:**
```bash
cd robot-agent && npm run dev
```

**Environment Variables:**
```bash
GEMINI_API_KEY=your-key    # Required for AI features
SERVER_URL=http://server:3001
ROBOT_ID=sim-robot-001
```

---

### 4. PostgreSQL

**Connection:**
```bash
# Docker Compose
Host: localhost
Port: 5432
Database: robomind
Username: robomind
Password: ${POSTGRES_PASSWORD:-robomind-dev}

# Connection string
postgresql://robomind:robomind-dev@localhost:5432/robomind
```

**Direct Access:**
```bash
# Connect via psql (in Docker)
docker-compose exec postgres psql -U robomind -d robomind

# Or from host (if psql installed)
PGPASSWORD=robomind-dev psql -h localhost -U robomind -d robomind
```

**Common Queries:**
```sql
-- List all tables
\dt

-- Check robots
SELECT * FROM robots;

-- Check compliance logs
SELECT * FROM compliance_logs ORDER BY created_at DESC LIMIT 10;
```

---

### 5. NATS JetStream

**Ports:**
- 4222: Client connections
- 8222: HTTP monitoring

**Monitoring:**
```bash
# Server info
curl http://localhost:8222/varz

# Connection info
curl http://localhost:8222/connz

# Subscription info
curl http://localhost:8222/subsz

# JetStream info
curl http://localhost:8222/jsz

# Health check
curl http://localhost:8222/healthz
```

**CLI Access (using nats CLI):**
```bash
# Install nats CLI first
# brew install nats-io/nats-tools/nats

# Connect
nats --server localhost:4222 server info

# List streams
nats --server localhost:4222 stream ls

# Publish message
nats --server localhost:4222 pub test.subject "Hello"

# Subscribe
nats --server localhost:4222 sub "test.>"
```

---

### 6. RustFS (S3-Compatible Storage)

**Ports:**
- 9000: S3 API
- 9001: Web Console

**Credentials:**
```bash
Access Key: rustfsadmin (default)
Secret Key: rustfsadmin (default)
```

**Web Console:** http://localhost:9001

**S3 Operations (using AWS CLI):**
```bash
# Configure credentials
export AWS_ACCESS_KEY_ID=rustfsadmin
export AWS_SECRET_ACCESS_KEY=rustfsadmin

# List buckets
aws --endpoint-url http://localhost:9000 s3 ls

# List bucket contents
aws --endpoint-url http://localhost:9000 s3 ls s3://training-datasets/

# Upload file
aws --endpoint-url http://localhost:9000 s3 cp myfile.txt s3://robot-logs/

# Download file
aws --endpoint-url http://localhost:9000 s3 cp s3://robot-logs/myfile.txt ./

# Create bucket
aws --endpoint-url http://localhost:9000 s3 mb s3://new-bucket
```

**Pre-created Buckets:**
- `training-datasets` - VLA training data
- `model-checkpoints` - Model training checkpoints
- `production-models` - Deployed models
- `robot-logs` - Robot operational logs

---

### 7. MLflow

**URL:** http://localhost:5000

**Key Endpoints:**
```bash
# Health check
curl http://localhost:5000/health

# List experiments
curl http://localhost:5000/api/2.0/mlflow/experiments/list

# Search runs
curl "http://localhost:5000/api/2.0/mlflow/runs/search" \
  -H "Content-Type: application/json" \
  -d '{"experiment_ids": ["0"]}'

# Get model versions
curl http://localhost:5000/api/2.0/mlflow/registered-models/list
```

**Python SDK:**
```python
import mlflow

mlflow.set_tracking_uri("http://localhost:5000")

# List experiments
experiments = mlflow.search_experiments()

# Log a run
with mlflow.start_run():
    mlflow.log_param("learning_rate", 0.01)
    mlflow.log_metric("accuracy", 0.95)
```

---

### 8. VLA Inference Server

**Technology:** Python + gRPC

**Ports:**
- 50051: gRPC service
- 9090: Prometheus metrics

**Testing gRPC (using grpcurl):**
```bash
# List services
grpcurl -plaintext localhost:50051 list

# Describe service
grpcurl -plaintext localhost:50051 describe vla.VLAService

# Call inference (example)
grpcurl -plaintext -d '{"image": "base64...", "instruction": "pick up the cup"}' \
  localhost:50051 vla.VLAService/Predict
```

**Prometheus Metrics:**
```bash
curl http://localhost:9090/metrics
```

---

## Common Operations

### Start All Services

```bash
# Start everything
docker-compose up -d

# Check status
docker-compose ps

# View logs (all services)
docker-compose logs -f

# View specific service logs
docker-compose logs -f server
docker-compose logs -f robot-agent
```

### Stop All Services

```bash
# Stop (keep data)
docker-compose down

# Stop and delete all data
docker-compose down -v
```

### Restart a Specific Service

```bash
docker-compose restart server
docker-compose restart robot-agent
```

### Rebuild After Code Changes

```bash
# Rebuild specific service
docker-compose build server
docker-compose up -d server

# Rebuild all
docker-compose up -d --build
```

### Check Service Health

```bash
#!/bin/bash
echo "Checking services..."

# App
curl -sf http://localhost/ > /dev/null && echo "✓ App" || echo "✗ App"

# Server
curl -sf http://localhost:3001/health > /dev/null && echo "✓ Server" || echo "✗ Server"

# Robot Agent
curl -sf http://localhost:41243/health > /dev/null && echo "✓ Robot Agent" || echo "✗ Robot Agent"

# NATS
curl -sf http://localhost:8222/healthz > /dev/null && echo "✓ NATS" || echo "✗ NATS"

# MLflow
curl -sf http://localhost:5000/health > /dev/null && echo "✓ MLflow" || echo "✗ MLflow"

# RustFS
curl -sf http://localhost:9001/rustfs/console/index.html > /dev/null && echo "✓ RustFS" || echo "✗ RustFS"

# PostgreSQL
docker-compose exec -T postgres pg_isready > /dev/null && echo "✓ PostgreSQL" || echo "✗ PostgreSQL"
```

### View Container Logs

```bash
# Follow logs for a service
docker-compose logs -f server

# Last 100 lines
docker-compose logs --tail=100 server

# All services, last 50 lines each
docker-compose logs --tail=50
```

### Execute Commands in Containers

```bash
# Shell into server container
docker-compose exec server sh

# Run a command
docker-compose exec server npm run typecheck

# Database shell
docker-compose exec postgres psql -U robomind -d robomind
```

---

## Development Workflow

### 1. Local Development (Without Docker)

For faster iteration during development:

```bash
# Terminal 1: Start infrastructure only
docker-compose up -d postgres nats rustfs

# Terminal 2: Server
cd server && npm run dev

# Terminal 3: Robot Agent
cd robot-agent && npm run dev

# Terminal 4: Frontend
cd app && npm run dev
```

**Access:**
- Frontend: http://localhost:1420
- Server: http://localhost:3001
- Robot: http://localhost:41243

### 2. Full Stack Testing (Docker)

```bash
# Start all services
docker-compose up -d --build

# Access at http://localhost (port 80)
```

### 3. Running Type Checks

```bash
# All components
cd app && npm run typecheck
cd server && npm run typecheck  
cd robot-agent && npm run typecheck
```

### 4. Database Migrations

```bash
cd server

# Create migration
npx prisma migrate dev --name your_migration_name

# Apply migrations
npx prisma migrate deploy

# Reset (WARNING: deletes all data)
npx prisma migrate reset
```

---

## Troubleshooting

### Service Won't Start

```bash
# Check logs
docker-compose logs service-name

# Check if port is in use
lsof -i :3001  # Check port 3001

# Restart service
docker-compose restart service-name

# Rebuild from scratch
docker-compose down
docker-compose up -d --build
```

### Database Connection Issues

```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Check connection
docker-compose exec postgres pg_isready

# View PostgreSQL logs
docker-compose logs postgres
```

### NATS Connection Issues

```bash
# Check NATS is running
curl http://localhost:8222/healthz

# View connections
curl http://localhost:8222/connz

# View NATS logs
docker-compose logs nats
```

### Storage Issues (RustFS)

```bash
# Check RustFS health
curl http://localhost:9001/rustfs/console/index.html

# List buckets
AWS_ACCESS_KEY_ID=rustfsadmin \
AWS_SECRET_ACCESS_KEY=rustfsadmin \
aws --endpoint-url http://localhost:9000 s3 ls

# Check logs
docker-compose logs rustfs
```

---

## API Quick Reference

### Server REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/robots` | List all robots |
| GET | `/api/robots/:id` | Get robot details |
| POST | `/api/robots/:id/command` | Send command to robot |
| GET | `/api/compliance/logs` | Get compliance logs |
| GET | `/api/training/jobs` | List training jobs |
| POST | `/api/training/jobs` | Create training job |
| GET | `/api/models` | List ML models |
| GET | `/api/deployments` | List deployments |

### WebSocket Events

Connect to: `ws://localhost:3001/api/a2a/ws`

```javascript
// Subscribe to robot telemetry
ws.send(JSON.stringify({
  type: 'subscribe',
  topic: 'robot.telemetry',
  robotId: 'sim-robot-001'
}));

// Receive events
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

---

## Environment Variables Reference

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | - | PostgreSQL connection string |
| `JWT_SECRET` | - | JWT signing secret |
| `AUTH_DISABLED` | `true` | Disable authentication |
| `NATS_SERVERS` | `nats://nats:4222` | NATS server URL |
| `RUSTFS_ENDPOINT` | `http://rustfs:9000` | RustFS/S3 endpoint |
| `RUSTFS_ACCESS_KEY` | `rustfsadmin` | S3 access key |
| `RUSTFS_SECRET_KEY` | `rustfsadmin` | S3 secret key |
| `MLFLOW_TRACKING_URI` | `http://mlflow:5000` | MLflow tracking URI |

### Robot Agent

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | - | Google Gemini API key |
| `SERVER_URL` | `http://server:3001` | Server URL |
| `ROBOT_ID` | `sim-robot-001` | Robot identifier |
| `ROBOT_NAME` | `SimBot-01` | Robot display name |
| `ROBOT_MODEL` | `SimBot H1` | Robot model |

### VLA Inference

| Variable | Default | Description |
|----------|---------|-------------|
| `VLA_GRPC_PORT` | `50051` | gRPC server port |
| `VLA_METRICS_PORT` | `9090` | Prometheus metrics port |
| `VLA_MAX_WORKERS` | `4` | Number of gRPC workers |
| `VLA_DEVICE` | `cpu` | Compute device (cpu/cuda) |

---

## File Locations

| Component | Source | Docker Path |
|-----------|--------|-------------|
| Server code | `server/src/` | `/app/src/` |
| Server routes | `server/src/routes/` | `/app/src/routes/` |
| Prisma schema | `server/prisma/schema.prisma` | `/app/prisma/schema.prisma` |
| App code | `app/src/` | `/app/src/` |
| Robot code | `robot-agent/src/` | `/app/src/` |
| VLA code | `vla-inference/` | `/app/` |
