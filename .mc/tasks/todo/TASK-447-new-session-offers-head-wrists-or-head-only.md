---
id: "TASK-447"
aliases: []
title: "New session offers Head + wrists or Head only"
slug: "new-session-offers-head-wrists-or-head-only"
status: "review"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: "[[TASK-439]]"
depends_on: ["[[TASK-441]]"]
spe: 2
effort: "low"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# New session offers Head + wrists or Head only

## Description

When the chosen robot has wrist cameras, the New-session form asks which cameras the session
records — **Head + wrists** (default) or **Head only** — and creates the session with that
choice. For a robot without wrist cameras the form is unchanged.

## Details

### Current state

- `app/src/features/datacollection/pages/NewSessionPage.tsx` (tests in
  `pages/__tests__/NewSessionPage.test.tsx`) creates a session for the chosen robot.
- `app/src/features/robots/hooks/useRobotCameras.ts` polls `GET /api/robots/:id/cameras`
  (`{cameras, source, detail?, configured?}`; `configured` = every camera the robot is set
  up to serve, may be absent → use `cameras`).
- From TASK-441: the create call accepts `cameras?: string[]`;
  `app/src/features/datacollection/utils/cameras.ts` has `robotWristCameras(list)`,
  `cameraSetLabel(...)`, `WRIST_CAMERAS`. `cameras: null`/absent = head camera only.
- Design: simple, the existing form's controls (SegmentedControl / radio cards used
  elsewhere in the form), brand tokens per `docs/brand.md`.

### Frontend

1. Once a robot is chosen, read its camera list (`useRobotCameras`); if
   `robotWristCameras(list)` is non-empty, show a "Cameras" control with two options:
   **Head + wrists** (default; hint "Head view plus left and right wrist views, all
   recorded") and **Head only** (hint "Like a robot without wrist cameras").
2. Head + wrists → create with `cameras: ['head_camera', ...robotWristCameras(list)]`;
   Head only → create without `cameras`.
3. No wrist cameras, or the list not loaded / failed → no control, create without `cameras`
   (exactly today's request body).
4. A configured but currently offline wrist camera still offers Head + wrists, with a
   one-line note "Left wrist camera is offline right now" (the session page blocks Record
   until it is back — TASK-442).

## Acceptance Criteria

- [ ] Robot without wrist cameras: form and create request identical to `main`.
- [ ] Robot with both wrist cameras: control shown, Head + wrists default; the request
      carries the three names head-first; Head only sends no `cameras`.
- [ ] App typecheck + vitest green; the form fits at phone width.

## Test Strategy

Vitest on `NewSessionPage` with mocked camera lists (none, both wrists, `configured` with one
offline) asserting the control and the create body. Playwright MCP: create one session of
each kind against the dev sim with wrist cameras (TASK-440), screenshot the form.
