# NeoDEM — Deployment Guide

> *"Free your mind."* — Morpheus

This guide covers deploying NeoDEM to Docker and Kubernetes environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Docker Compose (Local Development)](#docker-compose-local-development)
- [Services Overview](#services-overview)
- [Kubernetes Deployment](#kubernetes-deployment)
  - [Local (minikube/kind)](#local-minikubekind)
  - [Production (Self-hosted Cluster)](#production-self-hosted-cluster)
- [Configuration Reference](#configuration-reference)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### For Docker Compose
- Docker 20.10+
- Docker Compose v2.0+

### For Kubernetes
- kubectl configured for your cluster
- Helm 3.0+
- Kubernetes 1.24+
- Ingress controller (nginx-ingress recommended)

### Required API Keys (Optional but Recommended)
- `GOOGLE_API_KEY` - For server AI features
- `GEMINI_API_KEY` - For robot agent AI

---

## Quick Start

### Docker Compose (Fastest)

```bash
# Clone and navigate to project
cd robot-management-system

# Start all services
docker-compose up -d --build

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Access the app
open http://localhost
```

### Kubernetes (Helm)

```bash
# Install with Helm
helm install neodem helm/neodem \
  -f helm/neodem/values-local.yaml \
  --set postgres.auth.password=mypassword \
  --set secrets.jwtSecret=my-jwt-secret \
  --set rustfs.auth.accessKey=minio-key \
  --set rustfs.auth.secretKey=minio-secret

# Check pods
kubectl get pods -n neodem
```

---

## Services Overview

NeoDEM consists of 9 services in Docker Compose:

| Service | Port(s) | Description |
|---------|---------|-------------|
| **App** | 80 | React frontend (nginx) |
| **Server** | 3001 | Node.js API server |
| **Robot Agent** | 41243 | Simulated robot with AI |
| **PostgreSQL** | 5432 | Primary database |
| **NATS** | 4222, 8222 | Message queue (JetStream) |
| **RustFS** | 9000, 9001 | S3-compatible object storage |
| **MLflow** | 5000 | Model registry & tracking |
| **VLA Server** | 8000 | Vision-Language-Action model server |
| **RustFS-Init** | - | Bucket initialization (one-shot) |

---

## Docker Compose (Local Development)

### 1. Environment Setup

Create a `.env` file in the project root:

```bash
# Required
POSTGRES_PASSWORD=your-secure-password
JWT_SECRET=your-jwt-secret-min-32-chars

# Optional - AI Features
GOOGLE_API_KEY=your-google-api-key
GEMINI_API_KEY=your-gemini-api-key

# Optional - Object Storage
RUSTFS_ACCESS_KEY=rustfsadmin
RUSTFS_SECRET_KEY=rustfsadmin

# Optional - Customization
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
docker-compose up -d mlflow
docker-compose up -d server
docker-compose up -d app robot-agent vla-inference
```

### 3. Verify Deployment

```bash
# Check all services are running
docker-compose ps

# Check health endpoints
curl http://localhost:3001/health      # Server
curl http://localhost/                 # App
curl http://localhost:41243/health     # Robot Agent
curl http://localhost:8222/healthz     # NATS
curl http://localhost:5000/health      # MLflow

# View logs
docker-compose logs -f server
docker-compose logs -f nats
```

### 4. Access Services

| Service | URL | Description |
|---------|-----|-------------|
| **App (Frontend)** | http://localhost | Main web application |
| **Server (API)** | http://localhost:3001 | REST API + WebSocket |
| **Server Health** | http://localhost:3001/health | Health check endpoint |
| **Robot Agent** | http://localhost:41243 | Robot A2A endpoint |
| **NATS Monitoring** | http://localhost:8222 | NATS server monitoring |
| **RustFS Console** | http://localhost:9001 | S3 storage web console |
| **RustFS S3 API** | http://localhost:9000 | S3-compatible API |
| **MLflow UI** | http://localhost:5000 | Model tracking dashboard |
| **VLA Server** | http://localhost:8000 | VLA inference HTTP |
| **PostgreSQL** | localhost:5432 | Database (user: neodem) |

### 5. Test Service Connectivity

```bash
# Test NATS
curl http://localhost:8222/varz

# Test RustFS (list buckets)
AWS_ACCESS_KEY_ID=rustfsadmin \
AWS_SECRET_ACCESS_KEY=rustfsadmin \
aws --endpoint-url http://localhost:9000 s3 ls

# Test MLflow
curl http://localhost:5000/api/2.0/mlflow/experiments/list

# Test VLA Server
curl http://localhost:8000/health
```

### 6. Stop Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (fresh start)
docker-compose down -v
```

---

## Kubernetes Deployment

### Building Container Images

Before deploying to Kubernetes, build and push your images:

```bash
# Build images
docker-compose build

# Tag for your registry
docker tag neodem/server:latest your-registry/neodem/server:v1.0.0
docker tag neodem/app:latest your-registry/neodem/app:v1.0.0
docker tag neodem/robot-agent:latest your-registry/neodem/robot-agent:v1.0.0

# Push to registry
docker push your-registry/neodem/server:v1.0.0
docker push your-registry/neodem/app:v1.0.0
docker push your-registry/neodem/robot-agent:v1.0.0
```

### Local (minikube/kind)

#### 1. Start Local Cluster

```bash
# Using minikube
minikube start
minikube addons enable ingress

# Or using kind
kind create cluster
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
```

#### 2. Load Images (for local images)

```bash
# For minikube
eval $(minikube docker-env)
docker-compose build

# For kind
kind load docker-image neodem/server:latest
kind load docker-image neodem/app:latest
kind load docker-image neodem/robot-agent:latest
```

#### 3. Install with Helm

```bash
helm install neodem helm/neodem \
  -f helm/neodem/values-local.yaml \
  --set postgres.auth.password=localpassword \
  --set secrets.jwtSecret=local-dev-secret-32-chars-min
```

#### 4. Setup Local DNS

Add to `/etc/hosts`:
```
127.0.0.1 neodem.local
```

For minikube, use minikube IP:
```bash
echo "$(minikube ip) neodem.local" | sudo tee -a /etc/hosts
```

#### 5. Access the Application

```bash
# With ingress
open http://neodem.local

# Or via port-forward
kubectl port-forward -n neodem svc/neodem-app 8080:80
open http://localhost:8080
```

### Production (Self-hosted Cluster)

#### 1. Update Values

Edit `helm/neodem/values-production.yaml`:

```yaml
ingress:
  host: neodem.yourdomain.com  # Your actual domain
  tls: true
  tlsSecretName: neodem-tls

server:
  image:
    repository: your-registry/neodem/server
    tag: v1.0.0

app:
  image:
    repository: your-registry/neodem/app
    tag: v1.0.0
```

#### 2. Create Namespace

```bash
kubectl create namespace neodem
```

#### 3. Setup Image Pull Secrets (if using private registry)

```bash
kubectl create secret docker-registry regcred \
  --namespace neodem \
  --docker-server=your-registry.com \
  --docker-username=your-username \
  --docker-password=your-password
```

Then add to `values-production.yaml`:
```yaml
global:
  imagePullSecrets:
    - name: regcred
```

#### 4. Install with Helm

```bash
helm install neodem helm/neodem \
  -f helm/neodem/values-production.yaml \
  --set postgres.auth.password=$DB_PASSWORD \
  --set secrets.jwtSecret=$JWT_SECRET \
  --set secrets.googleApiKey=$GOOGLE_API_KEY \
  --set secrets.geminiApiKey=$GEMINI_API_KEY
```

#### 5. Setup TLS (with cert-manager)

If using cert-manager for automatic TLS:

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create ClusterIssuer for Let's Encrypt
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

#### 6. Verify Deployment

```bash
# Check pods
kubectl get pods -n neodem

# Check services
kubectl get svc -n neodem

# Check ingress
kubectl get ingress -n neodem

# Check logs
kubectl logs -f deployment/neodem-server -n neodem
```

---

## Configuration Reference

### Helm Values

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.namespace` | Kubernetes namespace | `neodem` |
| `global.imageRegistry` | Image registry prefix | `""` |
| `postgres.enabled` | Deploy PostgreSQL | `true` |
| `postgres.storage` | PVC storage size | `10Gi` |
| `postgres.auth.password` | Database password | `""` (required) |
| `server.replicaCount` | Server replicas | `2` |
| `server.env.AUTH_DISABLED` | Disable auth | `"false"` |
| `app.replicaCount` | App replicas | `2` |
| `robotAgent.enabled` | Deploy robot agent | `true` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.host` | Ingress hostname | `neodem.local` |
| `ingress.tls` | Enable TLS | `false` |
| `secrets.jwtSecret` | JWT signing secret | `""` (required) |
| `secrets.googleApiKey` | Google API key | `""` |
| `secrets.geminiApiKey` | Gemini API key | `""` |

### Environment Variables

| Variable | Component | Description |
|----------|-----------|-------------|
| `DATABASE_URL` | Server | PostgreSQL connection string |
| `JWT_SECRET` | Server | JWT signing secret |
| `AUTH_DISABLED` | Server | Disable authentication |
| `GOOGLE_API_KEY` | Server | Google AI API key |
| `PUBLIC_URL` | Server, Robot | Public URL for agent discovery |
| `GEMINI_API_KEY` | Robot | Gemini API key |
| `SERVER_URL` | Robot | Server URL for registration |
| `ROBOT_ID` | Robot | Unique robot identifier |
| `ROBOT_NAME` | Robot | Display name |

---

## Troubleshooting

### Common Issues

#### Pods not starting

```bash
# Check pod status
kubectl describe pod <pod-name> -n neodem

# Check events
kubectl get events -n neodem --sort-by='.lastTimestamp'
```

#### Database connection errors

```bash
# Check PostgreSQL is running
kubectl get pods -n neodem | grep postgres

# Check PostgreSQL logs
kubectl logs deployment/neodem-postgres -n neodem

# Verify secret exists
kubectl get secret neodem-secrets -n neodem -o yaml
```

#### Ingress not working

```bash
# Check ingress controller
kubectl get pods -n ingress-nginx

# Check ingress resource
kubectl describe ingress neodem-ingress -n neodem

# Check if services are accessible
kubectl port-forward -n neodem svc/neodem-app 8080:80
```

#### Image pull errors

```bash
# Check image pull secrets
kubectl get secret -n neodem

# Verify image exists
docker pull your-registry/neodem/server:v1.0.0
```

### Useful Commands

```bash
# View all resources
kubectl get all -n neodem

# Watch pod status
kubectl get pods -n neodem -w

# Execute into pod
kubectl exec -it deployment/neodem-server -n neodem -- sh

# Port forward for debugging
kubectl port-forward -n neodem svc/neodem-server 3001:3001

# View Helm release
helm list
helm status neodem

# Upgrade deployment
helm upgrade neodem helm/neodem -f helm/neodem/values-production.yaml

# Rollback
helm rollback neodem 1

# Uninstall
helm uninstall neodem
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Ingress                                     │
│                          (nginx-ingress)                                 │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
      ┌───────────────┐               ┌───────────────┐
      │     App       │               │    Server     │◄────────┐
      │   (nginx)     │               │  (Node.js)    │         │
      │   Port: 80    │               │  Port: 3001   │         │
      └───────────────┘               └───────┬───────┘         │
                                              │                 │
          ┌───────────────┬───────────────────┼─────────────────┤
          │               │                   │                 │
          ▼               ▼                   ▼                 ▼
  ┌───────────────┐ ┌───────────┐   ┌───────────────┐  ┌───────────────┐
  │     NATS      │ │ PostgreSQL│   │  Robot Agent  │  │  VLA Server   │
  │  JetStream    │ │   + MLflow│   │  A2A Protocol │  │   FastAPI     │
  │ 4222 / 8222   │ │    5432   │   │    41243      │  │    8000       │
  └───────────────┘ └───────────┘   └───────────────┘  └───────────────┘
          │                                 │
          │         ┌───────────────────────┘
          │         │
          ▼         ▼
  ┌─────────────────────┐     ┌───────────────┐
  │      RustFS         │     │    MLflow     │
  │  S3-Compatible      │◄────│   Tracking    │
  │   9000 / 9001       │     │     5000      │
  └─────────────────────┘     └───────────────┘
```

**Service Dependencies:**
- Server → PostgreSQL, NATS, RustFS, MLflow
- MLflow → PostgreSQL, RustFS
- Robot Agent → Server (for registration)
- VLA Inference → Standalone (can connect to Server)

---

## Next Steps

1. **Production Checklist**
   - [ ] Set strong passwords and secrets
   - [ ] Configure TLS/HTTPS
   - [ ] Set up monitoring (Prometheus/Grafana)
   - [ ] Configure backup for PostgreSQL
   - [ ] Set up logging (ELK/Loki)
   - [ ] Configure resource limits appropriately

2. **Scaling**
   - Increase replica counts for high availability
   - Consider external PostgreSQL (RDS, Cloud SQL)
   - Add Redis for session management

3. **Monitoring**
   - Deploy Prometheus for metrics
   - Deploy Grafana for dashboards
   - Set up alerting
