---
id: TASK-206
aliases:
- TASK-206
title: The robot builds its own 2D occupancy map from the (sim) LiDAR — and knows where it is on it
slug: robot-builds-a-2d-occupancy-map-from-the-lidar
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- agentmode
- g1
- sim
sprint: ''
depends_on: []
due_date: ''
created: 2026-08-15
updated: 2026-08-16
completed: 2026-08-16
status_note: |
  DONE 2026-08-16 — PR #224 (stacked; merged bottom-up with #223..#229). Verified in review pass 2026-08-16: OccupancyMap/MapKeeper/`GET /robots/:id/map`, sweep, persistence keyed on boot_id, config + banner, ScenePanel summary; vitest 54/54 (occupancy-map, keeper, range), sim test_lidar 5/5, e2e_map_check evidence PNG in repo. Live on the house scene: turn+walk fills 3.3k known cells, walls land on y=±1.5/±4.5, x=±6 as surveyed.
  DEVIATION: the state carries `map?: {knownCells, occupiedCells, lastIntegratedAt}` instead of `mapCells`/`mapAge` — same content, one field.
  FIXED IN REVIEW (08c5aff): the app drew the grid vertically mirrored (double y-flip in RobotMapPanel.drawMap); the Map tab crashed the whole /agent page on a fresh session's 0×0 grid (ImageData width 0).
  OPEN FOLLOW-UP (not fixed here, needs a real G1): `g1_sidecar.py` mints BOOT_ID once per sidecar process and never rolls it — a real robot whose odometry resets without a sidecar restart would restore a map into the wrong frame. Roll BOOT_ID on an odometry discontinuity (jump > ~2 m between consecutive samples) or on source re-establishment.
  POST-MERGE PASS 2026-08-16 (branch fix/post-merge-review-206-212): live re-verified on the house scene + a 26-finding review of the merged code. Fixed here: integrate() could grow the grid mid-frame while the per-cell de-dup Set was keyed on the old width (double votes, a wall left unknown for a frame); MapKeeper wrote grid+cloud SYNCHRONOUSLY inside the lidar frame listener and retried on every frame after a write error (now async off the frame path, per-file errors, sync write kept for shutdown); the map footer claimed "frame: odom" for a robot with no frame; a server 404 for an unregistered robot was reported as "does not publish a map (AGENT_MAP_ENABLED)".
---


# The robot builds its own 2D occupancy map from the (sim) LiDAR — and knows where it is on it

## Description

Give the robot-agent a persistent, robot-owned 2D occupancy grid that is accumulated from the
MID-360 point clouds Agent Mode already snapshots, expressed in the odometry frame, with the robot's
own pose and the place-graph keepouts drawn on it. Today the robot has **no map it builds itself**:
the LiDAR is used once per observation as "one range per bearing" and then thrown away, and the
robot's only notion of "where am I" is raw odometry inside a hand-authored polygon.

This is the first of three tasks (TASK-206 → TASK-207 → TASK-208) that turn the survey of
2026-08-15 into code: **map (this task)** → **other robots on the map (TASK-207)** → **plan on the
map (TASK-208)**.

## Details

### Current state (survey 2026-08-15)

**LiDAR is real in the MuJoCo sim, not Isaac.** `robot-agent/hardware/sim_g1_dds/sim_node.py`
casts a MID-360-shaped fan (`_cast_ray_fan` :321, `SimNode.cast_lidar` :835, 180 az × 32 rings,
elevation −52°…+7°, 0.35–25 m, robot geoms masked, hits rotated into `base_link`) and serves it as
`GET /pointcloud/mid360_lidar/snapshot` (:1214) with the **same JSON shape as the real sidecar**
`robot-agent/hardware/g1_sidecar.py` (`get_point_cloud` :1169, DDS `rt/utlidar/cloud_livox_mid360`).
Isaac (`hardware/isaac_loco_bridge.py`) has no lidar at all. Gaps: no pytest for `cast_lidar`;
`sim_g1_dds/README.md` never mentions `/pointcloud/*`.

**The agent consumes it reactively only.** `robot-agent/src/hardware/HardwareClient.ts:707
snapshotPointCloud()` → `robot-agent/src/agent-mode/range.ts` (`RangeSensor` :408 — ±8° cone,
0.35–12 m, height band 0.15–1.8 m, nearest cluster, 400 ms cache) → `block-executor.ts:612
observeAndMerge()` stores one distance per entity and `forwardClearanceM` in scene memory
(`scene-memory.ts:515`), invalidated by >10° turn or >0.15 m translation. Nothing accumulates.

