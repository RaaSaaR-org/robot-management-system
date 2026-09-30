# API Reference

HTTP endpoints for all NeoDEM services. All protected endpoints require a JWT Bearer token (disabled in dev via `AUTH_DISABLED=true`).

## Hardware Sidecar (port 8765)

Base URL: `http://localhost:8765`

Bridge between the Node.js agent and the SO-101 arm. No authentication.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Connection status. Returns `{status, connected, port}` |
| GET | `/state` | Current joint positions. Returns `{joints[], timestamp, simulated}` |
| GET | `/disconnect` | Release serial port for other tools |
| POST | `/action` | Send joint positions. Body: `{shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper}` (degrees) |
| POST | `/disconnect` | Release serial port (POST variant) |
| POST | `/vla/start` | Start VLA control loop. Body: `{instruction, serverUrl?, cameraType?, wristCameraIndex?, hz?}` |
| POST | `/vla/stop` | Stop VLA control loop |
| GET | `/vla/status` | VLA runner status. Returns `{active, instruction, step, queue_size, error}` |
| GET | `/safety/status` | Safety metrics. Returns `{validator_enabled, rate_limiter_enabled, watchdog_healthy, ...}` |
| POST | `/safety/config` | Update safety params. Body: `{max_delta_degrees?, watchdog_timeout_ms?}` |

## VLA Server (port 8000)

Base URL: `http://<vla-host>:8000`

VLA model inference server. Runs on a machine with GPU/MPS. No authentication.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Model load status. Returns `{status, model, model_loaded, device}` |
| GET | `/config` | Model config. Returns `{action_dim, chunk_size, cameras[], state_dim}` |
| POST | `/predict` | Run inference. Body: `{images: {name: base64_jpeg}, state: float[], task: string}`. Returns `{actions: float[][], timestamp, inference_time_ms}` |
| POST | `/reset` | Reset model state between episodes |

The `images` field maps camera names to base64-encoded JPEGs. Camera names come from `GET /config`. Legacy `image_b64` field (single image) is still supported.

## Server (port 3001)

Base URL: `http://localhost:3001`

### Authorization (TASK-282, TASK-283)

Roles are `super-admin` > `owner` > `member` > `viewer`. Authentication alone is
not authorization: on **every authenticated mount**, every
`POST`/`PUT`/`PATCH`/`DELETE` additionally requires **`member` or above**
(`writeRoleGuard`, `server/src/middleware/auth.middleware.ts`). A `viewer` gets
`403 {error: 'Forbidden'}`.

The rule is per **verb**, not per route: there is no separate tier for
destructive actions. Unregistering a robot (`DELETE /api/robots/:id`) and
sending it a motion command (`POST /api/robots/:id/command`) both need the same
`member`. `GET`/`HEAD`/`OPTIONS` are untouched, so a viewer keeps full read
access — with one wrinkle: the camera stream is a `GET`, but nothing can read it
without a ticket, and the ticket is minted by a `POST`. That mint is therefore
exempt (class 3); without it a viewer's cockpit answers "The server refused a
stream ticket for this camera."

There are exactly four classes of exception, and nothing else.

**1. Self-service writes** (`SELF_SERVICE_WRITES`), a user acting on their own
account or their own personal data:

| Method | Path | Why |
|--------|------|-----|
| PUT | `/api/settings` | Own theme and UI preferences |
| POST | `/api/settings/reset` | The same preferences, back to defaults |
| POST | `/api/gdpr/requests/*` | Data-subject rights (GDPR Art. 15-22) |
| DELETE | `/api/gdpr/requests/:id` | Withdraw one's own request |
| POST | `/api/gdpr/consents` | Grant consent for one's own data |
| DELETE | `/api/gdpr/consents/:type` | Withdraw it again |

`/api/gdpr/admin/*` is **not** exempt — it acts on other people's requests.

"One's own" is enforced in the handlers, not only by the guard (TASK-270): the
data subject of every `/api/gdpr/requests*` and `/api/gdpr/consents*` call is the
authenticated user (`dev-user-id` under `AUTH_DISABLED=true`). A `userId` in the
body or query is honoured only when it names the caller, when the caller is a
`super-admin`, or when the caller is an `owner` and the named user belongs to the
owner's tenant; anything else is `403`.

**2. Mounts that carry no guard at all** (`UNGUARDED_WRITE_MOUNTS`, `app.ts`),
because a user JWT is not what authenticates them:

| Mount | Writes | Why it stays open |
|-------|--------|-------------------|
| `/api/config` | 0 | Client bootstrap, read before any session exists |
| `/api/auth` | 13 | Login, register, refresh, forgot-password, MFA — guarding these would make logging in require being logged in |
| `/api/training/workers` | 6 | Shared worker token (`workerAuthMiddleware`), carries no role |
| `/api/twin/workers` | 6 | Same |
| `/metrics` | 0 | Prometheus scrape |
| `/.well-known/a2a` | 0 | A2A agent discovery |

Password change and MFA enrolment on a live session are genuinely self-service,
but they live on `/api/auth` and so never reach the guard.

