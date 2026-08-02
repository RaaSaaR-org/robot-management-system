---
id: TASK-197
aliases:
- TASK-197
title: Memory workspace — the robot remembers across restarts
slug: memory-workspace-the-robot-remembers-across-restarts
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- g1
- agentmode
- compliance
sprint: ''
depends_on:
- '[[TASK-195]]'
due_date: ''
created: 2026-08-02
updated: 2026-08-02
status_note: 'CLOSED 2026-08-02 — merged as part of PR #216 (squashed to 4a9a7f2).
Workspace, per-robot-id memory and the GDPR erasure route
(RobotMemoryErasureService, DELETE /api/v1/robots/:id/memory) ship and are
covered by their unit tests. Stated plainly rather than implied: the erasure
route was NOT re-exercised by hand in the 2026-08-02 warehouse session, which
drove place awareness, the geofence and the cockpit. It is closed on the merge
and its tests, not on a fresh manual GDPR run.'
---


# Memory workspace — the robot remembers across restarts

## Description

Give the robot a **durable, file-based memory** that survives a restart: what it did and how it
went (episodic), what is true about each place (semantic, place-keyed), and what the operator
explicitly told it to remember.

Today the only durable robot-side artifacts are battery/location/task-queue, a device keypair and
a version file. Scene entities are pruned at **15 minutes** and everything dies with the process.

The design is **files, not a database** — deliberately. The robot has no Prisma, the server being
down must never stall a block (that is already Agent Mode's contract: `ServerMirror` swallows every
transport error by design), and files are git-diffable and human-correctable, which is what a fleet
operator will actually ask for.

## Details

### Design decisions (settled — do not re-litigate during implementation)

| Topic | Decision |
|---|---|
| Storage | Plain files under `robot-agent/data/workspace-<robotId>/`, following the per-robot naming of `data/state-<robotId>.json`. **Not** the per-OS-user convention used by `device-identity.ts:133` — three agents on this box share one device cert, which is a documented landmine. |
| Trust tiering | Every record carries `trust: 'self' \| 'operator' \| 'untrusted'`. **Only `self`/`operator` may ever be promoted into durable memory** — enforced in code at a single chokepoint, not by prompt. |
| Overflow | A write that would exceed a cap **returns an error listing current entries**, so the model must consolidate in the same turn. Do **not** silently truncate — OpenClaw does, and an agent that behaves as if it forgot things still visibly on disk is a genuinely confusing failure mode. |
| Write paths | Exactly three: automatic journal tee, an explicit `remember` block, and (later) consolidation. **No inferred commitments.** OpenClaw shipped automatic follow-up extraction and *retired* it; the robot equivalent — "I think you wanted me to tidy the lab" — on a 35 kg humanoid is strictly worse than the text version. |
| Retrieval | Deterministic and place-keyed. **No embeddings on the robot.** On entering a place, load that place's note and inject a ≤400-char excerpt. `recall` is deliberately **not** a block — retrieval is injection, a 4B planner cannot be trusted to plan a retrieval step, and a missed recall must not become a failed plan. |
| Server | **None in v1.** No Prisma model (it would have to join the multi-tenancy `$extends` allowlist), read-through endpoints only. |
| PII | v1 stores no camera imagery and no identified persons. It *does* store operator-authored text, which is personal data — see the GDPR section, which is a **requirement of this task**, not a follow-up. |

### Blocker — fix before writing any file

`.env.g1-edu` and `.env.g1-edu-sim` **both** set `ROBOT_ID=g1-edu-4` and `PORT=41244`. Since the
workspace path is `workspace-<robotId>/`, the sim and the real robot would share one memory — the
sim would teach the real robot things. Fix the env collision in this task; it is not a note.

### Layout

```
robot-agent/data/workspace-<robotId>/
  MEMORY.md              # curated durable memory, hard cap 8 KB
  AGENTS.md              # operating rules / safety SOP, agent-immutable
  places/_index.json     # TASK-195 place graph
  places/AISLE-3.md      # per-place notes, hard cap 4 KB each
  journal/2026-08-02.jsonl
  incarnations.jsonl     # TASK-196
```

`IDENTITY.md` / `SOUL.md` / `BODY.md` land here too, in TASK-198.

**Gitignore correctly.** `robot-agent/.gitignore` contains only `data/pointclouds-real/`; the state
rule lives in the **root** `.gitignore:56` as `robot-agent/data/state*.json`, which does **not**
match `workspace-*/`. Add the rule or the workspace gets committed.

### Robot Agent

**1. `src/agent-mode/workspace.ts` (NEW)**

Path resolution, dir creation, atomic write, capped append, and **the promotion chokepoint**:

```ts
promote(record: JournalRecord, target: 'memory' | 'place'): Result
```

One function, one place where trust is checked, with a test asserting an `untrusted` record can
**never** reach `MEMORY.md` or a place note. This is the anti-poisoning spine — retrofitting it
after months of untagged content never quite works.

**2. `src/agent-mode/journal.ts` (NEW)**

Append-only JSONL, daily rollover, read-last-N-days, prune at 30 days.

```jsonc
{"t":"2026-08-02T…","bootId":"b-7f3a","kind":"block","planId":"…","block":"walk",
 "ok":true,"measured":{"distanceM":0.98},"place":"AISLE-3",
 "pose":{"x":-4.2,"y":3.1,"yawDeg":91,"source":"odometry"},
 "trust":"self","msg":"Walked 0.98 m forward"}
```

Tee it from `server-mirror.ts:~78 logBlock()`, which already builds exactly this record — so this
is a tee, not a new instrumentation pass. Write to the journal **before** the network call, and
keep the network call fire-and-forget.

**3. The `remember` block**

