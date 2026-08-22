---
id: TASK-198
aliases:
- TASK-198
title: Identity — the robot knows what it is and what it has been through
slug: identity-the-robot-knows-what-it-is-and-what-it-has-been-through
status: done
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
- g1
- agentmode
sprint: ''
depends_on:
- '[[TASK-197]]'
due_date: ''
created: 2026-08-02
updated: 2026-08-02
status_note: 'CLOSED 2026-08-02 — merged as part of PR #216 (squashed to 4a9a7f2).
Live on GPU_BOX: the robot answers as "Nova" (Unitree G1 EDU (Dex3-1), operator
Sebastian, site Robot Lab), carries bootId b-a43bf2facdfc at incarnation 249,
and reports plansLast24h / failuresLast24h alongside it. The unnamed-robot path
(asking to be named instead of taking a placeholder) is covered by tests; this
robot was already named, so that branch was not re-walked by hand.'
---


# Identity — the robot knows what it is and what it has been through

## Description

Give the robot a persistent self: it is **Nova**, a specific G1 EDU with 43 DOF and Dex3 hands,
operated by a named person at a named site; this is its **47th incarnation**; it was killed by a
crash 20 minutes ago in aisle 3; it failed two plans yesterday.

Today `ROBOT_NAME` is injected into `prompts/robot_agent.prompt` as a third-person fact, and the
Agent Mode planner never learns the robot has a name at all.

**Scheduled fourth on purpose.** Written first, `IDENTITY.md` is a prettier `ROBOT_NAME` — one
Gemini prompt and one phrasebook string. Written after place and memory, the same file lets the
robot say a sentence *every clause of which is true and checkable*. The strongest empirical result
in the research supports this: in arXiv:2505.19237, removing episodic memory made a robot's
self-assessment oscillate incoherently, and removing the camera made it identify itself as an
aerial drone. **Memory and perception are the self-concept**; the file is just where it is written
down.

## Details

### The wiring problem — read this before scoping

`agent/agent-executor.ts:~219` short-circuits to `executeAgentMode()` **before** the Genkit branch
whenever `agentModeController.isEnabled()` — and the target profile, `dev:g1-edu-agent`, forces
`AGENT_MODE_ENABLED=true`.

So identity routed **only** into `prompts/robot_agent.prompt` lands in a code path that **does not
execute in the configuration this whole line of work is about**. Wiring identity into a path that
actually runs under Agent Mode is a deliverable of this task, not an assumption.

### Design decisions (settled — do not re-litigate during implementation)

| Topic | Decision |
|---|---|
| Split by mutability | Three files, three write policies. This is the one OpenClaw choice worth copying verbatim: a machine that can hurt people must not drift its own persona. |
| `IDENTITY.md` | Label:value ID card, ~400 chars. Tooling writes back **only** `Name`, `Emoji`, `Operator`, `Site`. |
| `SOUL.md` | Voice, tone, boundaries. **Human-authored; the agent never writes it.** Procedures may be self-authored later; persona may not. |
| `BODY.md` | **Generated at every boot** from `embodiment/configs/<tag>.yaml` + `robot/joint-configs/<type>.config.ts`. Header says "generated — do not edit". |
| Config wins | On conflict, **the config wins and the file is rewritten.** `Robot-Id`, `Serial`, `Unit` and everything in `BODY.md` are regenerated at boot. An identity file must never be able to lie about which body it is — this closes both the empty-identity failure and the poisoning path where a rewritten memory convinces the robot it is a different machine. |
| Planner | The block planner (`gemma3:4b`, on the latency path) gets **no identity and no soul**. It gets place and place notes only. Persona goes where there is no navigation to corrupt. |
| Naming | The robot **asks** the operator what to call it on first boot; it does not choose for itself. But see the fleet conflict below. |
| Failure | A missing/garbled `IDENTITY.md` **fails loudly** and re-runs bootstrap. Silently substituting a generic self is Hermes's documented "Amnesia Mode" and is the wrong default for a robot. |

### Robot Agent

**1. `src/agent-mode/identity.ts` (NEW)**

Load/generate the three files in the TASK-197 workspace. `BODY.md` regenerates from the
`embodiment:reloaded` event — `embodiment/embodiment-loader.ts` is already a Zod-validated,
chokidar hot-reloading singleton, so this is a subscription, not a parser.

`BODY.md` content comes straight from `embodiment/configs/g1_edu.yaml`, which already carries the
43-DOF breakdown (12 leg + 3 waist + 14 arm + 14 Dex3), `joint_names`, cameras,
`depth_sensors` (incl. `mid360_lidar`, `d435i`) and `safety { max_speed, workspace, force_limit }`.
**No LLM lifting and no hallucinated capabilities** — the URDF→ontology step is already done in
this repo as YAML.

**2. The sensorium — `SelfState`**

Assembled per turn, **zero tool calls**:

