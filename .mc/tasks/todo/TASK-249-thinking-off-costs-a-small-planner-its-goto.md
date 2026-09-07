---
id: "TASK-249"
aliases: []
title: "Turning thinking off costs a small planner its goto — decide, per model, whether that trade is wanted"
slug: "thinking-off-costs-a-small-planner-its-goto"
status: "todo"
priority: 3
owner: ""
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
updated: "2026-09-06"
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

## Acceptance Criteria

- [ ] `gemma4:e4b` benched with `AGENT_PLANNER_THINKING=true` on `main`, score and median
      latency recorded next to the 42/54 and 51/54 rows above — this is what says whether
      thinking is in fact the cause rather than a plausible story
- [ ] A decision from the three options is written down with its reason, in this file
- [ ] Whatever the decision, the cost of thinking-off for small models is documented where a
      model is chosen (`DEFAULT_AGENT_MODEL` in `config.ts`, or the `llm.ts` transport comment)
- [ ] `npm run typecheck` and the robot-agent suite pass

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
