---
id: "TASK-448"
aliases: []
title: "A camera view that leaves the page closes its stream"
slug: "a-camera-view-that-leaves-the-page-closes-its-stream"
status: "done"
priority: 1
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# A camera view that leaves the page closes its stream

## Description

Chromium keeps downloading an MJPEG `<img>` that React removed from the page until its `src` is
cleared, and `CameraStreamView` never clears it. Every time a camera view leaves the page, its
stream stays open. Over plain HTTP a browser allows six connections per server, so a handful of
leaked streams leave the session page's API calls (cameras, live state, takes, tickets) queued,
with no answer.

## Details

### Current state

- `app/src/features/datacollection/components/CameraStreamView.tsx` renders `<img ref={imgRef} src={streamUrl}>`
  while `live` (~191-198) and lets React remove it. Nothing clears `src` on removal.
- Where a camera view leaves the page on `main` today:
  - `components/console/LiveView.tsx` replaces the whole body with "The VR window is open on this
    browser" while `suspended`. Entering VR on the Quest therefore leaks the head stream once per
    VR entry.
  - The robot going offline.
  - Leaving the session page.
  - With TASK-442 (wrist tiles, PR #466), every tile swap.
- An integration run on 2026-10-31 found two cases on a Head + wrists session page where the page
  got no answers from the server: after two tile clicks, and as soon as VR opened. A removed
  stream still received ~180 KB/s.
- The VR side already does it right:
  `app/src/features/robots/components/tabs/vr/useCameraReconnect.ts` (~185-193) and
  `HeadCameraPanel.tsx` set `image.src = ''` when they let go.
- React is 19, so a callback ref may return a cleanup function.

### Frontend

1. When the stream `<img>` leaves the DOM (the component unmounts, or `live` turns false), set
   its `src` to `''`, as the VR side does. Use a callback ref whose identity is stable across
   renders: a new ref function on every render would run the cleanup on every render and kill the
   live stream. Keep `imgRef` working for the snapshot effect.
2. The `error` event that an emptied `src` fires must not:
   - count as a failure,
   - mark a later URL as failed,
   - start a retry or warn on an unmounted component.
   Prove each in tests.
3. Search the app for every other `<img>` that shows a ticketed MJPEG stream
   (`cameraStreamUrl`, `useCameraStreamUrl`, `/stream`), for example a camera tab on the
   robot detail page. Apply the same release there. When there are two or more sites, share one
   small hook instead of copying the logic.

## Acceptance Criteria

- [x] Unmounting `CameraStreamView`, or its robot going offline, clears the stream `<img>`'s `src`.
      A re-render with the same URL does not touch `src`. A ticket change on a mounted view
      leaves the new URL in place.
- [x] The emptied-`src` `error` event causes no retry, no failure count and no failed-URL mark.
- [x] In a real Chromium the following leave a constant number of open stream connections on
      the server. Before this change the count grows.
      - On a head-only session page: opening and closing the VR window five times on the same
        browser, and leaving and returning to the session page three times.
      - On a Head + wrists session page (with TASK-442): swapping wrist tiles.
- [x] App typecheck, vitest and the Playwright demo gate are green.

## Test Strategy

- Vitest for `CameraStreamView` covering unmount, offline, re-render, ticket change and the
  error-event paths.
- Count live connections in a real browser against the integration stack in
  `rms-wt/integration-439`, before and after, and put the numbers in the PR.

