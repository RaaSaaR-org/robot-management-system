# TASK-439 — Optional wrist cameras

**Date:** 2026-10-31
**Task:** `.mc/tasks/todo/TASK-439-a-robot-with-wrist-cameras-shows-and-records-them-a-robot.md`
**Hand-off:** `/plan` — an epic; the children carry the work

Immutable once committed. Later changes of mind get their own record.

## How this was decided

A short grilling in the session of 2026-10-31. The agent mapped the camera path first (five
parallel readers: robot side, server + app display, headset, recording, docs and vendor
conventions), then put one question and its picks for the rest to the user. The user answered
"take your picks". Every decision below is therefore **Owner: agent, accepted by the user**;
none was overridden.

## What prompted it

The lab will fit the G1 EDU (g1-edu-4) with two wrist cameras for more precise
teleoperation. The user wants them in the app and the headset with a simple UI, and
optional: a robot or session without them must keep working, because a head-camera-only
data-collection session with Dex3 hands runs on 2026-10-31.

## Facts established before any decision was taken

| Fact | Why it mattered |
| ---- | --------------- |
| The sidecar serves cameras from one active source; `pc2cam` reads exactly one PC2 endpoint | D1: the work is concentrated on the robot side |
| Unitree's `teleimager` source already supports three cameras, but its head stream is binocular 1280 wide | D1: rejected, it changes the head data |
| App, server and agent camera routes are name-generic; the camera list is `cameras: string[]` | D4: one additive `configured` field is enough |
| The recorder records only `head_camera` unless told otherwise, all-or-nothing per tick, one session = one dataset | D2: the camera set is a per-session choice |
| `camera-map.ts` already maps the wrist names to Unitree's Dex3 keys | D5 |
| The space below the headset's head screen is free; the sides are taken at ±40° | D3 |
| The MuJoCo sim lists and renders any MJCF camera; wrist link bodies exist | D6 |

## Decisions

**D1 — Each wrist camera runs its own publisher in the head camera's wire format.**
A new `camera_pub.py` (UVC → framed JPEG, ports 5601/5602) runs wherever the camera is
plugged in, PC2 or the lab PC; the sidecar reads up to three endpoints. The head path stays as
it is, and the wiring can be decided later.
*Rejected:* Unitree's `teleimager` on PC2 — already supported, but it takes over the head
camera as a 1280-wide side-by-side stereo image, unlike every head-only take recorded so far.
*Rejected:* a lab-PC USB source in the sidecar — long cables along moving arms, and D1 covers
that wiring anyway by running the publisher locally.

**D2 — The robot declares its wrist cameras; each session chooses Head + wrists or Head
only, fixed for the session.** The default is Head + wrists when the robot has them. A
chosen wrist camera that is missing stops recording from starting, with the camera named.
*Rejected:* record whatever is served at start — the dataset's camera set would depend on
what happened to be up, and a flaky wrist would silently change the feature set.

**D3 — Layout.** Session page: head view big, both wrist views in a row beneath it (left
on the left), click to swap into the big view; head-only sessions look exactly as today.
Headset: two small panels below the head screen, tilted toward the eye, L/R labels, shown
automatically for a wrist session; a frozen wrist view never buzzes the controllers.
*Rejected:* overlaying the wrist views on the head picture — it covers where the grippers
appear. *Rejected:* panels that follow the hands — they move with every arm motion.

**D4 — Contract: one additive `configured` field on the camera list; `cameras` keeps
meaning "served now".** Old sidecars and the sim omit it and are read as today.
*Rejected:* a per-camera details object replacing `source` — it would break the readiness,
preflight and headset readers of the existing shape.

**D5 — Dataset keys stay: `cam_right_high` (head), `cam_left_wrist`, `cam_right_wrist`.**
*Rejected:* renaming the head key to `cam_high` — breaks continuity with every recorded take.

**D6 — The sim gets wrist cameras**, so the whole path is testable without hardware.
*Rejected:* testing only against a stub publisher — it never exercises the session page,
headset and recorder together.

**D7 — Nothing merges before the 2026-10-31 session without the user's OK.** The head-only
regression is an acceptance criterion of the epic.

## Consequences

- The PC2 side (installing two publishers as systemd units next to `g1-head-cam`) is a
  separate, owner-approved step once the cameras are mounted.
- Datasets from Head + wrists sessions and head-only sessions have different feature sets;
  the server's compatibility check reports that as "differs" and does not block a mix.
