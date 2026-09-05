---
name: plan
description: Break one task into child tasks small enough for a single agent session, each published with a size, an owner and a reasoning effort. Use when the user types /plan, or asks to break down, decompose or slice a task, epic or spec.
owner: huhn511
---

# Plan

Turn one task into children an agent can each finish alone, in one session, without running out of context.

Tracker: `.claude/rules/tasks.md`.

## 1. Readiness gate — stop if it fails

- **Decisions are made.** No "we could either…" left open.
- **Acceptance criteria are checkable** without asking a human.
- **Anchors are named** — the file to copy, the convention to follow, for every non-obvious part.

Gaps → ask them as pointed questions, or take an explicit override. Never guess past one. Gaps about *what* or *why* go back to `/grill`.

## 2. Explore the code — required

Context cost comes from the code a slice touches, never from the plan's prose. Estimate nothing before reading.

## 3. Slice vertically

- Each child cuts end-to-end through the layers it needs: types → server → robot agent → frontend. Never one layer alone.
- A finished child is demoable on its own.
- Many thin slices beat few thick ones.

## 4. Size every child

Scale and ceiling: [`spe.md`](../../references/spe.md) — read it before writing a number. A child over the ceiling is not a child yet: back to section 3 and split it.

## 5. Set a reasoning effort

From the uncertainty left **after this plan**:

| `effort` | When                                          |
| -------- | --------------------------------------------- |
| `low`    | pattern to copy, mechanical work              |
| `medium` | known approach, judgment on the shape         |
| `high`   | real unknowns, the design must still be found |

Many children at `high` means the plan is underspecified — back to section 1.

## 6. Order

Blockers first, so a child can name a number that already exists. Write the edge as `depends_on: ["[[TASK-NNN]]"]`. Hard blockers only — "nicer afterwards" is not one.

## 7. Publish and hand off

A child is published **complete**, or it is filed rather than planned — self-contained enough that a reader implements it without opening another file. Every child carries:

- the parent and its blockers in `depends_on`
- a body with Description · Details (file paths, API shapes, per-component sections) · Acceptance Criteria · Test Strategy
- `spe:` (section 4) · `effort:` (section 5) · `owner:` · `created:`/`updated:`
- `status: todo` — it is ready to work
- `tags:` — `core`, `extended` or `compliance`

Read the new children back together (`head -20 .mc/tasks/todo/TASK-*.md`) and confirm all of it landed on all of them.

Then: `run /implement on TASK-NNN` — the first unblocked child.