**No map, no localisation.** `robot-agent/src/agent-mode/place-resolver.ts` (`PlaceGraph`,
`PlaceTracker` :339) resolves the odometry pose (`HardwareClient.onPoseSample` :539, 2 s poll,
`/state.odometry` or `/loco/odom`) into a named polygon with hysteresis. Drift is counted
(`PLACE_DRIFT_BUDGET_M`, default 15) but never corrected. `place-frame.ts:65
assessFrameRegistration()` treats only `frame.kind === 'sim'` graphs as registered to odometry.
`grep -r "occupancy\|costmap\|slam" robot-agent/src` → nothing. Occupancy PGMs exist only server-side
(`server/src/services/TwinExportService.ts`, `server/src/storage/pgm.ts`) and are consumed only by
`hardware/sim_evaluator/scene_builder.py`.

**Keepouts** come from the place graph (`geofence.ts`, `DEFAULT_KEEPOUT_MARGIN_M` 0.5) and only ever
trigger a reactive `zone_violation` protective stop (`safety/SafetyMonitor.ts:838`).

### What to build

#### Robot Agent

1. **`robot-agent/src/agent-mode/occupancy-map.ts`** (new, pure, no I/O) — `OccupancyMap`:
   - log-odds grid, `resolution 0.1 m`, growable bounds (start 20×20 m around the first pose,
     grow by doubling; cap at `AGENT_MAP_MAX_M`, default 60 m), frame = **odometry frame** (same
     frame `onPoseSample` reports; do NOT invent a registration to the place graph — on an
     unregistered frame the map still works, it just cannot be overlaid on twin zones).
   - `integrate(frame: PointCloudFrame, pose: {x,y,yawDeg})`: transform `base_link` points to
     odom, keep the same height band `range.ts` uses (0.15–1.8 m, reuse its constants — export
     them), mark hit cells `occupied` (+logodds), ray-trace from sensor origin to hit and mark
     `free` (−logodds, Bresenham). Points beyond `AGENT_RANGE_MAX_M` mark free along the ray only.
   - `cellAt(x,y) → 'occupied'|'free'|'unknown'` with thresholds; `isTraversable(x,y, radiusM)`
     (inflate by robot radius, default 0.35 m — same as the sensor blind radius / navigator margin);
     `toSnapshot(): {originX, originY, resolution, width, height, cells: Uint8Array|base64,
     poseCount, lastIntegratedAt}` and `toPgm()` for debugging.
   - Decay: a cell not re-observed for `AGENT_MAP_DECAY_S` (default 0 = off) drifts toward unknown.
     Needed later for moving obstacles; keep it a config knob.
2. **Wire integration into the existing snapshot path** — do **not** add a second poll loop.
   `RangeSensor.snapshot()` (`range.ts:498`) is the single place point clouds arrive; hand every
   fresh (non-cached) frame plus the current `CachedBasePose` to the map. Skip integration when the
   pose is `null` (honest-null rule: no pose → no map update, never "assume 0,0").
   Because the 2 s pose poll can be older than the cloud, expose the pose age on the snapshot and
   skip integration when `|now − pose.atMs| > 750 ms` (log once per minute, not per frame).
3. **Optionally add a lightweight background sweep** — `AGENT_MAP_SWEEP_HZ` (default 0 = off, 0.5 in
   the sim profile): while Agent Mode is *executing a walk*, take one extra snapshot per period so
   the map fills in between observations. Must reuse the `RangeSensor` cache/backoff so a slow
   sidecar is never hammered; disabled outright when `AGENT_RANGE_ENABLED=false`.
4. **Persistence** — save `toSnapshot()` to `data/occupancy-map.json` (path `AGENT_MAP_PATH`) on
   every 50th integration and on shutdown; load on boot **only if** the stored `frameId` matches
   (use the sidecar/sim boot id already surfaced in `/health` if present, else the odometry
   frame's `atMs` of first sample — the map is only valid for one odometry session; a sidecar
   restart re-zeroes odometry, so a stale map would be lying by metres). Mismatch → start empty,
   log why.
5. **Expose it** — `GET /api/v1/robots/:id/map` on the agent (`robot-agent/src/api/`), returning
   `toSnapshot()` plus `pose`, `place`, and the keepout polygons from the loaded place graph
   (`getPlaceGraph()` if registered, else `[]` with `registered:false`). Add `mapCells`/`mapAge`
   as **optional** fields to `AgentModeState` on all three hand-mirrored copies
   (`robot-agent/src/agent-mode/types.ts`, `server/src/types/agent-mode.types.ts`,
   `app/src/features/agentmode/types/agentmode.types.ts`) — optional so
   `isValidAgentModeSnapshot` (`server/src/services/AgentModeService.ts:43`) still accepts older
   agents; do NOT put the grid itself in the mirrored state (too big, 15 s re-push), only a
   summary `{knownCells, occupiedCells, lastIntegratedAt}`.
