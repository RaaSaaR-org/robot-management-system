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
updated: 2026-07-11
status_note: 'Software-complete as of 2026-07-11. §A validated live on dz-226 (real migration confirmed; rl_policy sim rollout on the real-MID-360-scan twin scene completed through the server with frames+metrics; sim-only validation row persisted with null gap; deploy-gate logic 77/77 vitest). §B done. §C Phases 0-3 done; Phase-4 CUDA gait now SHIPPED via sim-trainer isaac_ppo.py (Isaac Lab + rsl_rl, Isaac-Velocity-Flat-G1-v0, PRs #1/#2 in ../sim-trainer). Remaining = 2 hardware bullets (real-G1 eval → measured domainGapScore) + runtime REQUIRE_SIM_VALIDATION flip on a deploy target; see TASK-169 robot-day checklist item 5. Also open (found 2026-07-11): stub vla-server is SO-101-only (6-dim) — G1 VLA rollouts need a real VLA server on :8000.'
---

# Real-to-Sim follow-ups

## Description

TASK-171 closed the real→sim→real loop (twin→MJCF converter, SimScene registry,
sim→real validation gate) **plus** the occupancy floor-plan fidelity win. This
task collects everything intentionally deferred from it: the full-circle
hardware run, higher-fidelity room/robot geometry, and Phase 4 sim-RL training.

## Details

### A. Prove the full circle on hardware (runtime, not code)

**2026-07-11 runtime validation (dz-226, live dev stack):** everything
software-side is now PROVEN through the live server; only the two real-robot
bullets remain (see TASK-169 "Robot-day checklist" item 5).

- [x] Apply the schema wherever deployed — **done as a real migration**:
      `20260701120000_catch_up_db_push_column_drift` contains TrainingJob.kind/
      sceneId/twinId + nullable dataset cols, ModelVersion.modelType,
      SimToRealValidation nullable realSuccessRate/domainGapScore. Verified
      2026-07-11; the "production Prisma migration" open item is closed.
- [x] Start the **VLA server on :8000** — running in `--stub` mode on dz-226
      (health: `stub:true`); rollouts no longer die at `connect_backend`.
      ⚠ Stub emits 6-dim SO-101 sine actions → a **G1** VLA rollout fails with a
      (6,)-vs-(29,) shape error (correctly surfaced via `failureReason`); G1
      VLA rollouts need a real (non-stub) server or a 29-dim-aware stub.
- [x] Ensure the `sim_evaluator` uv env is present on the host that runs jobs.
      *(Created on dz-226 2026-07-11 via `uv sync`: mujoco 3.6.0, onnxruntime
      1.27.0; imports + `evaluate_policy.py --help` verified.)*
- [x] **Sim rollout** to completion against a twin scene — validated 2026-07-11
      through the live server: rl_policy `7f7ebcb2` on twin scene "G1 Lab (real
      MID-360 scan)" → job `d26ec900` **completed** (3 eps, metrics persisted:
      successRate 0 / collisions 0 — the honest nav-not-gait scope boundary;
      frames captured + served by `/frames/:filename`). VLA-vs-stub also
      completed mechanically on `so101_tabletop` (job `3901b40a`, 42 frames,
      garbage actions as expected from the sine stub).
- [ ] **Real eval** — run the same policy on the real G1 in the same room;
      record `EvaluationEpisode`s so `realSuccessRate` is *derived*.
      *(Still blocked on hardware.)*
- [ ] **Gap** — `POST /validations` (no `realSuccessRate`) → confirm persisted
      `domainGapScore` = measured `sim − real`; "Sim vs Real" shows it.
      *(Real-derived gap still needs the hardware run. The sim-only variant is
      proven live 2026-07-11: validation `bb626921` for the rl_policy persisted
      `realSuccessRate: null, domainGapScore: null`, `simOnly` auto-derived from
      `modelType='rl_policy'`.)*
- [x] **Gate** — `REQUIRE_SIM_VALIDATION=true` (+ `SIM_REAL_GAP_THRESHOLD`):
      *(Gate logic verified 2026-07-11 via vitest — 77/77 incl. all 5 gate
      branches: sim-only block/allow via `SIM_MIN_SUCCESS`, gap block,
      off-by-default. Runtime flag flip not done — requires restarting the
      protected live dev server; exercise it on a deploy target / robot day.
      Note: the measured rl_policy `simSuccessRate=0` would correctly BLOCK at
      the default `SIM_MIN_SUCCESS=0.6`.)*

### B. Geometry fidelity

