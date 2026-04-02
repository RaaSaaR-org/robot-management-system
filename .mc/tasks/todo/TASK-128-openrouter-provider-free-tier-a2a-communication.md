---
id: TASK-128
aliases:
- TASK-128
title: OpenRouter Provider Integration — Free-Tier Model for A2A Communication
slug: openrouter-provider-free-tier-a2a-communication
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- ai
- a2a
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-02
updated: 2026-04-02
---



# OpenRouter Provider Integration — Free-Tier Model for A2A Communication

## Description

Add OpenRouter as an alternative LLM provider for the robot-agent's A2A communication. Use the free-tier model `stepfun/step-3.5-flash:free` (196B MoE, 256K context, $0 cost) via OpenRouter's OpenAI-compatible API. This enables zero-cost robot agent reasoning for development, demos, and low-volume use cases without requiring a Gemini API key.

## Details

### Current State

The robot-agent uses Google Gemini (`gemini-2.5-flash`) exclusively for all AI reasoning:
- **LLM init:** `robot-agent/src/agent/genkit.ts` — configures `@genkit-ai/googleai` plugin
- **Agent executor:** `robot-agent/src/agent/agent-executor.ts` — calls Genkit prompt with robot state + tools
- **Config:** `robot-agent/src/config/config.ts` — reads `GEMINI_API_KEY` from env
- **Server (CommandInterpreter):** `server/src/services/CommandInterpreter.ts` — uses `@google/generative-ai` directly (separate concern, not part of this task)

### Research Findings

- **OpenRouter** exposes an OpenAI-compatible API at `https://openrouter.ai/api/v1`
- **`stepfun/step-3.5-flash:free`** — StepFun's 196B MoE model (11B active), 256K context, $0/token, one of the most-used free models on OpenRouter
- **Genkit integration** is officially supported via `@genkit-ai/compat-oai` (OpenAI-compatible plugin), which accepts a custom `baseURL` — perfect for OpenRouter
- **Free tier limits:** ~20 req/min, lower priority queuing, no SLA. Fine for dev/demo, not for production

### Robot Agent

#### 1. Install dependency

```bash
cd robot-agent && npm install @genkit-ai/compat-oai
```

#### 2. Add OpenRouter provider to Genkit config

In `robot-agent/src/agent/genkit.ts`:
- Import `openAICompatible` from `@genkit-ai/compat-oai`
- Register the OpenRouter provider alongside the existing Google AI plugin:

```typescript
import { openAICompatible } from '@genkit-ai/compat-oai';

// Add to Genkit plugins array:
openAICompatible({
  name: 'openrouter',
  apiKey: config.openrouterApiKey,
  baseURL: 'https://openrouter.ai/api/v1',
  models: [
    { name: 'stepfun/step-3.5-flash:free' },
  ],
})
```

#### 3. Make the model configurable

In `robot-agent/src/config/config.ts`:
- Add `OPENROUTER_API_KEY` env var (optional)
- Add `LLM_PROVIDER` env var: `"gemini"` (default) or `"openrouter"`
- Add `LLM_MODEL` env var to override the model name (default: `gemini-2.5-flash` for gemini, `stepfun/step-3.5-flash:free` for openrouter)

#### 4. Switch model in agent executor

In `robot-agent/src/agent/genkit.ts` or `agent-executor.ts`:
- Select the model reference based on `LLM_PROVIDER` config
- When `openrouter`: use `openrouter/stepfun/step-3.5-flash:free` as model ref
- When `gemini` (default): use existing `googleAI.model("gemini-2.5-flash")`

#### 5. Update .env.example

In `robot-agent/.env.example`:
```env
# LLM Provider: "gemini" (default) or "openrouter"
LLM_PROVIDER=gemini

# Gemini (default)
GEMINI_API_KEY=your_gemini_key

# OpenRouter (alternative — free tier available)
OPENROUTER_API_KEY=your_openrouter_key
LLM_MODEL=stepfun/step-3.5-flash:free
```

### Key Files to Modify

- `robot-agent/src/agent/genkit.ts` — add OpenRouter plugin registration + model selection
- `robot-agent/src/agent/agent-executor.ts` — use configurable model reference
- `robot-agent/src/config/config.ts` — add new env vars
- `robot-agent/.env.example` — document new options
- `robot-agent/package.json` — add `@genkit-ai/compat-oai` dependency

### Out of Scope

- Server-side CommandInterpreter (stays on `@google/generative-ai` for now)
- App frontend changes (no UI for provider selection yet)
- Production deployment with OpenRouter (free tier is dev/demo only)

## Test Strategy

1. **With OpenRouter:** Set `LLM_PROVIDER=openrouter` and `OPENROUTER_API_KEY`, start robot-agent, send an A2A message via the app chat — verify the robot responds coherently
2. **With Gemini (default):** Ensure existing `GEMINI_API_KEY` setup still works unchanged when `LLM_PROVIDER` is unset or `gemini`
3. **Missing key handling:** Start with `LLM_PROVIDER=openrouter` but no `OPENROUTER_API_KEY` — should log a clear warning at startup
4. **Type check:** `cd robot-agent && npm run typecheck` passes
