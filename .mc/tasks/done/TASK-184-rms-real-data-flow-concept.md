---
id: TASK-184
aliases:
- TASK-184
title: 'Real data everywhere: RMS data-flow concept, mock-data audit & phased plan (all G1 sensors incl. Dex3 touch)'
slug: rms-real-data-flow-concept
status: backlog
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- robot
- sensors
- architecture
sprint: ''
depends_on: []
due_date: ''
created: 2026-07-12
updated: 2026-07-12
status_note: 'IMPLEMENTED 2026-07-13 (Phases 0-3): PR #195, toolkit companion
  commit 07aadd3. Robot-less E2E verified >12h (mock publisher DDS domain 9 ->
  bridge -> sidecar :8767 -> g1-edu agent -> server -> app; 366+ RobotTelemetry
  rows persisted, history sparklines from real data, SIM badges correct,
  Playwright pass both themes). Remaining: on-robot validation sweep
  (hardware-gated: real BMS/odom topic names via dds_discover, Dex3 index/middle
  motor-order check, BMS unit scaling) + Phase-4 follow-up tasks. Audit
  correction: vla_runner.py/smolvla_backend.py are NOT orphaned (SO-101 sidecar
  + sim evaluator import them) — headers fixed instead of deletion; Model3DTab
  found orphaned pre-TASK-184 (never routed) — wire into RobotControlCenter or
  delete as follow-up.'
---

## Description

Whole-RMS concept for **replacing mock/simulated data with real robot data**.
Based on a complete audit (2026-07-12, all three components) of where data is
mocked, simulated, seed-only, or fabricated — and a phased plan to connect the
real Unitree G1 EDU + Dex3-1 end-to-end: bridge → sidecar → robot-agent →
server → app, with persistence, live display (incl. fingertip touch), and
honest "SIM" labeling wherever simulation remains.

## Details

### 1. Audit verdict — where mock data actually lives (2026-07-12)

The three layers are in very different shape:

| Layer | Verdict |
|---|---|
| **App** (`app/src`) | **Clean.** Every feature fetches the real REST/WS API; no `catch → mock` fallbacks. Mocks exist only in (a) MSW demo mode behind `VITE_DEMO_MODE` (`main.tsx:30-42`, `mocks/handlers.ts`, catch-all `:533`), (b) dev auto-login as hardcoded super-admin `MOCK_USER` (`app/providers/AuthProvider.tsx:100-109`, `mocks/mockData.ts:22-32`), (c) static landing-page marketing stats (`components/landing/StatsSection.tsx`). Dead code: `MOCK_COMMAND_HISTORY` (unused), `taskMockData` behind `USE_MOCK_DATA=false` (`features/processes/api/tasksApi.ts:31`). |
| **Server** (`server/src`) | **Real DB control plane** (auth, robots, tasks, alerts, incidents, compliance, GDPR, OTA, safety, teleop, twin, scans — all Prisma-backed), **but the robotics live-data + ML-compute layers are simulated or absent** — see table below. Single biggest finding: **the `RobotTelemetry` Prisma model has ZERO writers** — no robot telemetry is ever persisted; `GET /robots/:id/telemetry` is a live HTTP proxy to the agent (`robot.routes.ts:145` → `RobotManager.ts:429`), and the `robot_telemetry` WS event type exists (`RobotManager.ts:159`) but is never emitted. |
| **Robot agent** (`robot-agent/src`) | **The main simulation layer.** Real paths exist and work for: joints (verified on real G1 2026-07-03), pelvis IMU (SafetyMonitor only), point clouds, CPU/memory/host-temp (`os.loadavg` etc.), VLA closed loop (HTTP to vla-server, hardware mode when sidecar available — `skill-executor.ts:214`). Everything else is simulated: battery, humidity, the whole `sensors` record, position/navigation/speed, force/torque safety input. |

### 2. Target data-flow concept

