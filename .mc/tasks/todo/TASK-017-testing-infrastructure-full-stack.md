---
id: TASK-017
aliases:
- TASK-017
title: Testing Infrastructure (Full Stack)
slug: testing-infrastructure-full-stack
status: backlog
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
- deferred
sprint: ''
depends_on:
- "[[TASK-001]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Testing Infrastructure (Full Stack)

## Description
Set up comprehensive testing infrastructure across frontend, server, and robot client.

## Details
**Full-Stack Feature spanning Frontend + Server + Robot**

### Frontend (`app/src/`)
- **Test framework**: Configure Vitest for unit testing
- **Component testing**: React Testing Library setup
- **API mocking**: MSW (Mock Service Worker) for API mocking
- **Test utilities**: Create `renderWithProviders`, `mockStore` helpers
- **Coverage**: Configure c8 for coverage reporting
- **Initial tests**: Auth, robots, tasks stores and components

### Server (`server/src/`)
- **Test framework**: Vitest or Jest configuration
- **API testing**: Supertest for HTTP endpoint testing
- **Database mocking**: Test database or Prisma mocking
- **Test utilities**: Auth helpers, request builders
- **Coverage**: Coverage reporting configuration

### Robot Client (`robot-agent/src/`)
- **Test framework**: Vitest or Jest configuration
- **Unit tests**: Tests for state management, telemetry generation
- **Tool tests**: Tests for navigation, manipulation tools
- **Mock A2A**: Mock server for A2A protocol testing

**Key Files:**
- Frontend: Create `app/vitest.config.ts`, `app/src/test/setup.ts`, `app/src/test/utils.tsx`, `app/src/mocks/handlers.ts`
- Server: Create `server/vitest.config.ts`, `server/src/__tests__/`
- Robot: Create `robot-agent/vitest.config.ts`, `robot-agent/src/__tests__/`

## Test Strategy
Meta: Ensure all test runners work with `npm test` in each package. Verify coverage reports generate. Test MSW intercepts API calls. Verify test utilities work. Ensure CI/CD integration possible.
%% mc-links: [[TASK-001]] %%
