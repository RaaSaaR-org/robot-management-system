# NeoDEM — The All-in-One Physical AI Platform

**Your own robotic cloud.** Collect the demonstrations, train the model, ship it to the robot,
measure what it did, run the fleet and prove it to a regulator — one **full circle**, in one
open-source system you host yourself.

**Any VLA. Any world model. No vendor login.**

[![Check](https://github.com/RaaSaaR-org/robot-management-system/actions/workflows/check.yml/badge.svg)](https://github.com/RaaSaaR-org/robot-management-system/actions/workflows/check.yml)
[![Deploy Demo](https://github.com/RaaSaaR-org/robot-management-system/actions/workflows/deploy-demo.yml/badge.svg)](https://github.com/RaaSaaR-org/robot-management-system/actions/workflows/deploy-demo.yml)
[![LeRobot compatible](https://img.shields.io/badge/LeRobot-v2.1%20%2B%20v3.0-orange?logo=huggingface)](https://github.com/huggingface/lerobot)
[![EU AI Act](https://img.shields.io/badge/EU%20AI%20Act-Art.%2012%20%C2%B7%20Annex%20IV-blue)](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)

[Live Demo](#live-demo) · [The full circle](#the-full-circle) · [Models](#models--any-brain-no-vendor-login) · [Quick Start](#quick-start) · [Architecture](#architecture) · [What's new in 2026](#whats-new-in-2026) · [Docs](#documentation) · [Contributing](CONTRIBUTING.md) · [License](#license)

---

## Live Demo

**→ [raasaar-org.github.io/robot-management-system](https://raasaar-org.github.io/robot-management-system/)**

The full frontend, running against mocked data in the browser. No backend, no install, no
account. It shows a simulated fleet built around the Unitree G1 humanoid — every number in it
is generated, and the UI labels simulated data as such. Rebuilt from `main` on every push by
[`deploy-demo.yml`](.github/workflows/deploy-demo.yml).

---

## What is NeoDEM?

**The problem:** today's Physical AI tooling is fragmented. LeRobot handles training (CLI-only).
Physical Intelligence builds models (closed-source). NVIDIA Isaac simulates (cloud-only). No
single platform connects it all — and none of them help you with EU AI Act record-keeping.

**The solution:** NeoDEM is the integrating layer — an all-in-one platform, self-hosted, that
carries a robot's whole working life instead of one slice of it.

The platform is hardware-agnostic. Development and go-to-market focus on **cognitive humanoids,
specialised on the Unitree G1** (including the G1 EDU with Dex3-1 hands). The SO-101 arm was the
bootstrap embodiment and remains the one embodiment proven on real hardware via LeRobot; new
feature work — sim, digital twin, RL, VLA, teleop, Agent Mode — targets the G1.

Built by **EmAI Robotics GmbH**, Saarbrücken, Germany. Open source, MIT licensed. Developed with
a 24/7 agentic crew: AI agents write code, run tests, triage issues and ship fixes while humans
set direction.

---

## The full circle

Physical AI is never finished. A model ships, the fleet works a shift, and what it did on that
shift is the next training set. NeoDEM closes that loop inside one system, so there is no export
step between the stages — there is nothing to export *to*.

**Collect → Train → Deploy → Evaluate → Operate → Comply → Collect.**

| Stage | What you get |
|-------|-------------|
| **Collect** | The data engine. Record demonstrations via teleoperation or VR into a true LeRobot v3.0 chunked dataset, scan a room with a LiDAR and get a digital twin, or have a world action model generate episodes when the robots cannot make enough. Curation trims and deletes episodes video-aware and returns a *new* revision with lineage, never touching the source. HuggingFace Hub sync both ways. |
| **Train** | Queue SmolVLA LoRA fine-tuning jobs, reward models, annotation jobs. The trainer itself runs in a separate repo that polls this server for work. |
| **Deploy** | Model registry, canary rollouts with per-stage health checks, one-click rollback, Ed25519-signed OTA packages. You always know which model version runs on which robot. |
| **Evaluate** | MuJoCo simulation jobs, per-episode reward scoring, success-rate and error breakdowns, model comparison. |
| **Operate** | Fleet dashboard, natural-language control over the A2A protocol, real-time telemetry and 3D view, four layers of safety: fleet, zone, robot, and human approval. |
| **Comply** | Hash-chained tamper-evident audit logs with a `verify` endpoint (EU AI Act Art. 12), technical documentation per Annex IV, GDPR Art. 30 RoPA, a self-service portal for data-subject requests, legal holds and retention policies. |

The stages are **not equally mature**, and the platform says which is which rather than levelling
them up in the marketing: *Live* where it runs against real hardware or real data, *Sim* where it
is proven in simulation only, and *Gated* where the code path exists end to end but a safety
interlock still stands between it and a real robot. The honest version is in
[Status & limitations](#status--limitations).

---

## Repo map: what's here, what's next door

**Read this before you clone.** Training, model serving and GPU simulation happen in sibling
repos, not here. Clone only this repository and you get the platform — server, app, robot agent,
and the orchestration for all six lifecycle stages — but nothing that can actually train a
model, serve one, or run a GPU sim.

### In this repo

| Path | What it is |
|------|-----------|
| `app/` | React 19 + Tauri frontend — dashboard, fleet map, Agent Mode cockpit, compliance UI |
| `server/` | Node.js A2A server — REST + WebSocket, Prisma, compliance, training/deployment orchestration |
| `robot-agent/` | The software that runs on (or next to) the robot — Genkit tools, Agent Mode, telemetry |
| `robot-agent/hardware/` | Python sidecars: `g1_sidecar.py` (DDS ↔ HTTP), `so101_sidecar.py`, `sim_g1_dds/` (MuJoCo sim speaking the real Unitree wire protocol), `sim_evaluator/` (MJCF scenes) |
| `helm/neodem/` | Kubernetes Helm chart |
| `protos/` | Shared protobuf definitions |
| `docs/` | 21 documents — see [Documentation](#documentation) |
| `.mc/tasks/` | The task backlog, as Markdown with YAML frontmatter |

### Next door (separate repos, cloned as siblings)

| Repo | What it does | How it talks to NeoDEM |
|------|-------------|------------------------|
| `../vla-server` | VLA model serving on FastAPI. Extracted from this repo in TASK-150. | HTTP on port 8000; the robot agent calls it |
| `../training-worker` | SmolVLA LoRA fine-tuning. Extracted in TASK-150 so it can live on a GPU box. | Polls `POST /api/training/workers/claim`, then `/progress`, `/complete`, `/heartbeat` |
| `../twin-builder` | CPU-only sidecar that turns a LiDAR scan session into a digital twin (`cloud.pcd`, occupancy grid, `mesh.glb`) | Same poll loop: claims completed scan sessions from this server |
| `../sim-trainer` | Isaac Lab / MuJoCo GPU RL for G1 navigation and locomotion policies | Same poll loop as the training worker |
| `../rmsctl` | kubectl-style CLI client for the server, in Rust | REST against port 3001 |

`vla-server/README.md` and `training-worker/README.md` in this tree are pointer stubs that
document the unchanged API surface — the code is gone from here.

---

## Quick Start

**About five minutes from clone to a robot reporting telemetry.** No Docker, no database to
install, no API key and no account. This is the path CI exercises.

### Prerequisites

- **Node.js 22** (CI runs server and robot-agent on 22, the app on 20)
- **Python 3.11+** — only if you want the robot-agent hardware sidecars or the `sim_g1_dds`
  MuJoCo/cyclonedds simulator. Not needed for the steps below.
- No Docker, no PostgreSQL. The committed Prisma schema targets SQLite
  (`provider = "sqlite"`) and `server/.env.example` ships `DATABASE_URL="file:./dev.db"`.
- No LLM API key required. Set `LLM_PROVIDER=ollama` in `server/.env` and every server-side
  LLM call runs on a local model — nothing leaves the building.

### 1. Server

```bash
cp server/.env.example server/.env
cd server
npm install
npx prisma db push               # not `prisma migrate` — see below
npm run dev                      # http://localhost:3001
```

**Locally it is `db push`, not `prisma migrate`.** The committed migrations under
`server/prisma/migrations/` are Postgres-dialect — `migration_lock.toml` pins
`provider = "postgresql"` — while `schema.prisma` ships `provider = "sqlite"`, so
`npx prisma migrate dev` aborts with **P3019** before it does anything. That mismatch is real and
lives in the repo, not in these instructions. `db push` is the local path, and the one CI takes
([`check.yml`](.github/workflows/check.yml)); `migrate deploy` is the *production* path, after the
provider swap in [Switching to PostgreSQL](#switching-to-postgresql).

### 2. Robot agent (simulated G1)

```bash
cd robot-agent
npm install
cp .env.example .env.g1          # dev:g1 reads .env.g1, not .env
# in .env.g1 set: ROBOT_TYPE=g1, ROBOT_ID=sim-robot-g1, PORT=41244
npm run dev:g1                   # http://localhost:41244
```

Plain `npm run dev` reads `.env` instead and starts the default simulated humanoid on port
41243. See [Robots & embodiments](#robots--embodiments) for the other profiles.

### 3. Frontend

```bash
cd app
npm install
npm run dev
```

### 4. Open it

**http://localhost:1420**

Auth is bypassed in development (`AUTH_DISABLED=true` in `server/.env.example`), so you land
straight on the dashboard.

---

## Optional: the full stack

Everything below is opt-in. The server logs a warning and disables the corresponding feature
when a component is absent.

### Docker Compose

```bash
docker-compose up -d nats rustfs postgres     # infrastructure only
docker-compose up -d --build                  # plus server, app, robot-agent
```

| Service | Port | Why you'd want it |
|---------|------|-------------------|
| PostgreSQL | 5432 | Production database |
| NATS JetStream | 4222 (8222 monitoring) | Async job queues and KV stores |
| RustFS (S3-compatible) | 9000 | Model artifacts, datasets, dataset revisions |

### Switching to PostgreSQL

The checked-in schema is SQLite. To run against Postgres, change the provider in
`server/prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

then point `DATABASE_URL` at your instance and run `npx prisma migrate deploy`. That one-line
provider swap is the whole difference: `server/prisma/migrations/migration_lock.toml` already
says `provider = "postgresql"`, so the committed migrations apply as-is here — and that is
exactly why `prisma migrate` cannot run against the SQLite default. Production Docker builds do
the same substitution (`server/Dockerfile`), and the `migrations` job in
[`check.yml`](.github/workflows/check.yml) sed-swaps the provider, replays the committed
migrations onto a clean Postgres and fails on drift. Note that on SQLite, array fields are stored
as JSON strings.

### VLA serving and training

Neither runs from this repo:

```bash
cd ../vla-server      && uv run python server.py    # serving, port 8000
cd ../training-worker && <see that repo's README>   # polls this server for jobs
```

---

## Architecture

```
 THIS REPO
 ────────────────────────────────────────────────────────────────────────────────

    ┌──────────────┐  REST + WS  ┌──────────────┐   A2A + REST  ┌──────────────┐
    │     App      │◄───────────►│    Server    │◄─────────────►│ Robot Agent  │
    │ React/Tauri  │             │   Node.js    │               │   Node.js    │
    │    :1420     │             │    :3001     │               │  :41243 (*)  │
    └──────────────┘             └──────┬───────┘               └──────┬───────┘
                                        │                              │
                                 ┌──────▼───────┐               ┌──────▼───────┐
                                 │ SQLite (dev) │               │   Hardware   │
                                 │ or Postgres  │               │   sidecar    │
                                 └──────────────┘               │  Python/DDS  │
                                                                └──────┬───────┘
    optional: NATS :4222 · RustFS :9000                                │ DDS
                                                                       ▼
                                                            real G1  or  sim_g1_dds
                                                                         (MuJoCo)

 SEPARATE REPOS  (cloned as siblings — see the repo map)
 ────────────────────────────────────────────────────────────────────────────────

    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
    │../vla-server │   │../training-  │   │../twin-      │   │../sim-trainer│
    │ FastAPI :8000│   │    worker    │   │   builder    │   │ Isaac Lab /  │
    │ model serving│   │ SmolVLA LoRA │   │ scan to twin │   │  MuJoCo RL   │
    └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
     robot agent        these three poll the server for work:
     calls it           POST /api/training/workers/claim  (and equivalents)

 (*) robot-agent port is profile-dependent: 41244 dev:g1, 41245 dev:g1-edu, 41246 agent
```

| Component | Stack | Port | Notes |
|-----------|-------|------|-------|
| **App** | React 19, TypeScript 5.8, Vite 7, Tauri | 1420 | Web and desktop from one codebase |
| **Server** | Node.js 22, Express 4, Prisma 6 | 3001 | REST + WebSocket at `/api/a2a/ws` |
| **Robot Agent** | Node.js 22, Genkit, A2A SDK | 41243 | Code default; **profile-dependent** — `dev:g1` uses 41244, `dev:g1-edu` 41245, the Agent Mode profile 41246 |
| **Hardware sidecar** | Python 3.11+, cyclonedds | 8765 (SO-101) | `g1_sidecar.py` bridges DDS ↔ HTTP and adds `/loco/*` for Agent Mode |
| **VLA Server** | Python, FastAPI | 8000 | **Separate repo** `../vla-server` |

Server internals as of this commit: **61 route files** exposing roughly **600 HTTP endpoints**,
**79 services**, **27 repositories**, **100 Prisma models**. (`docs/architecture.md` carries
older counts; these were recounted from the tree.)

---

## What's new in 2026

The 2026 work is mostly about making the robot's *beliefs* legible: it reports state as
measured, estimated or unknown rather than guessing, and it labels anything simulated.

| Change | Maturity | PR |
|--------|----------|-----|
| **Agent Mode** — a local Ollama model turns a typed or spoken utterance into a typed, auditable block plan (`walk`, `turn`, `goto`, `look`, `scan_room`, `wave`, `greet`, `posture`, `speak`, `wait`, `remember`) executed over the Unitree LocoClient — the same call path for the simulator and a real G1. Cockpit at `/agent`. | Sim-only | [#212](https://github.com/RaaSaaR-org/robot-management-system/pull/212) |
| **LiDAR ranging** — a cone query on the Livox MID-360 cloud replaces the vision model's guess: 0.017 m mean error over 24 landmark/pose pairs versus 0.94 m for the guess, which was usually null. **Both numbers are simulator numbers**, scored in the MuJoCo MJCF room scene where ground truth is exact; they measure the cone query against a synthetic cloud, not a real MID-360's accuracy. A missing return is reported as UNKNOWN, never "clear". | Sim-only | [#214](https://github.com/RaaSaaR-org/robot-management-system/pull/214) |
| **Voice** — spoken commands drive Agent Mode; type-to-speak, live mic transcripts and pipeline controls in the UI. | Sim-only | [#215](https://github.com/RaaSaaR-org/robot-management-system/pull/215), [#203](https://github.com/RaaSaaR-org/robot-management-system/pull/203) |
| **Place awareness, enforced geofence, durable safety state, identity and memory** — metric pose + named place (STAGING, AISLE-1, DOCK-1) + confidence, with hysteresis and a drift budget; on unmapped floor the belief goes to NULL instead of holding the last place. A trusted pose inside a margined keepout triggers a SafetyMonitor protective stop, aborts the plan and refuses the next command while latched — verified with a 2 m walk aimed at rack RACK-A that stopped 0.48 m clear of the rack face, reproduced twice. **Known open defect:** that only holds while the pose is trusted. Past `PLACE_DRIFT_BUDGET_M` (default 15 m, and a 20 m hall spends it in one errand) the belief degrades to `stale`, the fence stops enforcing, and *nothing says so* — the same 2 m walk then went straight through RACK-A and out the far side with `estop=armed`, `systemHealthy=true` and no warning. Tracked as [TASK-201](.mc/tasks/todo/TASK-201-say-when-the-geofence-is-not-enforcing.md); the fix is to surface the lapse, not to weaken the fence. Boot lineage is one JSONL line per process life; a line with no clean close is a crash, and the next boot says so, restores the E-Stop latch behind an acknowledge gate and drops pose/place/held-object as too old. The robot has an identity (`IDENTITY.md`) and a durable memory workspace. | Sim-only, geofence enforcement **has a known gap** (see the cell); heartbeat/self-initiative **gated** behind `AGENT_HEARTBEAT_ENABLED` and never self-initiates locomotion | [#216](https://github.com/RaaSaaR-org/robot-management-system/pull/216) |
| **Local & sovereign LLM** — `LLM_PROVIDER=gemini \| openrouter \| ollama`. One provider abstraction (`server/src/services/llm/`) backs command interpretation, the A2A orchestrator and dataset-curation suggestions. Set it to `ollama` and the server needs no cloud key. The model id is written into the EU AI Act audit trail either way. | Live | [#218](https://github.com/RaaSaaR-org/robot-management-system/pull/218), [#185](https://github.com/RaaSaaR-org/robot-management-system/pull/185) |
| **Real-time 3D telemetry** — 29 body joints, 14 hand joints, IMU, battery/BMS, per-motor temperatures, Dex3 fingertip touch pads, MID-360 LiDAR and RealSense reach the UI through one path. The 3D view is driven by a 10 Hz joints/IMU/odometry fast channel with damped interpolation and zero React re-renders. The read-only path was live-verified against a powered G1. | Live (read-only path) | [#202](https://github.com/RaaSaaR-org/robot-management-system/pull/202), [#195](https://github.com/RaaSaaR-org/robot-management-system/pull/195) |
| **Digital twin from a real scan** — upload a PLY/PCD and the `../twin-builder` sidecar produces a twin plus a usable MuJoCo scene. Validated with a real 240k-point MID-360 capture of the lab. Twin zones can generate the named places Agent Mode navigates by. | Live | [#164](https://github.com/RaaSaaR-org/robot-management-system/pull/164), [#185](https://github.com/RaaSaaR-org/robot-management-system/pull/185) |
| **Video-to-G1 motion mirroring** — GVHMR pose estimation → GMR retargeting, offline, played back on the live 3D robot over a real transport. | Sim-only | [#205](https://github.com/RaaSaaR-org/robot-management-system/pull/205) |
| **Skill & data marketplace** — browse and buy skills and datasets with contribution credits, debited and credited atomically in a SERIALIZABLE transaction; download via presigned URL with a real sha256. | Live | [#176](https://github.com/RaaSaaR-org/robot-management-system/pull/176) |
| **G1 + Dex3 pick-and-place** — an environment replicating NVIDIA's GR00T-N1.7-AppleToPlate workflow, with the real-G1 bridge dry-run by default. | Sim-only; real-G1 bridge **gated** (needs both `G1_BRIDGE_ARMED=1` and `--arm`; legs are never commanded) | [#210](https://github.com/RaaSaaR-org/robot-management-system/pull/210), [#211](https://github.com/RaaSaaR-org/robot-management-system/pull/211) |
| **LeRobot 0.6.0** — reward models, annotation jobs, rollout strategies, GR00T N1.7 support. | Live | [#182](https://github.com/RaaSaaR-org/robot-management-system/pull/182) |
| **Dataset revisions and curation** — video-aware trim/delete producing a new revision with lineage, stats recompute, v3 LeRobot backend, AI suggestions. | Live | [#189](https://github.com/RaaSaaR-org/robot-management-system/pull/189) |

Two more honesty mechanics worth calling out:

- **E-Stop tells you what it knows.** The stop returns `{stopped, delivered, deliveryError}`. If
  `StopMove`/`Damp` was never acknowledged, the banner says **unconfirmed** in red instead of
  claiming the robot stopped.
- **Control arbitration.** Exactly one owner at a time — `idle | teleop | vla | agent`. Teleop
  preempts and actually aborts a running VLA rollout.

The closed-loop eval harness (null control that must score zero, an off-instruction proxy that
auto-refuses when it matches on-instruction, n=40 per cell) lives **outside this repo**; its
first run overturned an earlier optimistic result.

Full history: [CHANGELOG.md](CHANGELOG.md).

---

## Robots & embodiments

| Embodiment | DOF | Status | Dev profile |
|-----------|-----|--------|-------------|
| **Unitree G1 EDU + Dex3-1** | 43 (29 body + 14 hand) | Primary focus. Read-only telemetry live-verified on real hardware; motion is sim-only and hardware paths are gated. | `npm run dev:g1-edu` |
| **Unitree G1** | 29 | Primary focus, simulation | `npm run dev:g1` |
| **Unitree H1** | 19 | Configured | `npm run dev:h1` |
| **SO-101 / SO-ARM100 arm** | 6 | The one embodiment proven end-to-end on **real hardware** via LeRobot. Bootstrap embodiment, still supported. | `npm run dev:so101` |
| Generic fallback | 6 | Hardware-agnostic default, simulation only | `npm run dev` with `ROBOT_TYPE=generic` |

Every profile except the default reads its own env file via `DOTENV_CONFIG_PATH` — `.env.g1`,
`.env.g1-edu`, `.env.so101`, `.env.h1` — while plain `npm run dev` reads `.env`. The repo ships
`.env.example`, `.env.so101.example`, `.env.g1-edu-sim.example` and `.env.g1-edu-agent.example`;
copy the closest one to the filename the profile expects. Embodiment definitions live in
`robot-agent/src/embodiment/configs/*.yaml`; joint layouts in
`robot-agent/src/robot/joint-configs/`.

`robot-agent/hardware/sim_g1_dds/` runs a MuJoCo G1 that speaks the **real Unitree wire
protocol** (`arm_sdk` and `LocoClient`), so the same agent code drives the simulator and the
robot. That is what makes Agent Mode testable without a G1 in the room.

---

## Models — any brain, no vendor login

The model layer is an interface, not a supplier. Vision-language-action policies and world action
models go into the same registry, train on the same datasets and deploy through the same canary,
so which model you run stays a technical decision rather than a five-year commercial one.

### VLA — the policy that acts

Sees the scene, reads the instruction, emits the next action chunk. Six base models are in the
registry (`BaseModels` in [`server/src/types/vla.types.ts`](server/src/types/vla.types.ts)).

| Model | From | Status | Notes |
|-------|------|--------|-------|
| **SmolVLA** | HuggingFace / LeRobot | **Live** | Fine-tuned here, served here. MPS, CUDA or CPU — the full train → serve → evaluate circle has been walked on a Mac. |
| **GR00T N1.7** | NVIDIA | Ready | LeRobot-native trainer path (`lerobot[groot]`). Selectable in the training wizard. |
| **GR00T N1** | NVIDIA | Ready | Served over ZMQ to a PolicyServer on an NVIDIA GPU you supply. |
| **π0 · π0.6** | Physical Intelligence | Registered | In the base-model registry, selectable for a training job. |
| **OpenVLA** | Stanford | Registered | In the base-model registry, selectable for a training job. |
| **π0.5** | Physical Intelligence | Stub | `models/pi05.py` in `../vla-server` is a stub, not wired to weights (TASK-078). |

### WAM — the model that imagines

Generates the experience instead of recording it, and every generated episode is registered as
synthetic so nothing on the record pretends a dream was a recording
([`CosmosSyntheticService.ts`](server/src/services/CosmosSyntheticService.ts)).

| Generator | From | Status | Notes |
|-----------|------|--------|-------|
| **GR00T-Dreams** neural trajectories | NVIDIA · Cosmos-Predict2-2B LoRA | **Live** | Language-prompted trajectories for the G1 + Dex3, pseudo-labelled by an IDM (holdout MAE 0.079 rad / 5.5% norm). Registers as a real LeRobot dataset. **No token required.** |
| **Cosmos 3** forward dynamics | NVIDIA | **Live** | Action-conditioned rollouts on the WidowX bridge embodiment, converted to LeRobot v2.1. This path runs on a HuggingFace ZeroGPU Space and wants a **PRO token**. |
| Cosmos 3 *as a policy-ranking simulator* | — | **Ruled out** | Evaluated and rejected: visually plausible, action-conditioned, and it still misranked a do-nothing policy. Written up as a no-go in [`server/curation/README.md`](server/curation/README.md) rather than quietly deleted. |

### What "no vendor login" means

- **No account for the platform.** MIT, self-hosted, no licence server, no seat count, nothing
  phones home.
- **No account for the reasoning.** `LLM_PROVIDER=ollama` and every server-side LLM call runs on
  a model in your own building.
- **Open weights, open format.** Datasets are LeRobot v2.1 and v3.0 with Hub sync both ways —
  take the data and the checkpoints and walk out.
- **Two honest exceptions.** The Cosmos 3 forward-dynamics generator wants a HuggingFace PRO
  token, and a hosted LLM provider needs its own key if you choose one over Ollama. Neither is
  required to run the platform.

Serving runs in `../vla-server`; training runs in `../training-worker`. How far each base model's
trainer has been exercised is a question about those repos — the status above is what *this*
platform carries. See [`docs/vla-integration-guide.md`](docs/vla-integration-guide.md).

---

## Compliance

Compliance is a first-class part of the product, not a report generator bolted on at the end.

| Capability | Detail |
|-----------|--------|
| **Tamper-evident audit log** | Hash-chained records with a `verify` endpoint — EU AI Act **Art. 12** record-keeping |
| **Technical documentation** | Generated per AI Act **Annex IV** |
| **Records of processing** | GDPR **Art. 30** RoPA management |
| **Data-subject requests** | Self-service portal covering 7 request types |
| **Right to erasure** | GDPR **Art. 17** erasure that reaches the fleet: it wipes the on-robot memory workspace on every reachable robot and reports honestly about the ones that were switched off |
| **Legal holds & retention** | Holds override retention; a background job enforces retention policies |
| **Human oversight** | Multi-step approvals, escalation, contest and intervention flows |
| **Explainability** | Decision records with reasoning chains |

Four layers of safety: **fleet, zone, robot, and human approval.**

Details in [`docs/regulatory-compliance.md`](docs/regulatory-compliance.md).

---

## Deployment

Node 22. SQLite by default for local development, PostgreSQL for production.

For **Docker Compose**, see [Optional: the full stack](#optional-the-full-stack) above:
`docker-compose up -d --build` brings up server, app and robot-agent alongside PostgreSQL, NATS
and RustFS, and that section carries the per-service table and the infrastructure-only variant.

### Kubernetes

A Helm chart ships in [`helm/neodem`](helm/neodem) — 23 manifest templates (25 files in
`templates/`, less `_helpers.tpl` and `NOTES.txt`), with `values-local.yaml` and
`values-production.yaml`. `helm template neodem ./helm/neodem -f helm/neodem/values-production.yaml`
renders **32 resources**: 6 Services, 6 NetworkPolicies, 5 PodDisruptionBudgets, 3 Deployments,
3 StatefulSets, 2 HorizontalPodAutoscalers, an Ingress, ServiceAccount + Role + RoleBinding, a
Secret, a ConfigMap and an init Job. Default values render 21 — the extras are what production
turns on.

```bash
helm install neodem ./helm/neodem \
  -f ./helm/neodem/values-production.yaml \
  --set postgres.auth.password=$DB_PASSWORD \
  --set secrets.jwtSecret=$JWT_SECRET
```

Production values enable HorizontalPodAutoscalers, PodDisruptionBudgets, NetworkPolicies and a
read-only root filesystem with tmpfs mounts.

### Container images

Published to GitHub Container Registry by
[`build-images.yml`](.github/workflows/build-images.yml) (linux/amd64 + arm64):

```
ghcr.io/raasaar-org/neodem-app
ghcr.io/raasaar-org/neodem-server
ghcr.io/raasaar-org/neodem-robot-agent
ghcr.io/raasaar-org/neodem-vla-server    # built from the ../vla-server repo
```

NATS and RustFS/S3 are optional in every deployment mode and degrade gracefully when absent.
See [`docs/deployment.md`](docs/deployment.md) and [`docs/runbook.md`](docs/runbook.md).

---

## Development

### Run everything

```bash
./scripts/test-all.sh              # typecheck + unit tests + pytest + playwright
./scripts/test-all.sh --skip-pw    # everything except playwright
```

This is the single documented entry point. It runs, in order: typecheck (server, app,
robot-agent), vitest (server, app, robot-agent), the `sim_g1_dds` pytest suite, and the
Playwright UI tests. **Every stage runs even when an earlier one fails**, so one invocation
gives you the whole picture. The pytest stage needs the cyclonedds + MuJoCo venv described in
`robot-agent/hardware/sim_g1_dds/README.md` — point `SIM_PYTHON` at it; without it the stage
reports SKIPPED, never passed.

### Per component

| Component | Dev | Build | Typecheck | Test |
|-----------|-----|-------|-----------|------|
| App | `npm run dev` | `npm run build` | `npx tsc --noEmit` | `npm test` |
| Server | `npm run dev` | `npm run build` | `npm run typecheck` | `npm test` |
| Robot Agent | `npm run dev` | `npm run build` | `npm run typecheck` | `npm test` |

The robot agent also has per-embodiment dev profiles — `npm run dev:g1`, `dev:g1-edu`,
`dev:g1-edu-agent` (Agent Mode), `dev:so101`, `dev:h1`, `dev:light`. See
[Robots & embodiments](#robots--embodiments).

### Database

```bash
cd server
npm run db:generate   # regenerate the Prisma client
npm run db:push       # push schema to the dev database
npm run db:migrate    # create/apply a migration
npm run db:studio     # Prisma Studio
```

### Robot agent CLI

```bash
cd robot-agent/cli && npm run dev -- status
cd robot-agent/cli && npm run dev -- telemetry
cd robot-agent/cli && npm run dev -- move "Warehouse A"
```

### Code style

- TypeScript strict mode, explicit types on public APIs, no `any`
- Named exports only — no default exports
- A JSDoc file header on every file with `@file`, `@description`, `@feature`
- Feature order across the stack: types → protos → server → robot → frontend

### Component guides

Read the relevant one before you touch a component:

- [`app/AGENTS.md`](app/AGENTS.md) — frontend patterns, Zustand stores, Tailwind, routes
- [`server/AGENTS.md`](server/AGENTS.md) — routes, services, A2A protocol, database
- [`robot-agent/AGENTS.md`](robot-agent/AGENTS.md) — Genkit tools, robot state, telemetry, simulation

Full contributor guide: [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Documentation

### Start here

| Document | What's in it |
|----------|-------------|
| [`docs/architecture.md`](docs/architecture.md) | Services, data flow, infrastructure (component counts are stale — see [Architecture](#architecture)) |
| [`docs/api.md`](docs/api.md) | HTTP endpoint reference for all services |
| [`docs/dev-workflow.md`](docs/dev-workflow.md) | Code conventions, feature structure |
| [`docs/README.md`](docs/README.md) | Docs landing page (currently describes the SO-101 Pi deployment) |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history, CalVer |

### Frontend & design

| Document | What's in it |
|----------|-------------|
| [`docs/app-architecture.md`](docs/app-architecture.md) | Frontend architecture in depth |
| [`docs/brand.md`](docs/brand.md) | Colors, typography, design tokens |
| [`docs/demo-intro.md`](docs/demo-intro.md) | Guided intro to the public demo |

### Robots, VLA & data

| Document | What's in it |
|----------|-------------|
| [`docs/robot-integration-guide.md`](docs/robot-integration-guide.md) | Wiring a robot up: SO-101, G1 EDU, calibration, sidecars |
| [`docs/vla-integration-guide.md`](docs/vla-integration-guide.md) | VLA models, cameras, inference pipeline |
| [`docs/g1-edu-lab-bringup.md`](docs/g1-edu-lab-bringup.md) | Real G1 EDU lab bringup — status and log |
| [`docs/real-g1-apple-runbook.md`](docs/real-g1-apple-runbook.md) | Robot-day runbook for the apple-to-plate use case |
| [`docs/vr-teleop-data-collection.md`](docs/vr-teleop-data-collection.md) | VR teleoperation data collection with G1 EDU + Dex3-1 |
| [`docs/training-pipeline-testing.md`](docs/training-pipeline-testing.md) | How to test the training pipeline end to end |

### Operations & deployment

| Document | What's in it |
|----------|-------------|
| [`docs/deployment.md`](docs/deployment.md) | Docker Compose, Helm, Kubernetes |
| [`docs/operations.md`](docs/operations.md) | Day-two operations |
| [`docs/runbook.md`](docs/runbook.md) | Incident runbook |
| [`docs/nats-rustfs.md`](docs/nats-rustfs.md) | NATS JetStream + RustFS setup |
| [`docs/multi-tenancy.md`](docs/multi-tenancy.md) | Row-level multi-tenancy: the flag, Prisma isolation, `runAsPlatform`, Organizations UI |
| [`docs/ai-operations-guide.md`](docs/ai-operations-guide.md) | Operating the AI features |
| [`docs/process-delegation-architecture.md`](docs/process-delegation-architecture.md) | Process-to-robot task delegation |

### Compliance & regulation

| Document | What's in it |
|----------|-------------|
| [`docs/regulatory-compliance.md`](docs/regulatory-compliance.md) | EU AI Act, GDPR, Machinery Regulation, CRA |

`CLAUDE.md` and the three `AGENTS.md` files are guidance for AI coding agents working in this
repo — useful for humans too.

---

## Status & limitations

Read this before you plan around NeoDEM. Real Unitree G1 hardware support is **gated**: the
read-only telemetry path has been verified against a powered G1, but motion — Agent Mode,
locomotion, the GR00T bridge — is proven in **simulation only**, and the real-G1 bridge is
dry-run by default behind two separate arming flags. The **SO-101 arm is the one embodiment
proven end-to-end on real hardware.** Authentication exists (JWT + RBAC) but is bypassed in
development via `AUTH_DISABLED=true`; turn it on before you expose anything. NATS and RustFS
are optional, and the features that depend on them switch themselves off when they are missing.
The closed-loop eval harness is not in this repo. There is no managed cloud — you run it
yourself.

Two partner slots are open: a public cloud host, and compute/inference/training credits.
Reach us at **info@EmAI.dev**.

---

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for how to pick up a task,
branch, test and open a PR.

Start with a [`good first issue`](https://github.com/RaaSaaR-org/robot-management-system/labels/good%20first%20issue), and read the `AGENTS.md` for the component you are touching.

## License

MIT. Copyright (c) 2026 EmAI Robotics GmbH and NeoDEM contributors.

A `LICENSE` file is not yet committed to this repository — that is an open gap, not a change of
terms. If you need the full text before that lands, ask at **info@EmAI.dev**.
