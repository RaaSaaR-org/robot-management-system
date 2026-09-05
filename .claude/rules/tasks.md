---
owner: huhn511
---

# Task tracker policy

The tracker is `.mc/tasks/` — Markdown files with YAML frontmatter. No CLI: read, write and `git mv` them directly. `todo/` holds the unfinished, `done/` the shipped, `deferred/` what is parked but not cancelled. `.mc/config.yml` lists allowed values; `.mc/templates/task.md` is the shape.

## Non-negotiables

- **Untracked work does not exist.** No task file → create one first.
- **Every session moves one task forward.** Name it at the start, leave its status true at the end.
- **The tracker never lies.** Status reflects reality, not intent.
- **`done` claims merged code.** Work still on a branch stays `in-progress`. Work that will not happen becomes `cancelled`, reason in the file.
- **Closing takes two steps:** `git mv` to `done/` **and** edit `status:`. The folder alone sets nothing.
- **Everything is written in English** — files, commits, PRs — whatever language the session runs in. German domain nouns with no English name stay untranslated inside the English sentence.
- **Touch a task, set `owner:` and `updated:`.** Dates absolute (`2026-09-04`), never "today".

## Status

| Status        | Means                                    |
| ------------- | ---------------------------------------- |
| `backlog`     | filed, not ready                         |
| `todo`        | ready: decisions made, AC verifiable     |
| `in-progress` | an agent is implementing it              |
| `review`      | a PR is open and waiting                 |
| `done`        | merged on `main`, file in `done/`        |
| `cancelled`   | will not be built, reason in the file    |

One at a time — it is a field, not a log.

## Hierarchy

No sub-issues here, so the link is two fields and they mean different things:

| Field | Means | Written by |
| ----- | ----- | ---------- |
| `parent: "[[TASK-NNN]]"` | this task is a child of that epic | `/plan`, on every child |
| `depends_on: ["[[TASK-NNN]]"]` | this task is blocked until those land | `/grill` or `/plan`, hard blockers only |

**Never read a parent out of `depends_on`.** A blocker and a parent are both an edge to a task id; only `parent:` says which. An epic is a task whose body is the spec and whose children do the work.

To find a task's open children, match the edge, not the id — every file contains its own id:

```bash
grep -l 'parent:.*\[\[TASK-NNN\]\]' .mc/tasks/todo/*.md   # open children
grep -l 'TASK-NNN' .mc/tasks/todo/*.md                     # WRONG: matches the epic itself
```

Split oversized work **down**, never sideways. A child is the lean delta; depth belongs to the parent.

## Size

Size is **the context window the implementing agent needs**, not human effort. Scale: [`.claude/references/spe.md`](../references/spe.md). Write it as `spe: <n>` in the frontmatter — a number left in the transcript was never an estimate.

## Branch and PR

Branch: `<type>/task-nnn-<slug>`, type one of `feat` · `fix` · `chore` · `refactor` · `docs`. The slug is the title lowercased, non-alphanumeric runs collapsed to `-`, cut at 60 chars on a `-`.

**Never push to `main`, and never commit on it.** Everything lands through a PR — the task-file close included. The PR title is the task's title verbatim — read it from the file, never retype it. The body names `TASK-NNN`.

**GitHub goes through the authenticated CLI.** Plain `gh` is not authenticated everywhere; this box authenticates through the `gh-bot` wrapper. Resolve it and use it in the *same* command — shell state does not survive between tool calls:

```bash
GH=$(gh auth status >/dev/null 2>&1 && echo gh || echo gh-bot)
$GH pr view --json number --jq .number
```

An exit code of 4 from `gh` is an unauthenticated CLI, not a broken command.

Task-file edits ride in the same PR as the code they describe.
