---
id: TASK-015
aliases:
- TASK-015
title: NL Command Interpretation (Full Stack)
slug: nl-command-interpretation-full-stack
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
sprint: ''
depends_on:
- "[[TASK-001]]"
- "[[TASK-007]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---




# NL Command Interpretation (Full Stack)

## Description
Implement natural language command interpretation with LLM integration, safety classification, and command history.

## Details
**Full-Stack Feature spanning Frontend + Server + Robot**

### Frontend (`app/src/features/command/`)
- **Wire to Server**: Update `commandApi.ts` to call server interpretation API instead of mock
- **Command UI**: `CommandBar`, `CommandPreview`, `CommandConfirmation` already exist - wire to real API
- **Command History**: Ensure `CommandHistory` component fetches from server API

### Server (`server/src/`)
- **Command routes**: `POST /api/command/interpret`, `GET /api/command/history`
- **CommandInterpreter**: LLM integration (OpenAI/Anthropic) for NL interpretation
- **Safety classification**: Classify commands as safe/caution/dangerous
- **Confidence scoring**: Return confidence level (0-1) for interpretations
- **Command history**: Store and retrieve command history with pagination

### Robot Client (`robot-agent/src/`)
- **Existing capability**: Already has Genkit/Gemini integration in `agent/agent-executor.ts`
- **Server delegation**: Server can either interpret centrally or delegate to robot's Genkit
- **Command execution**: Robot executes interpreted commands via existing tools

**Key Files:**
- Frontend: `app/src/features/command/api/commandApi.ts` - wire to server
- Server: Create `server/src/routes/command.routes.ts`, `server/src/services/CommandInterpreter.ts`
- Robot: `robot-agent/src/agent/agent-executor.ts` - already handles NL via Genkit

## Test Strategy
Frontend: Test command submission, test interpretation display, test history loading. Server: Test LLM interpretation, test confidence scores, test safety classification, test timeout handling. Robot: Test command execution via tools.

## Completion Notes
Implemented with Gemini 2.0 Flash (not OpenAI/Anthropic as originally suggested). Server routes at `server/src/routes/command.routes.ts` include `POST /interpret`, `GET /history`, `GET /:id`, `PATCH /:id/status`, `DELETE /:id`. `CommandInterpreter` service uses Google Generative AI with structured schema output and keyword-based fallback. `CommandInterpretation` Prisma model stores all fields. Frontend `commandApi.ts` calls real server endpoints (no mocks). Minor remaining gap: `robotName` in history response uses `robotId` as fallback instead of resolving the actual robot name.
%% mc-links: [[TASK-001]] [[TASK-007]] %%
