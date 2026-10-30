---
id: "TASK-433"
aliases: []
title: "The API server survives a database timeout in a background job"
slug: "the-api-server-survives-a-database-timeout-in-a-background"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "huhn511"
projects: []
customers: []
tags: [core]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-30"
updated: "2026-10-30"
---

# The API server survives a database timeout in a background job

## Description

On 2026-10-29 at 23:36 the dev API server died. A database call in the
overdue-notification timer timed out, nobody caught the rejection, and Node 22
exits on an unhandled rejection. A failed database call in a background job must
be logged, and the next run must happen; it must never end the process. This task
catches the rejection in that timer and in every other server timer with the
same pattern, and adds a process-level logger for unhandled rejections.

Branch: `fix/task-433-the-api-server-survives-a-database-timeout-in-a-background`.

## Details

### Current state

- **The crash.** `PrismaClientKnownRequestError` P1008 "Socket timeout". The
  SQLite `server/prisma/dev.db` is 1.2 GB. Before it the log showed repeated
  "Error creating compliance log" (`server/src/routes/compliance-log.routes.ts:256`).
- **The fatal path:**
  - `server/src/services/NotificationWorkflowService.ts:388-401`,
    `startOverdueChecker()`;
  - the `setInterval` callback (`:390-392`) is
    `async () => { await this.checkAndMarkOverdue(); }`, with no catch;
  - the immediate first call (`:398-400`) has a `.catch` that logs;
  - `checkAndMarkOverdue()` (`:406`) calls
    `incidentNotificationRepository.markOverdue()`, which runs
    `prisma.incidentNotification.updateMany(...)`
    (`server/src/repositories/IncidentRepository.ts:587-589`);
  - a rejection there is unhandled, and Node 22's default
    `--unhandled-rejections=throw` exits.
- **No process-level handler.** `server/src/index.ts` registers only `SIGTERM`
  and `SIGINT` (`:261-262`). Nothing in `server/src` listens for
  `unhandledRejection` or `uncaughtException`.
- **Workaround on the lab PC.** `~/.local/bin/neodem-dev-up` (outside the repo)
  starts the server with `NODE_OPTIONS=--unhandled-rejections=warn`. The repo's
  `dev` script is `tsx watch src/index.ts` (`server/package.json:8`).
- **Audit, 2026-10-30.** `grep -rn "setInterval(\|setTimeout(" server/src`
  (tests excluded) gives 31 `setInterval` sites. The callbacks that start async
  work without a catch:
  - `services/SafetyService.ts:604`:
    `async () => { await this.sendHeartbeats(); }`. `sendHeartbeats()` (`:625`)
    awaits `robotManager.listRobots()` outside any try.
  - `services/ApprovalWorkflowService.ts:77` and `:83`:
    `() => this.checkSLACompliance()` (`:590`) and
    `() => this.escalateOverdueApprovals()` (`:651`). Both start with a
    repository query, and the returned promise is dropped.
  - `services/OversightService.ts:82`: `() => this.checkDueVerifications()` (`:391`).
  - `services/DeploymentMetricsService.ts:106` and `:112`:
    `async () => { await this.pollDeploymentMetrics(id); }` (`:156`) and
    `checkDeploymentThresholds(id)` (`:364`). Both start with
    `deploymentRepository.findById`.
  - `services/SyntheticDataService.ts:517`: an `async` callback that awaits
    `this.prisma.syntheticJob.findUnique(...)` with no try.
- **To confirm.** These use `void this.x()`. `void` does not catch, but each body
  opened with a `try` when read on 2026-10-30. Check that each catches
  everything:
  - `PatrolSchedulerService.ts:85`, `ProcessSchedulerService.ts:56`;
  - `SimFrameRecorder.ts:145` and `:150`, `ScanSessionService.ts:295`;
  - `jobs/patrol-photo-cleanup.ts:55`, `jobs/multipart-upload-sweep.ts:166`;
  - `jobs/control-lease-sweeper.ts:48`, `jobs/tour-transcript-cleanup.ts:67`.
