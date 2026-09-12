---
id: "TASK-293"
aliases: []
title: "Fail unimplemented action types instead of reporting them completed"
slug: "fail-unimplemented-action-types-instead-of-reporting-them-completed"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, app, robot-agent]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Fail unimplemented action types instead of reporting them completed

## Description

The robot agent returns `{ success: true }` for every action type it has no code for, and the UI builds every automation out of exactly those types, so a user-created process is a list of 2-second sleeps recorded as completed work. This task makes unimplemented action types fail honestly and lets the automation form pick a real action type with its parameters.

## Details

### Current state

`robot-agent/src/robot/TaskQueue.ts:295-301` is `case 'inspect': case 'custom': default:` — it logs "Simulating", sleeps 2000 ms and returns `{ success: true, message: 'Completed <type>' }`. `executeNext` (`:232-243`) reports that as `completed` via `PUT /api/processes/tasks/:id/status` (`:193`) → `server/src/routes/process.routes.ts:415` → `server/src/services/TaskDistributor.ts:425` → `server/src/repositories/RobotTaskRepository.ts:226`, which writes status `completed` plus `completedAt` (`:228`). `ProcessManager.onStepCompleted` (`server/src/services/ProcessManager.ts:432-465`) then marks the step completed and advances the run.

**The three lists, and the diff that is the spec:**

- **Server union** (`server/src/types/process.types.ts:15-24`), 9: `move_to_location`, `pickup_object`, `drop_object`, `wait`, `inspect`, `charge`, `return_home`, `execute_skill`, `custom`.
- **Robot agent union** (`robot-agent/src/robot/types.ts:442-450`), 8: the same minus `execute_skill`. Genuinely implemented in `TaskQueue`: `move_to_location`, `pickup_object`, `drop_object`, `charge`, `return_home` (delegated to `CommandExecutor`) and `wait` (`:289-293`, a real sleep of `durationMs`). Faked: `inspect`, `custom`, plus anything else via `default`.
- **App**: offers none at all. `app/src/features/processes/api/tasksApi.ts:119` and `:126` hardcode `actionType: 'custom', actionConfig: {}`, because `CreateProcessModal.tsx:43` and `:89` collect step **names** only; the app has no action-type type.

**9 declared, 6 executed, 0 offered.** Symptom: an automation created in the UI runs as N sleeps, each PUT as `completed`, and `ProcessesPage`/`TaskDetailPanel` show a green 100 % run for work no robot did.

Three things are more precise than they first appear, and they shape the fix:

- **`execute_skill` never reaches the agent.** It exists only on the server; `ProcessManager.ts:337` routes it to `SkillExecutionService`. So today's liars are `inspect`, `custom`, and any string outside the agent's 8-member union.
- **A stepless automation is worse than a lying one.** When the user adds no steps, `tasksApi.ts:122-128` invents a single `custom` step named after the automation — so even a zero-step automation gets one fake completed step.
- **Not every branch is dishonest.** `wait` (`TaskQueue.ts:289-293`) really sleeps `durationMs` and says so, and `move_to_location`/`pickup_object` already fail honestly when their config is missing (`:269`, `:277`). The dishonesty is confined to the `default` fallthrough — the simulator itself is fine.

The app **does** have a failure rendering path: `TaskTimeline.tsx:67` (`StatusTag`) and `:80` (`step.error` in signal-stopped), and `TaskDetailPanel.tsx:158-164` for the run-level error. The real gap is that the app's `ProcessStepStatus` (`app/src/features/processes/types/process.types.ts:28-34`) is missing the server's `queued` and `cancelled`, which renders an empty label.

### Robot Agent

`robot-agent/src/robot/TaskQueue.ts`, `executeAction` (`:262-303`):

