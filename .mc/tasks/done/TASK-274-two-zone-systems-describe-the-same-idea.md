---
id: "TASK-274"
aliases: []
title: "Two zone systems describe the same idea"
slug: "two-zone-systems-describe-the-same-idea"
status: "done"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server, app]
sprint: ""
parent: ""
depends_on: ["[[TASK-273]]"]
spe:
effort: ""
due_date: ""
created: "2026-09-12"
updated: "2026-09-30"
---

# Two zone systems describe the same idea

## Description

`TwinZone` is now the only zone model. The flat fleet `Zone` table, `/api/zones`,
the SVG FleetMap and the eight-zone seed are gone; navigation, zone E-stop,
deployments, verification, processes, `roboctl` and the dashboard all read the
digital twin's zones and the places derived from them, and `location.place` is a
robot's only answer to where it is. Split into nine children (TASK-326 … TASK-334)
and landed as PRs #351 … #359.

## Spec

The spec — the decision, the scope rule for which robots see zones, how it was
sliced, and the alternatives rejected — is distilled in
[`docs/adr/ADR-274-two-zone-systems-describe-the-same-idea.md`](../../../docs/adr/ADR-274-two-zone-systems-describe-the-same-idea.md).

It was removed from this file when the epic closed: a spec that outlives its epic
reads as current when it is not.

The interview that produced it, with the alternative each decision rejected, stays
in [`docs/records/TASK-274-two-zone-systems-describe-the-same-idea.md`](../../../docs/records/TASK-274-two-zone-systems-describe-the-same-idea.md).

## Notes

Breaking: `/api/zones` and the `Zone` table are removed by migration
`20260930210000_task_334_drop_fleet_zone`; rows carried no frame, so nothing was
migrated. Zones are only active for robots whose pose is in the twin frame (the sim
today); real robots stay unaligned and are listed beside the site map, not plotted.
Aligning odometry to the twin is TASK-325. The deletion (TASK-334) merged before
TASK-333, which was reconciled by merging `main` and taking 334's deletions.