**3. Writes that perform no write** (`POST_SHAPED_READS`), where the handler is
a pure function of its request body — no repository call, nothing persisted, so
granting it to a viewer grants no more than a `GET` would:

| Method | Path | Why |
|--------|------|-----|
| POST | `/api/patrol/cron/validate` | Returns the next five fire times for a cron expression. A viewer plans a schedule in the UI before asking a member to save it. |
| POST | `/api/robots/:id/camera/:name/ticket` | Mints the two-minute, one-camera ticket the MJPEG stream is read with — an `<img>` cannot send an `Authorization` header, so the ticket is the only way to open a stream a viewer is allowed to watch. Persists nothing, and reads only the robot row `GET /api/robots/:id` already serves them. |

**4. Halts** (`SAFETY_HALT_WRITES`), because a read-only operator who can see a
hazard must be able to stop it:

| Method | Path | Why |
|--------|------|-----|
| POST | `/api/safety/fleet/estop` | `FleetEmergencyStopButton`, on the dashboard and the safety page |
| POST | `/api/robots/:id/command` | **Only** with an `emergency_stop` body — `EmergencyStopButton`. The endpoint itself stays `member`: any other command type from a viewer is still a 403, so this cannot be used to drive a robot |

The class is one-way: a viewer may stop, never start. `POST
/api/safety/fleet/estop/reset` and `POST /api/safety/robots/:id/estop/reset`
put robots back in motion and stay `member`. The zone and per-robot stops under
`/api/safety` stay `member` too — no shipped UI fires them.

**Consequences worth knowing** (classified deliberately, not by oversight):

- Most **POST-shaped reads** now require `member`: `/api/a2a/*/list`,
  `/api/a2a/events/get`, `/api/datasets/compatibility`,
  `/api/curation/diversity-score`, `/api/embodiments/validate`,
  `/api/compliance/verify` and `/api/compliance/export`. They are POSTs because
  they carry a request body, but a viewer loses them. Reclassify by adding an
  entry to `POST_SHAPED_READS` if that proves wrong in the field.
- **Acknowledgements are member-level**: alerts, oversight anomalies and patrol
  findings all clear a fleet-wide signal for everyone, not a personal one.
- **Contribution submission is member-level**: donating robot data is an
  operator act; approval was already `ownerOnly`.
- `AUTH_DISABLED=true` (the dev default, and `helm/neodem/values.yaml`) bypasses
  this layer along with authentication itself.
- A service account whose token reaches any authenticated mount must be created
  with role **`member`**; a `viewer` token 403s on every write, compliance log
  ingestion included.

The inventory is enumerated from the live router stack in
`server/src/__tests__/write-route-authorization.test.ts`, which is **fail
closed**: all 349 write verbs must either refuse a viewer or fall into one of
the four classes above. A new mount that forgets the guard fails CI.
`POST /api/robots/:id/command` counts as enforced there and is proved separately:
the sweep fires it with an empty body and demands the 403, and a named case
fires the `emergency_stop` body and demands the stop goes through.

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/.well-known/a2a/agent_card.json` | A2A agent discovery card |

### Auth (`/api/auth`)

Rate limited: 20 requests per 15 minutes.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | Register user account |
| POST | `/login` | Login. Returns JWT or MFA challenge |
| POST | `/logout` | Invalidate refresh token |
| POST | `/refresh` | Refresh access token |
| GET | `/me` | Current user info |
| POST | `/forgot-password` | Request password reset |
| POST | `/reset-password` | Reset password with token |
| POST | `/change-password` | Change password |
| POST | `/mfa/totp/setup` | Generate TOTP secret |
| POST | `/mfa/totp/verify` | Verify TOTP and enable MFA |
| POST | `/mfa/totp/validate` | Validate TOTP during login |
| POST | `/mfa/recovery-codes` | Generate recovery codes |
| POST | `/mfa/recovery/use` | Use recovery code |
| DELETE | `/mfa/totp` | Disable MFA |
| GET | `/mfa/status` | MFA status |

### Robots (`/api/robots`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | Register robot from URL |
| GET | `/` | List all robots |
| GET | `/:id` | Get robot details |
| DELETE | `/:id` | Unregister robot |
| POST | `/:id/command` | Send command to robot |
| GET | `/:id/telemetry` | Get robot telemetry |
| GET | `/:id/peers` | Every OTHER online robot as `{robotId, name, x, y, headingDeg, frame, place, zone, updatedAt, footprintRadiusM}` for the robot-agent's peer tracker (TASK-207); poses ≤1 s old (refreshed from the agents on demand). `frame` is passed through as reported — the caller drops what it cannot compare |
| GET | `/:id/agent-mode/map` | Proxy of the agent's `GET /api/v1/robots/:id/map` (grid, pose, keepouts, peers, `peersDropped`, `nav` — the navigator's planned route, TASK-208); the agent's 404 ("map disabled") passes through, anything else is a 502 with the agent's error — never an empty map |

### A2A (`/api/a2a`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agent/register` | Register external A2A agent |
| POST | `/agent/list` | List registered agents |
| DELETE | `/agent/:name` | Unregister agent |
| GET | `/agent/:name` | Get agent details |
| POST | `/conversation/create` | Create conversation with robot |
| POST | `/conversation/list` | List conversations |
| GET | `/conversation/:id` | Get conversation |
| DELETE | `/conversation/:id` | Delete conversation |
| — | `ws://localhost:3001/api/a2a/ws` | WebSocket for messages |