6. **Config** — `robot-agent/src/config/config.ts`: `AGENT_MAP_ENABLED` (default true when
   `AGENT_RANGE_ENABLED`), `AGENT_MAP_RESOLUTION_M` 0.1, `AGENT_MAP_MAX_M` 60, `AGENT_MAP_PATH`,
   `AGENT_MAP_SWEEP_HZ` 0, `AGENT_MAP_DECAY_S` 0. Document in `.env.example` and
   `.env.g1-edu-agent.example`; add to the startup banner next to the range line (`config.ts:479`).

#### Sim (`robot-agent/hardware/sim_g1_dds/`)

7. **`test_lidar.py`** (new pytest) — load `g1_dex3_room_scene.xml`, place the robot at a known
   pose facing the table, `cast_lidar()`, assert: returns >0 points; no point inside 0.35 m; the
   nearest cluster at bearing 0° is within ±0.1 m of the analytic distance to the table front;
   no self-hits (all points outside the robot's own bounding cylinder). Add it to `test-all.sh`'s
   pytest stage (it already runs the directory).
8. **README.md** — document `/pointcloud/sensors`, `/pointcloud/<name>/snapshot` (JSON shape,
   `source: "sim-ray"`, 503 semantics), `/pointcloud/lidar/switch` (no-op), and the geometry
   constants (`LIDAR_*` at `sim_node.py:90-182`).

#### Frontend (minimal — the real map UI is TASK-207)

9. `app/src/features/agentmode/components/ScenePanel.tsx` — one line under the clearance readout:
   "map: N cells known · M occupied · updated Xs ago" from the mirrored summary; hidden when the
   field is absent (older agent).

### Key files

- new: `robot-agent/src/agent-mode/occupancy-map.ts`,
  `robot-agent/src/agent-mode/__tests__/occupancy-map.test.ts`,
  `robot-agent/hardware/sim_g1_dds/test_lidar.py`
- modify: `robot-agent/src/agent-mode/range.ts` (export band constants, hook after `snapshot()`),
  `robot-agent/src/agent-mode/agent-mode-controller.ts` (own the map, summary into `getState()`),
  `robot-agent/src/api/` (new `GET /map` route), `robot-agent/src/config/config.ts`,
  `robot-agent/src/agent-mode/types.ts` + the two mirrors, `robot-agent/hardware/sim_g1_dds/README.md`,
  `app/src/features/agentmode/components/ScenePanel.tsx`
- do NOT touch `robot/state.ts getPointCloudFrame()` / `pointcloud-sim.ts` — that path can return a
  fabricated synthetic room; the map must only ever be fed by `HardwareClient.snapshotPointCloud`
  (same firewall rule `range.ts` follows).

### Out of scope (explicitly)

- Registering the odometry frame to a scanned twin / real site (TASK-200 out-of-scope, still true).
- Scan matching / SLAM / drift correction — the map inherits odometry drift; that is acceptable for
  the sim and for one indoor session, and it is *stated* on the `/map` payload (`frame: 'odom'`).
- Showing other robots (TASK-207) and planning on the grid (TASK-208).
- Unifying fleet `Zone` rectangles with `TwinZone` polygons.

## Test Strategy

Unit (`occupancy-map.test.ts`): a synthetic wall 2 m ahead → cells at 2.0 m occupied, cells 0.4–1.9 m
free, cells behind the wall unknown; a second integration from a pose rotated 90° lands the same wall
in the same world cells (transform correctness); pose `null` → no change; grid grows without moving
existing cells; `toSnapshot()`/`fromSnapshot()` round-trip; frameId mismatch → empty map.

Sim e2e (extend `e2e_loco_check.py` or new script): boot sim + agent with `AGENT_MAP_SWEEP_HZ=0.5`,
run "walk 2 m forward, turn around, walk back", then `GET /map` — assert the four room walls appear
as occupied bands within ±0.15 m of their MJCF positions, the table footprint is occupied, and the
robot's path is free. Save `toPgm()` and eyeball it once; attach the PNG to the PR.

Regression: full `robot-agent` vitest, `sim_g1_dds` pytest (incl. new `test_lidar.py`), typecheck all
three components; `demo_clip.py "go to the table and tell me what is on it"` still produces the same
result — the map must not slow the observation path (measure `look` wall time before/after, ±0.3 s).
