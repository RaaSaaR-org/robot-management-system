---
name: ship
description: Take a reviewed task the rest of the way — answer PR feedback, merge, close the task file, and close out the parent when the last child lands. Use when the user types /ship, or asks to merge, land or close out a task whose review is clean.
owner: huhn511
---

# Ship

Everything after "PR opened": feedback, merge, the close, the parent's close-out. Tracker: `.claude/rules/tasks.md`.

## 1. Preconditions — stop if one fails

- A PR exists and `/review` came back clean. Not clean → `/implement`; this skill never fixes findings.
- **You have the PR number.** Never guess it — read it off the branch, and resolve the authenticated CLI in the same command ([`rules/tasks.md`](../../rules/tasks.md)):

```bash
GH=$(gh auth status >/dev/null 2>&1 && echo gh || echo gh-bot)
N=$($GH pr view --json number --jq .number)   # the PR for the current branch
echo "PR #$N"
```

Every `$GH` and `$N` below assumes that line ran in the same invocation.

- **CI is green.** `$GH pr checks $N` — read it; a red check is a finding, not a formality.

## 2. Feedback

`$GH pr view $N --json reviews,comments`, and read every unresolved one.

A comment that changes code is a finding: hand it to `/implement` and stop — shipping resumes when review is clean again. A comment that only needs an answer gets one, in the thread.

## 3. Close the task — on the branch, before the merge

The close is a task-file edit, so it rides in the PR like every other one ([`rules/tasks.md`](../../rules/tasks.md)). Nothing is ever committed on `main`.

Two steps — the folder alone sets nothing:

```bash
git checkout <the PR's branch>
git mv .mc/tasks/todo/TASK-NNN-*.md .mc/tasks/done/
# then edit that file's frontmatter: status: done, updated: <the real date, from `date +%F`>
git add -A && git commit -m "chore(tasks): close TASK-NNN"
git push origin HEAD
```

`status: done` claims merged code, and the merge is the next step — so this commit is the last thing the PR receives.

**The push restarts CI.** Wait for it before section 4: `$GH pr checks $N --watch`.

## 4. Merge

```bash
$GH pr merge $N --squash --delete-branch
```

Squash is the norm for a single-task PR; keep history only when the PR argues for it.

Confirm from the remote, not from the exit code:

```bash
$GH pr view $N --json state,mergedAt,mergeCommit
git checkout main && git pull origin main
git log --oneline -1 -- .mc/tasks/done/TASK-NNN-*.md   # the close is on main now
```

## 5. Parent close-out — only if this was the last open child

Read the parent off the child's **`parent:`** field. Never off `depends_on` — that carries blockers too, and closing a blocker as if it were an epic destroys an unrelated task's spec ([`rules/tasks.md`](../../rules/tasks.md)). No `parent:` → stop here.

```bash
PARENT=$(grep -oP '^parent:\s*"\[\[\K[^\]]+' .mc/tasks/done/TASK-NNN-*.md)
[ -n "$PARENT" ] && grep -l "parent:.*\[\[$PARENT\]\]" .mc/tasks/todo/*.md   # siblings still open
```

Match the **edge**, not the id: `grep -l 'TASK-NNN' .mc/tasks/todo/*.md` also matches the epic's own file through its `id:` line, so it never reports zero.

Siblings remain → the next one is the hand-off, and this skill is done.

None remain → the parent closes **now**, in its own branch and PR like any other change:

- Distill its spec into `docs/adr/ADR-<the parent's own task number>-slug.md` — reusing the number needs no allocator and cannot collide.
- Delete the spec body from the parent in the same commit; a spec that outlives its epic reads as current when it is not.
- Then close it as in section 3, and merge as in section 4.

## 6. Hand off

Siblings remain → `run /implement on TASK-NNN`. Parent closed → the work ends here.
