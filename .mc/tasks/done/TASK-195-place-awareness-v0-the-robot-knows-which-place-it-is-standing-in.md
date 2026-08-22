---
id: TASK-195
aliases:
- TASK-195
title: Place awareness v0 — the robot knows which place it is standing in
slug: place-awareness-v0-the-robot-knows-which-place-it-is-standing-in
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- g1
- agentmode
- sim
sprint: ''
depends_on: []
due_date: ''
created: 2026-08-02
updated: 2026-08-02
status_note: 'CLOSED 2026-08-02 — merged as part of PR #216 (squashed to 4a9a7f2).
Verified live on GPU_BOX against the warehouse scene with the real planner
(gemma4:e2b) and VLM (qwen2.5vl:7b), checking every claim against the
simulator''s own odometry and a point-in-polygon over places.warehouse.json
rather than against the agent''s word:
- boot resolved UNKNOWN -> STAGING at (0.00, 0.00);
- a 3 m walk committed STAGING -> AISLE-1 at x=3.001, claim == truth;
- at (3.16, -5.00), on floor no polygon covers, the belief went to NULL rather
  than holding the last place. That is the honesty rule this task was written
  around, exercised without fault injection.
KNOWN LIMITATION, not a regression: `goto` resolves entities from scene memory,
so no surveyed place is reachable by name — `goto {entity: "charging bay"}`
fails with "not in the scene memory — scan the room first". Honest, but it
means the place graph informs answers and the geofence, not navigation. A
place-directed `goto` would be its own task.'
---


# Place awareness v0 — the robot knows which place it is standing in

## Description

Give the robot-agent a continuously maintained answer to **"where am I?"** — a metric pose in
a named frame, the **place** that pose falls in (`AISLE-3`, `DOCK-1`, `CHARGING-A`), and an
honest confidence in both. Today the robot can say *"there is a table 2.1 m at bearing 40°"*
but not *"I am in aisle 3"*, and on real hardware **nothing writes `state.location`** — the
fleet-map marker is fabricated by a simulation loop.

This is the substrate for the persistent-agent work that follows (TASK-196 durable safety
state, TASK-197 memory workspace, TASK-198 identity, TASK-199 heartbeat): memory becomes
place-keyed instead of a flat log, the heartbeat gets its most important predicate
("I don't know where I am → do nothing"), and the declared-but-unimplemented
`zone_violation` safety stop becomes expressible.

Scope is one branch, one PR: a new **warehouse MuJoCo scene**, a place-graph file format, a
pose→place resolver with hysteresis and a drift budget, pose plumbing from the existing 2 s
hardware poll, and the place rendered in the Agent Mode scene summary and UI.

**Read this first:** the design is deliberately *read-only and additive*. It adds no timer, no
new actuation path and no new autonomy. It cannot make a real G1 more dangerous. Keep it that
way — proactive behaviour is TASK-199 and it is gated on TASK-196 landing first.

## Details

### Design decisions (settled — do not re-litigate during implementation)

| Topic | Decision |
|---|---|
| Vocabulary | **Industry-first.** `placeType` is a closed set: `aisle \| rack_face \| dock \| staging \| cell \| charging \| corridor \| office \| unknown`. House/room types are a later additive extension, not an abstraction to design for now. |
| Storage | **Robot-local file**, `places/_index.json` in the agent workspace. No Prisma model, no server dependency — Agent Mode's contract is that a down server never stalls a block. |
| Geometry | 2D polygon, point-in-polygon (ray cast). **Plus an explicit `floor` predicate** — `RobotLocation` already carries `floor` and `Zone` is unique on `[name, floor]`; two places with the same footprint on different floors must not collide. |
| Pose source | The **existing 2 s `HardwareClient` poll** (`hardware/HardwareClient.ts:375 startPolling`, `POLL_INTERVAL_MS = 2000`), **not** the block executor. See "Why not the block executor" below — this is the single most important call in this task. |
| Unknown | `null` place means UNKNOWN and is **never** silently replaced by the last known place. This is the same honesty rule `scene-memory.ts` already lives by (`distanceSource: 'lidar' \| 'vlm-estimate' \| null`). |
| Hysteresis | A place change requires **two consecutive resolves** inside the new polygon **and** ≥ 0.30 m inside its boundary. Aisle mouths and dock thresholds are exactly where a naive resolver flaps. |
| Drift | After `PLACE_DRIFT_BUDGET_M` (default 15 m accumulated translation) without a re-anchor, place degrades to `stale` and says so. Re-anchor v0 is an operator utterance only. |
| VLM | The vision model is a **corroborator, never an authority**. A contradiction downgrades confidence and is logged; it never overrides the geometry. Do **not** bolt place classification onto the existing entity-list vision prompt — a bad label there corrupts navigation. |
| Planner prompt | **One line** added to `scene.summary()`. `gemma3:4b` is on the latency path and prompt length is a measured regression risk in this repo (`mergeSplitReasoningBlocks` and `enforceTurnDirection` exist because of it). Budget it and gate on the existing `planner.test.ts`. |
| Frame | The place file declares its frame explicitly (`units: 'm'`, `yawConvention: 'deg,+x=0,CCW+'`) and the resolver asserts it. Unit confusion is a live hazard here — `PointCloudPose.yaw` is radians, Agent Mode is degrees, converted in exactly one place at `robot/state.ts:579`. |
| Twin binding | **Out of scope.** Real-site place graphs derived from `DigitalTwin`/`TwinZone` are TASK-200. v0 ships a hand-authored graph for the new warehouse scene. |

