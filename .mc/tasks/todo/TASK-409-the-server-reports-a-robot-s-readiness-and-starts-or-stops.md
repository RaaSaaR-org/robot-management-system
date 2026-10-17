---
id: "TASK-409"
aliases: []
title: "The server reports a robot's readiness and starts or stops its robot side through the supervisor"
slug: "the-server-reports-a-robot-s-readiness-and-starts-or-stops"
status: "in-progress"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1", "teleop", "safety", "compliance"]
sprint: ""
parent: ""
depends_on: ["[[TASK-403]]", "[[TASK-405]]"]
spe: 8
effort: "high"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# The server reports a robot's readiness and starts or stops its robot side through the supervisor

## Description

The readiness facts are split between the robot supervisor (TASK-403: link, bridge, sidecar and agent processes) and the agent (TASK-405: sidecar, mode, arms, hands, lease, camera, and the "why not following" reason). Neither is reachable from the browser, and when the agent is down only the supervisor can say why.

The server merges both into one readiness snapshot. It broadcasts the snapshot to every browser of the tenant, so the headset and the desktop see the same state. It also proxies Start/Stop of the robot side to the supervisor, with role checks, lease checks and an audit entry.

## Details

### Current state
- **Supervisor (TASK-403)** on `127.0.0.1:8766`, bearer `ROBOT_SUPERVISOR_TOKEN`:
  - `GET /status` → `{robotId, profile, robot, sidecarMode, overall, steps[{id,state,owned,pid,startedAt,detail,checks}], lastBase, at}`
  - `POST /start {mode}`, `POST /stop`, `POST /sidecar/mode {mode, confirm}`, `POST /steps/:id/adopt|leave`, `POST /lan/up`, `POST /estop`
  - `GET /logs/:proc?tail=`, `GET /logs/:proc/stream` (SSE)
- **Agent (TASK-405):** `GET /api/v1/robots/:id/readiness` → `{robotId, at, simulated, sidecar, base, arms, hands, lease, camera, telemetrySynthetic, reason:{code,severity,text}}`.
- **Existing server proxies to copy:**
  - `server/src/routes/base-mode.routes.ts:161`: `GET/POST /api/robots/:id/base-mode`, with viewer/member roles, lease passthrough and a compliance audit (TASK-398).
  - `server/src/routes/control-lease.routes.ts:216`: `GET /api/robots/:id/control-lease`.
- **WS:**
  - `server/src/websocket/index.ts` subscribes service emitters and calls `deliverFor(message, tenantKey)`.
  - Control-lease events use `onControlLeaseTransition` (~l.165).
  - There is no per-topic subscription: every identified socket of the tenant receives the event.
- **Robot registration:** `POST /api/robots/register {robotUrl}`.
- **Wrong text today:** with the agent up but the sidecar down, `GET /api/robots/g1-edu-4/base-mode` returns `capability.gate:"unknown"` and the app says "Mode control is off on this robot's sidecar".

### Server
**Configuration**
- Env `ROBOT_SUPERVISORS=g1-edu-4=http://127.0.0.1:8766[,<robotId>=<url>]` and `ROBOT_SUPERVISOR_TOKEN`.
- Both are documented in `server/.env.example`. Unset means no bringup features, and the readiness snapshot shows `bringup: null`.

**`SupervisorClient`** (new `server/src/services/robot-supervisor/SupervisorClient.ts`)
- Typed calls for the supervisor routes above, with a 2 s timeout and the bearer token.
- An SSE log stream passthrough.

**`RobotReadinessService`** (new `server/src/services/robot-supervisor/RobotReadinessService.ts`)
- **What it polls:** each robot that has a supervisor, an active teleop session, or a readiness request in the last 30 s (a "watch window"). For each, at 1 Hz, it reads supervisor `/status` and agent `/readiness` (agent URL from the robot record).
- **Snapshot shape:**
```
RobotReadiness = {
  robotId, at,
  agent: { reachable: boolean, error: string|null, readiness: AgentReadiness|null },
  bringup: SupervisorStatus|null,
  reason: { code, severity, text, source: 'server'|'agent' }
}
```
- **Server-level reasons** take precedence, in this order:
  1. `bringup_stopped`: "Robot side is stopped. Press Start."
  2. `bringup_failed:<step>`: the step's `detail`, e.g. "robot cable unplugged or robot off"
  3. `bringup_foreign:<step>`: "An old <bridge> process is running (pid N). Adopt or leave it."
  4. `agent_unreachable`: "Robot agent is not answering."

  Otherwise the agent's reason is used, with `source:'agent'`.
- **Emission:** `robot:readiness` on change, compared with deep-equal and ignoring `at`, and at least every 5 s while watched.

**Routes** (new `server/src/routes/robot-bringup.routes.ts`, mounted with `...protect`):
- `GET /api/robots/:id/readiness` → `RobotReadiness`. Viewer role. It opens or extends the watch window.
- `GET /api/robots/:id/bringup` → `SupervisorStatus`, or 404 `{code:'no_supervisor'}`.
- `POST /api/robots/:id/bringup/start {mode:'read_only'|'arm_sdk', confirm?: true}`. Operator or admin role.
  - `mode:'arm_sdk'` additionally requires `confirm:true` **and** a control lease held by the caller (same check as base-mode POST). Otherwise 409 `{code:'lease_required'}`.
  - After the agent step is ok, the robot is registered if it is missing (`POST /api/robots/register` logic, called in-process).
