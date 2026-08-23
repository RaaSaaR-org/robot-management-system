---
id: TASK-202
aliases:
- TASK-202
title: Give the planner call a timeout — a dead model leaves a plan in `planning` forever
slug: give-the-planner-call-a-timeout
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- agentmode
- g1
sprint: ''
depends_on: []
status_note: 'DONE 2026-08-23. AGENT_PLANNER_TIMEOUT_MS, default 300 s, is ONE budget for the planner round rather than one per call — a per-call deadline would let a wedged model cost 2x the number the operator was told. The default is pinned to both measurements in the task: the legitimate 3.5-minute plan sets the floor, the 240 s hang sets the ceiling. The call is cancelled through an AbortSignal (Genkit forwards it to the fetch) AND raced, because the thing being raced may ignore the signal; the abort is asserted, not assumed. On expiry the round stops without opening the repair attempt — there is no answer to repair from — and the robot speaks a sentence naming the model, the elapsed deadline and what to check (`ollama ps` can list a model whose worker has died). PlannerResult gained `timedOut` so nothing has to match on prose. SCOPE LINE, deliberate: a timed-out plan ends through the EXISTING planner-failure path (one honest speak block, plan `done`) rather than plan.status `failed` — `failed` feeds notePlanOutcome/lastPlanFailedAtMs and would change heartbeat behaviour, which is a different change from giving the call a deadline. The defect named in the title is fixed either way: the plan no longer sits in `planning`. Frontend: the rail counts up next to the Planning pill (1 s tick, where the page''s other two counters are 10 s and say they are coarse on purpose), measured from a new browser-clock `pendingCommand.sentAt` so robot-clock skew stays out of the number, clamped so it can never run backwards, and deliberately outside the page''s one live region. Stop path verified untouched by test: a STOPP lands with StopMove + Damp while the planner is still hung.'
due_date: ''
created: 2026-08-02
updated: 2026-08-23
---


# Give the planner call a timeout — a dead model leaves a plan in `planning` forever

## Description

The Agent Mode planner call has no timeout. When the local model stops answering, the plan sits in
`planning` indefinitely — no error, no progress cue, and the operator has no way to tell a slow
2B model from a dead one.

## Details

### Current state

`robot-agent/src/agent-mode/llm.ts` exports `genkitGenerate`, which `Planner`
(`robot-agent/src/agent-mode/planner.ts:375`) uses as its default `generate`. Neither passes an
`AbortSignal` and nothing races the call against a clock. A plan that never returns never leaves
`planning`, so `AgentModeState.plan.status` stays there and the console's block timeline shows the
"Planning…" state with nothing behind it.

### How it bit (GPU_BOX, 2026-08-02)

Ollama kept advertising `gemma4:e2b` as loaded — `GET /api/ps` listed it with
`size_vram=1.77GB` — after its `llama-server.exe` worker had died. Every request to the model then
hung. Two commands sent through Agent Mode each sat in `planning` for the full 240 s the test
harness allowed and were still there when it gave up; a direct
`POST /v1/chat/completions` against the same model hung for 240 s too, so the fault was outside
this repo. Restarting the Ollama server fixed it (the planner then answered in 1.1 s).

The point is not that Ollama broke. It is that **from inside the product the two states are
indistinguishable**: "the local model is thinking" and "the local model is never going to answer"
both render as `planning` forever. A 3.5 minute `planning` was also observed on an earlier session
against a healthy model, so the honest default cannot be aggressive.

### What to build

**Robot Agent.** Race the planner call against a configurable deadline
(`AGENT_PLANNER_TIMEOUT_MS`, defined in `robot-agent/src/config/config.ts` next to the other
`AGENT_*` knobs) and abort it via `AbortSignal` so the request is actually cancelled rather than
left in flight. On expiry the plan must fail with a message that names what happened and what to
check — the planner is a local model on this box, so "the planner did not answer in Ns" plus the
model name is actionable, unlike a generic failure.

Pick the default deliberately and write down why, in the doc-comment: it has to be longer than a
slow-but-working plan on the smallest supported model (3.5 min was seen and was legitimate) and
short enough that a wedged model is not indistinguishable from a working one for a whole shift.
A visible elapsed counter on the `planning` state would soften the trade-off and may be the better
half of the fix.

Note the interaction with the stop path: the E-Stop and the stop words bypass the LLM entirely
(`AGENT_STOP_WORDS`) and must keep doing so — a planner timeout must not become a new way for a
stop to be delayed.

**Frontend.** The rail's `planning` state currently carries no elapsed time
(`app/src/features/agentmode/`). Showing one is cheap and is what turns "is it stuck?" into a
question the operator can answer.

### Key files

- `robot-agent/src/agent-mode/llm.ts` (`genkitGenerate`)
- `robot-agent/src/agent-mode/planner.ts`
- `robot-agent/src/agent-mode/agent-mode-controller.ts` (plan lifecycle / failure path)
- `robot-agent/src/config/config.ts`, `robot-agent/.env.g1-edu-agent.example`
- `app/src/features/agentmode/` (status rail)

## Test Strategy

Unit: a `generate` double that never resolves must produce a failed plan within the configured
timeout, carrying the timeout reason — and one that resolves just inside the deadline must still
succeed, so the fix cannot be "fail everything slow".

Assert the abort actually fires: the double should observe its `AbortSignal` being aborted, not
merely be abandoned by a `Promise.race`.

Live: with the rig running, `ollama stop gemma4:e2b` (or kill its `llama-server.exe`) mid-command
and confirm the plan fails with a readable message inside the deadline instead of hanging.
