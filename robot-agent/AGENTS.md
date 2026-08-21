# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with the NeoDEM Robot Agent.

## Project Overview

The Robot Agent is software that runs directly on humanoid robots, implementing the A2A (Agent-to-Agent) protocol for communication with NeoDEM. It uses Genkit with Gemini AI to interpret natural language commands and execute robot actions.

For development and demos, the agent includes a **simulation mode** that emulates robot behavior (movement, battery, sensors, joint states) without physical hardware.

## Commands

### Development

```bash
npm run dev          # Start agent with hot reload (default: SimBot-01, port 41243)
npm run dev:light    # Start as NimbleBot (lightweight, port 41243)
npm run dev:heavy    # Start as TitanBot (heavy-duty, port 41244)
npm run dev:so101    # Start as ArmBot (SO-ARM100, port 41245)
```

### Build

```bash
npm run build        # Compile TypeScript to dist/
npm start            # Run production build
```

### Type Checking

```bash
npm run typecheck    # Run TypeScript compiler (noEmit mode)
```

### Testing

```bash
npm test             # Run tests with vitest (watch mode)
npm run test:run     # Run tests once
```

### Protobuf

```bash
npm run proto:build  # Rebuild gRPC stubs from protos/vla_inference.proto
```

## Architecture

### Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **AI**: Genkit with Google Gemini 2.5 Flash
- **Protocol**: A2A SDK (@a2a-js/sdk)
- **gRPC**: VLA inference client (@grpc/grpc-js)
- **Real-time**: WebSocket (ws)
- **Language**: TypeScript (ESM modules)

### Entry Point

- **Main**: `src/index.ts` - Express server with A2A SDK integration

### Default Port

- HTTP/WebSocket: `41243` (configurable via `PORT` env)

### State Management Architecture

The robot uses a **facade + delegation** pattern:

```
RobotStateManager (facade)
├── CommandExecutor     # Executes move/pickup/drop/stop/charge commands
├── SimulationEngine    # Physics loop (100ms tick): movement, battery, heading
├── StatePublisher      # Observer pattern: subscribe to state changes
└── TaskQueue           # Server-pushed task queue (max 5, priority-sorted)
```

## Project Structure

```
robot-agent/src/
├── index.ts              # Main entry point, Express + A2A setup
├── config/
│   └── config.ts         # Environment configuration & validation
├── agent/
│   ├── agent-card.ts     # A2A AgentCard definition (3 skills)
│   ├── agent-executor.ts # A2A message processing (Genkit, LRU context cache)
│   └── genkit.ts         # Genkit/Gemini AI setup (gemini-2.5-flash)
├── robot/
│   ├── types.ts          # All type definitions (RobotStatus, CommandType, etc.)
│   ├── state.ts          # RobotStateManager facade (coordinates subsystems)
│   ├── CommandExecutor.ts    # Command execution with validation & history
│   ├── SimulationEngine.ts   # Physics loop (position, battery, heading)
│   ├── StatePublisher.ts     # Observer/pub-sub for state changes
│   ├── TaskQueue.ts          # Server-pushed task queue with priority
│   ├── telemetry.ts          # Sensor data generation & alert detection
│   └── joint-configs/
│       ├── index.ts          # Joint config dispatcher (by robot type)
│       ├── h1.config.ts      # Unitree H1 - 19 joints
│       └── so101.config.ts   # SO-ARM100 SO101 - 6 joints
├── api/
│   ├── rest-routes.ts    # REST API endpoints (NeoDEM compatible)
│   └── websocket.ts      # WebSocket telemetry streaming (2s interval)
├── tools/
│   ├── navigation.ts     # Genkit tools: moveToLocation, stopMovement, goToCharge, returnHome
│   ├── manipulation.ts   # Genkit tools: pickupObject, dropObject
│   └── status.ts         # Genkit tools: getRobotStatus, emergencyStop
├── embodiment/            # Embodiment abstraction layer
│   ├── embodiment-loader.ts  # YAML config loader with hot-reload (chokidar)
│   ├── camera-config.ts      # Camera configuration per embodiment
│   ├── joint-mapper.ts       # Joint name mapping across embodiments
│   ├── normalizer.ts         # Action/observation space normalization
│   ├── types.ts
│   ├── configs/
│   │   ├── generic.yaml      # Default generic embodiment
│   │   ├── h1.yaml           # Unitree H1 humanoid config
│   │   └── so101.yaml        # SO-ARM100 arm config
│   └── __tests__/            # Unit tests (vitest)
├── safety/
│   ├── SafetyMonitor.ts      # Safety monitoring & protective stop
│   └── types.ts
├── compliance/
│   └── ComplianceLogClient.ts # HTTP client for server compliance API
├── vla/                       # VLA inference client (gRPC)
│   ├── vla-client.ts          # gRPC client for VLA inference server
│   ├── vla-controller.ts      # VLA action execution controller
│   ├── vla-model-manager.ts   # Model loading & switching
│   ├── action-buffer.ts       # Action buffering & smoothing
│   ├── action-interpolator.ts # Interpolation between actions
│   ├── metrics.ts             # Inference metrics collection
│   ├── types.ts
│   └── proto/                 # Local proto copy
└── prompts/
    └── robot_agent.prompt # AI system prompt template (Dotprompt)
```

