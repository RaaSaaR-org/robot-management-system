---
id: "TASK-439"
aliases: []
title: "A robot with wrist cameras shows and records them; a robot without them works as before"
slug: "a-robot-with-wrist-cameras-shows-and-records-them-a-robot"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe:
effort: ""
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# A robot with wrist cameras shows and records them; a robot without them works as before

## Description

The G1 EDU (g1-edu-4) gets two wrist cameras, left and right, next to the head camera. The
operator sees them on the data-collection session page and in the Quest 3 view, and a session
that chose them records them into every take, so teleoperation and the recorded data use the
same views. They are optional per robot and per session: a robot with only the head camera
(and Dex3 hands), or a session that picks "Head only", keeps the exact flow it has today.

Epic. Decisions: `docs/records/TASK-439-optional-wrist-cameras.md`. The children carry the
work; this body is the shared spec and the contracts they build against.

## Details

### Current state (established 2026-10-31)

- **Robot side.** `robot-agent/hardware/g1_sidecar.py` serves cameras from ONE active source
  (`_camera_source_and_names`, ~1665-1703). g1-edu-4 uses `pc2cam`: a single global reader
  (`_pc2cam_reader`, ~1468-1626) of PC2's `g1_cam_pub.py` on `192.168.123.164:5600`
  (wire: `uint32 be length | uint64 be ns timestamp | JPEG`, encodes only while a client is
  connected), advertised as `G1_PC2_CAMERA_NAME` (default `head_camera`). `/cameras`
  (~3153), `/cameras/<n>/stream` (MJPEG, pins its resolution once — re-probing per frame
  caused a 1.0 s freeze every 5 s, TASK-233) and `/cameras/<n>/snapshot` (~3234; a
  `?format=raw` request 404s because `do_GET` matches the full path, so the agent makes two
  requests per frame). TASK-233 removed a hard-coded head/left/right list because the wrist
  names aliased the head frame — never reintroduce aliases.
- **Supervisor.** `robot-agent/supervisor/src/profile.ts` turns the profile's single
  `pc2Camera: host:port` into `G1_PC2_CAMERA_HOST/PORT`; `steps.ts` `stepCamera` (~806-827)
  TCP-probes it, warning only. `hardware/profiles/g1-edu-4.yaml:28,46-47`.
- **Agent/server/app display.** Name-generic pass-throughs: agent `camera-list.ts`,
  `rest-routes.ts` GET `/robots/:id/cameras` + `/camera/:name/stream`, readiness-routes camera
  block; server `robot.routes.ts` GET `/:id/cameras` (~438-490), ticketed MJPEG proxy
  (~504-555). App `cameraApi.ts` (`RobotCameraList {cameras: string[], source, detail?}`),
  `useRobotCameras` (5 s on the session page). Session page video is
  `datacollection/components/console/LiveView.tsx`: one main view + one picture-in-picture
  (twin or lead camera), lead = `/head/` match else first name.
- **VR.** `robots/components/tabs/vr/HeadCameraPanel.tsx` is the only camera in XR, a mono
  plane 1.15 m ahead at y 0.4 (0.8 x 0.6 m), camera name fixed by `PANEL_CAMERA`
  (`vrConstants.ts:87`), status in the single-slot store `vrCameraStatus.ts`. Side panels sit
  at ±40° bearing; the space below the head screen is free. `useCameraReconnect` retries
  forever and shows an OFFLINE plate — a mounted panel never disappears.
- **Recording.** The agent's `recording/EpisodeRecorder.ts` records; the server
  (`TeleoperationService.ts:~525-537` → `AgentRecordingService.start`) never passes
  `cameras`, so the recorder takes only `head_camera` (~528-533). It snapshots all requested
  cameras per tick, all-or-nothing (~353, 1058-1062); one `imageSize` from the first JPEG is
  written for every camera (~420, 842-843, 1100); the thumbnail is `cameras[0]` (~1259).
  `camera-map.ts` maps `head_camera→cam_right_high`, `left_wrist_camera→cam_left_wrist`,
  `right_wrist_camera→cam_right_wrist`. One recording session = one LeRobot v3.0 dataset with
  a fixed camera set; everything downstream reads cameras from `info.json`.
- **Sim.** `sim_g1_dds/sim_node.py` lists and renders every MJCF `<camera>`; the G1 Dex3
  includes (`sim_evaluator/mjcf/g1_dex3/g1_43dof_fixedbase.xml`, `_realism.xml`, generated
  `_planarbase.xml`) have `head_camera` but no wrist camera; `left_wrist_yaw_link` /
  `right_wrist_yaw_link` bodies exist.

