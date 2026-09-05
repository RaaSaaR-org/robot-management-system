---
name: implement
description: Implement one task as an orchestrator — keep your own context small, spawn subagents for the work that would fill it, and hand off a pushed branch. Use when the user types /implement, or asks to implement, build or work on a specific task.
owner: huhn511
---

# Implement

You orchestrate. Context is the scarcest thing in the session — spend it on decisions, not on file contents.

Gates live in `CLAUDE.md`, tracker policy in `.claude/rules/tasks.md`, component conventions in each `AGENTS.md`. Never restate them here.

## 1. Read the task, pick the shape

Read the task and the `AGENTS.md` of every component it touches. Its `effort:` is the reasoning effort this slice was planned for — carry it into the subagents you spawn. Then:

| Situation                           | Do                                                 |
| ----------------------------------- | -------------------------------------------------- |
| ≤ ~3 files, pattern known           | inline — spawning costs more than it saves         |
| Several independent slices          | one subagent per slice, launched together          |
| The seam must be found first        | one exploration subagent; ask for the conclusion   |
| You would read >5 files to judge it | subagent — that reading is what burns your context |

## 2. The subagent contract

A subagent is a **context firewall, not a personality.** Never give one a persona.

- **In:** acceptance criteria · the paths it may touch · the anchor file to copy.
- **Out:** a diff summary and any decision it had to make. Never a transcript.

Send independent subagents in one message so they run concurrently.

## 3. Branch first

`/review` and `/ship` both route work back here, so this step must be re-enterable: on a round trip the branch already exists and carries commits.

```bash
B=<type>/task-nnn-<slug>        # name owned by rules/tasks.md
git rev-parse --verify "$B" >/dev/null 2>&1 \
  && git checkout "$B" \
  || { git checkout main && git pull origin main && git checkout -b "$B"; }
```

Never work on `main`. On first entry set `status: in-progress` and commit it on the branch with the code; on a round trip the status is already right — leave it, a round trip is not a change of state.

## 4. Verify before claiming anything

Delegate to the `verify` subagent, so gate output never enters your context.

- **In:** the task id and its AC · changed paths or a diff ref · decisions it must honor.
- **Out:** gates passed or failed, AC status, findings by severity, evidence paths. Never raw logs.

Verify captures UI evidence but never judges it — comparing a screenshot against the design is your job. Fix what it reports, then spawn a **fresh** verify. Spawn, fix, spawn again until clean.

**Report failures faithfully.** Unverified work is never "done".

## 5. Push before handing off

A session that stops with the work in the working tree leaves the next one a task in flight and a branch that exists nowhere.

The task ends `in-progress`. Moving it to `review` belongs to `/review`.

## 6. Hand off

`run /review on TASK-NNN`.
