# NeoDEM — Incident Runbook

Procedures for diagnosing and resolving common incidents.

---

## INC-1: Training Worker Crashed

**Symptoms:** Training job stuck in `running` state, no progress updates, worker process exited.

### Diagnose

```bash
# Check if the worker process is alive
# systemd
sudo systemctl status neodem-server
sudo journalctl -u neodem-server --since "1 hour ago" -o cat | jq 'select(.level >= 50)'

# Docker
docker-compose logs --tail 200 server | jq 'select(.msg | test("training|worker|gpu"; "i"))'

# Check NATS consumer status
curl http://localhost:8222/jsz | python3 -m json.tool
nats consumer info TRAINING_JOBS worker
```

### Restart

```bash
# systemd
sudo systemctl restart neodem-server

# Docker
docker-compose restart server

# Kubernetes
kubectl rollout restart deployment/neodem-server -n neodem
```

### Requeue Stuck Jobs

Jobs stuck in `running` state need manual intervention:

```bash
# List stuck jobs
curl http://localhost:3001/api/training/jobs?status=running | python3 -m json.tool

# Cancel and requeue a specific job (replace <job-id>)
curl -X PATCH http://localhost:3001/api/training/jobs/<job-id> \
  -H "Content-Type: application/json" \
  -d '{"status": "queued"}'
```

If the NATS consumer has unacknowledged messages:

```bash
# Check pending messages
nats consumer info TRAINING_JOBS worker

# Purge the stream (DESTRUCTIVE — only if jobs will be requeued via API)
nats stream purge TRAINING_JOBS --force
```

### Prevent

- Set `GPU_TOTAL_COUNT` accurately — over-provisioning causes OOM
- Monitor GPU memory usage in production
- Set up alerts on training job duration exceeding 2x expected time

---

## INC-2: Deployment Regression

**Symptoms:** Server returning 500 errors after a deploy, features broken, UI not loading.

### Immediate Assessment

```bash
# Health check
curl -s http://localhost:3001/health | python3 -m json.tool

# Recent error logs
sudo journalctl -u neodem-server --since "10 min ago" -o cat | jq 'select(.level >= 50)' | head -20

# What was just deployed?
cd ~/develop/robot-management-system
git log --oneline -5
```

### Rollback

#### systemd (Raspberry Pi)

```bash
cd ~/develop/robot-management-system

# Find the last known good commit
git log --oneline -10

# Rollback
git checkout <last-good-commit>

# Rebuild and restart
cd server && npm install && cd ..
cd app && npm install && cd ..
sudo systemctl restart neodem-server neodem-agent neodem-app
```

#### Docker Compose

```bash
# Rollback to previous image tag
docker-compose down
git checkout <last-good-commit>
docker-compose up -d --build
```

#### Kubernetes (Helm)

```bash
# List release history
helm history neodem

# Rollback to previous revision
helm rollback neodem <revision-number>

# Verify
kubectl get pods -n neodem -w
```

### Post-Rollback

1. Verify health: `curl http://localhost:3001/health`
2. Verify app loads in browser
3. Check robot agents reconnect (they auto-retry)
4. Open a GitHub issue documenting what broke and why

---

## INC-3: NATS Outage

**Symptoms:** Training jobs not starting, WebSocket events not propagating, "NATS connection refused" in logs.

### Impact

NATS is **optional** — the server continues to serve API requests without it. Affected features:
- Training job queuing and worker dispatch
- Real-time telemetry streaming
- Synthetic data generation pipeline

### Diagnose

```bash
# Check NATS process
# systemd
sudo systemctl status nats

# Docker
docker-compose ps nats
docker-compose logs --tail 50 nats

# Health endpoint
curl http://localhost:8222/healthz

# Check disk space (JetStream stores on disk)
df -h /var/lib/nats
```

### Recover

```bash
# Restart NATS
# systemd
sudo systemctl restart nats

# Docker
docker-compose restart nats

# If data is corrupted, reset JetStream storage (DESTRUCTIVE)
docker-compose down nats
docker volume rm robot-management-system_nats_data
docker-compose up -d nats
```

After NATS recovery, the server reconnects automatically (built-in retry). No server restart needed.

### If NATS Cannot Be Recovered

The server will log warnings but remain functional. To suppress NATS-dependent features:

```bash
# Unset NATS connection (server will skip NATS initialization)
# In server/.env: comment out NATS_SERVERS
# Restart server
```

---

## INC-4: RustFS (MinIO) Outage

**Symptoms:** Dataset uploads failing, model downloads failing, "S3 connection refused" errors.

### Impact

RustFS is **optional** — the server continues to work without it. Affected features:
- Dataset upload/download (parquet, video)
- Model checkpoint storage
- MLflow artifact storage

### Diagnose

```bash
# Check RustFS process
docker-compose ps rustfs
docker-compose logs --tail 50 rustfs

# Health check
curl http://localhost:9001/rustfs/console/index.html

# Check disk space
df -h
docker system df
```

### Recover

