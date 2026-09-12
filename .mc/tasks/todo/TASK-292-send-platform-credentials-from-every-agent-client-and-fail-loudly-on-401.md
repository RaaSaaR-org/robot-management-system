---
id: "TASK-292"
aliases: []
title: "Send platform credentials from every agent client and fail loudly on 401"
slug: "send-platform-credentials-from-every-agent-client-and-fail-loudly-on-401"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, robot-agent, server]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Send platform credentials from every agent client and fail loudly on 401

## Description

Four live robot-agent HTTP clients — the OTA update check, the zone fetch, the peer poll and the task-status report — send no `Authorization` header and treat the resulting 401 as "nothing to report". Add `platformAuthHeaders()` at each call site the way the six working clients do, stop the zone fetch inventing a destination when it cannot read the zone list, and make an authorization rejection visible — a distinct error log, a recorded rejection on the agent's health endpoint, and no fabricated success — without ever crashing a robot in the field.

## Details

### Current state

**The worst symptom is not a failure, it is a fabricated success.** `robot-agent/src/tools/navigation.ts:233` — `resolveDestination`'s `'zone' in destination` branch — returns a made-up `{ x: 25, y: 25, zone, floor: '1' }` when the zone name does not resolve, and `moveToLocation` then reports `success: true` with `targetLocation` at (25, 25). **The robot drives to an invented spot and claims it arrived.** Changing that branch is part of this task; adding the header alone would leave it in place.

`robot-agent/src/utils/platform-auth.ts:10` — `platformAuthHeaders(authToken = process.env.NEODEM_SERVICE_TOKEN ?? '')` returns `{ Authorization: 'Bearer <t>' }`, or `{}` when the var is empty (`:13`); a missing credential is silent by design. Six clients use it correctly: `ComplianceLogClient.ts:175,:223,:363,:419`, `platform-registration.ts:16`, `server-mirror.ts:110,:143`, `patrol.ts:194`, `place-graph-source.ts:116`, plus the explicit-token variants `host.ts:239` and `journal.ts:318`.

Four do not:

- `robot-agent/src/updates/SecureUpdateClient.ts:88` — `fetch(url)`, no init object
- `robot-agent/src/updates/SecureUpdateClient.ts:135` — the same
- `robot-agent/src/tools/navigation.ts:78`
- `robot-agent/src/agent-mode/peers.ts:235` — `fetchImpl(this.url, { signal })`
- `robot-agent/src/robot/TaskQueue.ts:193` — PUT with only `Content-Type`

All four targets sit behind `authMiddleware` — `server/src/app.ts:209` (`/api/robots`), `:230` (`/api/zones`), `:236` (`/api/processes`), `:368` (`/api/updates`) — which 401s at `server/src/middleware/auth.middleware.ts:250-254` when no bearer token is present and `AUTH_DISABLED` is not `'true'` (`:236`).

With auth on, each client swallows the 401 differently, and none of them says so usefully:

- `checkForUpdates` warns and returns `[]` (`SecureUpdateClient.ts:90`), so the 4-hourly check started at `robot-agent/src/index.ts:529` reports "no updates" forever. Note its result is **logged and discarded** by its only consumer `startPeriodicChecks` (`:109-113`), and nothing calls `downloadUpdate`/`applyUpdate` automatically — so this is a log line, not a stalled installer.
- `fetchZones` returns the (empty) cache (`navigation.ts:81`). **The non-ok branch at `:79-82` never seeds `FALLBACK_LOCATIONS`** — only the catch at `:107-109` does — so after a 401 `cachedNamedLocations` stays `{}`. `home` still works, but via `getHomeLocation()`'s own fallback (`:155-158`) and `getChargingStationLocation()` (`:147-150`), **not** because a named location exists.
- `PeerTracker` is only *partly* silent: the catch already sets `lastError: 'HTTP 401'`, logs once per 60 s (`peers.ts:249-252`), and the controller surfaces it via `peerStatus()` (`agent-mode-controller.ts:1337`). The missing pieces are the credential itself and an unthrottled first auth error — not the whole reporting path.
- `TaskQueue` logs one `console.error` (`:200`) and the server row stays `executing`.

