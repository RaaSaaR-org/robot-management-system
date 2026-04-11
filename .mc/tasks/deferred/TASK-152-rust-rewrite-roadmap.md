---
id: TASK-152
aliases:
- TASK-152
title: 'Rust rewrite roadmap: what to port beyond the data pipeline'
slug: rust-rewrite-roadmap
status: backlog
priority: 4
owner: ''
projects: []
customers: []
sprint: ''
tags:
- extended
- deferred
depends_on:
- '[[TASK-151]]'
due_date: ''
created: '2026-04-07'
---

## Description

Strategic roadmap for what to reimplement in Rust beyond the data pipeline (TASK-151). This is a reference document — not everything here should be done, but it maps out what's possible, what's worth it, and what must stay Python.

## The Golden Rule

**Don't rewrite what touches LeRobot or PyTorch.** The Python ML ecosystem (torch, transformers, lerobot, PEFT) is irreplaceable. Rust rewrites make sense for:
- CPU-bound data processing (parquet, stats, validation)
- Low-latency real-time paths (telemetry, robot control)
- Infrastructure services (HTTP server, message broker clients)
- Things that run on resource-constrained hardware (Raspberry Pi)

## Candidate Assessment

### Tier 1: High Impact — Do After TASK-151

#### 1a. Robot agent core (Node.js → Rust)
**Currently:** Node.js on Raspberry Pi — telemetry at 10-50Hz, command execution, state management
**Why Rust:**
- Pi has limited CPU/RAM — Node.js runtime overhead is significant
- Telemetry collection (`os.cpus()`, file reads) is 3-5x faster in Rust (`sysinfo` crate)
- Real-time servo communication will need C/Rust anyway (current code simulates this)
- Lower and more predictable latency for the control loop
- Single binary deployment to Pi (no `node_modules/`)

**What to port:**
- `robot-agent/src/robot/telemetry.ts` — system metrics collection
- `robot-agent/src/robot/state.ts` — robot state management
- `robot-agent/src/robot/CommandExecutor.ts` — command execution (currently simulated)
- `robot-agent/src/robot/StatePublisher.ts` — event bus for state changes
- `robot-agent/src/api/rest-routes.ts` — REST API (Express → Axum)
- `robot-agent/src/safety/` — safety monitor

**What stays Python (called as subprocess or sidecar):**
- `robot-agent/hardware/vla_runner.py` — VLA control loop (needs httpx for vla-server)
- `robot-agent/hardware/recorder.py` — LeRobot recording (wraps `lerobot-record`)
- `robot-agent/hardware/so101_sidecar.py` — SO-101 hardware driver (uses lerobot.robots)
- `robot-agent/hardware/sim_evaluator/` — MuJoCo simulation

**Architecture:** Rust binary as the core agent, spawns Python sidecar for ML/hardware:
```
rust-robot-agent (main process)
├── HTTP API (axum)
├── Telemetry collector (sysinfo)
├── State machine
├── Safety monitor
├── Command executor → servo driver (Rust)
└── Spawns: python sidecar
    ├── VLA control loop (vla_runner.py)
    ├── Hardware driver (so101_sidecar.py)
    └── Recorder (recorder.py)
```

**Effort:** Large (2-4 weeks)
**Crates:** `axum`, `tokio`, `sysinfo`, `serde`, `serialport` (for servo comms)

#### 1b. Server (Node.js → Rust)
**Currently:** Express.js, Prisma ORM, 83 DB models, 48 route files, 57 services
**Why Rust:**
- Lower memory footprint (important for Hetzner CAX21 with 8GB RAM)
- Faster request handling (Axum benchmarks 2-5x faster than Express)
- Better async I/O (tokio vs Node.js event loop)
- Type safety without runtime overhead (no TypeScript compilation step)
- Single binary deployment