### Current state (verified 2026-08-02, not assumed)

- `agent-mode/block-executor.ts:304/307` (walk) and `:355/:363` (turn) already call
  `loco.odometry()` **before and after** every motion block and already fail the block on zero
  measured motion. The `(x, y)` is right there and **only the scalar Euclidean delta is kept**.
- `agent-mode/scene-memory.ts` has `yawDeg` (:167) and `translationSinceObservationM` (:186)
  and **no position field of any kind**, so nothing observed survives a walk.
- `hardware/HardwareClient.ts:958 getLocoOdometry()` has a **2 s timeout and returns `null`**
  on any hiccup. Null pose is a routine event on this stack, not an exception.
- **There is already a competing writer of `location.zone`.** `robot/state.ts:840
  startSimulation()` calls `this.simulation.start()` **unconditionally** — it is invoked from
  `index.ts:88` with no hardware check. `SimulationEngine.tick()` then runs every 100 ms and
  `updateZoneTracking()` (`SimulationEngine.ts:245`) writes `s.location.zone` at `:286` from a
  frozen simulated position against the fleet `Zone` AABBs — **10 times a second, while a real
  robot walks**. Its enter/exit events are `console.log`'d and go nowhere.
- `robot/zoneUtils.ts isPointInZone()` and `server/src/storage/pgm.ts fillPolygon` are two
  existing point-in-region implementations to reuse rather than reinvent.
- `robot/StatePersistence.ts` writes `data/state-<robotId>.json`, `CURRENT_VERSION = 1`,
  500 ms debounce, `saveSync` on SIGTERM. This is the storage pattern to follow.
- `server/prisma/schema.prisma:20` — `location` is a **JSON string**, so adding a field to
  `RobotLocation` needs **no migration**.

### Why not the block executor (read before writing any code)

Sampling pose at `block-executor.ts:307/:363` is the obvious move and it is **wrong**. Teleop
and VLA rollouts drive the robot through paths that never touch `BlockExecutor`, so a place
derived from block completions will confidently assert the robot is in `STAGING` while a human
teleoperated it into `AISLE-3`. This is the same class of bug as the already-known
"motion from outside Agent Mode is invisible to the scene store".

Sample instead in the `HardwareClient` 2 s poll and push through `RobotStateManager` (which
already subscribes to `controlOwnerLock` at `robot/state.ts:302`). Then place is correct under
teleop, under VLA, and while the agent is idle — for free.

### Robot Agent

**1. Warehouse sim scene — `hardware/sim_evaluator/mjcf/g1_warehouse_scene.xml` (NEW)**

There is no industrial scene in the repo (`mjcf/` holds house, room, two pick-and-place and an
SO-101 tabletop). Author one, modelled on `g1_dex3_house_scene.xml`: same kinematically driven
3-DOF pelvis, same colour-coded landmark convention, boxes only — no meshes.

Layout, 20 m × 12 m hall, robot spawns at `(0, 0)` facing `+x` in `STAGING`:

| Place id | Type | Footprint |
|---|---|---|
| `STAGING` | `staging` | x[-2, 2] y[-2, 2] — spawn |
| `AISLE-1` / `AISLE-2` / `AISLE-3` | `aisle` | three 2.0 m corridors between racking, running along +y |
| `DOCK-1` | `dock` | one end wall with a roller-door gap |
| `CHARGING-A` | `charging` | a marked bay off staging |
| `CROSS-AISLE` | `corridor` | the remainder |

Put the **exact bounds in a header comment**, as the house scene does — that comment is the
ground truth the place graph is transcribed from and the test scores against.

**2. Place graph — `hardware/sim_evaluator/mjcf/places.warehouse.json` (NEW)**

```jsonc
{
  "version": 1,
  "frame": { "id": "warehouse-sim", "kind": "sim", "units": "m",
             "yawConvention": "deg,+x=0,CCW+" },
  "places": [{
    "id": "AISLE-3", "name": "Aisle 3", "placeType": "aisle", "floor": 0,
    "polygon": [[6.0,-4.0],[8.0,-4.0],[8.0,4.0],[6.0,4.0]],
    "source": "surveyed",          // surveyed | observed | declared
    "keepout": false,
    "landmarks": []                 // {label, x, y, source, lastSeen} — populated later
  }]
}
```

