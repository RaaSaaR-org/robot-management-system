# TASK-337 — Alert.sourceId is polymorphic

**Date:** 2026-09-30
**Task:** `.mc/tasks/todo/TASK-337-alert-sourceid-is-a-robot-foreign-key-used-for-other-ids.md`
**Hand-off:** `/implement` — a single slice, no `/plan`

Immutable once committed. Later changes of mind get their own record.

## How this was decided

No interview took place. The decision was taken by the lead agent orchestrating
the run the user asked for ("continue working on the open task … finish so many
tasks as possible"), and handed to the implementing agent as settled. It is
marked **Owner: agent (unattended)** and is open to override.

## What prompted it

`Alert.sourceId` was a foreign key to `Robot` (initial schema), but callers put
task, incident and workflow ids in it. Every such alert failed with "Foreign key
constraint violated" and was never written. The TASK-274 end-to-end check found
it through the zone E-stop, which answered 500; #361 (TASK-335) worked around it
by no longer setting `sourceId` on zone and fleet E-stop alerts.

## Facts established before any decision was taken

| Fact | Why it mattered |
| ---- | --------------- |
| Nothing reads `alert.robot` or `robot.alerts` through the relation (server or app) | D1: dropping the relation needs no replacement lookup |
| `Alert.source` already says what kind of thing raised the alert (`robot`, `task`, `system`, `user`) | D1: it is the type tag a polymorphic id needs |
| The only robot resolution, the stale-alert sweep in `AlertService.sweepStaleAlerts`, filters `source: 'robot'` and looks the robot up by id | D1: the explicit lookup already exists |
| `onDelete: SetNull` nulled a robot alert's `sourceId` when its robot was deleted; the sweep then fell back to a name match in the title | D3 |

## Decisions

**D1 — Drop the foreign key; `sourceId` is read according to `source`.**
Owner: agent (unattended). The `robot` relation on `Alert` and `alerts` on
`Robot` are removed; `sourceId` stays an indexed, nullable string. A reader that
needs the robot looks it up where `source` is `robot` — the sweep already does.
Migration `20260930220000_task_337_alert_source_id_polymorphic` drops
`Alert_sourceId_fkey`.

*Rejected:* stop passing non-robot ids — it loses the link from an alert to the
task, incident or workflow that raised it. *Rejected:* the backlog's first
sketch, a separate `robotId` column with the relation plus a backfill — a second
column for what `source` + `sourceId` already say, and no reader needs the
relation.

**D2 — Zone E-stop alerts carry the zone id again.**
Owner: agent (unattended). `SafetyService.triggerZoneEStop` sets
`sourceId: zoneId` with `source: 'system'`. The fleet E-stop has no single
entity to point at and keeps no `sourceId`. No new `AlertSource` values are
added: that would touch the app and the robot-agent types for no reader.

**D3 — A robot alert keeps its id after the robot is deleted.**
Owner: agent (unattended). Without the relation there is no `SetNull`; the
dangling id is exactly what the stale-alert sweep matches on to resolve an
orphaned alert, so it replaces the title-name fallback for new rows.

## Consequences

- Task, incident, notification-workflow and zone alerts are written.
- `sourceId` is no longer guaranteed to name an existing row of any table.
