---
id: "TASK-439"
aliases: []
title: "A robot with wrist cameras shows and records them; a robot without them works as before"
slug: "a-robot-with-wrist-cameras-shows-and-records-them-a-robot"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe:
effort: ""
due_date: ""
created: "2026-10-31"
updated: "2026-11-01"
---

# A robot with wrist cameras shows and records them; a robot without them works as before

## Description

A robot can declare a left and a right wrist camera next to the head camera, each served
by its own publisher in the head camera's wire format. New session offers Head + wrists
or Head only; a Head + wrists session shows the wrist views beneath the head view and
below the head screen in the headset, and records all three cameras, each at its own
size, refusing to start when a chosen camera is not served. The sim robot has both wrist
cameras. A robot or session without them works exactly as before. Spec in #458; split
into eight children (TASK-440 … TASK-447) and landed as PRs #459 … #466.

## Spec

The spec — the decisions, how it was sliced, what was verified, and what stayed out of
scope — is distilled in
[`docs/adr/ADR-439-a-robot-with-wrist-cameras-shows-and-records-them-a-robot.md`](../../../docs/adr/ADR-439-a-robot-with-wrist-cameras-shows-and-records-them-a-robot.md).
The decisions with their rejected options stay in
[`docs/records/TASK-439-optional-wrist-cameras.md`](../../../docs/records/TASK-439-optional-wrist-cameras.md).

It was removed from this file when the epic closed: a spec that outlives its epic reads
as current when it is not.

## Notes

Follow-ups: TASK-449 (cameras by name for a VLA policy, done in #468), TASK-474 (the
apple configs' `ego_view` gets `ego_camera`), TASK-460 (per-camera size reset between
sessions, untested). Installing the wrist publishers on PC2 is an owner-approved step
once the cameras are mounted.
