---
id: TASK-194
aliases:
- TASK-194
title: Agent Mode — local LLM commands the G1 EDU via LocoClient blocks
slug: agent-mode-local-llm-commands-the-g1-edu-via-lococlient-blocks
status: in-progress
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- extended
- g1
- agentmode
sprint: ''
depends_on: []
due_date: ''
created: 2026-07-25
updated: 2026-08-01
---


# Agent Mode — local LLM commands the G1 EDU via LocoClient blocks

## Description

Add a toggleable **Agent Mode** to the robot-agent in which a **local Ollama LLM**
translates plain-language commands ("geh zum Tisch mit dem Hut") into a list of executable
**blocks** and runs them through the Unitree **LocoClient** high-level API — the same call
path in simulation and on the real G1 EDU + Dex3. Today the robot is only driveable via
teleoperation and VLA skill rollouts; there is no way to say "walk left", "wave" or "greet".

Scope is one branch, one PR: DDS loco facade + new MuJoCo room scene, sidecar `/loco/*`
endpoints, the agent-mode planner/executor in the robot-agent, a server-side mirror over the
existing A2A WebSocket, and a chat-centric UI at `/agent` with a live block timeline.

## Details

### Design decisions (settled — do not re-litigate during implementation)

| Topic | Decision |
|---|---|
| Locomotion API | Agent always speaks `LocoClient`. Real G1 → onboard FSM. Sim → our own DDS service shim. |
| Planning | LLM emits a full block list; after each block it may rewrite only the **remaining** plan. Completed blocks are frozen. |
| Block model | New lightweight `AgentBlock`. **Not** `SkillChain` — plans are ephemeral, no DB rows. |
| `vla_skill` block | **Excluded from v1.** Follow-up once TASK-188 lands. |
| Vision | Separate roles: `AGENT_VISION_MODEL` + `AGENT_PLANNER_MODEL`, both default `gemma3:4b`. The planner never sees pixels, only the VLM's text. |
| Scene memory | In-memory entity list + free-text "current view". Dumpable as Markdown. No DB. |
| Navigation | Bearing-and-correct: turn to bearing → ~1 m walk stages → `look` → re-bearing. Abort after N stages without progress. |
| People | Stateless. "Is a person in the image?" + rough bearing only. No faces, no identities, no image retention. |
| Safety | **Manual E-Stop only** — see the explicit deviation note below. |
| Arbitration | `controlOwner: idle \| teleop \| vla \| agent`, exclusive. Human teleop preempts and discards the plan. |
| Command entry | The existing A2A `message/send` path. Mode OFF ⇒ byte-identical to today's behaviour. |
| Interruption | New message goes to the planner together with the running plan. The running block always finishes. The stop word bypasses the LLM. |
| Data path | robot-agent → server (in-memory, last plan per robot) → app over the existing `/api/a2a/ws`. |
| UI | Chat-centric, new module `app/src/features/agentmode/`, route `/agent`. |
| Sim scene | New room scene with a kinematically driven 3-DOF pelvis. Existing pickplace scene untouched. |
| Idle | No autonomous locomotion. Only `wave`/`speak` on a newly appearing person. |

### ⚠️ Deliberate safety deviation (explicitly decided by the product owner)

Agent Mode ships with **only a manual E-Stop**. It deviates from the structural safety model
in `robot-agent/hardware/real_g1_bridge/README.md`, which is the house standard for anything
that can move the real robot. Specifically, Agent Mode does **not** have:

- a two-factor arming gate (`G1_BRIDGE_ARMED=1` **and** `--arm`),
- a dry-run default in which no command publisher is ever constructed,
- a watchdog that auto-`Damp()`s on connection loss,
- per-tick delta clamping or a default speed cap,
- human approval gates before a plan runs.

E-Stop triggers (all three must work): UI button, voice stop word, terminal key. E-Stop
discards the plan, calls `StopMove()` + `Damp()`, and ramps the `arm_sdk` weight to 0.

**Consequence to plan for:** before Agent Mode is ever pointed at real hardware (TASK-169,
robot day), a spotter on the physical E-Stop is mandatory, and the first real-hardware run
must be velocity-capped by hand. Record this in the robot-day checklist.

### Loco facade

Despite living in the SDK's `high_level/` folder, `LocoClient` is RPC over plain DDS:
`unitree_sdk2py/core/channel_name.py` builds `rt/api/<service>/request` and
`rt/api/<service>/response`, and `LOCO_SERVICE_NAME = "sport"`. The SDK ships
`rpc/server_base.py` + `rpc/server_stub.py`, so **we can serve the loco service ourselves**
in simulation — the client code is then identical for sim and hardware.

API IDs we must answer: `7001` GET_FSM_ID, `7101` SET_FSM_ID, `7105` SET_VELOCITY,
`7106` SET_ARM_TASK. (`7102` balance mode, `7103` swing height, `7104` stand height,
`7107` speed mode may be accepted as no-ops returning success.)

### Block vocabulary (v1)

| Block | Params | Maps to |
|---|---|---|
| `walk` | `distance_m`, `direction: forward\|backward\|left\|right` | `SetVelocity(vx,vy,0,duration)` (7105) |
| `turn` | `angle_deg` (+ = left/CCW) | `SetVelocity(0,0,omega,duration)` (7105) |
| `goto` | `entity` (label from scene memory) | expands into visible `turn`/`walk`/`look` blocks |
| `look` | — | camera snapshot → VLM → scene memory update |
| `scan_room` | `steps` (default 8) | repeated `turn` + `look` over 360° |
| `wave` | `turn: bool` (turn the torso toward the person) | ArmTask wave (7106) — **right arm only**, the G1 has no left-hand wave |
| `greet` | — | `speak` + right-arm wave |
| `posture` | `pose: stand\|sit\|damp` | `SetFsmId` (7101) |
| `posture` | `pose: high\|low` | `SetStandHeight` (7104) — there is no high/low *FSM id* |
| `speak` | `text` | voice service `POST /say`, else text-only |
| `wait` | `seconds` | no robot call |

`AgentBlock` shape:

```ts
type AgentBlockKind =
  | 'walk' | 'turn' | 'goto' | 'look' | 'scan_room'
  | 'wave' | 'greet' | 'posture' | 'speak' | 'wait';

interface AgentBlock {
  id: string;
  kind: AgentBlockKind;
  params: Record<string, unknown>;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'aborted';
  reasoning?: string;      // one short line from the planner, shown in the UI
  startedAt?: string;
  finishedAt?: string;
  result?: string;
  error?: string;
}

interface AgentPlan {
  id: string;
  robotId: string;
  command: string;         // the original utterance
  contextId?: string;      // A2A context
  blocks: AgentBlock[];
  cursor: number;          // index of the running block
  status: 'planning' | 'running' | 'done' | 'failed' | 'aborted';
  createdAt: string;
  updatedAt: string;
}
```

### Robot Agent

**Current state:** `src/agent/agent-executor.ts` (~428 lines) is the A2A `AgentExecutor`; it
imports the tools from `src/tools/` and runs `ai.prompt('robot_agent')` with an LRU
`ContextCache`. `src/agent/genkit.ts` already wires Ollama through
`openAICompatible({ name: 'ollama', baseURL: config.ollamaBaseUrl })`, and
`src/config/config.ts` has `llmProvider: 'gemini' | 'openrouter' | 'ollama'` plus
`DEFAULT_OLLAMA_MODEL = 'gpt-oss:20b'`. `src/hardware/HardwareClient.ts` (~822 lines) is the
HTTP client to `hardware/g1_sidecar.py` (`/health`, `/state`, `/action`, `/cameras`,
`/cameras/:n/snapshot`, `/pointcloud/*`, `/record/*`).