### Training (`/api/training`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/jobs` | Submit training job |
| GET | `/jobs` | List training jobs |
| GET | `/jobs/:id` | Get job details |
| POST | `/jobs/:id/cancel` | Cancel job |
| POST | `/jobs/:id/retry` | Retry failed job |
| GET | `/jobs/:id/estimate` | Estimate duration |
| GET | `/jobs/active` | Active jobs |
| GET | `/queue/stats` | Queue statistics |
| GET | `/workers` | Active training workers + queue summary |

### Datasets (`/api/datasets`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create dataset |
| GET | `/` | List datasets |
| GET | `/:id` | Get dataset |
| PUT | `/:id` | Update metadata |
| DELETE | `/:id` | Delete dataset |
| POST | `/:id/upload/initiate` | Get presigned upload URL |
| POST | `/:id/upload/complete` | Mark upload done, start validation |
| GET | `/:id/stats` | Normalization stats |
| POST | `/:id/compute-stats` | Trigger stats computation |
| GET | `/:id/progress` | Validation progress |
| GET | `/:id/quality` | Quality report |
| POST | `/:id/validate` | Start structural validation → `202 {state}` |
| POST | `/:id/validate-advanced` | Trigger advanced validation |

`POST /:id/validate` does not wait for the verdict. It answers `202` with
`{datasetId, accepted, state, progressUrl}` — `state: "queued"` when NATS is
connected (a `jobs.dataset.validate` worker runs it) and `state: "started"` when
it is not (this process runs it detached from the request; NATS is optional and
a dev box has none). Poll `GET /:id/progress`, or read the row, for the answer:
from the moment the 202 is sent, `/:id/progress` reports `status: "validating"`
for THIS pass — not the previous verdict — and ends on `ready` or `failed` at
100% with the errors, whether or not this deployment has a NATS KV store.
While a validation for that dataset is running the endpoint answers `409
VALIDATION_IN_FLIGHT` rather than starting a second pass; when neither backing
store can be reached it answers `503 STORE_UNAVAILABLE` and leaves the row
untouched.

### Deployments (`/api/deployments`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create deployment |
| GET | `/` | List deployments |
| GET | `/active` | Active deployments |
| GET | `/:id` | Deployment details |
| GET | `/:id/metrics` | Deployment metrics |
| POST | `/:id/start` | Start canary rollout |
| POST | `/:id/progress` | Advance to next stage |
| POST | `/:id/promote` | Promote to production |
| POST | `/:id/rollback` | Trigger rollback |
| POST | `/:id/cancel` | Cancel deployment |

### Compliance (`/api/compliance`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/logs` | List compliance logs (paginated, filterable) |
| GET | `/logs/:id` | Get single log |
| POST | `/logs` | Create log entry (from robot agent) |
| POST | `/verify` | Verify hash chain integrity |
| GET | `/metrics` | Compliance metrics |
| POST | `/sessions` | Start logging session |
| POST | `/export` | Export logs to JSON |

### Agent Mode (`/api/robots/:id/agent-mode`, TASK-194)

