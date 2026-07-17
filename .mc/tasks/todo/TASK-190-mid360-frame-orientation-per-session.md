---
id: TASK-190
aliases:
- TASK-190
title: MID-360 frame orientation — decide once per scan session, not per frame
slug: mid360-frame-orientation-per-session
status: backlog
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
updated: 2026-07-18
status_note: 'Spun out of PR #198 review. Harmless for the stationary robot-day scan
  (twin 7d3cfc3e already flagged for rebuild) but a latent correctness bug on the
  walked-scan path the digital-twin feature ultimately targets.'
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