Invisible in CI: `helm/neodem/values.yaml:150` ships `authDisabled: "true"`, and `server/src/__tests__/setup.ts:9` plus `server/vitest.config.ts:16` force it on for the server suite. The auth-on configuration is the one `docs/demo-day.md:38` and `robot-agent/.env.example:32` describe.

### Robot Agent

**1. `src/utils/platform-auth.ts`** — add, next to `platformAuthHeaders`:

- `isAuthRejection(status: number): boolean` → `status === 401 || status === 403`.
- A module-level recorder: `recordPlatformAuthRejection(client: string, status: number, url: string): void` and `lastPlatformAuthRejection(): PlatformAuthRejection | null` (`{ at: ISO string, client, status, url, tokenConfigured: boolean }`; `tokenConfigured` is `Boolean(process.env[SERVICE_TOKEN_ENV])`). Named exports, keep the existing `@file` header style.

**2. Add the header at each of the four sites**, per-site, matching `ComplianceLogClient.ts:175`:

- `src/updates/SecureUpdateClient.ts:88` and `:135` — add `{ headers: platformAuthHeaders(), signal: AbortSignal.timeout(10_000) }`.
- `src/tools/navigation.ts:78` — add `{ headers: platformAuthHeaders() }`.
- `src/agent-mode/peers.ts:235` — add `headers: platformAuthHeaders()` to the existing init object.
- `src/robot/TaskQueue.ts:193` — spread into the existing headers: `{ 'Content-Type': 'application/json', ...platformAuthHeaders() }`.

**Do not introduce a shared fetch wrapper.** Ten call sites already follow the per-site pattern, and `platform-auth.ts:9` documents a rule — "never apply these headers to sidecar, model, or arbitrary resource URLs" — that a wrapper would blur. A wrapper would also touch all ten existing sites plus their tests; if anyone wants one, it is its own task.

**3. Loud failure, per client — never throw out of a periodic path:**

- `checkForUpdates` (`:89-92`): on `isAuthRejection`, `console.error` naming the status and, when `tokenConfigured` is false, `NEODEM_SERVICE_TOKEN`; `recordPlatformAuthRejection('SecureUpdateClient', …)`; still return `[]`.
- `downloadUpdate` (`:136-138`): keep throwing, but name the cause on a 401/403 and record it.
- `fetchZones` (`:79-82`): on a non-ok response, seed `cachedNamedLocations` from `FALLBACK_LOCATIONS` when empty (the catch branch at `:107-109` already does this); on `isAuthRejection`, log at `error` and record. **Then fix the fabricated coordinate:** `resolveDestination` (`:228-234`) must not invent `{x:25,y:25}` for a zone the server never confirmed — return a failure that `moveToLocation` reports as `success: false` with a message naming that zones could not be read.
- `peers.ts` `pollOnce` catch (`:245-254`): on a 401/403 log once at `error` level **bypassing the 60 s throttle** (`:249`), and record the rejection; `lastError` already flows out through `agent-mode-controller.ts:1337`.
- `TaskQueue.reportTaskStatus` (`:199-203`): on a 401/403 log at `error` naming the credential and record. **No retry queue in this task** — repairing the server's stuck `executing` row is separate work.

**4. Surface it**: `src/api/rest-routes.ts:342` (`GET /health`, served at `/api/v1/health`) adds `platformAuth: { ok: lastPlatformAuthRejection() === null, lastRejection: lastPlatformAuthRejection() }`. Leave the top-level `/health` in `src/index.ts:360` alone — it is the Docker healthcheck.

### Server

No production change. `server/src/app.ts` already mounts all four prefixes behind `authMiddleware`; verified at `:209`, `:230`, `:236`, `:368`.

