---
id: TASK-226
aliases:
- TASK-226
title: Let the Agent Mode planner trigger a VLA skill block, so a plan can pick and place
slug: agent-mode-triggers-a-vla-skill-block
status: todo
priority: 2
owner: "huhn511"
projects: []
customers: []
tags:
- core
- agent-mode
- vla
sprint: ''
parent: ""
depends_on: []
spe: 1
effort: ""
due_date: ''
created: 2026-08-29
updated: "2026-09-05"
status_note: 'Written 2026-08-29 from four internal code-research passes and one external
  prior-art survey. The block was already designed and deliberately deferred: types.ts:13 reads
  "Executable block vocabulary (v1). No `vla_skill` — deferred to TASK-188", and the stated reason
  was POLICY QUALITY, not missing plumbing. That framing still holds and step 0 below is a safety
  bug that exists TODAY, independent of whether the rest ships. Do NOT expect this task to produce a
  working apple pick: TASK-188 records the best policy completing its own trained task 2/10, and
  published GR00T zero-shot on a G1 is 0%. This task makes the plan able to CALL a skill and to
  KNOW WHEN IT FAILED. Making the skill succeed is TASK-188/TASK-225.'
---

# Let the Agent Mode planner trigger a VLA skill block, so a plan can pick and place

## Description

Agent Mode can walk and see, but not pick and place. The planner emits blocks from a
fixed vocabulary and none of them reach a manipulation policy, so
"walk to the table, pick up the apple and put it on the plate" is unplannable —
the first clause is a `goto`, and the rest has no representation at all.

Add a `vla_skill` block that the planner may emit, which dispatches a named,
parameterised skill to the VLA runner, decides for itself whether the skill
succeeded, and reports that back to the plan.

## Where this stands (2026-08-29)

### The block was already named and deferred, on purpose

`robot-agent/src/agent-mode/types.ts:13`:

```ts
/** Executable block vocabulary (v1). No `vla_skill` — deferred to TASK-188. */
```

`docs/architecture.md` says the same. So this is not a new idea and the name is
already chosen. The recorded reason for deferring was that the policy does not
work well enough to be worth planning around — see TASK-188. That reason has not
changed, which is why the acceptance criteria below are about **dispatch and
failure reporting**, not about task success.

### Step 0 is a live safety bug, and it is not gated on any of this

`robot-agent/src/agent-mode/agent-mode-controller.ts:3056-3095` (`runVlaSkill`)
constructs `new SkillExecutor(rsm)` directly and **never registers it** in
`skillExecutorRegistry` — verified 2026-08-29: that file contains zero
references to the registry, while `robot/state.ts:2051` registers and
`robot/state.ts:1785` is the `abortAll()` the safety loop calls. `state.ts` even
carries the comment *"Same registry as skill runs, so the safety loop's abortAll() halts
this too."*

Consequences, all present today:

- a rollout started from Agent Mode is invisible to `abortAll()`, so **protective
  stop cannot reach it**;
- it receives no `AbortSignal` and exposes no `isAborted` hook, so **E-Stop and
  teleop preemption cannot cut it short** — it simply blocks the plan loop for up
  to `timeoutMs` (60 s default).

It is latent only because `TOUR_DEMO_MODE` defaults to `narrate`. Anything that
lets the planner emit a skill block turns it on by definition. **Fix this first
and separately** — it is a small change that should not wait behind the rest.

### What already exists and should be reused

- `robot-agent/src/vla/skill-executor.ts` is live and is the correct dispatch
  point. `SkillDefinition` already carries `preconditions`, `postconditions`,
  `requiredCapabilities`, `timeout`, `maxRetries` and `linkedModelVersionId` —
  the schema for a "skill" is largely already designed.
- The VLA transport is **HTTP/JSON, not gRPC**: `POST {baseUrl}/predict` with
  `{images: Record<camera, base64Jpeg>, state: number[], task: string}` returning
  `{actions: number[][]}` (absolute joint-position targets). The gRPC scaffolding
  (`protos/vla_inference.proto`, `@grpc/*`) has **no consumer** — do not extend it.
