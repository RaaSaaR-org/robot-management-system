---
id: TASK-132
aliases:
- TASK-132
title: Persist simulation jobs to database
slug: persist-simulation-jobs-to-database
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



# Persist simulation jobs to database

## Description

Simulation jobs currently live only in an in-memory `Map` on `SimulationService` and are lost on every server restart. Frames are written to `/tmp/sim_frames_<jobId>/` which is also wiped on reboot. Persist jobs + metrics + frame metadata to the Prisma database, and move frames to a stable on-disk location, so eval history survives restarts.

## Details

### Current state

- `server/src/services/SimulationService.ts:126` — `private jobs: Map<string, SimJob> = new Map()`
- `server/src/services/SimulationService.ts:118` — frames dir hard-coded to `/tmp/sim_frames_<jobId>`
- `server/src/services/SimulationService.ts:393` — results JSON at `/tmp/sim_results_<jobId>.json`
- `server/prisma/schema.prisma` — no `SimulationJob` model exists (only `SimToRealValidation` for the comparison tab)
- `app/src/features/simulation/pages/SimulationPage.tsx:762` — frontend holds `jobs` in `useState` and replaces the whole list every 3s via `fetchJobs`

### Server

**Prisma schema** (`server/prisma/schema.prisma`): add two models

```prisma
model SimulationJob {
  id              String   @id @default(uuid())
  modelId         String
  environment     String
  backend         String   // "mujoco" | "isaac"
  rolloutCount    Int
  status          String   // "queued" | "running" | "completed" | "failed"
  progress        Int      @default(0)
  successRate     Float?
  avgSteps        Float?
  collisionCount  Int?
  avgDuration     Float?
  simToRealGap    Float?
  totalEpisodes   Int?
  successfulEpisodes Int?
  framesDir       String?
  failureReason   String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  frames          SimulationFrame[]
  @@index([modelId, status])
  @@index([createdAt])
}

model SimulationFrame {
  id       String @id @default(uuid())
  jobId    String
  episode  Int
  step     Int
  filename String
  job      SimulationJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
  @@index([jobId, episode, step])
}
```

Run `npx prisma db push` (dev) and `npx prisma migrate dev --name add-simulation-jobs` (for migration).

**Add repository** `server/src/repositories/SimulationJobRepository.ts` with: `create`, `update`, `list`, `findById`, `markFailedOnBoot`, `createFrames`.

**Refactor** `server/src/services/SimulationService.ts`:
- Keep the in-memory `Map` as a hot cache for live progress updates (every tick on a running job would be a DB write otherwise).
- Write to DB on state transitions: `queued → running`, `running → completed`, `running → failed`, `cancelled`.
- On service construction (`SimulationService.getInstance()`), load all jobs from DB into the cache, and call `markFailedOnBoot()` to fail any jobs that were still `queued`/`running` (their subprocesses died with the old server process) — record `failureReason: "server restart"`.
- Change frames dir from `/tmp/sim_frames_${jobId}` to `<PROJECT_ROOT>/data/sim_runs/${jobId}/frames/` and results JSON to `<PROJECT_ROOT>/data/sim_runs/${jobId}/results.json`.
- Persist captured frames rows in `SimulationFrame` once the evaluator exits successfully.
- `listJobs` should prefer the cache but fall back to DB if cache miss (or just always read cache since boot-load populates it).

**Update route** `server/src/routes/simulation.routes.ts` to serve frames from the new path: `jobs/:id/frames/:filename` should resolve to `data/sim_runs/<id>/frames/<filename>`. Reject path traversal (`..`).

**Add `data/` to `.gitignore`** if not already present.

### Frontend

No schema changes required — the existing `SimJob` type already carries everything. Verify `app/src/features/simulation/pages/SimulationPage.tsx:788` initial fetch still works after server restart (should: jobs come from DB now).

Bonus: on initial mount, also fetch jobs when **not** on the Jobs tab so the user sees historical entries immediately on any tab switch (currently only starts polling when `activeTab === 'jobs'`).

### Key files

- `server/prisma/schema.prisma` (modify)
- `server/src/repositories/SimulationJobRepository.ts` (new)
- `server/src/services/SimulationService.ts` (modify)
- `server/src/routes/simulation.routes.ts` (modify — frames path)
- `app/src/features/simulation/pages/SimulationPage.tsx` (minor — fetch on mount regardless of tab)
- `.gitignore` (add `data/` if missing)

## Test Strategy

1. Submit a sim job via `POST /api/simulation/jobs`; wait for completion; verify row in `SimulationJob` table via `npx prisma studio`.
2. Restart `robomind-server`; hit `GET /api/simulation/jobs` — completed job must still appear with identical metrics.
3. Submit a job, kill the server mid-run with `sudo systemctl restart robomind-server`. After restart, the job must show `status: failed` with `failureReason: server restart`.
4. Verify frames render: `GET /api/simulation/jobs/:id/frames/ep1_step000.jpg` returns JPEG.
5. Reject path traversal: `GET /api/simulation/jobs/:id/frames/..%2Fetc%2Fpasswd` returns 400.
6. UI: open Simulation → Jobs tab after restart; all historical jobs visible, frames load in Results tab.
