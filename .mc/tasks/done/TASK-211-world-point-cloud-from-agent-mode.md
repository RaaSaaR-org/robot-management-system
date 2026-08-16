---
id: TASK-211
aliases:
- TASK-211
title: Keep a 3-D world point cloud from every Agent Mode run (view + export)
slug: world-point-cloud-from-agent-mode
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- agent-mode
sprint: ''
depends_on: []
due_date: ''
created: 2026-08-16
updated: 2026-08-16
completed: 2026-08-16
status_note: |
  DONE 2026-08-16 — PR #228 (with TASK-210). Verified 2026-08-16: bounded voxel WorldCloud fed by the map keeper, persisted beside the grid under the boot_id rules, `GET /map/cloud` (JSON/PCD/PLY) + server proxy, 2D/3D switch on the Map tab with a Three.js cloud view, PCD/PLY in the Export menu.
  FIXED IN REVIEW (08c5aff): the orbit target was re-applied from every 3 s poll and snapped the camera back while orbiting — frozen per robot now. Known UX: PCD/PLY export needs the 3D view opened once (the menu says so).
  POST-MERGE PASS 2026-08-16: 3-D cloud (32,083 pts) and a real PCD download (385 KB, 32,083 points) verified live. Fixed here: PCD/PLY were disabled until the 3-D view had been opened even though the export fetches the full cloud itself — the earlier "known UX" note is resolved; the 3-D view re-downloaded the whole cloud every 3 s regardless of tab visibility and stacked slow reads, and the 2-D grid was decoded underneath it.
---

## Description

Agent Mode integrated every lidar frame into the 2-D grid and dropped it; a 3-D
cloud only existed through the old digital-twin scan sessions
(`POST /pointcloud/scan/start`), driven by hand. Now every run keeps a bounded
world cloud beside the map, updates it as objects come and go, shows it on the
Map tab and exports it as PCD/PLY.

## Details

### Robot Agent
- `src/agent-mode/world-cloud.ts` — `WorldCloud`: base_link → odom through the
  paired pose, one point per voxel (`AGENT_CLOUD_VOXEL_M` 0.05, centre stored),
  range/height filters, cap with oldest-first eviction (`AGENT_CLOUD_MAX_POINTS`),
  `purgeFreed(grid, near)` deletes voxels whose cell turned free (band only),
  `toSnapshot`/`fromSnapshot` (frame-id guarded), `toPcd()`, `toPly()`,
  `positions(max)` even-stride sample.
- `occupancy-map-keeper.ts` — feeds the cloud after each grid integration,
  purges every 5th, saves/restores it beside the map (`AGENT_CLOUD_PATH`),
  `getCloud()`, `status().cloud`.
- `occupancy-map.ts` — `heightBand()`.
- `config.ts` — `cloudEnabled/VoxelM/MaxPoints/Path`.
- `rest-routes.ts` — `GET /robots/:id/map/cloud` (`?max`, `?format=pcd|ply`).

### Server
- `agent-mode.routes.ts` — `GET /:id/agent-mode/map/cloud` proxy (15 s budget).

### Frontend
- Types/api/store: `RobotCloudPayload`, `agentmodeApi.getCloud`, `fetchRobotCloud`.
- `components/WorldCloudView.tsx` — polls the cloud, renders it in the existing
  `PointCloudViewer` (new `robotPose` marker, `orbitTarget`, `label` props),
  stats badge, three empty states.
- `RobotMapPanel.tsx` — **2D / 3D** view toggle; Export menu gains PCD / PLY
  (fetches the full cloud, `max=0`).
- `utils/mapExport.ts` — `decodeCloudPositions`, `cloudToPcd/Ply`, `exportCloud`.

## Test Strategy
- Agent: `world-cloud.test.ts` (transform, voxelisation, filters, eviction,
  purge, snapshot round-trip, PCD/PLY, keeper feed/persist/restore).
- Server: proxy tests. App: `mapExport.test.ts`, `RobotMapPanel.test.tsx`.
- Live: house scene — walk, `curl …/map/cloud?format=pcd` (38k pts spanning
  the house); move the crate with `POST /sim/reset-pose {"body":"crate",…}`,
  walk past again → old crate points purged. UI validated with Playwright MCP.
