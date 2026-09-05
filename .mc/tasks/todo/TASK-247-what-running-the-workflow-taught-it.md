---
id: "TASK-247"
aliases: []
title: "What running the workflow taught it"
slug: "what-running-the-workflow-taught-it"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: ["[[TASK-245]]"]
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-05"
updated: "2026-09-05"
---

# What running the workflow taught it

## Description

TASK-245 repaired the five skills by auditing them. This task fixes what only showed up
once they were actually driven: six gaps that a reading cannot find, each one hit for real
while shipping PR #283, PR #284 and two feature branches on 2026-09-05.

## Details

### Current state, per gap

**1. `/ship` §3 commits the close against a stale `main`.** The section checks out the
branch and commits the task-file move without ever syncing. Shipping #283 the branch was
one commit behind `origin/main` (#282 had merged meanwhile); the close commit would have
been built on that stale base. Nothing in the skill says to fetch.

**2. `/ship` §3's CI wait is a comment, not a command.** It reads
`$GH pr checks $N --json name,bucket   # repeat until every job is present and every bucket
is "pass"`. TASK-245 removed `--watch` for the right reason — it exits 1 with "no checks
reported" before checks register — but replaced it with an instruction to loop and no loop.
Both pushes this session had three jobs still `QUEUED` at the first poll, which is exactly
the state the comment describes and exactly the state a human-eyeballed single call reads
as "not green yet, try again in a bit".

**3. Nothing says the PR body goes stale.** A PR that gains a commit after `/review` opened
it — the close commit always, plus anything folded in — still carries the body `/review`
wrote. #283 gained a `.gitignore` fix and its body did not mention it until it was edited
by hand. `/review` owns the body; `/ship` is the skill that changes what it describes.

**4. `verify` cannot catch a migration that CI rejects.** `.github/workflows/check.yml` has
a job "Prisma migrations match schema (Postgres)" that replays every committed migration
onto a clean Postgres and asserts zero drift from `schema.prisma`. `verify.md` runs
typecheck and `test-all.sh`, neither of which touches it, so a hand-written migration's
first feedback is CI. It is reproducible locally in about 40 s with a throwaway Postgres in
docker, and doing so does not violate the file's own "the dev database is not scratch" rule
because the check runs against its own container, never `DATABASE_URL`.

**5. `/implement` fans out subagents without saying they share one working tree.** "Several
independent slices → one subagent per slice, launched together" is right, and silent about
the fact that those agents write to the same checkout. Two agents given overlapping files
overwrite each other with no error. Both fan-outs this session needed an explicit
file-ownership list written by hand.

**6. An agent isolated in a worktree cannot run any npm gate.** A fresh worktree has no
`node_modules`, so `npm run typecheck` and `vitest` fail for a reason that has nothing to do
with the change. Symlinking the primary checkout's directories in is enough.

### Key files

- `.claude/skills/ship/SKILL.md` — gaps 1, 2, 3
- `.claude/agents/verify.md` — gap 4
- `.claude/skills/implement/SKILL.md` — gaps 5, 6

## Acceptance Criteria

- [ ] `/ship` syncs the branch with `origin/main` before the close commit
- [ ] `/ship`'s CI wait is a command that actually waits, and treats "no checks reported" as
      not-started
- [ ] `/ship` updates the PR body when it adds to what the PR contains
- [ ] `verify` runs the Postgres migration drift check when a diff touches
      `server/prisma/`, and reports it skipped rather than passed when docker is absent
- [ ] `/implement` states that concurrent subagents share one working tree and must be given
      disjoint file ownership
- [ ] `/implement` gives the worktree `node_modules` fix, so an isolated agent's gates mean
      something

## Test Strategy

Each replaced command is run literally, in every branch it can take, before it is written
in — the same bar TASK-245 set. For the drift check that means running it against `main`
(expect PASS) and against a deliberately broken migration (expect FAIL), and confirming the
docker-absent path reports skipped.