**Create `robot-agent/src/agent-mode/`:**

- `types.ts` — `AgentBlock`, `AgentPlan`, `AgentBlockKind`, `SceneEntity`, `SceneMemory`,
  `ControlOwner`.
- `agent-mode-controller.ts` — the singleton: on/off toggle, current plan, E-Stop, the
  idle watcher, event emitter. Owns the whole lifecycle.
- `planner.ts` — Genkit call against `AGENT_PLANNER_MODEL`; input = command + scene memory +
  remaining plan; output = validated block list (Zod). Retries once on schema failure, then
  falls back to a single `speak` block explaining the failure.
- `block-executor.ts` — one `execute(block)` per kind, dispatching to `LocoClient` via
  `HardwareClient`. Must never be interruptible mid-block; checks the abort flag between blocks.
- `vision.ts` — grab a camera snapshot via `HardwareClient`, send it as a data URL to
  `AGENT_VISION_MODEL`, parse the structured answer (entities + bearings + person yes/no).
- `scene-memory.ts` — the entity store, bearing bookkeeping relative to robot yaw from
  odometry, `toMarkdown()` for the `current_view.md` dump.
- `navigator.ts` — `goto(entity)` expansion, the bearing-correct loop, the no-progress abort.
- `idle-watcher.ts` — every ~3 s while idle and mode ON: one cheap VLM call, "new person?"
  → wake the planner with a synthetic greet command.
- `control-owner.ts` — the exclusive `controlOwner` lock, preemption by teleop.
- `server-mirror.ts` — pushes plan/block events to the server, and every completed block to
  `complianceLogClient`.
- `prompts/planner.prompt`, `prompts/vision.prompt` — alongside the existing
  `src/prompts/` convention.

**Modify:**

- `src/config/config.ts` — add `agentModeEnabled` (env `AGENT_MODE_ENABLED`, default `false`),
  `agentVisionModel` (`AGENT_VISION_MODEL`, default `gemma3:4b`), `agentPlannerModel`
  (`AGENT_PLANNER_MODEL`, default `gemma3:4b`), `agentIdleWatchIntervalMs` (default `3000`),
  `agentMaxNavStages` (default `12`), `agentStopWords` (default `stopp,stop,halt`).
- `src/agent/agent-executor.ts` — when Agent Mode is ON, hand the inbound message to the
  planner instead of the tool-calling prompt, reply with a short immediate acknowledgement and
  stream block status as A2A task updates. When OFF, the path must be **unchanged**.
- `src/hardware/HardwareClient.ts` — add `locoMove(vx, vy, omega, durationMs)`,
  `locoAction(name, args)`, `locoFsm(id)`, `locoStop()`, `locoDamp()`, `getOdometry()`.
- `src/api/` — add `GET /agent-mode/state`, `POST /agent-mode/toggle`,
  `POST /agent-mode/estop`, `POST /agent-mode/command`; broadcast plan events on the existing
  robot-agent WebSocket.
- `package.json` — a `dev:g1-edu-agent` profile that starts with `AGENT_MODE_ENABLED=true`.

### Sidecar (Python)

**Current state:** `robot-agent/hardware/g1_sidecar.py` (~1390 lines) holds the DDS ↔ HTTP
bridge. `TOPIC_ODOM = os.environ.get("G1_ODOM_TOPIC", "rt/odommodestate")` at line 78.

**Modify `g1_sidecar.py`:**

- `POST /loco/move` `{vx, vy, omega, duration_s}` → `LocoClient.SetVelocity`
  (**seconds**, and all four fields required — a defaulted duration silently changes the
  distance travelled)
- `POST /loco/action` `{name: "wave"|"shake"|"stop", args}` → wave/shake/stop
- `POST /loco/fsm` `{id}` → `SetFsmId`. Known ids: `0` zero-torque, `1` damp, `3` sit,
  `500` start/main, `702` lie→stand, `706` squat↔stand.
- `POST /loco/stand-height` `{preset: "high"|"low"}` or `{metres}` → `SetStandHeight`.
  ⚠️ **There is no high-stand/low-stand FSM id.** Standing height is its own RPC (api 7104);
  `LocoClient.HighStand()`/`LowStand()` are wrappers sending `UINT32_MAX`/`0` as sentinels.
  `posture: high|low` routes here, not through `/loco/fsm`.
- `GET /loco/odom` → position + yaw from `rt/odommodestate`; **503 rather than zeros** when
  nothing fresh has arrived
- Guard everything behind the existing "is the SDK importable / is DDS up" pattern (503),
  plus a `G1_LOCO_ENABLED` gate (default off, 403) so a telemetry-only sidecar cannot become
  a motion path by accident. That gate is *not* a safety factor for the agent — the
  manual-E-Stop-only decision above stands.
- ⚠️ Do **not** call `LocoClient.WaveHand` / `ShakeHand(0|1)` / `StopMove`: each discards the
  RPC status code of the call it makes, so a failed command reports success. Issue the
  identical request through `SetTaskId` / `SetVelocity` instead and surface the real code.

**Create `robot-agent/hardware/sim_g1_dds/`** (this also checks the scratchpad shim into the
repo, which was pending).

⚠️ **Fourth macOS gotcha, found while building this and worth an hour of anyone's time:**
`unitree_sdk2py` hands CycloneDDS *its own* config (`core/channel_config.py`) with
`NetworkInterface autodetermine="true"`, which **overrides `CYCLONEDDS_URI`** — so tuning
Cyclone through the environment does nothing. On a Mac with ~20 UP interfaces (most without
an address, plus VPN `utun*` tunnels) autodetermine picks one that cannot carry discovery
and two local processes never find each other. It fails **silently**: `Write()` still
returns `True` because it only queues locally, and same-process pub/sub keeps working.
Always pass an explicit interface — `ChannelFactoryInitialize(domain, "lo0")` for local sim.

- `joints.py` — the SDK-motor-index → MJCF-name tables (`BODY` 29, `LHAND` 7, `RHAND` 7,
  `WEIGHT_IDX = 29`). Note the real L/R Dex3 motor-order asymmetry.
- `sim_node.py` — subscribes `rt/arm_sdk` + `rt/dex3/{left,right}/cmd`, blends
  `w*target + (1-w)*hold` into `data.ctrl`, publishes `rt/lowstate`,
  `rt/dex3/{left,right}/state` and `rt/odommodestate`. Optional live viewer (`--viewer`,
  needs `mjpython` on macOS).
- `loco_service.py` — the `sport` service server on `rt/api/sport/{request,response}` using
  `unitree_sdk2py.rpc.server_base.ServerBase`. Handles 7001 / 7101 / 7105 / 7106, integrates
  velocity into the pelvis planar DOFs, and drives `wave` by playing a canned arm trajectory
  through the same blend path.
- `setup.sh` + `README.md` — the three macOS build gotchas: no CycloneDDS wheels (build the
  C library from `releases/0.10.x`, export `CYCLONEDDS_HOME`); the `cyclonedds` 0.10.2 Python
  binding does not compile on Python 3.13 (use a 3.12 venv); `mjpython` needs
  `libpython3.12.dylib` symlinked into `mujoco/MuJoCo_(mjpython).app/Contents/lib/`.
  DDS domains: 0 = real robot, 1 = sim, 9 = mock/tests.

