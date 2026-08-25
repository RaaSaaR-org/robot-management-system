---
id: TASK-190
aliases:
- TASK-190
title: MID-360 frame orientation — decide once per scan session, not per frame
slug: mid360-frame-orientation-per-session
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
- digitaltwin
depends_on: []
due_date: ''
created: 2026-07-18
updated: 2026-08-25
status_note: 'Spun out of PR #198 review. Harmless for the stationary robot-day scan
  (twin 7d3cfc3e already flagged for rebuild) but a latent correctness bug on the
  walked-scan path the digital-twin feature ultimately targets. — 2026-08-25: SHIPPED.
  g1_sidecar.py now holds the MID-360 convention in a session-scoped
  `_Mid360Orientation`: it locks invert/upright plus a floor anchor from the first 3
  frames that carry a confident floor plane, then transforms every later frame with
  that convention regardless of the frame''s own floor content — a floorless doorway
  frame is anchored on the session floor instead of being left raw (+z down). The
  per-frame heuristic remains only for frames seen before a convention exists, and 3
  frames IN A ROW whose own plane contradicts the lock re-lock the session, so a
  robot-side publisher that genuinely switches to gravity-aligned clouds is still
  followed while one spurious table-top plane cannot overturn anything. The session id
  is threaded end to end: RobotStateManager passes its active ScanSession into
  hardwareClient.snapshotPointCloud, which sends it as the `X-Scan-Session` header
  (a header, not a query parameter, so a sidecar predating this change ignores it
  rather than 404-ing every frame) and Handler.do_GET hands it to get_point_cloud.
  Frames with no session share one live-view convention. VERIFIED ON THIS MACHINE
  (no hardware involved): 21 pytest cases in
  robot-agent/hardware/tests/test_g1_sidecar_pointcloud.py driving synthetic
  inverted / upright / floorless / truncated frames through g1_sidecar directly and
  over a real ThreadingHTTPServer with the header, 29 vitest cases across the
  robot-agent scan-session and hardware-seam files plus the 998-case agent-mode suite
  that consumes the same seam, `npm run typecheck` clean, and both directions proved by
  mutation (disabling the locked-session floorless branch turned 6 tests red; disabling
  the re-lock turned 1 red; dropping the session id in state.ts turned 2 red). Those
  tests were previously unreachable from the documented entry point —
  robot-agent/hardware/tests/ was never run by scripts/test-all.sh — so a SKIP-safe
  `Hardware sidecar (pytest)` stage was added (HARDWARE_PYTHON, auto-detecting either
  existing venv, documented in CLAUDE.md). REVIEW FIXES (PR #250): a frame too SPARSE
  to measure a plane from — a truncated DDS message — used to return above the session
  logic entirely and so was stitched in raw mid-sweep, the very defect this task is
  about reached by a second route; sparseness now gates the measurement only, and the
  locked session places the frame on its remembered anchor. The caller-supplied session
  id is narrowed by `scanSessionHeaderValue` before it becomes a header, because undici
  throws on CR/LF/NUL and getPointCloudFrame swallowed that throw and rebuilt the whole
  scan from synthetic points. The majority vote and the agreeing-median anchor were
  untested (a surviving mutant) and now have three cases; the hardware-stage exclusion
  of test_backends.py / test_vla_runner.py was justified by a false claim — the
  documented curation venv does have httpx — so the exclusion is gone, those cases
  self-skip per interpreter, and the stale TASK-146 assertion the exclusion was hiding
  (numpy frames are base64 JPEGs now, not nested lists) is fixed. The stage runs the
  whole of tests/: 78 passed / 17 skipped on the sim venv, 95 passed on the curation
  venv. NOT VERIFIED HERE: the integration half of the Test Strategy. There is no MID-360,
  no Unitree G1, no lidar and no recorded walked scan on this machine, so no real or
  replayed walked scan was normalized and no accumulated twin was inspected for a
  mirrored slice. Nothing was run against hardware, a GPU, Isaac Sim or a VLA server.
  A live re-check on the robot — walk a scan through a doorway and confirm the twin
  has no inverted slice — still remains to be done.'
---

## Description

`_normalize_mid360_frame` in `g1_sidecar.py` picks the point-cloud orientation
(invert / floor-anchor / leave-raw) **independently for every frame**, based on whether a
dominant floor plane is found within ~8 m. In a walked scan this can mix conventions between
neighbouring frames, so one slice of the accumulated twin ends up inverted/mirrored relative
to the rest. Decide the convention **once per scan session** (or from a stable gravity/IMU
signal) instead.

## Details

**Current state:** `robot-agent/hardware/g1_sidecar.py`, `_normalize_mid360_frame` (~line 2142).
Each frame is examined for a dense floor plane within ~8 m:
- floor found, sensor inverted (`plane_z <= 0.5`) → rotate 180° about x + anchor to floor
  (`a[:,1] = -a[:,1]; a[:,2] = plane_z - a[:,2]`)
- floor found, already upright → floor-anchor only
- **no dominant floor plane (e.g. frame aimed at an open doorway / sparse open space) → left raw (+z down)**

**Why it's wrong:** the ScanSession on the agent stitches every returned frame into the same
accumulated world map. A frame with no floor return is left un-flipped while its neighbours are
flipped, so that portion of the twin is mirrored/inverted. It only surfaces on a **walked** scan
where the sensor sweeps across surfaces some of which lack a floor return; the robot-day scan was
stationary so all frames resolved the same way.

**Fix direction:**
- Establish the orientation decision **once per scan session** — e.g. lock it from the first N
  frames that do contain a confident floor plane, or from a stable gravity/IMU reading — and apply
  that same transform to every subsequent frame regardless of its own floor content.
- Fall back to the per-frame heuristic only when no session-level convention could be established.

**Key files:**
- `robot-agent/hardware/g1_sidecar.py` — `_normalize_mid360_frame` and its caller (`get_point_cloud`)
- Wherever ScanSession accumulates frames on the agent (check that a session-scoped orientation
  can be threaded through, or computed sidecar-side and held for the session's lifetime)

## Test Strategy

- Unit: feed synthetic frames — inverted-with-floor, upright-with-floor, and floorless — through a
  session that has locked its convention; assert all three come out in the same (floor≈z=0, +z up)
  frame, i.e. the floorless frame is transformed to match its neighbours rather than left raw.
- Integration: replay/simulate a walked scan (or re-scan) that includes at least one floorless
  frame and confirm the accumulated twin has no mirrored/inverted slice.
