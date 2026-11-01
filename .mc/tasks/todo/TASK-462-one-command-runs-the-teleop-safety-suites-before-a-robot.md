---
id: "TASK-462"
aliases: []
title: "One command runs the teleop safety suites before a robot session"
slug: "one-command-runs-the-teleop-safety-suites-before-a-robot"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [extended]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# One command runs the teleop safety suites before a robot session

## Description

Before a session with the real G1, the team wants proof that the teleop safety
code on the checked-out commit is green: keyboard teleop, the control lease,
bilateral teleop, the VR tab and data collection. Today that means
hand-picking vitest paths in three packages. The 2026-10-31 pre-session hunt
did it by hand: 12 robot-agent files and 222 tests, then 68 app files and 917
tests, all green, in well under a minute. This task gives that check one
command, `./scripts/test-all.sh --teleop-smoke`, which runs only those suites
and reports like the rest of the script.

Branch: `chore/task-462-one-command-runs-the-teleop-safety-suites-before-a-robot`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `scripts/test-all.sh`:
  - `:40-45`: flags `--skip-pw` and `--python-only`; `--python-only` is the
    model for a flag that runs a subset;
  - `:65` on: `if [ "$PYTHON_ONLY" = false ]` gates the typecheck and vitest
    stages;
  - `:318`: the Results summary; `FAILURES` and `SKIPPED_STAGES` count across
    stages.
- The suites:
  - robot-agent `src/api/__tests__/`: `keyboard-teleop*.test.ts` (8 files),
    `control-lease-*.test.ts` (2), `bilateral-teleop*.test.ts` (2);
  - app: `src/features/robots/components/tabs/vr/__tests__/`,
    `src/features/robots/components/tabs/__tests__/KeyboardTeleopLease.test.tsx`,
    and `src/features/datacollection/`;
  - server: `src/services/__tests__/ControlLeaseService*.test.ts` (3 files).
- `docs/data-collection-two-person.md` "Setup" (`:134`) has no pre-session
  check of the code.

### Scripts

- `scripts/test-all.sh --teleop-smoke`: runs only these stages, each with
  `npx vitest run <paths>`:
  - "Robot agent teleop safety suites";
  - "Server control lease suites";
  - "App teleop + data collection suites".
  No typecheck, no Playwright, no Python. The same `step` / `FAILURES` /
  Results reporting; exit non-zero on any failure. Document the flag in the
  usage block at the top.
- Keep the path list in one place in the script (one array per package), so a
  new teleop suite is added in one line.

### Docs

- `docs/data-collection-two-person.md`, Setup: one line before step 1 — on the
  commit the robot side runs, `./scripts/test-all.sh --teleop-smoke` passes
  (about 20 s).
- `CLAUDE.md` Testing: one line naming the flag.

### Key files

- `scripts/test-all.sh`
- `docs/data-collection-two-person.md`
- `CLAUDE.md`

## Acceptance Criteria

- [ ] `./scripts/test-all.sh --teleop-smoke` runs the three suite groups above
  and nothing else, and finishes in under 30 s on the lab PC.
- [ ] A failing test in any of them makes the command exit non-zero and shows in
  Results.
- [ ] `./scripts/test-all.sh` with no flag is unchanged.
- [ ] The runbook and CLAUDE.md name the command.

## Test Strategy

- Run `./scripts/test-all.sh --teleop-smoke` on `main` and record the time and
  test counts in the PR.
- Break one assertion in a `keyboard-teleop*.test.ts` locally, run again, see
  the non-zero exit and the failure in Results, then revert.
- `bash -n scripts/test-all.sh`.

## Notes

- From the 2026-10-31 pre-session bug hunt (VR/teleop hunt, improvement 4).
