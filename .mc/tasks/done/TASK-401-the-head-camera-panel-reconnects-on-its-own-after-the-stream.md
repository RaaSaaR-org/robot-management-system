---
id: "TASK-401"
aliases: []
title: "The head camera panel reconnects on its own after the stream drops"
slug: "the-head-camera-panel-reconnects-on-its-own-after-the-stream"
status: "done"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1", "teleop", "datacollection", "vr"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# The head camera panel reconnects on its own after the stream drops

## Description

On the first real G1 day (2026-10-16) the in-VR head camera showed "CAMERA OFFLINE" after a single failure and stayed that way until the robot changed. The desktop session page has the same problem: its camera tile stops retrying while a recording runs. Both views must retry with backoff, say why they are offline, and recover by themselves when the PC2 camera (port 5600) or the sidecar comes back.

## Details

### Current state
- `app/src/features/robots/components/tabs/vr/HeadCameraPanel.tsx`
  - `const [failed, setFailed]` (~l.160) is set by `image.onerror` when there is a real `src` (~l.247), and by `armStream()` returning false, i.e. a failed ticket fetch (~l.260).
  - `failed` is cleared only by the `[image, robotId]` effect (~l.233).
  - The re-arm path in `useFrame` returns early on `if (failed || image.naturalWidth === 0) return;` (~l.295). That has two consequences:
    - (a) once `failed` is set, the panel never retries;
    - (b) a stream that never delivers its first frame never re-arms.
  - `REARM_INTERVAL_S = 5` (~l.46) covers only the stale case.
  - The offline plate is drawn at ~l.369.
  - No `image.onload` handler is installed.
- `app/src/features/robots/components/tabs/vr/vrCamera.ts`: `isRealLoadFailure` (~l.170) treats an empty `src` as not a failure. Keep that guard.
- `app/src/features/datacollection/components/CameraStreamView.tsx:42` auto-retries only `if (hasError && !offline && !isRecording)`, so a stream that fails during a recording never comes back.
- The agent's `GET /api/v1/robots/:id/cameras` (proxied by the server as `GET /api/robots/:id/cameras`) returns `{cameras, source, detail?}`. With the sidecar down, live g1-edu-4 returns `{"cameras":[],"source":null,"detail":"cannot reach the hardware sidecar"}`.

### Frontend
- `HeadCameraPanel.tsx`
  - Add a retry effect keyed on `failed || firstFrameMissing`. It schedules `armStream(image, robotId, isCurrent)` with exponential backoff of 1, 2, 4, 8, then at most 15 s, and bumps `armEpoch` exactly as the existing stale re-arm does (~l.351).
  - `firstFrameMissing` means `naturalWidth === 0` for more than 4 s after an arm.
  - Install `image.onload`, which clears `failed` and resets the attempt counter.
  - Reset the counter when `robotId` changes.
  - Before each retry, `GET /robots/:id/cameras`. If it returns a `detail`, the plate shows it (e.g. "cannot reach the hardware sidecar"). If `cameras` is empty, the plate says "no camera on this robot" and backs off at the cap.
  - The offline plate reads `CAMERA OFFLINE` / `<detail or "stream failed">` / `retrying in Ns · attempt k`, redrawn once per second.
  - Export the panel state through a tiny new zustand store, `app/src/features/robots/components/tabs/vr/vrCameraStatus.ts`: `{robotId, state:'live'|'stale'|'offline'|'connecting', detail:string|null, retryInS:number|null, fps:number|null}`. Later tasks read it: the VR robot panel in TASK-413 and the session page in TASK-414. This task only writes it.
  - Pull the backoff and plate text into pure helpers in `vrCamera.ts`, `nextRetryDelayS(attempt)` and `offlinePlateLines(state)`, so vitest can cover them.
- `CameraStreamView.tsx`
  - Retry while recording too, using the same backoff schedule (import `nextRetryDelayS`).
  - Show "Reconnecting in Ns" over the last good frame instead of a blank error.
  - A camera error never stops or pauses the recording. The recorder records whatever the agent sees.