Also ship `places.house.json` transcribed from the bounds already in the
`g1_dex3_house_scene.xml` header comment. It is ~20 lines, it costs nothing, and it gives the
resolver a second independent fixture on day one — cheap insurance that the format is not
overfitted to one scene.

**3. `agent-mode/place-resolver.ts` (NEW, ~150 lines)**

Pure function plus a small hysteresis state object. No I/O, no model calls, fully unit-testable.

```ts
resolvePlace(pose: { x: number; y: number; floor?: number } | null): PlaceResolution | null
```

- `null` pose ⇒ `null` result. Never fall back to the last place.
- Point-in-polygon (ray cast, reuse the `zoneUtils`/`pgm.ts` implementation) **with the floor
  predicate applied first**.
- Two consecutive resolves + ≥ 0.30 m inside the boundary before a transition commits.
- Track accumulated translation since the last anchor; past `PLACE_DRIFT_BUDGET_M`, set
  `confidence: 'stale'`.

**4. Pose plumbing**

- `agent-mode/scene-memory.ts` — add `poseM: {x, y} | null` and
  `poseSource: 'odometry' | 'dead-reckoning' | 'declared' | null` with `setPoseM(x, y, source)`,
  mirroring the existing `setYawDeg`/`yawSource` pair exactly, including the null semantics.
- `hardware/HardwareClient.ts` — cache the odometry read already made on the 2 s poll and
  expose it; do not add a second poll.
- `robot/state.ts` — write `{x, y, heading, place}` into `RobotLocation` from the cached pose.
  **Resolve the competing writer:** gate `SimulationEngine.updateZoneTracking()` on
  `!hardwareClient.isConnected()`, or make the resolver its only input. Decide and write the
  decision down — as it stands the resolver's answer is clobbered every 100 ms.

**5. Render — one line, one place**

`agent-mode-controller.ts:790 plannerSceneSummary()` is the **single existing memory→prompt
funnel**. Add one line at the top of `scene.summary()` and `toMarkdown()`:

```
You are in AISLE-3 (surveyed map; pose from odometry, 3.2 m since last anchor).
```

and, when there is no pose:

```
Place unknown — no pose.
```

**6. Config — `src/config/config.ts`**

`PLACE_GRAPH_PATH`, `PLACE_DRIFT_BUDGET_M` (default 15), `PLACE_HYSTERESIS_MARGIN_M`
(default 0.30), following the commented-measurement convention already used in that file.

**7. Fault injection — `PLACE_FAULT_NULL_POSE=true`**

A dev-only flag that makes the cached pose read as `null` while locomotion keeps working. This
exists because the obvious way to demo the honesty rule — killing the sidecar — also kills
`driveFor`, so the plan aborts and you get a *failed block*, not a clean "pose unknown" render
mid-walk.

### Frontend

`SceneMemory` gains `place: { id, name, placeType, confidence, source } | null`. This is a
**three-file wire change** per the header contract in `agent-mode/types.ts`:

- `robot-agent/src/agent-mode/types.ts`
- `server/src/types/agent-mode.types.ts`
- `app/src/features/agentmode/types/agentmode.types.ts`

Render it in the Agent Mode scene panel. `null` must render as **"Place unknown"**, visually
distinct from a known place — not as an empty string, and never as the last known place.

Budget a full `./scripts/test-all.sh` cycle for this, across all three packages.

### Server

**No changes.** `scene.md` is already served off `toMarkdown()` at
`robot-agent/src/api/rest-routes.ts:1164`, and `RobotLocation` is a JSON blob in Prisma, so
`place` rides along with no migration.

### Key files

| File | Change |
|---|---|
| `robot-agent/hardware/sim_evaluator/mjcf/g1_warehouse_scene.xml` | NEW — 20×12 m hall, bounds in a header comment |
| `robot-agent/hardware/sim_evaluator/mjcf/places.warehouse.json` | NEW — the place graph |
| `robot-agent/hardware/sim_evaluator/mjcf/places.house.json` | NEW — second fixture, from existing bounds |
| `robot-agent/src/agent-mode/place-resolver.ts` | NEW — pure resolver + hysteresis |
| `robot-agent/src/agent-mode/scene-memory.ts` | `poseM` / `poseSource` / `setPoseM`; place line in `summary()` + `toMarkdown()` |
| `robot-agent/src/hardware/HardwareClient.ts` | Cache odometry on the existing 2 s poll |
| `robot-agent/src/robot/state.ts` | Write pose + place into `RobotLocation` |
| `robot-agent/src/robot/SimulationEngine.ts` | Resolve the competing `location.zone` writer |
| `robot-agent/src/robot/zoneUtils.ts` | Generalise `isPointInZone` to polygons |
| `robot-agent/src/agent-mode/agent-mode-controller.ts` | Place line into `plannerSceneSummary()` |
| `robot-agent/src/config/config.ts` | Four new env vars |
| `robot-agent/src/agent-mode/types.ts` + server + app type files | `place` on `SceneMemory` (wire change) |
| `app/src/features/agentmode/` | Render place; "Place unknown" state |