- `control-owner.ts` already refcounts an `idle|teleop|vla|agent` lock in which
  `teleop` always preempts and `vla` only acquires from `idle`. A skill block must
  go through it.

### Three defects in the existing bridge

1. `demo` is in `HostOnlyBlockKinds` (`types.ts:57` — `['tour', 'present', 'demo']`),
   and the planner schema is the complement of that list, so the planner
   **cannot** emit it. The existing plan→VLA path is reachable only by a
   host-authored tour.
2. The task prompt falls back to `` `Execute skill ${skillName}` `` instead of the
   string the policy was trained on. The trained strings live in
   `SimulationService.ts` `VLA_EVAL_PROFILES` (e.g. `"move the apple to the
   plate"`), a path `SkillExecutor` never consults. **Feeding a policy a prompt it
   was not trained on is a silent quality cliff**, not an error.
3. `TourDemo.modelVersionId` is never read, so no adapter swap happens.

### There is no success signal anywhere

In `SkillExecutor`, `completed` means *"ran `maxSteps` without throwing"*. Nothing
looks at the world. This is the single most important gap in the task and is
treated as its own step below.

### The scene memory cannot name a grasp target

Objects are stored as `label + bearing + distance`, keyed by **lower-cased label**,
so there is exactly one `apple` ever, with no 3-D pose and no graspability.
"Pick the apple" can therefore select a *direction*, not a grasp target. Any
parameter schema that pretends otherwise is lying to the planner.

### Adding a block kind is a 31-file change the compiler mostly cannot check

~31 source/doc files plus 7 test files. **TypeScript catches only 5** (the
`coerceParams` and `execute` exhaustive switches, `BLOCK_LABELS`, `BLOCK_GLYPHS`).
Three mirrored wire-contract files must land together:

- `robot-agent/src/agent-mode/types.ts`
- `server/src/types/agent-mode.types.ts`
- `app/src/features/agentmode/types/agentmode.types.ts`

Two of the unchecked spots **fail open**:

- `initiative.ts` treats an unlisted kind as **self-initiable**;
- `journal.ts` `blockTrust()` defaults an unlisted kind to `'self'` (**trusted**).

`heartbeat.ts` gets this right (`HEARTBEAT_ALLOWED_KINDS` is fail-closed) and its
comment explains why. Follow `heartbeat.ts`, not the other two.
`voice-narrator.ts`'s phrasebook is also not exhaustive-checked — a missing entry
silently drops the block from the spoken plan.

### The robot cannot yet reliably reach the table