```bash
# Restart
docker-compose restart rustfs

# Wait for init container to re-create buckets
docker-compose restart rustfs-init

# Verify buckets exist
AWS_ACCESS_KEY_ID=rustfsadmin \
AWS_SECRET_ACCESS_KEY=rustfsadmin \
aws --endpoint-url http://localhost:9000 s3 ls
```

### Data Recovery

RustFS data is stored in a Docker volume (`rustfs_data`). If the volume is intact, data survives container restarts.

```bash
# Check volume
docker volume inspect robot-management-system_rustfs_data

# If volume is corrupted, restore from backup
docker-compose down rustfs
docker volume rm robot-management-system_rustfs_data
docker-compose up -d rustfs rustfs-init

# Restore backed-up data
aws --endpoint-url http://localhost:9000 s3 sync ./backup/training-datasets s3://training-datasets
```

---

## INC-5: Database Issues

### SQLite: Database Locked

**Symptoms:** `SQLITE_BUSY: database is locked`

```bash
# Find processes holding the lock
fuser server/prisma/dev.db

# If a stale process, kill it
kill <pid>

# Restart server
sudo systemctl restart neodem-server
```

### PostgreSQL: Connection Refused

```bash
# Check PostgreSQL
docker-compose ps postgres
docker-compose logs postgres

# Restart
docker-compose restart postgres

# After PostgreSQL is back, server reconnects automatically via Prisma connection pool
```

### Schema Drift

If the database schema is out of sync with the Prisma schema:

```bash
cd server

# Check drift
npx prisma db pull    # Pull current DB schema
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma

# Fix drift
npx prisma db push    # Dev: push schema directly
npx prisma migrate deploy  # Prod: run pending migrations
```

---

## INC-6: Robot Agent Disconnected

**Symptoms:** Robot shows as "offline" in the dashboard, agent health check fails.

### Diagnose

```bash
# Direct health check
curl http://<robot-ip>:41245/health

# Check agent logs
sudo journalctl -u neodem-agent -f

# Check if server can reach the agent
curl http://localhost:3001/api/robots | python3 -m json.tool
```

### Recover

```bash
# Restart the agent
sudo systemctl restart neodem-agent

# If using SO-101 hardware, also restart the sidecar
sudo systemctl restart so101-sidecar
```

The agent re-registers with the server automatically on startup.

### Hardware Sidecar Issues (SO-101)

```bash
# Check sidecar
curl http://localhost:8765/health

# Check USB connection to servos
ls /dev/ttyACM*

# Restart sidecar
sudo systemctl restart so101-sidecar
```

---

## INC-7: Security Incident

### Immediate Actions

1. **Isolate the affected system:**
```bash
# Kill network access (if compromised machine)
sudo iptables -A INPUT -j DROP
sudo iptables -A OUTPUT -j DROP
# Or disconnect from network physically
```

2. **Preserve evidence:**
```bash
# Snapshot logs before they rotate
sudo journalctl --since "24 hours ago" > /tmp/incident-logs-$(date +%Y%m%d-%H%M).log
docker-compose logs > /tmp/incident-docker-logs-$(date +%Y%m%d-%H%M).log
```

3. **Rotate all secrets immediately:**
```bash
# Generate new secrets
NEW_JWT=$(openssl rand -base64 48)
NEW_WORKER_TOKEN=$(openssl rand -hex 32)
NEW_COMPLIANCE_KEY=$(openssl rand -hex 32)

# Update server/.env with new values
# Restart all services
```

4. **Check for unauthorized access:**
```bash
# Review auth logs
sudo journalctl -u neodem-server -o cat | jq 'select(.url | test("/api/auth"; "i"))'

# Check for unusual API activity
sudo journalctl -u neodem-server -o cat | jq 'select(.statusCode == 401 or .statusCode == 403)'

# Review compliance logs (if encryption key is still valid)
curl http://localhost:3001/api/compliance/audit-logs?limit=100 | python3 -m json.tool
```

5. **Notify stakeholders** — escalate to the project lead.

### Post-Incident

- Document what happened, how it was discovered, and what was done
- Conduct a root cause analysis
- Update this runbook with any new procedures
- Review and tighten CORS_ORIGINS, rate limits, and auth settings

---

## General Escalation Path

| Severity | Action |
|----------|--------|
| Service restartable | Restart and monitor |
| Data loss risk | Stop writes, take backup, then fix |
| Security breach | Isolate immediately, rotate secrets, notify team lead |
| Hardware damage risk | Power off robot agent, disconnect servos |

## Health Check Summary

```bash
# Quick all-services health check
echo "=== Server ===" && curl -sf http://localhost:3001/health && echo " OK" || echo " FAIL"
echo "=== Agent ===" && curl -sf http://localhost:41245/health && echo " OK" || echo " FAIL"
echo "=== NATS ===" && curl -sf http://localhost:8222/healthz && echo " OK" || echo " FAIL"
echo "=== RustFS ===" && curl -sf http://localhost:9001/rustfs/console/index.html > /dev/null && echo " OK" || echo " FAIL"
echo "=== VLA ===" && curl -sf http://localhost:8000/health && echo " OK" || echo " FAIL"
```
