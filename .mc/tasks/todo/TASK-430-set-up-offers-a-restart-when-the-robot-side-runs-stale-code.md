---
id: "TASK-430"
aliases: []
title: "Set up offers a restart when the robot side runs stale code"
slug: "set-up-offers-a-restart-when-the-robot-side-runs-stale-code"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "ui"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-30"
updated: "2026-10-30"
---

# Set up offers a restart when the robot side runs stale code

## Description

On the real `g1-edu-4`, step 1 of the session page's Set up rail ("Start the robot side")
failed with "Sidecar: runs code from before 2026-10-30 01:44" and the reason "The sidecar
runs older code than NeoDEM. Restart the robot side." The step offered no button that
could do that. Its body only said to stop the robot side from the robot's Teleop tab.
The page gave an instruction that nobody could follow on the page. This task gives step 1
one lit "Restart robot side" for that case, and a secondary Stop under Details while the
robot side runs fine.

It also fixes a small defect seen in the same session. When the head camera reconnects
inside the live view's picture-in-picture, the camera's own placeholder draws "Head camera"
under the PiP's label chip, so the text lies on top of itself.

Branch: `fix/task-430-set-up-offers-a-restart-when-the-robot-side-runs-stale-code`.

## Details

### Current state

- `app/src/features/datacollection/pages/SessionDetailPage.tsx`, `renderStep` case
  `'robot'`:
  - shows `ReadinessActions` with only `['start', 'logs']`;
  - its lead line ends "Stop the robot side from the robot's Teleop tab when you finish
    for the day."
- Start shows only while the supervisor reports `stopped` or `error`. A robot side that
  runs (`ready` or `degraded`) on stale code therefore shows Logs alone.
- `app/src/features/robots/components/readiness/readinessRows.ts`, `markStale()`:
  - a process that started before its code changed (TASK-419, `checks.staleCode` on an
    owned step) fails its row ("runs code from before …");
  - its detail says "Stop and Start the robot side".
- The server's `mergeReason()` (`server/src/services/robot-supervisor/RobotReadinessService.ts`)
  says "The <proc> runs older code than NeoDEM. Restart the robot side." (`agent_outdated`).
  It says the same for an agent with no readiness route.
- The supervisor's `POST /stop` answers 202 at once and stops in the background:
  - first it disarms the arms and waits for the weight to reach 0;
  - then it stops the agent, the sidecar and the bridge.
  A `POST /start` while it is still stopping is refused with 409 `busy`. A restart is
  therefore Stop, then wait for `stopped`, then Start.
