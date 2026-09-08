---
id: "TASK-253"
title: "Authenticate robot platform callbacks"
slug: "authenticate-robot-platform-callbacks"
status: "done"
priority: 2
owner: "huhn511"
tags: ["core"]
created: "2026-09-08"
updated: "2026-09-08"
spe: 5
effort: "medium"
---

# Authenticate robot platform callbacks

## Description

An authenticated NeoDEM server rejects robot events, photos, identity reports, compliance logs, patrol routes and place graph requests because these platform-bound clients omit credentials. Some clients report success on HTTP rejection. The agent already uses NEODEM_SERVICE_TOKEN for journal retention and host tour routes; reuse that configuration and the existing server service-account authentication.

## Details

Add a small shared header helper following the existing token use in agent-mode/journal.ts and TourRouteSource. Apply it only to requests destined for the configured NeoDEM server: ServerMirror event/photo pushes, identity re-registration in index.ts, ComplianceLogClient, PatrolRouteSource and place-graph-source. Check response.ok before recording/reporting success. Preserve failure/retry behavior and unauthenticated development mode. Do not send platform credentials to VLA, sidecar, arbitrary media or third-party requests. Document token provisioning and pass through compose agent environment. Correct Docker-internal advertised robot URL if confirmed by current registration/network contracts.

## Acceptance Criteria

- [x] Platform callbacks send the configured service credential and work with authentication enabled.
- [x] Rejected HTTP responses never count as accepted delivery; retry/error behavior remains truthful.
- [x] No configured token preserves development requests; third-party/sidecar requests receive no platform credential.
- [x] Agent environment examples and compose describe/wire the token and reachable server callback URL.
- [x] Focused regressions and agent typecheck/full tests pass; independent review and PR CI pass before merge.

## Test Strategy

Use existing client unit-test anchors to assert headers, successful responses, authorization rejection and retries. Where practical use a local HTTP server to test real requests. Verify compose configuration without changing running user services. No real robot movement.

Validation: typecheck and all 2,341 agent tests passed (136 files); focused HTTP/client suite passed 135 tests across five files. Compose configuration validates. Independent review of origin/main...31b64d04 confirmed actual server routes, service-token authentication and role compatibility. PR #298 passed initial CI; final close-commit checks are required before merge.