### File Header Convention

Every source file has a top-of-file header block. TypeScript uses a JSDoc
block, Python uses a module docstring. Both should include an `@status`
tag so future readers can tell live code from orphaned/dead code at a
glance:

```ts
/**
 * @file skill-executor.ts
 * @description Closed-loop skill executor — observe → predict → execute
 * @feature vla
 * @status live
 */
```

```python
"""
vla_runner.py — Thread-based VLA control loop at 5 Hz.
@status live
"""
```

**`@status` values:**

| Tag | Meaning |
|---|---|
| `live` | Reachable from a real entry point and runs in normal use |
| `live-conditional` | Live only when an env var / feature flag is on (e.g. `FEDERATED_ENABLED`, hardware sidecar present) |
| `test` | Test file (`*.test.ts`, `hardware/tests/test_*.py`) — CI only |
| `orphaned` | Imported/referenced by live code but no caller or launcher exercises it — broken wire |
| `dead` | No importer, no caller anywhere. Safe to delete. |

When adding a new file, tag it. When moving code from live to orphaned
(or vice versa), update the tag. `scripts/annotate-status.mjs` handled
the initial bulk pass; subsequent maintenance is manual.

## AI Tools (Genkit)

All 8 tools are registered with Genkit and available to the AI agent:

### Navigation (4 tools)

| Tool | Input | Description |
|------|-------|-------------|
| `moveToLocation` | `{ x?, y?, zone? }` | Move to coordinates or named zone. Resolves zone names via server zone API (cached 60s). Validates against restricted zones. |
| `stopMovement` | `{ reason? }` | Stop current movement |
| `goToCharge` | `{ priority? }` | Navigate to charging station (fetched from server zones) |
| `returnHome` | `{ priority? }` | Navigate to home position |

### Manipulation (2 tools)

| Tool | Input | Description |
|------|-------|-------------|
| `pickupObject` | `{ objectId }` | Pick up an object (validates payload capacity) |
| `dropObject` | `{ gentle? }` | Drop held object |

### Status (2 tools)

| Tool | Input | Description |
|------|-------|-------------|
| `getRobotStatus` | `{ verbose? }` | Get full robot status, battery, location |
| `emergencyStop` | `{ reason? }` | Immediate emergency stop |

### Zone Resolution

Navigation tools fetch zones from `GET {serverUrl}/api/zones` and derive named locations from zone center points. Results are cached for 60 seconds. Fallback locations when server is unavailable: `home: {x:0, y:0}`, `charging_station: {x:5, y:20}`.

## Simulation Engine

The simulation runs at **100ms tick intervals** with these behaviors:

- **Movement**: Interpolates position towards target at 2.0 units/second
- **Heading**: Computed as `atan2(dy, dx)` in degrees
- **Battery drain**: 0.01%/s idle, 0.02%/s while busy
- **Battery charge**: 0.5%/s when at charging station
- **Battery warnings**: Warning at < 20%, error state at < 5%
- **Telemetry**: Full sensor suite (sonar, bumpers, IMU, motor currents, gripper) + joint states

### Joint Animations

- **H1 (humanoid)**: 19-joint walking gait animation at 2.0Hz cycle; idle sway at 0.3Hz
- **SO101 (arm)**: 6-joint working/holding/rest poses at 0.5Hz cycle

## Task Queue (Server-Pushed)

The robot accepts tasks pushed from the server's `TaskDistributor`:

- **Max queue size**: 5
- **Priority order**: critical(4) > high(3) > normal(2) > low(1)
- **Supported actions**: `move_to_location`, `pickup_object`, `drop_object`, `charge`, `return_home`, `wait`, `inspect`, `custom`
- **Rejects tasks** when robot is in `error` or `maintenance` state

## Key Endpoints

### A2A Protocol

- `GET /.well-known/agent-card.json` - Robot agent card
- `POST /` - A2A message handler (via SDK)

