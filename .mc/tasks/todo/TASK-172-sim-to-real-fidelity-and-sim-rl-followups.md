---
id: TASK-172
aliases:
- TASK-172
title: Real-to-Sim follow-ups — full-circle hardware run, GLB→OBJ + G1 meshes, Phase 4 sim-RL
slug: sim-to-real-fidelity-and-sim-rl-followups
status: todo
priority: 3
owner: ''
projects: []
customers: []
tags:
- extended
- server
- robot-agent
- digital-twin
- simulation
sprint: ''
depends_on:
- "[[TASK-171]]"
due_date: ''
created: 2026-06-25
updated: 2026-06-25
---

# Real-to-Sim follow-ups

## Description

TASK-171 closed the real→sim→real loop (twin→MJCF converter, SimScene registry,
sim→real validation gate) **plus** the occupancy floor-plan fidelity win. This
task collects everything intentionally deferred from it: the full-circle
hardware run, higher-fidelity room/robot geometry, and Phase 4 sim-RL training.

## Details

### A. Prove the full circle on hardware (runtime, not code)

Code is in place but the loop has only been exercised up to the policy boundary
in dev. To prove the **full circle**:

- [ ] Apply the schema wherever deployed: `cd server && npm run db:push` (or a
      real migration) — `SimScene` + `DigitalTwin.simSceneKey/simSceneBackend` +
      `SimToRealValidation` columns. *(Done in local dev 2026-06-25.)*
- [ ] Start the **VLA server on :8000** (`../vla-server`). Without it every
      rollout dies at `connect_backend` (`Cannot reach VLA server`).
- [ ] Ensure the `sim_evaluator` uv env is present on the host that runs jobs.
- [ ] **Sim rollout** to completion against a twin scene → head-camera frames
      captured + played back in the Results tab.
- [ ] **Real eval** — run the same policy on the real G1 in the same room;
      record `EvaluationEpisode`s so `realSuccessRate` is *derived*.
- [ ] **Gap** — `POST /validations` (no `realSuccessRate`) → confirm persisted
      `domainGapScore` = measured `sim − real`; "Sim vs Real" shows it.
- [ ] **Gate** — `REQUIRE_SIM_VALIDATION=true` (+ `SIM_REAL_GAP_THRESHOLD`):
      deployment blocked when the gap is too large, permitted/overridden when
      fine.

### B. Geometry fidelity

- [ ] **GLB→OBJ in the pipeline** so the room uses true scanned **mesh**
      collision geometry. MuJoCo can't load the twin's `mesh.glb`; convert to
      OBJ/STL first (e.g. `trimesh`), then feed it via `--mesh` to the
      `scene_builder generate` CLI (it already prefers a `.obj/.stl/.msh` mesh
      over occupancy walls). The occupancy floor-plan path (TASK-171) is the
      cheaper 2D win already shipped; this adds 3D detail.
- [ ] **Vendor the real Unitree `g1_description` meshes** — replace the
      primitive kinematic proxy in `mjcf/g1/g1_29dof.xml`; pin + document the
      source + licensing.

### C. Phase 4 — sim-RL training (`@status heavier-lift`)

New `../sim-trainer` sibling repo (peer of `../training-worker`): copy the poll
loop (claim/progress/complete/fail/heartbeat), train a **nav/locomotion** policy
(PPO/SAC via the `g1_env.py` MuJoCo scene; reward = progress to a `TwinZone`
goal, penalty for keepout/collision/energy) with domain randomization. Output a
policy artifact consumable by the Phase-3 gate; optionally generate synthetic
trajectories → `outputDatasetId` (wire the dormant `SyntheticJob` model). Reuse
`TrainingOrchestrator`'s job lifecycle via a `kind: 'sim_rl'` discriminator.

- **Key files:** `../sim-trainer/*` (new),
  `server/src/services/TrainingOrchestrator.ts` (job-kind),
  `server/prisma/schema.prisma` (`SyntheticJob` wiring),
  `robot-agent/hardware/sim_evaluator/envs/g1_env.py` (reward/termination).

## Test Strategy

- **B (GLB→OBJ):** pytest — converter produces a MuJoCo-loadable OBJ; a scene
  built with `--mesh room.obj` emits a `room_mesh` geom and loads in MuJoCo.
- **C (sim-RL):** launch a sim-RL job against a twin scene, watch reward climb,
  deploy the resulting nav policy through the Phase-3 gate onto the real G1.
- **A:** the manual full-circle checklist above.
