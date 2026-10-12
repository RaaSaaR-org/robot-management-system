---
id: "TASK-373"
aliases: []
title: "A2A pages do not crash when the API answers without their list"
slug: "a2a-pages-do-not-crash-when-the-api-answers-without-their"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# A2A pages do not crash when the API answers without their list

## Description

Eight `e2e/app-routes.spec.ts` cases (`/a2a/agents`, `/a2a/agents/Demo%20Agent`,
`/a2a/tasks`, `/a2a/events`, desktop and phone) fail locally on `main` with the
error boundary "Cannot read properties of undefined (reading 'length')". CI is
green only because nothing listens on `:3001` there.

## Details

**Current state / root cause.** The A2A reads are POSTs
(`/api/a2a/agent/list`, `task/list`, `events/get`, `conversation/list`,
`message/list`). The demo build has no MSW handler for them and the GET-only
catch-all in `app/src/mocks/handlers.ts` does not see them, so they leave the
page through `vite preview`'s `/api` proxy to `localhost:3001`. In CI that is a
proxy error (500), axios rejects, the store's `catch` runs. On a machine where
another app answers on `:3001` with a 200 HTML page, `app/src/features/a2a/api/a2aApi.ts`
returns `response.data.agents` — `undefined` — the store saves it as
`registeredAgents`, and `A2ATabs.tsx` crashes on `.length`.

### Frontend

- `app/src/features/a2a/api/a2aApi.ts` — new `readList()` validates that the
  body carries the list; every list endpoint throws otherwise, so the store's
  existing error path handles a wrong body instead of storing `undefined`.
- `app/src/mocks/handlers.ts` — demo handlers for the five A2A list POSTs
  (empty lists: the demo has no A2A peers), so the demo never leaves the page.

**Key files:** `app/src/features/a2a/api/a2aApi.ts`,
`app/src/mocks/handlers.ts`,
`app/src/features/a2a/api/__tests__/a2aApi.test.ts`.

## Acceptance Criteria

- [x] Every A2A list endpoint rejects when the body lacks its list (an HTML page, `null`, an error envelope).
- [x] The demo build answers the five A2A list POSTs itself.
- [x] The 10 `/a2a` cases of `app-routes.spec.ts` pass with a foreign app answering on `:3001`.

## Test Strategy

- `npx vitest run src/features/a2a` — the new `a2aApi.test.ts` fails without the guard (10 cases).
- `PLAYWRIGHT_PORT=4187 npx playwright test e2e/app-routes.spec.ts -g "/a2a"` with something serving HTML on `:3001`.

## Notes

Checked a sub-agent's claim that CI may not run vitest: false.
`.github/workflows/check.yml` runs `npm test` (`vitest run`) in the server,
app and robot-agent jobs.
