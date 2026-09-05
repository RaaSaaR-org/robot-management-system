---
id: "TASK-245"
aliases: []
title: "Repair the five-skill workflow so it can actually run"
slug: "repair-the-five-skill-workflow-so-it-can-actually-run"
status: "in-progress"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
depends_on: ["[[TASK-244]]"]
due_date: ""
created: "2026-09-05"
updated: "2026-09-05"
spe: 3
---

# Repair the five-skill workflow so it can actually run

## Description

The five workflow skills landed in git for the first time in #281 (TASK-244) and have never been executed end to end. A six-lens audit of the eight files found ten distinct defects that survived adversarial refutation, two of them blocking: `/ship` orders a push to `main` that the tracker policy forbids, and every GitHub command in `/review` and `/ship` names a `gh` binary that is not authenticated on this box. This task fixes all ten.

## Details

**Current state:** `.claude/skills/{grill,plan,implement,review,ship}/SKILL.md`, `.claude/agents/verify.md`, `.claude/rules/tasks.md`, `.claude/references/spe.md`. All eight are prose specs an agent executes literally.

Findings, verified by running the commands they contain:

| # | File | Defect | Evidence |
|---|------|--------|----------|
| B1 | `ship:41` | "Commit on `main` after the merge, and push" contradicts `tasks.md:46` "Never push to `main`" and `tasks.md:48` "task-file edits ride in the same PR". No legal path to `status: done`. | `main` is unprotected, so the push silently succeeds |
| B2 | `review:42`, `ship:14,18,25,30` | Five GitHub commands use plain `gh`. | `gh auth status` → "not logged into any GitHub hosts"; `gh pr list` exits 4. `gh-bot` exits 0 |
| S1 | `ship:48` | `grep -l 'TASK-NNN' .mc/tasks/todo/*.md` matches the parent's own file via its `id:` line, so "None remain" is unreachable and no epic ever closes. | `grep -l TASK-203 …` returns 3 files, one of them TASK-203 |
| S2 | `ship:45` | "Read the parent off the child's `depends_on`" cannot tell a parent from a blocker — `tasks.md:34` uses one edge type for both. The close-out would distill and gut an unrelated task. | TASK-227's `depends_on` is `[[TASK-203]], [[TASK-226]]`, both blockers |
| S3 | `verify.md:27-32` | Four `cd` lines in one fenced block; cwd persists, so only the app typecheck runs. The sole automated gate is 3/4 inoperative and still reports a pass. | `bash -c 'cd app && pwd; cd server && pwd'` → `cd: server: not found` |
| S4 | `implement:34-40` | "Branch first" is first-entry-only, but `/review` §5 and `/ship` §2 both route work back into it; `git checkout -b` then collides. | branch already exists on a round trip |
| S5 | `tasks.md:7` | Claims the tracker is two folders; `.mc/tasks/deferred/` holds 11 tasks. | `ls -d .mc/tasks/*/` |
| N1 | `plan:61` | Read-back globs every open task, not the new children. | |
| N2 | `review:42` | `--body-file /tmp/pr.md` — no step ever writes that file. | |
| N3 | `ship:53` | `ADR-NNN` has no allocation rule. | |
| N4 | `plan:57` | `effort:` is required on every child but nothing downstream reads it. | `grep -rn effort .claude/` hits only plan |

**Fixes** (each verified by running it):

- B1 — `/ship` commits the close-out **on the branch before merging**, so it rides in the PR. Re-check CI after the extra push.
- B2 — resolve the CLI once per invocation: `GH=$(gh auth status >/dev/null 2>&1 && echo gh || echo gh-bot)`, then `$GH`. Shell state does not persist between tool calls, so the resolution and the use must sit in one command. Rule stated once in `tasks.md`.
- S1 — `grep -l 'depends_on:.*\[\[TASK-NNN\]\]'` matches only real edges. Verified: returns exactly TASK-228 for TASK-227.
- S2 — add an explicit `parent:` field, written by `/plan`, read by `/ship`. `depends_on` stays for blockers only.
- S3 — wrap each gate in a subshell: `(cd app && npx tsc --noEmit)`.
- S4 — check out the branch if it exists, create it if it does not.
- S5 — `tasks.md` names all three folders.
- N1-N4 — read-back names the children; `/review` writes the PR body; ADR reuses the epic's number; `/implement` reads `effort:`.

### Key files

- `.claude/skills/ship/SKILL.md` (B1, B2, S1, S2, N3)
- `.claude/skills/review/SKILL.md` (B2, N2)
- `.claude/skills/implement/SKILL.md` (S4, N4)
- `.claude/skills/plan/SKILL.md` (S2, N1)
- `.claude/agents/verify.md` (S3)
- `.claude/rules/tasks.md` (B2, S2, S5)

## Acceptance Criteria

- [ ] No skill instructs a push or commit to `main`; the task close rides in the PR
- [ ] Every GitHub command resolves the authenticated CLI in the same shell invocation
- [ ] The sibling grep returns only files whose `depends_on` names the id — verified against TASK-227/TASK-228
- [ ] `parent:` is defined in `tasks.md`, written by `/plan`, read by `/ship`
- [ ] `verify.md`'s gate block runs all four gates from the repo root
- [ ] `/implement` §3 is re-enterable on an existing branch
- [ ] `tasks.md` names `todo/`, `done/` and `deferred/`
- [ ] A re-audit of the eight files finds none of the ten defects still present

## Test Strategy

Re-run the six-lens audit against the patched files and confirm every finding above is gone. Run each replaced command literally (the greps, the `$GH` resolution, the subshell gate block) and check the output matches what the skill claims. Then walk a real task through `/implement → /review → /ship` end to end.
