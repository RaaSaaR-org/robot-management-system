---
id: TASK-169
aliases:
- TASK-169
title: Lab bring-up — NeoDEM on a computer connected to a real Unitree G1 EDU
slug: lab-bringup-unitree-g1-edu-hardware
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- robot-agent
- hardware
- g1
- safety
sprint: ''
depends_on: []
due_date: ''
created: 2026-06-21
updated: 2026-06-21
---

# Lab bring-up — NeoDEM on a computer connected to a real Unitree G1 EDU

## Description

Staged, safety-first checklist for running NeoDEM on a lab computer wired to a
physical Unitree G1 EDU (Dex3-1, 43 DOF). Today the G1 path is **scaffolding,
not validated** — `robot-agent/hardware/g1_sidecar.py` is marked
`⚠️ HARDWARE-PENDING / UNTESTED`. Do NOT jump to autonomous/VLA control. Work
the stages in order; each gate must pass before the next.

## Current state (2026-06-21)

- `g1_edu` exists in **procedural telemetry / 3D viz only** (`telemetry.ts`,
  `g1-edu.config.ts`, `g1_edu.yaml`); not in real control or the sim-eval pipeline.
- `g1_sidecar.py` is written to spec against lerobot's `unitree_g1` robot/teleop
  + Unitree SDK2 (DDS), but **never run on hardware**. It imports
  `lerobot.robots.unitree_g1` (not installed by default).
- `send_action()` forwards **raw joint positions** with no ramping. The G1 is a
  **bipedal humanoid that must balance** — raw position commands without a
  balance controller will make it fall.
- Safety layer (`src/safety/SafetyMonitor.ts`) defaults are arm-shaped
  (ISO/TS 15066 force limits, mm/s speeds), not validated for a humanoid.
- No trained G1 VLA policy — `vla-server` only ran in `--stub` (sine waves).

## Stages (each is a gate)

### Stage 0 — Install & network
- [ ] Install NeoDEM (server + app + robot-agent) on the lab box. Sim-only smoke
      test first: `cd robot-agent && npm run dev:g1-edu`, confirm telemetry/3D viz.
- [ ] Install Unitree SDK2 + lerobot with the `unitree_g1` robot/teleop classes.
      Confirm `python -c "import lerobot.robots.unitree_g1"` succeeds.
- [ ] Wire G1 DDS network: set `G1_ROBOT_IP`, `G1_NET_INTERFACE` (default
      192.168.123.164 / eth0), confirm `ping` + DDS discovery.

### Stage 1 — Read-only (NO motion)
- [ ] Start `g1_sidecar.py` (port 8767). `GET /health` → `connected: true`.
- [ ] `GET /state` returns real joint positions. **Verify every joint name
      matches `g1_edu.yaml` / `g1-edu.config.ts`** (43 DOF) — fix mismatches.
- [ ] Confirm live joint values render in the app's 3D robot viewer.
- [ ] E-stop reachable and tested (physical + Unitree remote) before any motion.

### Stage 2 — Teleop data collection (safest first motion)
- [ ] Use Unitree's **native** teleop (remote / exoskeleton) via lerobot-record
      (`/record/start`) — Unitree handles balance; we only record.
- [ ] Collect a small LeRobot v2.1 dataset; verify it imports + plays back in the
      Datasets / Episode viewer, and curation (trim/delete) works on it.

### Stage 3 — Sim & policy (off the robot)
- [ ] Wire G1 into the MuJoCo sim-eval pipeline (vendor `g1_with_hands.xml` +
      meshes into `robot-agent/hardware/sim_evaluator/mjcf/g1/`, add a G1 env,
      `--embodiment` flag, register in `SimulationService.ts`).
- [ ] Train a policy on the Stage-2 data; evaluate in sim. Define a success bar.

### Stage 4 — Closed-loop AI on hardware (highest risk)
- [ ] Only after Stage 3 passes. Robot on a **gantry/harness**, hardware e-stop,
      tuned safety limits for the humanoid.
- [ ] Add action ramping / rate-limiting to `send_action()` (no raw position jumps).
- [ ] Start with tiny action scale; supervise continuously.

## Test strategy

- Each stage has an explicit gate above; do not advance until met.
- Keep the robot on a harness for any stage that produces motion under NeoDEM
  control (Stage 4). Stage 2 motion is driven by Unitree's balanced teleop.

## Key files

- `robot-agent/hardware/g1_sidecar.py` — hardware bridge (DDS)
- `robot-agent/hardware/recorder.py` — lerobot-record (robot/teleop CLI)
- `robot-agent/src/embodiment/configs/g1_edu.yaml`, `src/robot/joint-configs/g1-edu.config.ts`
- `robot-agent/src/safety/SafetyMonitor.ts`
- `robot-agent/hardware/sim_evaluator/` — MuJoCo eval (SO-101 today)
