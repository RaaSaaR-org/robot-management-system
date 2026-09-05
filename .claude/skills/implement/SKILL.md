---
name: implement
description: Implement one task as an orchestrator — keep your own context small, spawn subagents for the work that would fill it, and hand off a pushed branch. Use when the user types /implement, or asks to implement, build or work on a specific task.
owner: huhn511
---

# Implement

You orchestrate. Context is the scarcest thing in the session — spend it on decisions, not on file contents.

Gates live in `CLAUDE.md`, tracker policy in `.claude/rules/tasks.md`, component conventions in each `AGENTS.md`. Never restate them here.

## 1. Read the task, pick the shape

Read the task and the `AGENTS.md` of every component it touches. Its `effort:` is the reasoning effort this slice was planned for — carry it into the subagents you spawn. Only `/plan` writes that field, so a leaf that came straight from `/grill` has none: default it from `spe:` — 1–3 is `low`, 5 is `medium`, 8 is `high`. Then:

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

**Subagents launched together share one working tree.** "The paths it may touch" is not
advice, it is the thing that keeps two of them from overwriting each other — and neither will
error when they do. Give every agent an explicit list of the files it owns, make the lists
disjoint, and say plainly that a file it does not own belongs to an agent running right now.
Where a slice genuinely needs the same file as another, sequence those two instead.

Forbid git state changes in the same breath: no `add`, `commit`, `checkout`, `stash`,
`branch`, `push`, `reset`. Agents leave their work in the tree; you commit it. One agent
checking out a branch mid-flight moves the tree under every other agent.

**An agent isolated in its own worktree cannot run a single npm gate** — a fresh worktree has
no `node_modules`, so `npm run typecheck` and `vitest` fail for a reason that has nothing to do
with the change, and `npx` quietly tries to fetch the tool from the network instead. Symlink
the primary checkout's directories in before spawning anything:

```bash
for c in app server robot-agent; do ln -sfn "$MAIN/$c/node_modules" "$WT/$c/node_modules"; done
```

They are identical and shared, which is also the catch: `prisma generate` writes into
`node_modules/.prisma`, so only one tree at a time may change `schema.prisma`.

Send independent subagents in one message so they run concurrently.

## 3. Branch first

`/review` and `/ship` both route work back here, so this step must be re-enterable: on a round trip the branch already exists and carries commits.

The branch may already exist locally, or only on `origin` (a fresh clone or a fresh worktree), or not at all. Quote the placeholder — unquoted, `<type>` is a redirect and the block dies of a syntax error before it does anything.

```bash
B="fix/task-245-repair-the-workflow"    # your task's name, per rules/tasks.md
git fetch -q origin
if   git rev-parse --verify --quiet "refs/heads/$B"        >/dev/null; then git checkout "$B"
elif git rev-parse --verify --quiet "refs/remotes/origin/$B" >/dev/null; then git checkout -t "origin/$B"
else git checkout main && git pull origin main && git checkout -b "$B"
fi
[ "$(git branch --show-current)" = "$B" ] || { echo "NOT on $B — stop"; exit 1; }
```

Branching off `main` when the branch already exists on `origin` orphans every commit already pushed to it — hence the explicit `refs/remotes` arm, and the assertion that HEAD really moved.

Never work on `main`. On first entry set `status: in-progress` and commit it on the branch with the code; on a round trip the status is already right — leave it, a round trip is not a change of state.

## 4. Verify before claiming anything

Delegate to the `verify` subagent, so gate output never enters your context.

- **In:** the task id and its AC · changed paths or a diff ref · decisions it must honor.
- **Out:** gates passed or failed, AC status, findings by severity, evidence paths. Never raw logs.

Verify captures UI evidence but never judges it — comparing a screenshot against the design is your job. Fix what it reports, then spawn a **fresh** verify. Spawn, fix, spawn again until clean.

**Report failures faithfully.** Unverified work is never "done".

## 5. Push before handing off

A session that stops with the work in the working tree leaves the next one a task in flight and a branch that exists nowhere.

```bash
git-push-bot -u origin HEAD      # plain `git push` has no credentials here
git rev-parse --verify "origin/$B" >/dev/null && echo "pushed"
```

The task ends `in-progress`. Moving it to `review` belongs to `/review`.

## 6. Hand off

`run /review on TASK-NNN`.