**Create `robot-agent/hardware/sim_evaluator/mjcf/g1_dex3_room_scene.xml`:**

~6×6 m room with walls, a table with a hat on it, a chair, a shelf and a simple person figure.
The robot include must be the **floating/planar** variant, not `g1_43dof_fixedbase.xml`: add a
pelvis with `x`, `y`, `yaw` slide/hinge joints driven kinematically by the loco service
(position actuators, high gain). Legs stay in the stand pose. The head camera must actually
move with the base so `look` returns genuinely different images.
Leave `g1_dex3_pickplace_scene.xml` untouched.

### Server

**Current state:** the A2A WebSocket lives at `/api/a2a/ws`; the robot-agent already posts
compliance logs and telemetry to the server.

- `src/types/agent-mode.types.ts` — mirror of `AgentBlock` / `AgentPlan` / `ControlOwner`,
  same JSDoc header convention as the other type files.
- `src/services/AgentModeService.ts` — in-memory `Map<robotId, AgentModeState>` plus a
  bounded recent-event log. No Prisma, no migration.
- `src/routes/agent-mode.routes.ts` — mounted on `/api/robots` alongside `robotRoutes`,
  `voiceRoutes` and `vlaSessionRoutes`, so the paths are
  `POST /api/robots/:id/agent-mode/events` (inbound from the robot-agent, fans out over the
  WebSocket), `GET /api/robots/:id/agent-mode`,
  `POST /api/robots/:id/agent-mode/command` (proxy to the robot-agent),
  `POST /api/robots/:id/agent-mode/estop`, `POST /api/robots/:id/agent-mode/estop/reset`
  (without this the latch is a dead end — the UI could stop the robot but never hand control
  back), `POST /api/robots/:id/agent-mode/toggle`, `GET /api/robots/:id/agent-mode/scene`.
  **Name note:** `src/routes/agent.routes.ts` and `src/repositories/AgentRepository.ts`
  already exist and are about A2A agent *cards* — hence the `agent-mode` naming.
- Broadcast on the existing A2A WebSocket with the house colon-namespaced prefix so
  clients can prefix-filter: `agent:plan:started|updated|finished`,
  `agent:block:started|finished`, `agent:scene:updated`, `agent:state:changed`.
- Register the routes where the other route modules are registered.

### Frontend

**Create `app/src/features/agentmode/`** following the feature-first + Zustand house pattern:

- `store/agentModeStore.ts` — plan, blocks, scene memory, control owner, connection state.
- `hooks/useAgentModeSocket.ts` — subscribe to the `agent_mode.*` events on the existing
  A2A WebSocket.
- `components/BlockCard.tsx` — one block: icon, kind, params, status, duration, reasoning.
- `components/BlockTimeline.tsx` — the narrow top bar: current block + the next ones + a
  prominent **STOPP** button.
- `components/AgentChat.tsx` — the conversation; block cards render inline underneath the
  command that triggered them. Reuse the chat input/message components from
  `app/src/features/a2a/`.
- `components/ScenePanel.tsx` — collapsible right panel: latest camera frame + the scene-memory
  entity list (label, bearing, distance estimate, last seen).
- `components/AgentModeToggle.tsx` — per-robot on/off switch.
- `pages/AgentModePage.tsx` — the layout.
- Route `/agent` in the router + a nav entry.
- MSW handlers in `app/src/mocks/` mirroring the new endpoints, so demo mode works.

### Key files

**Create**
- `robot-agent/src/agent-mode/{types,agent-mode-controller,planner,block-executor,vision,scene-memory,navigator,idle-watcher,control-owner,server-mirror}.ts`
- `robot-agent/src/agent-mode/prompts/{planner,vision}.prompt`
- `robot-agent/hardware/sim_g1_dds/{joints,sim_node,loco_service}.py`, `setup.sh`, `README.md`
- `robot-agent/hardware/sim_evaluator/mjcf/g1_dex3_room_scene.xml`
- `server/src/types/agent-mode.types.ts`
- `server/src/services/AgentModeStateService.ts`
- `server/src/routes/agentMode.routes.ts`
- `app/src/features/agentmode/**`
- `app/tests/agent-mode.spec.ts`

**Modify**
- `robot-agent/src/agent/agent-executor.ts`
- `robot-agent/src/config/config.ts`
- `robot-agent/src/hardware/HardwareClient.ts`
- `robot-agent/src/api/` (route + WebSocket registration)
- `robot-agent/hardware/g1_sidecar.py`
- `robot-agent/package.json`
- `server/src/index.ts` (route registration)
- `app/src/` router + nav
- `app/src/mocks/` handlers
- `docs/architecture.md` (an Agent Mode section)
- `CLAUDE.md` (mention the new module)

## Test Strategy

1. **Typecheck** — `./scripts/test-all.sh --skip-pw` must stay green (server + app), plus
   `cd robot-agent && npm run typecheck`.
2. **Unit (robot-agent)** — planner schema validation incl. the malformed-LLM-output fallback;
   `walk`/`turn` → velocity+duration conversion; the `goto` bearing loop with a stubbed
   odometry; the no-progress abort; scene-memory bearing bookkeeping across a `scan_room`;
   E-Stop mid-plan leaves the plan `aborted` and every pending block `skipped`;
   `controlOwner` preemption by teleop. **Also: a motion block must report the distance/angle
   it MEASURED from odometry, never the one it commanded, and must say so explicitly when no
   odometry is available** — see the live finding below.
3. **Sim integration (no hardware)** — start `sim_g1_dds/sim_node.py` on DDS domain 9 together
   with `loco_service.py`, drive it with an unmodified `LocoClient` script, and assert the
   pelvis pose changes as commanded and `rt/odommodestate` reports it back.
4. **Acceptance run** — in the room scene, "geh zum Tisch mit dem Hut" must produce
   `scan_room → turn → walk → look → walk → arrival`; the head camera must demonstrably return
   different images (hash the frames); scene memory must contain table + hat with bearings.
5. **Idle** — a person appearing in view while idle triggers `greet` (`speak` + `wave`) exactly
   once, not repeatedly.
6. **Playwright** (`app/tests/agent-mode.spec.ts`) — `/agent` renders; sending a command shows
   block cards; the block bar shows the current + upcoming blocks; STOPP aborts and the UI
   reflects it; the scene panel lists entities. Must pass under `VITE_DEMO_MODE=true` with MSW
   handlers (see the known demo-mode gotcha where specs assert real UI).
7. **Off-switch regression** — with `AGENT_MODE_ENABLED=false` the existing A2A chat behaves
   exactly as before (existing robot-agent tests stay green).

## Findings from the first live run (sim + gemma3:4b) — fixed, keep them fixed

Both were found by actually driving the simulator with a real local model, not by reading
code. Both are the kind of defect that unit tests with stubbed happy paths never surface.

1. **The planner turned the wrong way.** `"dreh dich nach links"` produced `angleDeg: -90`
   and the robot turned right. Stating `(+ = left)` once inline in the block reference was
   not enough for a 4B model. The prompt now carries a dedicated DIRECTION CONVENTION section
   with worked examples in German and English. Re-verified live: odometry −90.1° → −0.2°.
2. **Motion blocks reported the command, not the outcome.** A commanded 2 m walk moved the
   robot 1.71 m (the velocity command expired before the executor stopped waiting) while the
   block reported "Walked 2.00 m". The planner then re-planned from a pose the robot had
   never been in. `walk`/`turn` now read odometry before and after, report the measured value,
   flag a shortfall beyond 10%, and say "unverified" when there is no odometry at all.

