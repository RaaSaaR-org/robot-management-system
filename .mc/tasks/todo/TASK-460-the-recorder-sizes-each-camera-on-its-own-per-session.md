---
id: "TASK-460"
aliases: []
title: "The recorder sizes each camera on its own, per session"
slug: "the-recorder-sizes-each-camera-on-its-own-per-session"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core]
sprint: ""
parent: ""
depends_on: ["[[TASK-441]]"]
spe: 1
effort: "low"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# The recorder sizes each camera on its own, per session

## Description

The robot agent's `EpisodeRecorder` keeps one `imageSize` for all cameras.
It sets it from the first JPEG it ever sees and never clears it. A camera
restarted at another resolution between two sessions (no agent restart) makes
session B's `info.json` declare session A's shape, while its mp4 has the new
size. With two cameras of different sizes, every camera gets the first one's
shape. Policies that size their image input from the feature shape are then
misconfigured. This task keeps a size per camera and resets it at every
session start.

**Most of it is in TASK-441 (PR #463, open on 2026-10-31).** Its branch
replaces the field with `imageSizes: Map<cameraKey, {width, height}>`, resets it
in `start()`, and tests per-camera sizes within one session. What is left here
is the case TASK-441 does not test: a size change between two sessions of one
recorder. If #463 merges with such a test, close this task as done by #463.

Branch: `fix/task-460-the-recorder-sizes-each-camera-on-its-own-per-session`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `robot-agent/src/recording/EpisodeRecorder.ts`:
  - `:420`: `private imageSize: { width: number; height: number } | null = null;`;
  - `:1100`: `if (!this.imageSize) this.imageSize = jpegSize(jpeg);`, for the
    first camera's first frame only, whichever camera that is;
  - `:842-843`: every camera is declared to the writer with
    `this.imageSize?.width ?? 640` × `this.imageSize?.height ?? 480`;
  - `start()` (`:474`) does not clear it.
- On `origin/feat/task-441-a-session-created-with-cameras-records-every-one-of-them`:
  - `imageSizes = new Map()` (`:429`), reset in `start()` (`:602`), filled per
    `cam.key` (`:1129-1131`), read per camera at stop (`:867`);
  - test "declares each camera at its own size" in
    `robot-agent/src/recording/__tests__/EpisodeRecorder.test.ts`;
  - no test records two sessions with one recorder at different sizes.

### Robot Agent

- After TASK-441 merges, add to `EpisodeRecorder.test.ts`: one recorder,
  session A with a 64×48 camera stub, stop, then session B with the same key at
  32×24. Session B's `info.json` feature shape is `[24, 32, 3]`, and its mp4
  probes 32×24 when ffprobe is available.
- If TASK-441 did not land the reset, make it: clear the map in `start()`, keep
  one entry per camera key, and declare each camera from its own entry.

### Key files

- `robot-agent/src/recording/EpisodeRecorder.ts`
- `robot-agent/src/recording/__tests__/EpisodeRecorder.test.ts`

## Acceptance Criteria

- [ ] Two sessions on one recorder at different camera sizes each declare their
  own size in `info.json`.
- [ ] Two cameras of different sizes in one session each declare their own size
  (TASK-441's test, kept green).

## Test Strategy

- `cd robot-agent && npx vitest run src/recording` with the new two-session test.

## Notes

- Found by the 2026-10-31 pre-session bug hunt (data hunt, finding 8).
- Workaround: restart the robot side (supervisor) after any camera resolution
  change, and spot-check that `info.json`'s shape matches `ffprobe` of the mp4.
