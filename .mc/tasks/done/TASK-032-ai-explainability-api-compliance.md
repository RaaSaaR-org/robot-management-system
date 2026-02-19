---
id: TASK-032
aliases:
- TASK-032
title: AI Explainability API (Compliance)
slug: ai-explainability-api-compliance
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- compliance
sprint: ''
depends_on:
- "[[TASK-015]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# AI Explainability API (Compliance)

## Description
Implement AI decision explainability and transparency per AI Act Art. 13 and Art. 50.

## Details
**Regulatory Compliance Feature: AI Act Art. 13, Art. 50**

### Robot Agent (`robot-agent/src/`)
- **Decision explanation generation**:
  - Capture input factors for each decision
  - Extract decision logic from Genkit
  - Calculate and report confidence scores
  - Track alternatives considered
- **AI disclosure**: Audio/visual indicator when AI is active

### Server (`server/src/`)
- **Explainability API** (Art. 13(1)):
  - GET /api/decisions/:id/explanation
  - Returns: input_factors, decision_logic, confidence_score, alternatives
- **Performance metrics** (Art. 13(3)(b)):
  - Precision/recall metrics
  - Error rates tracking
  - Drift indicators
- **Documentation endpoints** (Art. 13(3)(a)):
  - Intended purpose
  - Accuracy metrics
  - Known limitations
  - Human oversight requirements
- **Limitation disclosure** (Art. 13(3)(c)):
  - Operating conditions
  - Environmental constraints
  - Population performance variations

### App (`app/src/features/explainability/`)
- **Decision viewer**: Visualize AI decision factors
- **Performance dashboard**: Metrics and drift indicators
- **Documentation portal**: Access system documentation

**Key Files:**
- Robot: Create `robot-agent/src/ai/explainability.ts`
- Robot: Update `robot-agent/src/agent/agent-executor.ts` for explanation capture
- Server: Create `server/src/services/ExplainabilityService.ts`
- Server: Create `server/src/routes/explainability.routes.ts`
- App: Create `app/src/features/explainability/` feature module

## Test Strategy
Test explanation generation for all decision types. Test confidence score calculation. Test alternatives tracking. Test performance metrics accuracy. Test AI disclosure indicator.

## Notes
%% mc-links: [[TASK-015]] %%
