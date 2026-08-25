---
id: TASK-218
aliases:
- TASK-218
title: The test suites have a scheduling-sensitive contention flake
slug: the-server-suite-has-a-supertest-contention-flake
status: done
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on: []
due_date: ''
created: 2026-08-22
updated: 2026-08-25
---


# The server suite has a supertest contention flake

## Description

Roughly one run in three of the full server vitest suite fails a single
route test that passes in isolation and passes on the next run. It is not
always the same test. A suite that is red at random teaches everyone to re-run
it, which is how a real failure gets re-run away.

## Details

### What is observed

Seen across TASK-215, TASK-216 and TASK-217, always the same shape: one test
in one `src/__tests__/*-routes.test.ts` file fails with a status mismatch —
typically `expected 404 to be 200` — while the same file passes on its own.

Most recent occurrence (2026-08-22, TASK-217):

```
FAIL src/__tests__/teleoperation-routes.test.ts
  > PUT /api/teleoperation/sessions/:id > updates session metadata
AssertionError: expected 404 to be 200
```

`npx vitest run src/__tests__/teleoperation-routes.test.ts` → 44 passed.
`npx vitest run` immediately after → 205 files, 5344 passed.

Second occurrence (2026-08-23, TASK-217 review):

```
FAIL src/__tests__/aggregation-routes.test.ts
  > POST /api/federated/rounds/:roundId/submit > returns 409 when the robot
    already submitted (conflict)
Error: ETIMEDOUT: Operation timed out          (7796 ms)
```

This one **also failed when the file was run on its own**, and then passed on
the next full run. So "passes in isolation" — written into the first note above
— is not reliably true, and mock-state leaking between FILES is not the whole
story. A `supertest` request that never completes points at the request itself
(an unawaited handler, a listener that is never closed) rather than at a
handler returning the wrong body. Reproduce by running one file in a loop, not
only the whole suite.

Third occurrence (2026-08-23, VR teleop work) — and this one is in the
**robot-agent** suite, not the server's:

```
FAIL src/api/__tests__/agent-mode-routes.test.ts
  > POST /agent-mode/intents arms an intent that the matcher then fires
AssertionError: expected 401 to be 201
```

Measured rate on `main` with NO local changes: **1 failure in 5 full runs**
(1898 tests). The file passes on its own. It was first noticed while adding a
test file elsewhere in the agent — which changed how vitest distributes files
across workers and made it show up twice in three runs — so the flake is
scheduling-sensitive, not caused by any one change.

The 401 narrows this one down further than the server's 404s do. That route is
behind `personalDataGate` (`router.use('/robots/:id/agent-mode/intents', …)`),
and with no `AGENT_MEMORY_TOKEN` set the gate answers 401 to any caller it
cannot prove is loopback:

```ts
if (!isLoopbackAddress(req.socket.remoteAddress)) { res.status(401)… }
```

`isLoopbackAddress(undefined)` is `false`. All three test files that stub
`AGENT_MEMORY_TOKEN` do call `vi.unstubAllEnvs()` in `afterEach`, so an env leak
is ruled out — which leaves `req.socket.remoteAddress` being momentarily
undefined on a socket under load as the candidate worth measuring first. These
tests drive a REAL listening server with `fetch`, not supertest, so socket
lifetime is genuinely in play.

**Do not "fix" this by loosening the gate.** If the address really can be
unreadable, the gate should say so with a distinct code rather than treat it as
"off-box", and the test should stop racing its own server.

### Why the status code is the clue

A 404 from these handlers means the mocked service returned null/undefined for
a record the test had just arranged. That points at mock state leaking across
files rather than at anything in the handler: every one of these suites builds
its own express app and `vi.mock`s the service module, and vitest shares a
worker between files unless told otherwise.

The 404 shape and the ETIMEDOUT shape may be two different faults; treat the
timeout as the more informative one, since a request that never returns is a
narrower thing to look for.

Two candidates, both cheap to test:

1. **Module registry reuse.** `vi.mock` factories are hoisted per file, but a
   module already evaluated in the worker is not re-evaluated, so a singleton
   captured at import time (`datasetService`, `teleoperationService`, …) can be
   the one another file's `vi.clearAllMocks()` has just emptied. `restoreMocks`
   / `mockReset` in `vitest.config.ts`, or `isolate: true` for `src/__tests__`,
   would settle it.
2. **A shared Prisma or in-memory store.** Several route tests mock the service
   but not the repository underneath, so two files can share one store.

### Key files

- `server/vitest.config.ts` — pool and isolation settings
- `server/src/__tests__/teleoperation-routes.test.ts` — most recent victim
- `server/src/__tests__/dataset-annotations-routes.test.ts`,
  `dataset-flag-routes.test.ts`, `curation-routes.test.ts` — same shape, same
  mocking pattern; whatever fixes one should fix all

## Test Strategy

Reproduce first: `npx vitest run --sequence.shuffle` a few times, or run the
full suite in a loop and record which file fails. A fix that cannot be shown to
change the failure rate has not been shown to be a fix.

