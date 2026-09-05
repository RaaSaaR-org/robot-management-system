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
N=$($GH pr list --state open --search "TASK-NNN" --json number,headRefName --jq '.[0].number')
[ -n "$N" ] || { echo "no open PR for TASK-NNN — /review has not run"; exit 1; }
echo "PR #$N"
```

You are invoked by task id, not by branch, so derive the PR from the task — never from whatever branch happens to be checked out. Empty or more than one match is a stop, not a guess.

**Re-resolve `$GH` and `$N` in every block below.** Shell state does not survive between tool calls, and an unset `$GH` silently runs the unrelated `pr` paginator instead of failing.

- **CI is green.** Read the buckets, not the table: `$GH pr checks $N --json name,bucket,state`. `pass` is green and `fail` is a finding. `cancel` on a run your own push superseded is neither — re-read the new run.

## 2. Feedback

`$GH pr view $N --json reviews,comments` (resolve `$GH`/`$N` again in this block), and read every unresolved one.

A comment that changes code is a finding: hand it to `/implement` and stop — shipping resumes when review is clean again. A comment that only needs an answer gets one, in the thread.

## 3. Close the task — on the branch, before the merge

The close is a task-file edit, so it rides in the PR like every other one ([`rules/tasks.md`](../../rules/tasks.md)). Nothing is ever committed on `main`.

Two steps — the folder alone sets nothing:

Check out the branch and move the file — re-enterable, because a second /ship pass over the same PR finds it already moved:

```bash
git checkout "$($GH pr view $N --json headRefName --jq .headRefName)"
git status --porcelain            # anything unrelated dirty → stop, this commit is task files only
git fetch -q origin && git merge --no-edit origin/main   # else the close lands on a stale base
ls .mc/tasks/todo/TASK-NNN-*.md >/dev/null 2>&1 \
  && git mv .mc/tasks/todo/TASK-NNN-*.md .mc/tasks/done/ \
  || echo "already in done/ — check the status field, then skip to section 4"
```

The merge is not optional. `main` moves while a PR sits in review — another PR merges, or
this one's own earlier close-out lands — and a branch that never syncs commits the close
against a base that no longer exists. Conflicts here are the merge's, not the close's: resolve
them before touching the task file.

**Now edit the frontmatter** — outside the block above, because the folder alone sets nothing: `status: done`, `updated:` the real date from `date +%F`. Then commit only the tracker:

```bash
git add .mc/tasks && git commit -m "chore(tasks): close TASK-NNN"
git-push-bot origin HEAD          # plain `git push` has no credentials here
```

`status: done` claims merged code, and the merge is the next step — so this commit is the last thing the PR receives.

**If this PR now contains more than `/review` described, say so in the body before merging.**
The close commit always adds something, and anything folded in since adds more; the body is
what the merge commit and every later reader see. `/review` owns the body's shape — read it
back, extend it, write it again:

```bash
PB="$(git rev-parse --git-dir)/pr-body.md"   # a real dir even in a worktree, where .git is a file
$GH pr view $N --json body --jq .body > "$PB"
# append what changed since /review wrote it, then:
$GH pr edit $N --body-file "$PB"
```

**The push restarts CI, and it must go green before section 4.** `--watch` does not wait for checks that have not registered yet: on a fresh push it prints `no checks reported` and exits 1 immediately. Poll instead, and treat that message as *not started*:

```bash
for i in $(seq 1 40); do
  B=$($GH pr checks $N --json bucket --jq '[.[].bucket] | @csv' 2>/dev/null)
  echo "$(date +%T) ${B:-no checks reported — not started}"
  case "${B:-pending}" in *pending*|"") sleep 30 ;; *) break ;; esac
done
$GH pr checks $N --json name,bucket,state    # the final read, job by job
```

`${B:-...}` is what makes this a wait rather than a race: an empty result means the checks
have not registered yet, which is *not started*, not *finished with nothing*. Treating those
two the same is the whole reason `--watch` cannot be used here. Both pushes that shipped this
skill had three jobs still `QUEUED` at the first poll.

**If it goes red, or the merge is refused:** the tracker must not be left claiming `done` for work that never merged. Undo the close — `git revert` the close commit, or move the file back to `todo/` and restore its previous status — then hand to `/implement` with the failure. Only then is this skill done with the task.

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
PARENT=$(grep -oP '^parent:\s*"?\[\[\K[^\]]+' .mc/tasks/done/TASK-NNN-*.md)
# both open folders — a child parked in deferred/ is still an open child
[ -n "$PARENT" ] && grep -l "parent:.*\[\[$PARENT\]\]" .mc/tasks/todo/*.md .mc/tasks/deferred/*.md
```

Match the **edge**, not the id: `grep -l 'TASK-NNN' .mc/tasks/todo/*.md` also matches the epic's own file through its `id:` line, so it never reports zero.

Siblings remain → the next one is the hand-off, and this skill is done.

None remain → the parent closes **now**, as a full lap of the workflow rather than a shortcut. Sections 3 and 4 cannot be reused directly: both need a PR, and `/review` is the only skill that opens one.

1. Branch off `main` for the parent: `chore/task-nnn-close-epic`.
2. Distill its spec into `docs/adr/ADR-<the parent's own task number>-slug.md` — reusing the epic's number needs no allocator and cannot collide.
3. Delete the spec body from the parent in the same commit; a spec that outlives its epic reads as current when it is not.
4. Close the parent's task file as in section 3, and push with `git-push-bot`.
5. Hand to `run /review on TASK-NNN` for the parent. It opens the PR; then re-enter this skill from section 1, which derives a fresh `$N` for that PR.

## 6. Hand off

Siblings remain → `run /implement on TASK-NNN`. Parent closed → the work ends here.
