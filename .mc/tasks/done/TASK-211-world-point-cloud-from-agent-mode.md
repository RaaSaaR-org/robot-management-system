---
id: TASK-211
title: Keep a 3-D world point cloud from every Agent Mode run (view + export)
status: done
priority: 2
tags: [core, agent-mode]
created: 2026-08-16
completed: 2026-08-16
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