## Adversarial review round — 20 confirmed defects, all fixed

62 candidate findings from a fan-out review, each handed to an independent agent instructed
to *refute* it. 42 were refuted and dropped; the 20 that survived were fixed in four disjoint
file partitions, every one with a test that fails against the pre-fix code. Grouped by what
they would have cost:

**The robot keeps moving while the product says it stopped.**
- The platform E-Stop (`POST /safety/estop`, `roboctl estop`, the Genkit tool) never reached
  Agent Mode. SafetyMonitor only zeroed the *simulated* speed; the block executor kept driving
  the LocoClient. Both paths now forward to `agentModeController.estop()` and report honestly
  whether it landed.
- The controller trusted only its own latch, so a SafetyMonitor stop (fall/tilt, comms) left
  `submitCommand` and the idle greeter free to drive an e-stopped robot.
- The UI presented an *unverified* stop as a completed one. `estop()` never read `stopped`
  from the response; a failed request still rendered "the robot is stopped and damped".
- A latch reset landing mid-block resurrected the stopped plan and re-labelled it `done`.
- Six ordinary sentences containing "stopp"/"halt" as a substring silently triggered the
  stop word; the doc had always said *bare* stop word.
- The terminal E-Stop the docs promised did not exist at all — no stdin handler anywhere.
  Now `robot-agent/src/terminal-estop.ts` (SPACE/ESC, no reset key, Ctrl+C still works).

**Control arbitration.**
- A VLA rollout claimed the exclusive lock in the REST route and released it only in
  `/vla/stop`. Every self-terminating rollout (no VLA server, max steps, timeout, crash) —
  the common case — leaked the lock for the life of the process and killed Agent Mode
  permanently, with no UI path to recover. Lock lifetime now belongs to the rollout.
- The teleop lock had no refcount: with four teleop sockets open, the first to close handed
  control back to `idle` while a human was still streaming joint targets.

**Simulator physics — three defects the existing e2e check structurally could not catch,
because it only ever commanded a 90° turn and never idled.**
- Yaw was wrapped to (-π, π] *in the actuation signal*. Crossing 180° stepped the position
  setpoint by 2π: max |qacc| 6.3e7, solver blow-up, the base stuck at 148° of 1229° commanded.
  Yaw is continuous now and wrapping happens only where a heading is reported.
- Command expiry compared against a non-monotonic clock, so MuJoCo's auto-reset let an
  expired command resurrect seconds later (a 250° spin became 502°).
- The hold pose was read live from `qpos` at blend weight 0, giving zero restoring torque:
  over 150 s idle the head camera drooped 15° → 45° and the elbow drifted 1.4 rad. Latched now.
- The feet started 1.69 cm inside the floor (`PELVIS_Z` 0.775 → 0.807).

**Honesty about what the robot did.**
- `walk`/`turn` reported success on zero measured motion — a damped robot ignores velocity
  commands entirely, so a stopped robot reported a completed plan. They now fail on zero
  motion and the state carries `fsmId`/`damped` so the planner and the operator are told to
  send `posture: stand` first. Nothing re-arms automatically — that is the manual-E-Stop
  decision, and it holds here.
- `wave` took `hand: left|right`, which the G1 cannot express: ArmTask (7106) is right-arm
  only. Replaced with the sidecar's real `turn: bool`.
- An accepted interrupt dropped when the plan failed *or crashed* is now announced.
- The idle greeter re-greeted a person who had never left, because absence was inferred from
  a gap in observation rather than observed.
- Navigator-generated blocks never reached the timeline, and the "current block" chip pinned
  itself to the `goto` container forever.
- A cold-start 404 (the documented empty state) rendered as an error banner.

Two further defects were found while fixing the above and are covered by
`robot-agent/src/safety/__tests__/SafetyMonitor.estop-latch.test.ts`: a refused reset left the
latch on `resetting`, so `isEStopTriggered()` reported *not stopped* about a robot that was
still latched; and each hop of a cascading stop overwrote `triggeredBy`/`reason`, destroying
the record of the original cause.

## Repeat-run round — what only breaks the second time

The adversarial round ran each check once. Running them back to back found four more, all of
the same shape: state left over from the previous run.

1. **`e2e_loco_check.py` asserted in the world frame.** `abs(y1 - y0) > 0.05` for "did it walk
   straight" only holds when the robot happens to face +x. Re-running against an already-driven
   node reported a phantom sideways drift of `sin(start yaw) x distance` — −0.315 m on the
   second run, −0.595 m on the third, while the robot was in fact walking perfectly straight.
   Now projected through `body_frame_delta()`. The forward check is also signed now: `hypot`
   passes a robot that walked a metre *backwards*.
2. **The strafe check only asserted magnitude.** It would have passed a robot that strafed
   right, or that walked forward instead of sideways — the two things the check exists to
   catch. Now asserts signed lateral travel *and* that forward drift stays under 5 cm.
3. **The turn check used `abs(yaw2 - yaw1)` on a wrapped heading.** A +90° turn that happens to
   cross ±180° reads as 270°. Now folded through `angle_delta()`, and signed, because the
   first live run's bug was turning the *wrong way* and a magnitude check calls that fine.
4. **The harness could not return to a known pose.** The room is 6×6 m; after six runs the
   robot sat 0.36 m off the −y wall and the strafe stalled against it (+0.185 m of a commanded
   0.45 m). Nothing about the code under test — the harness had simply walked itself into a
   corner. `sim_node.py` gained `POST /sim/reset-pose`, queued for the physics thread like
   renders are (writing qpos from an HTTP thread corrupts mjData rather than moving the robot),
   which stops the active loco command, zeroes base qvel, moves the actuator setpoints with the
   base, and re-syncs `LocoState` with the *unwrapped* carrier yaw. The harness now resets to
   (−1, 0, 0°) first — clear of table, chair, shelf and person.

Verified by running the harness four times back to back against one node: all four pass, and
run four reads the same as run one.

## Live acceptance round — five end-to-end runs against sim + Ollama

Driving the whole stack (MuJoCo room scene → sidecar → robot-agent → server → `/agent`) with a
real local model, repeatedly, found five more defects. Each was fixed and the run repeated.

1. **The sim ran at ~19% of real time whenever anything rendered — the worst of the lot.**
   `run_loop` stepped physics exactly once per iteration. An offscreen render costs ~50 ms
   against a 2 ms timestep, so while Agent Mode's `look` blocks rendered steadily the sim fell
   permanently behind and never caught up. Callers wait in WALL seconds while the velocity
   command expires in SIM seconds, so a 90° turn commanded for 2 s came back **4.9° done and
   kept turning 12.5° more after the block had already reported and measured**. Every
   subsequent bearing was then computed from a yaw the robot was no longer at, which is why
   navigation reliably drove into a wall. Fixed with bounded physics catch-up
   (`MAX_CATCHUP_STEPS`). Measured before/after under identical render load: **4.9° → 90.0°**
   of a commanded 90°, post-report drift **12.5° → 0.1°**. Walk stages went from 0.10 m to
   0.98 m of a commanded 1.00 m.
2. **The server showed an Agent-Mode-ON robot as "off", with the command box disabled.** The
   mirror is in-memory and event-driven, so it knew nothing about a robot until its first plan
   — and nothing at all after a server restart. Two fixes, because the two failure windows are
   different: the robot now announces its boot state (`announceBootState()`), and
   `GET /:id/agent-mode` asks the robot directly on a miss instead of answering 404. Verified
   both ways, including restarting the server alone to wipe its memory.
