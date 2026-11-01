---
id: "TASK-467"
aliases: []
title: "A session has a name separate from its training instruction"
slug: "a-session-has-a-name-separate-from-its-training-instruction"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
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

# A session has a name separate from its training instruction

## Description

The New-session form has one text field, Task, and it is both the session's
name and the language instruction the policy is trained on. In the 2026-10-31
sim rehearsal the session was named "Rehearsal 2026-10-31 12:02: wave the right
arm and close the right hand", and that exact string went into the dataset's
`meta/tasks.jsonl` as the instruction; the dataset name was derived from it
too. A VLA would learn to follow "Rehearsal 2026-10-31 12:02: …". This task adds
an optional session name, used for lists, headers and the default dataset
name, and leaves Task as the instruction only.

Branch: `feat/task-467-a-session-has-a-name-separate-from-its-training-instruction`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- Schema: `model TeleoperationSession` in `server/prisma/schema.prisma` has
  `languageInstr String?` ("Language instruction for this demonstration") and
  no name field. `datasetRepoId` is the optional dataset name.
- App:
  - `app/src/features/datacollection/pages/NewSessionPage.tsx:242-252`: the
    Task field, hint "Becomes the language instruction the policy is trained
    on."; `:177` sends it as `languageInstr`; `:185` toast description;
  - `app/src/features/datacollection/utils/sessionFormat.ts:14`:
    `sessionName()` derives the session's display name from `languageInstr`;
  - `app/src/features/datacollection/components/SessionList.tsx:57`: search
    over `languageInstr`;
  - `app/src/features/datacollection/components/session/SessionCompleted.tsx:385`:
    Details shows the task.
- Server, `server/src/services/TeleoperationService.ts`:
  - `:487` and `:529`: the robot's recorder gets `task: session.languageInstr`;
    the agent writes it into `meta/tasks.*` (`robot-agent/src/recording/EpisodeRecorder.ts:571`);
  - `:2743-2746`: the agent dataset's name is `datasetRepoId`, else the
    slugified `languageInstr`;
  - `:876` and `:2758-2761`: the dataset description uses `languageInstr`.
- Types: `server/src/types/teleoperation.types.ts:46` (`languageInstr` on the
  session), `:142`, `:175`, `:183` (create and update DTOs).
- Related: TASK-456 (open) makes Edit task rewrite the dataset's task. The name
  added here is never written into the dataset's task.

### Server

- Migration: add `name String?` to `TeleoperationSession` (a new folder under
  `server/prisma/migrations/`, Postgres; check the SQLite dev path still pushes).
- Create and update DTOs accept `name` (trimmed, at most 120 chars, empty →
  null). The session response carries it.
- The default agent dataset name prefers `datasetRepoId`, then the slugified
  `name`, then the slugified `languageInstr`. The robot still gets only
  `languageInstr` as its task.

### Frontend

- New session: a "Session name (optional)" field above Task, hint "For your
  lists only. Not part of the training data." Task keeps its hint.
- `sessionName()` prefers `name`, then today's derivation. The list's search
  includes `name`.
- Wrap up Details shows Name (with Edit, through the existing update route)
  next to Task.

### Key files

- `server/prisma/schema.prisma`, a new migration under `server/prisma/migrations/`
- `server/src/types/teleoperation.types.ts`
- `server/src/services/TeleoperationService.ts`
- `server/src/routes/teleoperation.routes.ts` (validation, if it lists fields)
- `app/src/features/datacollection/types/datacollection.types.ts`
- `app/src/features/datacollection/pages/NewSessionPage.tsx`
- `app/src/features/datacollection/utils/sessionFormat.ts`
- `app/src/features/datacollection/components/SessionList.tsx`
- `app/src/features/datacollection/components/session/SessionCompleted.tsx`

## Acceptance Criteria

- [ ] A session created with name "Rehearsal 12:02" and task "Wave the right arm"
  writes only "Wave the right arm" to the dataset's tasks.
- [ ] Lists and the session header show the name when there is one, else what
  they show today.
- [ ] The default dataset name comes from the name when there is one.
- [ ] Sessions without a name behave exactly as before.
- [ ] Typecheck and vitest pass in server and app; the CI schema drift check
  passes.

## Test Strategy

- Server vitest: create with and without `name`; the agent start request
  carries only `languageInstr` as `task`; the dataset name derivation order.
- App vitest: `NewSessionPage` sends `name`; `sessionName()` prefers it.
- Playwright `datacollection-new-session.spec.ts`: fill both fields and assert
  the request body.
- On `sim-g1-edu-dev`: one short take; `meta/tasks.jsonl` (or
  `tasks.parquet`) holds only the instruction.

## Notes

- Found in the 2026-10-31 sim rehearsal ("Session 'Task' is both the name and
  the training instruction").
- Workaround: type only the instruction in Task; put names and dates in
  Advanced options → Dataset name (e.g. `neodem/g1-redcube-2026-10-31`).
