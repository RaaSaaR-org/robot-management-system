---
id: TASK-153
aliases:
- TASK-153
title: 'Production auth hardening: Postgres migration, robot endpoint security, auth testing'
slug: production-auth-hardening-postgres-robot-endpoint-security
status: todo
priority: 2
owner: ''
projects: []
customers: []
sprint: ''
tags:
- core
- deferred
depends_on: []
due_date: ''
created: '2026-04-07'
---

## Description

TASK-138 (PR #111) delivered rate limiting, structured logging, metrics, CSP headers, and CORS tightening — but left three critical production-hardening items unfinished. This task picks up the remainder.

## What Was Done in TASK-138

- ✅ Rate limiting (`express-rate-limit`, 5/min auth, 100/min general, `RATE_LIMIT_DISABLED`)
- ✅ Structured logging (`pino`, request-id middleware, secret redaction)
- ✅ Prometheus metrics (`/metrics` endpoint, HTTP duration histogram, gauges)
- ✅ Security headers (helmet, CSP directives, CORS env-based origins)
- ✅ Worker auth middleware (`workerAuth.middleware.ts`)

## What Still Needs to Happen

### 1. PostgreSQL migration path

**Current state:** Prisma schema says `postgresql` in `migration_lock.toml` but `.env.example` defaults to `file:./dev.db` (SQLite). The 4 existing migrations are from Jan-Feb, none from TASK-138.

**What to do:**
- Generate a fresh Prisma migration from current schema state against a real Postgres instance
- Verify all 83 models work against Postgres (JSON array handling differs from SQLite)
- Update `server/.env.example` to show the Postgres connection string as the primary example (keep SQLite as a comment for local dev)
- Test: `docker compose up postgres` → `npx prisma migrate deploy` → app works identically

**Key files:**
- `server/prisma/schema.prisma` — provider config
- `server/.env.example` — DATABASE_URL
- `server/prisma/migrations/` — existing migrations

### 2. Robot model switch endpoint authentication

**Current state:** `POST /api/v1/robots/{id}/vla/model/switch` in `server/src/services/DeploymentService.ts` calls the robot agent with a plain HTTP POST. No signature, no mTLS. Anyone on the network can tell a robot to load arbitrary model weights.

**What to do:**
- Add HMAC-SHA256 request signing in `DeploymentService.deployToRobot()`
- Sign the request body + timestamp with a per-robot shared secret stored in the robot's DB record
- On the robot agent side (`robot-agent/src/api/rest-routes.ts:608`), validate the HMAC signature before accepting the model switch
- Add `hmacSecret` field to the Robot model in Prisma (auto-generated on robot registration)
- Reject requests with timestamps older than 5 minutes (replay protection)

**Key files:**
- `server/src/services/DeploymentService.ts` — `deployToRobot()` method
- `robot-agent/src/api/rest-routes.ts:608` — model switch endpoint handler
- `server/prisma/schema.prisma` — Robot model (add `hmacSecret`)

### 3. Auth-enabled testing

**Current state:** `AUTH_DISABLED=true` is the only tested configuration. The authMiddleware is wired to routes but nobody has verified the full flow with auth enabled.

**What to do:**
- Create an integration test script that starts the server with `AUTH_DISABLED=false`
- Test: register → login → get access token → call protected endpoint → success
- Test: call protected endpoint without token → 401
- Test: expired token → 401, refresh token → new access token
- Audit all routes in `server/src/app.ts` for any that are missing `authMiddleware` but shouldn't be public

### 4. Fix pino-pretty missing dependency

**Current state:** `server/src/utils/logger.ts` imports `pino-pretty` transport for dev mode, but it's not in `package.json`. Dev mode logging will crash.

**What to do:**
- `cd server && npm install -D pino-pretty`

**Key file:** `server/package.json`

## Test Strategy

1. `docker compose up postgres` → `npx prisma migrate deploy` → server starts, CRUD works
2. Deploy model to robot without HMAC → rejected with 401
3. Deploy model with correct HMAC → accepted
4. Deploy with stale timestamp (>5min) → rejected
5. Start server with `AUTH_DISABLED=false` → login flow works end-to-end
6. `npm run dev` in server/ → pino-pretty prints colorized logs without errors