The server holds the last plan per robot in memory, fans `agent:*` events out over `/api/a2a/ws`, and proxies the operator calls to the robot. See [`agent-mode.md`](agent-mode.md).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/events` | Robot → server: every `agent:*` event (`plan`, `block`, `scene`, `state`, `memory`, `patrol`, `finding`, `tour`), mirrored to the app; the robot separately submits a compliance record per finished block |
| GET | `/` | Last known plan and state, refreshed from the robot's `GET /api/v1/robots/:id/agent-mode` when it is reachable |
| GET | `/scene` | The robot's scene memory: entities with world bearings, current view, `personVisible` |
| GET | `/map` · `/map/cloud` | Occupancy grid (with keepouts, peers, planned route) and the 3-D world cloud, proxied from the robot |
| GET | `/memory` | Digest of the robot's durable workspace (`MEMORY.md`, place notes, intents) |
| GET/POST | `/identity` | Read / edit `IDENTITY.md` |
| POST | `/command` | `{text, contextId?}` → the robot plans and runs it |
| POST | `/toggle` | `{enabled}` — switch Agent Mode on or off |
| POST | `/estop` · `/estop/reset` | Manual E-Stop and its acknowledge; the answer says `delivered` and `deliveryError` rather than assuming the robot stopped |

### Control lease (`/api/robots/:id/control-lease`, TASK-317, TASK-318)

The authority for one robot-wide, per-user control lease. One `RobotControlLease` row per robot, taken only by a conditional update (or a primary-key create), so any number of server replicas grant exactly one holder; the same user's second session competes like anyone else. A won lease is usable only once the robot agent has acked the install of its `generation` (the agent's `/api/v1/robots/:id/control-lease/install`); a refused or unreachable agent leaves the row `unconfirmed`, which blocks every acquisition until the agent, asked directly, reports nothing installed. The robot is resolved in the caller's tenant — a robot of another tenant is `404`. Only the SHA-256 of `leaseId` is stored; neither leaves the server except `leaseId` in the acquire answer, and acquire, denial (409 / 403), release, unconfirmed, every lost renewal (`fence` with reason `lease_lost`, `transport_lost` or `not_authorized`) and every expiry (`expire`) are written to the compliance log with tenant, robot, user, session and generation.

Behind `CONTROL_LEASES_ENABLED` — **on by default** since TASK-321; `CONTROL_LEASES_ENABLED=false` opts out, and then the GET answers `enabled:false`, every POST `404 {code:'control_leases_disabled'}`. The `/api/config/features` snapshot carries the same value as `controlLeasesEnabled`. Granting a lease does not by itself gate motion — enforcement is the agent's opt-in `CONTROL_LEASE_REQUIRED` (default `false`, see the agent's Control lease section and `docs/deployment.md` → Control leases). `CONTROL_LEASE_TTL_MS` (default `5000`, clamped to 500–60000) and `CONTROL_LEASE_RENEW_MS` (default `1000`, at most half the TTL).

| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| GET | `/` | viewer | `{capability:{version:1, enabled, ttlMs, renewEveryMs}, holder}`; `holder` is `null` or `{userId, displayName, state:'installing'\|'held'\|'stopping'\|'unconfirmed', generation, expiresAt}` — never the secret or its hash |
| POST | `/` | member | `{displayName?}` → `201 {leaseId, generation, sessionId, ttlMs, renewEveryMs, expiresAt}`; `409 {code:'lease_held'\|'lease_unconfirmed', holder}`; `503 {code:'agent_unconfirmed'}` |
| POST | `/release` | member | `{leaseId, generation}` → `{released:true}`; a stale generation, a wrong secret or another user → `{released:false}` and the holder is untouched; `503 {code:'agent_unconfirmed'}` when the agent could not be told |
| POST | `/renew` | member | `{leaseId, generation}` → `{generation, expiresAt, ttlMs, renewEveryMs}`, every `renewEveryMs`. `403 {code:'not_authorized'}` when the user, re-read from the database, is gone, disabled or below `member` (the lease is fenced); `409 {code:'lease_lost'}` when it is not the current, unexpired, `held` generation of this user with this secret (a late renew never resurrects it) or the agent answers 409 (it restarted — fenced); `409 {code:'transport_lost'}` when the agent reports no control socket bound to the lease once the first TTL window has passed (fenced); `503 {code:'agent_unconfirmed'}` when the agent could not be reached — the deadline is left as it was and the agent expires the lease on its own |

**Fencing.** Every refusal above that says *fenced*, and the expiry sweeper, revoke the lease the same way: row → `stopping`, agent `release`, row → `released` (or `expired` for the sweeper), `unconfirmed` when the agent does not ack. The sweeper runs in every replica every `renewEveryMs` (idle while the flag is off) and fences each `held` row past `expiresAt` exactly once, because it claims the row with the same conditional update.

**Observers.** Every holder transition (`held`, `stopping`, `released`, `expired`, `unconfirmed`) is sent on `/api/a2a/ws` as `{type:'control_lease', robotId, state, generation, holder:{userId, displayName}, expiresAt, timestamp}` — never `leaseId`, its hash or the session id — and only to sockets of the robot's tenant. A socket identifies itself with its access token, either as `?token=<jwt>` on the upgrade URL or in-band as `{type:'auth', token}` (answered `{type:'auth', authenticated}`); a socket that never does receives no lease events, and nothing else on the socket changes. Under `AUTH_DISABLED=true` every socket is the dev user. A super-admin sees every tenant.

**The console (TASK-319).** The app's keyboard teleop section and VR teleop modal read the GET on open; with `enabled:false` (or an unreachable server) they behave exactly as before. With it on (`app/src/features/robots/hooks/useControlLease.ts`): nothing drives until the operator confirms "Take control"; the 201's `{bind}` goes out on the agent socket, and the view drives only after the agent's `{type:'lease', state:'bound'}`. It renews every `renewEveryMs` while bound over an open socket, and keeps a local deadline of last successful renew + `ttlMs − 2 × renewEveryMs` (the bind is bounded by the same deadline, so an agent that never acks — one without `CONTROL_LEASE_REQUIRED` — loses the lease rather than hanging). Crossing that deadline, any renew refusal, an agent `revoked`/`expired`/`lease_invalid`, a socket close or reconnect, the page going hidden or `pagehide`, a robot change, unmount, and — in VR — the session ending or the headset hiding it, all go through one idempotent stop: one zero `move`, then `release`, exactly once. Nothing re-acquires on its own. A 409 names the holder; the holder badge ("Controlled by … · expires in n s") follows the observer events above, sent after an in-band `{type:'auth'}`. The secret lives only in the hook's memory. The E-stop is never gated on the lease. `bindSocket(ws)` joins another input view to the same lease (TASK-320).

**Data-collection inputs (TASK-320).** The session detail page holds one lease for the whole page (`app/src/features/datacollection/hooks/useSessionControlLease.ts`): while the capability is on and a live session has a gamepad or VR input, it keeps its own agent socket on `/ws/keyboard-teleop` open as the lease's primary and shows the same "Take control" bar (`ControlLeaseBar`). The gamepad and simulated-VR inputs join that lease with `bindSocket` on their own sockets (`hooks/inputLease.ts`) — never acquiring one of their own — and send motion only after the agent answers `{type:'lease', state:'bound'}` on that socket. `revoked`, `expired`, `lease_invalid`, `lease_required` or the page's lease ending silence them until the operator takes control again; a stop (gamepad direction 0) always goes out, the simulated input's leave-time `home` only while bound. Under a lease the gamepad drives through the agent's `/ws/keyboard-teleop`, since the SO-101 sidecar's socket on `:8766` knows nothing of leases. Capability off: no page socket, no bar, and both inputs behave as before.

### Tour / host mode (`/api/tour`, TASK-213)

Routes are the server's record; runs are what the robot reports back. There is no `/api/robots` half: a tour is never started by a schedule.

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/routes` | List / create `TourRoute` (`name, robotId?, twinId?, language:'en'\|'de', greetingPlaceId, greeting, offer, farewell, siteCard:string[], stops:[{placeId, headline, talkTrack, facts[], demo?, dwellS?, askToContinue?}], enabled, autoGreet`). The AI disclosure is appended by the robot and is not a column. |
| GET/PUT/DELETE | `/routes/:id` | Read / update / delete a route (runs survive deletion) |
| POST | `/routes/:id/start` | Body `{origin?:'visitor'\|'operator', robotId?}` → `TourStartResult` (200 even when `accepted:false`, with `reason` and `message`; the refusal is also recorded as a `skipped` run) |
| POST | `/routes/:id/abort` | `{robotId?, reason?}` → `{ok, runId?}` |
| GET | `/runs?robotId=&routeId=&status=&limit=` | Visit history (`TourRun` with legs, turns, `disclosureSpoken`, `language`) |
| GET | `/runs/:runId` | One visit; each turn carries `answered: grounded\|from_camera\|declined\|unanswered` |
| GET | `/places?robotId=` | The robot's place graph for the stop editor |

