---
id: "TASK-246"
aliases: []
title: "Make the tracker tell the truth again"
slug: "make-the-tracker-tell-the-truth-again"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "medium"
due_date: ""
created: "2026-09-05"
updated: "2026-09-05"
---

# Make the tracker tell the truth again

## Description

Six of the nineteen open task files state a status that contradicts `main`, and every one of
them is missing the three frontmatter fields `/plan`, `/ship` and `/implement` now read.
`.claude/rules/tasks.md` opens with "the tracker never lies"; right now it does.

## Details

### Current state

A read-only audit across all nineteen open tasks, cross-checked against `origin/main` and the
GitHub PR list, found two separate problems.

**Statuses that contradict `main`.** `review` claims an open PR and `in-progress` claims an
agent at work; the repo's only open PR is release-please's #265.

| Task | Says | Reality |
|------|------|---------|
| TASK-183 | `review` | no PR was ever opened for it |
| TASK-227 | `in-progress` | #277 and #278 merged; nothing in flight |
| TASK-203 | `in-progress` | #219, #270, #272, #275 all merged; nothing in flight |
| TASK-186 | `in-progress` | #269 and #273 merged; nothing in flight |

Three further tasks describe work that is already on `main` and were never closed — TASK-231
(fixed by c44e900a + f3c3f7e7, and `verify_isaac_odom_offline.py` passes), TASK-226 and
TASK-203. Each of those claims is checked by an independent three-lens refutation before its
status is flipped; a task that survives refutation closes, one that does not is corrected to
`todo` instead.

**Fields the workflow reads but no file carries.** TASK-245 made `parent:`, `spe:` and
`effort:` load-bearing — `/ship` reads `parent:` to decide an epic close-out, `/implement`
reads `effort:`, `/plan` writes both — and added them to `.mc/templates/task.md`. All
nineteen open files predate that and carry none of the three. A missing `parent:` is read by
`/ship` as "no epic", which is indistinguishable from an epic it failed to find.

### Key files

- `.mc/tasks/todo/*.md` — every open task file
- `.mc/tasks/done/` — destination for the tasks that turn out to be complete

## Acceptance Criteria

- [ ] No open task file claims `review` without an open PR, or `in-progress` without a branch
- [ ] Every task whose work is on `main` sits in `done/` with `status: done`, and only after
      surviving an independent refutation
- [ ] Every remaining open task file carries `parent:`, `spe:` and `effort:`
- [ ] `spe:` values are the sizes measured by the triage pass, not placeholders
- [ ] `parent:` and `effort:` are present but empty — every open task is top-level, and `/plan`
      is the only skill that writes `effort:`, so a value here would fake a decision nobody made
      (`/implement` already defaults it from `spe:`)

## Test Strategy

`grep -L 'spe:' .mc/tasks/todo/*.md` returns nothing, likewise for `parent:` and `effort:`.
For each remaining `review`/`in-progress` file, `gh pr list --search "TASK-NNN"` shows a
matching open PR or a live branch.
