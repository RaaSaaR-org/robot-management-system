# roboctl

CLI tool for controlling NeoDEM robot agents.

## Setup

```bash
npm install
npm link          # makes `roboctl` available globally
```

## Usage

```bash
roboctl                          # Interactive REPL mode
roboctl status                   # Robot status overview
roboctl telemetry                # Live telemetry stream
roboctl health                   # Health check
roboctl history                  # Command history

# Control commands
roboctl move "Warehouse A"       # Navigate to zone
roboctl pickup <object>          # Pick up an object
roboctl drop                     # Drop held object
roboctl charge                   # Send to charging station
roboctl home                     # Return to home position
roboctl stop                     # Stop current action
roboctl estop                    # Emergency stop
```

## Options

```
-u, --url <url>        Robot agent URL (default: http://localhost:41243)
-r, --robot <id>       Robot ID (auto-detected if not specified)
-f, --format <format>  Output format: table|json|minimal (default: table)
--no-color             Disable colored output
```

## Development

```bash
npm run dev                      # Run via tsx (no build needed)
npm run dev -- status            # Run a specific command
npm run build                    # Compile TypeScript
npm run typecheck                # Type check only
```

## Architecture

```
src/
├── index.ts          # Entry point (REPL or single command)
├── cli.ts            # Commander.js program definition
├── repl.ts           # Interactive REPL mode
├── api/              # HTTP client for robot agent API
├── commands/         # Command implementations
│   ├── status.ts     # Robot status
│   ├── telemetry.ts  # Live telemetry
│   ├── health.ts     # Health check
│   ├── history.ts    # Command history
│   └── control.ts    # Move, stop, pickup, drop, charge, home, estop
└── utils/            # Config, formatting helpers
```
