---
id: "TASK-485"
aliases: []
title: "A robot without a connected agent reads as awaited on every page, and an unused robot type can be deleted"
slug: "a-robot-without-a-connected-agent-reads-as-awaited-on-every"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["robots", "demo", "ui", "datasets"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# A robot without a connected agent reads as awaited on every page, and an unused robot type can be deleted

## Description

TASK-477 put three "expected" robots on the demo fleet — a Unitree G1 with Dex3 hands,
an SO-101 and a MicroDuck — before their agents exist. A hands-on browser test of the
demo instance (main at 778e9d80, auth off, one online sim agent plus the three) showed
that only the fleet card and the page banner knew what an expected robot is. Everything
behind them still treated it as a robot that broke, and a few things were wrong for any
robot:

1. **Agent Mode** (`/agent`) opened on the expected G1 — the first G1 on the list — with
   a green LIVE tag, and fired five requests at
   `/api/robots/demo-g1-dex3/{voice/*, agent-mode, agent-mode/memory}` that answer 404.
   Its stop button read "STOPP"; every other screen says "Emergency stop".
2. **Every robot page** logged a console error: the production build opens
   `wss://api.neodem.io/telemetry/<id>` (and `/pointcloud/<id>`), a host hardcoded in
   `useTelemetryStream.ts` / `usePointCloudStream.ts` that no deployment serves.
3. **Opening a robot's Chat tab** sent `POST /api/a2a/conversation/create`, just by
   looking.
4. **Expected robots**: the card says "Never connected" while the Telemetry tab says
   "Last seen 15m ago" (the seed time); the mains-powered SO-101 offers "Send to charge"
   and its readiness list asks after "Left hand / Right hand"; the header offers
   Emergency stop, Send to charge and Return home, none of which can reach a robot that
   has no agent. The MicroDuck's model is "Pollen Robotics Microduck" while its robot
   type is named "Microduck", and nothing links the two.
5. **The dashboard** reads "Robots online 1 / 4", which says three robots are down.
6. A leftover robot type **"Unitree_G1"** (28 / 28, manufacturer Unknown, created by an
   import in October) shows in every robot-type picker. The API has `GET` and `POST
   /api/datasets/robot-types` only; `RobotTypeRepository.delete` exists and no route
   calls it.

## Details

### What was decided

- **One place says what a robot can be asked.** `app/src/features/robots/utils/robotTraits.ts`
  reads four facts off what the robot reports — never off its name or model:
  `hasAgent` (`robotProvisioning` is null), `connected` (not offline), `canCharge`
  (`powerSource` from telemetry or metadata is not `ac_powered`) and `hasHands` (the
  embodiment key `robotType`, the one that already picks the 3D model). The header menu,
  the tabs and the readiness list all read it.
- **An expected robot's tab says one sentence instead of showing controls that cannot
  work** (`AwaitingAgentState`): Overview's skill and quick-action panels, Teleop, Chat
  and the command panel of Activity. The header drops Emergency stop — there is no agent
  a stop could reach, the button could only fail — and its menu keeps Unregister. The
  fleet-wide stop is untouched.
- **Telemetry has one transport in every build.** The server has no per-robot telemetry
  or point-cloud socket; live frames already arrive on the app-wide event socket
  (`/api/a2a/ws`, derived from the API base or the page origin) and land in the robots
  store. So the dedicated socket is removed rather than re-pointed: the hooks prefer the
  broadcast and poll the API server while no frame is fresh — what dev and the demo
  build always did — and ask nothing while `enabled` is false (robot offline or
  expected).
- **Agent Mode binds only a robot with an agent.** Default: the robot the URL asked for,
  else an online one (a G1 first), else none. Picking an expected robot binds nothing —
  every child is idle on a null robot, so no agent endpoint is called — and the page
  says why. The header tag reads "Live" only for a bound robot that is online.
- **Chat creates its conversation on the first message**: `ConversationPanel` takes an
  `ensureConversation`, `RobotChatPanel` supplies it and reuses the robot's existing
  conversation.
- **Robot ↔ robot type is explicit first.** `server/src/services/robotTypeLink.ts`:
  `metadata.robotTypeId`, then `metadata.robotTypeName`, then the model equal to a
  type's name or model key, then the type's name as whole words inside the model
  (longest wins, a tie answers nothing). The demo fleet now writes
  `metadata.robotTypeName`. `GET /api/robots/:id/robot-type` exposes the link, the
  Details tab shows it with its widths, and a recording session uses it before it would
  invent a 0-wide type named after the model. The legacy model matchers in
  `TeleoperationService.resolveRobotTypeIdFromSession` keep their order, so which type
  an existing G1 or SO-101 session lands on does not change.
- **Robot types have no management screen** — they are created from the dataset page's
  expectations panel — so removal is an API route plus a script, as the brief allows:
  `DELETE /api/datasets/robot-types/:id` (owner-only) and
  `npm run remove:robot-type -- --base-url <url> --name <name>`.
- **Fleet count**: "Robots online" is measured against robots that have an agent, with
  the expected ones named in the hint.

### Not in this task

- The simulated robot's own data (battery, location, sensors) — a separate task.
- `Open control center` stays on an expected robot's page: the control center already
  says "Not connected" for it (TASK-477).

## Acceptance Criteria

- [x] Agent Mode opens on an online robot and never on one that is not connected; with
      none online it binds nothing and says so (`AgentModePage.test.tsx`).
- [x] Agent Mode calls no agent endpoint for an expected robot, and never shows "Live"
      for a robot whose agent is not connected (`AgentModePage.test.tsx`; browser: no
      request to `/api/robots/demo-g1-dex3/…` after picking it).
- [x] Agent Mode's stop button reads "Emergency stop" (`BlockTimeline.test.tsx`,
      `e2e/agent-mode.spec.ts`).