Measured on the live Isaac factory scene (2026-08-29, PR #276): commanding
`vx=0.3` for 25 s produced 2.7 m of travel (~0.11 m/s) while the heading drifted
**+45° → −18°**, about 2°/s of unbidden yaw. `walk` measures distance and never
measures heading, so a `goto` across a room does not arrive. The closed-loop turn
fix (PR #275) does not address this. **A pick block is not blocked on it — but an
end-to-end "walk to the table and pick the apple" demo is.**

## Settled decisions

1. **One language-conditioned generalist invoked with a short natural-language
   subtask string. NOT a library of narrowly fine-tuned per-task policies.**
   The systematic hierarchical-VLA study (arXiv 2606.10267) measured a VLA
   fine-tuned on the target domain dropping to **7.5%** on long-horizon tasks —
   because fine-tuning damaged the instruction-following the hierarchy depends
   on — against 67.1% for the best orchestration. Independently, π0 (generalist)
   holds **58.5%** under instance+spatial OOD where ACT (specialist) gets **5.5%**.
   A "roboclaw"-style library of `apple_pnp` / `open_door` fine-tunes is the
   option the evidence argues against.
2. **But the block is still a NAMED, PARAMETERISED call, not a free-text string.**
   The name is what carries retry policy, safety gating, logging and the
   precondition check; the natural-language instruction is one *field* of it,
   and is what actually reaches the policy. This is the shape BT.CPP's
   `TreeNodesModel`, MCP, LeRobot's `meta/info.json["tools"]` and Gemini
   Robotics-ER's declared robot APIs all independently converged on.
3. **The trained prompt string is data, not a default.** It comes from the skill
   definition (ultimately the dataset's `task` field), never from
   `` `Execute skill ${name}` ``. See defect 2 above.
4. **Termination and failure detection live OUTSIDE the policy.** ReViP
   (arXiv 2601.16667) measured π0 on a real robot continuing toward the goal in
   **46 of 50 trials** despite clear visual evidence the object was never
   grasped. A VLA will not tell you it failed. Budget for an external check.
5. **Fail closed.** Every allow-list the new kind touches must name it explicitly;
   no new kind may inherit `self`-trust or self-initiability by default.
6. **Do not extend the gRPC path.** HTTP/JSON `POST /predict` is the live one.
7. **Scope excludes making the skill succeed.** TASK-188 and TASK-225 own policy
   quality. This task owns dispatch, preemption, and an honest success/failure
   report.

## Details

### Step 0 — register the executor (do this first, ship it alone)

`agent-mode-controller.ts` `runVlaSkill` must register with
`skillExecutorRegistry` and pass an abort hook, exactly as `robot/state.ts` does.
Test: a protective stop during an Agent-Mode-initiated rollout actually halts it.

### Step 1 — the block

Add `vla_skill` to the three mirrored type files. Params, at minimum:

- `skillId` / `skillName` — the named, gated thing;
- `instruction` — the string handed to the policy, defaulted from the skill
  definition's trained prompt;
- `timeoutMs`, `maxRetries` — from `SkillDefinition`, overridable.

Add it explicitly to: `initiative.ts` (**not** self-initiable), `journal.ts`
`blockTrust()` (**not** `'self'`), `heartbeat.ts` `HEARTBEAT_ALLOWED_KINDS`,
`BLOCK_LABELS`, `BLOCK_GLYPHS`, `voice-narrator.ts`'s phrasebook, and the
`coerceParams`/`execute` switches. Grep for every existing kind (e.g. `'scan_room'`)
and check each hit.

### Step 2 — dispatch through the control-owner lock

Acquire `vla` from `control-owner.ts`, release on every path including throw and
abort. Teleop and E-Stop must preempt. A failed acquisition is a block failure
with a readable reason, not a silent no-op.

### Step 3 — a success signal

The cheapest credible option, and the one with the best published cost/benefit:
a **learned binary success classifier** polled during and after the rollout.
AutoEval (arXiv 2503.24278) fine-tuned PaliGemma from **~1000 images, under 10
minutes of teleop**, to **>95%** accuracy, and ran 24 h / ~850 episodes with 3
interventions. Pair it with a **fixed 4–8 s horizon fallback** — the orchestration
study found success-detection-plus-fallback the best combination, and a
VLM-predicted horizon the *worst* (43.5% long-horizon).

Minimum acceptable for this task: the block reports a **three-way** outcome —
`succeeded` / `failed` / `unknown` — and never reports `succeeded` on the strength
of "did not throw". `unknown` is an honest and useful answer; a false `succeeded`
is not.

### Step 4 — the failure reaches the planner

`runPlan` currently stops the plan on failure and the error text never reaches the
planner, so it cannot replan. At minimum, a failed `vla_skill` must put its reason
into the planner's next context.

### Not in scope

Retry/replan loops, grasp primitives, `g1_sidecar.py POST /action` (disabled by
the `G1_READ_ONLY=1` default), and TASK-213's `demo` block semantics.

## Test Strategy

- **Step 0 regression test**: an Agent-Mode-initiated rollout is halted by
  `abortAll()`. This test should fail before the fix.
- **Fail-closed tests**: assert `vla_skill` is *not* self-initiable and *not*
  `'self'`-trusted — assert on the value, not on the absence of an entry.
- **Exhaustiveness**: a test that enumerates `PlannerBlockKinds` and asserts every
  kind has a `BLOCK_LABEL`, a glyph and a narrator phrase, so the next block kind
  cannot silently skip them.
- **Prompt provenance**: assert the string sent to `/predict` is the skill's
  trained prompt and never `` `Execute skill ${name}` ``.
- **Live**: on the factory scene (PR #276), with the robot placed at the table
  rather than walked there — the heading-drift finding above means walking to it
  is a separate problem.

## Acceptance Criteria

- [ ] `runVlaSkill` registers with `skillExecutorRegistry`; protective stop and
      teleop preempt an Agent-Mode-initiated rollout (shipped separately, first)
- [ ] `vla_skill` exists in all three mirrored type files and the planner may emit it
- [ ] It is explicitly listed in every allow-list it touches, and fails closed
- [ ] The instruction sent to the policy is the trained prompt from the skill
      definition
- [ ] The block acquires and releases the `vla` control-owner lock on every path
- [ ] The block reports `succeeded`/`failed`/`unknown` and never infers success
      from "did not throw"
- [ ] A failed block's reason reaches the planner's next context
- [ ] Typecheck and the full robot-agent suite pass

## Not verified / open questions

- **Which policy.** GR00T N1.7 with a `NEW_EMBODIMENT` tag is the shortest path
  on a G1 with Dex3 hands (43-DOF layout published; NVIDIA's own G1 course reports
  68% on apple pick-and-place over 100 rollouts). **SmolVLA is ruled out** — it
  crashes rather than degrades above 32 DOF. Budget **100–200 demos per task**,
  not 50. None of this is decided here and none of it is verified on our hardware.
- **Handoff pose tolerance is brutal and unmeasured for us.** Mobi-π
  (arXiv 2505.23692) measured the base-pose deviation that *halves* success at
  **0.031 m** for one task. Our navigation has no such budget today.
- Whether a `vla_skill` block can be made safe on real hardware at all — the
  swept-volume gap raised in PR #275 is unfixed, and `G1_READ_ONLY=1` means the
  real-robot action path is disabled anyway.
- Whether the planner (gemma3:4b, with documented instruction-following problems)
  can be given a new block kind without regressing the existing bench. **The bench
  is the gate**, and prompt length is a measured regression risk.


## What is actually left — 2026-09-05 audit

Proposed for closure and refuted 2 of 3. The behaviour is on main and tested — one reviewer
ran the full robot-agent suite green (133 files, 2315 tests) — but two things the task itself
names are unfinished:

- ~~**`docs/architecture.md` still states the deferral this task exists to undo.**~~ Fixed
  2026-09-05: the `(v1)` qualifier is gone, `vla_skill` is in the block list, and the
  paragraph now says what the kind does and points at `AgentBlockKinds` in
  `robot-agent/src/agent-mode/types.ts` as the authoritative list, so the doc cannot drift
  from the code again the same way.
- **The planner bench was never re-run.** The task says "the bench is the gate" and flags
  prompt length as a measured regression risk. `robot-agent/scripts/planner-bench.ts` last
  changed at 79e417bd, before this work, and was neither extended for the new block kind nor
  re-run.
- The Test Strategy's Live item (factory scene, robot placed at the table rather than walked
  there) has no recorded run. That one is not an acceptance criterion and is covered by
  TASK-227.

The first two are offline work and small.

### Remaining after 2026-09-05

Only the planner bench. It cannot run on this box today: `robot-agent/scripts/planner-bench.ts`
loads models of 6-13 GB one at a time, and another user's `Isaac-GR00T`, `isaac-sim` and
`ollama` processes hold 23.6 GB of the 32.6 GB card. Loading a bench model would either fail or
evict a running measurement, so it waits for an idle GPU rather than being forced.
