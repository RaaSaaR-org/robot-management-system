---
id: "TASK-281"
aliases: []
title: "Cleanup and refactor — what the rot sweep found"
slug: "cleanup-and-refactor-what-the-rot-sweep-found"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, server, app, compliance]
sprint: ""
parent: ""
depends_on: []
spe:
effort: "high"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Cleanup and refactor — what the rot sweep found

## Description

A seven-lens sweep of `app/`, `server/` and `robot-agent/` confirmed 19 defects of one shape:
code that is wired in and looks alive, but cannot work, because two sides of a boundary drifted
apart while the tests mocked the very seam that broke. Split into 21 children
(TASK-282 … TASK-302) and landed as a single PR.

## Spec

The spec — findings A–I with their `file:line` evidence, the split rationale, the corrections
made to this epic's own evidence, and the eight candidates the refutation pass rejected — is
distilled in
[`docs/adr/ADR-281-cleanup-and-refactor-what-the-rot-sweep-found.md`](../../../docs/adr/ADR-281-cleanup-and-refactor-what-the-rot-sweep-found.md).

It was removed from this file when the epic closed: a spec that outlives its epic reads as
current when it is not.

## Notes

Sweep run 2026-09-12: 7 finder agents + 7 adversarial refuters, 935 tool calls, ~2M tokens.
28 candidates → 8 refuted → 19 distinct confirmed. Findings carry the refuter's severity, not
the finder's.