1. Replace the `case 'inspect': case 'custom': default:` fallthrough (`:295-301`) with explicit branches. `case 'inspect':` and `case 'custom':` return immediately — **no 2000 ms sleep** — with `{ success: false, message: "Action type '<type>' is not implemented by this robot agent" }`. Agent Mode's real inspect (`robot-agent/src/agent-mode/block-executor.ts:2471` → `patrol.ts:1102`) needs a patrol host and a `checkpointId` that a pushed task does not carry; wiring it is out of scope.
2. After the switch, add a compile-time exhaustiveness guard (`const _exhaustive: never = task.actionType;`) so a member added to the union in `robot-agent/src/robot/types.ts:442-450` breaks `npm run typecheck` instead of silently returning success, and keep a **runtime** guard for strings outside the union — the server union has 9 members, the agent's 8 — returning the same failure result naming the received value.
3. Export `const IMPLEMENTED_ACTION_TYPES = ['move_to_location','pickup_object','drop_object','wait','charge','return_home'] as const` (named export; the file header JSDoc is already present) for the runtime guard and the tests. The app cannot import it (separate package) and keeps its own copy.
4. Leave every implemented branch untouched: `moveTo`/`pickup`/`drop`/`goToCharge`/`returnHome` keep delegating to `CommandExecutor`, and `wait` keeps its real sleep. **The simulator keeps running exactly as before**; it only stops inventing outcomes for actions it has no code for.
5. **Do not reject unknown action types at the push endpoint** (`robot-agent/src/api/rest-routes.ts:671-690`). A non-2xx there is a dispatch failure for `server/src/services/TaskDistributor.ts:357` and never reaches `ProcessManager`. The failure must travel the normal status path (`TaskQueue.ts:244-246`, `reportTaskStatus(task.id, 'failed', undefined, result.message)`) so `ProcessManager.onStepCompleted` → `handleStepFailure` (`ProcessManager.ts:466-520`) records it on the step and the UI can show it.

### Frontend

1. `app/src/features/processes/types/process.types.ts`
   - Add `export type StepActionType = 'move_to_location' | 'pickup_object' | 'drop_object' | 'wait' | 'charge' | 'return_home'` (only what the agent executes) and `PROCESS_STEP_ACTION_LABELS: Record<StepActionType, string>` beside `PROCESS_STEP_STATUS_LABELS` (`:300`).
   - `CreateProcessStep` (`:89`) gains `actionType: StepActionType; actionConfig: Record<string, unknown>`.
   - `ProcessStepStatus` (`:28-34`) and `PROCESS_STEP_STATUS_LABELS` (`:300-306`) gain `queued` and `cancelled`: the server sends both (`server/src/types/process.types.ts:111-119`; `ProcessManager.ts:327` sets every dispatched step to `queued`) and `TaskTimeline.tsx:67` renders an empty `StatusTag` for them today. `types/index.ts` uses `export *`, so no barrel edit.
2. `app/src/features/processes/api/tasksApi.ts` — in `createTask` map `actionType: step.actionType, actionConfig: step.actionConfig` (`:114-121`) instead of `'custom'`; **delete the invented single-`custom`-step fallback (`:122-128`)** and throw `new Error('An automation needs at least one step')` when `steps` is empty.
3. `app/src/features/processes/components/CreateProcessModal.tsx` — every step row (`:149-169`) gets a `Select` of `PROCESS_STEP_ACTION_LABELS` next to the name `Input`, plus the one parameter its type needs:
   - `move_to_location`: a zone `Select` from `useZones()` (`app/src/features/fleet/hooks/useZones.ts:119`); store `actionConfig.location = { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2), floor: zone.floor, zone: zone.name }` — the same centre derivation as `robot-agent/src/tools/navigation.ts:32-40`. **Coordinates, not a name**: `TaskQueue.ts:265` casts `actionConfig.location` to `RobotLocation` and `CommandExecutor.ts:167` calls `location.x.toFixed()`.
   - `pickup_object`: text `Input` → `actionConfig.objectId`.
   - `wait`: number `Input` in seconds → `actionConfig.durationMs`.
   - `drop_object` / `charge` / `return_home`: no parameters.
   - `handleSubmit` (`:74-79`, `FieldErrors` at `:29-33`) blocks submit on zero steps, or on a step whose required parameter is empty; drop the `:146` hint about running as a single action.

Deferred on purpose: `inspect`, `custom` and `execute_skill` are not offered; no per-step robot pin; no editing steps after creation.

### Server

No change. The server stores and forwards whatever `actionType` it is given, and `execute_skill` never reaches the agent (`ProcessManager.ts:337`).

**Key files:**
- `robot-agent/src/robot/TaskQueue.ts` — replace the default-success branch, add the exhaustiveness guard
- `robot-agent/src/robot/types.ts` — read the `StepActionType` union at `:442-450`
- `robot-agent/src/robot/__tests__/TaskQueue.test.ts` — add `executeAction`/reporting tests
- `app/src/features/processes/types/process.types.ts` — `StepActionType`, action labels, `queued`/`cancelled` statuses
- `app/src/features/processes/api/tasksApi.ts` — send the real `actionType`/`actionConfig`, drop the custom fallback
- `app/src/features/processes/components/CreateProcessModal.tsx` — per-step action type and parameter fields
- `app/src/features/processes/api/__tests__/tasksApi.test.ts` — new test asserting the POST body
- `app/src/features/fleet/hooks/useZones.ts` — read: the zone source for the destination picker
- `app/src/features/robots/api/__tests__/cameraApi.test.ts` — read: the `apiClient`-mock test pattern to copy
- `app/src/features/processes/components/TaskTimeline.tsx` — read: failed/queued step rendering
- `robot-agent/src/tools/navigation.ts` — read: zone-centre derivation at `:32-40`