Test-only addition: a new `server/src/__tests__/agent-endpoints-auth.test.ts` proving the four agent-facing prefixes reject an unauthenticated request when auth is on. Copy the shape of `server/src/__tests__/camera-stream-ticket.test.ts` exactly — `vi.resetModules()`, `process.env.AUTH_DISABLED = 'false'`, `process.env.JWT_SECRET = '<test secret>'` in `beforeEach`, then `await import('../middleware/auth.middleware.js')` (the middleware reads the env at call time but `authService` captures `JWT_SECRET` at import, which is why the re-import matters — see the docstring at `camera-stream-ticket.test.ts:11-17`). Mount the real `authMiddleware` in front of stub routers at `/api/zones`, `/api/updates`, `/api/processes`, `/api/robots`, as `mountApp` does at `camera-stream-ticket.test.ts:38-56`, and assert 401 with no `Authorization` header.

Do not touch `server/src/__tests__/setup.ts` — its global `AUTH_DISABLED='true'` stays; this file overrides per-test the way `camera-stream-ticket.test.ts:63` does.

**Key files:**
- `robot-agent/src/utils/platform-auth.ts` — add `isAuthRejection` + the rejection recorder
- `robot-agent/src/updates/SecureUpdateClient.ts` — headers at `:88` and `:135`, loud 401
- `robot-agent/src/tools/navigation.ts` — headers at `:78`, fallback seeding, no fabricated (25,25)
- `robot-agent/src/agent-mode/peers.ts` — headers at `:235`, unthrottled first auth error
- `robot-agent/src/robot/TaskQueue.ts` — headers at `:193`, loud 401 on the status report
- `robot-agent/src/api/rest-routes.ts` — expose `platformAuth` on `GET /health` (`:342`)
- `robot-agent/src/utils/__tests__/platform-clients.test.ts` — extend the real-socket harness to all four clients
- `robot-agent/src/updates/__tests__/SecureUpdateClient.test.ts` — fix the single-argument fetch assertion at `:63-65`
- `robot-agent/src/compliance/ComplianceLogClient.ts` — read-only, the header pattern at `:175`
- `robot-agent/src/agent-mode/patrol.ts` — read-only, the cache-preserving 401 pattern at `:192-205`
- `server/src/__tests__/agent-endpoints-auth.test.ts` — new, auth-on 401 guard for the four prefixes
- `server/src/__tests__/camera-stream-ticket.test.ts` — read-only, the `AUTH_DISABLED=false` test pattern

## Acceptance Criteria

- [ ] Every `fetch`/`fetchImpl` call to a `config.serverUrl` path in `robot-agent/src/updates/SecureUpdateClient.ts`, `src/tools/navigation.ts`, `src/agent-mode/peers.ts` and `src/robot/TaskQueue.ts` passes `platformAuthHeaders()`, and no sidecar/model/hardware client gained the header.
- [ ] `robot-agent/src/utils/__tests__/platform-clients.test.ts` drives all four clients against its real loopback `node:http` server and asserts every call carried `Bearer ${token}`.
- [ ] With that harness set to reject, the same test asserts each client's loud reaction: `checkForUpdates` logs an error and returns `[]`, `downloadUpdate` rejects with a message naming HTTP 401, `PeerTracker.status().lastError` is `'HTTP 401'`, `TaskQueue`'s status report logs an error, and `lastPlatformAuthRejection()` is non-null.
- [ ] After a 401 on the zone fetch, `moveToLocation({ zone: 'Warehouse A' })` returns `success: false` with a message naming the unreadable zone list, **never** a location of (25, 25), while `getHomeLocation()` and `getChargingStationLocation()` still return the `FALLBACK_LOCATIONS` entries.
- [ ] `GET /api/v1/health` on the agent returns `platformAuth.ok === false` and a `lastRejection` naming the client, status and URL after any authorization rejection, and `ok === true` before one.
- [ ] `server/src/__tests__/agent-endpoints-auth.test.ts` runs with `AUTH_DISABLED='false'` and asserts 401 on `/api/zones`, `/api/updates`, `/api/processes` and `/api/robots` when no `Authorization` header is sent.
- [ ] `cd robot-agent && npm run typecheck && npx vitest run` and `cd server && npm run typecheck && npx vitest run` are green, including the updated `SecureUpdateClient.test.ts` fetch assertion.
- [ ] No code path added here throws out of a timer or exits the process: with `NEODEM_SERVICE_TOKEN` unset against an auth-on server the agent keeps serving, keeps driving, and only logs.

## Test Strategy

