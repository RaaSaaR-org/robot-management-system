---
id: TASK-139
aliases:
- TASK-139
title: 'Phase 4: Production deployment artifacts (Helm, docs, runbook)'
slug: phase-4-production-deployment-artifacts-helm-docs-runbook
status: done
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on:
- TASK-138
due_date: ''
created: 2026-04-05
updated: 2026-04-05
---

# Phase 4: Production deployment artifacts (Helm, docs, runbook)

## Description

Make NeoDEM easy to deploy to production by validating the existing Helm chart, documenting the full deployment procedure, and writing an operations runbook for common tasks + incident response.

## Details

### Helm chart validation

- `helm/neodem/` has 30 resource templates — exercise them against a real k8s cluster
- Verify each component (server, agent, app, vla-server, training-worker) deploys with correct service accounts, RBAC, secrets, configmaps
- Add ingress + cert-manager example for TLS
- Document how to override images, env vars, replica counts
- Smoke-test deployment to a test cluster

### Documentation updates

- `docs/deployment.md` — refresh with current architecture + Phase 3 hardening steps
- `docs/operations.md` — day-to-day tasks (adding robots, rotating secrets, scaling workers)
- New `docs/runbook.md` — incident response procedures:
  - Training worker crashed → how to diagnose, how to restart, how to requeue stuck jobs
  - Deployment regression → manual rollback steps
  - Database failover
  - NATS / RustFS outage handling
  - Security incident checklist

### Environment artifacts

- `.env.example` per component refreshed with all Phase 3 vars
- Docker Compose for local full-stack dev
- Systemd unit templates for non-k8s deploys
- Kustomize overlays for common deployment shapes (single-node, HA)

### Smoke-test automation

- GitHub Actions workflow that spins up a minimal stack (Postgres + NATS + RustFS + server + UI) and runs a basic E2E assertion ("can create a dataset, list it, delete it")
- Daily scheduled run

## Test Strategy

1. Fresh k8s cluster + `helm install` → all pods healthy
2. TLS ingress resolves, auth flow works
3. Runbook walks through each incident scenario with verified commands
4. GitHub Actions workflow green against a PR

## Completion Notes (PR #112)

**Delivered:** deployment.md rewrite, operations.md, runbook.md (7 incidents), .env.example refresh, docker-compose update, systemd templates, GitHub Actions smoke test.

**Not delivered — moved to TASK-154:** Helm chart validation against real k8s, Kustomize overlays, cert-manager Certificate resource in Helm templates.
