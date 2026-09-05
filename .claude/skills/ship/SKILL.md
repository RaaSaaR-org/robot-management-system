---
name: ship
description: Take a reviewed task the rest of the way — answer PR feedback, merge, close the task file, and close out the parent when the last child lands. Use when the user types /ship, or asks to merge, land or close out a task whose review is clean.
owner: huhn511
---

# Ship

Everything after "PR opened": feedback, merge, the close, the parent's close-out. Tracker: `.claude/rules/tasks.md`.

## 1. Preconditions — stop if one fails

- A PR exists and `/review` came back clean. Not clean → `/implement`; this skill never fixes findings.
- **CI is green.** `gh pr checks <n>` — read it; a red check is a finding, not a formality.

## 2. Feedback

`gh pr view <n> --json reviews,comments`, and read every unresolved one.

A comment that changes code is a finding: hand it to `/implement` and stop — shipping resumes when review is clean again. A comment that only needs an answer gets one, in the thread.

## 3. Merge

```bash
gh pr merge <n> --squash --delete-branch
```

Squash is the norm for a single-task PR; keep history only when the PR argues for it.

Confirm from the remote, not from the exit code: `gh pr view <n> --json state,mergedAt,mergeCommit`.

## 4. Close the task

Two steps — the folder alone sets nothing:

```bash
git mv .mc/tasks/todo/TASK-NNN-*.md .mc/tasks/done/
# then edit the frontmatter: status: done, updated: <today>
```

Commit on `main` after the merge, and push.

## 5. Parent close-out — only if this was the last open child

Read the parent off the child's `depends_on`; no parent → stop here.

```bash
grep -l 'TASK-NNN' .mc/tasks/todo/*.md   # siblings still open
```

Siblings remain → the next one is the hand-off, and this skill is done.

None remain → the parent closes **now**: distill its spec into `docs/adr/ADR-NNN-slug.md` and delete the spec body from the parent in the same commit — a spec that outlives its epic reads as current when it is not. Then close it as in section 4.

## 6. Hand off

Siblings remain → `run /implement on TASK-NNN`. Parent closed → the work ends here.