3. **Entity lookup was decided by iteration order.** `get("Tisch mit dem Hut")` substring-matched
   in either direction and returned the *first* hit, so which physical object `goto` walked to
   depended on the order the vision model happened to mention things — "tisch" and "hut" both
   match. Now the most specific match wins, deterministically. Two tests, both fail against the
   old lookup.
4. **The two models did not share a vocabulary.** `scan_room` returned German labels
   ("Tisch", "Stuhl", "Tür") while later `look`s drifted to English ("Table", "Chair",
   "Doorway"), so scene memory held two entities per physical object: the navigator tracked one
   while only the other was refreshed, distance never improved, and `goto` aborted after 12
   stages "without getting closer". Then the *planner* emitted `goto {"entity": "table with
   hat"}` against German labels and it failed outright with "not in the scene memory". Both
   prompts now pin the label language to bare German nouns.
5. **`AGENT_OLLAMA_BASE_URL` without `/v1` fails invisibly.** Genkit reaches Ollama through its
   OpenAI-compatible API; a bare `:11434` 404s on every call, and the planner honestly reports
   "could not produce a plan", which points the reader at the model rather than the URL. The
   default was already right — the example profile I added was not. Fixed, plus a boot warning
   when the URL does not end in `/v1`.

### The wrong-way turn was NOT fixed by the prompt — it is now fixed in code

The "findings from the first live run" section above claims the direction bug was fixed by
giving the prompt a DIRECTION CONVENTION section, "re-verified live". Driving it again:
**"dreh dich nach links" produced `angleDeg: -90` and the robot turned RIGHT in 5 of 5 runs
that produced a turn at all** — while the model wrote "Ich drehe mich nach links" as its own
reasoning, and against a prompt that carries that exact sentence as a worked example mapped to
`+90`. The prompt was verified intact by dumping it. Prompt engineering has run out of road on
a 4B model here.

A humanoid that turns the opposite way from a plain-language instruction is not something to
leave to a language model's grasp of a sign convention, so `enforceTurnDirection()` in
`planner.ts` now settles it deterministically: if the command names exactly one direction and a
`turn` block contradicts it, the sign is corrected and the correction is logged, never silent.
Commands naming both directions ("erst links, dann rechts") and 180° turns are left alone —
half-correcting would be worse than not trying. Five unit tests, plus live re-verification:
**every trial that produced a turn now turns left, +90.1° measured by odometry, against 0 of 5
before.**

The same runs show the planner emitting a `turn` with no `angleDeg` roughly half the time. That
one needs no guard: it is rejected, retried, and then reported as "could not produce a plan" —
the robot stands still and says so.

### Acceptance criterion 4 is NOT met — and the reason is the model, not the pipeline

"geh zum Tisch mit dem Hut" must end in **arrival**. It does not. What does hold, verified live:

- the block sequence is exactly the specified one — `scan_room → turn → walk → look → walk → …`,
  with the navigator's stages appearing as real blocks in the timeline;
- the head camera demonstrably returns different frames (the e2e check hashes them);
- scene memory contains Tisch and Hut with bearings, and with `gemma4:e2b` the vision model
  reports "einen Tisch mit einem roten Hut" — it identifies the target correctly.

What fails is closing the loop: a 4–5B local VLM's *bearing and distance* estimates from a
single frame are not accurate enough. Over successive stages the error compounds and the robot
walks past the table into a wall. `gemma3:4b` also hallucinates confidently — "Pistole",
"Waffe", "Staircase" in a room containing none of them.

The failure behaviour is the part that matters and it is correct: `goto` aborts after
`AGENT_MAX_NAV_STAGES`, reports the best distance it actually achieved, every motion block
reports MEASURED movement with an explicit shortfall percentage, and nothing anywhere claims
an arrival that did not happen. A robot that cannot find the table says so.

**Follow-up, and it is the real one for v2:** bearing/distance must come from geometry, not
from a language model's guess about a JPEG — the depth camera or the LiDAR that the Digital
Twin work already ingests. Treat the VLM as an object *recogniser* and let sensing supply the
angles. Until then `goto` should be considered demo-grade, and that is now stated in the task
rather than left for the next person to discover.

## Gaps found by running the documented commands verbatim

- **`npm run dev:g1-edu-agent` booted with Agent Mode OFF.** The script pointed at
  `.env.g1-edu-agent`, which never existed and had no `.example` — dotenv loads a missing file
  silently, so the documented entry point for the whole feature started with the flag unset.
  Added `.env.g1-edu-agent.example`, and the script now also sets `AGENT_MODE_ENABLED=true`
  inline (dotenv does not override an already-set variable, so the flag cannot end up off).
- **`.gitignore` hid every new env example.** `!.env.example` un-ignores exactly that one
  literal name, so `.env.g1-edu-sim.example` and `.env.so101.example` only exist in the repo
  because someone ran `git add -f`, and the new one would have stayed invisible. Widened to
  `!.env*.example`; real `.env.g1-edu` / `.env` remain ignored (verified with `git check-ignore`).

## Hand-over round — bringing the stack up for someone else to drive

Four defects, found by starting the stack the way an operator would and then measuring rather
than assuming.

- **The server mirror asserted `estopActive: false` it had never been told.** Only
  `agent:state:changed` carries a full snapshot; a plan/block/scene event arriving first made
  `AgentModeService.ingest()` seed from `emptyState()`, whose `enabled`/`controlOwner`/
  `estopActive` are bare defaults. Seen live: the robot reported `enabled: true`, the server
  reported `enabled: false` for the same plan id and timestamp. The earlier fix only covered a
  *missing* entry; this is a *fabricated* one, and it would report a latched E-Stop as clear.
  Added `isHydrated()` — set only when a real snapshot arrives, never cleared by later partial
  events — and the route now treats an unhydrated entry exactly like a miss (ask the robot;
  404 if it cannot be reached). 6 new tests.
- **gemma3:4b cannot plan the simplest command in the vocabulary.** "dreh dich nach links",
  5 live runs: 2 OK / 3 honest fallback. Its answer is `{"kind":"turn","reasoning":"..."}` with
  **no** `angleDeg`, followed by a sideways `walk` nobody asked for — both attempts fail, so the
  operator gets "I could not plan that" for a plain turn. Same 5 runs on **gemma4:e2b: 5/5**,
  every turn +90° left, odometry 90.0 / 180.0 / 270.0 / 360.0 / 90.0; also correct on
  "nach rechts" (−90°), "einen Meter vorwaerts" (measured 0.98 m) and "winke mal". The
  `.env.g1-edu-agent` profile now pins `gemma4:e2b` for **both** roles — it is also the better
  vision model, since gemma3:4b hallucinated "Pistole" and "Waffe" into an empty room scene.
  The code default in `config.ts` is left at `gemma3:4b`; **that default should probably follow,
  but it was a settled decision, so it is flagged here rather than changed.**
- **A rejected plan was undiagnosable.** The warning said what was missing but not what came
  back, so the failure shape was unrecoverable after the fact. `attempt N failed` now logs the
  rejected candidate (truncated), and says `(no answer — the model call failed)` when the call
  itself threw rather than printing `undefined` — which it did, until the existing
  ECONNREFUSED test caught it.
- **`mergeSplitReasoningBlocks()`** drops a block carrying only `kind` + `reasoning` when the
  *next* block has the same kind and is executable, carrying the reasoning over. Deliberately
  narrow: a lone parameterless `turn` is still a hard failure, and a `turn`-then-`walk` pair
  (different kinds) is left to fail rather than half-executed. Without the schema constraint
  gemma3:4b produces exactly the same-kind split 6/6 times; with it, the broken shape above.
