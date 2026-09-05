---
name: grill
description: Interview the user one decision at a time until you share their understanding of what to build and why, then write the spec into the task and record the decisions. Use when the user types /grill, or wants a plan, spec or idea pressure-tested before it gets built.
owner: huhn511
---

# Grill

Interview the user until you share their understanding of **what** to build and **why**. The spec is the output; the interview is the conversation.

**Facts are yours to find, decisions are the user's.** Never decide one for them. Never build inside a grilling session.

Tracker: `.claude/rules/tasks.md`.

## 1. Open

- **There must be a task file.** None → create one from `.mc/templates/task.md` in `todo/`, then grill it.
- Read it and everything in its `depends_on`.
- **Look facts up; never ask what the code can answer.** When a fact moves the plan, say which fact moved which decision.
- **Finish fact-finding before question one.** A survey landing mid-interview gets retrofitted onto a decision already framed.

## 2. Interview

Take the decisions in dependency order — the one the others rest on first.

> **Q#: the decision, in one line.**
>
> The tension that makes it open, one or two sentences.
>
> Options `1`–`4`, never more than four.
>
> **Your pick and why**, plus the option you reject and why. A recommendation without a rejected alternative is not one.

**Ask in prose** — it leaves room for the answer you did not offer, which is where the good ones come from.

**One question per turn.** Pure confirmations aren't questions; batch those.

Challenge premises, the user's research included.

**Exit when no open question would change what gets built.** The exit condition proposes, the user disposes.

## 3. Close

Only after the user confirms shared understanding.

**"Do not build it" is a valid close** — say it plainly, set `status: cancelled`, `git mv` to `done/`, record why in the file. No spec, no hand-off.

Otherwise, one commit — **on a branch, never on `main`** ([`rules/tasks.md`](../../rules/tasks.md)). The spec and the record are task-file edits like any other and land through a PR:

```bash
git checkout main && git pull origin main
git checkout -b "docs/task-nnn-<slug>"
```

| Artifact   | Lands                                                                    |
| ---------- | ------------------------------------------------------------------------ |
| **Spec**   | the task body: Description · Details per component · Acceptance Criteria · Test Strategy |
| **Record** | `docs/records/TASK-NNN-slug.md` — immutable once committed                |

The record carries every decision with the alternative it rejected, marks every override by owner (the user's over yours, and yours rejected), and links the task and the section 4 hand-off.

Then the frontmatter in one edit: `status: todo`, `owner:`, `updated:`, plus — for a leaf — `spe: <n>` ([`spe.md`](../../references/spe.md)) and `effort:` (`/plan`'s scale, which `/implement` reads). An epic gets neither: it is an epic because its children carry `parent:`, which is what `/ship` actually reads.

Read the file back: status, owner, and the numbers all landed. Then push with `git-push-bot -u origin HEAD` and hand off.

Grilling stops at `todo` — nothing has been built.

## 4. Hand off

Name **one** command.

| The spec is                                | Recommend                    |
| ------------------------------------------ | ---------------------------- |
| several slices, or a leaf over the ceiling | `run /plan on TASK-NNN`      |
| one slice within the ceiling               | `run /implement on TASK-NNN` |
| do not build it                            | nothing — the record is done |