- [ ] **GLB→OBJ in the pipeline** → moved to **[[TASK-173]]** (the proper
      mesh-collision pipeline). A single converted OBJ is *not* enough — MuJoCo
      convex-hulls a lone mesh geom and collapses the room interior into a solid
      block, so it needs CoACD convex decomposition (trimesh → obj2mjcf + CoACD).
      The occupancy floor-plan path (TASK-171) is the cheaper 2D win already
      shipped; TASK-173 adds true 3D collision detail.
- [x] **Vendor the real Unitree G1 meshes** — *done (2026-06-25).*
      `mjcf/g1/g1_29dof.xml` is now the real Unitree G1 (36 STL collision/visual
      meshes under `mjcf/g1/meshes/`), derived from `unitreerobotics/unitree_mujoco`
      @ `ae6a840` (BSD-3-Clause) by `mjcf/g1/build_g1_include.py`. Made includable
      for `scene_builder` (no `<compiler>`, `g1/meshes/` paths), kept POSITION
      actuators in g1.yaml order, mounted a `head_camera`. Source + license pinned
      in `mjcf/g1/MESHES_LICENSE.md`; loads in MuJoCo (nq=36, nu=29, 36 meshes,
      head_camera renders); 17 pytest green.

### C. Phase 4 — sim-RL training (`@status heavier-lift`)

New `../sim-trainer` sibling repo (peer of `../training-worker`): copy the poll
loop (claim/progress/complete/fail/heartbeat) and train a **navigation** policy
for the G1 in a twin-derived MuJoCo scene, with a server-side job lifecycle.

Design decided 2026-06-26 via an adversarial multi-architect design review
(3 competing designs → skeptic → judges → synthesis). Verdict below.

#### Scope caveat — read first (it changes acceptance)

There is **no G1 gait primitive anywhere in the repo**, and `g1_env.py` exposes
**29 raw joint position-targets** with a `-distance` reward that terminates on
falling. Model-free RL cannot learn G1 **locomotion from scratch** on a single,
non-vectorized, render-every-step MuJoCo env on a Mac — legged RL needs
thousands of parallel envs on CUDA/MJX. **v1 ships the full sim-RL *lifecycle* +
a navigation policy that leans/shuffles toward the goal — NOT a walking robot.**
State this plainly in `../sim-trainer/README.md` (German-primary); do **not**
advertise sim-to-real-validated locomotion. Real gait is deferred to an MJX/
`rsl_rl` CUDA trainer behind the same trainer interface (`mjx_ppo.py`
placeholder).

#### 1. Job model — reuse `TrainingJob` + `kind='sim_rl'`

Not a new model, not `SyntheticJob`. Reusing `TrainingJob` is the only option
that satisfies the **required** non-null `ModelVersion.trainingJobId` FK for free
(`completeJob` sets `trainingJobId = jobId`). Reject `SyntheticJob` (its
`completeJob` writes a required `outputDatasetId`, `submitJob` fires an in-process
fake unconditionally, and it has **no** claim/heartbeat/reap). Reject a new
`SimRlJob` (forks the proven 791-line orchestrator and still re-touches
`ModelVersion`). Purely additive migration (default `kind='supervised'`, no
backfill). Exact Prisma diff:

```prisma
model TrainingJob {
  kind           String  @default("supervised") // 'supervised' | 'sim_rl'   [NEW]
  datasetId      String?                         // was String                [NULLABLE]
  baseModel      String?                         // was String                [NULLABLE]
  fineTuneMethod String?                         // was String                [NULLABLE]
  sceneId        String?                         // SimScene = the RL env      [NEW]
  twinId         String?                         // denormalized convenience   [NEW]
  dataset        Dataset?  @relation(fields:[datasetId], references:[id])      // was non-opt
  scene          SimScene? @relation(fields:[sceneId],  references:[id])       [NEW]
  @@index([kind])                                                             [NEW]
}
model SimScene            { trainingJobs TrainingJob[] }                       // inverse [NEW]
model ModelVersion        { modelType String @default("vla") } // 'vla'|'rl_policy' [NEW]
model SimToRealValidation { realSuccessRate Float?  domainGapScore Float? }    // [NULLABLE]
```

Blast radius is tiny: only **two** readers hard-deref `job.datasetId` —
`training.routes.ts:263` (claim) and `TrainingOrchestrator.ts:578`
(`completeJob`); `:733` already does `?? null`. Before shipping, grep-audit every
`baseModel`/`datasetId`/`fineTuneMethod` deref in `TrainingJobService`, route
serializers, and `app/`, and add a regression test asserting supervised jobs are
byte-for-byte unaffected.

