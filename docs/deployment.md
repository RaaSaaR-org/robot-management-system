# RoboMindOS Deployment Guide

This guide covers deploying RoboMindOS to Docker and Kubernetes environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Docker Compose (Local Development)](#docker-compose-local-development)
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
helm install robomind helm/robomind \
  -f helm/robomind/values-local.yaml \
  --set postgres.auth.password=mypassword \
  --set secrets.jwtSecret=my-jwt-secret

# Check pods
kubectl get pods -n robomind
```

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

# Optional - Customization
AUTH_DISABLED=false
ROBOT_ID=sim-robot-001
ROBOT_NAME=SimBot-01
```

### 2. Start Services

```bash
# Build and start all services
docker-compose up -d --build

# Or start specific services
docker-compose up -d postgres server
docker-compose up -d app
docker-compose up -d robot-agent
```

### 3. Verify Deployment

```bash
# Check all services are running
docker-compose ps

# Check health endpoints
curl http://localhost:3001/health   # Server
curl http://localhost/              # App
curl http://localhost:41243/health  # Robot Agent

# View logs
docker-compose logs -f server
```

### 4. Access the Application

| Service | URL |
|---------|-----|
| App (Frontend) | http://localhost |
| Server (API) | http://localhost:3001 |
| Robot Agent | http://localhost:41243 |
| PostgreSQL | localhost:5432 |

### 5. Stop Services

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
docker tag robomind/server:latest your-registry/robomind/server:v1.0.0
docker tag robomind/app:latest your-registry/robomind/app:v1.0.0
docker tag robomind/robot-agent:latest your-registry/robomind/robot-agent:v1.0.0

# Push to registry
docker push your-registry/robomind/server:v1.0.0
docker push your-registry/robomind/app:v1.0.0
docker push your-registry/robomind/robot-agent:v1.0.0
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
kind load docker-image robomind/server:latest
kind load docker-image robomind/app:latest
kind load docker-image robomind/robot-agent:latest
```

#### 3. Install with Helm

```bash
helm install robomind helm/robomind \
  -f helm/robomind/values-local.yaml \
  --set postgres.auth.password=localpassword \
  --set secrets.jwtSecret=local-dev-secret-32-chars-min
```

#### 4. Setup Local DNS

Add to `/etc/hosts`:
```
127.0.0.1 robomind.local
```

For minikube, use minikube IP:
```bash
echo "$(minikube ip) robomind.local" | sudo tee -a /etc/hosts
```

#### 5. Access the Application

```bash
# With ingress
open http://robomind.local

# Or via port-forward
kubectl port-forward -n robomind svc/robomind-app 8080:80
open http://localhost:8080
```

### Production (Self-hosted Cluster)

#### 1. Update Values

Edit `helm/robomind/values-production.yaml`:

```yaml
ingress:
  host: robomind.yourdomain.com  # Your actual domain
  tls: true
  tlsSecretName: robomind-tls

server:
  image:
    repository: your-registry/robomind/server
    tag: v1.0.0

app:
  image:
    repository: your-registry/robomind/app
    tag: v1.0.0
```

#### 2. Create Namespace

```bash
kubectl create namespace robomind
```

#### 3. Setup Image Pull Secrets (if using private registry)

```bash
kubectl create secret docker-registry regcred \
  --namespace robomind \
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
helm install robomind helm/robomind \
  -f helm/robomind/values-production.yaml \
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
kubectl get pods -n robomind

# Check services
kubectl get svc -n robomind

# Check ingress
kubectl get ingress -n robomind

# Check logs
kubectl logs -f deployment/robomind-server -n robomind
```

---

## Configuration Reference

### Helm Values

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.namespace` | Kubernetes namespace | `robomind` |
| `global.imageRegistry` | Image registry prefix | `""` |
| `postgres.enabled` | Deploy PostgreSQL | `true` |
| `postgres.storage` | PVC storage size | `10Gi` |
| `postgres.auth.password` | Database password | `""` (required) |
| `server.replicaCount` | Server replicas | `2` |
| `server.env.AUTH_DISABLED` | Disable auth | `"false"` |
| `app.replicaCount` | App replicas | `2` |
| `robotAgent.enabled` | Deploy robot agent | `true` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.host` | Ingress hostname | `robomind.local` |
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
kubectl describe pod <pod-name> -n robomind

# Check events
kubectl get events -n robomind --sort-by='.lastTimestamp'
```

#### Database connection errors

```bash
# Check PostgreSQL is running
kubectl get pods -n robomind | grep postgres

# Check PostgreSQL logs
kubectl logs deployment/robomind-postgres -n robomind

# Verify secret exists
kubectl get secret robomind-secrets -n robomind -o yaml
```

#### Ingress not working

```bash
# Check ingress controller
kubectl get pods -n ingress-nginx

# Check ingress resource
kubectl describe ingress robomind-ingress -n robomind

# Check if services are accessible
kubectl port-forward -n robomind svc/robomind-app 8080:80
```

#### Image pull errors

```bash
# Check image pull secrets
kubectl get secret -n robomind

# Verify image exists
docker pull your-registry/robomind/server:v1.0.0
```

### Useful Commands

```bash
# View all resources
kubectl get all -n robomind

# Watch pod status
kubectl get pods -n robomind -w

# Execute into pod
kubectl exec -it deployment/robomind-server -n robomind -- sh

# Port forward for debugging
kubectl port-forward -n robomind svc/robomind-server 3001:3001

# View Helm release
helm list
helm status robomind

# Upgrade deployment
helm upgrade robomind helm/robomind -f helm/robomind/values-production.yaml

# Rollback
helm rollback robomind 1

# Uninstall
helm uninstall robomind
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Ingress                               │
│                    (nginx-ingress)                           │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
┌───────────────┐           ┌───────────────┐
│     App       │           │    Server     │
│   (nginx)     │           │  (Node.js)    │
│   Port: 80    │           │  Port: 3001   │
└───────────────┘           └───────┬───────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
            ┌───────────┐   ┌───────────┐   ┌───────────────┐
            │ PostgreSQL│   │   Redis   │   │  Robot Agent  │
            │ Port: 5432│   │  (future) │   │  Port: 41243  │
            └───────────┘   └───────────┘   └───────────────┘
```

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
