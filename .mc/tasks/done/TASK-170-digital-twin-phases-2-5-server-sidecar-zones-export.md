---
id: TASK-170
aliases:
- TASK-170
title: Digital Twin — phases 2–5 (server of-record, sidecar build, zone authoring, Nav2/VDA5050 export)
slug: digital-twin-phases-2-5-server-sidecar-zones-export
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- server
- app
- robot-agent
- digital-twin
sprint: ''
depends_on: []
due_date: ''
created: 2026-06-24
updated: 2026-07-17
status_note: 'DONE 2026-07-17: the last open item — the LIVE scan-session through the agent getPointCloudFrame hardware branch — ran against the powered G1: LiDAR enabled (authorized switch write), 42 real MID-360 frames (20k pts each) streamed robot→DDS→sidecar(dds source)→agent→server ScanSession, twin-builder built twin 7d3cfc3e (111,448 pts, cloud+occupancy+mesh+MuJoCo scene, status ready), verified rendering on /sites. LiDAR switched back OFF afterwards. Caveat kept honest: the robot stood still (read-only stage — no walking); a true walked sweep with real localization is future Stage-2+ quality work, tracked in TASK-169. Earlier same day: `dds` sidecar LiDAR source implemented + loopback-proven, both DDS venvs rebuilt (see progress sections).'
---

# Digital Twin — phases 2–5

## Description

Continue the NeoDEM digital-twin feature: the G1 walks a workzone, its LiDAR map
accumulates into one world frame, the user paints semantic zones, live fleet
poses overlay, and we export what a fleet actually consumes (Nav2 keep-out mask
+ VDA5050 roadmap). **Phase 0 (agent pose-stamped frames) and Phase 1 (app MVP:
client-accumulated L0 cloud + live pose + walked trail, sim-demoable) are DONE
and verified.** This task is the remaining phases 2–5.

Full plan: `~/.claude/plans/the-unitree-g1-has-hidden-marshmallow.md` (read it
first — has architecture, conflict reconciliations, risks, per-phase demos).

## Status (2026-06-27)

**Phases 0–5 code is implemented + committed on PR #164** (`e063f8b` the
scan→twin→real-to-sim loop, `dd80486` Phase 5 scan-session reaper + raw-frame
prune); Playwright-validated. **Still open:** the Phase 5 **hardware** path —
real MID-360 LiDAR capture + the real Open3D mesh/occupancy pipeline
(`@status hardware-pending`); everything below it is software-done.

## Status update (2026-07-11) — most of the Phase-5 hardware path is now proven

