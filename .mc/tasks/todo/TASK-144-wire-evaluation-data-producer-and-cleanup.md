---
id: TASK-144
aliases:
- TASK-144
title: 'Wire evaluation data producer + consolidate model comparison'
slug: wire-evaluation-data-producer-and-cleanup
status: todo
priority: 3
owner: ''
projects: []
customers: []
sprint: ''
tags:
- extended
depends_on: []
due_date: ''
created: '2026-04-06'
---

## Description

The Evaluation Dashboard (`/evaluation`) is well-built but shows no data because nothing writes evaluation episodes to the server. The sim evaluator script produces episode results but doesn't POST them. Wire the data producer so the dashboard becomes useful. Also consolidate model comparison into one place once TASK-142 removes the MLflow-backed `/models` page.

## Current State

### What works
- **Server**: POST `/api/evaluation/episodes` endpoint and `EvaluationService.recordEpisode()` are fully implemented
- **Database**: `EvaluationEpisode` Prisma model exists with indexes on robotId, modelVersion, createdAt, success
- **Frontend**: Full dashboard with success rate chart, error analysis, model comparison table, rollout timeline
- **Seed script**: `server/src/scripts/seed-evaluation.ts` can populate 25 demo episodes for testing

### What's missing
- **No data producer**: Nothing in the codebase POSTs to `/api/evaluation/episodes`
- `robot-agent/hardware/sim_evaluator/evaluate_vla.py` runs VLA evaluation episodes in MuJoCo and outputs JSON results — but does NOT send them to the server
- Robot agent doesn't report real-world episode outcomes to the evaluation API either

### Conceptual model (correct as-is)
- **Simulation** (`/simulation`) = pre-deployment gate → "does the model work in MuJoCo?" → used by pipeline step 4
- **Evaluation** (`/evaluation`) = post-deployment monitoring → "how is the model performing on real robots?"
- These are intentionally separate concerns. The pipeline uses `simulationApi` for its Evaluate stage because simulation is the checkpoint before deploy. Evaluation is production observability.

## Tasks

### 1. Wire sim evaluator → evaluation API
Make `evaluate_vla.py` POST episode results to `/api/evaluation/episodes` after each rollout completes. Each episode should include:
- `robotId` — the robot or sim instance ID
- `modelVersion` — e.g. "smolvla-v0.4.1"
- `taskPrompt` — the evaluation task description
- `startedAt`, `endedAt`, `durationMs` — timing
- `success` — boolean
- `errorType` — if failed (grasp_failure, collision_detected, timeout, etc.)
- `metadata` — any extra info (environment, backend, sim job ID)

Alternatively, the SimulationService could write evaluation episodes when a sim job completes, mapping SimulationJob results to EvaluationEpisode records.

### 2. Wire robot agent → evaluation API (future)
When a real robot executes a VLA inference task, the robot agent should POST the outcome to `/api/evaluation/episodes`. This is lower priority since real-hardware evaluation requires the full deploy pipeline to be working.

### 3. Consolidate model comparison (after TASK-142)
Once the MLflow `/models` page is removed (TASK-142), the only model comparison UI will be the one on `/evaluation`. This is fine — the evaluation comparison shows real-world performance metrics (success rate, episodes, duration, error breakdown), which is more useful than training metrics. No action needed unless TASK-142 decides to keep a model comparison elsewhere.

## Key Files

### Data producer (needs changes)
- `robot-agent/hardware/sim_evaluator/evaluate_vla.py` — sim evaluator script, outputs JSON episode results but doesn't POST to server
- `server/src/services/SimulationService.ts` — alternative: could write evaluation episodes when sim jobs complete

### Evaluation backend (already working)
- `server/src/routes/evaluation.routes.ts` — POST `/api/evaluation/episodes` + 5 GET endpoints
- `server/src/services/EvaluationService.ts` — recordEpisode(), getSuccessRate(), getErrorBreakdown(), compareModels()
- `server/prisma/schema.prisma` — EvaluationEpisode model

### Evaluation frontend (already working)
- `app/src/features/evaluation/pages/EvaluationDashboardPage.tsx` — dashboard with charts
- `app/src/features/evaluation/api/evaluationApi.ts` — API client
- `app/src/features/evaluation/components/SuccessRateChart.tsx` — success rate over time
- `app/src/features/evaluation/components/ErrorAnalysisPanel.tsx` — error type breakdown
- `app/src/features/evaluation/components/ModelComparisonTable.tsx` — model A vs B comparison
- `app/src/features/evaluation/components/RolloutTimeline.tsx` — recent episode timeline

### Seed data (for testing)
- `server/src/scripts/seed-evaluation.ts` — seeds 25 demo episodes, run with `npx tsx server/src/scripts/seed-evaluation.ts`

## Test Strategy

1. Run the seed script and verify the dashboard shows data (charts, error breakdown, comparison)
2. After wiring sim evaluator: run a simulation job, verify evaluation episodes appear in the dashboard
3. Verify model comparison works when episodes reference 2+ model versions
4. Verify period filter (24h, 7d, 30d) correctly filters episodes
