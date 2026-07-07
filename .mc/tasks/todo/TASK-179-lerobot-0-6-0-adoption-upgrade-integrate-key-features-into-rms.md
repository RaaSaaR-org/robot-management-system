---
id: TASK-179
aliases:
- TASK-179
title: LeRobot 0.6.0 adoption — upgrade + integrate key features into RMS
slug: lerobot-0-6-0-adoption-upgrade-integrate-key-features-into-rms
status: in-progress
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- training
- evaluation
- lerobot
sprint: ''
depends_on: []
due_date: ''
created: 2026-07-07
updated: 2026-07-07
---



# LeRobot 0.6.0 adoption — upgrade + integrate key features into RMS

## Description

LeRobot v0.6.0 (<https://huggingface.co/blog/lerobot-release-v060>) is now on
PyPI and ships features that map directly onto NeoDEM's lifecycle stages:
reward models (Evaluate), rollout strategies (Operate), VLM dataset annotation
(Collect/Train), depth video (Digital Twin), native GR00T N1.7 + world-model
policies (Train), and six new sim benchmarks (Evaluate). Finish the version
upgrade everywhere, then integrate the high-value features into RMS, phased.

## Current state (2026-07-07)

- **Already done (uncommitted in the separate repos):** `../vla-server` and
  `../training-worker` Mac venvs upgraded from source-checkout 0.5.2 →
  PyPI `lerobot[smolvla,dataset]==0.6.0`. All tests pass (68+35), real
  `smolvla_base` loads on MPS. READMEs/pyprojects updated (lerobot is now a
  declared dep in `smolvla`/`real-trainer` extras).
- **GPU machine prep (not yet run):** `../training-worker/scripts/setup-lerobot-gpu.sh`
  + `../training-worker/docs/lerobot-0.6-gpu.md` install
  `lerobot[groot,vla-jepa,lingbot-va,fastwam,robometer,topreward,dataset,training,evaluation]`.
- **Unaffected:** `robot-agent/hardware/*_sidecar.py` lazy-import
  `lerobot.robots.{so_follower,unitree_g1}` — paths unchanged in 0.6.0;
  existing Isaac-GR00T shell-out trainer (`trainers/gr00t_n1.py`) and
  vla-server ZMQ GR00T backend keep working.
- **Breaking upstream:** GR00T N1.5 removed (N1.7 replaces it; pin
  `lerobot==0.5.1` only if N1.5 is ever needed). Slim base install — `datasets`
  etc. live behind extras. torch 2.7–2.11, Linux wheels pin CUDA 12.8.

## Details

### Phase 0 — Land the upgrade (baseline)

- Commit the uncommitted 0.6.0 doc/pyproject changes in `../vla-server` and
  `../training-worker` (separate repos, own PRs there).
- Run `setup-lerobot-gpu.sh` on the GPU machine; verify GR00T N1.7 +
  world-model extras import with CUDA.
- RMS repo: update any `docs/vla-integration-guide.md` references to
  source-installing lerobot.

### Phase 1 — Reward models → Evaluate stage (highest value)

Robometer (pretrained Qwen3-VL-4B, per-frame task-progress from video +
language) and TOPReward (zero-shot VLM log-probs) via the new unified
`lerobot.rewards` API. Fills the gap left by the Cosmos3 NO-GO (TASK-176):
automatic episode scoring + progress curves.

- **Server**: new evaluation backend kind `reward_model` alongside the
  existing evaluators. Key files: `server/src/services/` (evaluation service),
  `server/src/routes/evaluation.routes.ts`, Prisma model for per-frame
  progress curves.
- **Training worker** (`../training-worker`): new `eval/reward_model.py`
  runner — loads an episode from RustFS, runs Robometer/TOPReward, POSTs
  progress-curve JSON back.
- **Frontend**: `app/src/features/evaluation/` — render per-episode progress
  curves (recharts line chart); surface score in dataset episode browser
  (`app/src/features/training/`) for curation (flag low-progress episodes).

### Phase 2 — Native GR00T N1.7 trainer path (GPU machine)

- **Training worker**: add `trainers/gr00t_lerobot.py` using in-process
  `lerobot[groot]` (no Isaac-GR00T clone, no v3→v2 conversion — consumes
  LeRobotDataset v3 directly). Select via env `GR00T_BACKEND=lerobot|isaac`
  (default `isaac` until validated). Reuse LoRA/callback plumbing from
  `trainers/smolvla_lora.py`.
- **Server/Frontend**: expose the new trainer variant in the training wizard
  model list (`app/src/features/training/`).
- Once validated on real jobs: deprecate the v3→v2 converter
  (`GR00T_CONVERTER_PYTHON`) and consider retiring the ZMQ PolicyServer path
  in `../vla-server`.

### Phase 3 — lerobot-rollout strategies → Operate stage

`lerobot-rollout` replaces record-based deployment with pluggable strategies:
`sentry` (continuous recording + Hub upload), `highlight` (ring buffer, last
N seconds — incident capture), `dagger` (human-in-the-loop corrections with
intervention tagging).

- **Robot agent**: wire strategies into the hardware sidecars
  (`robot-agent/hardware/vla_runner.py`) — `highlight` maps onto the
  incidents feature, `dagger` onto teleop-correction data collection.
- **Server**: incident-clip ingestion endpoint; tag DAgger interventions as
  dataset episodes.
- **Frontend**: strategy picker in deployment
  (`app/src/features/deployment/components/RunSkillModal.tsx`); incident
  clips in `app/src/features/incidents/`.

### Phase 4 — Dataset tooling (Collect/Train)

- **`lerobot-annotate`**: server-side job to auto-fill timestamped subtasks /
  VQA pairs on imported datasets (`server/src/workers/`); show annotations in
  the dataset detail UI.
- **Depth video**: 0.6.0 encodes depth (mm, 12-bit streams) natively —
  extend data collection + the Digital Twin scan pipeline
  (`app/src/features/digitaltwin/`, twin-builder sidecar) to store depth in
  LeRobotDataset instead of side files.
- **Faster loading**: enable parallel multi-camera decode + worker caches in
  training-worker dataloaders (`--dataset.rgb_encoder.*`, `vcodec=auto` for
  hardware encoders on the GPU box).

### Phase 5 — Benchmarks → Evaluate stage (stretch)

- `lerobot-eval` unified CLI: LIBERO-plus, RoboTwin 2.0 (bimanual — Dex3-1
  relevant), RoboCasa365, RoboCerebra, RoboMME, VLABench. Docker images
  provided upstream.
- Add a `lerobot_benchmark` evaluation kind next to the existing
  `sim_evaluator` (TASK-172.C) so trained policies get benchmark scores in
  the evaluation UI.

### Explicitly out of scope

- World-model policy training runs (VLA-JEPA / LingBot-VA / FastWAM) — extras
  are installed by the GPU setup script; actual training experiments are a
  follow-up research task.
- FSDP multi-GPU + HF Jobs integration — single-GPU box today.

## Acceptance Criteria

- [ ] Phase 0: 0.6.0 committed in vla-server + training-worker; GPU machine venv verified (CUDA + groot/world-model imports)
- [ ] Phase 1: an episode can be scored via Robometer or TOPReward and its progress curve renders in the evaluation UI
- [ ] Phase 2: a GR00T N1.7 fine-tune job runs end-to-end via the native lerobot path (`GR00T_BACKEND=lerobot`) without v3→v2 conversion
- [ ] Phase 3: `highlight` incident clips and `dagger` intervention episodes land in the server from a rollout
- [ ] Phase 4: an imported dataset gets VLM annotations; depth streams stored in-dataset for twin scans
- [ ] Phase 5 (stretch): one benchmark family (e.g. LIBERO-plus) runs against a trained policy and reports into the evaluation UI
- [ ] All existing tests stay green (`./scripts/test-all.sh`, vla-server 68, training-worker 35)

## Test Strategy

- **Phase 0**: `pytest` in both Python repos; `python -c "import lerobot; ..."`
  smoke on the GPU box via the setup script's built-in verification.
- **Phase 1**: unit-test the reward runner against a short fixture episode;
  Playwright check that the progress curve renders on the evaluation page.
- **Phase 2**: fine-tune 50 steps on a tiny dataset on the GPU box; compare
  loss curve sanity vs the Isaac-GR00T path on the same data.
- **Phase 3**: simulated rollout with forced failure → assert highlight clip
  uploaded; teleop override → assert episode tagged as intervention.
- **Phase 4**: import a fixture dataset → annotations present in API response;
  twin scan with depth camera → depth stream decodable to mm units.

## Notes

- Reference doc: `../training-worker/docs/lerobot-0.6-gpu.md`
- Release notes: <https://huggingface.co/blog/lerobot-release-v060>
- Related: TASK-176 (Cosmos3 NO-GO — reward models are the replacement
  evaluation signal), TASK-172.C (sim_rl evaluation kinds), TASK-169
  (G1 EDU hardware bring-up uses `lerobot.robots.unitree_g1`, unchanged in 0.6.0)