```ts
{ bootId, incarnation: number, uptimeS, lastShutdown: { at, exit: 'sigterm' | 'crash' },
  place, poseSource, batteryPct, controlOwner, damped, estopLatched,
  plansLast24h, failuresLast24h, memoryEntries }
```

Derived from `incarnations.jsonl` (TASK-196) plus the journal (TASK-197) — so it spans restarts,
which is the entire point. This is the cheapest thing that makes a restarted agent feel continuous.

**3. Where it is injected — three places, deliberately not four**

| Surface | Gets |
|---|---|
| `prompts/robot_agent.prompt` (Gemini) | identity + soul + body + sensorium. It already has a `now` field, so it is time-aware; rendered at `agent/agent-executor.ts:~292-302`. |
| `agent-mode/voice-narrator.ts` `PHRASES` | the **name only**, templated — so the robot can say its own name with no LLM call on the 12 s plan-ack path. |
| Agent Mode UI header | `Nova · incarnation 47 · AISLE-3 · recovered from crash` |
| The block planner | **nothing** |

Plus the wiring fix: an identity-aware reply path that runs when Agent Mode is enabled, so
"who are you?" is answerable in the configuration that is actually deployed.

**4. Bootstrap**

First boot with no `IDENTITY.md` → ask the operator for a name → write the file → sync `Name` into
the A2A card via the existing `agent-card.ts:~43 updateAgentCardIdentity` → delete the bootstrap
marker.

**Fleet conflict to resolve here:** the fleet DB owns names. `RobotManager.buildIdentityUpdate()`
re-diffs identity every 30 s and **deletes the agent repository row when the card name changes**.
A robot that names itself creates a name the fleet does not know, which the health check then
overwrites or duplicates. Decide and implement one of: (a) the robot proposes, the server accepts
and becomes authoritative, or (b) the robot is authoritative and `buildIdentityUpdate` learns to
adopt rather than overwrite. **Do not ship the naming ritual without this.**

**5. Agent card — `src/agent/agent-card.ts:~63-141`**

Capabilities and skills are hardcoded and stale. Derive them from the embodiment config and the
actual block vocabulary, so the card stops advertising things the robot cannot do.

### Frontend

`AgentModeState` gains `self: SelfState` (three-file wire change). Render the header line.
`fromCrash` should be visually distinct — it is the one field an operator acts on.

### Key files

| File | Change |
|---|---|
| `robot-agent/src/agent-mode/identity.ts` | NEW — load/generate the three files, `SelfState` |
| `robot-agent/src/embodiment/embodiment-loader.ts` | Subscribe `embodiment:reloaded` → regenerate `BODY.md` |
| `robot-agent/src/agent/agent-executor.ts` | Identity-aware reply path that runs **under Agent Mode** (`:~219`) |
| `robot-agent/src/prompts/robot_agent.prompt` | identity / body / self inputs |
| `robot-agent/src/agent-mode/voice-narrator.ts` | Name in the templated phrases |
| `robot-agent/src/agent/agent-card.ts` | Sync name; derive capabilities from embodiment |
| `server/src/services/RobotManager.ts` | Resolve `buildIdentityUpdate` vs. self-naming |
| type files ×3 + `app/src/features/agentmode/` | `self` in state; header line |

## Test Strategy

**Unit (vitest).**

- `BODY.md` regenerates from a stub embodiment config; changing `force_limit` in the YAML changes
  the file; it is **never** hand-written.
- Config beats file: an `IDENTITY.md` claiming a different `Robot-Id` is overwritten at load.
- Missing `IDENTITY.md` ⇒ bootstrap re-runs; **garbled** `IDENTITY.md` ⇒ loud failure, not a
  silent generic self.
- `SOUL.md` is never written by any agent-reachable code path — assert on the write chokepoint.
- `SelfState` computes `incarnation` and `lastShutdown.exit` correctly from a fixture
  `incarnations.jsonl`, including a missing `endedAt` ⇒ `'crash'`.
- The block planner prompt contains **no** identity or soul text (regression test — this will be
  tempting to "fix" later).

**Integration (sim, no robot) — the demo.**

Under `dev:g1-edu-agent` (Agent Mode **on**, i.e. the path that actually ships):

> *"who are you?"* → **"I am Nova, a Unitree G1 EDU with 43 joints and Dex3-1 hands. This is my
> 47th start; the last one ended in a crash in aisle 3, twenty minutes ago."**

Then verify each clause independently: the DOF count against `g1_edu.yaml`, the incarnation number
against `incarnations.jsonl`, the crash against a `kill -9`, the place against TASK-195.

## Out of scope

- Self-authored skills / procedure learning.
- Personality overlays per mission.
- Binding identity to the device certificate — `device-identity.ts:~133` is **per-OS-user**, so
  the three agents on this box (41243 / 41244 / 41246) share one cert. Do not build the identity
  story on it.
