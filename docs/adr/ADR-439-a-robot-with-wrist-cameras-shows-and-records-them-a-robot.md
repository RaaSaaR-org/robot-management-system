# ADR-439 — A robot with wrist cameras shows and records them; a robot without them works as before

- **Status:** Accepted — implemented and merged 2026-11-01
- **Epic:** TASK-439 (closed; children TASK-440 … TASK-447, PRs #459 … #466; spec in #458)
- **Decision record:** [`docs/records/TASK-439-optional-wrist-cameras.md`](../records/TASK-439-optional-wrist-cameras.md) (D1–D7, with the rejected options)
- **Supersedes:** the spec body of TASK-439, distilled here so the task file can close

## Context

The G1 EDU gets two wrist cameras next to the head camera. Before this epic the sidecar
served cameras from one active source (PC2's single head-camera publisher), the recorder
took only `head_camera` because the server never passed a camera list, one image size
was written for every camera, and the headset showed one camera. App, server and agent
camera routes were already name-generic. The wrist cameras had to be optional per robot
and per session: a head-only robot, or a session that picks "Head only", keeps today's
flow exactly — a head-only data-collection session ran while the work was in flight.

## Decision

1. **One publisher per wrist camera, in the head camera's wire format.**
   `robot-agent/hardware/camera_pub.py` (UVC → `uint32 len | uint64 ns | JPEG` on TCP,
   ports 5601 left / 5602 right, Python 3.8) runs wherever the camera is plugged in. The
   sidecar reads up to three endpoints from
   `G1_WRIST_CAMERAS="left_wrist_camera@host:port,right_wrist_camera@host:port"`, one
   reader and one cooldown each; a down wrist drops only its own name, never the head.
   Unset → byte-identical to before. No aliases (TASK-233).
2. **The robot declares, the session chooses.** A profile's optional
   `wristCameras: {left?, right?}` becomes `G1_WRIST_CAMERAS`; Set up probes each as a
   warning. `TeleoperationSession.cameras` (nullable JSON; `null` = head only) is fixed
   for the session; the server forwards it to the recorder only when non-empty. A
   chosen camera that is not served refuses the start with 409 `CAMERA_NOT_SERVED`,
   naming it.
3. **Contract: one additive `configured?: string[]` on the camera list.** `cameras`
   keeps meaning "served now"; `configured` is everything the robot is set up for, head
   first. Absent (old sidecars, the sim) → read as `cameras`. "Has wrist cameras" =
   `configured ?? cameras` contains a `*_wrist_camera`.
4. **Names and dataset keys.** `head_camera`, `left_wrist_camera`, `right_wrist_camera`
   everywhere; keys stay `cam_right_high`, `cam_left_wrist`, `cam_right_wrist`. Each
   camera is recorded at its own size from its first JPEG; the thumbnail is the head view.
5. **Layout.** Session page: head big, wrist tiles beneath (left on the left), click to
   swap, an offline plate for a configured wrist not served. Headset: two small tilted
   panels below the head screen, own status store, no haptics on a stale wrist, ≤10 Hz.
   Head-only sessions render exactly as before.
6. **The sim gets wrist cameras** on the G1 Dex3 wrist yaw links, so the path is
   testable without hardware.

## Slicing

| Task | PR | Delivered |
| ---- | -- | --------- |
| TASK-446 | #459 | profile `wristCameras` → `G1_WRIST_CAMERAS`; Set up probes each wrist |
| TASK-444 | #460 | `camera_pub.py` wrist publisher, systemd example, bring-up docs |
| TASK-440 | #461 | sim `left_wrist_camera` / `right_wrist_camera` on the G1 Dex3 includes |
| TASK-445 | #462 | sidecar wrist readers, `configured`, `snapshot?format=raw`; agent/server pass-through |
| TASK-441 | #463 | `TeleoperationSession.cameras`, per-camera size, `CAMERA_NOT_SERVED` refusal |
| TASK-447 | #464 | New session offers Head + wrists (default) / Head only |
| TASK-443 | #465 | headset wrist panels below the head screen |
| TASK-442 | #466 | session page wrist tiles, "Wrist cameras" readiness row |

## Verification

- Fixed in review before merge: the publisher binds once but listens only while the
  camera delivers frames, so a TCP connect is a truthful "camera up" for Set up and the
  sidecar (#460); the take dock prefers a blocking reason over an earlier warning (#466);
  New session re-reads cameras the moment the robot comes online and resets the choice on
  a robot switch (#464).
- End to end against the dev sim, 2026-11-01: a Head + wrists session recorded a v3.0
  dataset of 119 frames with three video features, each `[480,640,3]` at 30 fps, each with
  stats, every mp4 119 frames at 640x480, thumbnail the head view. A request for an
  unserved camera answered 409 and wrote nothing. A head-only session recorded as before.
- Unit tests per child; Playwright specs for the session page (head-only and head + wrists,
  mocked cameras) and the New session form run in CI.

## Out of scope and follow-ups

- **TASK-449 (#468, done):** a VLA policy gets its cameras by name, not list position —
  needed once the sim served more than one camera.
- **TASK-474:** the apple configs' `ego_view` should get the scene's `ego_camera`.
- **TASK-460:** the recorder's per-camera size reset between sessions is still untested.
- The sim's `/cameras` does not emit `configured`, so that pass-through is covered by unit
  tests only.
- The headset's `?xremu` spec lives under `app/e2e/live/` and does not run in CI.
- Installing the publishers on PC2 (an owner-approved step once the cameras are mounted),
  stereo head, wrist depth, and recording wrists with Unitree `xr_teleoperate`.
