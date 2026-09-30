# TASK-303 — The changelog places every commit

**Date:** 2026-09-30
**Task:** `.mc/tasks/todo/TASK-303-a-pr-that-follows-the-title-rule-is-invisible-to-the-changelog.md`

Immutable once committed. Later changes of mind get their own record.

## What prompted it

`prepare-release-pr.yml` placed only subjects with a conventional-commit
prefix. `.claude/rules/tasks.md` makes a PR title the bare task title, and a
squash merge's subject is the PR title, so every rule-abiding PR was dropped
without a word: 33 of 92 commits in v2026.09.12, restored by hand.

## Facts established before deciding

| Fact | Why it mattered |
| ---- | --------------- |
| Replaying `v2026.08.27..v2026.09.12` gives **92** non-merge, non-release subjects; **59** carry a prefix, **33** do not | Confirmed the task's numbers and gave the test its target |
| All 33 unprefixed subjects end in `(#NNN)`, and `gh pr view NNN --json headRefName` returns a `<type>/…` branch with a known type for **every one** | The type the generator wants already exists, one API call away — no rule change needed to get it |
| Placing the 33 by branch type agrees with the hand-written v2026.09.12 section on 19 of 33; the other 14 differ where the author's declared type and the editor's later reading differ (e.g. the page redesigns were `feat/` branches, filed by hand under Changed) | Branch type is a defensible category, not a perfect one; the ceiling is "sometimes the wrong section", never "missing" |
| Direct-to-branch commits and review fix-ups (e.g. "… (PR #278 review)") have no PR number of their own | Some subjects will never have a type; a fallback is required either way |

## Decisions

1. **Fall back, do not require a prefix (direction 1), plus a branch-type lookup.**
   A subject is placed by its conventional prefix, else by the head branch of the
   PR its `(#NNN)` suffix names, else under `### Changed`. The tracker rule is
   unchanged: requiring `<type>: <title>` would need every future merge to comply
   and would still drop anything that slips, while the lookup recovers the same
   information from the branch name the rule already mandates. `.claude/rules/tasks.md`
   gains one sentence saying the branch type now matters for the changelog; the
   PR-title rule itself is untouched, so AC 4 does not trigger.
2. **Fallback section is `### Changed`**, not a new `### Other`: it keeps the
   Keep-a-Changelog vocabulary the file already uses, and a line there is readable
   as a change without implying a category that was never declared.
3. **The guard counts the rendered output, not the tallies.** The script counts
   `- ` bullets in the text it is about to print and compares against subjects
   read; a mismatch exits 1 and names every unplaced subject. `CHANGELOG_STRICT=1`
   turns the fallback off so the guard can be exercised (the test does).
4. **Bare titles are lower-cased on their first letter** unless the second
   character is a capital or digit (acronyms, `TASK-…`), matching the style of
   the conventional lines around them.
5. **The logic moved out of YAML** into `scripts/release/changelog-section.sh`,
   with `scripts/release/test-changelog-section.sh` run by a new `release-tooling`
   job in `check.yml` (full-history checkout, so the 92-bullet replay runs).
