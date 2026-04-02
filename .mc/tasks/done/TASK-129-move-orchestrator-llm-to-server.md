---
id: TASK-129
aliases:
- TASK-129
title: Move Orchestrator LLM from Client to Server
slug: move-orchestrator-llm-to-server
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- security
- ai
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-02
updated: 2026-04-02
---


# Move Orchestrator LLM from Client to Server

## Description

Move the LLM-powered orchestrator (intelligent agent routing) from client-side browser code to the server. Currently the OpenRouter API key is exposed in localStorage and the orchestrator calls OpenRouter directly from the browser. The server already has the `/a2a/message/orchestrate` endpoint and `ConversationManager.selectAgentForMessage()` — just needs an LLM call injected before the keyword fallback.

## Details

### Current State

- `app/src/features/a2a/services/orchestrator.ts` — calls OpenRouter from browser
- `app/src/features/a2a/components/ApiKeyDialog.tsx` — user pastes API key manually
- API key stored in `localStorage` (security risk)
- `server/src/services/ConversationManager.ts` — has `selectAgentForMessage()` with keyword matching

### Server

Add LLM agent selection in `ConversationManager.selectAgentForMessage()`:
- If `OPENROUTER_API_KEY` env var is set: call OpenRouter to select best agent
- If no key: fall back to existing keyword matching
- Error handling + 5s timeout
- No new dependencies (use `fetch`)

Update `server/.env.example` with `OPENROUTER_API_KEY` and `ORCHESTRATOR_MODEL`.

### Frontend

- Delete `app/src/features/a2a/services/orchestrator.ts` LLM logic
- Delete `app/src/features/a2a/components/ApiKeyDialog.tsx`
- Remove `geminiApiKey` from store, hooks, and types
- Simplify `sendMessage()` in orchestration mode to always use backend endpoint
- Remove API key dialog from OrchestratorChatPage, A2APage, A2ALayout

## Test Strategy

1. Server + app typechecks pass
2. Without `OPENROUTER_API_KEY`: orchestrator uses keyword fallback
3. With `OPENROUTER_API_KEY`: orchestrator uses LLM selection
4. No ApiKeyDialog needed — works out of the box
5. Direct robot chat unchanged