```
G1 EDU (DDS domain 0)                                    [real robot]
 │  rt/lowstate · rt/dex3/{left,right}/state · BMS · odometry · rt/utlidar/cloud
 ▼
g1_state_bridge_readonly.py        multi-topic ZMQ PUB :6001   [read-only, verified 2026-07-03]
 ▼
g1_sidecar.py  HTTP :8767          /state = joints+hands+touch+imu+battery+temps+odometry
 ▼                                 (simulated:false, G1_READ_ONLY=1)
HardwareClient.ts  (poll 2 s)      per-field real-over-sim override in state.ts
 ▼                                 (same pattern as jointStates today, state.ts:362-369)
robot-agent WS server              ws://agent:PORT/ws/telemetry/:id — full RobotTelemetry
 │                                 every 2000 ms (websocket.ts:15,47-52) + hardwareConnected
 ▼
server TelemetryIngestionService   NEW: subscribe agent WS → persist RobotTelemetry
 │                                 (downsampled) → broadcast `robot_telemetry` WS event
 ▼
app                                existing hooks (useTelemetryStream) + new cards:
                                   touch pads, IMU, battery health, motor temps, odometry
                                   + history charts from persisted telemetry
```

Design principles:

1. **Real-over-sim per field**, not per robot: extend the existing
   `state.ts:362-369` jointStates pattern to battery, IMU, touch, temps,
   odometry. Simulation keeps working when hardware is absent (dev mode).
2. **Honesty flag through the whole chain**: `hardwareConnected` (exists,
   `state.ts:368`) plus per-field-group `simulated` flags → UI shows a small
   "SIM" badge on any card whose data is simulated. No silent fabrication.
3. **Persist once, at the server**: telemetry history lands in the (currently
   orphaned) `RobotTelemetry` model; UI gets history charts for free.
4. **Optional infra degrades visibly**: services without their backend
   (Isaac Lab, simulation, federated learning) must report "not connected"
   instead of fabricating numbers.

### 3. Mock-data inventory (complete, with how-to-connect)

#### 3a. Robot agent (`robot-agent/`)

| Data | Today | Real source / how to connect |
|---|---|---|
| 29 body joints (q/dq/tau) | ✅ real when sidecar up (`state.ts:362-369`); sim animation otherwise (`telemetry.ts:84-292`) | done — the reference pattern |
| Dex3 hand joints (2×7) | ❌ bridge subscribes ONLY `rt/lowstate`; sidecar omits hand joints (`g1_sidecar.py:364-366`) | bridge: add `rt/dex3/left|right/state` (`unitree_hg::HandState_`) |
| Dex3 fingertip touch (`press_sensor_state[]`, pressure[12]/pad) + hand IMUs + hand power | ❌ missing end-to-end — no type, transport, or UI anywhere | bridge → sidecar `/state.touch` → `RobotTelemetry.touch` → `HandTouchPads.tsx` |
| Battery | ❌ always simulated (`telemetry.ts:62-64`, drained by `SimulationEngine.ts:297-354`) | BMS DDS topic (`unitree_hg::BmsState_`, name via toolkit `dds_discover.py`) — NOT in lowstate |
| Pelvis IMU | ⚠ real, but consumed ONLY by SafetyMonitor fall net (`state.ts:776-792`, 20 Hz) — never in telemetry/UI | add `imu` to `RobotTelemetry`; note `telemetry.ts:297-352` also emits FAKE imu values inside `sensors` — remove/replace those |
| Per-motor temperatures | ⚠ bridge publishes them; dropped at sidecar `/state` mapping | add `temperature` to joint entries + `motorTemperatures` |
| Odometry / position / speed | ❌ pure sim kinematics (`SimulationEngine.ts:178-219`) | `unitree_go::SportModeState_` odom topic (name via discovery) |
| `sensors` record (sonar/bumper/cliff/currents/…) | ❌ all fabricated (`telemetry.ts:297-352`) | G1 has no such sensors — DELETE for g1 profiles instead of faking |
| humidity / diskUsage | ❌ fake (`telemetry.ts:71`, hardcoded 35 `:69`) | humidity: null for G1; disk: real `df` read or drop |
| CPU / memory / host temp | ✅ real (`telemetry.ts:31-42`) | done |
| Point cloud | ⚠ hybrid: real sidecar snapshot → replay file → synthetic (`state.ts:388-431`) | live MID-360 streaming = follow-up task |
| Force/torque (safety) | ❌ `SafetyMonitor.generateSimulatedForce` (`SafetyMonitor.ts:496-525`) | derive from real tau_est; true F/T sensors don't exist on G1 |
| Wireless remote | ⚠ bridge forwards base64-raw, nothing decodes | decode 40-byte blob (layout in toolkit) — nice-to-have |
| E-stop | ⚠ soft ramp-reset only (`HardwareClient.ts:557-566`) | real damping-mode E-stop = hardware bring-up task, out of scope |
| Genkit tools (navigation/manipulation) | sim-only by design — G1 sidecar has NO motion path (read-only stage) | out of scope until write-stage decision |
| **Port bug** | `HardwareClient` default `:8765` = SO-101 (`HardwareClient.ts:104`); G1 sidecar is `:8767`; `state.ts:936,943,973,1027` hardcode `:8765` and target the **orphaned** `vla_runner.py` surface | fix in Phase 0 |

