# NeoDEM — Deployment Guide

This guide covers deploying NeoDEM across three environments: **Raspberry Pi** (single-node dev/test), **Docker Compose** (local full-stack), and **Kubernetes** (production via Helm).

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Raspberry Pi Setup (systemd)](#raspberry-pi-setup-systemd)
- [Docker Compose](#docker-compose)
- [Kubernetes (Helm)](#kubernetes-helm)
- [Environment Variables Reference](#environment-variables-reference)
- [PostgreSQL Migration (SQLite → PostgreSQL)](#postgresql-migration)
- [TLS / HTTPS](#tls--https)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Ingress / Reverse Proxy                     │
└────────────────┬──────────────────────┬─────────────────────────────┘
                 │                      │
         ┌───────▼───────┐      ┌───────▼───────┐
         │     App       │      │    Server     │◄──────────┐
         │  (React/Vite) │      │  (Node.js)    │           │
         │  Port 1420/80 │      │  Port 3001    │           │
         └───────────────┘      └───────┬───────┘           │
                                        │                   │
          ┌──────────┬──────────────────┼───────────────────┤
          │          │                  │                    │
          ▼          ▼                  ▼                    ▼
   ┌──────────┐ ┌──────────┐   ┌──────────────┐   ┌──────────────┐
   │   NATS   │ │ Postgres │   │ Robot Agent   │   │  VLA Server  │
   │ JetStream│ │ / SQLite │   │ A2A Protocol  │   │   FastAPI    │
   │ 4222     │ │   5432   │   │   41245       │   │    8000      │
   └──────────┘ └──────────┘   └───────┬───────┘   └──────────────┘
        │                              │
        ▼                              ▼
   ┌──────────┐                ┌──────────────┐
   │  RustFS  │                │ HW Sidecar   │
   │ S3 Store │                │ (SO-101)     │
   │ 9000     │                │  8765        │
   └──────────┘                └──────────────┘
```

| Component | Port | Description |
|-----------|------|-------------|
| **App** | 1420 (dev) / 80 (prod) | React + Tauri frontend |
| **Server** | 3001 | Node.js API, WebSocket, Prisma ORM |
| **Robot Agent** | 41245 | AI-powered robot agent (A2A protocol) |
| **VLA Server** | 8000 | FastAPI VLA inference (SmolVLA, Pi0.5, GR00T) |
| **Hardware Sidecar** | 8765 | HTTP → LeRobot SO-101 (servos, camera) |
| **NATS** | 4222 / 8222 | JetStream message queue (optional) |
| **PostgreSQL** | 5432 | Production database (SQLite for dev) |
| **RustFS** | 9000 / 9001 | S3-compatible object storage (optional) |

---

## Raspberry Pi Setup (systemd)

This is the setup used on the NeoDEM reference platform (Raspberry Pi 5, Debian 12 aarch64).

### Prerequisites

- Raspberry Pi 5 (4GB+ RAM recommended)
- Node.js 22+ (`nvm install 22`)
- Python 3.12+ (for VLA server / hardware sidecar)
- Git, build-essential

### 1. Clone and Install

```bash
cd ~/develop
git clone https://github.com/RaaSaaR-org/robot-management-system.git
cd robot-management-system

# Install dependencies
cd server && npm install && cd ..
cd robot-agent && npm install && cd ..
cd app && npm install && cd ..
```

### 2. Configure Environment

```bash
# Server — SQLite for local dev
cp server/.env.example server/.env
# Edit server/.env:
#   DATABASE_URL="file:./dev.db"
#   AUTH_DISABLED=true
#   RATE_LIMIT_DISABLED=true

# Robot Agent
cp robot-agent/.env.example robot-agent/.env
# Edit robot-agent/.env:
#   GEMINI_API_KEY=your-key
#   SERVER_URL=http://localhost:3001
```

### 3. Initialize Database

```bash
cd server
npx prisma db push
cd ..
```

### 4. Create systemd Services

Create these unit files in `/etc/systemd/system/`:

**neodem-server.service:**
```ini
[Unit]
Description=NeoDEM Server
After=network.target

[Service]
Type=simple
User=mindcube
WorkingDirectory=/home/mindcube/develop/robot-management-system/server
EnvironmentFile=/home/mindcube/develop/robot-management-system/server/.env
Environment=PATH=/home/mindcube/.nvm/versions/node/v22.17.1/bin:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=development
ExecStart=/home/mindcube/.nvm/versions/node/v22.17.1/bin/node node_modules/.bin/tsx src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**neodem-agent.service:**
```ini
[Unit]
Description=NeoDEM Robot Agent (SO-101)
After=network.target neodem-server.service

[Service]
Type=simple
User=mindcube
WorkingDirectory=/home/mindcube/develop/robot-management-system/robot-agent
Environment=PATH=/home/mindcube/.nvm/versions/node/v22.17.1/bin:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=development
ExecStart=/home/mindcube/.nvm/versions/node/v22.17.1/bin/node node_modules/.bin/tsx --env-file=.env.so101 src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**neodem-app.service:**
```ini
[Unit]
Description=NeoDEM App (Vite dev server)
After=network.target

[Service]
Type=simple
User=mindcube
WorkingDirectory=/home/mindcube/develop/robot-management-system/app
Environment=PATH=/home/mindcube/.nvm/versions/node/v22.17.1/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/mindcube/.nvm/versions/node/v22.17.1/bin/node node_modules/.bin/vite --host 0.0.0.0
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 5. Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable neodem-server neodem-agent neodem-app
sudo systemctl start neodem-server
sudo systemctl start neodem-agent
sudo systemctl start neodem-app

# Verify
sudo systemctl status neodem-server neodem-agent neodem-app
```

### 6. Access

| Service | URL |
|---------|-----|
| App | `http://<pi-ip>:1420` |
| Server API | `http://<pi-ip>:3001` |
| Server Health | `http://<pi-ip>:3001/health` |
| Robot Agent | `http://<pi-ip>:41245` |

---

## Docker Compose

### 1. Environment Setup

Create a `.env` file in the project root:

```bash
# Required
POSTGRES_PASSWORD=your-secure-password
JWT_SECRET=your-jwt-secret-min-32-chars

# Optional — AI Features
GOOGLE_API_KEY=your-google-api-key
GEMINI_API_KEY=your-gemini-api-key

# Optional — Object Storage
RUSTFS_ACCESS_KEY=rustfsadmin
RUSTFS_SECRET_KEY=rustfsadmin

# Optional — Dev overrides
AUTH_DISABLED=true
ROBOT_ID=sim-robot-001
ROBOT_NAME=SimBot-01
```

### 2. Start Services

```bash
# Build and start all services
docker-compose up -d --build

# Or start infrastructure first, then applications
docker-compose up -d nats postgres rustfs
docker-compose up -d server
docker-compose up -d app robot-agent
```

### 3. Verify

```bash
docker-compose ps
curl http://localhost:3001/health      # Server
curl http://localhost/                 # App (nginx, port 80)
curl http://localhost:41243/health     # Robot Agent
curl http://localhost:8222/healthz     # NATS
```

### 4. Service URLs

| Service | URL |
|---------|-----|
| App (Frontend) | http://localhost |
| Server API | http://localhost:3001 |
| Robot Agent | http://localhost:41243 |
| NATS Monitoring | http://localhost:8222 |
| RustFS Console | http://localhost:9001 |
| RustFS S3 API | http://localhost:9000 |
| VLA Server | http://localhost:8000 |
| PostgreSQL | localhost:5432 (user: neodem) |

### 5. Stop

```bash
docker-compose down        # Stop services
docker-compose down -v     # Stop + remove volumes (fresh start)
```

---

## Kubernetes (Helm)

The Helm chart is in `helm/neodem/` with 30 resource templates.

### Prerequisites

- kubectl configured for your cluster
- Helm 3.0+
- Kubernetes 1.24+
- Ingress controller (nginx-ingress recommended)

### Quick Start

```bash
helm install neodem helm/neodem \
  -f helm/neodem/values-local.yaml \
  --set postgres.auth.password=mypassword \
  --set secrets.jwtSecret=my-jwt-secret-32-chars-min \
  --set rustfs.auth.accessKey=your-access-key \
  --set rustfs.auth.secretKey=your-secret-key
```

### Building Container Images

```bash
docker-compose build

# Tag and push
docker tag neodem/server:latest your-registry/neodem/server:v1.0.0
docker tag neodem/app:latest your-registry/neodem/app:v1.0.0
docker tag neodem/robot-agent:latest your-registry/neodem/robot-agent:v1.0.0

docker push your-registry/neodem/server:v1.0.0
docker push your-registry/neodem/app:v1.0.0
docker push your-registry/neodem/robot-agent:v1.0.0
```

### Production Deployment

#### 1. Create Namespace and Secrets

```bash
kubectl create namespace neodem

# Private registry (if needed)
kubectl create secret docker-registry regcred \
  --namespace neodem \
  --docker-server=your-registry.com \
  --docker-username=your-username \
  --docker-password=your-password
```

#### 2. Configure Values

Edit `helm/neodem/values-production.yaml`:

```yaml
ingress:
  host: neodem.yourdomain.com
  tls: true
  tlsSecretName: neodem-tls

server:
  image:
    repository: your-registry/neodem/server
    tag: v1.0.0
  env:
    CORS_ORIGINS: "https://neodem.yourdomain.com"
    RATE_LIMIT_DISABLED: "false"
    NODE_ENV: "production"

app:
  image:
    repository: your-registry/neodem/app
    tag: v1.0.0
```

#### 3. Install

```bash
helm install neodem helm/neodem \
  -f helm/neodem/values-production.yaml \
  --set postgres.auth.password=$DB_PASSWORD \
  --set secrets.jwtSecret=$JWT_SECRET \
  --set secrets.googleApiKey=$GOOGLE_API_KEY \
  --set secrets.geminiApiKey=$GEMINI_API_KEY
```

#### 4. Verify

```bash
kubectl get pods -n neodem
kubectl get svc -n neodem
kubectl get ingress -n neodem
kubectl logs -f deployment/neodem-server -n neodem
```

### Helm Values Reference

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.namespace` | Kubernetes namespace | `neodem` |
| `postgres.enabled` | Deploy PostgreSQL | `true` |
| `postgres.storage` | PVC storage size | `10Gi` |
| `postgres.auth.password` | Database password | `""` (required) |
| `server.replicaCount` | Server replicas | `2` |
| `server.env.AUTH_DISABLED` | Disable auth | `"false"` |
| `server.env.RATE_LIMIT_DISABLED` | Disable rate limits | `"false"` |
| `app.replicaCount` | App replicas | `2` |
| `robotAgent.enabled` | Deploy robot agent | `true` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.host` | Ingress hostname | `neodem.local` |
| `ingress.tls` | Enable TLS | `false` |
| `secrets.jwtSecret` | JWT signing secret | `""` (required) |
| `secrets.googleApiKey` | Google API key | `""` |
| `secrets.geminiApiKey` | Gemini API key | `""` |

---

## Environment Variables Reference

### Server (`server/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | `file:./dev.db` | Database connection string |
| `JWT_SECRET` | Prod | `dev-secret-...` | JWT signing secret (32+ chars) |
| `JWT_ACCESS_EXPIRES` | No | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES` | No | `7d` | Refresh token TTL |
| `AUTH_DISABLED` | No | `false` | Disable authentication (dev only) |
| `CORS_ORIGINS` | No | localhost ports | Comma-separated allowed origins |
| `RATE_LIMIT_DISABLED` | No | `false` | Disable rate limiting (dev only) |
| `GOOGLE_API_KEY` | No | — | Google/Gemini API key for NL commands |
| `WORKER_API_TOKEN` | Prod | — | Shared token for GPU worker auth |
| `NATS_SERVERS` | No | `nats://localhost:4222` | NATS connection URL |
| `NATS_USER` | No | — | NATS auth user |
| `NATS_PASS` | No | — | NATS auth password |
| `RUSTFS_ENDPOINT` | No | `http://localhost:9000` | S3-compatible storage endpoint |
| `RUSTFS_ACCESS_KEY` | No | `rustfsadmin` | S3 access key |
| `RUSTFS_SECRET_KEY` | No | `rustfsadmin` | S3 secret key |
| `COMPLIANCE_LOG_ENCRYPTION_KEY` | Prod | — | 64-char hex key for compliance logs |
| `OPENROUTER_API_KEY` | No | — | OpenRouter key for orchestrator LLM |
| `ORCHESTRATOR_MODEL` | No | `stepfun/step-3.5-flash:free` | LLM model for agent routing |
| `PUBLIC_URL` | No | — | Server's public URL for agent discovery |

### Robot Agent (`robot-agent/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | Yes | — | Gemini API key for AI reasoning |
| `PORT` | No | `41243` | Agent HTTP port |
| `SERVER_URL` | No | `http://localhost:3001` | Server URL for registration |
| `PUBLIC_URL` | No | `http://localhost:41243` | Agent's public URL |
| `ROBOT_ID` | No | `sim-robot-001` | Unique robot identifier |
| `ROBOT_NAME` | No | `SimBot-01` | Display name |
| `ROBOT_MODEL` | No | `SimBot H1` | Robot model name |
| `ROBOT_CLASS` | No | `standard` | `lightweight`, `standard`, `heavy-duty` |
| `MAX_PAYLOAD_KG` | No | `10` | Max payload in kg |
| `LLM_PROVIDER` | No | `gemini` | `gemini` or `openrouter` |
| `OPENROUTER_API_KEY` | No | — | OpenRouter API key (alternative) |
| `LLM_MODEL` | No | — | Override default LLM model |

### App (`app/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_BASE_URL` | No | `http://localhost:3001/api` | Server API URL |
| `VITE_WS_URL` | No | — | WebSocket URL override |
| `VITE_A2A_SERVER_URL` | No | — | A2A server URL override |

---

## PostgreSQL Migration

To migrate from SQLite (dev) to PostgreSQL (production):

### 1. Set Up PostgreSQL

```bash
# Docker (quickest)
docker run -d --name neodem-postgres \
  -e POSTGRES_DB=neodem \
  -e POSTGRES_USER=neodem \
  -e POSTGRES_PASSWORD=your-secure-password \
  -p 5432:5432 \
  postgres:16-alpine
```

### 2. Update Server Config

```bash
# server/.env
DATABASE_URL="postgresql://neodem:your-secure-password@localhost:5432/neodem"
```

### 3. Push Schema

```bash
cd server
npx prisma db push
```

The Prisma schema already uses `provider = "postgresql"`. For SQLite dev, this provider can be overridden, but the canonical schema targets PostgreSQL.

### 4. Seed Data (Optional)

```bash
cd server
npx prisma db seed
```

---

## TLS / HTTPS

### With cert-manager (Kubernetes)

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create ClusterIssuer
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@domain.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
```

Then set in `values-production.yaml`:
```yaml
ingress:
  tls: true
  tlsSecretName: neodem-tls
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
```

### With Caddy (Raspberry Pi / bare-metal)

```bash
# Install Caddy
sudo apt install caddy

# /etc/caddy/Caddyfile
neodem.yourdomain.com {
    handle /api/* {
        reverse_proxy localhost:3001
    }
    handle /ws/* {
        reverse_proxy localhost:3001
    }
    handle {
        reverse_proxy localhost:1420
    }
}
```

---

## Troubleshooting

### systemd Services Not Starting

```bash
sudo journalctl -u neodem-server -f     # Live logs
sudo systemctl status neodem-server      # Status + last error
```

Common causes:
- Wrong Node.js path — check `which node` and update the `ExecStart` path
- Missing `.env` file — ensure `EnvironmentFile` path is correct
- Port conflict — check `ss -tlnp | grep 3001`

### Docker: Container Restarting

```bash
docker-compose logs -f server    # Check crash logs
docker-compose ps                # Check health status
```

### Kubernetes: Pods Not Starting

```bash
kubectl describe pod <pod-name> -n neodem
kubectl get events -n neodem --sort-by='.lastTimestamp'
kubectl logs -f deployment/neodem-server -n neodem
```

### Database Connection Issues

```bash
# SQLite — check file exists
ls -la server/prisma/dev.db

# PostgreSQL — test connection
psql postgresql://neodem:pass@localhost:5432/neodem -c "SELECT 1"

# Re-push schema
cd server && npx prisma db push
```

### Health Endpoints

All services expose health checks:

```bash
curl http://localhost:3001/health     # Server
curl http://localhost:41245/health    # Robot Agent
curl http://localhost:8000/health     # VLA Server
curl http://localhost:8222/healthz    # NATS
```
