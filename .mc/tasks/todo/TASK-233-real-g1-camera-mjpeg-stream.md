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
- [x] teleimager transport, against a real in-process image server
      (`tests/test_g1_sidecar_teleimager.py`, 9 tests): config handshake, only
      `enable_zmq` cameras advertised, JPEG passed through byte for byte,
      alternating payloads proving a live SUB rather than a cached frame,
      unknown/WebRTC-only names refused as names, and a missing server failing
      in <2 s and then <0.05 s from cache.
- [x] Full chain with a stand-in image server on this box: `/cameras` reports
      `source: teleimager` through sidecar -> agent -> server, and
      `GET /api/robots/g1-edu-4/camera/head_camera?ticket=…` delivered 45
      frames in 3 s (the 15 fps cap). Cockpit rendered it live with
      `CAM · HEAD_CAMERA` / `STREAMING`, zero console errors.
- [ ] Robot day, EITHER path: start `python -m teleimager.image_server` on PC2
      and confirm `head_camera` appears by itself (the cockpit polls, no
      reload); OR attach a D435 to this machine's USB with `pyrealsense2`
      installed in the sidecar's env.

### Follow-up (same branch, commit 69ec19e0): the cockpit lied when there was no camera

Found by driving the real robot: clicking `head_camera` on `g1-edu-4` showed a
rendering of the G1. Two causes, one of them not cosmetic.

- `CockpitViewport.tsx` compiled a per-robot-type camera list into the bundle,
  so it offered a chip the robot had no source for. The sidecar has known the
  answer since this task began — `/cameras` reports what the ACTIVE source can
  serve — but nothing carried it to the browser. Added `GET /robots/:id/cameras`
  on the agent (deliberately NOT behind `personalDataGate`: names and a reason,
  never imagery, and it is how an operator learns the gate is not the problem),
  `GET /:id/cameras` on the server, and `useRobotCameras` in the app, polled
  because the answer changes under a running robot when a camera is plugged in.
- The viewport's only alternative to the `<img>` was `Robot3DViewer`, so a
  camera with no frames fell through to the posed model — the one image
  guaranteed not to be the camera's view — behind an 11 px `NO SIGNAL` pill. A
  selected camera with no feed now renders an explicit `NO CAMERA FEED` panel
  carrying the sidecar's own `detail` sentence, a Retry, and a way back to the
  model. `/cameras` grew that `detail`.
- `_ensure_realsense()` now enumerates `rs.context().devices` before
  `pipe.start()` and caches absence for 2 s. With pyrealsense2 installed and no
  D435 attached, `start()` blocked while holding `_rs_lock`; Agent Mode's 3 s
  idle camera read piled up 28 connections and filled the listen backlog until
  `/health` stopped being accepted. 164 ms → 0 ms.

### Why the robot's OWN head camera still cannot be reached (2026-09-03)

Investigated on the live robot, and this is a robot-side fault, not a gap in
this repo:

- `RobotStateClient.ServiceList()` on domain 0 reports `video_hub_pc4`
  (the head camera hub) at **`status=-1`**, while `video_hub_pc4_chest` and
  `lidar_driver` sit at `status=0` (running).
- No DDS endpoint subscribes to `rt/api/videohub/request`, so
  `VideoClient.GetImageSample()` returns 3102 (send/timeout). The SDK's client
  is fine and does exist at `unitree_sdk2py/go2/video/video_client.py`; there is
  simply no service behind it.
- `rt/videohub/inner` is a `std_msgs::msg::dds_::String_`, i.e. status text —
  there is no passive image topic to subscribe to.
- `ServiceSwitch('video_hub_pc4', False)` and `(…, True)` both return **5201**
  (`ROBOT_STATE_ERR_SERVICE_SWITCH`) and the status stays `-1`. The service is
  not refusing to be switched; it is refusing to run. (Run once with the
  owner's explicit authorisation; Stage-1 read-only otherwise forbids it.)
- Nothing on the robot subnet serves video: `192.168.123.161` has no open TCP
  port, and `192.168.123.164` (PC2) has only 22 and 80 — port 80 being
  Unitree's `unitree-upgrade` OTA web UI (TornadoServer/6.3.3, built 2023-11),
  not a stream.

So the head camera needs either hands on PC2 (is the D435 actually plugged into
it? does the hub's binary/config survive a look?) or the workstation-USB path
this task already implements. Diagnosing the former means an SSH login on PC2
with the owner's password, which is the box the architecture in
`docs/g1-edu-lab-bringup.md` deliberately leaves untouched.

### The path that actually reaches the robot's eyes: teleimager (2026-09-03)

Prompted by the owner pointing out that teleoperation HAD live camera hours
earlier. It does, and not through DDS: Unitree's own teleop reads frames from
`image_server.py` running on **PC2**, over plain ZMQ. That is the supported
route to the G1's cameras and it sidesteps the dead `video_hub_pc4` entirely.

Protocol, read out of `xr_teleoperate/teleop/teleimager/src/teleimager/image_client.py`:

- REQ `b"GET_DATA"` to `tcp://<host>:60000` → JSON config, one entry per camera
  with `zmq_port`, `enable_zmq`, `image_shape`, `binocular`
- SUB `tcp://<host>:<zmq_port>`, subscribe `""` → each message is a raw JPEG

`g1_sidecar.py` gained `teleimager` as a camera source, ahead of `realsense` in
the `auto` order (on a real G1 it IS the robot's eyes; a D435 on the
workstation sees whatever the desk faces). Only cameras with `enable_zmq: true`
are advertised — a WebRTC-only camera would be a name whose stream can never
open, which is the exact defect this task exists to remove. Frames are passed
through unmodified: no decode, no re-encode, so the sidecar adds no latency and
no quality loss to what teleop already receives.

Failure stays cheap, for the reason the RealSense probe taught us: a REQ socket
is poisoned by a timeout, so it is created and closed per attempt, and absence
is cached for 5 s. Measured <2 s first attempt, <0.05 s cached.

Starting it on the robot (from `xr_teleoperate/README.md:394`):

```bash
ssh unitree@192.168.123.164
cd ~/image_server && python -m teleimager.image_server   # or: teleimager-server
```

### New environment variables (teleimager)

| Var | Default | Meaning |
|---|---|---|
| `G1_IMAGE_SERVER_HOST` | `G1_ROBOT_IP` (192.168.123.164) | Where image_server.py runs |
| `G1_IMAGE_SERVER_PORT` | `60000` | Its config responder port |
| `G1_IMAGE_SERVER_TIMEOUT_MS` | `1000` | Config request timeout |
| `G1_IMAGE_SERVER_FIRST_FRAME_S` | `2.0` | Grace for the first frame after a SUB connects |

## Notes

The RealSense frame is not calibrated to the torso — the same caveat the
point-cloud path already carries. The live view stays behind the agent's
`personalDataGate`: it is a live view of whichever room the robot is in.
