---
id: "TASK-311"
aliases: []
title: "Add brand pack and new embodiment integration plan"
slug: "add-brand-pack-and-new-embodiment-integration-plan"
status: "done"
priority: 3
owner: "claude"
projects: []
customers: []
tags: ["extended"]
sprint: ""
parent: ""
depends_on: []
spe: 1
effort: "low"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Add brand pack and new embodiment integration plan

## Description
Publish two documentation sets that were written locally: the NeoDEM product brand pack (`brands/`) and the plan for integrating a new robot embodiment (`docs/new-embodiment-integration-plan.md`), both linked from `docs/README.md`. Also ignore local SQLite backups (`*.db.bak*`) so a 144 MB `server/prisma/dev.db.bak-*` can never be committed.

## Acceptance Criteria
- [x] `brands/README.md` and `brands/neodem/` (identity, positioning, messaging, voice, visual identity, logo alternatives) are committed
- [x] `docs/new-embodiment-integration-plan.md` is committed and linked from `docs/README.md`
- [x] `git check-ignore server/prisma/dev.db.bak-2026-09-11` matches

## Notes
Docs only; no code or test changes.