- **Real MID-360 capture happened** (2026-07-07, dz-226): 240,480-point capture
  from the real G1's LiDAR via DDS (read-only), durable copy at
  `C:\Unitree\_data\g1_lidar\`.
- **Real-data twin build proven end-to-end**: the capture was imported through
  the point-cloud import endpoint (sensor-scans bucket), `../twin-builder`
  built the twin (incl. the percentile-floor fix, twin-builder commit
  `53cb4ea`), and the twin was converted to a MuJoCo sim scene the Simulation
  page can launch. `pipelines/open3d_pipeline.py` exists in twin-builder.
- **What actually remains (robot day):** the **live scan-session** path — the
  G1 walking a sweep while the agent's `getPointCloudFrame` hardware branch
  streams pose-stamped MID-360 frames into a server `ScanSession` (today the
  real capture went through the standalone import path, not the live
  walk-and-scan loop). See TASK-169 "Robot-day checklist" item 3.

## Status update (2026-07-17) — live LiDAR path made runnable + loopback-proven

The live scan-session path would have SILENTLY produced empty frames on robot
day: the sidecar's only live MID-360 source was ROS2 (`rclpy`/`livox_ros_driver2`
— not installed on dz-226), and both DDS venvs (`.venv-g1-dds`, `.venv-g1-sidecar`)
were broken (created under another user's uv Python). Fixed PC-side:

- **New `dds` LiDAR source in `g1_sidecar.py`** (`G1_LIDAR_SOURCE=dds`, in the
  `auto` chain before livox): subscribes `rt/utlidar/cloud_livox_mid360` via
  unitree_sdk2py — the same proven path as the 2026-07-07 real capture, zero
  ROS2. Env: `G1_LIDAR_DDS_TOPIC/_DOMAIN/_IFACE/_TIMEOUT_S` (domain default 0;
  iface falls back to `G1_NET_INTERFACE`). Subscribe-only — the LiDAR-enable
  write (`rt/utlidar/switch=ON`) stays outside the sidecar
  (`C:\Unitree\_data\g1_lidar\g1_lidar_capture.py`, `--off` to disable).
- **Venvs rebuilt** (uv, py3.10.20, cyclonedds 0.10.2 + pyzmq + numpy):
  `.venv-g1-dds` (bridge + capture scripts; old broken one parked as
  `.venv-g1-dds.broken-marco`) and `.venv-g1-sidecar` (sidecar).
  ⚠ Sidecar MUST run with `PYTHONUTF8=1` (cp1252 console crashes on its
  emoji/arrow prints — hit during the test) + `PYTHONPATH=C:\Unitree\unitree_sdk2_python`.
- **Restored `C:\Unitree\_data\g1_lidar\pointcloud_common.py`** (the capture
  script's import — was never copied from the capture-day scratchpad) and added
  `g1_lidar_dds_replayer.py` (publishes the real 240k-pt capture as
  PointCloud2_ frames on DDS domain 1).
- **Loopback proof (robot-free):** replayer (domain 1) → sidecar `dds` source →
  `GET :8767/pointcloud/mid360_lidar/snapshot` returned 24,000 real points,
  `source:"dds"`, bbox matching the capture, first-100-points exact-match ✔.
  The Node agent consumes exactly this endpoint via
  `hardwareClient.snapshotPointCloud('mid360_lidar')` when `isConnected()`
  (i.e. once the lowstate bridge runs on robot day) — no agent/server changes
  needed.

## Current state (2026-06-24, historical — pre-Phase-2)

**Branch `feat/g1-pointcloud` — builds on the point-cloud feature.**

Done & verified (337 agent tests pass, all 3 typechecks clean, app build clean,
full loop + Playwright confirmed: room fills 6k→28k pts, Stop persists backdrop):

- **Agent (Phase 0):** `PointCloudFrame.pose` + `scanSessionId` (`robot/types.ts`);
  `robot/scan-sim.ts` (per-session fixed world room, pose-dependent occlusion);
  `robot/scan-merge.ts` (base↔world transform, voxel helpers);
  `state.getPointCloudFrame` branches to scan-sim ONLY when a session is active
  (origin anchored at scan-start pose; the ONE heading°→yaw(rad) conversion);
  agent + server `scan/start|stop|status` endpoints.
- **App (Phase 1):** `app/src/features/digitaltwin/` — `useScanSession` (reuses
  `usePointCloudStream`, voxel-accumulates frames into one world cloud),
  `TwinViewer` (cloud + path + live robot), `ScanSessionPanel`,
  Sites gallery + `/sites` route + "Digital Twin" sidebar item. One-click
  **Start sweep** auto-walks the robot a loop (move payload `{destination:{x,y}}`).
  Stop persists a backdrop via existing `sensorScansApi.captureScan`.

**Known limitation to fix in Phase 2:** the persisted backdrop on Stop is
currently ONE full-res posed frame, not the whole accumulated room — true
server-side accumulation is Phase 2. Real MID-360 is `@status hardware-pending`.

## Architecture (who does what)

Robot **produces** geometry (thin: pose-stamps frames) · new CPU-only
`../twin-builder` Python sidecar **processes** (training-worker poll pattern) ·
server is **system of record** (`DigitalTwinService` clones `TrainingOrchestrator`;
models `DigitalTwin`/`ScanSession`/`TwinZone`; extends `SensorScan` with pose) ·
app **visualizes/authors/exports**. App "Site" = server `DigitalTwin`. No
SLAM/Open3D in the agent or browser.

## Details

### Phase 2 — Server `ScanSession` of-record + `DigitalTwin` schema

Promote session + twin to first-class server state.

- `server/prisma/schema.prisma` migration:
  - Extend `SensorScan`: nullable `sessionId`, `frameIndex`, `poseX/Y/Z` +
    quaternion `poseQ*` (default identity), `@@index([sessionId, frameIndex])`.
    Nullable `sessionId` keeps ad-hoc PerceptionTab captures working.
  - New `ScanSession` (model on `TeleoperationSession`; status
    `idle|recording|processing|complete|failed` — folds the build-job lifecycle,
    no separate job table).
  - New `DigitalTwin` (worldFrame origin/resolution, 6-float AABB,
    `cloudKey/meshKey/occupancyPgmKey/occupancyYamlKey/roadmapKey` storage refs +
    backends, `status`, `version`, `floor?`). Nullable `tenantId`.
  - New `TwinZone` (polygon points, 3D height, twin-world-frame, enum
    `keepout|workcell|charging|speed`). **Do NOT merge with the fleet `Zone`**
    (2D AABB, different enum, drives the SVG FleetMap) — merging breaks
    `ZoneService` validation.
- `ScanSessionService` (EventEmitter, mirrors `SensorScanService`): start/stop
  sweep, capture loop calling `getLiveSnapshot(full=true)`, stamp each frame with
  the robot pose, persist via extended `SensorScanRepository`, emit
  `session:progress`. Refactor the `captureScan` store-block into a shared
  `persistFrame({sessionId, frameIndex, pose})`.
- New `ScanSessionRepository`, `DigitalTwinRepository`; `scansession.routes.ts`
  (`POST /api/scan-sessions`, `/:id/stop`, `GET /:id/frames`) mounted in `app.ts`;
  `session:progress` websocket broadcast (mirror the `scan:created` block).
- **Key files:** `server/prisma/schema.prisma`,
  `server/src/services/{ScanSessionService,SensorScanService}.ts`,
  `server/src/repositories/`, `server/src/routes/scansession.routes.ts`,
  `server/src/app.ts`, `server/src/services/TeleoperationSession*` (reference).
- **Demo:** start a sweep via REST, watch frames accrue server-side with poses,
  see `session:progress` over the socket; app panel reflects server-authoritative
  progress.

### Phase 3 — `../twin-builder` sidecar (stub) + full build loop

Prove capture→build→DigitalTwin→render end-to-end with **zero Open3D**.

- New sibling repo `../twin-builder` (peer of `../vla-server`,
  `../training-worker`): `worker.py` (copy training-worker poll loop: signal
  handlers, heartbeat, claim→run→progress→complete/failed, per-job tempdir),
  `config.py`, `callbacks.py`, `storage.py` (S3 + local-via-server-download),
  `pipelines/{base,stub}.py` (stub vendors `robot-agent/hardware/pointcloud_replay.py`
  stdlib PCD parser; naive voxel downsample; flat occupancy PGM+YAML; box GLB;
  merged PCD), `.env.example` (`PIPELINE_STUB=true`), `Dockerfile`, `CLAUDE.md`.
- `DigitalTwinService` = `TrainingOrchestrator` clone
  (`claimNextPendingJob`/`updateProgress`/`completeJob`/`failJob`/
  `recordHeartbeat`/`reapStaleRunningJobs`); on complete persist twin artifacts +
  `status=ready`, emit `twin:ready`.
- `twin.routes.ts` worker block under `/api/twin/workers/*` behind
  `workerAuthMiddleware`. **The local-fallback gap (first-class deliverable):**
  `GET /api/twin/workers/inputs/:scanId/download` streams `SensorScan` bytes
  (presigned redirect on rustfs, local file stream on `local`). Add a
  `DIGITAL_TWINS` bucket + size limit + `uploadTwinArtifact/getTwinArtifactStream`
  to `model-storage.ts`, and `GET /api/twin/:id/{cloud,mesh,occupancy.pgm,
  occupancy.yaml}` stream routes.
- App: `TwinBackdrop` already supports `kind='points'`; `twin:ready` swaps the
  client preview for the authoritative cloud + occupancy.
- **Key files:** `../twin-builder/*` (new),
  `server/src/services/{DigitalTwinService,TrainingOrchestrator}.ts`,
  `server/src/routes/twin.routes.ts`, `server/src/storage/model-storage.ts`,
  `robot-agent/hardware/pointcloud_replay.py` (vendor source).
- **Demo:** run the stub sidecar, Stop a sweep, watch stage progress stream, see
  the finalized twin render — full pipeline, no Open3D.

### Phase 4 — L2 twin-zone authoring + Nav2/VDA5050 export

- App: `twinZoneStore`/`twinZoneApi` cloned from fleet `zoneStore`/`zoneApi`;
  `ZoneAuthoringOverlay` = 2D top-down over the L1 occupancy PGM (extend
  FleetMap's `ZoneEditor` `screenToMap` + edit modes from single-rect to
  multi-click **polygon**); `TwinZoneFormModal`; `ZoneVolumes.tsx`
  (THREE.Shape→ExtrudeGeometry translucent volumes) inside the world-frame group.
- Server: `TwinZone` CRUD + `twinZone:*` broadcasts; `storage/pgm.ts` (P5
  reader/writer + polygon scan-fill — the single world→pixel transform);
  `TwinExportService` rasterizes keep-out/speed polygons over the occupancy PGM →
  Nav2 keep-out mask + costmap-filter YAML, and derives a VDA5050 `{nodes,edges}`
  roadmap from free-space + zone centroids; cache to storage.
- Routes: `GET /api/twin/:id/export/nav2-keepout.{pgm,yaml}`,
  `/export/vda5050.json`; `ExportPanel` (two download buttons).
- **Key files:** `app/src/features/fleet/components/FleetMap.tsx` (`ZoneEditor`
  reference), `app/src/features/digitaltwin/`,
  `server/src/storage/pgm.ts` (new), `server/src/services/TwinExportService.ts`
  (new), `server/src/routes/twin.routes.ts`.
- **Demo:** draw a keep-out + charging zone over the grid, see them as 3D extruded
  volumes, download a pixel-aligned Nav2 mask + a VDA5050 roadmap.

### Phase 5 — Real Open3D pipeline + hardware MID-360 (`@status hardware-pending`)

- `../twin-builder/pipelines/open3d_pipeline.py` (optional `[open3d]` dep, CPU
  wheels): voxel→outlier→normals→iterative RANSAC plane seg→DBSCAN→Poisson→GLB;
  height-slice→occupancy; optional `[registration]` KISS-ICP + multiway
  pose-graph for walked sets; optional `[octree]` PDAL/Potree behind
  `ENABLE_OCTREE` (no-op + warn when absent).
- robot-agent hardware path: real MID-360 frames via `getPointCloudFrame`'s
  existing hardware branch (Livox SDK2 UDP parse / Unitree onboard SDK / ROS2
  driver-as-source) — `HardwareClient` + `g1_sidecar.py /pointcloud` are the
  precedent, so no sidecar/server/app change.
- App: `TwinBackdrop` `kind='octree'` (potree-core/three-loader/COPC via S3 HTTP
  range) + `kind='mesh'` (drei `useGLTF`), behind the discriminator so room-scale
  still ships without the dep.
- `ScanSession` reaper + a policy to prune raw per-frame `SensorScan`s once a twin
  is built.

## Test Strategy

- **Typecheck**: `npm run typecheck` in robot-agent, server, app; `npm run build`
  (app) to catch lazy-route import errors.
- **vitest (server)**: `ScanSessionService.persistFrame` pose round-trip;
  `DigitalTwinService` claim/progress/complete mirrors `TrainingOrchestrator`;
  `TwinExportService`/`pgm.ts` polygon-fill + world→pixel against a known polygon;
  the `inputs/:scanId/download` local-fallback stream.
- **twin-builder self-test**: StubPipeline over a sample PCD → valid occupancy
  PGM+YAML + GLB + merged PCD; full claim→complete callback sequence against a
  mock server.
- **Playwright**: `/sites` → New site → pick g1 → Start sweep → assert frame count
  + canvas point count grow → Stop persists → draw keep-out polygon renders as a
  volume → Export Nav2 downloads a PGM+YAML; assert scan UI hidden for a non-g1
  robot.
- **Manual** (`npm run dev:g1` + server + app): walk the g1, watch the room fill
  in with pose + trail, Stop, run the stub sidecar, confirm the twin + occupancy
  render and `twin:ready` arrives; download the Nav2 mask and confirm it
  pixel-aligns with the occupancy YAML.

## Top risks → mitigations

- **deg/rad heading bug** → convert in ONE place; assert a 90° case (already done
  in `scan-merge.test.ts`).
- **L0–L3 frame drift** → `DigitalTwin` row is the single origin/resolution
  source; `pgm.ts` owns the one world→pixel transform; one `<group>` for
  z-up→y-up.
- **Local-fallback handoff gap** (no presigned URL in default dev) → ship
  `/api/twin/workers/inputs/:scanId/download` as a Phase-3 first-class deliverable.
- **Sidecar absent → sessions stuck** → `reapStaleRunningJobs` reaper;
  `PIPELINE_STUB=true` default; app degrades to client-accumulated cloud.
- **Two zone systems confuse export** → separate models/stores/routes/feature
  modules; TwinZone is the sole export source.

## Commit / PR

Per workflow notes: this machine uses plain `git push` (not igor scripts); commit
`.mc/tasks/` changes on the PR branch before merging; bundle related follow-up
onto one branch/PR. All current work is on `feat/g1-pointcloud` (uncommitted) —
commit/push only when the user asks.
