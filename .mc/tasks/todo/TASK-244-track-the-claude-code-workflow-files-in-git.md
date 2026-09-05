---
id: "TASK-244"
aliases: []
title: "Track the Claude Code workflow files in git"
slug: "track-the-claude-code-workflow-files-in-git"
status: "in-progress"
priority: 2
owner: "sebastian"
projects: []
customers: []
tags: ["core"]
sprint: ""
depends_on: []
due_date: ""
created: "2026-09-05"
updated: "2026-09-05"
spe: 1
---

# Track the Claude Code workflow files in git

## Description

`CLAUDE.md` points at the five-skill workflow under `.claude/` (`skills/`, `rules/tasks.md`, `references/spe.md`, `agents/verify.md`), but a blanket `**/.claude/` rule in `.gitignore` (added in #196) kept every one of those files out of git. After #280 removed the last pre-rule files, `origin/main` has nothing under `.claude/` at all, so a fresh clone gets a `CLAUDE.md` that references files that do not exist.

## Details

**Current state:** `.gitignore:102` is `**/.claude/`. Only the root `.claude/` exists. Locally it holds the nine workflow files plus `agent-memory/` (per-machine subagent memory) which must stay untracked, as must any `settings.local.json`.

**Change:**

- Replace `**/.claude/` in `.gitignore` with two narrow rules: `.claude/settings.local.json` and `.claude/agent-memory/`.
- Stage and commit the nine workflow files:
  - `.claude/agents/verify.md`
  - `.claude/references/spe.md`
  - `.claude/rules/tasks.md`
  - `.claude/skills/{grill,implement,plan,review,ship}/SKILL.md`

All nine were scanned before staging: no keys, tokens, emails, home paths or machine names. The only identifier is the `owner:` GitHub handle in the frontmatter, which is already public as the commit author.

## Acceptance Criteria

- [ ] `git ls-tree -r --name-only origin/main .claude` lists the nine workflow files after merge
- [ ] `git check-ignore .claude/agent-memory/x .claude/settings.local.json` still reports both as ignored
- [ ] `git check-ignore .claude/skills/grill/SKILL.md` reports nothing
- [ ] Every path `CLAUDE.md` names under `.claude/` exists in a fresh clone

## Test Strategy

Run the three `git check-ignore` commands above on the branch, and `git ls-tree` against `origin/main` once merged.
