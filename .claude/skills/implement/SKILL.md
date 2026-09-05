---
name: implement
description: Implement one task as an orchestrator — keep your own context small, spawn subagents for the work that would fill it, and hand off a pushed branch. Use when the user types /implement, or asks to implement, build or work on a specific task.
owner: huhn511
---

# Implement

You orchestrate. Context is the scarcest thing in the session — spend it on decisions, not on file contents.

Gates live in `CLAUDE.md`, tracker policy in `.claude/rules/tasks.md`, component conventions in each `AGENTS.md`. Never restate them here.

## 1. Read the task, pick the shape

Read the task and the `AGENTS.md` of every component it touches. Then:

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

```bash
git checkout main && git pull origin main
git checkout -b <type>/task-nnn-<slug>   # name owned by rules/tasks.md
```

Never work on `main`. Set `status: in-progress` and commit it on the branch with the code.

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
