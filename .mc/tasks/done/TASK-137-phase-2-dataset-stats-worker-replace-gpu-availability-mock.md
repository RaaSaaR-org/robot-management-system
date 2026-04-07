---
id: TASK-137
aliases:
- TASK-137
title: 'Phase 2: Dataset stats worker + replace GPU availability mock'
slug: phase-2-dataset-stats-worker-replace-gpu-availability-mock
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on:
- TASK-136
due_date: ''
created: 2026-04-05
updated: 2026-04-06
---


# Phase 2: Dataset stats worker + replace GPU availability mock

## Description

Close the remaining pipeline stubs after Phase 1 lands. Two targeted fixes: (1) a tiny Python worker that computes per-feature normalization stats for uploaded datasets and writes them back to `meta/stats.json` on RustFS, and (2) replace the hardcoded 8×A100 GPU availability mock with an env-driven real count.

## Details

### Dataset stats worker

- Add to the `training-worker/` package or as a second Python process
- Consumes NATS subject `jobs.dataset.compute-stats`
- Reads Parquet from RustFS via presigned URL
- Computes per-feature mean/std (action, observation.state, observation.images.*) using numpy/datasets
- Writes `meta/stats.json` in LeRobot v3 format back to RustFS
- POSTs to server to mark dataset as stats-ready

**Current stub**: `DatasetService.computeStats()` throws "Stats computation worker not available" (`server/src/services/DatasetService.ts:699`). Server already queues the job — just need the consumer.

### GPU availability

Current: `TrainingOrchestrator.getGpuAvailability()` (`server/src/services/TrainingOrchestrator.ts:201`) returns hardcoded `{totalCount: 8, availableCount: 6}`.

Replace with env-driven config:
- `GPU_TOTAL_COUNT`, `GPU_TYPE`, `GPU_MEMORY_GB`
- Fall back to querying k8s API if running in a cluster (`KUBERNETES_SERVICE_HOST` detection)
- Compute `availableCount = total - runningJobCount` from DB

## Test Strategy

1. Upload dataset → server queues stats job → worker computes stats → `meta/stats.json` appears in RustFS
2. UI shows correct per-feature stats on the dataset detail page
3. `getGpuAvailability()` returns env-configured values, `availableCount` decrements while jobs run
