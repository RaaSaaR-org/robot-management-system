---
id: "TASK-246"
aliases: []
title: "Make the tracker tell the truth again"
slug: "make-the-tracker-tell-the-truth-again"
status: "done"
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

Three further tasks looked complete on `main` and were proposed for closure — TASK-231
(c44e900a + f3c3f7e7, and `verify_isaac_odom_offline.py` passes), TASK-226 and TASK-203. Each
claim was put to three independent reviewers, one per lens — acceptance criteria, actually
running the checks, and quietly-unfinished scope — each told to refute it and to default to
refuted when unsure.

**All three claims were refuted**, so none of them closes:

| Task | Vote | What is actually left |
|------|------|----------------------|
| TASK-231 | 2 of 3 | the named defect still lives one field over — `SportModeState_.velocity` carries the *commanded* velocity on frames stamped `0x600D` ground truth, while `rt/sim_state.root_velocity` sits unused in the same payload |
| TASK-226 | 2 of 3 | `docs/architecture.md:153-159` still declares `vla_skill` deliberately not in v1 — the exact sentence the task exists to undo — and the planner bench the task calls "the gate" was never re-run |
| TASK-203 | 3 of 3 | step 4 is unticked, its "with no Agent Mode code changes" clause was violated by the +663-line PR claimed to satisfy it, and the code now on `main` has never been driven live |

The findings are written into each task file so the next reader starts from them. This is the
result worth keeping: a status audit that trusted its own first pass would have closed three
open tasks, and two of the three carry small offline work that is now visible instead of lost.

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
- [ ] No task is closed as `done` without surviving an independent refutation — and where
      the refutation succeeds, what it found is written into the task file
- [ ] Every remaining open task file carries `parent:`, `spe:` and `effort:`
- [ ] `spe:` values are the sizes measured by the triage pass, not placeholders
- [ ] `parent:` and `effort:` are present but empty — every open task is top-level, and `/plan`
      is the only skill that writes `effort:`, so a value here would fake a decision nobody made
      (`/implement` already defaults it from `spe:`)

## Test Strategy

`grep -L 'spe:' .mc/tasks/todo/*.md` returns nothing, likewise for `parent:` and `effort:`.
For each remaining `review`/`in-progress` file, `gh pr list --search "TASK-NNN"` shows a
matching open PR or a live branch.
