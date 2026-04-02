---
id: TASK-122
title: "Add build info to server health endpoint"
status: todo
priority: 4
tags: [core]
created: 2026-04-02
---

## Description

Add a `version` and `startedAt` field to the server's `/health` endpoint response. This helps verify which version is deployed after a deploy.

## Details

### Server

**File:** `server/src/index.ts` (or wherever the `/health` route is defined)

Currently returns:
```json
{"status": "ok", "timestamp": "..."}
```

Add two fields:
```json
{
  "status": "ok",
  "timestamp": "...",
  "version": "0.1.0",
  "startedAt": "2026-04-02T12:00:00Z"
}
```

- `version`: read from `server/package.json` version field
- `startedAt`: capture `new Date().toISOString()` once at server startup, return it in every health response

## Test Strategy

```bash
curl http://localhost:3001/health
# Should include "version" and "startedAt" fields
```
