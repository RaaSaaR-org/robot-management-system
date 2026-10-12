---
id: "TASK-389"
aliases: []
title: "Dev commands load their env and roboctl reports failures"
slug: "dev-commands-load-their-env-and-roboctl-reports-failures"
status: "review"         # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-13"
updated: "2026-10-13"
---

# Dev commands load their env and roboctl reports failures

## Description

Three quick-start commands in `CLAUDE.md` do not do what they say. `cd server && npm run dev`
never reads `server/.env` itself, `npm run dev:g1` (and `dev:h1`, `dev:light`, `dev:g1-edu`)
silently boots an H1 with defaults because the profile env file does not exist, and `roboctl`
exits 0 when the robot fails the command. Make each one honest.

## Details

### Server

- **Current state:** `server/package.json` runs `tsx watch src/index.ts`; nothing in
  `server/src` imports dotenv. The server only got its env through Prisma's implicit `.env`
  loading, which the generated client skips when it was generated elsewhere
  (`relativeEnvPaths.rootEnvPath: null`). Startup then dies at
  `server/src/security/encryption.ts:60` ("COMPLIANCE_LOG_ENCRYPTION_KEY ... required").
- **Change:** a `server/src/config/load-env.ts` module, imported first in
  `server/src/index.ts`, loads `server/.env` resolved from the module's own location (not the
  cwd). Values already in the process env win. A missing file is fine (production injects env).
  `dotenv` becomes a direct dependency of the server. `server/.env.example` sets
  `NODE_ENV=development`, so a fresh `cp .env.example .env` starts without a compliance-log
  key (encryption.ts derives a dev-only one); a `NODE_ENV` already in the environment wins.

### Robot Agent

- **Current state:** `robot-agent/src/index.ts` does `import 'dotenv/config'`. With
  `DOTENV_CONFIG_PATH=.env.g1` and no such file, dotenv loads nothing — not even `.env` — and
  `config.ts` defaults `ROBOT_TYPE` to `h1`. Only `.env.example`, `.env.so101.example`,
  `.env.g1-edu-sim.example` and `.env.g1-edu-agent.example` are tracked.
- **Change:** a `robot-agent/src/config/load-env.ts` loader replaces `dotenv/config`. When
  `DOTENV_CONFIG_PATH` names a missing file it prints a warning naming the file and falls back
  to `.env`. Each embodiment profile script sets `ROBOT_TYPE` inline (`dev:g1` → `g1`,
  `dev:h1` → `h1`, `dev:g1-edu*` → `g1_edu`, `dev:so101` → `so101`). `dev:light`,
  `start:light` and `start:heavy` have no embodiment behind them and are removed.

### roboctl

- **Current state:** `robot-agent/cli/src/commands/control.ts` prints the final command and
  returns; only transport errors exit 1.
- **Change:** when the final status is `failed` or `cancelled`, set `process.exitCode = 1`
  (not `exit()`, so output flushes). The REPL is unaffected.

### Key files

- `server/src/config/load-env.ts`, `server/src/index.ts`, `server/package.json`
- `robot-agent/src/config/load-env.ts`, `robot-agent/src/index.ts`, `robot-agent/package.json`
- `robot-agent/cli/src/commands/control.ts`, `robot-agent/cli/src/commands/exit-code.ts`
- `CLAUDE.md`, `README.md`, `docs/platform.md`, `robot-agent/AGENTS.md`

## Acceptance Criteria

- [x] `cd server && npm run dev` reads `server/.env` regardless of how the Prisma client was generated; a value already set in the process env is not overridden; no `.env` is not an error.
- [x] `npm run dev:g1` boots with `Robot Type: g1` even with no `.env.g1`; `dev:h1` → `h1`, `dev:g1-edu` → `g1_edu`.
- [x] A profile whose env file is missing logs a warning naming the file and falls back to `.env`.
- [x] `roboctl move CHARGING-A` against a robot that fails the command exits non-zero; a completed command exits 0.
- [x] CLAUDE.md, README.md, docs/platform.md and robot-agent/AGENTS.md describe the profiles as they now behave.
- [x] Unit tests cover the server loader, the agent loader and the roboctl exit code.

## Test Strategy

- vitest: `server/src/config/__tests__/load-env.test.ts`, `robot-agent/src/config/__tests__/load-env.test.ts` (temp dirs, env restored after each case).
- node:test: `robot-agent/cli/src/commands/exit-code.test.ts`.
- Typecheck server, robot-agent and the CLI; full vitest for server and robot-agent.
- Manual: `DOTENV_CONFIG_PATH=.env.nope ROBOT_TYPE=g1 npx tsx src/index.ts` prints the warning and `Robot Type: g1`.

## Notes
