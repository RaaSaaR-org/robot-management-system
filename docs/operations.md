# NeoDEM — Operations Guide

Day-to-day operations for managing a NeoDEM deployment.

## Table of Contents

- [Managing Robots](#managing-robots)
- [Secrets Rotation](#secrets-rotation)
- [Log Management](#log-management)
- [Monitoring (Prometheus + Grafana)](#monitoring)
- [Database Operations](#database-operations)
- [Training Workers](#training-workers)
- [Object Storage (RustFS)](#object-storage)
- [NATS Messaging](#nats-messaging)
- [Backups](#backups)

---

## Managing Robots

### Adding a New Robot

1. **Register via API:**

```bash
curl -X POST http://localhost:3001/api/robots \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Arm-02",
    "model": "SO-ARM100",
    "status": "idle",
    "capabilities": ["manipulation", "pick_and_place"]
  }'
```

2. **Start the robot agent** pointing at the server:

```bash
# Set robot identity
export ROBOT_ID=arm-02
export ROBOT_NAME=Arm-02
export SERVER_URL=http://<server-ip>:3001
export GEMINI_API_KEY=your-key

cd robot-agent && npm run dev
```

The agent automatically registers with the server on startup.

3. **Verify** the robot appears in the fleet dashboard at `http://<app-ip>:1420/fleet`.

### Removing a Robot

```bash
# Stop the agent process first, then:
curl -X DELETE http://localhost:3001/api/robots/<robot-id>
```

### Checking Robot Status

```bash
# All robots
curl http://localhost:3001/api/robots | python3 -m json.tool

# Single robot
curl http://localhost:3001/api/robots/<robot-id> | python3 -m json.tool

# Robot health (direct)
curl http://<robot-ip>:41245/health
```

---

## Secrets Rotation

### JWT Secret

1. Generate a new secret:
```bash
openssl rand -base64 48
```

2. Update the secret:

   **systemd:** Edit `server/.env`, then `sudo systemctl restart neodem-server`

   **Docker:** Update `.env` in project root, then `docker-compose up -d server`

   **Kubernetes:**
   ```bash
   kubectl create secret generic neodem-secrets \
     --from-literal=jwt-secret=NEW_SECRET \
     --namespace neodem --dry-run=client -o yaml | kubectl apply -f -
   kubectl rollout restart deployment/neodem-server -n neodem
   ```

3. All existing sessions will be invalidated — users must re-login.

### WORKER_API_TOKEN

Used by GPU training workers to authenticate callbacks to the server.

1. Generate: `openssl rand -hex 32`
2. Set `WORKER_API_TOKEN` in server config
3. Set the same token in each training worker's config
4. Restart server and workers

### RustFS / S3 Credentials

1. Generate new access/secret keys
2. Update `RUSTFS_ACCESS_KEY` and `RUSTFS_SECRET_KEY` in server config
3. Restart all affected services

### Compliance Log Encryption Key

The `COMPLIANCE_LOG_ENCRYPTION_KEY` is a 64-character hex string. Rotating this key means new logs use the new key — **old logs encrypted with the previous key become unreadable** unless you implement a key migration.

```bash
# Generate
openssl rand -hex 32
```

---

## Log Management

The server uses **pino** for structured JSON logging in production.

### Reading Logs

```bash
# systemd — raw JSON
sudo journalctl -u neodem-server --no-pager -n 50

# Pretty-print with jq
sudo journalctl -u neodem-server --no-pager -n 50 -o cat | jq '.'

# Filter by log level
sudo journalctl -u neodem-server --no-pager -o cat | jq 'select(.level >= 40)'
# Pino levels: 10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal

# Filter by request ID
sudo journalctl -u neodem-server --no-pager -o cat | jq 'select(.requestId == "abc-123")'

# Filter errors only
sudo journalctl -u neodem-server --no-pager -o cat | jq 'select(.level == 50)'

# Docker
docker-compose logs -f server | jq '.'

# Kubernetes
kubectl logs -f deployment/neodem-server -n neodem | jq '.'
```

### Log Level

The server sets log level based on `NODE_ENV`:
- **development**: `debug`
- **production**: `info`
- **test** (VITEST): `silent`

### HTTP Request Logs

Every request is logged with:
- `requestId` — unique per request (via `X-Request-ID` header)
- `method`, `url`, `statusCode`, `responseTime`

```bash
# Slow requests (>1000ms)
sudo journalctl -u neodem-server -o cat | jq 'select(.responseTime > 1000)'
```

### Robot Agent Logs

```bash
sudo journalctl -u neodem-agent -f
```

---

## Monitoring

### Prometheus Metrics

The server exposes Prometheus metrics at `GET /metrics`:

```bash
curl http://localhost:3001/metrics
```

Available metrics:
- `http_requests_total` — request count by method, path, status
- `http_request_duration_seconds` — request latency histogram
- Default Node.js metrics (memory, CPU, event loop lag)

### Prometheus Setup

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'neodem-server'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3001']
    metrics_path: /metrics

  - job_name: 'neodem-agent'
    scrape_interval: 30s
    static_configs:
      - targets: ['localhost:41245']
    metrics_path: /health
```

```bash
# Quick start with Docker
docker run -d --name prometheus \
  -p 9090:9090 \
  -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml \
  --network host \
  prom/prometheus
```

### Grafana Setup

```bash
docker run -d --name grafana \
  -p 3000:3000 \
  --network host \
  grafana/grafana

# Access at http://localhost:3000 (admin/admin)
# Add Prometheus data source: http://localhost:9090
```

Recommended dashboard panels:
- Request rate (req/s) by endpoint
- P95/P99 latency
- Error rate (5xx responses)
- Active WebSocket connections
- Node.js heap usage

---

## Database Operations

### Schema Updates

```bash
cd server

# Apply schema changes to dev database
npx prisma db push

# Generate Prisma client after schema changes
npx prisma db generate

# Run migrations (production)
npx prisma migrate deploy
```

### Prisma Studio (GUI)

```bash
cd server && npx prisma studio
# Opens at http://localhost:5555
```

### Direct SQL Access

```bash
# SQLite
sqlite3 server/prisma/dev.db

# PostgreSQL
psql postgresql://neodem:password@localhost:5432/neodem
```

### Database Size Check

```bash
# SQLite
ls -lh server/prisma/dev.db

# PostgreSQL
psql -c "SELECT pg_size_pretty(pg_database_size('neodem'));"
```

---

## Training Workers

### Check Worker Status

Training jobs are managed via NATS JetStream. The server's `TrainingOrchestrator` handles GPU allocation.

```bash
# Check GPU allocation config
echo "GPU_TOTAL_COUNT=$GPU_TOTAL_COUNT GPU_TYPE=$GPU_TYPE GPU_MEMORY_GB=$GPU_MEMORY_GB"

# List active training jobs via API
curl http://localhost:3001/api/training/jobs | python3 -m json.tool

# Check NATS JetStream streams
nats stream ls
nats consumer ls TRAINING_JOBS
```

### Scaling Workers

Adjust `GPU_TOTAL_COUNT` in the server's environment:

```bash
# server/.env
GPU_TOTAL_COUNT=4
GPU_TYPE=nvidia-a100
GPU_MEMORY_GB=80
```

Restart the server to pick up changes. The orchestrator will schedule jobs across the available GPU pool.

---

## Object Storage

### RustFS Health

```bash
# Check RustFS health
curl http://localhost:9001/rustfs/console/index.html

# List buckets
AWS_ACCESS_KEY_ID=rustfsadmin \
AWS_SECRET_ACCESS_KEY=rustfsadmin \
aws --endpoint-url http://localhost:9000 s3 ls
```

### Required Buckets

| Bucket | Purpose |
|--------|---------|
| `training-datasets` | Upload training data (parquet, video) |
| `model-checkpoints` | Training checkpoints and artifacts |
| `production-models` | Deployed model binaries |
| `robot-logs` | Robot telemetry and compliance logs |

### Create Missing Buckets

```bash
AWS_ACCESS_KEY_ID=rustfsadmin \
AWS_SECRET_ACCESS_KEY=rustfsadmin \
aws --endpoint-url http://localhost:9000 s3 mb s3://training-datasets
```

---

## NATS Messaging

### Check NATS Status

```bash
# HTTP monitoring
curl http://localhost:8222/varz | python3 -m json.tool

# JetStream info
curl http://localhost:8222/jsz | python3 -m json.tool

# Using nats CLI
nats server info
nats stream ls
nats consumer ls
```

### Common Streams

| Stream | Purpose |
|--------|---------|
| `TRAINING_JOBS` | Training job queue |
| `TELEMETRY` | Robot telemetry data |

---

## Backups

### SQLite

```bash
# Simple file copy (while server is stopped or using .backup)
cp server/prisma/dev.db server/prisma/dev.db.backup-$(date +%Y%m%d)

# Using SQLite backup command (safe while running)
sqlite3 server/prisma/dev.db ".backup 'server/prisma/dev.db.backup'"
```

### PostgreSQL

```bash
# Full dump
pg_dump -U neodem -d neodem > neodem-backup-$(date +%Y%m%d).sql

# Docker
docker exec neodem-postgres pg_dump -U neodem neodem > backup.sql

# Restore
psql -U neodem -d neodem < backup.sql
```

### RustFS Data

```bash
# Sync all buckets to local directory
AWS_ACCESS_KEY_ID=rustfsadmin \
AWS_SECRET_ACCESS_KEY=rustfsadmin \
aws --endpoint-url http://localhost:9000 s3 sync s3://training-datasets ./backup/training-datasets
aws --endpoint-url http://localhost:9000 s3 sync s3://model-checkpoints ./backup/model-checkpoints
```
