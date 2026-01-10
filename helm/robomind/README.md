# RoboMindOS Helm Chart

Helm chart for deploying RoboMindOS to Kubernetes.

## Quick Start

```bash
# Local development (minikube/kind)
helm install robomind . \
  -f values-local.yaml \
  --set postgres.auth.password=localpassword \
  --set secrets.jwtSecret=local-dev-secret

# Production
helm install robomind . \
  -f values-production.yaml \
  --set postgres.auth.password=$DB_PASSWORD \
  --set secrets.jwtSecret=$JWT_SECRET
```

## Components

| Component | Description | Default Replicas |
|-----------|-------------|------------------|
| PostgreSQL | Database | 1 |
| Server | Node.js API | 2 |
| App | React frontend (nginx) | 2 |
| Robot Agent | Simulated robot | 1 (optional) |

## Configuration

See `values.yaml` for all configuration options.

### Key Parameters

| Parameter | Description | Required |
|-----------|-------------|----------|
| `postgres.auth.password` | Database password | Yes |
| `secrets.jwtSecret` | JWT signing secret | Yes |
| `ingress.host` | Ingress hostname | No (default: robomind.local) |

## Files

- `values.yaml` - Default values
- `values-local.yaml` - Local development overrides
- `values-production.yaml` - Production overrides

## Useful Commands

```bash
# Check status
helm status robomind

# Upgrade
helm upgrade robomind . -f values-production.yaml

# Rollback
helm rollback robomind 1

# Uninstall
helm uninstall robomind
```

## Documentation

See [docs/deployment.md](../../docs/deployment.md) for full deployment guide.