#### 3b. Server (`server/src`)

| Area | Today | How to connect real data |
|---|---|---|
| **Telemetry history** | ❌ `RobotTelemetry` model never written; live proxy only; no `robot_telemetry` WS broadcast | Phase 2: ingestion service (below) |
| Simulation jobs | ❌ mock progression + `Math.random` metrics by default (`SimulationService.ts:1130,1184`); real MuJoCo only if `SIMULATION_BACKEND=real` (`:604`) | run real backend on dz-226; show "backend: mock" badge otherwise |
| Isaac Lab / synthetic | ❌ `IsaacLabClient.ts:177` silent mockMode without `ISAAC_LAB_URL`; `SyntheticDataService.ts:451-472` hardcoded GPU status | surface mock state in API response; wire real URL when service exists |
| Federated learning | ❌ mock robot list + fake deltas (`FederatedLearningService.ts:180,292,638-651`); rounds persisted but math fake | real robot gradient uploads (big; Phase 4 follow-up) |
| Data augmentation / OOD quality / contribution scoring | ❌ `Math.random` placeholders (`DataAugmentationService.ts:67+`, `DataQualityService.ts:575-581`, `DataContributionService.ts:46-51,218` — in-memory Maps!) | Phase 4 follow-ups; DataContributionService → Prisma first |
| Explainability metrics | ⚠ accuracy/precision/recall derived from confidence, not outcomes (`DecisionRepository.ts:327-343`) | needs real outcome labels |
| Deployment metrics | ⚠ real robot polling but in-memory only (`DeploymentMetricsService.ts:44,183`); canary jitter `Math.random` (`DeploymentService.ts:619`) | persist samples; remove jitter |
| A2A conversations | ⚠ "simulated response" fallback when no agent replies (`ConversationManager.ts:399`) | fine, but label it |
| Marketplace / Evaluation / RobotTypes / Zones / Cosmos demo dataset | seed-only (`scripts/seed-*.ts`) | fine — real usage fills them; evaluation fills from real robot episodes |
| Infra gating | NATS absent → training/dataset services never init (`index.ts:79-107`); RustFS absent → storage off (`:109-116`) | already graceful; keep |
| Everything else (auth, robots, tasks, alerts, incidents, compliance, GDPR, OTA, safety, teleop, twin, scans, active learning, credits) | ✅ real Prisma-backed | — |

#### 3c. App (`app/src`)

| Item | Today | Action |
|---|---|---|
| All 25+ features | ✅ real API/WS | — |
| MSW demo mode (`VITE_DEMO_MODE`) | intentional demo switch | keep — it's the product demo |
| Dev auto-login `MOCK_USER` (`AuthProvider.tsx:100-109`) | dev convenience, but identity/roles always fake in dev | keep, but gate behind explicit `VITE_DEV_AUTOLOGIN` (Phase 3, optional) |
| Landing `StatsSection.tsx` | static marketing copy | keep |
| Dead mock code (`MOCK_COMMAND_HISTORY`, `taskMockData`+`USE_MOCK_DATA`) | unused | delete (Phase 0) |
| Missing UI for real data | no IMU/touch/battery-health/motor-temp/odometry display; no telemetry history charts; no SIM badges | Phase 1 + 2 + 3 below |

