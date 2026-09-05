---
id: TASK-242
aliases:
- TASK-242
title: The experiment loop — an agent proposes a hypothesis, a human starts it, and
  the platform trains, evaluates and rates the result
slug: agent-experiment-loop
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- training
- agent
sprint: ''
parent: ""
depends_on:
spe: 8
effort: ""
- '[[TASK-238]]'
- '[[TASK-239]]'
- '[[TASK-240]]'
- '[[TASK-241]]'
due_date: ''
created: 2026-09-04
updated: "2026-09-05"
status_note: 'Written 2026-09-04. The capstone of the four tasks below it: each one
  supplies a piece this loop cannot fake — an addressable model (233), a run that can
  continue from one (234), a cheap data variation (235), and a place to record a
  verdict with its evidence (236).'
---

# The experiment loop

## Description

A structured experiment: one hypothesis, several arms, each arm a
(dataset view × hyperparameters × starting model) combination that trains,
evaluates and gets rated automatically. An agent composes the arms; a human
approves the spend; the platform runs it and writes the verdict back into the
discussion layer.

## Details

### Current state

Everything below the loop exists as separate manual steps and nothing ties them
together:

- `TrainingJob` + mixtures (`TrainingJobDataset`, `CompatibilityReport`)
- `EvaluationEpisode` and `EvaluationService` (success rate, model comparison)
- `SimToRealValidation` — `simSuccessRate`, `realSuccessRate`,
  `domainGapScore`, and an existing deployment gate that falls back to an
  absolute threshold when `realSuccessRate` is null
- `SimulationService.VLA_EVAL_PROFILES` — per-embodiment rollout profiles;
  `g1_apple_pnp` is `{ task: 'move the apple to the plate', maxSteps: 600,
  execHorizon: 8 }`, the dataset's exact `annotation.human.task_description`

There is no object that says "these four runs answer one question", and no
automatic step from a finished run to a judgement about it.

### Server

**Schema** (`server/prisma/schema.prisma`):

```prisma
model Experiment {
  id            String   @id @default(uuid())
  tenantId      String?
  title         String
  hypothesis    String   // what this expects to show, in one sentence
  status        String   @default("proposed") // proposed | approved | running | completed | cancelled | rejected
  // Who proposed it — same Actor value object as TASK-241
  actorType     String
  actorId       String
  displayName   String
  approvedBy    String?
  approvedAt    DateTime?
  budgetJson    String   @default("{}") // { maxArms, maxGpuHours }
  baselineArmId String?  // the arm every other arm is compared against
  verdictJson   String?  // JSON: ExperimentVerdict, written on completion
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  arms          ExperimentArm[]

  @@index([status, createdAt])
}

model ExperimentArm {
  id                    String  @id @default(uuid())
  experimentId          String
  experiment            Experiment @relation(fields: [experimentId], references: [id], onDelete: Cascade)
  name                  String  // "drop shaky episodes, lr 1e-5"
  label                 String? // what this arm varies, one phrase
  datasetRefsJson       String  @default("[]") // JSON: MixtureMemberInput[] — may name views
  initFromModelVersionId String?
  hyperparametersJson   String  @default("{}")
  trainingJobId         String?
  modelVersionId        String?
  status                String  @default("pending") // pending | training | evaluating | scored | failed
  resultJson            String? // JSON: ArmResult
  createdAt             DateTime @default(now())

  @@index([experimentId])
}
```

**Arms vary exactly one thing each, against the baseline.** Enforce it in the
service: an arm differing from the baseline in both its data and its learning
rate answers no question. Reject at approval time with a message naming both
differences — the same "one sentence a person reads first" style as
`CompatibilityReport.headline`.

**Service** (`server/src/services/ExperimentService.ts`):