Visits arrive through `POST /api/robots/:id/agent-mode/events` (`agent:tour:started\|leg\|turn\|finished`). Host mode uploads no photos, so there is no photo endpoint.

### Patrol (`/api/patrol`, TASK-212)

Routes are the server's record; runs, findings and photos are what the robot reports back.

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/routes` | List / create `PatrolRoute` (checkpoints `{id?, placeId, name?, headingDeg?, actions, dwellMs?, expectations?}`, `cronExpression`, `timeWindows` (default day 07–19 / night 19–07), `homePlaceId`). Rows carry `nextRunAt`/`lastFiredAt` |
| GET/PUT/DELETE | `/routes/:id` | Read / update / delete a route (runs + findings survive deletion) |
| GET | `/routes/:id/export/vda5050.json` | VDA5050-style order (nodes = checkpoints, actions capturePhoto/alignHeading/wait/scanRoom/inspect) |
| GET | `/routes/:id/baseline?window=` | `{runId, window, photos:{checkpointId:key}, robotId, finishedAt}` or 404 `NO_BASELINE` |
| POST | `/routes/:id/start` | Body `{mode:'baseline'\|'patrol', origin?, robotId?}` → `PatrolStartResult` (200 even when `accepted:false` with `reason` battery/estop/place/running/window/disabled…; 502 when the robot is unreachable) |
| POST | `/routes/:id/abort` | Abort the active run on the route's robot |
| POST | `/cron/validate` | `{cronExpression}` → `{valid, nextRuns[], error?}` |
| GET | `/runs?robotId=&routeId=&status=&limit=` | Run history (`PatrolRun` with legs) |
| GET | `/runs/:runId` | One run incl. `findings` |
| POST | `/runs/:runId/promote` | Make this run the baseline for its window (robot re-uploads photos as `baseline`) |
| GET | `/findings?robotId=&status=&type=` | Findings |
| POST | `/findings/:id/acknowledge` \| `/normal` \| `/escalate` | Operator verdicts; `/normal` folds the observation into the robot's baseline (`robotNotified`), `/escalate` opens an incident (`incidentId`) |
| GET | `/places?robotId=` | The robot's place graph (`{places:[{id,name,placeType?,keepout?}]}`) for the route editor |
| POST | `/api/robots/:id/agent-mode/patrol` (+`/abort`) | Alias of start/abort addressed by robot |
| PUT | `/api/robots/:id/patrol-runs/:runId/photos/:key` | Robot → server photo upload, JSON `{imageB64, contentType, kind:'control'\|'baseline'\|'finding', checkpointId?, routeId?, capturedAt?}` (S3 bucket `patrol-photos` when RustFS is up, else `PATROL_PHOTO_DIR`) |
| GET | `/api/robots/:id/patrol-runs/:runId/photos[/:key]` | List metadata / fetch a JPEG (`X-Patrol-Photo-Kind`) |

Findings arrive through `POST /api/robots/:id/agent-mode/events` (`agent:patrol:*` / `agent:finding:*` events carry `patrol` and `finding`); the server raises one alert per finding (message tail `[finding:<id> run:<runId>]`, severity by type × time window) and one warning alert per skipped run, and fans the events out on `/api/a2a/ws`. `PatrolSchedulerService` fires enabled routes on their cron (30 s tick, one start per slot, one retry after `PATROL_RETRY_MIN`).

### Build-page removals (TASK-272)

Every destructive act answers `200 {id, outcome: 'deleted' | 'archived'}` (or the
updated entity where noted), `404` for an unknown id and `409` with the reason when
the entity's state forbids it. Each act, and each create of these entities, writes an
`access_audit` compliance entry (robot key `platform-build`). Decisions:
`docs/records/TASK-272-build-page-deletes.md`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/updates/:id/rollback/:robotId` | `{targetVersion}` → the rollback `UpdateDeployment`, filed under package `:id` |
| DELETE | `/api/updates/:id` | Never deployed → `deleted`; has deployments → `archived` (hidden from `GET /api/updates` unless `?includeArchived=true`); still installing → 409 |
| POST | `/api/federated/rounds/:id/cancel` | Cancel an unfinished round → the round (`status: 'cancelled'`); in-flight participants become `excluded`; finished → 409 |
| DELETE | `/api/federated/rounds/:id` | Finished round (completed / failed / cancelled) → `deleted` with its participants; running → 409 |
| DELETE | `/api/deployments/:id` | pending / failed / rolled back / cancelled → `deleted`; live → 409 |
| DELETE | `/api/models/versions/:id` | Always `archived`, never removed; 409 while a deployment of it is unfinished or a skill runs it |
| POST | `/api/marketplace/listings/:id/unpublish` \| `/publish` | Seller or super-admin → `{listing}` as `draft` / `published`; a `pending_review` / `suspended` listing → 409 unless super-admin |
| DELETE | `/api/marketplace/listings/:id` | Seller or super-admin; nobody bought it → `deleted`; a buyer holds a licence → 409 |

