---
id: "TASK-504"
aliases: []
title: "The robot page shows the 3D model whole and higher up, counts and explains its commands, and a simulated robot drives to charge and home"
slug: "the-robot-page-shows-the-3d-model-whole-and-higher-up-counts"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["robots", "command", "simulation", "demo", "ui", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-14"
updated: "2026-11-14"
---

# The robot page shows the 3D model whole and higher up, counts and explains its commands, and a simulated robot drives to charge and home

## Description

A second review round of the demo instance (https://neodem.emai.dev, live build
origin/main 5a66bda4, 2026-11-14) found five defects on the robot page and the
simulated robot. The demo is on 2026-11-16. Each fix is the smallest safe change.

1. **3D model revealed half-built.** `watchModelLoad` started one fixed 20 s timer,
   so a cold load that was still progressing on a slow link was revealed in pieces.
   The "n / 50" loading label also sat at the bottom of the canvas, below the fold.
2. **3D viewer below the fold at 1280x720, cut at the knees at 1440x900.** The four
   stat tiles (all "—" on an offline robot) rendered above the Overview tab.
3. **Activity badge reads 0** next to a non-empty command history: it counted tasks only.
4. **Command history copy.** The label read "Go Charge", the panel said "quick act.",
   a failed row did not say why it failed, and a refused command toasted
   "Couldn't send command" over the robot's raw error.
5. **Simulated Charge / Home did nothing.** Home and the simulated charger were the
   same point (0,0), so both commands drove 0 m, and Home put the robot into CHARGING.
   The server mirrored robot status only on the 30 s health check, so CHARGING was
   missed or shown stale with the controls locked for up to 30 s.

## Details

### Frontend

- `app/src/features/robots/components/visualization/modelLoading.ts` — the reveal
  timeout is a stall timeout: re-armed on every started or finished file. Only a load
  with no progress for `MODEL_REVEAL_TIMEOUT_MS` (20 s) is revealed with what it has.
- `app/src/features/robots/components/visualization/Robot3DViewer.tsx` — the loading
  label is centred in the canvas.
- `app/src/features/robots/components/RobotControlCenter.tsx` — `RobotQuickStats`
  renders below `OverviewTab`, not above it. This applies to online and offline
  robots alike, so the live model moves up for both. The Activity badge counts
  tasks + command history and is hidden at 0.
- `app/src/features/robots/types/robots.types.ts` — `charge: 'Charge'`.
- `app/src/features/robots/components/tabs/CommandsTab.tsx` — the copy reads "or use
  the buttons". A failed row shows the operator's phrase (`payload.nlOriginalText`)
  and the robot's `errorMessage`.
- `app/src/features/robots/utils/commandRefusal.ts` (new) — `commandRefusalTitle()`
  gives "SimBot-01 refused: <reason>" for a `RobotCommandFailedError`. It is used in
  `CommandBar.tsx`, `RobotDetailPanel.tsx` and `cockpit/CockpitCommandDock.tsx`. Any
  other error keeps its "Couldn't send…" title.

### Robot Agent

- `robot-agent/src/tools/navigation.ts` — `simulatedChargerLocation()` is (6, 4), more
  than 1 m from home on both axes (1 m is the arrival radius). It is used only when
  no registered place graph names a charger. The `charge` command still uses it only
  on an agent configured as simulated with no real locomotion (TASK-502 gate,
  unchanged), so real robots are still refused.

### Server

- `server/src/services/RobotManager.ts` — after a command the robot accepted (status
  not `failed`), `followCommandStatus()` re-reads `GET <baseUrl>/api/v1/health` after
  1 s, then every 2 s while the robot reports `busy` or `charging`, at most 30 reads.
  Each status read is mirrored through `noteRobotAnswered()`. The reads are fire and
  forget. A newer command restarts the schedule, and `stopHealthChecks()` cancels it.
  Only online/busy/charging transitions are mirrored. Error, protective stop and
  offline stay with the health check, which raises and resolves alerts for them. The
  follow-up only reads from the robot and sends it nothing.

## Acceptance Criteria

- [x] A load that keeps progressing past 20 s is not revealed early. A load with no
      progress for 20 s is revealed (unit tests).
- [x] The loading label is centred in the viewer.
- [x] The stat row renders after the Overview tab. Screenshots at 1280x720 and 1440x900
      show the live model higher on the page.
- [x] The Activity badge shows tasks + command history and is hidden at 0.
- [x] "Charge" label, plain panel copy, and failed rows with reason and phrase.
- [x] A refused command toasts "<robot> refused: <reason>".
- [x] A simulated Charge drives to its own charger and charges. Home drives back and
      ends `online`, not `charging`.
- [x] After an accepted command the server mirrors busy → charging → online within
      seconds.

## Test Strategy

- app: `modelLoading.test.ts` (stall timeout), `RobotControlCenter.test.tsx` (order,
  badge), `CommandsTab.test.tsx` (labels, failed rows, copy), `commandRefusal.test.ts`.
- robot-agent: `simulation-charger-home.test.ts`, `command-executor-charge-sim.test.ts`.
- server: `RobotManager.test.ts` "sendCommand status follow-up (TASK-504)".
- Typecheck and vitest for app, server and robot-agent, plus the Playwright spec
  `e2e/robot-model-loading.spec.ts`.

## Notes

Measured on the demo build (MSW), with mesh requests held so the loading label
stays up. Canvas top, before → after:

| Robot | 1280x720 | 1440x900 |
| ----- | -------- | -------- |
| online (`demo-h1-001`) | 525 → 374 | 525 → 374 |
| offline (`demo-generic-001`) | 696 → 545 | 696 → 545 |

The canvas is 439 px tall, so the move is 151 px. The online robot's model is now
in the first screen at 1280x720. The loading label sits in its centre, at y≈593;
before, it sat at the canvas bottom at y≈925. For an offline robot at 1280x720 only
the top of the canvas shows: the offline banner (about 170 px) still sits above the
model. At 1440x900 the whole model is in view.