- `RobotReadinessPanel.tsx` (the robot's Teleop tab) still has Stop robot side, behind the
  `readiness-stop-confirm` ConfirmDialog, which offers "Limp first" while the robot stands.
  It also has Start robot side.
- The demo robot side (`app/src/mocks/readinessDemoHandlers.ts`) stops instantly and has no
  stale-code state.
- `app/src/features/datacollection/components/console/LiveView.tsx`:
  - the PiP draws a `PipBar` (label chip and swap button) along its top edge;
  - inside it, `CameraStreamView` (`components/CameraStreamView.tsx`, `fit`) centres a
    placeholder with the camera icon, the camera name, "Reconnecting in Ns" and "Retry now";
  - in a PiP about 120 px tall, the name and the icon fall under the bar.

### Frontend

- `readinessRows.ts`: add a pure `robotSideActions(readiness)` → `{ start, restart, stop }`:
  - `start`: `stopped` or `error`;
  - `stop`: there is a supervisor and it is not `stopped`;
  - `restart`: the robot side runs (`ready` or `degraded`) and a restart cures it. That is
    the case when an owned bridge, sidecar or agent runs stale code, or when the owned
    agent has no readiness route (`agent.outdated`);
  - not for a foreign or adopted process: the supervisor never signals it, so a restart
    would not reach it.
- `useRobotReadiness.ts`: add `actions.restart()`, built from the existing calls:
  - `stopBringup`;
  - `getReadiness` every 500 ms until the supervisor reports `stopped` (60 s at most);
  - `startBringup('read_only')`.
  While it runs, `pending.action` is `'restart'`. A failed stop, a stop that ends in
  `error`, or the timeout never starts again; each says why in the error line.
- `RobotReadinessPanel.tsx`, `useReadinessActions`:
  - a `restart` button (`readiness-restart`, "Restart robot side"), only where a host lists
    it in `only`. In a step it is the lit action;
  - its loading text is "Restarting…", and it stays visible until the restart is done;
  - Start and Stop hide while a restart runs;
  - the restart goes behind the Stop confirm (`readiness-restart-confirm`): same dialog,
    same `danger` tone and the same Limp-first offer ("Limp first, then restart").
  - Stop and Restart share one safety sentence: the arms are disarmed first, and stopping
    does not change the robot's mode. The restart adds that the sidecar comes back
    read-only.
- `utils/setupSteps.ts`:
  - the model gains `robotSide: { lead: 'start' | 'restart' | null; stop: boolean }`,
    from `robotSideActions`. It drives step 1's lit action and its Details Stop;
  - while the supervisor stops, the robot step summary reads "Stopping the robot side…".
- `SessionDetailPage.tsx`, step 1:
  - its actions are `['start', 'restart', 'logs']`, so exactly one of Start or Restart is
    lit;
  - its Details holds the rows and, while `robotSide.stop`, a secondary
    `readiness-stop` with its confirm;
  - the "Teleop tab" sentence goes. The lead says what Restart does, or that Stop is under
    Details.
- `readinessDemoHandlers.ts`:
  - a `sidecar_stale_code` fixture (up, read-only, the sidecar stale, `agent_outdated`), set
    with the existing demo-only pin route;
  - the demo Stop lets a pinned robot go and passes through `stopping` for about 1.4 s, as
    the supervisor does;
  - a Start while stopping is refused with 409 `busy`.
- `CameraStreamView.tsx`: a `compact` prop for the PiP. LiveView passes it there, and in
  `fit` the frame names the camera:
  - the placeholder draws no camera name;
  - compact also drops the icon and the recording lines;
  - it starts below the PiP bar.

### Key files

- `app/src/features/robots/components/readiness/readinessRows.ts`
- `app/src/features/robots/hooks/useRobotReadiness.ts`
- `app/src/features/robots/components/readiness/RobotReadinessPanel.tsx`
- `app/src/features/datacollection/utils/setupSteps.ts`
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/features/datacollection/components/CameraStreamView.tsx`
- `app/src/features/datacollection/components/console/LiveView.tsx`
- `app/src/mocks/readinessDemoHandlers.ts`
- `app/e2e/datacollection-console.spec.ts`

## Acceptance Criteria

- [ ] When the robot side runs but an owned process runs stale code, or the owned agent
  has no readiness route, step 1's one lit action is "Restart robot side".
- [ ] Restart opens the Stop confirm. The confirm says the arms are disarmed first. The
  restart only runs after Confirm.
- [ ] Restart is Stop, then wait for `stopped`, then Start (read-only). It uses only the
  existing stop, readiness and start calls. A refused stop, a stop that ends in `error`, or
  a 60 s timeout never starts again, and the error line says why.
- [ ] A foreign or adopted stale process gets no Restart.
- [ ] While the robot side runs fine, step 1's Details offers a secondary (not lit)
  "Stop robot side" behind its confirm.
- [ ] The "Teleop tab" sentence is gone from step 1.
- [ ] Set up keeps exactly one lit action, and the E-STOP clearance checks in
  `datacollection-console.spec.ts` stay green.
- [ ] In the PiP, the reconnecting camera's placeholder is drawn once, below the PiP bar.
  It shows no second camera name.
- [ ] Vitest covers the step model (stale, stopped, running and ok, stopping, foreign) and
  its lit action, `robotSideActions`, the hook's restart sequence and its refusals, the
  step's Restart and confirm, and the compact placeholder.
- [ ] An e2e block in `app/e2e/datacollection-console.spec.ts` shows the stale-code Restart
  in the demo, through to a fresh robot side.

## Test Strategy

- `cd app && npx tsc --noEmit && npx vitest run`.
- Run the Playwright demo specs `datacollection-console`, `datacollection-takes`,
  `quest-connect` and `datacollection-new-session`, plus `robot-readiness`, since the demo
  Stop changed.
- Take screenshots of step 1 in the stale-code state at 1512 and 1280, before and after the
  fix, and of the PiP while the camera reconnects.

## Notes

- Record's robot cell keeps Start and Logs. A restart in the middle of recording is out of
  scope.
- The Teleop tab's full panel is unchanged: Restart shows only where a host lists it.