### Social — comments and ratings (`/api/social`, TASK-241)

People and agents leave comments and 0..1 ratings on five subject types:
`dataset`, `dataset_view` (a `Dataset` with `kind = 'view'`), `model_version`,
`episode` (`subjectId` = dataset id, plus `episodeIndex`) and `training_job`.
Types: `server/src/types/social.types.ts`. Decisions:
`docs/records/TASK-241-comments-and-ratings.md`.

**Actor.** A human JWT → `user` (`X-Agent-Name` ignored). A service token
(`ndsa_…`) must send `X-Agent-Name: <AgentCard.name>` → `agent`; missing → 400
`SOCIAL_AGENT_NAME_REQUIRED`, unknown → 403 `SOCIAL_AGENT_UNKNOWN`. With
`AUTH_DISABLED=true` → `system` actor `dev` (or an agent, if `X-Agent-Name` names one).

**Evidence** (`EvidenceRef[]`): `{kind:'evaluation_episode', ids}`,
`{kind:'sim_to_real_validation', id}`, `{kind:'episode_reward', datasetId, rewardType}`,
`{kind:'training_job'|'model_version'|'dataset', id}`, `{kind:'external', uri, note}`.
An **agent** rating with no evidence → 400 `SOCIAL_AGENT_EVIDENCE_REQUIRED`; any
referenced id that does not exist → 400 `SOCIAL_EVIDENCE_NOT_FOUND`. Every agent
rating writes an `ai_decision` compliance entry (robot key `platform`) carrying its evidence.

