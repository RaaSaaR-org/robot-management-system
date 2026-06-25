---
id: TASK-171
aliases:
- TASK-171
title: Real-to-Sim → Sim-to-Real — twin scene export, G1 sim env registry, validation gate
slug: real-to-sim-twin-scene-to-sim-to-real-loop
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- server
- app
- robot-agent
- digital-twin
- simulation
sprint: ''
depends_on:
- "[[TASK-170]]"
due_date: ''
created: 2026-06-25
updated: 2026-06-25
---

# Real-to-Sim → Sim-to-Real

## Description

Close the loop between the digital twin and the simulator: turn a scanned room
(DigitalTwin) into a **physics sim scene** with the G1 dropped in, run the robot
in that scene (eval now, locomotion/nav policy training next), then **validate
the result on the real G1 in the same room** and gate deployment on the measured
sim-to-real gap. Today the twin produces geometry and the simulator runs
SO-101 tabletop — nothing connects them. This task is the bridge.

## Implementation status (2026-06-25)

**Phases 1–3 implemented** (the closed loop: eval + validation). **Phase 4
(sim-RL training in a new `../sim-trainer` repo) deferred** — separable
`@status heavier-lift`, no existing analogue.

- **Phase 1 (Real→Sim) — done.** `robot-agent/hardware/sim_evaluator/`:
  `mjcf/g1/g1_29dof.xml` (valid MuJoCo-loadable G1 29-DOF kinematic proxy —
  primitives, all 29 named joints + actuators; TODO vendor real Unitree
  `g1_description` meshes), `mjcf/g1/g1_empty_scene.xml`, `scene_builder.py`
  (the keystone twin→MJCF converter — single documented world→MJCF transform,
  zones→named sites, room from occupancy/perimeter walls), `envs/g1_env.py`
  (29-DOF gym env), `evaluate_vla.py` `--scene-file`/`--embodiment`, pytest
  (`13 passed`, mujoco available, generated scene loads). `twin-builder`:
  `sim_scene_builder.py` + `build_sim_scene` step gated by `ENABLE_SIM_SCENE`,
  forwards `simSceneKey`. Schema: `simSceneKey`/`simSceneBackend` on `DigitalTwin`.
