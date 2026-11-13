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

### Expected robots (TASK-477)

A robot can be on the fleet before its agent has ever registered (`PUT /api/robots/:id/expected`, `docs/demo-fleet.md`). It is `offline` with `metadata.provisioning` = `awaiting_agent` or `arriving`; read it with `robotProvisioning(robot)` and pass `provisioning` to `RobotStatusTag` / `RobotOfflineBanner`. Such a robot reads "Not connected" or "Arriving", never "Offline", and shows no invented reading: battery "—" (not "AC"), no "Seen …", no "Place unknown". A robot that is not offline is never treated as expected, whatever its metadata says.

**It has no agent, so nothing on its page may need one (TASK-485).** Decide with `robotTraits(robot, telemetry)` (`utils/robotTraits.ts`) — never with the robot's name or model:

| Trait | Read from | Gates |
|-------|-----------|-------|
| `hasAgent` | `robotProvisioning` is null | Emergency stop, Send to charge / Return home, the Teleop, Chat and command panels (`AwaitingAgentState` stands in for them) |
| `connected` | `status !== 'offline'` | telemetry and point-cloud requests (`useTelemetryStream(id, { enabled })`) |
| `canCharge` | `powerSource` (telemetry, else metadata) is not `ac_powered` | "Send to charge" / "Charge": a mains-powered arm has no dock |
| `hasHands` | the embodiment key (`robotType`) | the two hand rows of the readiness list, unless the agent reports hand health itself |

An expected robot's tab says "Not connected yet" / "Not arrived yet" plus one sentence from `awaitingAgentSentence()`; it never prints `lastSeen` (the moment the row was written) and never "Offline" / "Robot offline".

## Telemetry transport

`useTelemetryStream` and `usePointCloudStream` open no socket. Live frames arrive on the app-wide event socket (`useRobotWebSocket`, `getWebSocketUrl()` — the API base or the page origin) and land in the robots store; while none is fresh the hook polls the API server. The server has no per-robot telemetry or point-cloud socket, so do not add a URL for one. Pass `enabled: false` for a robot without a connected agent.

## Chat

Opening the Chat tab creates nothing. `RobotChatPanel` finds the robot's conversation if there is one and hands `ConversationPanel` an `ensureConversation` that creates it when the first message is sent.

## Robot type

The **Robot type** on the Details tab is the dataset configuration the robot is one of, resolved by the server (`GET /api/robots/:id/robot-type`: `metadata.robotTypeName` first, the model string second). `metadata.robotType` is a different thing — the embodiment key that picks the 3D model — and is labelled "Embodiment".

## Tests

`npx vitest run src/features/robots` — keep `data-testid`s (`robot-card`, `motion-*`, `voice-*`, `vr-*`) and the `a[href*="/robots/"]` name link on each card; e2e specs depend on them.