## Acceptance Criteria

- [ ] A pushed task with `actionType` `'custom'` or `'inspect'` makes the agent PUT `{status:'failed'}` with an error naming the action type, and no `CommandExecuteFn` method is called.
- [ ] No 2000 ms sleep remains in `TaskQueue.executeAction`; the unimplemented-type failure is returned immediately.
- [ ] Adding a member to `StepActionType` in `robot-agent/src/robot/types.ts` fails `cd robot-agent && npm run typecheck` until `executeAction` handles it — there is no default-success path left.
- [ ] A task whose `actionType` is a string outside the agent union (e.g. `'execute_skill'`) is reported failed, not completed.
- [ ] `wait`, `move_to_location`, `pickup_object`, `drop_object`, `charge` and `return_home` behave exactly as before — a `wait` task with `durationMs` still sleeps and reports completed.
- [ ] Creating an automation in the UI sends one `stepTemplate` per step carrying the action type the user picked plus its parameters, and no request body contains `actionType: 'custom'`.
- [ ] The modal refuses to submit an automation with zero steps, or with a step whose required parameter (zone, `objectId`, duration) is empty.
- [ ] A run whose step failed shows that step as Failed with the agent's message in `TaskTimeline`, and a step in server status `queued` renders the label "Queued" instead of an empty tag.

## Test Strategy

The seam is mocked on both sides.

**Robot agent — no test locks the bug in; the branch is simply uncovered behind a stubbed fetch.** `robot-agent/src/robot/__tests__/TaskQueue.test.ts:12` stubs the reporting seam itself (`vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))`), and every queue test sets `state.status = 'busy'` (lines 110, 128, 167, 183) precisely so nothing executes; grepping `robot-agent/**/*.test.ts` for `executeAction|executeNext|Simulating` returns nothing.

Replace with a new `describe('executeAction')` in that same file: leave `state.status` as `'online'`, accept one task, await the queue draining, then read `vi.mocked(fetch).mock.calls` — for `'custom'`, `'inspect'` and an unknown string, the second call's JSON body is `{ status: 'failed' }` with an error naming the type and `commands.moveTo`/`pickup`/`drop`/`goToCharge`/`returnHome` were never called; for `wait` with `durationMs` 5 the second body is `{ status: 'completed' }`, proving the simulator still works.

**App.** `app/src/features/processes/store/__tests__/tasksStore.test.ts:29-33` mocks the whole `'../../api/tasksApi'` module — the exact file that hardcodes `'custom'` — and `tasksApi` itself has no test. Add `app/src/features/processes/api/__tests__/tasksApi.test.ts` mocking only `'@/api/client'` (copy the pattern at `app/src/features/robots/api/__tests__/cameraApi.test.ts:9-11`) and assert the `POST /processes` body: one `stepTemplate` per step with the chosen `actionType` and `actionConfig`, no `'custom'` anywhere, and that an empty `steps` array throws.

**Server — nothing to add.** `server/src/__tests__/process-routes.test.ts:872-880` and `server/src/services/__tests__/TaskDistributor.test.ts:411-419` both feed the pipeline a synthetic `{ success: true }` and can never see a lying robot. This task does not change the server, and adding an assertion there would mock the same boundary again.

## Notes

**Out of scope, do not fix here — the same honesty defect one layer down:** `TaskQueue.ts:232-239` reports `completed` the moment `CommandExecutor.moveTo` returns, and `CommandExecutor.ts:147-173` only *starts* the move. So `move_to_location` completes before the robot arrives. That is a separate task; fixing it here would blur what this one proves.

Expect log noise once steps start failing: `ProcessManager.handleStepFailure` (`:480-520`) retries `maxRetries` (3, set in `ProcessRepository.ts:344`) then reassigns to other robots before failing the run. Existing behaviour — leave it.

A parallel session owns the navigation refactor (TASK-273 through TASK-280). This task touches `app/` but **must not** scope work into `app/src/components/layout/{Sidebar,NavList,MobileNav,navigation}.*` or `app/src/components/docs/DocsSidebar.tsx`; nothing here needs them.
