---
id: "TASK-445"
aliases: []
title: "The sidecar serves wrist cameras next to the head camera"
slug: "the-sidecar-serves-wrist-cameras-next-to-the-head-camera"
status: "in-progress"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: "[[TASK-439]]"
depends_on: []
spe: 5
effort: "high"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# The sidecar serves wrist cameras next to the head camera

## Description

The G1 sidecar reads optional wrist camera endpoints (same wire format as the head camera)
alongside the head camera and serves them under `left_wrist_camera` / `right_wrist_camera`,
and the camera list says which cameras the robot is configured for. With no wrist endpoints
configured, everything is byte-identical to today.

## Details

### Current state

- `robot-agent/hardware/g1_sidecar.py`:
  - `_camera_source_and_names()` (~1665-1703) returns ONE source and its names; under
    `pc2cam` exactly one name `G1_PC2_CAMERA_NAME` (default `head_camera`, ~1697).
  - pc2cam singletons: `_pc2cam_reader`, `_pc2cam_absent_until`, `_pc2cam_lock` (~1468-1626),
    endpoint from `G1_PC2_CAMERA_HOST` (default `G1_ROBOT_IP`/192.168.123.164) /
    `G1_PC2_CAMERA_PORT` (5600); `_pc2cam_available()` does a 1 s TCP connect with a negative
    cooldown (~1585-1609); `_pc2cam_jpeg_bytes()` takes no name (~1599).
  - `_grab_camera_jpeg(name, resolved=None)` (~1706-1741) dispatches on the resolved
    source; `_stream_mjpeg` resolves once and pins it (~3092-3099) — re-probing per frame
    caused a measured 1.0 s freeze every 5 s (TASK-233); guarded by
    `test_a_stream_does_not_reprobe_the_sources_ahead_of_it` (test_g1_sidecar_pc2cam.py:293).
  - Routes: `GET /cameras` (~3153-3161) `{cameras, source, detail?}`; MJPEG
    `/cameras/<n>/stream` (~3068-3146); `/cameras/<n>/snapshot` (~3234-3255, 200 with
    `ok:false` on failure); `do_GET` matches the full path including the query (~3164), so
    `?format=raw` 404s and the agent (`HardwareClient.snapshotRaw`, ~1497-1515) retries
    plain — two requests per frame per camera.
  - `_no_camera_source_detail()` (~1632-1651) speaks only of the head camera.
  - The comment at ~1217-1231: TASK-233 removed a hard-coded head/left/right list because the
    wrist names aliased the head frame. Never reintroduce aliases.
  - `G1_CAMERA_SOURCE` none/off opens nothing (~1654-1662).
- Agent pass-throughs: `robot-agent/src/hardware/camera-list.ts` (~15-84, builds
  `{cameras, source, detail}`), `robot-agent/src/api/rest-routes.ts` GET
  `/robots/:id/cameras` (~1904-1934), `robot-agent/src/api/readiness-routes.ts` camera block
  (~157-186). Server: `server/src/routes/robot.routes.ts` GET `/:id/cameras` (~438-490)
  whitelists fields (`cameras` at ~462).

### Robot Agent (sidecar)

1. Env `G1_WRIST_CAMERAS="left_wrist_camera@<host>:<port>,right_wrist_camera@<host>:<port>"`
   (any `name@host:port` entries, names `^[A-Za-z0-9_-]+$`, ignore blanks; a malformed entry
   is logged once and skipped). Unset/empty → today's code path, unchanged.
2. Turn the pc2cam reader state into a per-endpoint registry (reader, lock, negative
   cooldown per endpoint) keyed by camera name; the head entry keeps
   `G1_PC2_CAMERA_HOST/PORT/NAME` and its existing behaviour; existing tests that patch the
   singletons keep working or are updated in the same change.
3. Listing: wrist cameras are listed when their endpoint is up, independent of the head
   (a down wrist drops only its own name; a down head does not hide live wrists), and never
   when `G1_CAMERA_SOURCE` is `none`/`off`. Head stays first; wrists in env order.
4. `/cameras` adds `configured: [head name, ...wrist names]` (every camera the sidecar is
   set up to serve, up or not). Existing fields unchanged; with no wrist endpoints
   `configured` is `[head name]` (or omitted when no source — pick one and test it).
5. `_grab_camera_jpeg` dispatches per camera name; a stream pins its camera's endpoint and
   never probes other endpoints per frame. Absent endpoints fail cheaply via their own
   cooldown (no 1 s connect per `/cameras` call per missing wrist).
6. `/cameras/<n>/snapshot?format=raw` → `200 image/jpeg` bytes (or the existing failure
   shape); the plain URL is unchanged.
7. `_no_camera_source_detail()` and stream 503 text name the missing wrist endpoint when
   that is what is missing; a head-only robot's messages are unchanged.

### Robot Agent (TS) + Server

8. `camera-list.ts`, `rest-routes.ts` cameras route and the readiness camera block pass
   `configured` through when present.
9. `server/src/routes/robot.routes.ts` GET `/:id/cameras` passes `configured` through when
   it is an array of strings.

## Acceptance Criteria

- [ ] `G1_WRIST_CAMERAS` unset: `/cameras` returns `{cameras: ['head_camera'], source:
      'pc2cam'}` plus only the additive `configured`; every existing sidecar test passes.
- [ ] Two fake wrist publishers + a fake head: `/cameras` lists all three head-first; each
      snapshot and stream returns that endpoint's frames (never the head's).
- [ ] One wrist publisher down: listed as configured, not served; the head and the other
      wrist stream without a stall (no re-probe in a running stream; a flapping wrist never
      freezes the head stream).
- [ ] `?format=raw` returns JPEG bytes; the agent then makes one request per frame.
- [ ] Agent and server pass `configured` through; typecheck + vitest + hardware pytest green.

## Test Strategy

Extend `robot-agent/hardware/tests/test_g1_sidecar_pc2cam.py` with fake publishers on
several ports (all up, one down, one flapping during a head stream measured for gaps), the
env parsing, `configured`, `none`/`off`; `test_g1_sidecar_http.py` for `?format=raw`. Agent
`camera-list` and server route vitest for the pass-through.