Then: run the full suite 20 times and require 20 clean runs. Anything less is
the same problem with a smaller number.

## Notes

Filed from TASK-217, where it cost a wrong first read of `./scripts/test-all.sh`
output — the run reported a failure that a clean re-run did not have.

## Resolution (2026-08-25)

Three separate faults, not one. Measured on an otherwise idle 18-core macOS box,
one suite at a time.

### 1 — The wrong process answers the test (the 401s and every ETIMEDOUT)

`listen(0)` with no host binds the DUAL-STACK wildcard `::`, and macOS picks the
port by looking for a free one in the IPv6 table. A port another process already
holds on **IPv4** is therefore handed out as free: the bind succeeds and
`address().port` reports it, but the IPv4 connect that follows — supertest always
talks to `127.0.0.1`, and so do the robot-agent route tests — is delivered to the
OTHER listener.

Proven, not inferred. Every failing request was logged with the response it got:

- `127.0.0.1:63655` is **tailscaled's LocalAPI**, which answers `401 auth
  required` to every path. The failures carried `tailscale-version: 1.102.2`
  response headers. That is the whole of the `expected 401 to be 200/400/500`
  shape, and of the robot-agent's `expected 401 to be 201`.
- `*:63200` was an **ownerless orphan socket** (present in `netstat`, absent from
  `lsof`) that never `accept()`s. Connects to it sat in SYN_RCVD until they gave
  up: `ETIMEDOUT: Operation timed out`, which is supertest's rendering of a
  `connect` ETIMEDOUT.

A sweep confirms the mechanism and the fix: wildcard `listen(0)` drew both
poisoned ports within 6000 attempts; `listen(0, '127.0.0.1')` drew neither in
6000. An explicit `bind(127.0.0.1, 63200)` is refused with EADDRINUSE, so the
kernel does see the conflict — only the port-0 allocator on `::` misses it.

Fix: `server/vitest.setup.ts` and `robot-agent/vitest.setup.ts`, wired in via
`setupFiles`. They turn an ephemeral wildcard `listen()` into a loopback bind.
The bind has to stay SYNCHRONOUS because supertest reads `address().port` on the
line after `app.listen(0)`, and the public `listen(0, host, …)` defers on a
`dns.lookup` tick even for a literal IP — so it goes through `_listen2`, which is
where Node's own `listen()` lands once it has a resolved address.
`loopback-listen.test.ts` in each package guards the shim.

**The hypotheses in this task were wrong, and worth recording as wrong:**
mock state does not leak across files, no singleton survives another file's
`clearAllMocks`, and `req.socket.remoteAddress` is never undefined.
`personalDataGate` was never involved — the 401 came from tailscaled, not from
the gate, and the gate is untouched.

### 2 — Fake timers racing real disk I/O (`EpisodeRecorder.test.ts`)

A recorder tick writes a real JPEG, and a tick that fires while the previous one
is still writing is dropped on purpose. Tests that advanced a fixed 200/400/600
ms of fake time and then assumed frames existed got none under load. One test
also sampled a frame count while a tick was mid-write, so a straggler landed
during the `discardEpisode` under test and put the frame back.

Fix: `runUntilFrames` waits for the frames a test needs (and says why if they
never arrive) and `quiesce` parks the recorder and drains in-flight I/O before a
count is read. `leaves no image behind …` now collects drop reasons as they
appear instead of reading `lastDropReason` once at the end, where a later
"behind" drop had overwritten it.

### 3 — A detached import outliving its test (`HuggingFaceImportService`)

`retryImport` resolves once the row is claimed and lets the download run
detached. The test returned while it was still writing, and the next test's
`beforeEach` deleted that directory underneath it: `ENOTEMPTY … rmdir …/meta`,
landing on whichever test happened to be next. Fix: the test now `settle`s on the
`validating` write, which the service does after the last file.

### Before / after

| suite | before | after |
| --- | --- | --- |
| `server` | 18 failed runs in 96 (19%) | 0 in 75 |
| `robot-agent` | 3 failed runs in 31 (10%) | 0 in 50 |

"After" counts only runs on the final tree, and includes shuffled ones
(`--sequence.shuffle.files`, which is what redistributes files across workers).

### Residual uncertainty

- Fault 1 is **environment-dependent by nature**: it needs a foreign IPv4
  listener sitting in the ephemeral range. A clean CI container has no
  tailscaled and no orphan socket, so this flake may never have fired in CI at
  all, and CI green does not re-test the fix. The shim is preventive there.
- The shim leans on `net.Server.prototype._listen2`, which is internal. It
  degrades to stock behaviour if a future Node removes it, and
  `loopback-listen.test.ts` fails loudly when that happens.
- Faults 2 and 3 are load-dependent, so their rate is a property of this
  machine's core count and disk. Both fixes replace a timing assumption with a
  wait for the condition under test, which is not machine-specific — but the
  measured "0 failures" is.
