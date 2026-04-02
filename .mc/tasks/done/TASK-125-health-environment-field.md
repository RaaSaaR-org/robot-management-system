---
id: TASK-125
title: Add environment field to server health endpoint
status: done
priority: 4
tags:
- core
created: 2026-04-02
updated: 2026-04-02
---




## Description

Add an `environment` field to the server's `/health` endpoint that shows the current `NODE_ENV` value. This helps quickly identify whether you're hitting a dev, staging, or production instance.

## Details

### Server

**File:** `server/src/app.ts` — the `/health` route handler.

Add one field:

```typescript
environment: process.env.NODE_ENV || 'development'
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "...",
  "version": "0.1.0",
  "startedAt": "...",
  "uptimeSeconds": 123,
  "nodeVersion": "v22.17.1",
  "environment": "development"
}
```

This is a one-line change.

## Test Strategy

```bash
curl http://localhost:3001/health
# Should include "environment" field with value "development"
```
