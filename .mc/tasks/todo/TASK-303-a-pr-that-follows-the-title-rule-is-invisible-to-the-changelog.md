---
id: "TASK-303"
aliases: []
title: "A PR that follows the title rule is invisible to the changelog"
slug: "a-pr-that-follows-the-title-rule-is-invisible-to-the-changelog"
status: "todo"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, ci]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# A PR that follows the title rule is invisible to the changelog

## Description

`prepare-release-pr.yml` builds the changelog from commit subjects that carry a
conventional-commit prefix. `.claude/rules/tasks.md` requires a PR title to be
the task's title verbatim. A squash merge's subject *is* the PR title, so every
PR that obeys the tracker rule produces no changelog line. 33 of the 92 commits
in v2026.09.12 were missing for this reason and had to be written in by hand.

## Current state

`.github/workflows/prepare-release-pr.yml`, the `section_for()` helper:

```bash
section_for() {
  echo "$subjects" | grep -E "^($1)(\(.+\))?!?: " | sed -E "s/^($1)(\(.+\))?!?: //" | sed 's/^/- /' || true
}
ADDED="$(section_for 'feat')"
FIXED="$(section_for 'fix')"
CHANGED="$(section_for 'perf|refactor|revert')"
OTHER="$(section_for 'chore|docs|build|ci|test|style')"
```

`$subjects` is `git log ${PREV}..HEAD --no-merges --pretty=format:'%s'`. Nothing
warns when a subject matches no section: the commit is silently dropped, and
`release.yml` cuts the GitHub Release body from the section, so the omission is
permanent once published.

The conflict starts at #280 — the first squash merge whose title is a bare task
title. Everything before it either carried a conventional prefix or landed as
individual commits.

`.claude/rules/tasks.md`, "Branch and PR": "The PR title is the task's title
verbatim — read it from the file, never retype it." The branch already carries
the type (`feat` · `fix` · `chore` · `refactor` · `docs`), so the information
the generator wants exists; it is just not in the subject.

## Details

Two directions, and the decision belongs to whoever picks this up:

1. **Make the generator fall back.** Anything matching no prefix goes into a
   section rather than the bin — `### Changed`, or a `### Other` — so a dropped
   commit becomes impossible. Cheapest, and it cannot regress: the ceiling is
   "the section is sometimes wrong", not "the line is missing".
2. **Put the type in the subject.** Derive the prefix from the branch type at
   merge time (the branch name is `<type>/task-nnn-<slug>`), or require the PR
   title to be `<type>: <task title>`. Better categories, but it needs the
   tracker rule reworded and every future merge to comply.

Either way the workflow must **fail loudly** rather than drop: count the
subjects it placed and compare against the subjects it read, and exit non-zero
when they differ. That guard is the part that makes this not happen again.

### Key files

- `.github/workflows/prepare-release-pr.yml` — `section_for()`, the section
  assembly, and a new count assertion
- `.claude/rules/tasks.md` — only if direction 2 is chosen: the PR-title rule
- `CHANGELOG.md` — v2026.09.12's 33 hand-written lines are the reference for
  what the generator should have produced

## Acceptance Criteria

- [ ] Every non-merge, non-`chore(release)` commit in the range appears exactly
      once in the generated section.
- [ ] The workflow exits non-zero when a subject reaches no section, naming the
      subject, so a silent drop cannot recur.
- [ ] Replaying the range `v2026.08.27..v2026.09.12` produces 92 bullets.
- [ ] If the tracker rule changes, `.claude/rules/tasks.md` says so in the same
      PR, and the branch-type list stays the source of the prefix.

## Test Strategy

Run the section-building logic over `v2026.08.27..v2026.09.12` locally — 92
commits, of which 33 match no prefix today — and assert the bullet count equals
the commit count. Then delete the prefix from one subject in a scratch range and
assert the workflow fails and names it.

## Notes

Found while publishing v2026.09.12: the release PR described 59 of 92 commits.
The missing 33 were added by hand on `release-please/main` before merging, so
the published release is complete; the generator is not.
