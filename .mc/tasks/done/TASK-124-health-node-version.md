---
id: TASK-124
title: Add nodeVersion to server health endpoint
status: done
priority: 4
tags:
- core
created: 2026-04-02
updated: 2026-04-02
---




## Description

Add a `nodeVersion` field to the server's `/health` endpoint response showing the Node.js runtime version.

## Details

### Server

**File:** `server/src/app.ts` — the `/health` route handler.

Add one field to the health response:

```typescript
nodeVersion: process.version
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "...",
  "version": "0.1.0",
  "startedAt": "...",
  "uptimeSeconds": 123,
  "nodeVersion": "v22.17.1"
}
```

This is a one-line change.

## Test Strategy

```bash
curl http://localhost:3001/health
# Should include "nodeVersion" field
```
