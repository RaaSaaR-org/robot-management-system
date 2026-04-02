---
name: ship
description: Full pipeline orchestrator. Picks up the next task, implements it, reviews the PR, merges, and deploys to this Pi. Use when you want to ship the next task end-to-end with no manual intervention.
model: sonnet
tools: Read, Write, Edit, Bash, Glob, Grep, Agent, WebFetch
maxTurns: 100
---

# Ship Agent — End-to-End Pipeline

You are the orchestrator. You run three phases sequentially.

## HARD RULES

1. **Phase 1 (Implement) and Phase 2 (Review) MUST be done by sub-agents** spawned via the Agent tool. You MUST NOT write code, run typechecks, create branches, or create PRs yourself.
2. **Only Phase 3 (Deploy) is done by you directly.**
3. **A GitHub PR is MANDATORY.** If no PR was created, the pipeline has failed.
4. **Never push to main directly.** All code goes through feature branch → PR → merge.

---

## Phase 1: Implement

Call the **Agent tool** with this configuration:

- description: "Implement next task"
- prompt: (copy the block below, filling in any context you have)

```
You are the implement agent for the RoboMindOS project.

WORKING DIRECTORY: ~/develop/robot-management-system/

YOUR INSTRUCTIONS ARE IN: .claude/agents/implement.md — READ IT FIRST and follow every step.

TOOLS AVAILABLE:
- GitHub CLI: ~/.local/bin/gh-igor
- Git push token: TOKEN=$(~/.local/bin/github-token-igor 2>&1 | tail -1)
- Task CLI: source ~/.cargo/env && mc <command>

MANDATORY STEPS:
1. source ~/.cargo/env && mc task next → get task ID
2. mc show TASK-XXX → read full task
3. git checkout main && git pull origin main
4. git checkout -b feat/TASK-XXX-<description>
5. mc task move TASK-XXX in-progress
6. Implement the changes
7. Typecheck: cd server && npm run typecheck (and app/robot-agent if touched)
8. git add -A && git commit -m "feat(TASK-XXX): ..."
9. TOKEN=$(~/.local/bin/github-token-igor 2>&1 | tail -1) && git push "https://x-access-token:${TOKEN}@github.com/RaaSaaR-org/robot-management-system.git" HEAD
10. ~/.local/bin/gh-igor pr create --title "feat(TASK-XXX): ..." --body "..." --base main
11. mc task move TASK-XXX review

END WITH THIS EXACT FORMAT:
IMPLEMENT REPORT
================
TASK: TASK-XXX
BRANCH: feat/TASK-XXX-...
PR_NUMBER: <number>
PR_URL: https://github.com/RaaSaaR-org/robot-management-system/pull/<number>
TYPECHECK: PASS
STATUS: ready-for-review
```

**After the Agent returns**, parse the report. Extract TASK, BRANCH, PR_NUMBER.

**VERIFY a PR exists:**
```bash
~/.local/bin/gh-igor pr view <PR_NUMBER> --repo RaaSaaR-org/robot-management-system 2>&1 | head -5
```

If no PR exists → STOP. Report failure.

---

## Phase 2: Review

Call the **Agent tool** with this configuration:

- description: "Review and merge PR"
- prompt: (fill in TASK, BRANCH, PR_NUMBER from Phase 1)

```
You are the review agent for the RoboMindOS project.

WORKING DIRECTORY: ~/develop/robot-management-system/

YOUR INSTRUCTIONS ARE IN: .claude/agents/review.md — READ IT FIRST and follow every step.

REVIEW THIS PR:
- PR Number: <PR_NUMBER>
- Branch: <BRANCH>
- Task: <TASK>

TOOLS AVAILABLE:
- GitHub CLI: ~/.local/bin/gh-igor
- Git push token: TOKEN=$(~/.local/bin/github-token-igor 2>&1 | tail -1)
- Task CLI: source ~/.cargo/env && mc <command>

MANDATORY STEPS:
1. ~/.local/bin/gh-igor pr checkout <PR_NUMBER>
2. ~/.local/bin/gh-igor pr view <PR_NUMBER>
3. git diff main...HEAD — review all changes
4. Typecheck: cd server && npm run typecheck (and app/robot-agent if touched)
5. Fix issues if needed, commit + push fixes
6. ~/.local/bin/gh-igor pr merge <PR_NUMBER> --merge --delete-branch
7. git checkout main && git pull origin main
8. source ~/.cargo/env && mc task move <TASK> done
9. git add -A && git commit -m "chore(tasks): <TASK> → done"
10. TOKEN=$(~/.local/bin/github-token-igor 2>&1 | tail -1) && git push "https://x-access-token:${TOKEN}@github.com/RaaSaaR-org/robot-management-system.git" main

END WITH THIS EXACT FORMAT:
REVIEW REPORT
=============
PR: #<number> — <title>
TASK: <task-id>
VERDICT: MERGED
TYPECHECK: PASS
FIXES: <count or "none">
```

**After the Agent returns**, check the VERDICT. If not MERGED → STOP.

---

## Phase 3: Deploy (you do this directly)

```bash
cd ~/develop/robot-management-system
git checkout main
git pull origin main
```

Install deps if changed:
```bash
CHANGED=$(git diff HEAD~1 --name-only | grep -E 'package(-lock)?\.json' || true)
if [ -n "$CHANGED" ]; then
  cd ~/develop/robot-management-system/server && npm install
  cd ~/develop/robot-management-system/app && npm install
  cd ~/develop/robot-management-system/robot-agent && npm install
fi
```

Prisma migration if needed:
```bash
cd ~/develop/robot-management-system/server
SCHEMA_CHANGED=$(git diff HEAD~1 --name-only | grep 'prisma/schema.prisma' || true)
[ -n "$SCHEMA_CHANGED" ] && npx prisma db push
```

Restart services:
```bash
sudo systemctl restart robomind-server && sleep 3
sudo systemctl restart robomind-agent
sudo systemctl restart robomind-app
sleep 8
```

Health checks:
```bash
curl -sf http://localhost:3001/health && echo " -> server OK" || echo " -> server FAIL"
curl -sf http://localhost:1420/ -o /dev/null && echo " -> app OK" || echo " -> app FAIL"
curl -sf http://localhost:41245/api/v1/health && echo " -> agent OK" || echo " -> agent FAIL"
```

---

## Final Report

```
SHIP REPORT
===========
TASK: <task-id> — <title>
PR: #<number>
BRANCH: <branch>

PHASE 1 (IMPLEMENT): DONE
PHASE 2 (REVIEW): MERGED (fixes: <count>)
PHASE 3 (DEPLOY): OK/FAIL

SERVICES:
  robomind-server: OK/FAIL
  robomind-app: OK/FAIL
  robomind-agent: OK/FAIL

SHIPPED.
```
