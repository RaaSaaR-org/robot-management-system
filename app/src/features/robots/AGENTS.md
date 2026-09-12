# AGENTS.md - Robots Feature

Robot list, robot detail, and the control center (operator console). Built on the
shared UI kit (`@/shared/components/ui`) and the contract in `docs/brand.md` —
read `app/AGENTS.md` first.

## Routes

| Route | Page | Notes |
|-------|------|-------|
| `/fleet?tab=list` | `RobotsPage` (rendered by the fleet page's List tab) | Toolbar: search, status filter, Grid/Table toggle (localStorage `robots.view`), primary "Register robot" |
| `/robots/:id` | `RobotDetailPage` | Header + tabs in the URL: `?tab=overview` (default, omitted), `telemetry`, `perception`, `motion`, `teleop`, `voice`, `chat`, `activity`, `details` |
| `/robots/:id/cockpit`, `/control-center` | `RobotCockpitPage` | Control center; `/control-center` auto-picks the most recently seen robot (prefers G1) and self-heals past robots that never stream. Demo mode renders `DemoFeaturePlaceholder` |

## Structure

```
robots/
├── api/            # robotsApi, cameraApi — REST calls
├── hooks/          # useRobots, useRobot, useTelemetryStream, useRobotCameras, …
├── store/          # Zustand stores (robots, telemetry, voice)
├── types/          # robots.types.ts (Robot, RobotStatus, RobotTelemetry, …)
├── pages/          # RobotsPage, RobotDetailPage, RobotCockpitPage
└── components/
    ├── common/         # shared building blocks — use these, never hand-roll
    ├── cockpit/        # control center: Viewport, PerceptionPanel, Vitals, CommandDock
    ├── tabs/           # one file per detail tab; every tab uses the same Panel structure
    ├── telemetry/      # battery, IMU, motor temperatures, sparklines
    ├── visualization/  # Robot3DViewer, PointCloudViewer (WebGL), joint grids
    ├── voice/          # voice pipeline UI
    ├── RobotList.tsx / RobotCard.tsx   # the list (grid of cards or DataTable)
    ├── AddRobotDialog.tsx              # exports RegisterRobotModal (FormModal)
    └── EmergencyStopButton.tsx
```

## Shared rules (components/common/)

- **Robot status** → `RobotStatusTag` only (`RobotStatusBadge` is a legacy wrapper around it). Never a hand-made colored dot.
- **Telemetry provenance** → `ProvenanceTag` with `provenanceOf(telemetry)`: Live / Sim / Stale / No telemetry.
- **Numeric readouts** → `Readout` (Inter, `tabular-nums`, unit in ink-tertiary, missing value "—"). Mono is for IDs, URLs and code (`commandType`), never for values or labels.
- **3D / camera surfaces that cannot render** → `ViewerUnavailable` (calm panel; headless Chromium has no WebGL — that must never crash the page).
- **three.js / canvas colors** → `readCssColor('--token')`; no hex in source.

## Acts and CRUD

- Register: "Register robot" → `RegisterRobotModal` (FormModal, Agent URL required) → toast "Robot registered". `POST /api/robots/register` fetches the agent card, so the agent must be reachable.
- Unregister: card/row menu "Unregister" (danger, last) → `confirm()` "Unregister {name}?" → `DELETE /api/robots/:id` → toast.
- Robot-moving acts (return home, charge, stop task, run an interpreted command, skills, motions) → `confirm()` with the consequence, then a toast. Harmless toggles never confirm.
- **E-stop never confirms**: `EmergencyStopButton` fires on one press (`bg-stop`), toasts the result, and is always reachable — in the control center it lives in the sticky command dock.

## Offline states

Robots without a running agent are the normal case in dev. Offline copy: "{name} is offline. Start its robot agent to see live telemetry and send commands." Empty values show "—", unknown places "Place unknown". Offline must look deliberate, not broken.

## Tests

`npx vitest run src/features/robots` — keep `data-testid`s (`robot-card`, `motion-*`, `voice-*`, `vr-*`) and the `a[href*="/robots/"]` name link on each card; e2e specs depend on them.