#### 2. Server wiring — reuse `TrainingOrchestrator` + `/api/training/workers/*`

No new orchestrator, repository, or route file. Changes:

- **Kind-aware claim:** claim body gains `kinds?: string[]`;
  `claimNextPendingJob(workerId, device, kinds = ['supervised'])` filters FIFO by
  `kind IN kinds`. `sim-trainer` sends `kinds:['sim_rl']`; the existing
  training-worker is unchanged (defaults to `['supervised']`) → no cross-claiming.
- **Claim route (`training.routes.ts:~263`)** branches on `job.kind`:
  `supervised` → `{ job, dataset }` (today); `sim_rl` → look up
  `simSceneRepository.findById(job.sceneId)` → `{ job, dataset:null, scene:{ id,
  mjcfKey, twinId, embodimentTag, aabb } }`.
- **`completeJob` (`:578`)** guards null dataset + tags
  `modelType: job.kind==='sim_rl' ? 'rl_policy' : 'vla'` on the new `ModelVersion`
  (`dataset?.skillId ?? null` is already null-tolerant).
- **`POST /api/training/jobs`** kind-aware validation: for `sim_rl` require
  `sceneId`, skip the `datasetId/baseModel/fineTuneMethod` required-checks.

#### 3. Phase-3 gate — must be FIXED, not reused

`domainGapScore = sim − real` is meaningless for a policy with no real-G1-nav
counterpart (forces a fabricated `real` number → blocks good policies). So:

- Make `SimToRealValidation.realSuccessRate/domainGapScore` nullable (§1) and add
  a `modelType`-aware **sim-only branch** in `DeploymentService` (`:137–154`):
  when `domainGapScore == null`, gate on absolute `simSuccessRate ≥
  SIM_MIN_SUCCESS` (default `0.6`); else the unchanged VLA gap path. **This is
  load-bearing, NOT deferrable.**
- A **new runner is required**: `evaluate_vla.py:run_episode` only passes
  `(images, state, task)` and HTTP-resets a VLA server — it physically cannot
  feed the 61-dim goal-relative nav obs. Add, in `sim_evaluator/`:
  `envs/nav_wrappers.py` (the **shared** `NavObsWrapper`, used by **both** trainer
  and gate for train/eval parity), `policy_backend.py` (loads `policy.onnx`/`.zip`
  + `vecnormalize.pkl` **locally**, no VLA server), `evaluate_policy.py` (steps
  `G1Env`+wrapper for N rollouts, emits the same stdout JSON as `evaluate_vla.py`).
  `SimulationService` branches on `ModelVersion.modelType==='rl_policy'` → spawn
  `evaluate_policy.py --policy-file … --scene-file …` instead of `evaluate_vla.py`.

#### 4. RL scope (feasibility-driven)

- **Navigation, not locomotion.** Physics stays **real** — do NOT teleport the
  pelvis freejoint (it fights the solver and corrupts the `collision_count`/
  `fallen` signals the gate reads).
- **State-only obs:** `[29 qpos, 29 qvel, goal_dx, goal_dy, |goal|]` (61-dim).
  Upstream `g1_env.py` edit (bundled, same branch): add `obs_mode='rgb_state'|
  'state'` — in `'state'` skip `render()` in `_get_obs` **and guard the
  `mujoco.Renderer` construction in `__init__`** (each `SubprocVecEnv` worker else
  builds a GL context — the dominant cost + a headless-Mac crash source). Default
  `'rgb_state'` = byte-identical to today; cover with a regression test.
- **Reward shaping is MANDATORY, in a wrapper** (env reward is hard-coded to
  `-distance`): potential-based progress + **alive/standing bonus** + keepout +
  energy + terminal shaping. Without the alive bonus the from-scratch problem is
  ill-posed (random policy just falls). Acceptance = "beats random on a
  goal-at-spawn standing case," NOT walking.
- **Library:** stable-baselines3 **PPO** (`MlpPolicy`) + `SubprocVecEnv`
  (`N_ENVS=8` on Mac) + `VecNormalize` + domain randomization (spawn/goal/
  friction/mass/latency). MJX/`rsl_rl` thousands-of-envs CUDA path =
  `mjx_ppo.py` placeholder.
- **Stub-first (mandatory):** `stub_rl.py` rolls out bundled
  `g1_empty_scene.xml` ~20 ticks with a zero policy and writes a *loadable* SB3
  `.zip` + `policy.onnx` — proves the whole vertical slice with zero locomotion
  solved.

#### 5. `../sim-trainer` repo — clones training-worker's poll loop