- **`scan_room` left the robot one step off its starting heading.** The sweep skips the final
  turn so the starting heading is not observed twice — which also means it never closes the
  circle. Measured: 90° in, **44.9°** out on an 8-step scan, i.e. exactly 360/8. Every later
  `walk` inherited the offset. The closing turn now runs without a further observation; if it
  fails the scan still succeeds and the message says how far short the robot is. Measured
  after: 0.0° in, **−0.0°** out.

## Follow-ups (explicitly out of scope for v1)

- `vla_skill` block to grasp the hat — blocked on TASK-188.
- Real walking instead of the kinematic base — Isaac gait policy.
- Real-hardware validation — TASK-169 robot day, with the safety deviation above accounted for.
- Persisting a successful plan as a `SkillChain`.
- `scan_room` does not odometry-verify its per-step rotation, so it would report "Scanned the
  room in 8 steps" on a damped robot. The observations it returns are real; the rotation
  claim is not. Same class as the `walk`/`turn` fix above, one level up.
- The sim venv lives outside the repo. `hardware/sim_g1_dds/setup.sh` builds it, but until
  someone runs it `scripts/test-all.sh` reports the pytest stage as SKIPPED.
- **Pre-existing, not this task:** the server vitest suite fails roughly one run in three with
  `Error: Parse Error: Expected HTTP/`, in a different, always-unrelated file each time
  (`command-routes`, `embodiments-routes`, `federated-routes`, `compliance-tracker-routes`,
  `skills-routes`, `incident-routes` — each passes in isolation). Reproduced on a clean worktree
  at `e170fc6` with none of this branch's code, so it is not an Agent Mode regression. Every
  suite uses `request(app)`, which starts an ephemeral server per request; under a 187-file
  parallel run that looks like ephemeral-port/TIME_WAIT reuse on macOS. Worth its own task —
  a 1-in-3 red on the project's main test command trains people to ignore it.
- `robot-agent` declares `cross-env` in devDependencies but it is absent from this machine's
  `node_modules`, so every `npm run dev:*` profile dies with `cross-env: command not found`.
  Local install drift rather than a repo defect, but it makes the documented commands fail.

## Sim run round — five commands driven end to end against MuJoCo

Recorded runs through the UI's own path (server :3001 → robot-agent → sim), odometry read back
from `/loco/odom`. Video and stills captured from `/cameras/{room_overview,head_camera}/snapshot`.

**Clean, measured:** `walk 2 m` → 1.999 m displacement. `turn -90°` → −90.0°. `walk 1 m` → 1.000 m.
`turn left and look around` → +90.0° then a scan closing to 89.8°, i.e. 0.2° residual against
the 44.9° the closure fix removed. Language switch verified live: labels came back
`floor, wall, shelf, door, ceiling, person, chair, table`.

### Fixed

- **The navigator steered on bearings no `look` had confirmed.** `scene.get()` returns the stored
  entry whether or not the last observation re-saw it, so after the vision model stopped
  reporting the table the robot kept walking on a stage-1 bearing — four stages, into the north
  wall. Scene entities now carry `observedSeq`, a monotonic re-observation count, and the
  navigator ends the run after `MAX_UNSEEN_LOOKS` (2) looks that do not re-report the target.
  `lastSeen` cannot serve here: two merges inside one millisecond share a timestamp, which is
  how the first attempt at this fix broke five existing tests.
- The `navigator.ts` header promised "aborting after AGENT_MAX_NAV_STAGES stages **without the
  target getting closer**". The loop only ever bounded total stages; `stagesWithoutProgress` is
  computed and used solely in the give-up message. Header corrected to describe the real
  behaviour rather than changing abort semantics that nothing had measured harm from.
- Test world always re-observed the target on every `look`, which is why none of this was
  covered. `makeWorld` now takes `visibleForLooks`.

### Open — acceptance criterion 4 still unmet, but not for the reason assumed

`walk to the table with the hat` **physically arrives** and then reports failure. Final pose
(3.076, 1.403) against a table centred (2.20, 0.70) — 1.12 m — with four consecutive walks
blocked by the table itself (26%, 87%, 89%, 96% short of a commanded 1.00 m) and a head camera
almost entirely filled by the hat. Three separate causes, none of them "navigation is broken":

1. **Arrival is unprovable from the only signal the loop trusts.** `ARRIVAL_M = 0.6` is tested
   against the VLM's distance estimate, which never gets there. The decisive physical evidence —
   commanded a metre, moved four centimetres — exists as `BlockOutcome.measured.distanceM` but
   never reaches the navigator: `runGeneratedBlock` returns an `AgentBlock`, which carries only
   the prose `result` string. Plumbing `measured` onto `AgentBlock` (or widening the navigator's
   dep signature) is the prerequisite for any blocked-means-arrived policy.
2. **Stored bearings are wrong, but not because the model is bad at angles.** First measured as
   "122° of error on a single frame" — that measurement was invalid (it compared *remembered*
   entries against current truth). See "Bearing accuracy, measured properly" below for what is
   actually happening: the model hallucinates known furniture when pointed at empty room, and
   `merge`'s last-write-wins lets the hallucination overwrite the real sighting.
3. **Labels drift at close range.** `table` at three metres becomes `object`, then `red object`,
   once it fills the frame. Scene memory is keyed by label, so tracking dies exactly on arrival —
   and it is what trips the new unseen-look guard, whose message therefore names both causes
   rather than prescribing a re-scan.

### Language

Everything Agent Mode emits is English now: `VISION_PROMPT` labels, the planner's `goto.entity`
vocabulary and `reasoning`/`speak` instructions, four hard-coded German strings (dropped-command
announcement, idle greeting, `greet` default, planner fallback), the chat suggestions and
placeholder, and ~72 test fixtures that encoded the German label contract. German *operator
inputs* were deliberately kept in `agent-mode-controller.test.ts` — they cover the "halt" modal
particle that must not latch an E-Stop, and `halt` is still a stop word.

## Recorded-run round — ten runs on video, and the root cause behind the bad bearings

`scripts/record-sim-run.py "<command>"` drives one command through the UI's own path and writes
`sim-runs/<NN>-<slug>/` with both camera videos, a side-by-side, opening/closing stills, and the
block-by-block trace. Ten runs are indexed in `sim-runs/README.md` (gitignored — 14 MB of video).

**Confirms the locomotion layer is not the problem.** Walks land within 1–2 cm of the commanded
distance, turns within 0.2°, a 360° scan closes to 0.2°, and `walk 2 m forward, then return to
where you started` comes home to within **2 mm**. `do a backflip` is refused honestly with no
motion.

### Bearing accuracy, measured properly

The earlier "122° of error" reading was methodologically wrong: `/scene` returns *remembered*
entities, so it compared stale entries against present truth. Redone with scene memory cleared
(restart the agent — plans and scene are in-memory by design) and the robot placed at a known
pose, one 360° scan stored table −136.6° (truth +12.3°), chair −91.6° (truth −35.4°), shelf
+163.2° (truth +77.7°). Every wrong bearing sits within ~2° of a *later* step of the same sweep,
so `scripts/bearing-probe.py` probed single poses directly:

- facing **225°**, at a bare wall → the model reports `table` at relative **−1.6°**, dead ahead
- facing **270°**, likewise → `chair` at **−1.6°**