Errors are `{error, message, code, context?}`. A missing subject → 404 `SOCIAL_SUBJECT_NOT_FOUND`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/social/me` | `{actor}` — who this request speaks as (the UI offers edit/delete on that actor's comments) |
| GET | `/api/social/:subjectType/:subjectId/comments` (`?episodeIndex=`) | `{threads: CommentThread[]}` — top-level comments oldest first, each with one level of `replies`; a soft-deleted comment keeps its row (`body: ''`, `deletedAt` set) while it has replies |
| POST | `/api/social/:subjectType/:subjectId/comments` | `{body, parentId?, evidence?, episodeIndex?}` → 201 `{comment}` |
| PATCH | `/api/social/comments/:id` | `{body}` → `{comment}`; author only (403 `SOCIAL_NOT_AUTHOR`) |
| DELETE | `/api/social/comments/:id` | Soft delete → `{comment}`; author only |
| GET | `/api/social/:subjectType/:subjectId/rating` | `{mine: Rating \| null, ratings: Rating[]}` |
| PUT | `/api/social/:subjectType/:subjectId/rating` | `{score: 0..1, dimensions?, evidence?, comment?, episodeIndex?}` → 201 on create, 200 on update — one rating per actor per subject |
| GET | `/api/social/:subjectType/:subjectId/summary` | `{summary: {count, mean, byDimension, byActorType: {user, agent, system}, commentCount}}` — human and agent means kept apart |
| GET | `/api/social/feed?actorType=&subjectType=&limit=` | `{items: FeedItem[]}` — comments and ratings across subjects, newest first (default 50, max 200) |

Dimensions (each 0..1, all optional): dataset / view `coverage`, `cleanliness`,
`diversity`, `labelQuality`; model version `successRate`, `robustness`, `latency`,
`simToRealGap`; episode `demonstrationQuality`, `taskCompletion`; training job
`resultStrength`, `reproducibility`.

### Other Route Groups

| Base Path | Feature |
|-----------|---------|
| `/api/alerts` | Alert management |
| `/api/zones` | Fleet zone configuration |
| `/api/command` | Natural language command processing |
| `/api/processes` | Workflow management |
| `/api/safety` | E-stop, safety monitoring |
| `/api/explainability` | AI decision transparency |
| `/api/gdpr` | GDPR self-service (Art. 15-22) |
| `/api/incidents` | Incident reporting |
| `/api/oversight` | Human oversight dashboard |
| `/api/approvals` | Human approval workflows |
| `/api/skills` | VLA skill library |
| `/api/embodiments` | Embodiment configuration |
| `/api/teleoperation` | VLA data collection |
| `/api/federated` | Federated learning |
| `/api/federated/secure` | Secure aggregation (masked gradient submission) |
| `/api/contributions` | Data contribution portal |
| `/api/evaluation` | Model evaluation |
| `/api/storage` | Object storage (RustFS/S3) |
| `/api/settings` | User preferences |
| `/api/security` | Device identity, certificates |
| `/api/updates` | OTA update **metadata**: create, Ed25519-sign, approve and record deployments. Delivery is not implemented — no artifact is stored or served, and deploying does not contact the robot (TASK-302) |
| `/api/training-docs` | EU AI Act Art. 10/11 training-data documentation: dataset provenance, training-data summaries, bias assessments, PDF export. HTTP-only — the app ships no client for it (TASK-302) |

## Robot Agent (port 41245)

Base URL: `http://localhost:41245`

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/agent-card.json` | A2A agent card |
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/register` | Registration info for server |

### Robot Operations (`/api/v1/robots/:id`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Robot details |
| GET | `/telemetry` | Current telemetry |
| GET | `/commands` | Command history |
| POST | `/command` | Send command |
| POST | `/tasks` | Receive pushed task (202) |
| GET | `/tasks` | Task queue |
| DELETE | `/tasks/:taskId` | Cancel task |
| POST | `/reset` | Reset robot state |
| GET | `/places` | The robot's place graph as `{places:[…]}` (TASK-212, for the patrol route editor) |
| GET | `/map` | The robot's own occupancy grid (TASK-206) + accepted fleet peers and `peersDropped` (TASK-207) + `nav` (TASK-208: `{target, planned, path, goal, lengthM, segments, reason}` while a `goto` runs, else null); `location.frame` on `GET /` says which odometry frame the poses are in |

### Agent Mode (`/api/v1/robots/:id/agent-mode`, TASK-194)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | `{enabled, controlOwner, plan, estop, place, ...}` (personal-data gate: configured `AGENT_MEMORY_TOKEN` required; loopback only when unset; cross-origin browser requests refused) |
| POST | `/command` | `{text, contextId?, spoken?}` → plan and run; a stop word or a pending yes/no answer is handled here without a model call |
| POST | `/toggle` | `{enabled}` |
| POST | `/estop` · `/estop/reset` | Manual E-Stop → `{stopped, delivered, deliveryError}`; reset clears the latch |
| GET | `/scene` · `/scene.md` | Scene memory as JSON / as the rendered `current_view.md` (personal-data gate) |
| GET/POST | `/intents` · DELETE `/intents/:intentId` | Standing intents ("tell me when you see a person") |
| GET | `../memory` · `../memory.md` | Workspace digest / raw `MEMORY.md` (personal-data gate) |
| DELETE | `../memory` | GDPR Art. 17 workspace erasure (personal-data gate) |
| GET/POST | `../identity` | Read the identity snapshot / edit Name, Emoji, Operator and Site (personal-data gate) |
| GET | `../identity/body.md` | Generated `BODY.md` hardware inventory (personal-data gate) |

### Control lease (`/api/v1/robots/:id/control-lease`, TASK-314)

