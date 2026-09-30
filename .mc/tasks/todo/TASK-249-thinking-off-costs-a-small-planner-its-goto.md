---
id: "TASK-249"
aliases: []
title: "Turning thinking off costs a small planner its goto — decide, per model, whether that trade is wanted"
slug: "thinking-off-costs-a-small-planner-its-goto"
status: "in-progress"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: ["core", "agent-mode"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-06"
updated: "2026-09-30"
---

# Turning thinking off costs a small planner its goto — decide, per model, whether that trade is wanted

## Description

`32697991` routed `thinking: false` off the OpenAI-compat `/v1` endpoint and onto Ollama's
native `/api/chat`, where `think: false` actually reaches the model. It was measured for the
thing it set out to fix — whether thinking gets suppressed — and not for what suppressing it
costs. On `gemma4:e4b` it costs 16 points of plan accuracy and introduces three open-loop
dashes. Nobody has decided whether that is a trade we want, because nobody knew it was one.

**This is not a production regression.** `AGENT_PLANNER_MODEL=gemma4:12b`, and 12b scores
identically on both sides of the commit. The task is to make the trade visible and chosen
rather than inherited.

## Details

### What was measured (2026-09-06)

`robot-agent/scripts/planner-bench.ts`, 18 cases × 3 repeats, real prompt and schema,
`AGENT_PLANNER_THINKING` unset so thinking is off — the shipped configuration:

| commit | `gemma4:e4b` | dashes | `gemma4:12b` | dashes |
|---|---|---|---|---|
| `f3c3f7e7` (parent) | 51/54 (94%) | 0 | 51/54 (94%) | 0 |
| `32697991` | **42/54 (78%)** | **3** | 51/54 (94%) | 0 |

Bisected to that single commit: its parent is clean, it is not. Two independent runs on
`main` reproduce 42/54 with the identical four failing cases — `goto-door`, `goto-chair`,
`goto-table-en` and `scan`, each 3/3 — so it is not sampling noise. The three regressed cases
are all approaches, and the model answers them with a forward `walk` instead of a `goto`:
the robot dashes open-loop instead of running the measured-range loop. That is the exact
failure mode `openLoopDashes` exists to count.

### Why it happens

The commit's own table records that `reasoning_effort: 'none'` on `/v1` reached
`gemma4:12b` and `qwen3-vl:8b` differently, and concluded suppression "is a property of the
MODEL, not of the endpoint". That conclusion holds and is the mechanism here: `e4b` was
still thinking over `/v1`, because the compat shim's spread of an unrecognised key never
suppressed anything for it. Native `think: false` does. The plans got worse because the
model stopped thinking — not because the transport is broken.

Both transports send the same temperature (`effectiveTemperature`, 1e-4) and the same JSON
schema (`format` vs `response_format.json_schema`), so sampling and constrained decoding are
not the difference. `llm.ts` is behaving as designed.

### The decision this task exists to make

Thinking is off by default (`AGENT_PLANNER_THINKING` is only true for the exact string
`"true"`). For a model that plans measurably worse without it, that default is a choice
about latency versus a robot that walks blind. Options, in the order they are worth trying:

1. **Leave it.** 12b is what ships and 12b is unaffected. Record the number next to
   `DEFAULT_AGENT_MODEL` so the next person picking a smaller model sees the cost first.
2. **Per-model thinking.** Let `AGENT_PLANNER_THINKING` be resolved per model rather than
   globally, so a model that needs to think does, and 12b still does not pay for it.
3. **Measure the latency side.** The comment in `benchHeaderLines` puts thinking at ~500
   tokens per call. Bench `e4b` with `AGENT_PLANNER_THINKING=true` and record both the score
   and the median latency, so the trade is two numbers rather than one.

### Key files

- `robot-agent/src/agent-mode/llm.ts` — `buildNativeChatBody`, `ollamaNativeGenerate`, the
  `req.thinking === false` reroute
- `robot-agent/src/config/config.ts:795` — `plannerModel`; `:799` — `plannerThinking`
- `robot-agent/scripts/planner-bench.ts` — the bench and its 18-case gate

## Re-bench with thinking on (2026-09-30)

Not the 5090: an Apple-silicon Mac, Ollama 0.33.3, `gemma4:e4b` freshly pulled. Latency is
therefore only comparable within this table. Same bench, 18 cases × 3 repeats, on `main`
(`38df1325`) — the thinking-on arm through `AGENT_PLANNER_THINKING=true`:

| model | thinking | plans right | dashes | fallbacks | median latency | failing cases (3/3 each) |
|---|---|---|---|---|---|---|
| `gemma4:e4b` | off | 42/54 (78%) | 3 | 0 | 0.7 s | goto-door, goto-chair, goto-table-en, scan |
| `gemma4:e4b` | **on** | **48/54 (89%)** | **0** | 0 | **0.7 s** | goto-door, scan |
| `gemma4:e2b` | off | 42/54 (78%) | 0 | 6 | 0.2 s | goto-door, scan, stand, damp |
| `gemma4:e2b` | **on** | **51/54 (94%)** | 0 | 0 | 4.2 s | scan |

The thinking-off row for `e4b` reproduces the 2026-09-06 result exactly — 42/54, three
dashes, the same four failing cases — on different hardware and a newer Ollama. Thinking on
removes all three dashes and recovers `goto-chair` and `goto-table-en`. `gemma4:12b` is not
installed here and was not re-benched; its 51/54 on both sides of `32697991` stands.
`gemma4:e2b` — the planner the shipped `.env.g1-edu-agent.example` profile pins, with
`AGENT_PLANNER_THINKING=false` — was benched too because it is the small planner someone
actually runs.

**The mechanism is not quite the one in "Why it happens".** For `e4b` the thinking-on arm
costs no latency, and a direct probe explains why: sent the real planner prompt and schema
(`buildPlannerPrompt` + `toJsonSchema(PlanSchema)`) for `lauf zur Tür`, `geh zum Stuhl` and
the `scan` command, `gemma4:e4b` produced **0 characters of thinking** over `/v1` without
`reasoning_effort`, over native `think: true`, and over native `think: false` alike (it does
think, ~530 chars, on a short free-form prompt — so the planner prompt is what keeps it
from thinking). Yet `think: false` changes its answers (e.g. a `reasoning_` key instead of
`reasoning`, different token counts). So for `e4b` it is the `think: false` switch itself —
the chat template it selects — that costs the accuracy, not lost reasoning. For `e2b` the
thinking is real: ~20× the latency, and it buys back `stand`, `damp` and `goto-door`. Either
way, the fix at our layer is the same: do not send `think: false` to these models.

## Decision (2026-09-30)

**Option 2 — per-model thinking.** `AGENT_PLANNER_THINKING` now resolves per model:
`true`/`false` is an explicit operator override and wins; unset (or any other value) falls
back to a measured default — on for the models in `PLANNER_MODELS_THAT_THINK`
(`gemma4:e4b`, `gemma4:e2b`), off for everything else, including `gemma4:12b` and the code
default `gemma3:4b`.

Why:

- **Option 1 (leave it) ships a robot that walks blind or will not stand up.** The shipped
  g1-edu profile runs `gemma4:e2b` with thinking forced off; that is 42/54 with `stand` and
  `damp` failing every run. "12b is what ships" is true only for the GPU box.
- **The cost is small or zero.** `e4b` gains six cases and loses its dashes for no latency
  at all; `e2b` gains nine cases for ~4 s per plan on a laptop, well inside the 300 s
  planner budget and the ~10 s the profile already accepts for vision thinking.
- **12b keeps its fast path.** It is unaffected by thinking off, so it stays off and does
  not pay for thinking it does not need — the reason a global flip (thinking on for
  everything) was rejected.
- **An explicit choice still wins**, so an operator who wants e2b's 0.2 s over its
  accuracy can still set `AGENT_PLANNER_THINKING=false`.

Known side effect (found in review): Host mode's visitor answerer
(`agent-mode-controller.ts`, the `buildVisitorAnswerPrompt` call) also reads
`config.agentMode.plannerThinking`, so it inherits the per-model default. On the g1-edu
profile (`gemma4:e2b`) a visitor's spoken answer now thinks too; judging by the planner
numbers that adds a few seconds per answer on a laptop. Accepted: it is the same model and
the same flag the operator already controls, and `AGENT_PLANNER_THINKING=false` restores
the old behaviour for both. Not benched for answer quality.

What changed: `resolvePlannerThinking` and `PLANNER_MODELS_THAT_THINK` in
`robot-agent/src/config/config.ts` (the cost table sits there, next to
`DEFAULT_AGENT_MODEL`, which points at it); `Planner` takes a `thinking` dep so the bench
resolves it for the model it benches rather than for the configured one; the bench header
prints the resolved value per model; the `llm.ts` transport comment names the cost; the
g1-edu profile example no longer forces planner thinking off; `docs/agent-mode.md` lists
the key.

Confirmed on the branch: `REPEATS=3 npm run bench:planner -- gemma4:e4b` with
`AGENT_PLANNER_THINKING` unset now prints "planner thinking is ON for gemma4:e4b" and
scores 48/54, 0 dashes, 0.7 s median — the thinking-on row, reached by default.
`npm run typecheck` (src + scripts) and the robot-agent vitest suite (140 files, 2397
tests) pass.

## Acceptance Criteria

- [x] `gemma4:e4b` benched with `AGENT_PLANNER_THINKING=true` on `main`, score and median
      latency recorded next to the 42/54 and 51/54 rows above — this is what says whether
      thinking is in fact the cause rather than a plausible story
- [x] A decision from the three options is written down with its reason, in this file
- [x] Whatever the decision, the cost of thinking-off for small models is documented where a
      model is chosen (`DEFAULT_AGENT_MODEL` in `config.ts`, or the `llm.ts` transport comment)
- [x] `npm run typecheck` and the robot-agent suite pass

## Test Strategy

The bench is the instrument, and it is already honest about its own configuration since
TASK-226 (it loads `.env` and defaults to the configured planner model). Run:

```bash
cd robot-agent
REPEATS=3 npm run bench:planner -- gemma4:e4b                       # 42/54 expected
AGENT_PLANNER_THINKING=true REPEATS=3 npm run bench:planner -- gemma4:e4b
```

Needs Ollama on the local 5090 with `gemma4:e4b` pulled. No robot, no sim, no G1.

## Notes

Found while closing TASK-226 — its gate run is what turned this up. The A/B that isolates it
is in that task's closing section.
