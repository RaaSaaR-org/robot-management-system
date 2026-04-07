---
id: TASK-145
aliases:
- TASK-145
title: 'Replace fake GPU availability panel with real training worker status'
slug: replace-fake-gpu-panel-with-real-worker-status
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

The GPU Availability panel on `/training` displays fake data — hardcoded env vars pretending to be a multi-GPU cluster. Replace it with real training worker status based on actual heartbeat data that the worker already sends.

## Problem

The GPU panel reads 3 env vars and does simple subtraction:
```
GPU_TOTAL_COUNT=1       (default, never changed)
GPU_TYPE=unknown        (default)
GPU_MEMORY_GB=0         (default)
available = total - runningJobCount
```

The UI shows fancy breakdowns (A100, H100, A10G, T4 types, memory bars, utilization percentages) but it's all derived from these defaults. No nvidia-smi, no pynvml, no real GPU detection anywhere in the stack.

The training-worker already sends heartbeats with `gpuUtil` and `memoryUtil` fields, but always `0.0` — these are never collected or displayed.

### What the user actually needs to know
- Is a training worker connected and healthy?
- What device is it using (cuda/mps/cpu)?
- Is it currently running a job? Which one?
- How long has the current job been running?
- What's the actual GPU utilization (if on GPU)?

### What the panel currently shows (fake)
- "5 of 8 GPUs available" (hardcoded)
- GPU type distribution with memory specs (hardcoded)
- Utilization percentage bar (derived from job count / total)
- Estimated wait time (derived from queue depth)

## Options

### Option A: Replace with worker status panel
Show real data from the worker heartbeat system:
- Worker connection status (online/offline, last heartbeat timestamp)
- Current device (from worker config: cuda/mps/cpu)
- Current job (if running): job ID, progress, elapsed time
- Queue depth (real — count of pending jobs)
- Optionally: actual GPU util from worker heartbeat (requires worker to collect real stats)

### Option B: Remove the panel entirely
Just show queue stats (already displayed separately via `QueueStatsDisplay`). Training jobs list already shows running/pending status. The panel adds noise with fake data.

### Option C: Make GPU detection real
Add pynvml/nvidia-smi detection to the training-worker, send real GPU stats in heartbeats, surface them in the panel. Most work, only worth it if running on a real GPU box.

## Key Files

### Frontend (GPU panel — needs replacement or removal)
- `app/src/features/training/pages/TrainingPage.tsx:203-207` — renders `GpuAvailabilityPanel` in right column
- `app/src/features/training/components/GpuAvailabilityPanel.tsx` — the panel component
- `app/src/features/training/hooks/useGpuAvailability.ts` — hook, polls every 30s
- `app/src/features/training/store/trainingStore.ts:340-358` — store slice for GPU data
- `app/src/features/training/api/trainingApi.ts` — `getGpuAvailability()` API call
- `app/src/features/training/types/training.types.ts` — `GpuAvailability` type

### Server (fake GPU endpoint — needs rework)
- `server/src/routes/training.routes.ts:428-439` — `GET /api/training/gpu/availability`
- `server/src/services/TrainingOrchestrator.ts:233-262` — `getGpuAvailability()` reads env vars
- `server/src/types/training.types.ts:283-292` — `GpuAvailability` type definition
- `server/.env.example` — `GPU_TOTAL_COUNT`, `GPU_TYPE`, `GPU_MEMORY_GB` defaults

### Training worker (heartbeat already exists — needs real GPU stats)
- `training-worker/worker.py` — main worker loop, claims and runs jobs
- `training-worker/callbacks.py:75-80` — heartbeat sends `gpuUtil=0.0, memoryUtil=0.0`
- `training-worker/config.py:76` — `device` field (mps/cuda/cpu)

### Server heartbeat receiver (already stores worker status)
- `server/src/routes/training.routes.ts` — `POST /api/training/workers/heartbeat`
- `server/src/services/TrainingOrchestrator.ts` — processes heartbeat, has worker state

## Test Strategy

- After change: training page loads without errors, new panel shows real worker status
- With worker running: verify connection status, device, current job reflected in UI
- Without worker: verify panel shows "no worker connected" or similar
- Typecheck passes across app + server
