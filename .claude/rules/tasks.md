---
owner: huhn511
---

# Task tracker policy

The tracker is `.mc/tasks/` — Markdown files with YAML frontmatter. No CLI: read, write and `git mv` them directly. `todo/` holds the unfinished, `done/` the shipped. `.mc/config.yml` lists allowed values; `.mc/templates/task.md` is the shape.

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

No sub-issues here: parent and child link each other through `depends_on: ["[[TASK-NNN]]"]`. An epic is a task whose body is the spec and whose children do the work.

Split oversized work **down**, never sideways. A child is the lean delta; depth belongs to the parent.

## Size

Size is **the context window the implementing agent needs**, not human effort. Scale: [`.claude/references/spe.md`](../references/spe.md). Write it as `spe: <n>` in the frontmatter — a number left in the transcript was never an estimate.

## Branch and PR

Branch: `<type>/task-nnn-<slug>`, type one of `feat` · `fix` · `chore` · `refactor` · `docs`. The slug is the title lowercased, non-alphanumeric runs collapsed to `-`, cut at 60 chars on a `-`.

**Never push to `main`.** The PR title is the task's title verbatim — read it from the file, never retype it. The body names `TASK-NNN`.

Task-file edits ride in the same PR as the code they describe.
