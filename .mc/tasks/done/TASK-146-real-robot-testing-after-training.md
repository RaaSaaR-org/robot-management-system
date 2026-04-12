---
id: TASK-146
aliases:
- TASK-146
title: 'Wire real robot testing: model deploy + autonomous task execution from UI'
slug: real-robot-testing-after-training
status: done
priority: 2
owner: ''
projects: []
customers: []
sprint: ''
tags:
- core
depends_on: []
due_date: ''
created: 2026-04-06
updated: 2026-04-12
---




## Description

After training and simulating a VLA model, there's no way to test it on the real robot from the app. The model switch endpoint is simulated (sleeps instead of loading), there's no UI to trigger autonomous task execution, and no real-robot evaluation loop exists. This is the critical missing link in the pipeline: Train → Simulate → **Test on Real Robot**.

## Current State

### What exists but doesn't actually work

1. **Robot agent model switch endpoint** — `POST /robots/:id/vla/model/switch` exists but `VLAModelManager.switchModel()` is a simulation: it sleeps 300-500ms and tracks the version in memory. It does NOT:
   - Download model artifacts from RustFS
   - Tell vla-server to load the new LoRA adapter/weights
   - Verify the model loaded successfully

2. **Deployment page** (`/deployments`) — full canary rollout UI exists, calls the model switch endpoint, but since the switch is fake, nothing actually changes on the robot.

3. **VLA server** — `POST /predict` works for inference (images + state → actions), but nothing in the app triggers this for autonomous task execution.

4. **Data collection** — records teleoperation demos, but there's no "autonomous execution" mode where the robot acts on its own using VLA inference.

### What's actually running
- **vla-server** on Mac (localhost:8000) — SmolVLA inference server
- **robot-agent** on Pi (192.168.178.45:41243) — SO-101 robot control
- **server** on Mac (localhost:3001) — NeoDEM backend
- The robot can be teleoperated and data collected, but can't run autonomously from trained models

## What Needs to Happen

### 1. Real model switch: robot-agent → vla-server
`VLAModelManager.switchModel()` must actually:
- Download the trained LoRA adapter from RustFS (artifactUri)
- Call vla-server to load the new model/adapter (vla-server needs a "load model" or "switch adapter" endpoint)
- Wait for confirmation that the model is loaded
- Report success/failure back to the deployment service

**Key question:** vla-server currently has `/predict`, `/health`, `/config`, `/reset` — it needs a new endpoint like `POST /load-adapter` that accepts an adapter path/URI and hot-loads it.

### 2. Autonomous task execution UI
After deploying a model, the user needs a way to say "run this task on the real robot." This could be:
- A "Run Task" button on the robot detail page that sends a task prompt to the robot agent
- The robot agent uses VLA inference (vla-server `/predict`) in a closed loop: observe → predict → execute → repeat
- Live camera feed / telemetry showing the robot acting autonomously
- Stop button for safety

### 3. Real-robot evaluation loop
Like `evaluate_vla.py` does for MuJoCo, but against real hardware:
- Execute N episodes of a task on the real robot
- Record success/failure, duration, error type per episode
- POST results to `/api/evaluation/episodes` (wires into TASK-144)
- Could be triggered from the simulation page or a new "Hardware Test" section

## Key Files

### Robot agent — model switch (needs real implementation)
- `robot-agent/src/vla/vla-model-manager.ts` — `switchModel()` at line 121, `simulateModelSwitch()` at line 234 (must be replaced with real logic)
- `robot-agent/src/api/rest-routes.ts:608` — `POST /robots/:id/vla/model/switch` endpoint

### VLA server — needs adapter loading endpoint
- `vla-server/server.py` — current endpoints: `/predict`, `/health`, `/config`, `/reset`
- `vla-server/models/` — model backends (SmolVLA, pi0.5, GR00T)
- Needs: `POST /load-adapter` or similar to hot-swap LoRA weights

### Server — deployment service (calls robot model switch)
- `server/src/services/DeploymentService.ts` — `deployToRobot()` calls robot agent's model switch endpoint
- `server/src/routes/deployment.routes.ts` — deployment API routes

### Simulation evaluator (reference for real-robot version)
- `robot-agent/hardware/sim_evaluator/evaluate_vla.py` — closed-loop sim evaluation, same pattern needed for real hardware

### Frontend — needs autonomous execution UI
- `app/src/features/robots/` — robot detail page, could add "Run Task" section
- `app/src/features/deployment/pages/DeploymentsPage.tsx` — after deployment, could link to testing
- `app/src/features/datacollection/` — has robot camera/telemetry patterns that could be reused

## Dependencies
- TASK-144 (wire evaluation data producer) — real-robot test results should feed into the evaluation dashboard
- TASK-142 (models page) — deployed model tracking

## Test Strategy

1. Deploy a trained adapter to the robot via `/deployments` UI
2. Verify vla-server loads the adapter (health check shows new model version)
3. Trigger autonomous task execution from UI
4. Robot executes task using VLA inference loop
5. Results appear on `/evaluation` dashboard
