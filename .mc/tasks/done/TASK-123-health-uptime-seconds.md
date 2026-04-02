---
id: TASK-123
title: "Add uptimeSeconds to server health endpoint"
status: done
priority: 4
tags: [core]
created: 2026-04-02
---

## Description

Add an `uptimeSeconds` field to the server's `/health` endpoint. This shows how long the server has been running, useful for monitoring restarts.

## Details

### Server

**File:** `server/src/app.ts` — the `/health` route handler.

The endpoint already returns `startedAt`. Use that to compute uptime:

```typescript
uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1000)
```

Where `startedAtMs` is `Date.now()` captured at startup (same time as `startedAt`).

Expected response:
```json
{
  "status": "ok",
  "timestamp": "...",
  "version": "0.1.0",
  "startedAt": "...",
  "uptimeSeconds": 3600
}
```

## Test Strategy

```bash
curl http://localhost:3001/health
# Should include "uptimeSeconds" as a number
```
