---
id: "TASK-456"
aliases: []
title: "Edit task after a session rewrites the dataset's task"
slug: "edit-task-after-a-session-rewrites-the-dataset-s-task"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# Edit task after a session rewrites the dataset's task

## Description

On a completed session, Edit task changes only the session row in the
database. The dataset the robot wrote keeps the instruction given at Start: its
`meta/tasks.parquet` is the index LeRobot reads `item["task"]` from. So a VLA
trains on the old text while the page shows the new one. This already happened:
the real dataset of session `e09646cc` (2026-10-17) trains on the task "Gggg".
This task makes Edit task rewrite the dataset's task and the registered Dataset
row. Until then, the modal says that the dataset keeps the original task.

Branch: `fix/task-456-edit-task-after-a-session-rewrites-the-dataset-s-task`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `server/src/services/TeleoperationService.ts:1948-1966`, `annotateSession`:
  `prisma.teleoperationSession.update({ data: { languageInstr } })`, nothing
  else. Route: `POST /api/teleoperation/sessions/:id/annotate`
  (`server/src/routes/teleoperation.routes.ts:571-583`).
- The agent gets the task once, at `/recording/start`
  (`TeleoperationService.ts:529`, `task: session.languageInstr`), and the
  writer puts it in four places:
  - `meta/tasks.parquet`, a pandas frame whose INDEX is the instruction:
    `writeTasksParquet`, `robot-agent/src/recording/lerobot-writer.ts:320-390`.
    The header comment explains why two plain columns break `item["task"]`;
  - `meta/tasks.jsonl` (`lerobot-writer.ts:576`);
  - the `tasks` column of `meta/episodes/chunk-000/file-000.parquet`
    (schema at `lerobot-writer.ts:476`, rows at `:531`);
  - `meta/episodes.jsonl` and `meta/episodes.json` (`:568`, `:574`).
- The registered Dataset row's description carries the task too:
  `registerAgentDataset`, `TeleoperationService.ts:2758-2761`
  ("Teleoperation on <robot>: <task>").
- The session stores where the dataset is: `agentDatasetPath`
  (`server/prisma/schema.prisma:1798`, written at `TeleoperationService.ts:941`),
  and `exportedDatasetId` names the Dataset row.
- App:
  - `app/src/features/datacollection/pages/SessionDetailPage.tsx:572-580`,
    `handleAnnotate`, toasts "Task updated";
  - the modal is at `:1314-1328` ("The language instruction the policy is
    trained on.");
  - the wrap-up opens it from
    `components/session/SessionCompleted.tsx:385-391`.
- The server already shells out to the curation venv for dataset edits
  (`server/curation/curate.py`, subcommands at `:539-562`, run through
  `server/src/services/EpisodeCurationService.ts`). pyarrow there rewrites a
  parquet and keeps every other column as it is. The server's
  `@dsnp/parquetjs` cannot safely round-trip the episodes parquet's nested
  stats columns.

### Decisions

- The rewrite is **in place**, on the session's own dataset (`agentDatasetPath`,
  or the Dataset row's `storagePath`). The instruction is metadata of that
  session, and a View or a training export that reads the dataset should see the
  corrected text. A curated revision (another row) is not touched.
- The rewrite runs in Python: a new `curate.py set-task --dataset <dir> --task
  "<text>"` subcommand.
- A dataset this server cannot read (a robot on another host) is not rewritten.
  The session row is still updated, and the answer says so.

### Server

- `curate.py set-task` rewrites:
  - `meta/tasks.parquet` in the pandas-index layout, which `writeTasksParquet`
    documents (`__index_level_0__` plus the `pandas` metadata key);
  - `meta/tasks.jsonl`;
  - the `tasks` column of every `meta/episodes/**/*.parquet`;
  - `meta/episodes.jsonl` and `meta/episodes.json` when present.
  Write each file to a temp name and rename, so a failure leaves the old
  dataset whole. One task per dataset (`task_index` 0) is all the agent writes;
  refuse a dataset with more than one task (`MULTI_TASK_UNSUPPORTED`).
- `annotateSession`: for a `completed` session with `recorderKind === 'agent'`
  and a dataset directory that exists on this server, run `set-task`, then
  update the Dataset row's description, the same sentence `registerAgentDataset`
  builds. Return `{ session, datasetUpdated: boolean, reason? }`, or add the flag
  to the response. Keep the route's shape for older clients.
- Sessions that are not completed keep today's DB-only update. The agent reads
  `languageInstr` at start, so a session in `created` needs nothing more.

### Frontend

- The Edit task modal on a session with `exportedDatasetId` says one of:
  - "The dataset on disk is updated too." (the server can rewrite it);
  - until this lands, or when the server answers `datasetUpdated: false`:
    "The dataset keeps the original task: <old>. Fix it before training."
- The toast says which of the two happened.

### Key files

- `server/curation/curate.py`, `server/curation/tests/test_curate.py`
- `server/src/services/EpisodeCurationService.ts`
- `server/src/services/TeleoperationService.ts`
- `server/src/routes/teleoperation.routes.ts`
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/features/datacollection/api/datacollectionApi.ts`

## Acceptance Criteria

- [ ] Edit task on a completed agent session whose dataset is on this server
  rewrites `tasks.parquet`, `tasks.jsonl`, the episodes parquet `tasks` column and
  `episodes.json(l)`. pandas reads the new instruction back as the index, and
  `LeRobotDataset` returns it as `item["task"]`.
- [ ] Every other column and file of the dataset is unchanged.
- [ ] The Dataset row's description carries the new task.
- [ ] A dataset that is not readable here keeps its files; the modal and toast
  say the dataset keeps the original task.
- [ ] A failed rewrite leaves the dataset as it was and reports the reason.

## Test Strategy

- Curation pytest: on a v3.0 synthetic dataset (`make_synthetic_dataset.py
  --version v3.0`), run `set-task` and assert:
  - `pd.read_parquet(tasks.parquet).index[0]` is the new text;
  - the episodes parquet `tasks` column is `[new]` for every episode;
  - the other episodes columns are equal before and after;
  - two tasks are refused.
- Server vitest: `annotateSession` on a completed agent session calls the
  curation runner with the dataset path and updates the Dataset row; on a
  missing directory it updates only the session and answers
  `datasetUpdated: false`.
- App vitest: the modal's line for both answers.

## Notes

- Found by the 2026-10-31 pre-session bug hunt (data hunt, finding 3).
- Workaround: type the final instruction in New Session before Start, and check
  it on the session header. After the fact, fix `meta/tasks.parquet` and
  `tasks.jsonl` on a copy with pandas before training, or re-record.
