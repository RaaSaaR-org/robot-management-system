---
id: TASK-041
aliases:
- TASK-041
title: Task Delegation with Retry/Reassign
slug: task-delegation-retry-reassign
status: done
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on:
- "[[TASK-004]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Task Delegation with Retry/Reassign

## Description
Enhance the process-to-robot task delegation system to automatically reassign failed tasks to different robots after exhausting retries on the same robot. When a robot fails a task, ProcessManager retries on the same robot first, and after maxRetries, reassigns to a different robot instead of failing the entire process.

## Notes
Migrated from task-master TM-36. Implementation complete.
