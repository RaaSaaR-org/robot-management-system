# RoboMindOS Helm Chart

This Helm chart deploys RoboMindOS, a distributed fleet management platform for humanoid robots with EU AI Act compliance features.

## Prerequisites

- Kubernetes 1.24+
- Helm 3.10+
- PV provisioner support in the underlying infrastructure

## Components

| Component | Description | Default |
|-----------|-------------|---------|
| **PostgreSQL** | Primary database | Enabled |
| **NATS** | JetStream message queue | Enabled |
| **RustFS** | S3-compatible object storage | Enabled |
| **MLflow** | Model registry and tracking | Enabled |
| **Server** | Node.js API server | Enabled |
| **App** | React frontend | Enabled |
| **Robot Agent** | Simulated robot agent | Enabled |
| **VLA Inference** | Vision-Language-Action model inference | Disabled |

## Quick Start

### Development

```bash
# Install with default values
helm install robomind ./helm/robomind

# Install in a specific namespace
helm install robomind ./helm/robomind -n robomind --create-namespace
```

### Production

```bash
# Install with production values
helm install robomind ./helm/robomind \
  -f ./helm/robomind/values-production.yaml \
  --set secrets.jwtSecret="your-secure-jwt-secret" \
  --set postgres.auth.password="your-db-password" \
  --set rustfs.auth.accessKey="your-access-key" \
  --set rustfs.auth.secretKey="your-secret-key" \
  -n robomind --create-namespace
```

## Configuration

### Global Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.imagePullSecrets` | Image pull secrets | `[]` |
| `global.storageClass` | Storage class for PVCs | `""` |

### Production Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `production.requireSecrets` | Fail if default secrets are used | `false` |
| `production.rbac.enabled` | Create RBAC resources | `true` |

### Secrets

| Parameter | Description | Default |
|-----------|-------------|---------|
| `secrets.jwtSecret` | JWT secret for authentication | `dev-secret-...` |
| `secrets.googleApiKey` | Google API key (optional) | `""` |
| `secrets.geminiApiKey` | Gemini API key (optional) | `""` |

### PostgreSQL

| Parameter | Description | Default |
|-----------|-------------|---------|
| `postgres.enabled` | Deploy PostgreSQL | `true` |
| `postgres.external.enabled` | Use external PostgreSQL | `false` |
| `postgres.external.host` | External PostgreSQL host | `""` |
| `postgres.auth.password` | Database password | `robomind-dev` |
| `postgres.storage.size` | PVC size | `10Gi` |

### NATS

| Parameter | Description | Default |
|-----------|-------------|---------|
| `nats.enabled` | Deploy NATS | `true` |
| `nats.external.enabled` | Use external NATS | `false` |
| `nats.external.servers` | External NATS servers | `""` |
| `nats.storage.size` | PVC size | `10Gi` |

### RustFS (S3-compatible storage)

| Parameter | Description | Default |
|-----------|-------------|---------|
| `rustfs.enabled` | Deploy RustFS | `true` |
| `rustfs.external.enabled` | Use external S3 | `false` |
| `rustfs.external.endpoint` | External S3 endpoint | `""` |
| `rustfs.auth.accessKey` | S3 access key | `rustfsadmin` |
| `rustfs.auth.secretKey` | S3 secret key | `rustfsadmin` |
| `rustfs.storage.size` | PVC size | `50Gi` |
| `rustfs.buckets` | Buckets to create | See values.yaml |

### MLflow

| Parameter | Description | Default |
|-----------|-------------|---------|
| `mlflow.enabled` | Deploy MLflow | `true` |
| `mlflow.external.enabled` | Use external MLflow | `false` |
| `mlflow.external.trackingUri` | External MLflow URI | `""` |

### Server

| Parameter | Description | Default |
|-----------|-------------|---------|
| `server.enabled` | Deploy server | `true` |
| `server.replicaCount` | Number of replicas | `1` |
| `server.env.authDisabled` | Disable authentication | `"true"` |

### App (Frontend)

| Parameter | Description | Default |
|-----------|-------------|---------|
| `app.enabled` | Deploy frontend | `true` |
| `app.replicaCount` | Number of replicas | `1` |
| `app.ingress.enabled` | Enable ingress | `false` |

### Robot Agent

| Parameter | Description | Default |
|-----------|-------------|---------|
| `robotAgent.enabled` | Deploy robot agent | `true` |
| `robotAgent.env.robotId` | Robot identifier | `sim-robot-001` |
| `robotAgent.env.robotName` | Robot display name | `SimBot-01` |

### VLA Inference

| Parameter | Description | Default |
|-----------|-------------|---------|
| `vlaInference.enabled` | Deploy VLA inference | `false` |
| `vlaInference.config.device` | Compute device | `cpu` |
| `vlaInference.config.modelType` | Model type | `pi0` |

## External Services

You can use external managed services instead of deploying them:

### External PostgreSQL (RDS, Cloud SQL)

```yaml
postgres:
  enabled: true
  external:
    enabled: true
    host: "my-rds-instance.xxx.rds.amazonaws.com"
    port: 5432
    database: "robomind"
    username: "robomind"
  auth:
    password: "your-password"
```

### External NATS (Synadia NGS)

```yaml
nats:
  enabled: false
  external:
    enabled: true
    servers: "nats://connect.ngs.global:4222"
```

### External S3 (AWS S3)

```yaml
rustfs:
  enabled: false
  external:
    enabled: true
    endpoint: "https://s3.amazonaws.com"
    region: "us-east-1"
  auth:
    accessKey: "AKIAIOSFODNN7EXAMPLE"
    secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
```

### External MLflow (Databricks)

```yaml
mlflow:
  enabled: false
  external:
    enabled: true
    trackingUri: "databricks://my-workspace"
```

## Upgrading

```bash
# Upgrade to a new version
helm upgrade robomind ./helm/robomind \
  -f ./helm/robomind/values-production.yaml \
  --set secrets.jwtSecret="your-secret"
```

## Uninstalling

```bash
# Uninstall the release
helm uninstall robomind -n robomind

# Delete PVCs (WARNING: This deletes all data!)
kubectl delete pvc -n robomind -l app.kubernetes.io/instance=robomind
```

## Troubleshooting

### Check pod status

```bash
kubectl get pods -n robomind -l app.kubernetes.io/instance=robomind
```

### View logs

```bash
# Server logs
kubectl logs -n robomind -l app.kubernetes.io/component=server

# All component logs
kubectl logs -n robomind -l app.kubernetes.io/instance=robomind --all-containers
```

### Verify connectivity

```bash
# Test NATS health
kubectl exec -n robomind deploy/robomind-server -- \
  wget -qO- http://robomind-nats:8222/healthz

# Test database connection
kubectl exec -n robomind deploy/robomind-server -- \
  pg_isready -h robomind-postgres -U robomind
```

## License

Copyright (c) RoboMind Team. All rights reserved.