### Contracts every child builds against

- **Names.** `head_camera`, `left_wrist_camera`, `right_wrist_camera`, everywhere (wire,
  sidecar, agent, app, sim). Dataset keys unchanged: `cam_right_high`, `cam_left_wrist`,
  `cam_right_wrist`.
- **Wrist publisher.** Same wire format as `g1_cam_pub.py`, one process per camera, default
  ports 5601 (left) and 5602 (right), runs on PC2 or the lab PC.
- **Sidecar env.** `G1_WRIST_CAMERAS="left_wrist_camera@<host>:<port>,right_wrist_camera@<host>:<port>"`.
  Unset or empty → behaviour byte-identical to today.
- **Camera list (sidecar `/cameras`, agent, server, app `RobotCameraList`).** Existing fields
  unchanged (`cameras`: served names, head first; `source`; `detail`). One additive field:
  `configured?: string[]` — every camera the robot is set up to serve, head first, whether or
  not it is up right now. Absent from old sidecars and the sim → read as `cameras`.
- **Session.** `TeleoperationSession.cameras` (nullable JSON array of camera names). `null` =
  today's default (head camera only). Create body accepts `cameras?: string[]`. The server
  passes it to the agent recorder only when it is a non-empty array, never `[]`.
- **"Robot has wrist cameras"** = `configured ?? cameras` contains a `*_wrist_camera` name.

### Robot side (children: publisher, sidecar, supervisor)