### REST API (`/api/v1`)

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/robots/:id` | Get robot details |
| POST   | `/api/v1/robots/:id/command` | Send command |
| GET    | `/api/v1/robots/:id/telemetry` | Get current telemetry |
| POST   | `/api/v1/robots/:id/tasks` | Accept pushed task (202) |
| GET    | `/api/v1/robots/:id/tasks` | Get task queue |
| DELETE | `/api/v1/robots/:id/tasks/:taskId` | Cancel task |
| POST   | `/api/v1/robots/:id/reset` | Reset robot state |
| GET    | `/api/v1/robots/:id/pointcloud` | Depth/LiDAR point-cloud frame (`?sensor=`, `?full=`) |
| GET    | `/api/v1/robots/:id/map/cloud` | The robot's own 3-D world cloud (TASK-211): the lidar frames the grid integrated, one point per voxel, ODOMETRY frame. `?max=N` even-stride sample (default 80000, 0 = all) as base64 Float32 xyz; `?format=pcd` / `?format=ply` download the whole cloud. Also on the `/agent` Map tab (3D view + Export). 404 when `AGENT_CLOUD_ENABLED=false` or nothing integrated |
| GET    | `/api/v1/robots/:id/map` | The robot's own 2-D occupancy grid (TASK-206) in the ODOMETRY frame: `grid` (int8 log-odds, base64), `pose`, `place`, keepout polygons when the place graph is registered, `peers` + `peersDropped` (TASK-207), `nav` (the navigator's planned route, TASK-208), `frameId`, `status`; `?format=pgm` / `?format=yaml` for a ROS `map_server` pair (save both as `map.pgm` + `map.yaml`; loads in RViz / Nav2 / Foxglove) — the `/agent` page's Map tab has the same as an **Export** menu (PGM+YAML, PNG, JSON), computed in the browser from the JSON grid (TASK-210). 404 when `AGENT_MAP_ENABLED=false` |
| GET    | `/api/v1/register` | Registration info for server |
| GET    | `/api/v1/health` | Health check |

### WebSocket

- `ws://localhost:41243/ws/telemetry/:robotId` - Real-time telemetry (every 2s) + alerts on state change
- `ws://localhost:41243/ws/pointcloud/:robotId` - Binary point-cloud stream (~3 Hz)

### Point-cloud sources (G1 / G1-EDU)

`getPointCloudFrame()` picks a source in priority order: **hardware** (live Livox/
RealSense via the sidecar when connected) → **replay** (real recorded scans) →
**sim** (synthetic generator). Every frame is tagged with `source` so the UI shows
real vs. synthetic.

To feed **real recorded LiDAR** (KITTI `.bin` or PCD ascii/binary/binary_compressed):

```bash
./scripts/fetch-sample-pointclouds.sh   # downloads real Unitree + KITTI scans (gitignored)
POINTCLOUD_REPLAY_FILE=data/pointclouds-real/unitree-mid360.pcd npm run dev:g1
# or a directory (cycles through frames):
POINTCLOUD_REPLAY_DIR=data/pointclouds-real npm run dev:g1
```

Parsers live in `src/robot/pointcloud-formats.ts`; replay/normalization in
`src/robot/pointcloud-replay.ts`. The Python sidecar honors the same data via
`G1_POINTCLOUD_REPLAY` (see `hardware/pointcloud_replay.py`).

### Occupancy map (Agent Mode, TASK-206)

The robot builds its own 2-D log-odds grid from the SAME clouds Agent Mode range
sensing snapshots — `src/agent-mode/occupancy-map.ts` (pure grid),
`occupancy-map-keeper.ts` (pose pairing, boot-id session, persistence, walk-time
sweep), tapped from `RangeSensor.onFrame`. Firewall: the map is fed ONLY by
`hardwareClient.snapshotPointCloud` — never by `getPointCloudFrame()`, whose sim
fallback fabricates a room. No pose → no update; a pose older than 750 ms is
re-sampled (`hardwareClient.samplePoseNow()`), never trusted. The grid lives in
the odometry frame and is persisted under the sidecar's `/health.boot_id`, so a
sidecar/sim restart (which re-zeroes odometry) starts a fresh map instead of
lying by metres. Config: `AGENT_MAP_*` (see `.env.example`); read it at
`GET /api/v1/robots/:id/map`; a `{knownCells, occupiedCells, lastIntegratedAt}`
summary rides in the mirrored `AgentModeState.map`.

### World point cloud (TASK-211)

