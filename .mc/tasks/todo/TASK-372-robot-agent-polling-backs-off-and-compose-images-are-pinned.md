---
id: "TASK-372"
aliases: ["TASK-372"]
title: "Robot agent polling backs off and compose images are pinned"
slug: "robot-agent-polling-backs-off-and-compose-images-are-pinned"
status: "in-progress"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: ["core", "ops"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Robot agent polling backs off and compose images are pinned

## Description

Two small findings from the k3d E2E run (TASK-364). (1) The robot agent polls
platform endpoints on a fixed `setInterval` forever. When one fails for good (a
server without the route answers a bare 404, or the server is unreachable), it
asks again every few seconds with no backoff, which floods the server's logs and
gives an operator no clear signal. (2) `docker-compose.yml` still pulls
`rustfs/rustfs:latest` and `amazon/aws-cli:latest`, which TASK-364 already
pinned in the Helm chart because `latest` changed under running installs.

## Details

### Current state

- `robot-agent/src/robot/state.ts` `startFrameRegistrationRefresh()` polls
  `GET /api/robots/:id/frame-registration` every `PLACE_REGISTRATION_REFRESH_MS`
  (default 5 s) and stays silent on errors. `startPlaceGraphRefresh()` polls
  `GET /api/robots/:id/places` every `PLACE_GRAPH_REFRESH_MS` (60 s).
- `robot-agent/src/federated/RoundLifecycle.ts` polls `GET /api/federated/rounds?status=open`
  every 30 s (when `FEDERATED_ENABLED=true`) and logs a warning on every failure.
- `docker-compose.yml` uses `rustfs/rustfs:latest` and `amazon/aws-cli:latest`.
  `helm/neodem/values.yaml` pins `rustfs/rustfs:1.0.0` and `amazon/aws-cli:2.37.4`.
  `nats:2.10-alpine` and `postgres:16-alpine` already match the chart. Our own
  images are not referenced by the compose file.

### Robot Agent

- New `robot-agent/src/utils/backoff-poll.ts`: `startBackoffPoll({ baseMs, maxMs, run, onTransition })`
  runs a chained `setTimeout` loop (timers unref'd). Each consecutive failure
  doubles the delay up to `maxMs` (default `max(baseMs, 5 min)`), and the first
  success resets it to `baseMs`. `onTransition` fires once when failures start
  and once on recovery, never per attempt. `logPollTransition()` formats those two lines.
- Frame registration: only `kind: 'error'` (bare 404, non-2xx, network) counts as
  a failure. Both the server's authoritative "no frame registration" 404 and a
  found registration are answers and keep the base interval, so an operator's
  alignment still reaches the robot within one poll.
- Place graph: `origin: 'cache' | 'none'` count as failures; `server` and
  `unbound` are answers. `PlaceGraphSource` already logs each distinct failure once.
- Federated rounds: `checkForRounds()` returns success or failure. The loop logs
  the first failure and the recovery instead of one warning every 30 s.

### Compose

- `docker-compose.yml`: `rustfs/rustfs:1.0.0`, `amazon/aws-cli:2.37.4`, the same
  tags as the Helm chart. `docs/nats-rustfs.md` RustFS snippets use the same tag.

### Key files

- `robot-agent/src/utils/backoff-poll.ts` (new)
- `robot-agent/src/robot/state.ts`
- `robot-agent/src/federated/RoundLifecycle.ts`
- `docker-compose.yml`, `docs/nats-rustfs.md`
- Tests: `robot-agent/src/utils/__tests__/backoff-poll.test.ts`,
  `robot-agent/src/__tests__/federated/RoundLifecycle.test.ts`,
  `robot-agent/src/robot/__tests__/state-frame-registration.test.ts`,
  `server/src/storage/__tests__/compose-image-pins.test.ts`

## Acceptance Criteria

- [ ] A poll that keeps failing backs off exponentially up to a cap, and resets to the base interval on success
- [ ] A failing poll logs once when it starts failing and once when it recovers, not on every attempt
- [ ] The frame-registration poll backs off on a bare 404 but keeps the base interval on the server's "no frame registration" answer
- [ ] `docker-compose.yml` contains no `:latest` image, and its third-party tags match `helm/neodem/values.yaml`
- [ ] Unit tests cover the backoff, reset, transition logging and the compose pins

## Test Strategy

- `cd robot-agent && npm run typecheck && npx vitest run`
- `cd server && npm run typecheck && npx vitest run src/storage/__tests__/compose-image-pins.test.ts`
- `docker compose -f docker-compose.yml config -q`

## Notes

- Out of scope: `helm/neodem/values.yaml` keeps `tag: "latest"` for the four
  NeoDEM images on purpose (see the comment in `.github/workflows/build-images.yml`).
  The illustrative monitoring snippets in `docs/nats-rustfs.md` (prometheus,
  grafana, nats-box, minio/mc) still say `latest`.
- `PeerTracker` (`agent-mode/peers.ts`) already throttles its failure log and was left unchanged.