- **Already safe** (`.catch` or a try in the callback):
  - `RobotManager.ts:1073`, `TaskDistributor.ts:72`, `AlertService.ts:281`;
  - `DigitalTwinService.ts:467`, `TeleoperationService.ts:2536` and `:2833`;
  - `jobs/telemetry-cleanup.ts:99`, `jobs/RetentionCleanupJob.ts:176`,
    `jobs/storage-cleanup.ts:145`.
- **Synchronous callbacks:** `TrainingOrchestrator.ts:207`,
  `SimulationService.ts:1267`, `robot-supervisor/RobotReadinessService.ts:409`,
  `websocket/index.ts:233` and `:349`. Check that none of them starts a promise
  it drops.
- The only `setTimeout(async` is `services/DeploymentService.ts:871`, and it has
  a try.

### Server

- `NotificationWorkflowService.startOverdueChecker()`: the interval callback
  catches and logs like the first call
  (`[NotificationWorkflowService] Error checking overdue:`). Both calls go through
  one small helper.
- Every call site in the audit list: catch and log at the call site
  (`.catch((err) => console.error('[<Service>] <job> failed:', err))`), or wrap
  the body in try/catch. A failing tick logs, and the next tick runs.
- `server/src/index.ts`: `process.on('unhandledRejection', …)` logs the reason
  with its stack. Put the handler in a small module (e.g.
  `server/src/utils/processHandlers.ts`), so a test can import it without
  starting the server.
  - In dev (`NODE_ENV !== 'production'`) it only logs and does not exit.
  - A registered handler replaces Node's default exit. So in production it must
    exit itself after logging (`process.exit(1)`), so Kubernetes restarts a
    broken pod. If the implementer decides otherwise, the reason goes into Notes.
- After this lands, `neodem-dev-up` on the lab PC can drop its `NODE_OPTIONS`.
  That script is outside the repo; say so in the PR.

### Key files

- `server/src/services/NotificationWorkflowService.ts`
- `server/src/services/SafetyService.ts`
- `server/src/services/ApprovalWorkflowService.ts`
- `server/src/services/OversightService.ts`
- `server/src/services/DeploymentMetricsService.ts`
- `server/src/services/SyntheticDataService.ts`
- `server/src/index.ts`
- `server/src/utils/processHandlers.ts` (new)
- `server/src/services/__tests__/NotificationWorkflowService.test.ts` (exists)

## Acceptance Criteria

- [ ] A `markOverdue()` that rejects on an interval tick is logged, the server
  keeps running, and the next tick runs.
- [ ] Every callback in the audit list catches and logs its async work. Each
  "to confirm" site was read, and Notes lists what was done for each.
- [ ] `server/src/index.ts` registers an `unhandledRejection` handler that logs
  the reason. In dev it does not exit. The production behaviour is written down.
- [ ] Vitest covers the overdue checker's failing tick, at least one other fixed
  timer, and the process handler in dev and in production.
- [ ] `cd server && npm run typecheck && npx vitest run` passes.

## Test Strategy

- `cd server && npm run typecheck && npx vitest run`.
- In `NotificationWorkflowService.test.ts`, use fake timers, make `markOverdue`
  reject on the interval tick, and assert that the error is logged and that the
  next tick calls it again. Vitest fails a run on an unhandled rejection, so an
  uncaught one fails the test by itself.
- The process handler: call it with a rejection reason. In dev it logs and does
  not call `process.exit`; with `NODE_ENV=production` it logs and calls
  `process.exit(1)`. Stub `process.exit`.
- On the lab PC: run the dev server without `NODE_OPTIONS` for a day.
  `~/.local/state/neodem/logs/dev-server.log` may show logged database errors,
  but the process does not exit.

## Notes

- Filed from the TASK-424 preparation on 2026-10-30. The P1008 itself (a 1.2 GB
  SQLite file under load) is a separate question and is not in scope here.
