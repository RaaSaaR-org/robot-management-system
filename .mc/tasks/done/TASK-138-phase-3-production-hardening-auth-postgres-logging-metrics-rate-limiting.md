---
id: TASK-138
aliases:
- TASK-138
title: 'Phase 3: Production hardening (auth, postgres, logging, metrics, rate limiting)'
slug: phase-3-production-hardening-auth-postgres-logging-metrics-rate-limiting
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-05
updated: 2026-04-05
---

# Phase 3: Production hardening (auth, postgres, logging, metrics, rate limiting)

## Description

Convert the dev-mode server into something that can safely run in a real environment: enable JWT auth end-to-end, migrate from SQLite to PostgreSQL, adopt structured logging, add Prometheus metrics, add rate limiting, and authenticate the robot endpoint that receives model updates.

## Details

### Auth

- Currently `AUTH_DISABLED=true` everywhere. Flip to `false` and test all routes.
- Verify `/api/auth/login`, `/api/auth/refresh` flows work end-to-end
- Audit protected routes — any that are missing `authMiddleware`?
- Add `authMiddleware` to `/api/training/workers/*` callback endpoints (or use a worker-specific token)
- Document required env vars: `JWT_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`

### PostgreSQL migration

- Current Prisma schema uses `provider = "sqlite"` locally, `postgresql` in migration_lock.toml
- Set up a production Postgres container + run `prisma migrate deploy` against it
- Verify all 83 models work against Postgres (JSON array handling differs from SQLite)
- Update `docs/deployment.md` with Postgres setup
- Generate fresh migration from current schema state

### Structured logging

- Replace `console.log` calls with `pino` structured logger
- Add request-id middleware for correlation
- Log levels: debug (dev), info (prod), warn, error
- Redact JWT tokens, API keys, PII from logs

### Metrics

- Add `/metrics` endpoint with Prometheus format
- Metrics to expose: HTTP request duration histogram, DB query duration, NATS message rate, active training jobs, active sim jobs, deployment status counts
- Recommend Grafana dashboard spec in docs

### Rate limiting

- Add `express-rate-limit` to public endpoints
- Strict limits on `/api/auth/login`, `/api/auth/register` (5/min per IP)
- Looser on authenticated endpoints (100/min per user)
- Disable in dev via `RATE_LIMIT_DISABLED=true`

### Robot endpoint auth

- `POST /api/v1/robots/{id}/vla/model/switch` is currently unauthenticated
- Add HMAC signature verification OR mutual TLS
- Shared secret rotated per robot, stored in DB
- Deployment service signs request body with per-robot key

### Other

- CORS tightening — current config probably too permissive
- Content-Security-Policy headers
- Review `docs/regulatory-compliance.md` against EU AI Act deadline (Aug 2026)
- Audit .env.example files for secrets that shouldn't be committed

## Test Strategy

1. Login flow end-to-end with `AUTH_DISABLED=false`
2. Unauthenticated request to protected endpoint returns 401
3. PostgreSQL instance runs all migrations cleanly, app works identically to SQLite
4. Structured logs emit JSON with request_id, level, timestamp, message
5. `GET /metrics` returns valid Prometheus format
6. Rate limiter blocks 6th login attempt within a minute
7. Deployment to robot fails without correct HMAC signature
