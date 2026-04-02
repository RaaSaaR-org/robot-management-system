# AGENTS.md — roboctl CLI

## Overview

`roboctl` is a CLI tool for interacting with NeoDEM robot agents. It communicates directly with the robot agent's REST API (default `http://localhost:41243`), not the server.

## Stack

- **Commander.js** — command parsing and help generation
- **chalk** — colored terminal output
- **cli-table3** — formatted table output
- **ora** — spinners for async operations
- **ws** — WebSocket client for live telemetry
- **conf** — persistent config (default URL, robot ID)

## Key Patterns

- Commands are in `src/commands/`, one file per domain (status, telemetry, control, health, history)
- API client in `src/api/` wraps HTTP calls to the robot agent
- `src/utils/config.ts` manages default URL and robot ID (auto-detected on first use)
- Output format is controlled via `--format` flag: `table` (default), `json`, or `minimal`
- REPL mode (`src/repl.ts`) provides an interactive shell when run with no arguments

## Adding a New Command

1. Create `src/commands/<name>.ts` with a `new Command()` export
2. Register it in `src/cli.ts` via `program.addCommand()`
3. Use the shared API client from `src/api/` for HTTP calls
4. Support `--format` flag for output consistency
