---
name: review
description: Review an implemented task on two axes — does the code meet this repo's standards, and does it meet the task's acceptance criteria — then open the PR when it is clean. Use when the user types /review, or asks to review changes, a branch or a PR before it goes out.
owner: huhn511
---

# Review

Two axes, judged apart. Passing one is not passing.

The standards are `CLAUDE.md`, the `AGENTS.md` of each component touched, and `.claude/rules/`. Review against those — never invent a preference.

## 1. Fix the range

Review the diff since the merge-base with `main`, not the working tree. State the range you reviewed.

## 2. Axis A — standards

Does the code match the conventions of the paths it touches? Lint, types and tests belong to the gates — do not re-report them. Look for what a linter cannot see: the wrong seam, logic a shared helper already solves, a leaked abstraction, a comment standing in for a name.

## 3. Axis B — spec

Take the acceptance criteria one at a time. For each: where it is met (`file:line`), or that it is not. **Silence on a criterion means unmet.**

## 4. Report

Most severe first, one scale:

- **blocking** — ships a bug, breaks a contract, loses data
- **should-fix** — a real defect that does not block
- **nit** — preference, naming, comment

Each finding names what breaks and the input or state that breaks it.

**Only raise what you are >85% sure is real.** A review that cries wolf gets skipped.

## 5. Hand off

**Clean** → open the PR, *then* set `status: review`. That order — a status ahead of the thing it claims is the tracker lying.

```bash
gh pr create --title "<the task's title, read from the file>" --body-file /tmp/pr.md
```

Then: `run /ship on TASK-NNN` once the PR is approved.

**Not clean** → back to `/implement` with the findings, and **the status does not move.** A round trip through review is not a change of state.