`src/agent-mode/world-cloud.ts` (`WorldCloud`) rides on the same keeper: every
frame the grid integrates is also placed in the odometry frame (planar pose, z
as measured, floor at 0) and merged one point per 5 cm voxel — the voxel CENTRE
is stored, so the float32 snapshot round-trips exactly. It never carves; a
voxel disappears only when (a) the cloud is over `AGENT_CLOUD_MAX_POINTS` and
it is the oldest-seen, or (b) `purgeFreed()` — every 5th integration, within
lidar reach — finds its (x, y) cell now confidently FREE in the grid and its z
inside the grid's height band. That is how a carried-away crate leaves the
cloud while a ceiling point over free floor stays. Persisted as
`AGENT_CLOUD_PATH` next to the map, same boot-id rules, restored on first
read; served by `GET /map/cloud` (JSON sample / PCD / PLY), proxied by the
server at `GET /api/robots/:id/agent-mode/map/cloud`, shown on the `/agent`
Map tab's 3D view. It replaces the hand-driven digital-twin scan sessions for
Agent Mode robots — the cloud is a by-product of every run.

### Fleet peers on the map (TASK-207)

`src/agent-mode/peers.ts` (`PeerTracker`) polls the server's
`GET /api/robots/:id/peers` every `AGENT_PEERS_POLL_MS` (2 s; 0 = off) and keeps
the other robots' last poses. Every peer carries the frame its pose is in
(`location.frame` on `GET /api/v1/robots/:id`, from
`hardwareClient.getOdometryFrame()`: `{kind:'sim', id:<scene>}` for `sim_node.py`,
`{kind:'odom', id:<boot_id>}` for a real sidecar, `null` without one). A peer whose
frame differs from ours — or has none — is DROPPED and counted (`peersDropped`),
never drawn in the wrong place; two real robots therefore never see each other
until someone builds cross-robot registration, which is the honest answer.
Accepted peers go into the map's dynamic overlay
(`OccupancyMap.setDynamicObstacles`, discs of `footprintRadiusM + 0.25`;
`isTraversable()` consults it after the static grid, the log-odds cells never
remember a robot) and, when within `AGENT_PEERS_NOTICE_M` and inside ±90° of
heading, into scene memory as `robot <name>` with `distanceSource: 'fleet'`, so
the planner can talk about them. Peers are also on `/map` and, through the server
proxy `GET /api/robots/:id/agent-mode/map`, on the `/agent` page's Map tab.

**Known gap (follow-up, not TASK-207):** the fleet's `Zone` (server, axis-aligned
rectangles on the fleet map) and the digital twin's `TwinZone` / place-graph
keepouts (polygons, what `/map` and the planner use) share no key and are not
reconciled — a keepout drawn on the fleet map is not a keepout on the robot's map
and vice versa. Until a task maps one onto the other, the robot's map is the
authority for what the robot will refuse to plan through.

### The navigator plans on the map (TASK-208)

`src/agent-mode/path-planner.ts` is pure grid A* (8-connected, octile heuristic,
no corner cutting) over the live `OccupancyMap`: occupied cells within the robot's
footprint radius, the peers' discs and the place graph's keepouts (inflated by
`PLACE_KEEPOUT_MARGIN_M` + one cell) are walls; UNKNOWN cells cost
`AGENT_NAV_UNKNOWN_COST` × (default 3) so seen floor is preferred but unexplored
floor is still crossable. Hard budget 20 000 nodes / 50 ms → "no path known",
never a guess. The path is string-pulled so a straight corridor is one segment.
Keepouts are only fed in when the place graph's frame is registered to odometry
(`getPlaceFrameRegistration()`), exactly like the geofence and `/map`.

`Navigator` (`navigator.ts`) with `AGENT_NAV_PLANNER=grid` (default when the map
is on): the target's goal pose comes from a MEASURED distance (`lidar` or `fleet`;
a `vlm-estimate` is not a pose) projected into odometry and kept across stages, so
walks between looks are steered by odometry, not by a re-guessed bearing. Each
stage: sample a fresh pose, re-plan, turn onto the first segment, walk ≤
`AGENT_NAV_MAX_SEGMENT_M` (2 m; walk blocks carry `planned: true`), and look only
when `AGENT_NAV_LOOK_EVERY_M` (2 m) has gone by, the map ahead is unknown, or the
plan is running out — the final approach (inside the plan's stand-off tolerance,
`ARRIVAL_M` + robot radius) is the measured staged rule. A goal is refused BEFORE
the first step when no stand-off spot around it is outside a keepout:
`"<label> is inside keepout <PLACE> — I won't walk there."` — a target ON a
fenced surface ("go to the table") is fine, the robot stands 0.6 m off it. No
path / no map / no pose → the pre-map staged loop with "walking by sight" in
the block reasoning. Every plan is reported through `onNav` →
`AgentModeState.nav` + `/map.nav` (the Map tab draws the polyline) and
`AgentBlock.nav` on the `goto` block ("planned 3.2 m in 2 segments").

