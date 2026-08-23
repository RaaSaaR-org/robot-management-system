---
id: TASK-214
aliases:
- TASK-214
title: Replace the camera stream's URL token with a short-lived scoped ticket
slug: replace-the-camera-stream-url-token-with-a-scoped-ticket
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- compliance
sprint: ''
depends_on: []
status_note: 'DONE 2026-08-23. `?access_token=` is gone: the stream now authenticates from a `?ticket=` signed with JWT_SECRET (HMAC-SHA256, security/cameraTicket.ts) that names one robot, one camera and a 120 s expiry, and carries the asker''s identity so the stream lands in the same tenant scope the ticket request had. TWO THINGS THIS TASK GOT WRONG, corrected in the implementation: (1) the frontend builder is NOT in vrUrls.ts — that file only knows the robot agent''s base URL. `cameraStreamUrl` was module-private in HeadCameraPanel.tsx and now lives in a new features/robots/api/cameraApi.ts. (2) The task says the middleware''s narrowness was verified against /voice/events; that verification was manual and NOTHING held it down — `grep -rn cameraStreamQueryToken server/src` matched only its own definition and its mount. There are now tests for it. A ticket cannot be promoted to a bearer header the way the old access token was (authMiddleware would reject it), so the verifier establishes the identity itself and marks the request with a module-private Symbol — unreachable from any header or body field — which authMiddleware honours for the tenant hand-off. THREE `<img>` consumers exist, not one: HeadCameraPanel (VR, was the only one sending a credential) and CockpitViewport are converted; datacollection/CameraStreamView is NOT — it is outside the frontend scope this task names (`under app/src/features/robots/`), it never sent a credential, and it 401s with auth on exactly as it did before. Worth its own task. The hardest spot was the VR panel''s re-arm, which runs inside useFrame and cannot await: the rate-limit stamp is now taken BEFORE the ticket fetch, so a slow endpoint cannot become a per-frame POST storm.'
due_date: ''
created: 2026-08-22
updated: 2026-08-23
---


# Replace the camera stream's URL token with a short-lived scoped ticket

## Description

The live camera stream authenticates via `?access_token=` in the URL, because an `<img>` tag cannot
set an `Authorization` header. This was accepted deliberately in PR #236 as the smallest change that
made the feature work at all; the token is the user's real access token and a URL is a bad place to
keep one. Replace it with a ticket that is scoped to one robot and one camera and expires in minutes.

## Details

### Current state

`server/src/middleware/auth.middleware.ts` exports `cameraStreamQueryToken`, mounted in
`server/src/app.ts` as `app.use('/api/robots', cameraStreamQueryToken, authMiddleware, robotRoutes)`.
It moves `?access_token=` into the `Authorization` header, and only then:

- `req.method !== 'GET'` → pass through untouched
- `req.headers.authorization` already set → pass through untouched
- path must match `CAMERA_STREAM_PATH` = `/^\/[^/]+\/camera\/[^/]+\/?$/`

It grants nothing by itself — `authMiddleware` still validates whatever ends up in the header.

A review pass verified the narrowness empirically against the real mount order: the token reaches
only `GET /:id/camera/:name` and never `voiceRoutes` or the other routers sharing `/api/robots`; no
mutating route is reachable; encoded-slash smuggling (`head%2f..%2f..%2fvoice%2fevents`) fails closed
at the agent's `/^[A-Za-z0-9_-]+$/` check in `robot-agent/src/api/rest-routes.ts`. The practical leak
is also smaller than it first looks: `app.ts` installs no request logger, and the consumer
(`app/src/features/robots/components/tabs/vr/HeadCameraPanel.tsx`) builds the `<img>` detached via
`document.createElement`, so it never enters browser history and sends no `Referer`.

What remains is real all the same: the full access token sits in a URL, so it lands in any access log
added later, in any proxy in front of the server, and in anything that captures a URL.

### Server

Add a ticket endpoint and verifier:

- `POST /api/robots/:id/camera/:name/ticket` — behind `authMiddleware` as normal. Returns
  `{ ticket, expiresIn }`. The ticket is signed (reuse `server/src/security/`), carries `robotId`,
  `cameraName`, an expiry of ~120 s and a nonce, and is NOT a bearer credential for anything else.
- Verify it in place of `cameraStreamQueryToken`: same mount position, same three guards (GET only,
  the camera path only, no existing header), but resolving a ticket rather than promoting a token.
  A ticket for a different robot or camera than the one in the path must be rejected.
- Delete `cameraStreamQueryToken` and its `CAMERA_STREAM_PATH` regex once nothing uses them.

### Frontend

`app/src/features/robots/components/tabs/vr/vrUrls.ts` builds the stream URL (`cameraStreamUrl`).
Fetch a ticket first, then build the URL with it. Two consumers matter:

- `HeadCameraPanel.tsx` — note it already re-arms its own stream every `REARM_INTERVAL_S` (5 s) while
  stale, so the re-arm path needs a fresh ticket too, not a cached one.
- Any other `<img>`-based camera view under `app/src/features/robots/`.

A stream that outlives its ticket must keep running: the ticket authorises OPENING the stream, not
each frame. Only re-arming needs a new one.

## Test Strategy

- Unit: a ticket for robot A does not open robot B's camera; a ticket for `head` does not open
  `wrist`; an expired ticket is refused; a ticket is refused on any non-GET and on any path outside
  the camera stream route.
- Unit: no `?access_token=` remains anywhere in the app's URL construction (grep guard in a test).
- Integration: with `AUTH_DISABLED=false`, the VR camera panel renders frames, and the re-arm after a
  simulated sidecar restart also renders frames (proves the re-arm gets a fresh ticket).
- Regression: `server/src/__tests__` coverage that the middleware still refuses to promote anything on
  `/api/robots/:id/voice/events` and friends — the property the current shim was checked against.