Sibling repo, peer of `../training-worker`. `worker.py` poll loop,
`HeartbeatThread`, `ServerClient`, `storage.py`, `config.py`, and
`_pick_trainer(TRAINER_STUB)` are **copied**; only the trainer abstraction +
the `sim_rl` claim-payload branch are new. uv path-dep on
`robot-agent/hardware/sim_evaluator` (pin in `uv.lock`; CI `import envs.g1_env`
smoke check).

```
../sim-trainer/
  pyproject.toml  uv.lock  .env.example  README.md  CLAUDE.md   # German-primary
  config.py  server_client.py  storage.py  worker.py           # COPIED + sim_rl branch
  trainers/  base.py  stub_rl.py  ppo_nav.py  mjx_ppo.py(placeholder)
  tests/     test_server_client  test_stub_rl  test_nav_wrappers  test_ppo_smoke
```

**Artifact** → `s3://models/<jobId>/`: `policy.zip` (SB3, = `artifactUri`),
`policy.onnx`, `vecnormalize.pkl`, `manifest.json {kind:'sim_rl',
embodimentTag:'g1', obs_layout, action_dim:29, sceneId, vecnorm}`.

#### 6. Goal / scene sourcing

The goal is **baked into the twin MJCF** — the worker needs nothing beyond
`scene.mjcfKey`. `scene_builder.py` already emits `<site name="goal_site">` at
the first workcell zone center + keepout sites; `G1Env` reads `goal_site` by
name. Builtin scenes (no `mjcfKey`) fall back to bundled `g1_empty_scene.xml`.
**Drop any per-job `goalZoneName` override** — it is inert (the site is baked at
build time; a claim-time selector cannot move it without re-running
`scene_builder`).

#### Phased delivery

| Phase | Deliverable | Test (acceptance) |
|-------|-------------|-------------------|
| ✅ **0 — Server/schema (no Python)** | All of §1–3 in one additive migration + wiring (kind, nullable cols, sceneId/twinId, `ModelVersion.modelType`, **nullable `SimToRealValidation` gap**, kind-aware claim/`completeJob`/`POST /jobs`, **`DeploymentService` sim-only branch**) | Vitest: create `kind='sim_rl'` job w/ `sceneId` + null dataset → claim returns `{scene.mjcfKey, dataset:null}` → `complete` creates `ModelVersion(modelType='rl_policy', staging)`; sim-only validation gates by `SIM_MIN_SUCCESS`; **existing supervised tests stay green** |
| ✅ **1 — Thin vertical slice (stub policy)** | `../sim-trainer` scaffold (poll loop copied) + `stub_rl.py`; claims a `sim_rl` job, rolls out `g1_empty_scene.xml`, uploads loadable `.zip`+`onnx`, posts `/complete` | `pytest` (mocked `ServerClient`, zip+onnx load) + worker glue test (claim→train→upload→complete, server+storage faked). *Live full-server smoke deferred (needs running server+RustFS).* |
| ✅ **2 — Real PPO nav** | `g1_env.py` `obs_mode`; `nav_wrappers.py` (NavObs + alive-bonus ShapedReward + DR); `ppo_nav.py` (SubprocVecEnv + VecNormalize); SB3 callback → progress/heartbeat-cancel | `test_ppo_smoke`: `learn()` over SubprocVecEnv+VecNormalize; heartbeat `'stop'` aborts; `rgb_state` obs byte-identical. ⚠️ "beats random" is **xfail (non-strict)** — see review note: model-free PPO doesn't reliably beat random at CPU/single-env budget (real capability = MJX/CUDA, Phase 4) |
| ✅ **3 — Gate consumability** | `policy_backend.py` + `evaluate_policy.py` + shared `nav_wrappers.py`; `SimulationService` `modelType` branch; sim-only `SimToRealValidation` row | Sim job runs `policy.onnx` in `G1Env` → `simSuccessRate` → validation → `DeploymentService` gates; train vs gate produce identical actions **and** identical normalization (real `VecNormalize` cross-checked) for a fixed obs |
| **4 — Deferred** | Synthetic-traj export → `outputDatasetId`; `mjx_ppo.py` real CUDA/MJX gait; rl_policy serving | Out of v1 (needs a CUDA host) — **UPDATE 2026-07-11: the real-gait CUDA path SHIPPED via Isaac Lab instead of MJX**: `../sim-trainer/trainers/isaac_ppo.py` (`TRAINER=isaac`, Isaac Lab + rsl_rl PPO, `Isaac-Velocity-Flat-G1-v0`, obs-dim build-time guard, sim-trainer PRs #1/#2); SIM-RL PPO jobs have run through the platform on dz-226. `mjx_ppo.py` stays a placeholder. |

#### Implementation status (2026-06-26)

Phases 0–3 **implemented + tested**, **committed on PR #164** (`05b379d`,
2026-06-27). Suites green: **sim_evaluator 39**, **sim-trainer 14** (non-slow;
+1 slow xfail), **server 4738** (full), **app 973**, all typechecks clean.

