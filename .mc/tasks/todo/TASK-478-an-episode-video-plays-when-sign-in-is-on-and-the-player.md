---
id: "TASK-478"
aliases: []
title: "An episode video plays when sign-in is on, and the player says when the browser cannot decode it"
slug: "an-episode-video-plays-when-sign-in-is-on-and-the-player"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "auth"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# An episode video plays when sign-in is on, and the player says when the browser cannot decode it

## Description

Two defects in the dataset episode player, both of which leave a black box where a
video should be. The demo on 2026-11-16 shows three datasets imported from Hugging
Face on an instance with sign-in on, so both are on the demo path.

**(a) Sign-in on: every dataset video is a 401.** `GET
/api/datasets/:id/episodes/:index/video/:camera` (`server/src/routes/datasets.routes.ts`)
sits behind `authMiddleware`, which reads a bearer token from the `Authorization`
header only. The player is a `<video src>` (`EpisodeViewer.tsx`), and a `<video>`
cannot set that header — on its first request or on the Range requests it makes
while seeking. Reproduced on main at 64c03875 with `AUTH_DISABLED=false`: no header
→ 401, bearer → 206. The synthetic-dataset thumbnail (`DatasetCard.tsx`) and the
Cosmos result preview (`GenerateSyntheticModal.tsx`) build the same URL and fail the
same way.

**(b) A browser without the dataset's codec shows nothing.** Videos are served as
the dataset stores them; the demo datasets are AV1
(`features[camera].info["video.codec"]` in `meta/info.json`). A browser that cannot
decode AV1 — Safari without a hardware decoder — renders a silent blank player. A
plain load failure (404, network) is just as silent: the `<video>` has no `onError`.

## Details

### Server

- `server/src/security/datasetVideoTicket.ts` (create) — the camera stream's ticket
  pattern (`cameraTicket.ts`, TASK-214) for dataset videos: an HMAC-signed claim set
  `{kind: 'dataset-video', datasetId, userId, tenantId, role, exp, nonce}`, 15 minute
  lifetime, signed with `JWT_SECRET`. The signature covers a kind prefix, so a camera
  ticket never verifies as a video ticket and the reverse. Scoped to a dataset, not
  an episode: the player shows several cameras and steps through hundreds of
  episodes, and whoever may watch one episode of a dataset may watch them all.
- `POST /api/datasets/:id/video-ticket` — mints one for a dataset the caller can see
  (404 otherwise); `{ticket, expiresIn}`, `Cache-Control: no-store`. The ticket
  carries the tenant scope of the mint request, so a video requested by an
  impersonating super-admin resolves in the impersonated tenant.
- `datasetVideoTicket` middleware in `auth.middleware.ts`, mounted ahead of the first
  `...protect` on `/api/datasets`: GET only, the video path only, never when an
  `Authorization` header is present, and the ticket must name the dataset in the
  path. A ticket that fails any of these is not an identity and `authMiddleware`
  answers its usual 401.
- A viewer must be able to mint: the route joins `POST_SHAPED_READS` (it persists
  nothing and reads only the row `GET /api/datasets/:id` already serves).
- The access token never goes into a URL. `?ticket=` is already scrubbed from request
  logs (`utils/logger.ts`).
- No transcoding.

### App

- `api/datasetVideoApi.ts` (create) — `fetchDatasetVideoTicket`, a per-dataset cache
  that reuses a ticket for the first half of its life, and the URL builder
  (`?chunk=&file=&ticket=…#t=from,to`). `trainingApi.getEpisodeVideoUrl` takes the
  ticket as a fifth argument.
- `hooks/useDatasetVideoTicket.ts` (create) — `{ticket, ready, refresh}`. A failed
  ticket request leaves `ready` true with no ticket, so the bare URL is used and an
  instance with sign-in off behaves as before.
- `components/datasets/videoCodec.ts` (create) — reads the codec from an info.json
  feature, names it, and asks the browser (`canPlayType`, then
  `MediaSource.isTypeSupported`).
- `EpisodeViewer.tsx` — per camera: no `<video>` until the ticket is ready; a notice
  naming the codec and a browser that plays it when the browser says it cannot (no
  request is made) or when a decode error arrives; on any other error one silent
  reload with a fresh ticket, then "Couldn't load this video" with Retry.
- `DatasetEpisodesPage.tsx`, `DatasetCard.tsx`, `GenerateSyntheticModal.tsx` use the
  hook.

## Acceptance Criteria

- [x] With `AUTH_DISABLED=false`, the video route answers 401 with no credential and
      200 with a ticket a viewer minted; a `Range` request with the ticket answers 206
      with the right `Content-Range`.
- [x] A ticket opens only the video route of the dataset it names: another dataset,
      every other `/api/datasets` route, a non-GET, an expired ticket, a camera ticket
      and an access token in the query are all 401.
- [x] With auth disabled the video plays without a ticket and with one.
- [x] The episode page passes the dataset's ticket into every video URL, before the
      `#t=` fragment and next to a v3.0 `chunk`/`file` query.
- [x] When the browser reports it cannot play the dataset's codec, the player shows
      "This browser can't play AV1 video" with a browser that does, and mounts no
      `<video>`.
- [x] A video `error` event shows an error state with Retry instead of a blank box;
      an expired ticket recovers once on its own first.
- [x] No server-side transcoding is added.

## Test Strategy

- `server/src/security/__tests__/datasetVideoTicket.test.ts` — sign/verify, tamper,
  expiry, kind separation from camera tickets.
- `server/src/__tests__/dataset-video-ticket.test.ts` — a real `createApp()`, a real
  viewer JWT and an mp4 on disk: 401 / 200 / 206, scope, auth off.
- `server/src/__tests__/write-route-authorization.test.ts` — the mint is a declared
  POST-shaped read; a viewer can mint.
- App: `datasetVideoApi.test.ts`, `useDatasetVideoTicket.test.tsx`,
  `videoCodec.test.ts`, `EpisodeViewer.test.tsx`, and the pusht page test asserts the
  ticket reaches the URL.

## Notes

- Not checked in a browser that lacks AV1 decoding; the codec notice rests on
  `canPlayType` answering `''` there, which is what the tests simulate.
- After the silent reload the video restarts from the beginning of the episode; the
  page's play/pause state is not re-applied.