- `POST /api/robots/:id/bringup/stop`. Operator or admin.
  - Answers `{status, baseMode}`, so the UI can offer "Limp first?" through the existing base-mode route. Stop itself never changes the FSM.
- `POST /api/robots/:id/bringup/sidecar-mode {mode, confirm:true}`. Operator or admin, plus the lease for arm_sdk.
- `POST /api/robots/:id/bringup/steps/:step/(adopt|leave)`. Operator or admin.
- `POST /api/robots/:id/bringup/lan-up`. Operator or admin.
- `GET /api/robots/:id/bringup/logs/:proc?tail=200` and `GET …/logs/:proc/stream` (SSE passthrough). Operator or admin.
- **Audit:** every POST writes a compliance entry with the actor, robot, action, mode and result.

**WebSocket** (`server/src/websocket/index.ts`)
- Add **one new subscription block** after the existing teleop block, for `robot:readiness` → `{type:'robot:readiness', data: RobotReadiness, timestamp}`, delivered to the robot's tenant like the other robot events.
- Do not touch the teleop `typeMap` (TASK-408 owns it).

**Base-mode text fix.** `GET /api/robots/:id/base-mode` adds `sidecarReachable` (taken from the agent readiness when cached), so the app can say "sidecar not reachable" instead of "mode control is off". The app text change itself is in TASK-411.

### Key files
- server/src/services/robot-supervisor/{SupervisorClient.ts, RobotReadinessService.ts} (new) + tests
- server/src/routes/robot-bringup.routes.ts (new) + test
- server/src/app.ts (mount)
- server/src/websocket/index.ts (one new subscription block)
- server/src/routes/base-mode.routes.ts (`sidecarReachable` field)
- server/.env.example
- docs/api.md (new routes and event)

## Decisions
- **D1 The server merges readiness; it does not compute it twice.** The agent owns robot-level reasons. The server adds only what the agent cannot know: processes and its own reachability. Rejected: a second rule table on the server.
- **D2 Poll only robots that are watched.** Rejected: polling every robot always, which costs a lot of HTTP for robots nobody looks at.
- **D3 arm_sdk needs the caller's lease and a confirm flag.** read_only start/stop needs only the operator role. read_only cannot move anything; arm_sdk is the motion path.
- **D4 The supervisor URL comes from server env**, not from the agent, because the agent may be the thing that is down.
- **D5 A tenant broadcast with no per-topic subscriptions**, matching the existing socket. The payload is small (about 2 KB at ≤1 Hz).

## Acceptance Criteria
- [ ] With a fake supervisor and a fake agent:
  - all-ok yields the agent's reason with `source:'agent'`;
  - a stopped bringup yields `bringup_stopped`;
  - a failed link step yields its detail;
  - an unreachable agent with a ready bringup yields `agent_unreachable`.
- [ ] `robot:readiness` is emitted on change and at least every 5 s while watched, and stops 30 s after the last request when no session is active.
- [ ] `POST …/bringup/start {mode:'arm_sdk'}` without the caller's lease → 409 `lease_required`; without `confirm` → 400. A viewer gets 403. Each POST writes one compliance entry.
- [ ] Start registers a missing robot once the agent step is ok (test with a mocked register).
- [ ] With `ROBOT_SUPERVISORS` unset, readiness still works with `bringup:null`, and the bringup routes return 404 `no_supervisor`.
- [ ] Live: a branch server on a free port, with `ROBOT_SUPERVISORS` pointing at a supervisor running the `sim-g1-edu-dev.yaml` profile from TASK-403 (domain 42, own ports), starts and stops the sim robot side, and `/api/a2a/ws` shows `robot:readiness` transitions.
- [ ] `npm run typecheck` and vitest pass.

## Test Strategy
- **vitest:** fake HTTP servers for the supervisor and agent, plus supertest for the routes (roles, lease and confirm), the readiness merge table, and the emission cadence with fake timers.
- **Live:** the sim profile only. Never point `ROBOT_SUPERVISORS` at a supervisor running the real `g1-edu-4.yaml` profile during development.

## Safety constraints (binding for this task)
- Never set `G1_READ_ONLY=0`, and never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`.
- Never `kill -9` / SIGKILL a sidecar. Stop it with SIGTERM and let it ramp down.
- Starting or stopping services never commands motion and never switches the FSM. Mode changes go only through the existing confirmed, lease-checked base-mode route.
- No DDS publishing on domain 0 in development or tests. Use the sim on domain 42 / `lo`.
- Never run `xr_teleoperate` and the arm_sdk sidecar together.
- The E-stop stays reachable: B/Y and the two-hand pinch in VR, and a visible E-STOP on the desktop session page.
- Development and tests use the sim stack only: the sim agent :41246 and sim sidecar :8777, or branch builds on free ports. Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack.