- `robot-agent/hardware/camera_pub.py`: UVC camera → framed JPEG on a TCP port. Python 3.8
  compatible (PC2), device by stable path (`/dev/v4l/by-id/...` or `by-path`), 640x480@30
  default, encodes only while ≥1 client is connected, serves several clients, survives USB
  re-enumeration by reopening. A systemd unit example and install steps in
  `docs/g1-edu-lab-bringup.md` (installing on PC2 needs the owner's go-ahead at the time).
- Sidecar: wrist endpoints from `G1_WRIST_CAMERAS` are read with the pc2cam framing, one
  reader and one negative cooldown per endpoint; a down wrist only drops its own name, never
  the head; no probe of absent endpoints inside a running stream; `none`/`off` opens nothing.
  `/cameras` adds `configured`. `/cameras/<n>/snapshot?format=raw` returns `image/jpeg` (plain
  URL contract unchanged).
- Supervisor: optional profile field `wristCameras: {left?: host:port, right?: host:port}` →
  `G1_WRIST_CAMERAS`; `stepCamera` probes each, warning only. A profile without it produces
  today's env and step exactly. `g1-edu-4.yaml` gets the field commented out.
- Agent: `camera-list.ts`, `rest-routes.ts` and the readiness camera block pass `configured`
  through.

### Server + recording (child)

- Prisma: `TeleoperationSession.cameras String?` (JSON), migration, SQLite JSON-string
  convention. Create DTO/route validate `cameras?: string[]` (1–4 unique names matching
  `[A-Za-z0-9_-]+`); session responses carry it.
- `TeleoperationService` forwards `cameras` to `agentRecordingService.start` only when
  non-empty; `null` omits the field (head-only default stays in the recorder).
- `GET /api/robots/:id/cameras` passes `configured` through.
- Recorder: image size per camera (each camera's first JPEG) in `info.json` and the encode;
  refuse to start (`RecordingError`, names listed) when a requested camera is not served;
  thumbnail = `head_camera` when recorded, else the first camera; head-only default unchanged.

### App: session page (child)

- New-session form: a "Cameras" choice — **Head + wrists** (default) / **Head only** — shown
  only when the chosen robot has wrist cameras. Head + wrists sends
  `cameras: ['head_camera', <wrist names configured>]`; Head only sends nothing.
- `LiveView`: when the session records wrist cameras, a row of two 4:3 tiles under the main
  view (left wrist left, right wrist right, labelled); clicking a tile swaps it into the main
  view; a configured wrist that is not served shows a small "offline" plate in its tile. A
  session without wrist cameras renders exactly today's view (same test ids, no extra
  streams). Hidden tiles open no stream; tiles unmount while the VR modal is open (as today).
- Readiness/preflight: an extra "Wrist cameras" row only for sessions that record them;
  a chosen wrist camera that is not served blocks Record with a plain reason (the recorder
  would refuse anyway). Head-only sessions: rows and verdicts unchanged.
- The session's camera set is visible on the page (e.g. a systems cell "Head + 2 wrists").

### App: headset (child)

- `WristCameraPanels` below the head screen inside the yaw group, outside `modelRef`: two
  ~0.36 m wide 4:3 panels, left at -z, right at +z, within ±20° bearing, tilted toward the
  eye, small L/R plates. Mounted only when wrist cameras are requested for this view (prop
  from the session page) — otherwise nothing, no ticket, no stream. Shares the generic camera
  screen logic with `HeadCameraPanel` (head path keeps `head_camera` and identical behaviour).
  Own keyed status, never writes `useVrCameraStatus`; a stale wrist never buzzes; lower
  texture rate than the head (≤10 Hz). `vrUiDebug.wristCameras` lists mounted panels.

### Sim (child)

- `<camera name="left_wrist_camera">` / `right_wrist_camera` on the wrist yaw links of the
  G1 Dex3 includes (fixedbase, realism; regenerate planarbase and diff), looking along the
  fingers. No physics change. Note the render cost per extra camera on the physics thread.

### Docs

`docs/data-collection-two-person.md` (wrist views, camera choice), `docs/vr-teleop-data-collection.md`
(wrist panels; fix the 30°→40° side-panel note), `docs/g1-edu-lab-bringup.md` (publisher,
profile field, camera step), `docs/network-architecture.md` (ports 5601/5602).

## Acceptance Criteria

- [ ] Head-only regression: with `G1_WRIST_CAMERAS` unset and sessions created without
      `cameras`, the sidecar `/cameras` names, the session page, the headset and the recorded
      dataset (`info.json` features, video, thumbnail) are what they are on `main` today.
- [ ] A robot serving head + two wrist cameras: New session offers Head + wrists (default) /
      Head only; Head + wrists shows the head view big and both wrist views beneath it, and two
      wrist panels below the head screen in the headset.
- [ ] A take in a Head + wrists session writes `observation.images.cam_right_high`,
      `cam_left_wrist`, `cam_right_wrist`, each with its own true size; the thumbnail is the
      head view.
- [ ] A Head + wrists session whose wrist camera is down does not start recording and says
      which camera is missing; the head camera keeps streaming.
- [ ] A wrist publisher that is down or flapping never freezes or drops the head stream.
- [ ] The sim robot serves both wrist cameras, so the whole path is testable without hardware.
- [ ] Gates: `./scripts/test-all.sh` green; Playwright covers head-only (unchanged) and
      head + wrists on the session page and under `?xremu`.

## Test Strategy

Unit tests per child (sidecar pytest with fake publishers on several ports; supervisor
vitest for the profile/env/step; recorder/writer vitest for 3 cameras of different sizes and
the refusal; server vitest for forwarding; app vitest for the form, LiveView layouts and the
wrist panel gate). End to end against the dev sim with wrist cameras: create a Head + wrists
session, record a take, inspect `info.json` and the three mp4s; then a head-only session on
the same robot. Playwright MCP walk of both sessions, including the VR modal under `?xremu`.

## Children

| Task | Slice | spe | effort | depends on |
| ---- | ----- | --- | ------ | ---------- |
| [[TASK-440]] | The sim robot has a left and a right wrist camera | 2 | medium | — |
| [[TASK-441]] | A session created with cameras records every one of them | 5 | medium | — |
| [[TASK-444]] | A wrist camera publisher serves a USB camera in the head camera's wire format | 3 | medium | — |
| [[TASK-445]] | The sidecar serves wrist cameras next to the head camera | 5 | high | — |
| [[TASK-446]] | A robot profile names its wrist cameras and Set up checks them | 3 | low | — |
| [[TASK-447]] | New session offers Head + wrists or Head only | 2 | low | TASK-441 |
| [[TASK-442]] | The session page shows the wrist views beneath the head view | 5 | medium | TASK-441 |
| [[TASK-443]] | The headset shows the wrist views below the head screen | 5 | medium | TASK-441 |

## Notes

- Requested 2026-10-31, the night before a head-only data-collection session (TASK-424 run
  sheet). Nothing merges before that session without the user's OK; the head-only
  regression criterion is the guard.
- Out of scope: installing anything on PC2 (needs the owner at the time), stereo/binocular
  head, depth from the wrist cameras, recording wrists with Unitree `xr_teleoperate`.

## Follow-ups

- [[TASK-449]] A VLA policy gets its cameras by name, not by list position (found by the integration check; not a child)
