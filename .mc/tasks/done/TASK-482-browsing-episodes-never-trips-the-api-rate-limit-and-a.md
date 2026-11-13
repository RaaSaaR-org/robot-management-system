---
id: "TASK-482"
aliases: []
title: "Browsing episodes never trips the API rate limit, and a throttled request recovers on its own"
slug: "browsing-episodes-never-trips-the-api-rate-limit-and-a"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "security", "api"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "high"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# Browsing episodes never trips the API rate limit, and a throttled request recovers on its own

## Description

Found in a hands-on browser test of the demo instance on 2026-11-13, on the path
the demo on 2026-11-16 walks: the dataset episode browser.

**The limit.** In production every request under `/api` shared one budget of 100
per minute per client address (`server/src/app.ts`). Opening the episodes page
costs about 20 requests and each episode click about 8 — three or four of them
video Range requests, plus frames, three social calls and now and then a video
ticket. Clicking through six to nine episodes inside a minute spent the budget.

**What a 429 looked like.** Nothing told the viewer anything:

- the `<video>` got a 429 and became a blank player (`MEDIA_ELEMENT_ERROR`);
- the joint chart stayed a skeleton for 9–25 s;
- the Curate panel's "End frame" and the chart's "N samples" kept the previous
  episode's numbers, and the transport kept a Pause icon over a video that was
  not playing;
- when `/api/auth/me` was the request that got the 429, the whole page was a
  spinner on an empty screen (seen on `/settings` and
  `/compliance?tab=approvals`).

**Who shares a budget.** `app.set('trust proxy', 1)` makes `req.ip` the last
entry of `X-Forwarded-For`. Behind Cloudflare plus one ingress that entry is the
Cloudflare edge node, not the visitor: everyone arriving through the same edge
shared the 100. And the limiter's skip for `/api/compliance` never matched — it
compared a mount-relative path against a full one.

## Decisions

- **Three budgets, not one bigger one** (`server/src/middleware/rateLimit.ts`):
  *general* (1200/min), *dataset browsing* (3000/min: episode list, frames,
  stats, modality, video incl. Range, video ticket) and *writes* (300/min, every
  non-GET, counted in addition to general). Browsing gets its own budget rather
  than an exemption, so it stays bounded but cannot starve — or be starved by —
  the rest of the API. Credential endpoints keep 5/min, MFA its own.
- **Configurable**: `RATE_LIMIT_MAX`, `RATE_LIMIT_MEDIA_MAX`,
  `RATE_LIMIT_WRITE_MAX`, `RATE_LIMIT_WINDOW_MS`; `RATE_LIMIT_DISABLED` as before.
  Outside production each budget stays 5000.
- **Client address = `req.ip` under a configurable `TRUST_PROXY`**, default `1`
  (unchanged). A hop count or a list of proxy addresses; `true` is refused, and
  `CF-Connecting-IP` / `X-Real-IP` are never read — both are headers anyone can
  send. The default stays 1 because a too-high count is spoofable while a
  too-low one is only coarse; a Cloudflare + one-ingress deployment sets
  `TRUST_PROXY=2` (see Notes).
- **The dead `/api/compliance` skip is removed**, not repaired: with a budget
  sized for the app nothing needs to be exempt from it.
- **Every 429 carries `Retry-After`**, and CORS exposes it to a cross-origin app.
- **The app waits, then retries by itself.** The API client already retried a
  429; a read now waits as long as `Retry-After` asks (up to one window) instead
  of at most 10 s, so one retry lands after the reset. A write is still held for
  at most 10 s. The retry stays on for writes: the server refused before doing
  anything.
- **One hint, only when it lasts.** Waits register in
  `app/src/api/rateLimitStatus.ts`; after 1.5 s a toast says "The server asked
  us to slow down — retrying automatically", and it leaves when the wait ends.
- **A known session opens the shell without waiting for `/auth/me`.** The
  persisted user renders the app at once and is confirmed behind it; only a
  401/403 ends the session. A browser with tokens but no remembered user still
  has to wait, and says why under its spinner.
- **A throttled video is told apart from a missing one** by asking for one byte
  of the same URL (`probeVideoThrottle`): on 429 the player waits `Retry-After`
  and remounts the video, up to four times, before it offers Retry.

## Acceptance Criteria

- [x] Dataset browsing requests are counted against their own budget; spending
      the general budget does not stop a video, and 150 browsing requests do not
      touch the general budget (`rateLimit.test.ts`).
- [x] General, browsing and write budgets and the window come from the
      environment, with production defaults of 1200 / 3000 / 300 per 60 s;
      documented in `server/.env.example` and `docs/deployment.md`.
- [x] The strict credential limiter is unchanged (`authRateLimit.test.ts`).
- [x] `TRUST_PROXY` selects the client address: with 2 hops each client behind
      Cloudflare has its own budget, a client-written `X-Forwarded-For` buys
      nothing, and `CF-Connecting-IP` / `X-Real-IP` are ignored.
- [x] A 429 from any of the three budgets carries `Retry-After`.
- [x] A throttled GET is retried after `Retry-After` and resolves; the hint is
      silent for a short wait and shown for a long one.
- [x] `/auth/me` answering 429 does not blank the shell for a known session.
- [x] While another episode's frames are on their way the chart shows no sample
      count, "End frame" shows that episode's own length, a typed trim range is
      not carried over, and the transport shows Play.
- [x] A rate-limited video waits and reloads by itself.
- [x] Browser: 30 episodes clicked in under a minute against a server started
      with `NODE_ENV=production` defaults — no 429 at 1280×720 or 1440×900.

## Notes

- Browser run (Chromium, NVIDIA apple dataset, 402 episodes): 30 episodes in
  53 s, 223–241 API responses, none 429; lowest remaining budget 1072/1200
  general and 2875/3000 browsing. A second run against a server with budgets of
  40 per 15 s showed the wait and the recovery: episode opened while throttled →
  quiet for the first moment → toast and "Waiting for the server" in the player
  → video and chart back by themselves after 13–14 s, no click.
- **Deployment follow-up, not in this repo:** an instance behind Cloudflare and
  one ingress should set `TRUST_PROXY=2` on the server. Until then it behaves as
  before (one budget per Cloudflare edge), only with budgets twelve times larger.
  With the Helm chart that is `server.env.trustProxy: "2"`; the budgets are
  `server.env.rateLimitMax` / `rateLimitMediaMax` / `rateLimitWriteMax` /
  `rateLimitWindowMs` (all empty by default, which keeps the server defaults).
- The counters are in memory per replica; a shared store is a separate decision.
- Not changed: clients that call `fetch` directly instead of `apiClient` do not
  get the retry.
