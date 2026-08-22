---
id: TASK-200
aliases:
- TASK-200
title: Place v2 — real sites, twin-bound places and an enforced geofence
slug: place-v2-real-sites-twin-bound-places-and-an-enforced-geofence
status: done
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
- g1
- safety
- twin
sprint: ''
depends_on:
- '[[TASK-195]]'
due_date: ''
created: 2026-08-02
updated: 2026-08-02
status_note: 'CLOSED 2026-08-02 — merged as part of PR #216 (squashed to 4a9a7f2).
The geofence was verified live in the warehouse hall and it is exact while the
pose is trusted: a `walk forward 2 metres` aimed at keepout RACK-A was stopped
at x=3.52, 0.48 m clear of the rack face, with
"[SafetyMonitor] PROTECTIVE STOP: Keepout violated: Rack A (RACK-A) — 0.02 m
past the safety margin at (3.52, -2.50)", the plan aborted through
onSafetyStop, and the next command refused while the latch held. A second
approach on an earlier run reproduced it at (3.51, -1.99).
ONE GAP FOUND, filed as [[TASK-201]] rather than fixed here: once accumulated
travel passes PLACE_DRIFT_BUDGET_M the belief goes `stale`, poseTrusted is
false, the fence answers `unknown` and the SafetyMonitor changes nothing — so
enforcement lapses silently and the robot walked straight through RACK-A with
estop=armed and systemHealthy=true. Each module behaves as its own doc-comment
says; what is missing is that nothing tells the operator the fence is no longer
enforcing.'
---


# Place v2 — real sites, twin-bound places and an enforced geofence

## Description

Take place-awareness off the hand-authored sim graph and onto a **real site**: places derived from
a `DigitalTwin`, an operator re-anchor path for drifting odometry, and — the reason this task
matters — the first **enforced** spatial boundary.

`robot-agent/src/safety/types.ts:~29` declares `SafetyStopType 'zone_violation'` and **nothing
implements it**. The enum is currently a lie. Place-awareness is what makes it true, and it is what
turns "the agent decided to walk somewhere" from a prompt-level hope into an enforced boundary.

This is the first task in the sequence that needs the **real robot** and the first that needs
**server changes**.

## Details

### Design decisions (settled)

| Topic | Decision |
|---|---|
| Source of truth | Places live in **`TwinZone`** (twin world frame), gaining `type: 'room'` plus `roomType`/`placeType` in metadata. The fleet `Zone` rectangle is a **different, unrelated** concept and stays untouched. |
| Nav2 export | `TwinExportService` must **exclude** `type: 'room'` from the keepout raster. Getting this wrong turns every room into an obstacle. |
| Offline | The robot fetches the place graph over the existing zone-cache pattern and **caches it to disk**, so it survives the server being down. The robot-local file remains what the resolver reads. |
| Keepouts | Must not diverge between `places/_index.json` (offline-capable) and `TwinZone` keepouts (single source of truth for Nav2). One is generated from the other; write down which. |
| Geofence semantics | A protective stop requires a **known** pose inside a keepout. A null or stale pose must **not** trigger one — see the fail-closed split in TASK-199. Keepouts get a margin, and a stop must be recoverable by an operator who can see the robot is nowhere near the boundary. |
| Drift | Re-anchor by operator utterance (`source: 'declared'`, budget reset). The VLM is a corroborator that can only *downgrade* confidence — it never overrides geometry. |

### Known hazards from the twin lifecycle

- **Twins are not mutually registered.** Each `DigitalTwin`'s origin is an arbitrary robot pose at
  scan start (`ScanSession.originX/Y/Z`), so `AISLE-3` is only meaningful *within one twin*. The
  place file's `frame.twinId` is load-bearing, not decorative.
- **Unit/convention confusion is live in this codebase** — `PointCloudPose.yaw` is radians, Agent
  Mode is degrees, converted in exactly one place (`robot/state.ts:~579`). The resolver asserts the
  declared `frame` convention; do not skip the assert.
- **Real odometry drifts without bound.** A confidently wrong place is worse than "unknown". The
  drift budget from TASK-195 is what makes this safe to enforce against.

### Work

**Server**

- `server/prisma/schema.prisma:~234 TwinZone` — `'room'` in the type enum, `placeType` in metadata.
- `server/src/services/TwinExportService.ts` — exclude `type: 'room'` from the keepout raster.
- An endpoint serving the place graph in the robot's `places/_index.json` shape, so the robot does
  no translation.
- Authoring: `ZoneAuthoringOverlay` already paints polygons in the twin UI — extend it rather than
  building a second editor. **Open question to settle first:** hand-authored, or derived from the
  DBSCAN clusters the twin-builder currently computes and discards
  (`$UNITREE_ROOT/twin-builder/pipelines/open3d_pipeline.py:~100-107`)?

**Robot Agent**

- Fetch + disk-cache the place graph; fall back to the cached copy when the server is down.
- `src/safety/SafetyMonitor.ts` — implement `zone_violation` through the **existing** protective-stop
  path, which already has the correct auto-clear vs. manual-reset distinction. Do not add a new
  stop path.
- Operator re-anchor: *"you are in aisle 3"* → `source: 'declared'`, drift budget reset.
- A low-frequency `ROOM_PROMPT` for VLM corroboration on `scan` completion only — **never** bolted
  onto the entity-list vision prompt, where a bad label corrupts navigation.

## Test Strategy

- Unit: a keepout polygon with margin; a **known** pose inside triggers `zone_violation`; a `null`
  or `stale` pose does **not**; recovery requires an operator reset.
- Unit: frame assertion rejects a graph whose declared units/convention do not match the resolver.
- Unit: `TwinExportService` output contains no `type: 'room'` cells — this is the regression test
  that keeps rooms from becoming obstacles.
- Integration (sim first): drive into a keepout, confirm the protective stop, confirm recovery.
- **Real robot:** walk a 30 m loop, confirm the place goes `stale` rather than confidently wrong,
  re-anchor by voice, confirm the budget resets.

## Out of scope

- Multi-twin registration (making `AISLE-3` mean the same thing across two scans).
- Automatic re-localisation against the point cloud. Re-anchor is operator-driven in v2.
- Floors above ground — the resolver has the `floor` predicate from TASK-195, but no multi-floor
  site exists to test against.
