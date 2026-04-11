---
id: TASK-154
aliases:
- TASK-154
title: 'Helm chart validation + Kustomize overlays for production deployment'
slug: helm-kustomize-validation-remaining-deployment-artifacts
status: todo
priority: 3
owner: ''
projects: []
customers: []
sprint: ''
tags:
- core
- deferred
depends_on:
- TASK-153
due_date: ''
created: '2026-04-07'
---

## Description

TASK-139 (PR #112) delivered excellent documentation (deployment.md, operations.md, runbook.md), refreshed .env.examples, systemd templates, docker-compose, and a GitHub Actions smoke test. But the Helm chart was never validated against a real cluster and Kustomize overlays were not created.

## What Was Done in TASK-139

- ✅ `docs/deployment.md` — comprehensive rewrite (Helm, Postgres, TLS, Pi setup)
- ✅ `docs/operations.md` — day-to-day ops (robots, secrets, logs, monitoring, backups)
- ✅ `docs/runbook.md` — all 7 incident procedures + escalation matrix
- ✅ `.env.example` refreshed for server (23 vars) and robot-agent (16 vars)
- ✅ `docker-compose.yml` updated (8 services, health checks)
- ✅ `deploy/neodem-server.service.template` + `neodem-agent.service.template`
- ✅ `.github/workflows/smoke-test.yml` (Postgres + NATS + RustFS, dataset CRUD, daily cron)

## What Still Needs to Happen

### 1. Helm chart validation against real k8s

**Current state:** `helm/neodem/` has 27 templates, values.yaml, values-local.yaml, values-production.yaml — but it's never been tested against a real cluster. Template rendering might have issues that `helm template` wouldn't catch.

**What to do:**
- Run `helm template neodem helm/neodem/ -f helm/neodem/values-production.yaml` and review for obvious issues
- Deploy to k3d local cluster (`k3d-emai-swarm` context) and verify:
  - All pods reach Running state
  - Services are reachable
  - Secrets and ConfigMaps are created correctly
  - RBAC allows the service account to function
- Fix any template issues found
- Add `helm/neodem/templates/certificate.yaml` for cert-manager Certificate resource (currently only documented in deployment.md, not in the chart)

**Key files:**
- `helm/neodem/templates/` — 27 template files
- `helm/neodem/values.yaml`, `values-production.yaml`

### 2. Kustomize overlays

**Current state:** Not created. Task specified overlays for common deployment shapes.

**What to do:**
- Create `deploy/kustomize/base/` with the core resources (extracted from Helm or standalone)
- Create `deploy/kustomize/overlays/single-node/` — all components on one machine, SQLite, no HA
- Create `deploy/kustomize/overlays/ha/` — PostgreSQL, NATS cluster, multiple replicas, PDBs
- Document usage in `docs/deployment.md`

**Note:** This is lower priority if Helm is the primary deployment method. Could be deferred if Helm validation is the bottleneck.

### 3. Smoke test expansion (optional)

**Current state:** Smoke test only tests server + dataset CRUD. Robot-agent and VLA server are not started.

**What to do (nice-to-have):**
- Add robot-agent startup + health check to the workflow
- Add a basic A2A protocol exchange test (register robot → verify it appears)
- Keep VLA server out (requires GPU / large model downloads)

## Test Strategy

1. `helm template` renders without errors for all values files
2. `helm install` on k3d → all pods Running within 5 minutes
3. Kustomize overlays: `kubectl apply -k deploy/kustomize/overlays/single-node/` works
4. cert-manager Certificate resource issues a valid cert (if cert-manager is installed)