**Migration path:**
1. Start with a Rust API gateway (proxy to existing Node.js server)
2. Migrate routes one-by-one, starting with hot paths:
   - Training job routes (most complex, most used)
   - Dataset routes (ties into TASK-151 Rust data pipeline)
   - Telemetry/WebSocket routes (real-time)
3. Replace Prisma with SeaORM or SQLx
4. Replace NATS client with `async-nats`
5. Replace S3 client with `aws-sdk-s3`

**Effort:** Very large (months, incremental)
**Crates:** `axum`, `sea-orm` or `sqlx`, `async-nats`, `aws-sdk-s3`, `jsonwebtoken`, `tower`

### Tier 2: Medium Impact — Nice to Have

#### 2a. gRPC VLA client (robot-agent)
**Currently:** `@grpc/grpc-js` with dynamic proto loading
**Why Rust:** `tonic` + `prost` is 5-10x faster for serialization. The proto is already defined at `protos/vla_inference.proto`.
**But:** Currently unused — robot-agent uses HTTP to vla-server, not gRPC. Only worth it if we switch to gRPC.
**Effort:** Small (if robot-agent is already Rust per 1a)

#### 2b. Image processing pipeline
**Currently:** Base64 encode/decode in Python (per inference step at 5Hz)
**Why Rust:** `image` + `base64` crates, potential 2-5x speedup
**But:** Inference time dominates (200-500ms), image encoding is <10ms. Low ROI.
**Path:** PyO3 module called from Python, or part of Rust robot-agent
**Effort:** Small

#### 2c. NATS message handling
**Currently:** `nats` npm package in server, `nats-py` in training-worker
**Why Rust:** `async-nats` crate, better throughput and latency
**But:** Only matters at scale (many workers, many robots). Current setup is fine.
**Effort:** Small (per component)

### Tier 3: Don't Rewrite — Keep Python

| Component | Why it stays Python |
|-----------|-------------------|
| **VLA inference** (vla-server) | `SmolVLAPolicy.from_pretrained()` — entire HuggingFace/PyTorch ecosystem |
| **LoRA training** (training-worker) | `torch.backward()`, PEFT, transformers — no Rust equivalent |
| **LeRobot dataset loading** | `LeRobotDataset` class with complex indexing logic |
| **SO-101 hardware driver** | `lerobot.robots.so_follower` — hardware abstraction |
| **MuJoCo simulation** | `gymnasium` + `mujoco` Python bindings |
| **VLA control loop** | Tight coupling with vla-server HTTP API and lerobot preprocessing |

These are the ML/robotics core — they depend on Python's ML ecosystem and would lose functionality if ported.

## Recommended Order

```
TASK-151: Rust data pipeline (parquet, stats, validation)
    ↓ proves Rust works in the stack, builds tooling
TASK-149/1a: Rust robot-agent core
    ↓ biggest user-facing impact (Pi performance)
TASK-149/1b: Rust server (incremental, route-by-route)
    ↓ long-term, do when server needs major changes anyway
TASK-149/2*: Nice-to-haves as opportunities arise
```

## What Rust Gives Us Across the Board

| Benefit | Where it matters |
|---------|-----------------|
| **Single binary deployment** | Pi (robot-agent), Hetzner (server) — no node_modules, no Python venv |
| **Lower memory** | Pi (512MB-4GB), Hetzner CAX21 (8GB) |
| **Predictable latency** | Robot control loop, telemetry, servo communication |
| **Parallelism** | Data pipeline (rayon), request handling (tokio) |
| **Type safety at zero cost** | No runtime type overhead, no TypeScript compilation |
| **Tauri integration** | Desktop app already has Rust backend, can share crates |

## Tauri Synergy

The desktop app (`app/src-tauri/`) already has a Rust backend (currently just a `greet()` stub). As we build Rust components, they can be shared:

- `neodem-data` crate → Tauri sidecar for offline dataset operations
- Robot agent crate → Tauri sidecar for direct robot communication (bypass server)
- Shared types crate → used by both Tauri and server/agent

This means the desktop app gets progressively faster and more capable without separate binaries.
