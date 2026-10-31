---
id: "TASK-441"
aliases: []
title: "A session created with cameras records every one of them"
slug: "a-session-created-with-cameras-records-every-one-of-them"
status: "review"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: "[[TASK-439]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# A session created with cameras records every one of them

## Description

A data-collection session can be created with an explicit camera list (e.g. head + both
wrist cameras); every take of that session records each listed camera at its own true size.
A session created without a list records exactly what it records today (the head camera).
Also lands the app-side session type and a small camera helper the UI children reuse.

## Details

### Current state

- `server/prisma/schema.prisma` `model TeleoperationSession` (~1772) has no camera field.
- `server/src/services/TeleoperationService.ts` `startSession` (~509-566) falls through to
  `agentRecordingService.start(...)` (~525-537) without `cameras`;
  `server/src/services/AgentRecordingService.ts:111` already has an optional
  `cameras?: string[]` that nothing sets. The agent route `POST /robots/:id/recording/start`
  (`robot-agent/src/api/rest-routes.ts` ~1457-1512) accepts `cameras?: string[]`; absent =
  head_camera (else the first camera listed), `[]` = joints only.
- `robot-agent/src/recording/EpisodeRecorder.ts`: camera choice ~528-533; per-tick parallel
  snapshots, all-or-nothing (~353-356, 1058-1062, 1150-1151); ONE `imageSize` (~420) learned
  from the first JPEG of any camera (~1100) and written as width/height for every camera
  (~842-843); thumbnail from `cameras[0]` (~1259-1264).
- `robot-agent/src/recording/lerobot-writer.ts` writes one feature + one mp4 per camera
  (~203-249, 285-312, 467-470, 506-548).
- `robot-agent/src/recording/camera-map.ts`: `head_camera→cam_right_high`,
  `left_wrist_camera→cam_left_wrist`, `right_wrist_camera→cam_right_wrist`.
- App: the session type and API client live under `app/src/features/datacollection/`
  (types + api); the camera list type `RobotCameraList {cameras: string[], source, detail?}`
  is in `app/src/features/robots/api/cameraApi.ts` (~68-76).

### Server

1. Prisma: `cameras String?` on `TeleoperationSession` — JSON array of camera names, `null`
   = default. Postgres migration in `server/prisma/migrations/<ts>_task_441_session_cameras/`
   (copy the shape of `20261017120000_task_408_episode_control`), SQLite JSON-string
   convention for local dev (see CLAUDE.md). The CI check "Prisma migrations match schema"
   must pass (reproducible locally per the repo-gates memory: docker Postgres).
2. Session create route/DTO (find it from `server/src/routes/teleoperation.routes.ts`):
   accept optional `cameras: string[]` — 1–4 unique names matching `^[A-Za-z0-9_-]+$`;
   anything else → 400 with a plain message. Store JSON; serialize back as `cameras:
   string[] | null` in every session response.
3. `TeleoperationService.startSession`: pass `cameras` to `agentRecordingService.start`
   **only** when the stored list is a non-empty array. `null` → omit the field (never `[]`).

### Robot Agent (recorder)

4. Per-camera image size: replace the single `imageSize` with a size per camera key, each
   learned from that camera's first JPEG; `info.json` feature `shape`/`video.height/width`
   and the ffmpeg encode use each camera's own size.
5. At start, when `req.cameras` is given, check every name against `hooks.listCameras()`;
   any missing → refuse with a `RecordingError` (HTTP 409 or the existing code for a
   refused start) whose message names the missing camera(s), e.g. "left_wrist_camera is not
   being served — check the wrist camera or start a Head only session". The server surfaces
   that message on session start.
6. Thumbnail: `head_camera` when it is recorded, else the first camera.
7. Keep the requested order (head first) so the dataset's first video feature stays the
   head camera (the app's episode viewer treats the first key as primary).
8. Head-only default unchanged: no `cameras` → exactly today's behaviour and output.

### Frontend (types + helper only, no UI)

9. Add `cameras?: string[] | null` to the app's session type and pass `cameras` through the
   create call when given.
10. Add `configured?: string[]` to `RobotCameraList` in `cameraApi.ts` (the sidecar will send
    it: every camera the robot is set up to serve, head first, up or not).
11. New `app/src/features/datacollection/utils/cameras.ts`:
    - `WRIST_CAMERAS = { left: 'left_wrist_camera', right: 'right_wrist_camera' }`
    - `robotWristCameras(list?: RobotCameraList): string[]` — wrist names in
      `list.configured ?? list.cameras`, left first.
    - `sessionWristCameras(session): string[]` — wrist names in `session.cameras`.
    - `cameraSetLabel(cameras?: string[] | null): string` — "Head only" / "Head + 2 wrists" /
      "Head + left wrist" …
    Unit-test it.

### Demo fixtures (for the UI children's Playwright specs)

12. The demo build (`VITE_DEMO_MODE=true`, MSW handlers in `app/src/mocks/`) must be able to
    show a Head + wrists session without changing any existing demo session or robot:
    - a demo session `demo-session-wrists` (copy the shape of `demo-session-takes`) with
      `cameras: ['head_camera','left_wrist_camera','right_wrist_camera']` on a demo G1 whose
      camera list includes both wrists (a new demo robot, or a demo-only override route that
      pins a robot's camera list, mirroring the readiness fixture route
      `/api/__demo/robots/:id/readiness` used by `app/e2e/datacollection-console.spec.ts`);
    - the demo camera stream answers for the wrist names the way it answers for
      `head_camera` today (a static frame is fine);
    - existing demo sessions keep `cameras` absent (head only) and every existing e2e spec
      passes unchanged.

## Acceptance Criteria

- [ ] `POST` create with `cameras: ['head_camera','left_wrist_camera','right_wrist_camera']`
      stores and returns it; invalid lists get a 400; no `cameras` → `null`.
- [ ] Starting such a session against the dev sim with wrist cameras (TASK-440) records
      `observation.images.cam_right_high`, `cam_left_wrist`, `cam_right_wrist`, each with its
      true size in `info.json`, and the thumbnail is the head view.
- [ ] A requested camera that is not served → session start fails with a message naming it;
      nothing half-recorded.
- [ ] A session without `cameras`: the recorder request carries no `cameras` field and the
      dataset is identical in shape to `main` (one `cam_right_high` video).
- [ ] The demo build serves `demo-session-wrists` with three cameras; existing demo
      sessions and e2e specs are unchanged.
- [ ] Server, robot-agent and app typecheck + vitest green; Prisma migration check green.

## Test Strategy

Vitest: server create validation + `startSession` forwarding (`[]` never sent, `null`
omitted); `EpisodeRecorder.test.ts` 3 cameras of different sizes (per-camera `info.json`),
refusal on a missing camera, thumbnail = head, head-only default unchanged (~413-416);
`lerobot-writer.test.ts` with mixed sizes; app `cameras.ts` helper tests. Manual: against
the dev sim (`sim_node.py` + agent on :41246/:8777) create a session via the API with the
three cameras, record one take, inspect `info.json` and the three mp4s with ffprobe.