### Key files
- app/src/features/robots/components/tabs/vr/HeadCameraPanel.tsx
- app/src/features/robots/components/tabs/vr/vrCamera.ts (+ its test)
- app/src/features/robots/components/tabs/vr/vrCameraStatus.ts (new)
- app/src/features/datacollection/components/CameraStreamView.tsx (+ test)

## Decisions
- **D1 Backoff 1→2→4→8→15 s cap, with no attempt limit.** A session lasts hours, and the camera service on PC2 drops every client when USB re-enumerates. Rejected: giving up after N attempts, which recreates the latch.
- **D2 Ask `/cameras` before each retry.** It costs one cheap GET and turns a bare OFFLINE into a reason. Rejected: retrying blind.
- **D3 This task writes the camera state to a store but no VR panel reads it yet.** That avoids file overlap with TASK-407, which edits `VrScene.tsx` in the same wave.

## Acceptance Criteria
- [ ] After a forced failure (ticket fetch returns 500 three times, then 200), the VR panel shows a live picture again with no page reload and no robot change.
- [ ] A stream that opens but delivers no first frame within 4 s is re-armed.
- [ ] The offline plate shows the agent's `detail` and a counting-down "retrying in Ns".
- [ ] `CameraStreamView` reconnects while the session is recording. The recording keeps running throughout.
- [ ] `vrCameraStatus` reflects live, stale, offline and connecting.
- [ ] `cd app && npx tsc` and the vitest suites for the touched files pass.

## Test Strategy
- **vitest**
  - `nextRetryDelayS` sequence and cap; `offlinePlateLines`.
  - A HeadCameraPanel hook-level test with fake timers and a mocked `armStream` that fails twice and then succeeds. Assert the epochs bump and the attempt counter resets on `onload` and on a robotId change.
  - `CameraStreamView` retries while `isRecording`.
- **Live check on the sim stack.** Use the sim agent on :41246 with sim sidecar :8777.
  - Run the branch app on a free port (`cd app && npx vite --port 1430`; it talks to the dev server on :3001).
  - Open the VR window with `?xremu` on `localhost:1430` for `sim-robot-g1-edu`.
  - Block the camera route in DevTools (request blocking) for 10 s, then unblock. The panel must recover.
  - Never stop the running sim sidecar to test this; use request blocking.
- No real robot.

## Implementation notes
- **I1 The retry logic lives in a new hook, `app/src/features/robots/components/tabs/vr/useCameraReconnect.ts`.** It is outside the key-file list. The spec asks for a hook-level test with fake timers, and `HeadCameraPanel` cannot render without a WebGL/R3F context. The hook owns arming, `onerror`/`onload`, the 4 s first-frame watchdog, the backoff, and the `/cameras` ask. The panel keeps liveness, stale re-arm, plate drawing and store writes.
- **I2 Retries arm even when `/cameras` returns an empty list.** The list only changes the plate text and holds the delay at the 15 s cap. The sidecar's list is its opinion, and a stream that answers anyway should not be skipped.
- **I3 The offline plate texture grew from 512×384 to 1024×768.** "cannot reach the hardware sidecar" (33 chars) did not fit at the old size. `offlinePlateLines` wraps longer reasons onto two lines of ≤36 chars.
- **I4 `CameraStreamView` keys its stream error on the failed URL, not on a boolean.** With a boolean, a retry remounted the `<img>` on the dead URL for one render before the new ticket arrived. That opened a second doomed request and counted its error as another failure.
- **I5 The last good frame is copied to a `<canvas>` once a second while the tile is live.** The tile shows that copy under the "Reconnecting in Ns" overlay.
- **Pre-existing, not changed:** the sim's head camera sends byte-identical frames of a static scene. The liveness check therefore calls it stale after 1 s and the stale path re-arms every 5 s. That behaviour predates this task.