- **Phase 2 (registry) — done.** `SimScene` model + `SimSceneRepository`
  (built-ins seeded on boot, twin scenes upserted on twin-complete),
  `GET /api/simulation/scenes`, `submitJob`/`POST /jobs` accept `sceneId`
  (server resolves backend/embodiment + materialises the MJCF into the
  evaluator's `mjcf/` dir so its relative `<include>` resolves, `--scene-file`).
  App: `simulationStore`, scene picker, "Simulate in this room" deep-link.
- **Phase 3 (sim→real gate) — done.** `SimToRealValidationService` wires the
  dormant `SimToRealValidation` (now decoupled from `SyntheticJob`); real gap =
  `sim − real` from real `EvaluationEpisode`s; `POST/GET /api/simulation/
  validations`; the faked `sim * random()` comparison is **deleted**; deployment
  gate behind `REQUIRE_SIM_VALIDATION` + `SIM_REAL_GAP_THRESHOLD`.

**Migration required:** the new `SimScene` table + `DigitalTwin.simSceneKey/
simSceneBackend` + `SimToRealValidation` columns need `npm run db:push`
(or a migration) before runtime; until then boot logs a caught seed error.

**Known limitation:** MuJoCo can't load GLB; the twin emits `mesh.glb`, so the
scene falls back to occupancy/perimeter walls (always loads). TODO: GLB→OBJ in
the pipeline for true room collision geometry.

**Playwright validation (2026-06-25).** Ran the full loop in the browser after
`db:push`: registered a real twin scene (generated via `scene_builder.py` from
the "G1-Bot room 2" twin). Verified end-to-end: scene picker shows the twin
scene with a "Scanned room" chip + G1 badge and the MuJoCo/Isaac backend filter;
launching submits `sceneId`, the server materialises the MJCF and spawns the
evaluator with `--embodiment g1 --scene-file` (it ran to the VLA-connect step,
failing only because no VLA server runs in dev — expected); Sim-vs-Real shows the
measured gap (sim 85 / real 62 → +23%, `n=13 real episodes`, "Scanned room");
TwinViewer "Simulate in this room" is enabled for `hasSimScene` twins and
deep-links + preselects the scene. Two fixes made during validation:
- **Job failure reason** — a failed evaluator persisted only `evaluator exit N`.
  Now `SimulationService` keeps a stderr tail and `summarizeStderr()` surfaces the
  cause (e.g. "Cannot reach VLA server …"); mapped through `dbToDomain` and
  rendered in the Jobs tab.
- **`realTestCount`** — an explicitly-supplied real sample size was dropped
  (only set when derived from episodes), so the UI showed `n=0`. Now honored
  through the route → service → DTO (covered by a unit test).

## Occupancy fidelity — done (2026-06-25, follow-up session)

The prioritized "biggest realism win" is now wired end-to-end so generated
scenes follow the **real scanned floor-plan**, not the AABB box:

- **`scene_builder.py generate` CLI** — the canonical converter gained an
  argparse `generate` subcommand (`--aabb --out --occupancy-pgm
  --occupancy-yaml --zones-json --resolution --embodiment`). One source of truth
  for the world→MJCF transform; the server spawns it.
- **Server on-demand generation** — `SimulationService.generateSceneFromTwin()`
  + `POST /api/simulation/scenes/generate` (`{ twinId }`). Downloads the twin's
  `occupancy.pgm`/`.yaml`, serializes its `TwinZone`s → JSON, spawns
  `uv run python scene_builder.py generate …` (threading `--occupancy-pgm`),
  uploads `scene.mjcf.xml`, records `simSceneKey` on the twin, and upserts the
  `SimScene`. Works for **any ready twin** — including ones scanned without
  `ENABLE_SIM_SCENE` on the twin-builder. AABB fallback only when a twin truly
  has no occupancy grid.
- **App** — TwinViewer "Simulate in this room" now builds a scene on demand for
  a `ready` twin without a pre-baked one, then deep-links to Launch.
- **Tests** — pytest: occupancy PGM → real wall geoms (not the 4-wall box), CLI
  generate, zones JSON parsing (`17 passed`). vitest: route 400/404/201 +
  `generateSceneFromTwin` threads `--occupancy-pgm` and registers the scene
  (90 passed across the sim suites). End-to-end smoke: CLI on a ring-shaped
  occupancy grid emitted **36 wall geoms** and the result loaded in MuJoCo
  (`nq=36 nu=29 ngeom=68`).

Still open (see [[TASK-172]]): GLB→OBJ mesh collision, vendoring the real
Unitree `g1_description` meshes, the **full-circle hardware run** (needs the VLA
server + a real G1), and Phase 4 sim-RL training.

## Current state (2026-06-25)

The pieces exist but are not wired into a round-trip. Verified by inventory:

**Real → (nothing) :** `DigitalTwinService` + `twin-builder` produce per-twin
artifacts — `cloud.pcd`, `occupancy.pgm`/`occupancy.yaml`, placeholder/Poisson
`mesh.glb`, 6-float AABB, and `TwinZone` polygons (keepout/workcell/charging/
speed). These are consumed only by Nav2/VDA5050 export (TASK-170 Phase 4). **No
path turns a twin into a sim scene.**

**Simulator exists but is SO-101-only:**
`robot-agent/hardware/sim_evaluator/` is a real MuJoCo + Isaac evaluator:
- `mujoco_runner.py` / `isaac_runner.py` (mock-fallback when libs absent),
  `evaluate_vla.py` (driven by `SimulationService`), `render_preview.py`,
  `metrics.py`.
- `envs/so101_tabletop_env.py` (gym env), `mjcf/so101_tabletop_scene.xml` +
  `mjcf/so101/` STL assets. **There is no G1 MJCF and no room/scene from a twin.**
- `SimulationService.ts` + `simulation.routes.ts` run rollouts against **4
  hardcoded environment strings** (`so101_tabletop`, `so101_sorting`,
  `isaac_manipulation`, `isaac_pick_place`). No registry, no twin scenes.

**Eval-only, no sim training:** `SimulationService` runs VLA-inference rollouts
only. `TrainingOrchestrator` + `training-worker` do **imitation learning**
(SmolVLA LoRA on LeRobot datasets) — no RL/locomotion/nav policy training.

**Sim-to-real is faked:** the app Simulation page has a "Sim vs Real" tab, but
`SimulationService.getSimToRealComparison` approximates real success as
`sim * random(0.7..0.9)`. Schema models **`SyntheticJob`** (Isaac Lab synthetic
trajectories → `outputDatasetId`) and **`SimToRealValidation`**
(`syntheticJobId`→`modelVersionId`, `simSuccessRate`/`realSuccessRate`/
`domainGapScore`) exist but are **unwired** (no service/route populates them).

**Embodiment metadata exists:** `robot-agent/src/embodiment/configs/g1.yaml`
(29 DOF) / `g1_edu.yaml` (43 DOF) carry action/proprioception dims, per-joint
position/velocity/torque limits, camera + depth-sensor specs. They **reference a
URDF filename in a comment** (`g1_description/g1_29dof_rev_1_0.urdf`) but nothing
parses it. `robot/joint-configs/g1.config.ts` has the ordered joint list +
limits + home pose. The real G1 hardware path is `g1_sidecar.py` (HTTP, port
8767, `@status hardware-pending`) + `HardwareClient`.

## Architecture (who does what)

Twin geometry is the **scene**; the embodiment is the **robot**; the loop adds
the missing converter + registry + validation, reusing existing infra.

- **Real→Sim (converter):** twin artifacts (mesh/occupancy/AABB/zones) →
  MJCF (MuJoCo) and optionally USD (Isaac) scene with the **G1 dropped in** and
  zones mapped to spawn/goal/keep-out. Lives in `sim_evaluator` (peer of the
  SO-101 scene), built by `twin-builder` as a new artifact so the server is
  system-of-record.
- **Registry:** a `SimScene` row (twin-derived or built-in) replaces the 4
  hardcoded strings; `SimulationService.submitJob` can target a `sceneId`.
- **Sim:** Phase A reuses `evaluate_vla.py` to roll out a policy **in the room**.
  Phase B (heavier) adds a `sim-trainer` worker (copy `training-worker` poll
  loop) that trains a **nav/locomotion policy** (PPO/SAC) in the scene.
- **Sim→Real:** wire `SimToRealValidation` — run the same policy on the real G1
  in the same physical room via `g1_sidecar`, compute `domainGapScore`, surface
  it as a deployment gate; replace the faked comparison.

App visualizes/authors/launches; server is system-of-record; robot-agent
produces real-robot rollouts.

## Details

### Phase 1 — Real→Sim: twin → MJCF/USD scene + G1 model

Build the converter and give the simulator a G1.

- **G1 MJCF:** add `sim_evaluator/mjcf/g1/` (G1 29-DOF MJCF + assets; source from
  `unitree_mujoco`/`unitree_ros` `g1_description` referenced in `g1.yaml`). One
  `g1_env.py` gym env mirroring `envs/so101_tabletop_env.py` (load model, step,
  observation = proprioception per `g1.yaml`, action = 29-d normalized).
- **Converter** `sim_evaluator/scene_builder.py`: inputs a twin bundle
  (`mesh.glb` **or** `occupancy.pgm`+`occupancy.yaml`, AABB, `TwinZone[]`),
  emits `scene.xml` (MJCF) — room as a **static collision mesh** (GLB→`<mesh>`),
  or extruded occupancy walls when no mesh — plus the G1 `<include>`, a floor,
  and zones as named sites (charging→spawn, workcell→goal region, keepout→penalty
  geoms). The **single world→MJCF transform** (z-up, metric) lives here; assert a
  known-AABB case in a test. Optional `scene.usd` for Isaac behind a flag (no-op
  + warn when `usd`/Isaac libs absent — mirror the runner mock fallbacks).
- **twin-builder** (TASK-170 Phase 3 sidecar): new `pipelines/` step
  `build_sim_scene` that vendors `scene_builder.py`, runs after mesh/occupancy,
  uploads `scene.mjcf.xml` (+ `scene.usd`?) as a twin artifact. Add
  `simSceneKey`/`simSceneBackend` to the `DigitalTwin` model + complete-job
  payload. Gated by `ENABLE_SIM_SCENE` so room-scale still ships without it.
- **Key files:** `robot-agent/hardware/sim_evaluator/mjcf/g1/` (new),
  `sim_evaluator/envs/g1_env.py` (new), `sim_evaluator/scene_builder.py` (new),
  `../twin-builder/pipelines/`, `server/prisma/schema.prisma` (DigitalTwin),
  `server/src/services/DigitalTwinService.ts` (persist `simSceneKey`),
  `robot-agent/src/embodiment/configs/g1.yaml` (URDF→MJCF pointer).
- **Demo:** finish a twin build, find `scene.mjcf.xml` among its artifacts, load
  it in MuJoCo, see the scanned room as collision geometry with a G1 standing in
  it.

### Phase 2 — SimScene registry + target a twin from the Simulation page

Make twin scenes first-class simulation environments.

- **Server:** new `SimScene` model (id, name, `source` `builtin|twin`,
  `twinId?`, `embodimentTag`, `mjcfKey?`/`usdKey?`/`backend`, AABB,
  `tenantId?`). Seed the 4 existing built-ins. `SimSceneRepository` +
  `GET /api/simulation/scenes` (replaces the hardcoded
  `getAvailableEnvironments`); a twin completing with a `simSceneKey` upserts a
  `SimScene`. Extend `SimulationJob` + `submitJob` to accept `sceneId` (keep
  `environment` for back-compat), pass the resolved MJCF/USD path to
  `evaluate_vla.py` via a new `--scene-file` arg (download via the twin-artifact
  stream + local-fallback route from TASK-170 Phase 3).
- **App:** in `features/simulation` the Launch tab gains a scene picker fed by
  `GET /api/simulation/scenes` (built-ins **and** ready twins); from the digital
  twin Site page add a **"Simulate in this room"** action that deep-links Launch
  with the twin's `sceneId` preselected. Add the (still missing) Zustand
  `simulationStore` so scene + job state survives navigation.
- **Key files:** `server/prisma/schema.prisma`,
  `server/src/services/SimulationService.ts`,
  `server/src/repositories/`, `server/src/routes/simulation.routes.ts`,
  `robot-agent/hardware/sim_evaluator/evaluate_vla.py` (`--scene-file`),
  `app/src/features/simulation/{api,store,pages,components}/`,
  `app/src/features/digitaltwin/`.
- **Demo:** scan a room → from the Site, click "Simulate in this room" → a
  rollout runs the deployed VLA policy on the G1 inside the scanned room →
  frames + success/collision metrics come back tied to that twin.

### Phase 3 — Sim→Real validation gate (wire the existing models)

Replace the faked comparison with a real measured gap.

- **Server:** `SimToRealValidationService` populates `SimToRealValidation`:
  given a `modelVersionId` + `simSceneKey/twinId`, take the Phase-2 sim success
  rate as `simSuccessRate`, trigger a **real** evaluation in the same physical
  room (reuse `EvaluationEpisode` + `POST /evaluation/run-hardware`) for
  `realSuccessRate`, compute `domainGapScore = sim − real`, persist + emit.
  `getSimToRealComparison` reads this instead of `sim * random()`. Add a
  deployment guard: `Deployment` creation can require a recent passing
  `SimToRealValidation` (gap below threshold) for the target embodiment.
- **App:** the Simulation "Sim vs Real" tab and the Evaluation dashboard show the
  **real** measured gap per twin/scene; Deployment surfaces a
  "validated-in-sim / gap N%" badge and blocks (with override) when no passing
  validation exists.
- **Key files:** `server/src/services/{SimToRealValidationService,
  SimulationService,DeploymentService}.ts`, `server/src/routes/
  {simulation,evaluation,deployment}.routes.ts`,
  `app/src/features/{simulation,evaluation,deployment}/`.
- **Demo:** run the same policy in the twin scene and on the real G1 in that
  room → see a real `domainGapScore`; try to deploy without validation → blocked
  until a passing run exists.

### Phase 4 — Sim training: nav/locomotion policy in the twin scene (`@status heavier-lift`)

The only piece with no existing analogue — train, don't just evaluate.

- New `../sim-trainer` sibling repo (peer of `../training-worker`): copy the
  `training-worker` poll loop (claim/progress/complete/fail/heartbeat), train a
  **navigation/locomotion** policy (PPO/SAC via the `g1_env.py` MuJoCo scene;
  reward = progress to a `TwinZone` goal, penalty for keepout/collision/energy),
  with domain randomization over friction/mass/lighting. Output a policy artifact
  consumable by the Sim→Real gate; optionally generate synthetic trajectories →
  `outputDatasetId` (wire the dormant `SyntheticJob` model) to feed imitation
  training.
- Reuse `TrainingOrchestrator`'s job lifecycle shape; a `kind: 'sim_rl'`
  discriminator on the training job avoids a parallel orchestrator.
- **Key files:** `../sim-trainer/*` (new),
  `server/src/services/TrainingOrchestrator.ts` (job-kind),
  `server/prisma/schema.prisma` (`SyntheticJob` wiring),
  `robot-agent/hardware/sim_evaluator/envs/g1_env.py` (reward/termination).
- **Demo:** launch a sim-RL job against a twin scene, watch reward climb, deploy
  the resulting nav policy through the Phase-3 gate onto the real G1.

## Open items — to test the full real→sim→real circle (2026-06-25)

Phases 1–3 are implemented and the scene renders, but the loop has only been
exercised up to the policy boundary (jobs fail at the VLA connect step; the
sim-vs-real gap was seeded via the API, not measured from a live run). To prove
the **full circle** the following are still open:

**Runtime prerequisites**
- [ ] Apply the schema in the target DB: `cd server && npm run db:push` (or a
      real migration for prod). Creates `SimScene` + `DigitalTwin.simSceneKey/
      simSceneBackend` + the new `SimToRealValidation` columns. *(Done in local
      dev on 2026-06-25; still needed wherever this is deployed.)*
- [ ] Start the **VLA server on :8000** (separate `../vla-server` repo). This is
      the piece missing today — without it every rollout dies at
      `connect_backend` (`ConnectionError: Cannot reach VLA server`).
- [ ] Ensure the `sim_evaluator` uv env is present on the host that runs jobs
      (`mujoco` importable; the server spawns `uv run ... evaluate_vla.py`).

**The full-circle run (the actual test)**
- [ ] **Real→Sim:** scan a room (TASK-170) with `ENABLE_SIM_SCENE=1` on the
      twin-builder so a `SimScene` is registered automatically (not hand-seeded).
- [ ] **Sim rollout:** Simulation → "Simulate in this room" → Launch → a job
      runs to completion against the twin scene; head-camera **frames are
      captured** and play back in the **Results** tab. *(Today: spawns correctly,
      captures nothing because the policy never connects.)*
- [ ] **Real eval:** run the **same policy on the real G1 in the same room** and
      record `EvaluationEpisode`s (so `realSuccessRate` is *derived*, not passed).
- [ ] **Gap:** `POST /validations` with no `realSuccessRate` → confirm the
      persisted `domainGapScore` = measured `sim − real`, and the "Sim vs Real"
      tab shows it with the real episode count.
- [ ] **Gate:** set `REQUIRE_SIM_VALIDATION=true` (+ `SIM_REAL_GAP_THRESHOLD`),
      then verify a deployment is **blocked** when the gap is too large and
      **permitted** (or overridden via `overrideSimValidation`) when it's fine.

**Fidelity follow-ups (loop works without these, but they improve realism)**
- [ ] Vendor the real Unitree `g1_description` meshes (replace the primitive
      kinematic proxy in `mjcf/g1/g1_29dof.xml`; pin + document the source).
- [x] **Use the real scanned floor-plan, not the bounding box.** Done
      (2026-06-25). twin-builder already fed `occupancy_pgm_path`; added the
      missing **server/manual generation path** — a `scene_builder.py generate`
      CLI + `SimulationService.generateSceneFromTwin()` /
      `POST /api/simulation/scenes/generate` that threads the twin's
      `occupancy.pgm` so walls follow the scan (AABB box only when no occupancy
      grid exists). See "Occupancy fidelity — done" above.
- [ ] GLB→OBJ in the pipeline so the room uses true scanned **mesh** collision
      geometry (3D detail beyond the 2D occupancy floor-plan). MuJoCo can't load
      the twin's `mesh.glb`; convert to OBJ/STL first.

**Deferred**
- [ ] **Phase 4** — sim-RL training in a new `../sim-trainer` repo
      (`@status heavier-lift`). Split into its own task when scheduled.

**Ship**
- [x] Branch + commit (incl. this task file) + open PR for Phases 1–3 +
      occupancy fidelity (plain `git push`, branch `feat/g1-pointcloud`).
      Moved TASK-171 → `done`; follow-up captured in [[TASK-172]].

## Test Strategy

- **Typecheck/build:** `npm run typecheck` in server + app + robot-agent;
  `npm run build` (app) for lazy-route imports.
- **vitest (server):** `SimScene` upsert on twin-complete; `submitJob` resolves a
  `sceneId` → scene-file path; `SimToRealValidationService` gap math
  (`sim − real`) + deployment guard blocks/permits correctly.
- **sim_evaluator self-test (pytest):** `scene_builder` over a known AABB +
  zone polygon → MJCF that MuJoCo loads without error, room geoms present, G1
  body present, zone sites at expected world coords; `g1_env` resets/steps in
  mock-free mode when MuJoCo present, mock-falls-back when absent.
- **twin-builder self-test:** `build_sim_scene` over a sample twin bundle →
  valid `scene.mjcf.xml` + uploaded key in the complete payload.
- **Playwright:** scan a room (TASK-170 flow) → Site → "Simulate in this room" →
  Launch prefilled with the twin scene → rollout metrics render; "Sim vs Real"
  shows a real (non-random) gap; Deployment shows the validation badge / block.
- **Manual (`npm run dev:g1` + server + app + sim_evaluator venv):** build a
  twin, load its `scene.mjcf.xml` in MuJoCo, run a rollout in-room, run a real
  G1 eval in the same room, confirm the persisted `domainGapScore` matches.

## Top risks → mitigations

- **G1 MJCF fidelity / licensing** → vendor from Unitree's published
  `g1_description`; pin + document source; collision-only meshes for the room.
- **Frame drift twin↔sim** → reuse the DigitalTwin row as the single
  origin/resolution source; one world→MJCF transform in `scene_builder.py`;
  assert a known-AABB case.
- **Sim libs absent in dev** → mirror existing mock fallbacks; `ENABLE_SIM_SCENE`
  / `--scene-file` optional; Isaac/USD path behind a flag that no-ops + warns.
- **Scope creep into full RL** → Phases 1–3 close the loop with **eval +
  validation** using only existing infra; Phase 4 (training) is separable and
  explicitly the heavier lift.
- **Faked comparison lingering** → Phase 3 deletes the `sim * random()` path; the
  "Sim vs Real" tab must read `SimToRealValidation` or render "not validated".

## Commit / PR

Plain `git push` (not igor); commit `.mc/tasks/` changes on the PR branch before
merging; bundle related follow-up onto one branch/PR. Depends on TASK-170 twin
artifacts (mesh/occupancy/zones) — land or stub those first. Commit/push only
when asked.
