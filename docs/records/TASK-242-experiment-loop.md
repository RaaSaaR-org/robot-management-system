# TASK-242 — The experiment loop

**Date:** 2026-09-30
**Task:** `.mc/tasks/todo/TASK-242-agent-experiment-loop.md`
**Follow-up:** `TASK-323` (the real-dataset, real-GPU run)

Immutable once committed. Later changes of mind get their own record.

## How this was decided

The session ran **unattended** under a workflow that asked for product decisions
to be made on the agent's best recommendation and recorded here. Every decision
below is **Owner: agent (unattended)** and open to override. The spec in the task
file was followed wherever it was specific; these are the places it left open or
where the codebase disagreed with it.

## Decisions

**D1 — Sim rollouts are `EvaluationEpisode` rows with `source: 'sim'` and a
nullable `robotId`.** The spec scores an arm "from `EvaluationEpisode` rows" and the
rating's evidence must be evaluation-episode ids that exist (TASK-241), but the
table required a robot and the simulator writes nothing per rollout. The column
became nullable and `source` (`real` | `sim`, default `real`) was added. The
sim-to-real real-rate derivation now reads `source: 'real'` only — without that,
an experiment's sim rollouts would silently become the "real" success rate of the
model. *Rejected:* a fake "sim robot" row (a lie in the fleet table); a separate
table (breaks the TASK-241 evidence kind).

**D2 — Rollout rows are derived from the evaluator's counts.** The evaluator
reports `successRate` plus, from `metrics.py`, `totalEpisodes` and
`successfulEpisodes` — not a per-rollout log. One row per rollout is written,
successes first, with `rolloutOrderKnown: false` in the metadata. The counts are
exact; the order is not claimed. When the counts are missing (the mock backend)
`rolloutCount × successRate` is used.

**D3 — The noise rule is a pooled two-proportion z-test, Bonferroni-corrected,
with a 10-rollout floor.** `server/src/services/experimentRules.ts`
`compareToBaseline`, arithmetic written out in the comment and tested as a table.
Each arm is compared to the baseline only (that is what "varies one thing" makes
meaningful); the critical z is corrected for the number of arms so proposing more
arms makes each harder to call. Winner: the best arm significantly better than the
baseline; the baseline, if every arm is significantly worse; otherwise none, and
the note says so with every count. When several arms beat the baseline the note
says they were not tested against each other.

**D4 — Axes are: the data (order-independent, weights count), the starting model,
and each hyperparameter key on its own.** Two changed hyperparameters are two axes.
An arm identical to the baseline is refused too — it answers nothing. Checked at
propose time (the AC) and again at approval (the spec).

**D5 — `baseModel` and `fineTuneMethod` live on the Experiment, not the arm.** Every
submitted job needs them and they are not an axis an arm may vary; putting them on
the experiment makes "an arm changed the architecture" unrepresentable.

**D6 — Evaluation settings live on the Experiment (`evaluationJson`: environment +
rolloutCount).** The spec says "the profile from `VLA_EVAL_PROFILES` for the
embodiment"; the embodiment is reached through a simulation environment, so the
experiment names the environment (e.g. `g1_apple_pnp`) and the profile follows
from it. All arms are evaluated identically, which the comparison requires.

**D7 — Budget = `{maxArms, maxGpuHours, gpuHoursPerArm}` with platform ceilings.**
The proposer states its per-arm estimate; `arms × gpuHoursPerArm ≤ maxGpuHours`,
`maxArms ≤ 8`, `maxGpuHours ≤ EXPERIMENT_MAX_GPU_HOURS` (default 96). No live GPU
metering exists to enforce more.

**D8 — Only a person approves or rejects.** An `agent` actor gets 403
`EXPERIMENT_APPROVER_NOT_HUMAN`. Cancel is allowed to anyone who can reach the
route: stopping spend is never the dangerous direction. Approval writes a
`system_event` `experiment_approved` compliance entry with approver, proposer,
budget and the frozen view ids.

**D9 — An arm whose job submission is refused fails on its own.** The experiment
keeps running and concludes without it (the "a failed arm does not block" AC).

**D10 — The verdict comment is posted on a new social subject type `experiment`.**
The spec says "posts a `Comment` on the experiment"; TASK-241 had no such subject.
Arms are cited as `model_version` evidence (or `training_job` for an arm that never
produced a model) — no new evidence kind.

**D11 — The data-ablation proposer creates its views when it composes.** An arm
must cite a real dataset id, so views exist before the proposal. Views are
metadata only; a rejected proposal leaves them behind, visible and deletable on the
dataset page. Band cuts use the same `selectionFromRewards` rule as
`POST /views/from-rewards`; a band that drops nothing, or the same episodes as a
smaller band, makes no arm.

**D12 — Hooks are in-process events.** `TrainingOrchestrator` emits
`model:completed` (after the `ModelVersion` exists) and `model:failed`;
`SimulationService` already emitted `job:completed` / `job:failed`. The loop
subscribes at startup, independent of NATS, and runs each hook inside the
experiment's tenant so ratings and comments are tenant-stamped.

**D13 — `Experiments` joins the Build rail after Models.** The loop sits between
training and the model registry; the page is also linked from the model detail
view (experiments that produced or started from that model).

## Deferred

- The acceptance criterion "the `data-ablation` proposer produces a valid
  experiment from a real dataset with reward scores" and the manual end-to-end run
  need the GPU training worker and a reward-model run → **TASK-323**. The same
  path is covered here on SQLite with seeded `EpisodeReward` rows.
- An LLM-driven proposer is a separate task, as the spec says.
