---
id: "TASK-243"
aliases: []
title: "Remove the SCRAI workflow"
slug: "remove-the-scrai-workflow"
status: "in-progress"
priority: 3
owner: "sebastian"
projects: []
customers: []
tags: ["core"]
sprint: ""
depends_on: []
due_date: ""
created: "2026-09-05"
updated: "2026-09-05"
---

# Remove the SCRAI workflow

## Description

SCRAI was an OpenCode-driven scrum automation (daily standup, Sunday retro →
grooming → sprint planning) that ran on GitHub Actions. It has been superseded by
the five-skill workflow (`/grill`, `/plan`, `/implement`, `/review`, `/ship`)
documented in `CLAUDE.md`, and it no longer runs: both workflows `cargo install mc`,
a MissionControl CLI that does not exist, and its output directories under
`.mc/planning/` are empty. Delete the whole apparatus.

## Details

### Current state

- `.github/workflows/scrai-daily.yml` — cron `0 9 * * 1-6`, runs `opencode run --agent scrai-standup`
- `.github/workflows/scrai-sunday.yml` — cron `0 9 * * 0`, runs the retro/grooming/planning trio
- `.opencode/agents/scrai-{standup,retro,grooming,sprint-planning}.md` — the four agent definitions
- `opencode.json` — OpenCode runtime config: Gemini provider plus the `mission-control` MCP server (`mc mcp`), which exists only for these agents
- `.claude/commands/scrai-*.md` — the Claude Code slash-command variants; already deleted in the working tree (and `.claude/` is now gitignored, so the deletions only need staging)
- `.mc/planning/{standups,retrospectives,grooming,sprints}/` — the output directories, all empty

### Files to delete

Everything listed above. Nothing else references `scrai` or `opencode`.

The same PR carries the already-pending `CLAUDE.md` rewrite of the "Agent
Development Workflow" section (the replacement for these agents) and six new
backlog task files.

## Acceptance Criteria

- [ ] No file in the repository matches `scrai` (case-insensitive) or references OpenCode
- [ ] `.github/workflows/` retains only `build-images`, `check`, `deploy-demo`, `prepare-release-pr`, `release`
- [ ] `CLAUDE.md` describes the five-skill workflow and no longer names the removed subagents
- [ ] `./scripts/test-all.sh --skip-pw` is unaffected (no code paths touched)

## Notes

Deletion only — no code is touched, so there is nothing to verify beyond the
absence of dangling references.