The robot's one installed control lease — fenced by a strictly increasing `generation` whose high-water is persisted in `data/control-lease-<ROBOT_ID>.json`, and expired on the agent's own clock. All four routes sit behind the personal-data gate (configured `AGENT_MEMORY_TOKEN` required; loopback only when unset; cross-origin browser requests refused), so only the server installs leases. `CONTROL_LEASE_REQUIRED` (default `false`, opt-in per deployment even though the server grants leases by default since TASK-321) is reported as `enforced`; with it off, nothing gates motion on the lease. With it on, a client that never binds is refused outright — no warn-only or grace mode: motion sockets get `{type:'error', code:'lease_required'}` (a bad bind `lease_invalid`), REST motion starts while another user holds the lease get `409 {code:'control_lease_held'}`. When it is on, `/ws/keyboard-teleop` drives only on a socket bound to the installed lease (TASK-315, see `robot-agent/AGENTS.md`), and the REST motion routes and the bilateral socket follow the rules below (TASK-316).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/install` | `{generation, leaseIdHash (sha256 hex), sessionId, userId, displayName, tenantId, ttlMs (500–60000)}` → `{installed:true, generation, fencedGeneration}`; 409 `{code:'stale_generation', highWater}`; 503 `{code:'high_water_unreadable'\|'high_water_unwritable'}` |
| POST | `/renew` | `{generation, ttlMs}` → `{renewed:true, bound}`; 409 `{code:'not_installed'\|'expired'}` (a late renew never resurrects) |
| POST | `/release` | `{generation}` → `{released:boolean}`; a stale generation is a no-op |
| GET | `/` | `{enforced, state:'none'\|'held'\|'expired'\|'released', generation, userId, displayName, sessionId, expiresInMs, bound, error?}` — never the hash |

**Motion ingress while a lease is held (TASK-316).** With `CONTROL_LEASE_REQUIRED` on and the lease `held`, every REST route that *starts* motion answers `409 {code:'control_lease_held', holder:{displayName, userId}, message}` and starts nothing: `POST /robots/:id/command` (except `type: 'stop'\|'emergency_stop'`), `/skills/execute`, `/vla/start`, `/vla/resume`, `/evaluation/run`, `/tasks`, `/agent-mode/command`, `/agent-mode/tour`, `/agent-mode/patrol`. Stop, abort and E-stop routes are never refused (`/vla/stop`, `/vla/pause`, `/skills/abort`, `/agent-mode/tour/abort`, `/agent-mode/patrol/abort`, `/agent-mode/estop*`, `/safety/estop*`). With no lease held (`none`, `expired`, `released`) autonomous starts are admitted as before.

The bilateral teleop socket (`/ws/bilateral-teleop`) follows the socket binding contract: the server sends `{type:'lease', state:'unbound', required:true}` after `ready`; the client sends `{bind:{leaseId, generation}}` and gets `{type:'lease', state:'bound', generation}` or `{type:'error', code:'lease_invalid'}`. `leader_state` frames from an unbound socket are dropped with `{type:'error', code:'lease_required'}` (once per binding); a fence, release or expiry of the bound generation sends `{type:'lease', state:'revoked'\|'expired', generation}` and stops forwarding at once — no auto-rebind. Flag off: no lease messages, a `{bind}` frame is ignored.

### Patrol (`/api/v1/robots/:id/agent-mode/patrol`, TASK-212)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Start a run: `{routeId, mode:'baseline'\|'patrol', origin:'operator'\|'scheduled', route?}` (route inline; falls back to `GET {SERVER_URL}/api/patrol/routes/:id`, then the disk cache) → `PatrolStartResult`. `scheduled` passes the initiative gate + time window; a refusal is recorded as a `skipped` run |
| POST | `/abort` | Abort the active run (`{reason}`) |
| GET | `/` | `{enabled, active, last}` |
| GET | `/runs?limit=` · `/runs/:runId` | Run history on this robot (incl. findings) |
| GET | `/runs/:runId/photos/:key` · `/baseline/:routeId/:window/:key` | JPEGs (personal-data gate: configured `AGENT_MEMORY_TOKEN` required; loopback only when unset; cross-origin browser requests refused) |
| POST | `/findings/:findingId/normal` | "This is normal" → widens the baseline for that checkpoint × window |
| POST | `/runs/:runId/promote` | Use this run's photos + checklist answers as the baseline |

### Tour / host mode (`/api/v1/robots/:id/agent-mode/tour`, TASK-213)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Start a visit: `{routeId, origin?:'visitor'\|'operator', route?}` (route inline; falls back to `GET {SERVER_URL}/api/tour/routes/:id`, then the disk cache) → `TourStartResult`; a refusal `{accepted:false, reason ∈ disabled\|estop\|busy\|battery\|place_unknown\|damped\|crash_unacknowledged\|route_unknown\|no_places\|no_stops\|person_too_close\|running, message}` is recorded as a `skipped` run |
| POST | `/abort` | Abort the active visit (`{reason}`); the farewell is still spoken |
| GET | `/` | `{enabled, active, last}` |
| GET | `/runs?limit=` · `/runs/:runId` | Visit history on this robot, text only (personal-data gate) |

### Safety (`/api/v1/robots/:id/safety`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Safety status |
| GET | `/estop` | E-stop state |
| POST | `/estop` | Trigger E-stop |
| POST | `/estop/reset` | Reset E-stop |
| GET | `/events` | Safety event log |
| PUT | `/mode` | Set operating mode |
| POST | `/heartbeat` | Server heartbeat |

### VLA Control (`/api/v1/robots/:id/vla`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | VLA control status |
| POST | `/start` | Start VLA. Body: `{instruction}` |
| POST | `/stop` | Stop VLA |
| POST | `/pause` | Pause VLA |
| POST | `/resume` | Resume VLA |
| GET | `/safety` | VLA safety monitoring |
| GET | `/model` | Current model info |
| POST | `/model/switch` | Switch model version |
| GET | `/metrics` | Inference metrics |

### WebSocket

| Path | Description |
|------|-------------|
| `ws://localhost:41245/ws/telemetry/:robotId` | Telemetry stream (2s interval) |
| `ws://localhost:41245/ws/bilateral-teleop` | ALOHA-style teleoperation (needs a bound control lease when `CONTROL_LEASE_REQUIRED` is on — see Control lease) |