## Test Strategy

**Unit (vitest, robot-free) — this is where the real coverage lives.**

- `place-resolver.test.ts`: point-in-polygon against both fixtures; floor predicate separates
  same-footprint places; `null` pose ⇒ `null` place; **last place is never resurrected**;
  hysteresis rejects a single-sample excursion across a boundary; two consecutive samples
  ≥ 0.30 m inside commits; drift budget flips `confidence` to `stale`.
- A **doorway/aisle-mouth flap test**: walk a synthetic path along an aisle boundary and assert
  zero transitions.
- `scene-memory.test.ts`: `setPoseM` null semantics mirror `setYawDeg`; the place line appears
  in `summary()` and `toMarkdown()` in both known and unknown states.
- `planner.test.ts` must still pass unchanged — it is the regression gate on prompt length.

**Integration (MuJoCo warehouse scene, 4 processes, no robot).**

1. Boot → `GET /api/v1/robots/<id>/agent-mode/scene.md` → *"You are in STAGING…"*. The spawn
   pose makes the very first frame a checkable claim.
2. Post an **explicit block sequence** to `/agent-mode/command` (walk/turn, not a free-text
   question) and watch `scene.md` cross into `AISLE-1` with no flapping at the mouth.
   *Do not script the demo around asking the planner "where are you?"* — `gemma3:4b` has no rule
   for answering questions about robot state, and this repo already contains a documented case
   of a planner instruction changing nothing in 2/2 runs.
3. `PLACE_FAULT_NULL_POSE=true` mid-walk → the line becomes *"Place unknown — no pose"* and
   **not** the last place.
4. Teleop the robot into another place **without Agent Mode** and confirm the place still
   updates. This is the test that proves the pose seam was chosen correctly; if it fails, the
   sampling point is wrong.

**Explicitly not a test:** scoring room classification against sim ground truth.
`sim_node.measured_pose()` returns `qpos` directly, so sim odometry has **zero drift** — feeding
ground-truth poses into a point-in-polygon function and reporting accuracy measures the polygon,
not the system. It will report 100% and mean nothing. Call the waypoint sweep what it is: a unit
test of the resolver.

## Out of scope / follow-ups

| | Why deferred |
|---|---|
| **TASK-196 — durable safety state** | The E-Stop latch and `damped` flag do **not** survive a restart, so a rebooted G1 is currently *more willing to move* than one that has been running. Worse, `SafetyMonitor.executeStop()` pushes an E-Stop string into `warnings`, which **is** persisted, while `latchedByEmergencyStop` is not — a rebooted robot shows an E-Stop warning it can never clear, without the latch that would refuse motion. **This must land before anything proactive.** Note `buildPersistedState()` hardcodes `version: 1` at `state.ts:317` instead of reading `CURRENT_VERSION`, and `isValidPersistedState` hard-rejects any other version with no migration path — bumping only the constant silently wipes every robot's persisted state on the next boot. |
| TASK-197 — memory workspace | `workspace-<robotId>/` with journal, `remember` block, trust tiering. Needs place first to be place-keyed. Blocked on the `ROBOT_ID` collision: `.env.g1-edu` and `.env.g1-edu-sim` **both** set `ROBOT_ID=g1-edu-4` and `PORT=41244`, so the sim and the real robot would share one workspace. |
| TASK-198 — identity | `IDENTITY.md` / `SOUL.md` / generated `BODY.md`. Deliberately after memory. Note `agent/agent-executor.ts:219` short-circuits to Agent Mode whenever it is enabled, so identity routed into `prompts/robot_agent.prompt` lands in a code path that does not execute under `dev:g1-edu-agent`. |
| TASK-199 — heartbeat | Two-tier proactive loop on the existing `idle-watcher.ts` clock. Gated on TASK-196. |
| TASK-200 — place v2, real sites | Bind to a `DigitalTwin` frame; `TwinZone` gains `type: 'room'` (and must be **excluded** from the Nav2 keepout raster); implement the declared-but-unimplemented `zone_violation` stop from `safety/types.ts:29`. First item needing the real robot and server changes. |
| GDPR | A place note in a customer facility is personal data on a device with no Prisma and no erasure hook — `GDPRRequestService.eraseUserData()` only touches rows keyed by `userId`. v0 stores **no free text**, only surveyed geometry, so it does not create the problem. TASK-197 does, and must ship an erasure path. |
