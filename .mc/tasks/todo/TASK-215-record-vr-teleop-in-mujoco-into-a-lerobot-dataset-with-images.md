---
id: TASK-215
aliases:
- TASK-215
title: Record VR teleop in MuJoCo into a LeRobot dataset with images
slug: record-vr-teleop-in-mujoco-into-a-lerobot-dataset-with-images
status: todo
priority: 1
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on: []
due_date: ''
created: 2026-08-22
updated: 2026-08-22
---


# Record VR teleop in MuJoCo into a LeRobot dataset with images

## Description

An operator puts on a Quest 3, drives the simulated G1 EDU through a MuJoCo
scene, and the session comes out the other end as a LeRobot v3.0 dataset with
camera video, separate commanded and measured signals, and enough provenance to
train on — on a machine with no NVIDIA GPU. Today the headset drives the robot
beautifully and the recording captures joint numbers only, so nothing we record
in simulation can train a VLA.

## Details

### Why now — what already exists (verified 2026-08-22, `main` @ `5673e731`)

Every piece of this exists except the one that joins them.

**The teleop loop works and is tested.** `app/src/features/robots/components/tabs/vr/`
(19 source files) streams `{positions:{joint:rad}}` over `/ws/keyboard-teleop` at
20 Hz; `robot-agent/src/robot/state.ts:1417` forwards to the sidecar at 50 Hz;
`robot-agent/hardware/sim_g1_dds/sim_node.py` applies it to MuJoCo and publishes
real `rt/arm_sdk` / `rt/dex3/{left,right}/cmd` DDS. 2,619 LOC of frontend tests
plus 25 sim `/action` tests already pin this path.

**The sim already renders cameras.** `sim_node.py` serves
`GET /cameras`, `GET /cameras/<n>/snapshot` (JPEG base64) and
`GET /cameras/<n>/stream` (MJPEG, `STREAM_MAX_FPS = 15`, rendered on the physics
thread). `g1_dex3_house_scene.xml` exposes `house_overview`, `house_iso`,
`house_follow`, `head_camera`. The VR head-camera panel consumes the stream today
— it is displayed and thrown away.

**The joint layout is already the dataset layout.** `sim_g1_dds/joints.py`:
`BODY[15:29]` is exactly the 14 arm joints (7 per side) and `LHAND` + `RHAND` are
exactly the 14 Dex3 joints. That is the `Unitree_G1_Dex3` 28-dim vector from
`unitree_lerobot/utils/constants.py`, already in the right order, already in
memory. Nothing needs deriving.

**The session and episode UI is finished.** `app/src/features/datacollection/`
(26 files, 6,300 LOC) has session create/start/pause/resume/end, next-episode
(`N`), per-episode discard, live camera views, quality warnings, and a
`vr_quest` session type that already hosts the real `VRTeleopSection`.

**What is missing is exactly one thing, and it is the important one.**

| Gap | Evidence |
|---|---|
| No image capture in the recording loop | `SimFrameRecorder.ts` polls `getTelemetry()` only. `TeleoperationFrame.imagePath` exists in the schema and has **zero writers** — grep finds it read at `TeleoperationService.ts:788,884` and written nowhere. |
| No video in the export | `LeRobotExportService.ts:392-410` declares features `observation.state` and `action` only. It never writes `videos/` and never declares `observation.images.*`. A VLA fine-tune on such a dataset fails at batch time with *"All image features are missing from the batch"* (`docs/training-pipeline-testing.md`). |
| `action == observation.state` | `SimFrameRecorder.ts:296` — `action: jointPositions`. The one signal a teleop rig uniquely produces (commanded vs. measured) is conflated. |
| The rig knows nothing about recording | `VRTeleopModal` / `VrTeleopRig` contain zero references to sessions or episodes. Capture is a side effect of a server-side telemetry poll. |
| No registration route for a produced dataset | `POST /api/datasets` refuses `storagePath` (`register-local-dataset.ts:3` says so in a comment). |

### How it is done in 2026 (research summary, links are the sources)