Those two hallucinations are exactly the bearings the scan stored. A single `look` at a pose where
the object genuinely is in frame is decent — 7–18°. So the failure is not angle estimation:

1. the VLM names furniture it knows is in the room even when the frame is empty wall, and
2. `SceneMemoryStore.merge` overwrites unconditionally, so across a sweep the **last** mention of
   a label wins — and the last mention is usually one of those phantoms.

`VISION_PROMPT` already says "Never guess objects that are not in the picture"; gemma4:e2b does it
anyway. This is the root cause behind the stale-bearing stop in run 07 and the wall collision that
motivated the unseen-look guard.

### "Turn around and walk back" plans a self-cancelling pair

`walk 2 m forward, turn around, walk 2 m back` → `turn 180°` then `walk backward`, which undoes
the turn and ends **3.89 m** from the start it was told to return to. The same intent without an
explicit turn (run 03) is correct to 2 mm, so the turn is what misleads the model. A prompt rule
stating that "back" means forward after turning around was added, measured over two runs (04, 05),
changed nothing, and was **removed** rather than left in as dead weight — `prompts.ts` carries a
comment recording that so nobody re-adds it. Deterministic normalisation, following the
`enforceTurnDirection` precedent in `planner.ts`, is the open option.

## Thinking and temperature — two things the model never actually received

`gemma4:e2b` is a thinking model and Ollama 0.32.3 has thinking **on** by default, which nothing in
this task had accounted for. Measured cost: ~10 s and 300–700 generated tokens per call, on both
roles — a `scan_room 8` spends about a minute of its ~3.5 on reasoning traces nobody reads.

**Off is now a per-role flag**, `AGENT_PLANNER_THINKING` (default off) / `AGENT_VISION_THINKING`
(default on). Split because the roles pay different prices, measured at temperature 0 on 7 planner
commands and 4 real sim frames:

- Planner, thinking off: 3 of 7 degrade. `turn left` gains an invented `walk 0.5 m` (against the
  explicit "never invent a distance" rule), `dreh dich nach links` gains a `walk` with no
  `distanceM` at all (schema-invalid → costs the repair attempt), `wave with your left hand` drops
  the `speak` block that says the wave is right-arm only. One case *improves*: `look around, then
  walk to the shelf` plans `scan_room → goto`, where thinking-on dropped the `goto`. None of the
  regressions move the robot somewhere it was not sent, so speed wins here.
- Vision, thinking off: 5 bearings outside the ±60° fan the prompt states, across 3 of 4 frames
  (chair 120°, door 180°, wall 90°) against 1 of 4 with thinking on. `parseVisionAnswer` clamps to
  ±90 rather than dropping, so each one enters scene memory as a confident hard-left heading and
  last-write-wins merge lets it overwrite a real sighting. Given bearings are the known weak point,
  thinking stays on for vision.

`think: false` does **not** work here — that is the native `/api/chat` field, and Ollama silently
ignores it on the `/v1` endpoint Genkit uses (verified: still 222 tokens of reasoning).
`reasoning_effort: 'none'` is the one that works; `'low'` does nothing.

### `temperature: 0` has never reached the model

Found while verifying the above against a logging proxy in front of Ollama. `@genkit-ai/compat-oai`
ends `toOpenAIRequestBody` with

```js
for (const key in body) { if (!body[key] || ...) delete body[key]; }
```

a truthiness test, so `temperature: 0` is deleted with the undefined keys. The outgoing body
carried **no** temperature field at all; Ollama therefore applied its own default (0.8 for gemma).
At 0.7 the field survives, which is what pinned the cause. The plugin's `requestBuilder` hook
cannot work around it — the strip runs afterwards — so `buildGenerateConfig` sends `1e-4` instead,
greedy in practice and truthy.

Consequence for everything measured before this: **every live planner and vision call in this task
ran at 0.8, sampling.** The "at temperature 0 gemma3:4b answers X" notes in `planner.ts` and the
5-run direction-convention comparisons in `.env.g1-edu-agent.example` describe a sampling model, not
a greedy one, and their run-to-run variation is at least partly that. Nothing measured is thereby
wrong about *what the robot did*, but the sim runs 01–10 are all 0.8 samples and worth re-running
now that the setting bites.

### Three design decisions this round surfaced — all need a product call, none taken unilaterally

1. **Plumb `BlockOutcome.measured` onto `AgentBlock`** so the navigator can see "commanded a
   metre, moved four centimetres, four times running" and conclude arrival. This is what stands
   between run 10 and a passing acceptance criterion 4.
2. **Replace last-write-wins in `SceneMemoryStore.merge`** with a policy that prefers the best
   observation of a label within a sweep (confidence, centrality, or agreement across steps)
   instead of the most recent.
3. **Normalise `turn 180` + `walk backward` deterministically** in the planner.

## Branch review round — full-stack adversarial pass + Playwright MCP (2026-07-26)

Independent review of everything uncommitted on `feat/agent-mode` against this task: four
parallel adversarial reviewers over robot-agent / server / app / Python, an interactive
Playwright MCP session (desktop + mobile), and the full test matrix. Baseline before fixes:
all three typechecks clean, all unit suites green, all 5 `agent-mode.spec.ts` e2e tests pass,
MCP session PASS with zero console errors. The review still surfaced 12 confirmed defects
(1 high, 6 medium, 5 low) plus 2 UI findings — all fixed this round, each with a regression
test that fails pre-fix.

### Robot agent (6 defects)

1. **HIGH — `resetEstop()` forgave a teleop-takeover abort.** It cleared `abortRequested`
   unconditionally, so a latch reset during teleop wind-down resurrected a preempted plan.
   Now only an *agent-latch* reset clears the abort flags (`hadAgentLatch` guard).
2. **MED — E-Stop delivery was unverifiable.** `estop()` resolved identically whether
   StopMove/Damp reached the sidecar or not. It now returns
   `{ ok, stopped, delivered, deliveryError? }` (`AgentEstopResult`); `/safety/estop` and
   `CommandExecutor.emergencyStop()` surface `delivered: false` as a loud failure instead of
   reporting a clean stop about an un-damped robot. The server proxies the fields verbatim.
3. **MED — teleop preempting a VLA rollout only relabelled the lock.** The SkillExecutor
   loop kept POSTing actions under the operator's hands. `RobotStateManager` now subscribes
   to lock changes and calls `stopVLAControl()` on `vla → teleop` preemption.
4. **LOW — terminal E-Stop only armed when Agent Mode was on at boot.** It now follows the
   runtime toggle via `agent:state:changed` (arms on enable, disposes on disable).
5. **LOW — a late-resolving planner mutated a plan the E-Stop had already finalized.**
   `runPlan()` re-checks `planFinalized` after the `planner.plan()` await.
6. **LOW — a second interrupt silently discarded the first, unstarted one.** The ack now
   says which earlier instruction it replaces.

Suite after fixes: robot-agent 44 files / 567 tests green, typecheck clean.

### Server (1 defect)

- **MED — the state mirror trusted arbitrary snapshot bodies.** A malformed robot response
  could poison the in-memory mirror and the GET fallback returned it as truth. Added
  `isValidAgentModeSnapshot` guard in `AgentModeService`; the GET fallback 404s on an
  invalid body instead of caching it.

### Python sidecar / sim (3 defects)

- **MED — `sim_node.py` wrapped LocoClient calls that discard RPC codes.** It now mirrors
  `g1_sidecar.py`: dispatch via `SetTaskId`/`SetVelocity`, surface the RPC code, required
  `move`/`fsm` fields, reset-pose 400, odom 503 when no base (never fabricated), no latched
  init failure, `rpc_lock` around DDS calls.
