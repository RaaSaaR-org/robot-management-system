---
id: "TASK-461"
aliases: []
title: "Create dataset works for an agent session whose registration failed at End"
slug: "create-dataset-works-for-an-agent-session-whose-registration"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# Create dataset works for an agent session whose registration failed at End

## Description

At End, the server registers the dataset the robot agent wrote. If that
registration throws (a database hiccup, the robot-type lookup), the error is
only logged. The session completes with `agentDatasetPath` set and no
`exportedDatasetId`, so wrap-up offers Create dataset. Create dataset then
fails with "Cannot export session with no frames": `exportToLeRobot` knows the
sidecar and the server's own DB frames, but not an agent session, even though
the LeRobot tree is on disk. This task gives `exportToLeRobot` an agent branch
that registers the existing tree.

Branch: `fix/task-461-create-dataset-works-for-an-agent-session-whose-registration`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `server/src/services/TeleoperationService.ts`:
  - `:897-906`: `registerAgentDataset(session, agentResult, duration)` in a
    try/catch that only logs "registering the agent dataset failed";
  - `:941`: the session still stores `agentDatasetPath`;
  - `:2085-2152`, `exportToLeRobot(sessionId, dto)`:
    - `:2107`: a branch for `session.sidecarDatasetPath`;
    - `:2140` on: the DB-frame branch, which throws `Cannot export session with
      no frames` (`:2150`) when there are no `TeleoperationFrame` rows, and an
      agent session never has any;
  - `:2711-2790`, `registerAgentDataset(session, result, durationS)`: reads
    `meta/info.json` from `result.datasetPath` when readable. It uses
    `result.totalFrames`, `result.totalEpisodes`, `result.scene` and
    `result.simulated` (`:2750`, `simulated = result.simulated !== false`, so a
    missing flag reads as simulated).
- The stop result's shape: `AgentRecordingStopResult`,
  `server/src/services/AgentRecordingService.ts:80-95`.
- App:
  - `app/src/features/datacollection/components/session/SessionCompleted.tsx:85-95`,
    `wrapAction`: shows `create-dataset` when there is no `exportedDatasetId` and
    the session has frames;
  - the button is at `:286`.

### Server

- `exportToLeRobot`: after the sidecar branch, when `session.recorderKind ===
  'agent'` and `session.agentDatasetPath` is set:
  - read `meta/info.json` there. If it is not readable on this server, throw
    "The dataset is on the robot at <path>, which this server cannot read —
    import it from the Datasets page";
  - build the stop-result stub that `registerAgentDataset` takes:
    `datasetPath`, `totalFrames` and `totalEpisodes` from `info.json`
    (`total_frames`, `total_episodes`), `scene: null`, and `simulated` from the
    robot (the `sim-` id rule TASK-457 introduces, or `info.json`'s robot type),
    never defaulting a real robot to simulated;
  - call `registerAgentDataset`, store `exportedDatasetId` on the session, and
    return the same `ExportResultResponse` as the other branches;
  - honour `dto.datasetName` and `dto.description` if given.
- When the session already has `exportedDatasetId`, the agent branch answers
  that dataset instead of creating a second row.

### Key files

- `server/src/services/TeleoperationService.ts`
- `server/src/services/__tests__/TeleoperationService.test.ts`

## Acceptance Criteria

- [ ] A completed agent session with `agentDatasetPath` and no
  `exportedDatasetId`: Create dataset registers one Dataset row pointing at that
  path, with `info.json`'s frame and episode counts, and links it to the session.
- [ ] A real robot's dataset is not described as simulated.
- [ ] An unreadable path answers a sentence that names the path and the import
  route, not "no frames".
- [ ] Sidecar and frame-based exports are unchanged.

## Test Strategy

- Server vitest: a temp dir with a minimal `meta/info.json` (`total_frames: 300`,
  `total_episodes: 2`, `codebase_version: v3.0`). A completed session with
  `recorderKind: 'agent'` and that path → `exportToLeRobot` creates the row
  (repository mocked) with those counts and sets `exportedDatasetId`. A missing
  path → the sentence. A sidecar session → the existing branch runs.

## Notes

- Found by the 2026-10-31 pre-session bug hunt (session hunt, finding 7);
  confidence "possible", not seen live.
- Workaround: watch the server log at End for "registering the agent dataset
  failed". The dataset is still at the logged path; import it from the Datasets
  page instead of using Create dataset.