- `types.ts` `AgentBlockKinds` gains `'remember'` — **three-file wire change** (robot-agent →
  server → app).
- `planner.ts coerceParams()` validates `{ text: string (≤240 chars), scope: 'place' | 'global' }`.
- `prompts.ts buildPlannerPrompt` gains **one rule line**: *"remember / merk dir / memorize X →
  emit one `remember` block"*. Budget it; `gemma3:4b` prompt length is a measured regression risk
  in this repo and `planner.test.ts` is the gate.
- `block-executor.ts` gains a handler in the same never-throws `BlockOutcome` shape. It appends
  `- YYYY-MM-DD (operator) <text>` to `places/<placeId>.md` or `MEMORY.md`.
- Overflow ⇒ `ok: false` with the current entries in the message.

**4. Retrieval — one call site**

`agent-mode-controller.ts:~790 plannerSceneSummary()` is the single existing memory→prompt funnel
(TASK-195 already added the place line there). Add a `What you know about this place` section,
≤400 chars, loaded on place change or at plan start.

Cross-place recall is a substring/keyword scan over `MEMORY.md` + the last 7 journal days, exposed
as a **tool to the Gemini conversational agent**, not to the block planner.

**5. Endpoints — `src/api/rest-routes.ts:~1158-1170`**

`GET /api/v1/robots/:id/memory` and `/memory.md`, beside the existing `/scene` and `/scene.md`.
Mirror a digest as `agent:memory:updated` over `ServerMirror` so the app can render it.

### GDPR — required in this task

A place note in a customer facility is personal data on a device that has **no Prisma and no
erasure hook**: `GDPRRequestService.eraseUserData()` (~`:632-700`) deletes and pseudonymises rows
keyed by `userId` and nothing else. The moment a workspace file exists on a robot at a customer
site, this platform's Article 17 story is false for that data — on a product whose pitch is the
compliance machinery.

Ship, in this task:

- `DELETE /api/v1/robots/:id/memory` — wipes the workspace (identity files excluded).
- A robot-agent erasure handler reachable from `GDPRRequestService`, so a subject-erasure request
  reaches the fleet rather than stopping at the database.
- A retention cap on the journal that is **derived from the existing `RetentionPolicy`** where one
  is configured, rather than a second hardcoded 30-day regime running in parallel to
  `ComplianceLog.retentionExpiresAt` / `LegalHold`.

Note while scoping: `ServerMirror.logBlock()` already writes `parameters: { command, ...block.params }`
into the compliance log — the operator's raw utterance and every `speak` text included. So durable
episodic text **already leaves this robot today**. The journal is a second copy of an existing data
category, minus the AES-256-GCM, minus the hash chain, minus `retentionExpiresAt`. Treat it as
sensitive accordingly; the "it's just a tee, it's free" framing is wrong.

### Key files

| File | Change |
|---|---|
| `robot-agent/src/agent-mode/workspace.ts` | NEW — paths, capped/atomic writes, promotion chokepoint |
| `robot-agent/src/agent-mode/journal.ts` | NEW — JSONL append, rollover, prune |
| `robot-agent/src/agent-mode/server-mirror.ts` | Tee `logBlock()` into the journal before the network call |
| `robot-agent/src/agent-mode/types.ts` + server + app types | `'remember'` block kind (wire change) |
| `robot-agent/src/agent-mode/planner.ts` | `coerceParams` for `remember` |
| `robot-agent/src/agent-mode/prompts.ts` | One planner rule + the place-notes section |
| `robot-agent/src/agent-mode/block-executor.ts` | `remember` handler |
| `robot-agent/src/agent-mode/agent-mode-controller.ts` | Place notes into `plannerSceneSummary()` |
| `robot-agent/src/api/rest-routes.ts` | `/memory`, `/memory.md`, `DELETE /memory` |
| `robot-agent/.env.g1-edu*` | Resolve the `ROBOT_ID` / `PORT` collision |
| root `.gitignore` | `robot-agent/data/workspace-*/` |
| `server/src/services/GDPRRequestService.ts` | Reach the robot workspace on erasure |

## Test Strategy

**Unit (vitest).**

- **Promotion gate:** an `untrusted` record can never reach `MEMORY.md` or a place note — assert
  directly, and assert it again through the `remember` path.
- Overflow returns `ok: false` **and leaves the file intact on disk**.
- Caps enforced per-file (8 KB memory, 4 KB place).
- Journal rollover at midnight; prune at the retention boundary; a `LegalHold` suppresses pruning.
- `coerceParams` rejects `text` > 240 chars and unknown `scope`.
- Retrieval excerpt is ≤400 chars and place-scoped.
- `planner.test.ts` passes unchanged (prompt-length regression gate).
- Erasure removes place notes and journal but **not** `AGENTS.md`.

**Integration (sim, no robot) — the demo.**

1. *"remember that the pallet at the end of aisle 3 blocks the turn"* → a `remember` block runs,
   `places/AISLE-3.md` gains a dated `(operator)` line.
2. **Restart the robot-agent.**
3. Walk into aisle 3 → the planner prompt carries the note and the robot volunteers it.
4. Feed a VLM caption claiming something durable → it appears in the journal as `untrusted` and
   is **absent** from `MEMORY.md`.
5. `DELETE /memory` → the note is gone; the robot no longer volunteers it.

## Out of scope

- Consolidation / "dreaming" — only worth building once there are weeks of journal. Later task.
  When it lands it needs the 25%-prior-entry-loss refusal with append-only fallback.
- Embeddings, vector search, cross-robot memory sharing.
- Speaker identification. Until it exists, the stack cannot tell an operator's voice from a
  bystander's — treat spoken `remember` as `operator` **only** while the robot is in an
  operator-present state, and write that assumption down in `AGENTS.md`.