### 4. Phased implementation plan

#### Phase 0 — hygiene fixes (small, do first)

- Fix `HardwareClient.ts:104` default port / require `HARDWARE_SIDECAR_URL` per profile (g1-edu → `:8767`); fix hardcoded `localhost:8765` VLA-sidecar URLs in `state.ts:936,943,973,1027` (they target the orphaned `vla_runner.py` path — decide: delete or rewire to SkillExecutor).
- Delete dead mocks: `MOCK_COMMAND_HISTORY`, `taskMockData.ts` + `USE_MOCK_DATA` flag, orphaned `hardware/vla_runner.py` + `hardware/backends/smolvla_backend.py` (both `@status orphaned`).
- `telemetry.ts`: real disk usage or drop `diskUsage`; stop emitting fake IMU/sonar/bumper values inside `sensors` for g1/g1-edu profiles.

#### Phase 1 — all G1 sensors into the agent (robot-less testable)

**Bridge** (`robot-agent/hardware/g1_state_bridge_readonly.py`): additionally
subscribe `rt/dex3/left/state` + `rt/dex3/right/state` (7 motors,
`press_sensor_state[]`, per-hand IMU, power), BMS topic and odometry topic
(names via toolkit `dds_discover.py` on robot day; candidates
`rt/lf/bmsstate`, `rt/odommodestate`). Multi-topic ZMQ (`{"topic":…,"data":…}`
format already supports it). Add `--domain` flag for mock tests. Stay strictly
read-only. Extend the toolkit's `mock_robot_publisher.py` with BMS, odometry,
and non-zero touch pressures.

**Sidecar** (`robot-agent/hardware/g1_sidecar.py`): `/state` fills the 14 hand
joints with real Dex3 values; add `imu`, `touch` (per-hand pad array),
`battery` (soc/soh/current/cellVoltages/temps/cycles), `motorTemperatures`,
`odometry` (position/velocity). Keep `G1_READ_ONLY=1`.

**Agent** (`robot-agent/src/`): `HardwareClient` parses new fields
(`getTouch/getBattery/getOdometry/getMotorTemperatures`); `RobotTelemetry`
type gains `imu? touch? battery? motorTemperatures? odometry?`, `JointState`
gains `temperature?`; `state.ts` real-over-sim override for each new field
(pattern `state.ts:362-369`); `telemetry.ts` simulates the new fields for the
g1-edu dev profile (touch pulses when "holding") so dev UIs stay alive.

**SafetyMonitor**: replace `generateSimulatedForce` with values derived from
real `tau_est` when hardware is connected (`SafetyMonitor.ts:496-525`).

#### Phase 2 — server persistence + history (the missing middle)

- **New `TelemetryIngestionService`**: on robot registration, connect to the
  agent's existing WS (`ws://agent/ws/telemetry/:id` — server side of it
  already exists in the agent, `websocket.ts:15`; the never-used
  `telemetryWs` endpoint field is at `RobotManager.ts:236`). Persist to
  `prisma.robotTelemetry` **downsampled** (e.g. 1 sample/10 s + on-change for
  alerts; retention job like existing cleanup jobs), forward every frame as
  the (declared but never emitted) `robot_telemetry` WS broadcast.
- **Schema**: `RobotTelemetry` gains JSON string columns `imu`, `touch`,
  `battery`, `motorTemperatures`, `odometry`, `jointStates` (SQLite-friendly,
  same pattern as `sensors`); migration; extend `server/src/types` + app types.
- **History API**: `GET /robots/:id/telemetry/history?from&to&fields` on the
  `@@index([robotId,timestamp])`.
- App `useTelemetryStream` switches from HTTP-poll-in-dev to the new server WS
  broadcast, gaining multi-client fan-out; TelemetryTab gets history
  sparklines (battery, temps) via recharts.

#### Phase 3 — display + honesty in the UI

- `TelemetryTab.tsx`: **IMU card** (rpy + level indicator), **battery-health
  card** (SOC gauge, SOH, current, cell min/max, cycles), **motor-temperature
  strip/heatmap** (29 joints, warn ≥ 60 °C).