- **LOW — the room scene had no usable doorway.** `wall_yneg_b` resized/moved
  (`size 0.65 0.05 1.25`, `pos 2.35 -3.0 1.25`) so the south wall has a real 1 m opening
  at x ∈ [0.70, 1.70].
- **LOW — README/setup.sh disagreed on the sidecar port.** Unified to 8777; the
  "Verifying" section now matches what the commands actually print.

### App (2 defects + Playwright MCP findings)

- **MED — a superseded WebSocket's async `onclose` clobbered the live socket's ref**
  (robot switch / StrictMode remount → leak + double-applied events). `onclose` now has the
  same identity guard as `onerror`.
- **MED — stale API responses repainted a switched-away robot.** Every post-await `set` in
  `agentmodeStore` (fetchState, sendCommand, toggle, estop, resetEstop — success *and*
  error paths) now drops responses whose `robotId` no longer matches; worst case before:
  a stale estop ack latched the *new* robot's console and suppressed its live plan.
- **Playwright MCP findings, fixed as a follow-up batch:** the STOPP button (75×28 px on
  mobile — a safety control below the 44 px touch-target minimum) and the send button
  (40×40) now get 44 px targets on touch devices via Tailwind `pointer-coarse:` variants,
  desktop layout untouched. The store no longer treats any 2xx estop as a clean stop:
  `delivered: false` produces a fifth estop status **`unconfirmed`** — red `role="alert"`
  banner "E-Stop NOT confirmed by the robot … may still be moving, use the hardware
  E-Stop", block events are never suppressed in that state (they are the evidence the robot
  still moves), and the agent's own software-latch broadcast cannot upgrade it back to a
  clean stop (it carries no delivery info). The MSW estop handler mirrors
  `{ ok, stopped, delivered: true }`. ScenePanel's `frameSrc` stays a **documented
  follow-up**: no frame source exists on the wire — scene memory retains no images by
  design — so the prop now says so instead of pretending; the feed lands with the
  camera-streaming task.

App suite after both batches: 57 files / 1113 tests green, typecheck clean.

### Known gaps, unchanged and pre-existing

- **Acceptance criterion 4 ("knows when it has arrived") remains unmet** — this is the
  `BlockOutcome.measured` product call above, not a regression of this round.
- Server vitest fails ~1-in-3 **only in combined runs** ("Parse Error: Expected HTTP/",
  ephemeral-port reuse on macOS); reproduced on `main`, passes standalone (4985 tests).
- The `sim_g1_dds` pytest stage reports SKIPPED on machines without the cyclonedds+mujoco
  venv (`SIM_PYTHON`), per `test-all.sh` policy.
- `agent-mode.spec.ts` asserts the German demo labels (Tisch/Stuhl/Hut) while the pipeline
  contract is English labels — cosmetic demo-data inconsistency, noted for the next touch.

## Follow-ups from the PR #214 review (2026-08-01)

An independent read of `main...feat/agent-mode-lidar-range` found eight items. One was fixed
in the PR before merge (a VLM distance guess could decide contact-arrival, `navigator.ts` —
the `near` test now reads a lidar distance only, pinned by "does not let the vision model's
guess turn a blocked walk into an arrival"). These are the ones left, in severity order.

- **HIGH — scene memory only expires distances for motion Agent Mode itself commanded.**
  `BlockExecutor.driveFor` is the only producer of `noteTranslationM`, and
  `SceneMemoryStore.clear()` has no callers, so Quest teleop or a direct POST to the sidecar
  moves the robot invisibly. Failure: look (table stored at 0.55 m, lidar) → operator takes
  the teleop lock, drives 4 m away, releases → "geh zum Tisch" →
  `hasMovedSinceObservation()` is false, the pre-flight look is skipped, and `goto` returns
  *"Arrived at table after 0 stages"* without moving. The same skip desyncs yaw, so the
  first stage is sized by a clearance measured down a heading the robot has left.
  **Fix:** track `odom.x/odom.y` in `refreshYaw` and feed measured deltas to
  `noteTranslationM`, and/or clear scene memory when the control lock leaves `'agent'`.
  The gap is documented in `navigator.ts` at the pre-flight look — the comment states it
  rather than claiming coverage, so this is a known hole, not a surprise.

- **MED — `x: null` no longer fabricates +52.65°; it fabricates 0°.** `vision.ts` falls back
  to bearing `0` when neither `x` nor `bearingDeg` is usable, and `VisionEntity` has no
  "unplaced" state. For `goto` that is arguably worse than the bug it replaced: 0° needs no
  correction turn, gets lidar-ranged at 0° (the wall dead ahead), is stored as `'lidar'` and
  can end a navigation nose-to-wall. **Fix:** drop the entity, or carry `bearingKnown:
  false` and have `observeAndMerge` skip ranging and the navigator refuse to steer on it.
  Note the two `vision.test.ts` cases that assert `bearingDeg === 0` encode the wrong
  invariant and must change with it.

- **MED — turn >10° then walk is still unclamped.** The clearance expires past the yaw
  tolerance, which makes the new `walk` clamp a no-op for exactly the plan shape that
  matters: `goto-door` fails 3/3 on `gemma4:e2b` as `turn 96° + walk 4.4 m`. The prompt rule
  aimed at it was benched and reverted as noise (51/54 → 51/54, 6 → 5 dashes). The
  deterministic repair is the open option: when a `turn` matches an entity's relative
  bearing *and* the following `walk` matches that same entity's distance, fold the pair into
  one `goto` — two independent numbers off one scene row is a coincidence a genuine "turn
  left and walk 3 m" will not produce. Needs `PlannerInput` to carry structured scene
  targets, which `agent-mode-controller.ts` can supply from `scene.listEntities()`.

- **LOW — dropping the `MIN_STAGE_M` floor is partly defeated by `MIN_DURATION_S`.**
  `walkToCommand` floors duration at 0.2 s, so a 0.001 m stage still commands ~0.08 m. No
  collision path (well inside the 0.45 m margin), but a 0.1 m stage on a real base often
  measures ~0 m, and with `stagesThatMoved === 0` a `goto` to something 0.7 m away can now
  fail outright where it previously overshot. Robot-day observation, not a desk fix.

- **LOW — `forwardClearance` is blind inside 0.35 m and blind reads as unclamped.** "Unknown
  because too near" and "unknown because too far" have opposite costs and are the same
  `null` today. Backstopped by arrival-by-contact.

- **NIT — `scripts/planner-bench.ts` is outside `tsconfig`'s `include` and outside vitest's
  glob**, so it can rot against `Planner`/`SceneMemoryStore` with nothing to catch it. Add a
  `tsconfig.scripts.json` and an `npm run bench:planner`. Its `openLoopDashes` also matches
  only within 0.06 m of a known scene distance (a `walk 4 m` for the 4.4 m door is
  invisible), and it inherits `AGENT_PLANNER_THINKING` without recording it — both worth
  printing in the header before the next A/B.

- **NIT — no integration test drives `Navigator` against a real `BlockExecutor`.** The
  navigator suite runs against `makeWorld`, a good hand-written model that re-derives
  bearings and calls `noteTranslationM` — but if `driveFor` stopped calling it, or blocks
  stopped carrying `measured`, all 32 tests would stay green.

- **NIT — doc drift:** `scene-memory.ts` says `yawDegOverride` is "passed explicitly by
  `scan_room`"; `block-executor.ts` passes `undefined` and relies on `refreshYaw`.