**Do not adopt [`unitree_mujoco`](https://github.com/unitreerobotics/unitree_mujoco).**
It is behind `sim_g1_dds`, not ahead of it. No hands (`g1_29dof_with_hand.xml`
was **deleted** in `f72e101`, 2025-09-28, after
[#91](https://github.com/unitreerobotics/unitree_mujoco/issues/91)), no cameras
([#118](https://github.com/unitreerobotics/unitree_mujoco/issues/118): *"目前确实没有带相机的模型"*),
no loco service, no `rt/arm_sdk`, Linux-only
([#33](https://github.com/unitreerobotics/unitree_mujoco/issues/33)). The
maintainer on [#79](https://github.com/unitreerobotics/unitree_mujoco/issues/79):
no plan for hands, it exists to verify locomotion controllers, use IsaacSim for
grasping. We already vendor its G1 meshes (`mjcf/g1/g1_29dof.xml`, pinned at
`ae6a8403`, BSD-3-Clause, `MESHES_LICENSE.md`) and that is the right amount of it
to take.

**Do not adopt [`xr_teleoperate`](https://github.com/unitreerobotics/xr_teleoperate)
for simulation.** Its `--sim` targets `unitree_sim_isaaclab` only; MuJoCo is not
supported and the maintainer declined the request in
[#119](https://github.com/unitreerobotics/xr_teleoperate/issues/119). Its Quest 3
path is its weakest: the WebSocket drops the instant you press "Virtual Reality"
in the stock browser ([#296](https://github.com/unitreerobotics/xr_teleoperate/issues/296)),
and latency reports cluster on Quest 3 — 80–334 ms headset ping against 0.5 ms to
the robot ([#120](https://github.com/unitreerobotics/xr_teleoperate/issues/120)).
Our rig runs WebXR directly in the page over `adb reverse`, which is the escape
hatch Unitree's own wiki recommends for exactly these problems.

**Take their data schema, though.**
[`unitree_lerobot`](https://github.com/unitreerobotics/unitree_lerobot)
`utils/constants.py` defines `ROBOT_CONFIGS['Unitree_G1_Dex3']`: 28 motors
(14 arm + 14 hand), cameras `cam_left_high`, `cam_right_high`, `cam_left_wrist`,
`cam_right_wrist`, images hardcoded `(480, 640, 3)`, `use_videos=True`,
`observation.state` and `action` the same width. v0.3 targets LeRobot **v3.0**.
This is the shape the public G1 datasets have and the shape Pi0 / GR00T recipes
expect, which is why this task writes v3.0.

**The closest upstream is not Unitree's at all.** LeRobot ships its own MuJoCo G1
([`lerobot/unitree-g1-mujoco`](https://huggingface.co/lerobot/unitree-g1-mujoco),
adapted from [GR00T-WholeBodyControl](https://github.com/NVlabs/GR00T-WholeBodyControl))
driven by `lerobot-teleoperate --robot.type=unitree_g1 --robot.is_simulation=true`
with cameras over a ZMQ server and capture via `lerobot-record`. Worth reading
before implementing; not worth adopting, because our sim already speaks the real
DDS wire protocol and theirs does not.

### Design decisions (settled — do not re-litigate during implementation)

1. **The recorder runs in the robot agent, not the server.** The frames are in
   the agent's process; the cameras are one hop away on the sidecar. Polling
   telemetry from the server (what `SimFrameRecorder` does) cannot see the
   commanded values at all and adds a network hop per frame.
2. **`action` is the commanded pose, `observation.state` is the measured pose.**
   `action` = what the teleop socket last accepted into `teleopJoints`;
   `observation.state` = what the sim reports back on `/state`. They are
   different arrays and must be stored as such. This is the entire point.
3. **28-dim, `Unitree_G1_Dex3` layout, in `joints.py` order** — `BODY[15:29]`
   then `LHAND` then `RHAND`. Legs and waist are not recorded: the operator does
   not teleoperate them, and a constant column is worse than an absent one.
4. **v3.0 on disk.** See [[TASK-217]] for the converter that keeps the local
   viewer and curation working; this task writes v3.0 and does not convert.
5. **Images come from `/cameras/<n>/snapshot`, not from the MJPEG stream.** The
   stream is paced for a human eye at 15 fps and shares the physics thread; the
   recorder needs deterministic per-frame capture aligned to the control tick.
6. **Recording never blocks the control loop.** A capture that falls behind
   drops frames and *says so in the episode metadata* — it does not stall the
   robot and it does not silently produce a dataset with a lie about its fps.
7. **The headset gets episode control.** An operator wearing a Quest cannot
   reach a DOM button. Right-hand `A` already recenters; recording needs its own
   binding (see Frontend).
8. **`fps` is measured, not declared.** `meta/info.json` records the fps actually
   achieved, and a session that missed its target says so.

### Robot Agent

**New: `robot-agent/src/recording/EpisodeRecorder.ts`**

- Started/stopped over REST by the server; owns one episode at a time.
- On each tick at the session fps (default 30, configurable):
  - reads `robotStateManager.getTeleopPositions()` → `action` (28 floats)
  - reads the last `/state` joint array → `observation.state` (28 floats)
  - requests a snapshot from each configured camera
  - appends `{frameIndex, timestamp, action, state, images}` to an in-memory
    episode buffer, spilling JPEGs to a temp dir as it goes
- Drops a frame rather than stretching the clock when a snapshot is late;
  counts drops and exposes them in the episode summary.
- On stop: encodes each camera's JPEG sequence to mp4 with ffmpeg, writes the
  v3.0 tree, returns the path.

**New: `robot-agent/src/recording/lerobot-writer.ts`** — the v3.0 writer.
`data/chunk-000/file-000.parquet` · `meta/episodes/chunk-000/file-000.parquet` ·
`meta/episodes.jsonl` · `meta/tasks.jsonl` · `meta/info.json` · `meta/stats.json` ·
`videos/observation.images.<cam>/chunk-000/file-000.mp4`.
`server/curation/neural_traj/convert.py` is the reference for the v2.1 shape of
the same idea (it already emits video); the v3.0 differences are in
`HuggingFaceImportService.resolveFileList()` (`server/src/services/HuggingFaceImportService.ts:307-440`),
which is the most complete version-aware path list in the repo.

**New REST routes** in `robot-agent/src/api/rest-routes.ts`:
`POST /robots/:id/recording/start` `{sessionId, fps, cameras[], task}` ·
`POST /robots/:id/recording/next-episode` ·
`POST /robots/:id/recording/stop` ·
`GET /robots/:id/recording/status` → `{recording, episodeIndex, frames, dropped, fpsActual}`.

**Camera naming.** The sim scene exposes `head_camera` and three cinematic
cameras. Map scene camera → dataset key via a per-scene table so the dataset
carries `observation.images.cam_right_high` etc. rather than
`observation.images.house_iso`. Put the table next to the scene list, not in the
recorder.

**Do not touch** `sim_node.py`'s `/record/*` — that is `cine_recorder.py`, the
demo-video MP4 recorder, and it is not a dataset. Name the new routes
`/recording/*` so the two never get confused.

### Server

- `TeleoperationService.startSession()` — when the robot is simulated, call the
  agent's `/recording/start` instead of `startSimRecorder()`
  (`TeleoperationService.ts:1216`). Keep `SimFrameRecorder` for robots whose
  agent is too old to answer, and log which path was taken.
- `POST /api/datasets` — accept an optional `storagePath` so a produced dataset
  can be registered without the out-of-repo script. This is the gap
  `register-local-dataset.ts:3` documents.
- Write a `DatasetProvenance` row when a sim dataset is registered: scene file,
  MJCF hash, sim commit, operator, session id, and that it is simulation-derived.
  The model exists (`schema.prisma:1735`) and nothing has ever written one.
- Persist the episode summary (frames, drops, achieved fps) so the UI can show
  an operator that episode 4 lost 12 % of its frames.

### Frontend

- `VRTeleopModal` / `VrTeleopRig`: **all four face buttons are taken, and
  deliberately** — `VrTeleopRig.tsx:279-291` binds `a-button` (right) *and*
  `x-button` (left) to recenter, `b-button` (right) *and* `y-button` (left) to
  E-Stop. The both-hands symmetry is a safety decision with a comment explaining
  it; do not break it to free a button.

  Bind **left thumbstick click** (`xr-standard-thumbstick`, the button state, not
  the axes) to next-episode. It is unused, it needs a deliberate press rather
  than a nudge, and a mis-hit costs an episode boundary rather than a stop.
  Add it to the controller-mapping card in `VRTeleopModal.tsx:134`.
- Wrist HUD (`VrWristHud.tsx`): show `REC ● ep 3 · 412 fr` while recording, so the
  operator knows without leaving VR. It recomposes at 8 Hz, which is enough.
- `SessionDetailPage`: show per-episode frame count, dropped frames and achieved
  fps from the new summary.

## Acceptance Criteria

- [ ] A `vr_quest` session on the simulated G1 EDU, driven from a Quest 3,
      produces a directory that `lerobot` can open as a v3.0 dataset.
- [ ] `meta/info.json` declares `observation.state` (28), `action` (28) and one
      `observation.images.<cam>` feature per configured camera, with real shapes.
- [ ] `videos/observation.images.<cam>/chunk-000/file-000.mp4` exists, plays, and
      has the same frame count as the parquet rows for that episode.
- [ ] `action` and `observation.state` differ on at least one frame of a real
      teleop episode — i.e. the commanded/measured distinction is genuinely
      recorded, not copied.
- [ ] Episode boundaries set from the headset (left `X`) land in
      `meta/episodes.jsonl` at the right frame indices.
- [ ] The dataset registers through `POST /api/datasets` with `storagePath` and
      appears on the Datasets page with a `DatasetProvenance` row naming the
      scene and sim commit.
- [ ] A session that cannot keep up reports `fpsActual` below target and a
      non-zero drop count; `meta/info.json` carries the achieved fps, not the
      requested one.
- [ ] Recording at 30 fps with two cameras does not degrade teleop: the
      `/ws/keyboard-teleop` round-trip stays within 20 % of its un-recorded
      median over a 2-minute run.
- [ ] The whole path runs on a machine with no NVIDIA GPU.

## Test Strategy

**Unit (robot-agent, vitest).** The v3.0 writer against a fixed synthetic
episode: parquet columns and dtypes, `episodes.jsonl` indices, `info.json`
feature block, `stats.json` per-feature mean/std/min/max. Frame assembly:
commanded and measured stay distinct; a late snapshot drops a frame instead of
duplicating a timestamp; the drop counter is accurate.

**Unit (sim, pytest).** Snapshot capture at 30 Hz for 10 s does not starve the
physics thread — assert `behind_s` from `/health` stays under a threshold.

**Integration.** Drive the sim with the existing `useSimulatedVrInput` synthetic
driver (`app/src/features/datacollection/hooks/useSimulatedVrInput.ts`) for 3
episodes, headset-free, in CI. Assert the resulting tree opens with `lerobot`,
has 3 episodes, and that the joint columns follow the known sinusoid.

**E2E.** Extend `app/e2e/datacollection-vr.spec.ts` — it already creates a
`vr_quest` session, records with the synthetic driver, advances and discards
episodes, and checks the exported dataset card. Add: the dataset has video, and
the episode viewer plays it.

**Manual, with the headset.** One real Quest 3 session in
`g1_dex3_house_scene.xml`: 3 episodes of a reach-and-grasp, episode boundaries
set from the controller, then open the result in the episode viewer and confirm
the video matches what the operator saw.

## Out of scope — v2, explicitly

- **Retargeting quality.** The arm mapping stays orientation-based with no IK.
  That is [[TASK-216]] and it changes how the data *looks*, not whether it exists.
- **Format unification and real validation.** v3.0 goes to disk; making the local
  viewer and curation read it is [[TASK-217]].
- Depth, tactile, audio. `xr_teleoperate` plumbs all three and populates none of
  them; we should not copy that.
- Recording on real hardware. `g1_sidecar.py` is `@status hardware-pending` and
  `/record/start` returns 403 under `G1_READ_ONLY`. Sim first.
- Automatic upload to RustFS. The dataset lands on disk and registers by path;
  `robot-agent/hardware/uploader.py` already exists when we want it.

## Notes

The premise this task was researched under — "adopt `unitree_mujoco`" — did not
survive contact with the repos. Both Unitree projects turned out to be *behind*
what `sim_g1_dds` already does, and the useful part of the research was the data
schema and a much clearer picture of our own gap. That is recorded above so the
next person does not redo it.

The single most surprising finding: `TeleoperationFrame.imagePath` has been in
the schema, in the types and in two read paths for months, and nothing has ever
written to it. The column is a plan someone made and did not finish.
