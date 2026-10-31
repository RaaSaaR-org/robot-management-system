---
id: "TASK-446"
aliases: []
title: "A robot profile names its wrist cameras and Set up checks them"
slug: "a-robot-profile-names-its-wrist-cameras-and-set-up-checks"
status: "todo"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: "[[TASK-439]]"
depends_on: []
spe: 3
effort: "low"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# A robot profile names its wrist cameras and Set up checks them

## Description

A robot supervisor profile can name its wrist camera endpoints; "Start robot side" then
hands them to the sidecar and the start-up camera step checks each one, as a warning only.
A profile without them starts exactly as today.

## Details

### Current state

- `robot-agent/supervisor/src/profile.ts`: `Profile.pc2Camera` (~46) parsed from `host:port`
  (~234-240, throws `ProfileError` when malformed); `sidecarEnvFor` (~469-499) maps it to
  `G1_PC2_CAMERA_HOST/PORT` unless the profile's `sidecar.env` sets them; a sim profile
  defaults `G1_CAMERA_SOURCE` to `none` (~492); `SIDECAR_OWNED_KEYS` (~101-108) are keys the
  loader refuses in `sidecar.env`.
- `robot-agent/supervisor/src/steps.ts` `stepCamera` (~806-827): TCP-probes the one
  `pc2Camera` endpoint, reports `ok`/`warn` ("head camera …"), idle when the profile has no
  camera; never stops the start. Step id `camera` in `STEP_IDS` (~55-61).
- Profiles: `robot-agent/hardware/profiles/g1-edu-4.yaml` (`pc2Camera:
  192.168.123.164:5600` ~28, `sidecar.env.G1_CAMERA_SOURCE: pc2cam` ~46-47),
  `sim-g1-edu-dev.yaml` (`G1_CAMERA_SOURCE: none`).
- Sidecar contract (TASK-445): env `G1_WRIST_CAMERAS="left_wrist_camera@host:port,right_wrist_camera@host:port"`.
- Tests: `robot-agent/supervisor/__tests__/` (vitest; the supervisor suite runs in
  `./scripts/test-all.sh`).
- The readiness panel shows the supervisor steps (Set up step "Start robot side").

### Robot Agent (supervisor)

1. Optional profile field `wristCameras: { left?: "host:port", right?: "host:port" }`,
   parsed like `pc2Camera` (same `ProfileError` on a malformed value).
2. `sidecarEnvFor`: when present, set `G1_WRIST_CAMERAS` (`left_wrist_camera@…` first, then
   `right_wrist_camera@…`), unless `sidecar.env` sets it; never for a profile whose camera
   source is `none`/`off`. Add `G1_WRIST_CAMERAS` to `SIDECAR_OWNED_KEYS` only if that is
   the existing rule for derived keys (check `G1_PC2_CAMERA_HOST`).
3. `stepCamera`: additionally probe each wrist endpoint; add one check per wrist to the
   step's checks ("Left wrist camera 192.168.123.164:5601 answers" / "not answering — takes
   in a Head + wrists session will not start"); any wrist down → `warn`, never a stop. No
   wrist field → identical step output to today (snapshot-test it).
4. `g1-edu-4.yaml`: add the field **commented out** with the default ports 5601/5602 and a
   one-line note pointing at the wrist camera section of `docs/g1-edu-lab-bringup.md`.
5. `docs/g1-edu-lab-bringup.md`: the camera step row (~30) mentions the wrist checks; the
   manual env (~414) mentions `G1_WRIST_CAMERAS`.

## Acceptance Criteria

- [ ] `g1-edu-4.yaml` and `sim-g1-edu-dev.yaml` load and produce the same sidecar env and
      camera step output as on `main`.
- [ ] A profile with `wristCameras` produces the `G1_WRIST_CAMERAS` value above; a malformed
      value is a `ProfileError` naming the field.
- [ ] The camera step reports each wrist endpoint and only warns when one is down.
- [ ] Supervisor typecheck + vitest green.

## Test Strategy

Supervisor vitest: profile parsing (present, absent, malformed), env composition
(present, absent, sim/none, override in `sidecar.env`), `stepCamera` with fake TCP listeners
(both up, one down, none configured = unchanged output).