- [x] The telemetry and point-cloud hooks open no socket in a production build and
      request nothing while disabled (`telemetryTransport.test.tsx`; browser, production
      build: the only socket is `/api/a2a/ws` on the page origin).
- [x] Viewing the Chat tab creates no conversation; the first message does, once, and a
      reload reuses it (`RobotChatPanel.test.tsx`, `ConversationPanel.lazy.test.tsx`;
      browser: `conversation/create` only after Enter).
- [x] An expected robot's Telemetry tab does not print "Last seen"; its Teleop, Chat,
      Overview and Activity tabs offer nothing that needs an agent; its header has no
      Emergency stop and a menu with Unregister only (`unconnectedRobot.test.tsx`).
- [x] A mains-powered robot is not offered "Send to charge", connected or not, and a
      robot whose embodiment has no hands has no hand rows on its readiness list unless
      its agent reports hand health (`unconnectedRobot.test.tsx`).
- [x] The MicroDuck resolves to the robot type "Microduck" (15 / 15), by its metadata and
      by its model alone (`robotTypeLink.test.ts`,
      `robot-type-removal.integration.test.ts`, `TeleoperationService.test.ts`), and the
      Details tab shows it.
- [x] The dashboard counts online robots against robots that have an agent and names the
      expected ones (`FleetStats.test.tsx`).
- [x] `DELETE /api/datasets/robot-types/:id` is owner-only, deletes an unused type,
      answers 409 naming the referencing datasets, embodiments and skills, and never
      deletes a standard type (`robot-type-removal.integration.test.ts`,
      `datasets-expectations-routes.test.ts`).
- [x] `npm run remove:robot-type` removes a type by exact name through the public API,
      reports `absent` on a second run and `refused` with the server's reason
      (`removeRobotType.test.ts`, the integration test above).
- [x] Documented: `docs/demo-fleet.md`, `app/src/features/robots/AGENTS.md`.

## Notes

- Gates: server `npm run typecheck` + `npx vitest run`; app `npx tsc --noEmit`,
  `npx vitest run`, `npm run build`, `VITE_DEMO_MODE=true npm run build`,
  `npx playwright test e2e/agent-mode.spec.ts e2e/app-routes.spec.ts`.
- Browser: scratch server + app + a sim agent, Chromium at 1280x720 and 1440x900, dev
  build and production build.
- After deploy, on the live instance: run `npm run seed:demo-fleet -- --base-url <url>`
  once more (writes `metadata.robotTypeName` on the three rows), then
  `npm run remove:robot-type -- --base-url <url> --name Unitree_G1`.
- `write-route-authorization.test.ts` counts write routes; this task raises the count by
  one (387 → 388). A PR that adds a route of its own will conflict on that line.