1. `propose(input)` — validates every arm: compatibility of its dataset refs via
   the existing mixture service, `baseModel` agreement with
   `initFromModelVersionId` (TASK-239's rule), budget within limits. Status
   `proposed`. Nothing runs.
2. `approve(id, approver)` — the human gate. Freezes every cited dataset view
   (TASK-240), submits one training job per arm, status `running`. This is the
   only place that spends GPU time.
3. `onJobCompleted(jobId)` — hooked off `TrainingOrchestrator`: takes the arm's
   `ModelVersion`, submits a sim evaluation using the profile from
   `VLA_EVAL_PROFILES` for the embodiment, status `evaluating`.
4. `scoreArm(armId)` — on evaluation completion, computes `ArmResult`
   `{ successRate, episodeCount, meanDurationMs, domainGapScore? }` from
   `EvaluationEpisode` rows and any `SimToRealValidation`, then **writes a
   `Rating` (TASK-241) on the arm's `ModelVersion`** as the experiment-runner
   agent, with the evaluation episode ids as evidence. Status `scored`.
5. `concludeExperiment(id)` — when every arm is `scored` or `failed`: compares
   each arm against the baseline, writes `verdictJson`
   `{ winnerArmId | null, deltas, confidenceNote }`, and posts a `Comment` on
   the experiment summarising it in plain language with the arms as evidence.

**Honest comparison.** The verdict must state the episode count behind each
number and must refuse to name a winner when the arms' success rates differ by
less than the sampling noise at that count. A loop that declares a winner from
twelve rollouts will teach an agent to chase noise, and it will do so tirelessly.
Put the rule in one function with the arithmetic written out and tested.

**Routes** (`server/src/routes/experiments.routes.ts`, `/api/experiments`):
`POST /` (propose), `GET /`, `GET /:id`, `POST /:id/approve`,
`POST /:id/reject`, `POST /:id/cancel`, `GET /:id/arms`.

**Compliance:** approval writes a `ComplianceLog` entry naming the approver and
the budget. The agent's proposal is a recommendation; approval is the human
decision, and that asymmetry is the point of the design.

### Robot Agent / planner

Out of scope here: the agent that *invents* hypotheses. This task ships the
structure it proposes into, plus one deterministic proposer,
`server/src/services/ExperimentProposer.ts`, with two strategies that need no
LLM and make the loop testable end to end:

- **data-ablation** — baseline is the full dataset; each arm drops one
  low-scoring episode band using `views/from-rewards` (TASK-240)
- **lr-sweep** — baseline hyperparameters, arms vary learning rate only

An LLM-driven proposer becomes a separate task once these two have run.

### Frontend

New feature `app/src/features/experiments/`:

- `ExperimentsPage` — list by status; proposed ones surface an Approve action
  with the budget and the arm diff spelled out
- `ExperimentDetailPage` — hypothesis, arm table (what each varies, its status,
  its result), the verdict, and the `CommentThread` from TASK-241
- `ArmComparisonChart` — success rate per arm with the episode count visible on
  every bar, so a bar built from 12 rollouts cannot be read as one built from 400

Route `/experiments`, plus a link from the model detail page (TASK-238) to the
experiments that produced or used that model.

### Key files

- `server/prisma/schema.prisma`
- `server/src/types/experiment.types.ts` (new)
- `server/src/services/ExperimentService.ts` (new)
- `server/src/services/ExperimentProposer.ts` (new)
- `server/src/repositories/ExperimentRepository.ts` (new)
- `server/src/routes/experiments.routes.ts` (new)
- `server/src/services/TrainingOrchestrator.ts` (completion hook)
- `server/src/services/SimulationService.ts` (evaluation submission)
- `app/src/features/experiments/` (new feature)
- `app/src/App.tsx`

## Acceptance Criteria

- [ ] A proposed experiment runs nothing until a human approves it
- [ ] An arm differing from the baseline on two axes is rejected at propose time
      with a message naming both
- [ ] Approving freezes every cited dataset view and submits one job per arm
- [ ] A completed job advances its arm to `evaluating` without manual action
- [ ] A scored arm has a `Rating` on its `ModelVersion` authored by the runner
      agent, carrying evaluation episode ids as evidence
- [ ] The verdict names no winner when the difference is within sampling noise,
      and says so
- [ ] Every arm result states its episode count, in the API and in the chart
- [ ] Cancelling a running experiment cancels its outstanding training jobs
- [ ] A failed arm does not block the experiment from concluding
- [ ] The `data-ablation` proposer produces a valid experiment from a real
      dataset with reward scores

## Test Strategy

- **Unit (vitest, server):** one-axis-per-arm validation; budget enforcement;
  the noise rule (a table of success-rate pairs and episode counts with the
  expected winner/no-winner outcome); state machine transitions including a
  failed arm; cancel cascades to jobs; the rating written by `scoreArm` carries
  the right evidence.
- **Unit (vitest, app):** arm comparison chart renders episode counts; the
  approve dialog shows the arm diff.
- **Integration (vitest, server):** a fake completed job drives an arm from
  `training` through `scored` and produces a `Rating` row.
- **Manual, end to end on the local stack:** a two-arm `data-ablation`
  experiment on a real dataset — propose, approve, watch both arms train in sim,
  read the verdict and the agent's rating with its evidence chips.

## Notes

The vision this serves: an agent that tests its own ideas about data and
settings, and leaves a trail a human can read and argue with. Two properties are
what separate that from an expensive random search, and both are acceptance
criteria above rather than aspirations — every arm varies one thing, and no
verdict outruns its sample size.