`goto` also takes a PLACE (TASK-209): `{"place": "Kitchen"}` — a room or area of
the place graph, resolved by id or name (`resolvePlaceByName`, any case, `-` as
space, "the kitchen" fine; unknown → the message lists the known places). The
planner prompt carries `Places on the map (use goto with "place" …): Hallway
(here), Kitchen, …` (non-keepout, floor 0, registered frame only).
`Navigator.navigateToPlace` plans to the room's centre (`placeGoal`: centroid, or
the deepest interior point of a concave room) and walks the plan in stages with
a look every `AGENT_NAV_LOOK_EVERY_M`; with no path yet it walks ONE bounded
stage by sight and re-plans (the map grew — that is how a doorway is found), and
with an EMPTY map it looks once first (the frame restores the persisted map).
Arrival = pose inside the polygon by 0.3 m (`PLACE_ENTRY_MARGIN_M`, the
resolver's hysteresis) and ≤ 1.0 m (`PLACE_ARRIVAL_M`) from the centre — or
inside and stalled, when furniture stands on the centre: `"Arrived in Kitchen
after 7 stages and 5.01 m — the pose is 0.60 m from its centre."`. Progress is
the REMAINING PLANNED LENGTH while a route exists (leaving the kitchen for the
living room walks away from the living room first). Keepout places are refused
by name; a fenced centre names the fence. The planner keeps
`AGENT_NAV_PATH_MARGIN_M` (0.05) beyond the footprint radius and the pre-walk
check classifies by the same cell centres — the two once disagreed by one ulp on
a crate and the robot re-planned the same refused segment three times.

`BlockExecutor.walk` checks EVERY forward walk — the planner's own too — against
the same world (`checkStraightSegment`, 0.1 m samples): a keepout, occupied cell
or peer ahead shortens the walk ("Stopped 1.60 m short of the requested 3.00 m — Table footprint keepout
ahead at 1.40 m on the map") or refuses it inside `MIN_STAGE_M`; no map/pose/
keepouts → nothing is said, never a false "clear". And the old escape is closed:
a clearance the robot has TURNED away from is remembered as unknown-ahead
(`SceneMemoryStore.wasClearanceExpiredByTurn()`), so "turn 45°, walk 3 m" is
capped at the blind stage (1 m, or as far as the map knows to be free) unless the
walk is a `planned` navigator segment. `geofence.ts` / `SafetyMonitor` are
untouched — the reactive fence stays the last line of defence.

### Patrol (TASK-212)

The first complete Agent Mode **use case**: an operator-defined route (checkpoints =
place ids of the robot's place graph) walked on a server-side schedule, a control
photo at every checkpoint, and everything the robot sees on the way compared
against a baseline of "normal". Opt-in: `AGENT_PATROL_ENABLED=true` (the
`.env.g1-edu-agent-house` profile has it on). Code: `src/agent-mode/patrol.ts`
(`PatrolRunner`, `PatrolRouteSource`, `PatrolRunStore`, preconditions, leg plan),
`baseline.ts` (`BaselineStore`), `inspector.ts` (pHash gate, checklist, label diff,
map diff, `Confirmer`), `block-executor.ts` (`capture` / `inspect`), the controller's
`startPatrol()` / `abortPatrol()`.

**One patrol = one Agent Mode plan** (`command: "patrol: <route name>"`): a leading
`patrol` block that stays running while the legs run and gets the summary as its
result, the spoken start notice ("Starting patrol; I take reference photos." — the
transparency obligation), then per checkpoint `goto{place}` → `capture` (when the
checkpoint captures) → `inspect` (patrol mode) → `wait` (dwell) → `scan_room`
(scan), and `goto{home}` when the route (or `AGENT_PATROL_HOME_PLACE`) names one.
Every leg runs through the same executor as an operator `goto`, so E-Stop,
geofence, the pre-walk map check, mirror and compliance record apply unchanged.
**Leg semantics:** a failed leg (its `goto` failed) is skipped and reported, the run
continues; two consecutive failed legs abort the route and still go home; an
E-Stop / teleop takeover aborts like any plan (no home); an **operator command
during a patrol aborts the run** and then runs as a fresh plan.

**Fail closed.** `POST /robots/:id/agent-mode/patrol {routeId, mode?, origin?, route?}`
answers `PatrolStartResult` — a refusal is `{accepted:false, reason, message}` with
`reason ∈ disabled|estop|busy|battery|place_unknown|damped|crash_unacknowledged|window|
route_unknown|no_places|running`, and is ALSO recorded as a `skipped` run and
announced with `agent:patrol:finished`, so the server persists it and alerts. A
`scheduled` run passes `mayInitiate('goto', 'scheduled', …)` (battery ≥ 20 %, place
known and fresh, armed, not damped, crash acknowledged) plus the route's time
window; an `operator` run passes the initiative gate but is still refused damped.

**Comparison** — accurate at checkpoints, cheap in between:
- `capture`: align to the stored heading (measured turn), one frame; in patrol
  mode a **perceptual-hash gate** (`AGENT_PATROL_HASH_GATE`, 0.97 — at 0.92 a crate 4.5 m ahead still passed as unchanged) against the
  baseline photo of that checkpoint × window — alike ⇒ `unchanged`, stored, **no
  model call**; otherwise **ONE** checklist VLM call (`CHECKLIST_PROMPT`: person,
  door, object on floor, lights, out of place, operator expectations, one line).
  The JPEG is stored **only when `personPresent === false`** — data minimisation
  by not storing. Baseline mode always runs the checklist and records photo +
  answers + the leg label sets + the map snapshot at the end.
- `inspect`: item-by-item checklist diff vs the baseline (only changes toward
  "not normal"): personPresent→`person`, doorState→`door_open`, objectOnFloor→
  `object_on_floor`, lightsOn→`lights_on`, outOfPlace→`out_of_place`,
  expectations→`expectation_failed`. Confirms on its one observation.
- En-route, hooked into every look (`BlockExecutorDeps.onLook`), zero model calls:
  labels of the look vs the baseline leg's label set (watch-list
  `AGENT_PATROL_WATCHLIST`, substring, case-insensitive → `unexpected_object` /
  `person`), and cells FREE in the baseline map & OCCUPIED now within
  `AGENT_PATROL_DIFF_RADIUS_M` (6), 8-connected clusters ≥ `AGENT_PATROL_MIN_BLOB_M2`
  (0.15), not inside a tracked peer → `unexpected_object` at the centroid, place by
  polygon. Both are keyed type × place, so a semantic and a geometric sighting of
  the same crate become ONE finding (`source: 'enroute_both'`).
- `Confirmer`: N-of-M consecutive looks (`AGENT_PATROL_CONFIRM_N/M`, 2/3); one
  finding per type per place per run (later hits re-observe it →
  `agent:finding:confirmed`). A confirmed person: the robot says one line ("I am
  on patrol, please step aside." / DE) once per run and records the finding
  **without an image**.

**On disk** (`data/workspace-<robotId>/patrol/`, same atomic writes, temp sweep and
GDPR `erase()` as the rest of the workspace):
`<routeId>/baseline/<window>/{checkpoints.json,legs.json,map.json,accepted-blobs.json,<cp>.jpg}`
(window `default` when the route has none) and
`<routeId>/runs/<runId>/{run.json,findings.json,answers.json,<cp>.jpg}`. Storage
keys: `leg.photoKey` / `evidence.currentPhotoKey` = `<runId>/<checkpointId>.jpg`,
`evidence.baselinePhotoKey` = `<baselineRunId>/<checkpointId>.jpg`. Photos are
also uploaded to the server (`PUT /api/robots/:id/patrol-runs/:runId/photos/<cp>.jpg`,
JSON body, 10 s, 3 attempts; kind `control|baseline|finding`). Retention: plain
control photos 72 h (`AGENT_PATROL_PHOTO_RETENTION_H`), finding/baseline photos 30 d,
swept at boot and hourly.

**REST** (`/api/v1`): `POST /robots/:id/agent-mode/patrol`, `POST …/patrol/abort`,
`GET …/patrol` → `{enabled, active, lastRun}`, `GET …/patrol/runs?limit=`,
`GET …/patrol/runs/:runId` (+ `findings`), `GET …/patrol/runs/:runId/photos/<cp>.jpg`
and `GET …/patrol/baseline/:routeId/:window/<cp>.jpg` (both behind
`personalDataGate`), `POST …/patrol/findings/:id/normal {runId}` ("this is normal"
→ `BaselineStore.markNormal`), `POST …/patrol/runs/:runId/promote`, and
`GET /robots/:id/places` → `{places:[{id,name,placeType,keepout}]}` for the route
editor. Events: `agent:patrol:started|leg|finished` (with `patrol`),
`agent:finding:detected|confirmed` (with `finding` + `patrol`), all mirrored to
the server like every other Agent Mode event.

**Sim demo** (house scene, place ids `HALLWAY KITCHEN LIVING-ROOM BEDROOM WORKSHOP`):
`POST /sim/reset-pose {"body":"crate","x":4.5,"y":0.9}` moves the crate, and the
mocap `person` can now be moved the same way (`{"body":"person",…}`); baseline run
→ move the crate → patrol run → one finding. `demo_clip.py --layout patrol
--patrol-route ROUTE.json [--patrol-mode baseline]` records it (camera / map with
numbered checkpoints + red finding pins / baseline-vs-now photo pair).

### Host mode (TASK-213)

The second complete use case, and patrol's mirror image: patrol is the robot alone
at night, **host mode is the robot with a human in front of it**. A person walks up,
the robot greets them with the site's welcome, states that it is an AI, offers a
tour, and — if they accept — walks them to an ordered list of **stops**, says a
short authored piece at each one, optionally demonstrates a VLA skill, and answers
questions from facts an operator wrote. Opt-in: `AGENT_HOST_ENABLED=true` plus
`AGENT_TOUR_ROUTE_ID`. Code: `src/agent-mode/host.ts` (`TourRunner`,
`TourRouteSource`, `TourRunStore`, the phrasebook, the disclosure, the reply
matcher, preconditions, stop plan), `block-executor.ts` (`present` / `demo`),
`prompts.ts` (`buildVisitorAnswerPrompt`), the controller's `startTour()` /
`abortTour()` / `handleVisitorUtterance()` / `answerVisitorQuestion()`.

**One tour = one Agent Mode plan** (`command: "tour: <route name>"`): a leading
`tour` block that stays running while the stops run and gets the summary, then per
stop `goto{place}` → `present`×n (the talk track, chunked) → `demo` (when the stop
has one) → `wait` (the dwell, where questions are taken), and finally
`goto{greetingPlace}` + the farewell `speak`. Every leg runs through the same
executor as an operator `goto`. **Stop semantics:** a stop the robot cannot reach
is skipped and the tour goes on (a visitor is following it — walking them back to
the door because one aisle was blocked is worse); "shall we go on?" waits 30 s and
ends the tour `done` on a no or `abandoned` on silence; an E-Stop aborts the walk
home but the farewell is still spoken, because it moves nothing.

**Two things the LLM is used for, and only two**: answering an unscripted question,
and planning an unscripted sentence that is not part of a tour. Greeting, offer,
talk tracks, handovers, goodbye, yes/no and goodbye detection are **templates and
keyword matches** (`tourPhrase`, `matchVisitorReply`) — a 1.2 s planner round-trip
in the gap after a visitor stops talking is the one place a spoken interface cannot
afford it, and a model may not rephrase words an operator authored in front of a
guest.

**Grounded Q&A.** While a tour runs, an utterance never reaches the planner:
`handleVisitorUtterance` consults the pending question first (yes/no/goodbye by
keyword, both languages, no model), then queues anything else as a question. Each
question gets ONE model call against `buildVisitorAnswerPrompt` — the stop's facts,
the route's site card, the place note and the scene summary, and nothing else. The
model must name its source, and the run records `answered: grounded | from_camera |
declined | unanswered` per turn. **`declined` is the good failure**: an un-grounded
answer is a defect, and the UI surfaces declined turns as "facts to add".

**Fail closed.** `POST /robots/:id/agent-mode/tour {routeId, origin?, route?}`
answers `TourStartResult`; a refusal is `{accepted:false, reason, message}` with
`reason ∈ disabled|estop|busy|battery|place_unknown|damped|crash_unacknowledged|
route_unknown|no_places|no_stops|person_too_close|running`, and is ALSO recorded as
a `skipped` run and announced with `agent:tour:finished`. A `visitor`-origin tour
passes `mayInitiate('goto','self',…)` — the robot offered it, and an offer is an
initiative even though a human accepted.

**What host mode does NOT do**, and must keep not doing: it stores **no images and
no audio at all** (patrol's "drop the photo when a person is in frame" becomes
"never capture"), infers no age, gender or emotion (prohibited in a workplace under
the EU AI Act since Feb 2025), and identifies nobody. What persists is the text of
the visit under `workspace-<id>/tour/<routeId>/runs/<runId>/run.json`, swept after
`TOUR_TRANSCRIPT_RETENTION_DAYS`, erased with the workspace by an Art. 17 wipe.
The AI disclosure (`AI_DISCLOSURE` in `host.ts`) is appended to every greeting and
is reviewed like code — `TOUR_DISCLOSURE_EXTRA` can only add to it.

**Barge-in is not solved, and is not pretended.** The voice service is half-duplex:
the mic is muted from utterance-end until playback-end, so a visitor cannot
interrupt a sentence in flight. The mitigation is structural — `chunkTalkTrack`
splits a talk track into ≤2-sentence `present` blocks so the mic reopens between
them, a stop is capped at ~40 s of speech, and `stopp` (the stop word) remains the
always-available interrupt.

**Demos are honest.** `TOUR_DEMO_MODE=narrate` is the default because
`g1_apple_pnp_scene.xml` is a **fixed-base** G1 — the robot that walks a tour
physically cannot pick the apple in that scene. A narrated demo says out loud that
it is only describing the skill and reports `narrated`, never `done`.

Endpoints: `POST /robots/:id/agent-mode/tour`, `POST …/tour/abort`,
`GET …/tour` → `TourStatus`, `GET …/tour/runs`, `GET …/tour/runs/:runId` (gated by
`personalDataGate` — the transcript is what a member of the public said). Events:
`agent:tour:started|leg|turn|finished`, mirrored like every other Agent Mode event.

## Key Dependencies

| Package                 | Purpose                     |
| ----------------------- | --------------------------- |
| `@a2a-js/sdk`          | A2A protocol implementation |
| `genkit`                | Google AI framework         |
| `@genkit-ai/googleai`  | Gemini model integration    |
| `@grpc/grpc-js`        | gRPC client (VLA inference) |
| `@grpc/proto-loader`   | Protobuf loading            |
| `express`               | HTTP server                 |
| `ws`                    | WebSocket server            |
| `axios`                 | HTTP client (zone fetching) |
| `chokidar`              | File watching (config hot-reload) |
| `yaml`                  | YAML config parsing         |
| `async-mutex`           | Concurrency control         |

## Environment Variables

| Variable           | Default            | Description                    |
| ------------------ | ------------------ | ------------------------------ |
| `GEMINI_API_KEY`   | (required)         | Google Gemini API key          |
| `PORT`             | `41243`            | Server port                    |
| `SERVER_URL`       | `http://localhost:3001` | NeoDEM server URL     |
| `ROBOT_ID`         | `sim-robot-001`    | Unique robot identifier        |
| `ROBOT_NAME`       | `SimBot-01`        | Display name                   |
| `ROBOT_MODEL`      | `SimBot H1`        | Model string                   |
| `ROBOT_CLASS`      | `standard`         | `lightweight \| standard \| heavy-duty` |
| `ROBOT_TYPE`       | `h1`               | `h1 \| so101 \| generic`      |
| `MAX_PAYLOAD_KG`   | `10`               | Max payload capacity (kg)      |
| `ROBOT_DESCRIPTION`| (generic)          | AI prompt context              |
| `INITIAL_X`        | `10.0`             | Starting X coordinate          |
| `INITIAL_Y`        | `10.0`             | Starting Y coordinate          |
| `INITIAL_ZONE`     | `Warehouse A`      | Starting zone name             |
| `INITIAL_FLOOR`    | `1`                | Starting floor                 |

### Pre-configured Profiles

| File          | Robot     | Class       | Type  | Port  | Payload |
| ------------- | --------- | ----------- | ----- | ----- | ------- |
| `.env`        | SimBot-01 | standard    | h1    | 41243 | 10kg    |
| `.env.light`  | NimbleBot | lightweight | h1    | 41243 | 5kg     |
| `.env.heavy`  | TitanBot  | heavy-duty  | h1    | 41244 | 50kg    |
| `.env.so101`  | ArmBot    | lightweight | SO101 | 41245 | 0.5kg   |

## Voice Service (`voice/`)

Standalone, robot-agnostic Python service for spoken interaction with any
A2A agent: mic → Silero VAD → faster-whisper (CUDA) → A2A `message/send` →
Piper TTS → speaker. Fully local (LLM via Ollama). Own uv venv (Python
3.12), HTTP control API on `:8768` (health/status/config/say/events SSE).
Audio backends: `local` (PC) and `g1` (Unitree G1 mic-multicast + speaker
adapter on `:8766`). See `voice/README.md`; real-robot validation is
TASK-181.

```bash
cd voice && uv sync && uv run python scripts/download_models.py
uv run python -m voice_service          # talk to the g1-edu agent (:41244)
uv run pytest                            # unit tests (no GPU/mic needed)
```

## Related Documentation

- `voice/README.md` - Voice interaction service
- `../server/AGENTS.md` - Server documentation
- `../app/AGENTS.md` - Frontend documentation
- `../docs/architecture.md` - System architecture