- **NEW `components/visualization/HandTouchPads.tsx`** (the showpiece): SVG
  hand schematic per hand, pads colored by pressure (theme surface → warning
  color), live over telemetry WS; placed in Model3DTab next to the 3D viewer.
- `JointStateGrid.tsx`: per-joint temperature; hand joints now live (43-DOF
  g1-edu config exists). Odometry into `OverviewTab`/`RobotQuickStats`.
- **SIM badges everywhere**: small badge on any card whose field-group is
  simulated (`hardwareConnected` + per-field flags from Phase 1); robot list
  already knows `metadata.isSimulated`. Server-side: Isaac Lab + simulation
  APIs include `backend: 'mock'|'real'` and the UI shows it.
- Optional: dev auto-login behind explicit flag.

#### Phase 4 — ML-layer realness (separate follow-up tasks, listed for the concept)

Real simulation backend on dz-226 (`SIMULATION_BACKEND=real`), Isaac Lab URL,
federated learning with real robot deltas, real augmentation/OOD/contribution
scoring (+ DataContributionService → Prisma), explainability outcome labels,
persisted deployment metrics. Each becomes its own task; this issue only
fixes the *labeling* (Phase 3) so none of them silently fabricate.

### Out of scope

- Locomotion/manipulation command path to the real G1 (read-only stage is
  deliberate; Genkit nav tools stay sim until the write-stage decision).
- Camera live-view in robot detail + live MID-360 streaming (separate tasks;
  sidecar camera endpoints need the lerobot driver = command path).
- Hardware E-stop (damping mode) — bring-up task.
- Microphone/voice (TASK-181), teleop recording (done), scan-to-twin (done).

### Key files

- `robot-agent/hardware/{g1_state_bridge_readonly.py, g1_sidecar.py}`
- `robot-agent/src/hardware/HardwareClient.ts`, `robot-agent/src/robot/{types,state,telemetry}.ts`, `robot-agent/src/safety/SafetyMonitor.ts`, `robot-agent/src/api/websocket.ts`
- `server/prisma/schema.prisma` (RobotTelemetry), NEW `server/src/services/TelemetryIngestionService.ts`, `server/src/services/RobotManager.ts`, `server/src/routes/robot.routes.ts`, `server/src/websocket/index.ts`
- `app/src/features/robots/components/tabs/{TelemetryTab,Model3DTab,OverviewTab}.tsx`, `app/src/features/robots/components/visualization/{JointStateGrid,HandTouchPads}.tsx` (new), `app/src/features/robots/hooks/useTelemetryStream.ts`
- Reference: https://github.com/RaaSaaR-org/g1-sensor-toolkit (DDS field mapping, mock publisher, robot-day discovery runbook)

## Test Strategy

- **Robot-less end-to-end (primary, CI-able)**: toolkit
  `mock_robot_publisher.py` (extended: touch, BMS, odometry) on DDS
  **domain 9** → bridge `--domain 9` → sidecar → agent (`npm run dev:g1-edu`)
  → server → app. Verify: hand joints move in the 3D viewer, touch pads light
  up, battery card shows mock SOC/SOH, IMU card tracks mock rpy, motor temps
  render, `RobotTelemetry` rows appear in the DB, history endpoint returns
  them, SIM badges disappear when the mock chain is connected
  (`hardwareConnected:true`) and reappear without it.
- Unit: HardwareClient parsing (new fields, absent-field tolerance), state.ts
  real-over-sim per field, ingestion service downsampling + persistence,
  history route.
- Playwright: robot detail → Telemetry tab shows IMU/battery/touch/temps in
  both themes (g1-edu profile); SIM badge rendering.
- **On robot (final gate)**: toolkit robot-day sweep first (`dds_discover` →
  real BMS/odom topic names → configure bridge), then: squeeze a fingertip →
  pad lights up in the app; battery SOC matches the robot display; IMU follows
  a gentle torso tilt; motor temps plausible after walking. Read-only
  guarantee: bridge/sidecar never open a command path (DDS domain 0, no
  publishers on robot topics).
