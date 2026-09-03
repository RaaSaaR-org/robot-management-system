---
id: "TASK-233"
aliases: []
title: "Live camera view for the real G1: MJPEG stream on g1_sidecar.py"
slug: "real-g1-camera-mjpeg-stream"
status: "review"
priority: 2
owner: ""
projects: []
customers: []
tags: ["core"]
sprint: ""
depends_on: []
due_date: ""
created: "2026-09-03"
updated: "2026-09-03"
---

# Live camera view for the real G1: MJPEG stream on g1_sidecar.py

## Description

The app's robot cockpit has a live camera view, and against the real G1 it always
failed: `g1_sidecar.py` implemented only `/cameras/<name>/snapshot`, never
`/cameras/<name>/stream`, which is the route the whole chain above it already
asks for. `sim_g1_dds/sim_node.py` has had both for as long as the cockpit has
existed, so live video worked in sim and 502'd on hardware.

## Details

### Current state (before this task)

- `app/src/features/robots/components/cockpit/CockpitViewport.tsx` renders an
  `<img>` on a ticketed URL from `useCameraStreamUrl` / `cameraApi.ts`.
- `server/src/routes/robot.routes.ts` mints the ticket (`POST
  /:id/camera/:name/ticket`) and proxies `GET /:id/camera/:name` to the agent.
- `robot-agent/src/api/rest-routes.ts:1679` proxies that to the sidecar's
  `/cameras/<name>/stream` behind `personalDataGate`.
- `robot-agent/hardware/g1_sidecar.py` had no such route → 404 → the agent
  reported `CAMERA_UNAVAILABLE` and the cockpit showed a dead panel.

Second defect found on the way: `/cameras` answered a hardcoded
`["head_camera", "left_wrist_camera", "right_wrist_camera"]` while
`_realsense_color_jpeg()` ignored the name it was given, so all three names
returned the same D435 frame and an operator could not tell which view was live.

### Robot Agent (`robot-agent/hardware/g1_sidecar.py` — the only file changed)

- One source of truth for which cameras exist: `_camera_source_and_names()`
  reports the active source (`lerobot` / `realsense` / none) and the names it
  can actually serve. `/cameras`, `/cameras/<n>/snapshot` and the new
  `/cameras/<n>/stream` all read from it, so the advertised list and what a
  stream accepts cannot drift apart. RealSense serves exactly one name
  (`G1_CAMERA_NAME`, default `head_camera`, matching the `enabled: true` camera
  in `src/embodiment/configs/g1_edu.yaml`); lerobot names come from the
  observation keys that hold a 3-D array, cached.
- `GET /cameras/<name>/stream`: `multipart/x-mixed-replace; boundary=FRAME`,
  capped by `G1_CAMERA_STREAM_FPS` (default 15, matching the sim's
  `STREAM_MAX_FPS`). The first frame is grabbed BEFORE the 200 so an unknown
  name can still answer 404 and a frameless source 503 — once the multipart
  header is on the wire a browser has no way to show an error and would wait
  forever on an empty stream. Keep-alive is switched off by hand (a stream has
  no Content-Length); `BrokenPipeError`/`ConnectionResetError` end it quietly.
- `_realsense_color_jpeg_bytes()` split out of the base64 version so streaming
  does not base64-encode and decode every frame. `_rs_lock` is held for the
  grab only, never across `imencode`: the same lock serialises
  `/pointcloud/<n>/snapshot` (2000 ms frame wait), which feeds Agent Mode's
  `goto` arrival test, so a video preview must not starve navigation.
- `/cameras/<n>/snapshot` keeps its 200-with-`ok:false` contract for a bad name;
  the Node hardware seam has always read failure out of the `ok` field there.

### New environment variables

| Var | Default | Meaning |
|---|---|---|
| `G1_CAMERA_NAME` | `head_camera` | Name for the single RealSense colour stream |
| `G1_CAMERA_STREAM_FPS` | `15` | Per-stream frame cap (not a sum across viewers) |

## Test Strategy

Verified (no camera hardware attached yet, by explicit decision — the RealSense
grab itself is first exercised on robot day):

- [x] `/cameras` returns `[]` with `source: null` on a box with no camera, and
      `/cameras/<n>/stream` answers a clean JSON 503 rather than hanging.
- [x] With a stubbed frame source over real HTTP: 30 multipart boundaries in
      2 s (the 15 fps cap), every part a valid JPEG with a correct
      `Content-Length`, 30 distinct frames (genuinely advancing, not one
      repeated). 404 for an unknown name, 503 for no-frame and for no-source.
- [x] Full chain browser → server ticket → agent proxy → sidecar: 45 frames in
      3 s on `GET /api/robots/sim-robot-g1-edu/camera/head_camera?ticket=…`.
- [x] `robot-agent/hardware/tests/` — 86 passed, 17 skipped (unchanged).
- [ ] Robot day: `pip install pyrealsense2` into the sidecar's env, attach the
      D435 over USB, restart the sidecar, confirm `head_camera` appears in
      `/cameras` and renders live in the cockpit.

## Notes

The RealSense frame is not calibrated to the torso — the same caveat the
point-cloud path already carries. The live view stays behind the agent's
`personalDataGate`: it is a live view of whichever room the robot is in.