The mocked seams, named:

1. `robot-agent/src/updates/__tests__/SecureUpdateClient.test.ts:32-33` stubs global `fetch` (`vi.stubGlobal('fetch', mockFetch)`), and `:63-65` asserts `expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/api/updates?status=approved')` — a **single-argument** assertion. It passes today precisely because there is no init object, i.e. **the test encodes the bug**. It will fail the moment headers are added; update it to assert the URL *and* `{ headers: { Authorization: 'Bearer …' } }`.
2. `robot-agent/src/robot/__tests__/TaskQueue.test.ts:12` — `vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))`. Every status report "succeeds" regardless of headers or status code.
3. `robot-agent/src/agent-mode/__tests__/peers.test.ts:29-45` builds the tracker with an injected `fetchImpl` stub (and `peers-plumbing.test.ts` feeds `ingest()` directly), so no request ever leaves the process.
4. **`robot-agent/src/tools/navigation.ts` has no test at all** — there is no `robot-agent/src/tools/__tests__/` directory and nothing under `src/**/*.test.ts` imports `tools/navigation`. That absence is the seam for the zone fetch and the fabricated destination.
5. **There is no integration test anywhere that runs the agent against the server with auth enabled.** The server suite forces `AUTH_DISABLED='true'` globally (`server/src/__tests__/setup.ts:9`, `server/vitest.config.ts:16`); the only auth-on server test is `server/src/__tests__/camera-stream-ticket.test.ts:63`, which never involves an agent client.

**What replaces them:**

- Extend `robot-agent/src/utils/__tests__/platform-clients.test.ts` — the one harness in the repo that is *not* a mock: a real `node:http` server on 127.0.0.1 (`:35-55`) that 401s whenever `req.headers.authorization !== 'Bearer ' + token` (`:38`). Add the four clients to it, constructed against `baseUrl`: `new SecureUpdateClient('robot-1', baseUrl)`; `getNamedLocation()` from `tools/navigation.js` (stub `config.serverUrl` to `baseUrl`, and call `clearZoneCache()` between tests); `new PeerTracker({...})` with **no** `fetchImpl` so it uses global fetch; and a `TaskQueue` driven through one pushed task (copy the `createMockState`/`createMockTask` factories from `TaskQueue.test.ts:19-58`). Serve `/api/updates`, `/api/zones`, `/api/robots/robot-1/peers` and `/api/processes/tasks/:id/status` from the harness's URL switch. Assert the header on the happy path and the per-client loud behaviour with `rejectRequests = true`, following the existing rejection tests at `:80-87` and `:124-133`.
- Add `server/src/__tests__/agent-endpoints-auth.test.ts` for the `AUTH_DISABLED`-unset half, patterned on `camera-stream-ticket.test.ts`.
- Manual, once, before merge: `cd server && AUTH_DISABLED=false npm run dev` with a service account token in `robot-agent/.env`, then `curl localhost:41243/api/v1/health` shows `platformAuth.ok: true`; blank the token and it flips to false with a `lastRejection`.

## Notes

**TASK-282 makes the service account role `member` mandatory.** It puts a member-or-above guard on `/api/processes` and `/api/robots`, and `TaskQueue.ts:193` PUTs `/api/processes/tasks/:id/status`. A service account minted as `viewer` will 403 on these same writes once that lands — which is the correct outcome, since they are fleet writes. The newly-credentialed clients here must therefore be pointed at a `member` service account, or they trade a 401 for a 403.

Leave the explicit-token variants alone: `robot-agent/src/agent-mode/host.ts:239` and `journal.ts:318` pass a caller-supplied token and gate on it; they are correct as written.

Honour the rule in `platform-auth.ts:9` — the credential goes only to `config.serverUrl` paths. `HardwareClient` (the G1 sidecar), the VLA/model clients and any camera URL must gain nothing; `platform-clients.test.ts:145-146` already asserts an unrelated fetch stays header-free, so keep that test passing.

Resist widening this into a shared outbound-fetch wrapper — see the reasoning in the Robot Agent section.

This task touches no file under `app/`, so it does not meet the parallel navigation refactor (TASK-273 through TASK-280).