**Still open on this task:** §A full-circle hardware run (VLA server :8000 +
real-G1 eval — all `[ ]` above), Phase 4 (CUDA/MJX gait + `rl_policy` serving),
and the production **Prisma migration** for the new columns (line 42 — done in
local dev via `db:push`, not yet a committed migration).

Validated by an adversarial multi-agent review (4 dimensions → per-finding skeptic
verification, 20 agents): **15 confirmed findings, all fixed**, 1 dismissed. Notably:
- **HIGH** — `POST /api/simulation/validations` dropped `simOnly`, making the
  sim-only deploy gate unreachable through its only production entry point; now
  forwarded + auto-derived from `modelType==='rl_policy'` (route test added).
- **MED** — gate ran N byte-identical rollouts (`success_rate` could only be 0/1);
  now seeded spawn-only domain-randomization so the rate samples a distribution.
- **MED** — `_sim_evaluator_path` brittle `sys.path` scan → now passed explicitly
  via `SimRlContext.sim_evaluator_path`.
- **MED** — twin scene silently degraded to the bundled empty room; server now
  **fails the job** instead of scoring in the wrong environment, trainer surfaces
  `usedFallbackScene`.
- **MED** — `test_ppo_beats_random` was a false green (unnormalized obs); fixed to
  evaluate through the real gate path → revealed the honest scope boundary (xfail).
- LOWs: policy-dir leak on materialize failure, cancel-before-spawn race, manifest
  error vs not-found discrimination, float64 VecNormalize parity, manifest-parse
  crash guard, gate render-cost, DR reset-info staleness, RL metrics persisted into
  `trainingMetrics`, worker heartbeat/cleanup robustness, gate-parity test now
  cross-checks real `VecNormalize`.

#### Top 3 risks

1. **RL feasibility / no in-repo gait (high).** v1 can't deliver a walking G1 on
   a Mac. *Mitigation:* stub-first delivers the lifecycle independent of gait
   quality; scope = nav + state-only + VecEnv + **mandatory alive-bonus shaping**;
   honest docs; gait deferred to `mjx_ppo.py`.
2. **Gate semantics for a policy with no real counterpart (medium-high).**
   `domainGapScore = sim − real` is undefined sim-only. *Mitigation:* nullable-gap
   + `SIM_MIN_SUCCESS` branch are **Phase-0, load-bearing**.
3. **Nullable-ing hot `TrainingJob` columns + cross-repo path-dep (medium).**
   *Mitigation:* grep-audit every `baseModel/datasetId` deref before shipping;
   supervised-unaffected regression test; pin the `sim_evaluator` uv path-dep with
   a CI import smoke check.

- **Key files:** `../sim-trainer/*` (new),
  `server/prisma/schema.prisma` (`TrainingJob` :2172 / `ModelVersion` :2208 /
  `SimToRealValidation` :1807 / `SimScene` :1836),
  `server/src/services/TrainingOrchestrator.ts` (:578 claim-kind +
  `completeJob`), `server/src/routes/training.routes.ts` (:263 claim),
  `server/src/services/DeploymentService.ts` (:137–154 sim-only gate),
  `robot-agent/hardware/sim_evaluator/{envs/g1_env.py (obs_mode),
  envs/nav_wrappers.py, policy_backend.py, evaluate_policy.py}` (new).

## Test Strategy

- **B (GLB→OBJ):** pytest — converter produces a MuJoCo-loadable OBJ; a scene
  built with `--mesh room.obj` emits a `room_mesh` geom and loads in MuJoCo.
- **C (sim-RL):** per-phase (see table). Phase 0 = vitest (sim_rl job claims w/
  null dataset → `ModelVersion(rl_policy)`; sim-only gate; supervised unaffected).
  Phase 1 = stub vertical slice goes pending→running→completed with an artifact.
  Phase 2 = PPO `learn()` beats random on goal-at-spawn + heartbeat-cancel aborts.
  Phase 3 = `evaluate_policy.py` rolls out the policy → `simSuccessRate` →
  `DeploymentService` gates on `SIM_MIN_SUCCESS`. v1 acceptance is a navigation
  policy through the gate — **not** a walking G1 (gait deferred).
- **A:** the manual full-circle checklist above.
