---
id: "TASK-346"
aliases: ["TASK-346"]
title: "RustFS recovers after a failed start, and the importer says when it cannot store"
slug: "rustfs-recovers-after-a-failed-start-and-the-importer-says-when-it-cannot-store"
status: "done"
priority: 2
owner: "FlrnFrmm"
projects: []
customers: []
tags: ["core", "storage", "datasets"]
sprint: ""
parent: ""
depends_on: []
spe:
effort: ""
due_date: ""
created: "2026-10-10"
updated: "2026-10-11"
---

# RustFS recovers after a failed start, and the importer says when it cannot store

GitHub: RaaSaaR-org/robot-management-system#368

## Description

A failed RustFS connection at startup no longer disables object storage for the
life of the process: the server retries in the background with backoff and keeps
the cause. With `RUSTFS_ENDPOINT` set, the HF importer answers 503
`STORAGE_UNAVAILABLE` instead of falling back to an unwritable local disk, and
prepares storage before it writes any metadata. `/health` reports storage state
under `dependencies.storage` while staying 200. Split into three children
(TASK-347 … TASK-349) and landed as PRs #369, #371 and #373.

## Spec

The spec — the four decisions, how it was sliced, and what stayed out of scope —
is distilled in
[`docs/adr/ADR-346-rustfs-recovers-after-a-failed-start-and-the-importer-says-when-it-cannot-store.md`](../../../docs/adr/ADR-346-rustfs-recovers-after-a-failed-start-and-the-importer-says-when-it-cannot-store.md).

It was removed from this file when the epic closed: a spec that outlives its epic
reads as current when it is not.

## Notes

The other storage callers that still fall back to local disk while RustFS is
configured are filed as TASK-350. The orphaned RobotType on Live
(`0799c6c9-59d7-4d91-82bb-174e3292b439`) is an operator's manual cleanup. The
fix reaches Live with the first release after 2026-10-11.
