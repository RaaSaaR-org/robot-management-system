---
id: "TASK-470"
aliases: []
title: "Wrap up and the dataset header show recorded take time, not session wall time"
slug: "wrap-up-and-the-dataset-header-show-recorded-take-time-not"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# Wrap up and the dataset header show recorded take time, not session wall time

## Description

In the 2026-10-31 sim rehearsal, Wrap up showed "Recorded 10:03" and the dataset
header "10m 3s" for 57 s of kept takes (1653 frames at 30 fps). Both read the
session's wall time, from Start session to End, including setup and the time
between takes. The curated copy showed the true 53 s, because curation derives
it from frames. Anyone tracking how much data a day produced reads the wrong
number. This task makes Wrap up's "Recorded" the kept takes' time and registers
the dataset's `totalDuration` from its frames.

Branch: `fix/task-470-wrap-up-and-the-dataset-header-show-recorded-take-time-not`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `server/src/services/TeleoperationService.ts`:
  - `:809-812`: `duration = endedAt - startedAt` (session wall time), stored as
    `session.duration`;
  - `:900-905`: `registerAgentDataset(session, agentResult, duration)`;
    `:2770`: `totalDuration: durationS`, the wall time;
  - `:883`: the sidecar path registers `totalDuration: duration` too;
  - `:2190`: the DB-frame export already prefers `session.duration` over
    `totalFrames / session.fps`.
- `app/src/features/datacollection/components/session/SessionCompleted.tsx:339`:
  `<Readout … label="Recorded" value={formatDuration(session.duration)} />`;
  `:257` already computes `kept` episodes, each with `durationS` (`:158-159`).
- Dataset header: `app/src/features/training/pages/DatasetEpisodesPage.tsx:453`
  and the card `app/src/features/training/components/DatasetCard.tsx:279` print
  `dataset.totalDuration`.
- TASK-434 (a) (open) changes what counts as kept (not discarded and at least
  one frame). Use its helper if it has landed.

### Server

- Register agent and sidecar datasets with
  `totalDuration = totalFrames / fps` (the dataset's declared integer fps),
  which is what the dataset holds. `session.duration` keeps the wall time.
- Do the same at `:2190`, so all three paths agree.

### Frontend

- Wrap up's "Recorded" is the sum of the kept takes' `durationS`. The session's
  wall time moves to Details as "Session length".

### Key files

- `server/src/services/TeleoperationService.ts`
- `server/src/services/__tests__/TeleoperationService.test.ts`
- `app/src/features/datacollection/components/session/SessionCompleted.tsx`
- `app/src/features/datacollection/components/session/__tests__/SessionCompleted.test.tsx`

## Acceptance Criteria

- [ ] A session with 57 s of kept takes in a 10-minute session shows about
  0:57 as Recorded, and 10:03 as Session length in Details.
- [ ] Its registered dataset's `totalDuration` equals `totalFrames / fps`.
- [ ] Datasets registered before this change are not rewritten (noted below).
- [ ] Vitest covers both.

## Test Strategy

- Server vitest: `registerAgentDataset` with 1653 frames at 30 fps registers
  55.1 s whatever the session's wall time.
- App vitest: `SessionCompleted` with two kept takes (40.9 s, 14.2 s) and one
  discarded shows 0:55 as Recorded.
- On `sim-g1-edu-dev`: a session with a pause between two short takes; compare
  Recorded and the dataset header with frames / fps.

## Notes

- Found in the 2026-10-31 sim rehearsal ("Wrap up 'Recorded' and the dataset
  header show session wall time").
- Existing datasets keep their wall-time `totalDuration`; a one-off correction
  is not in scope.
- Workaround: read frames / fps, or the curated dataset's duration.
