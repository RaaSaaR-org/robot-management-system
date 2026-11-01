---
id: "TASK-449"
aliases: []
title: "A VLA policy gets its cameras by name, not by list position"
slug: "a-vla-policy-gets-its-cameras-by-name-not-by-list-position"
status: "todo"
priority: 3
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: ["[[TASK-440]]"]
spe: 2
effort: "low"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# A VLA policy gets its cameras by name, not by list position

## Description

`captureHardware` in the robot agent's skill executor fills the camera names a VLA policy
was trained on with the sidecar's cameras **by list position**. Once a robot or sim lists
wrist cameras (TASK-440 gives the sim wrist cameras), a two-camera policy receives a wrist
view where it expects a head view. Map by name instead, using the inverse of the recording
camera map.

## Details

### Current state

- `robot-agent/src/vla/skill-executor.ts`, `captureHardware` (around lines 1790-1825):
  `sidecarCameras.slice(0, Math.max(needed, 1))` (~line 1798) takes the first N sidecar
  cameras, and the loop at ~1809-1816 gives the k-th vla-server camera the k-th snapshot,
  reusing the last one when the sidecar has fewer. The doc comment above it (~1781-1789)
  describes this positional mapping.
- Effect after TASK-440 (PR #461): the vla-server config `g1_dex3_2cam`
  (`cam_left_high`, `cam_right_high`) used to get `[head, head]` in the pickplace sim and
  now gets `[head, left_wrist]` — wrong view in `cam_right_high`'s neighbour slot.
- Unaffected: every one-camera config (all apple configs — GR00T, pi05, lingbot,
  unifolm — and `g1_dex3_1cam`) still gets the head camera. No config uses three or more
  cameras. The real robot is unaffected until wrist cameras are enabled in
  `robot-agent/hardware/profiles/g1-edu-4.yaml`.
- `robot-agent/src/recording/camera-map.ts` already maps scene camera names to the
  Unitree dataset keys (`head_camera` -> `cam_right_high`, `ego_camera` -> `cam_left_high`,
  per scene, with `DEFAULT_CAMERA_KEYS` as fallback). The policy side should use its
  inverse rather than a second table.

### Robot Agent

Replace the positional mapping with a name lookup per vla-server camera name:

| Policy name | Sidecar camera |
| ----------- | -------------- |
| `cam_right_high` | `head_camera` |
| `cam_left_high` | `ego_camera` where the scene has one, else the head camera |
| `cam_left_wrist` / `cam_right_wrist` | only the matching (left/right) wrist camera; else the head camera |
| anything else (e.g. SmolVLA `up`, `side`) | the head camera |

- Export the inverse lookup from `camera-map.ts` (or a small helper next to it) instead of
  hard-coding names in the executor.
- Fetch only the distinct sidecar cameras the mapping selects (no snapshot of a camera
  nobody asked for). If the sidecar lists no head camera, fall back to its first camera;
  if it lists none, keep `SYNTHETIC_GRAY_JPEG_B64`.
- Update the doc comment; drop the dead `physicalCount` / `void physicalCount`.

### Key files

- `robot-agent/src/vla/skill-executor.ts` — `captureHardware`
- `robot-agent/src/recording/camera-map.ts` — export the inverse lookup
- `robot-agent/src/vla/__tests__/skill-executor.test.ts` — new cases

## Acceptance Criteria

- [ ] `g1_dex3_2cam` in the pickplace sim (sidecar lists head + wrist cameras) gets the head
      frame in both `cam_left_high` and `cam_right_high`, never a wrist frame.
- [ ] `cam_left_high` gets `ego_camera` when the sidecar lists it.
- [ ] `cam_left_wrist` / `cam_right_wrist` get only the matching wrist camera, and the head
      camera when that wrist is absent.
- [ ] An unknown policy camera name gets the head camera.
- [ ] The result does not depend on the order the sidecar lists its cameras.
- [ ] One-camera configs (apple GR00T/pi05/lingbot/unifolm, `g1_dex3_1cam`) behave exactly
      as before.

## Test Strategy

- Vitest in `robot-agent/src/vla/__tests__/skill-executor.test.ts` on `captureHardware`
  with `hardwareClient` mocked (snapshot returns the camera name as its payload):
  - the same camera list in several orders (`[head, left_wrist, right_wrist]`,
    `[left_wrist, head, right_wrist]`, ...) gives identical images for a 2-camera and a
    wrist-camera config;
  - `ego_camera` present vs absent for `cam_left_high`;
  - missing wrist and unknown names fall back to the head camera;
  - no head camera -> first listed camera; empty list -> synthetic gray JPEG.
- `cd robot-agent && npm run typecheck && npx vitest run src/vla`.

## Notes

- Found by the TASK-439 integration check on 2026-10-31. Not a child of TASK-439; it only
  needs TASK-440's wrist cameras to be observable in the sim.
