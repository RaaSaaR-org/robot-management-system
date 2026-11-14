---
id: "TASK-503"
aliases: []
title: "The Skill Training overview counts imported datasets and registered models, the compliance score reflects overdue deadlines, and a failed feature check keeps the deep link"
slug: "the-skill-training-overview-counts-imported-datasets-and"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["demo", "ui", "pipeline", "compliance", "auth", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-14"
updated: "2026-11-14"
---

# The Skill Training overview counts imported datasets and registered models, the compliance score reflects overdue deadlines, and a failed feature check keeps the deep link

## Description

A review of the live instance (https://neodem.emai.dev) two days before the
demo day on 2026-11-16 found eight places where a page contradicts what is on
the instance or looks unfinished. This task fixes them with the smallest change
each: seven in the app, one in the server's compliance score.

## Details

### 1. Skill Training overview (`/pipeline`)

**Current state.** With four imported datasets and one uploaded model the page
read Collect "Not started", Train "Up next · Ready to train", Evaluate and
Deploy "Waiting". `fetchTrain` in
`app/src/features/pipeline/pages/PipelinePage.tsx` counted training jobs only;
`fetchCollect` counted teleop sessions only.

**Change.** With no training job, `fetchTrain` reads the model registry
(`deploymentApi.listModelVersions()`); one or more versions make the stage
`done` with "N model(s) registered". A registry that cannot be read leaves the
stage as before. With no session but at least one dataset, Collect is `done`
with "Datasets imported". Evaluate then unblocks through the existing rule.

### 2. Simulation > Scenes previews

`SceneCard` in `app/src/features/simulation/components/ScenesView.tsx` hid the
`<img>` on error and left an empty box. It now remembers the failure and renders
the `Boxes` icon the card already uses for a scene without a preview. The 404s
themselves stay until the server image ships previews.

### 3. A failed `/api/config/features` on a hard reload

**Current state.** `useFeatures` keeps `signInRequired: true` until the
snapshot loads. `RequireSession`
(`app/src/features/auth/components/RequireSession.tsx`) read that default as an
answer, so one failed request sent a token-less browser to `/login`, and from
there to `/dashboard` — the deep link was gone.

**Change.** While the snapshot is not loaded, `RequireSession` sends nobody
away: a visitor without a session sees the existing "Can't reach the server"
screen with "Try again" once the request failed (a spinner while it is still
running), worded without "No sign-in is needed here" because that is not known
yet. A stored session still opens the page. Once the snapshot arrives the
existing paths take over: `authStore`'s subscriber loads the shared user where
no sign-in is needed, and a server that requires sign-in sends the visitor to
`/login` then.

### 4. Theme flash

The inline script in `app/index.html` fell back to `'system'` with nothing
stored, while `themeStore` defaults to `'dark'`: a light-mode laptop painted
light first. The fallback is `'dark'`.

### 5. Favicon

`app/public/favicon.svg` is the NeoDEM orbital mark
(`app/src/components/common/NeoDEMMark.tsx`) in its dark-theme colors on a
canvas tile (the "app icon" variant of `docs/brand.md`); `app/index.html` links
it instead of the stock `vite.svg`.

### 6. `/register` on a server without sign-in

`app/src/features/auth/pages/RegisterPage.tsx` redirects to `/dashboard` when
the loaded flags say `signInRequired: false`, as `LoginPage` does. The server
endpoint is unchanged.

### 7. Compliance overview

**Current state.** `calculateFrameworkScores` in
`server/src/services/ComplianceTrackerService.ts` scored a framework from open
gaps only, so every framework read "100 % Compliant" next to two deadlines more
than a year overdue, including frameworks with nothing tracked.

**Change (server).**

- A deadline that is past due with requirements still open — the rule
  `getRegulatoryDeadlines` already uses for "overdue" — costs 20 points (as
  much as a critical gap), counts as an open item, and sets the framework's
  status to `overdue`.
- A framework with no gap and no deadline gets the new status `not_assessed`
  (score 0, not shown) and is left out of the overall score. With nothing
  assessed at all the overall score stays 100 in the API, as before.

**Change (app).** `ComplianceStatus` gains `not_assessed` ("Not assessed").
`app/src/features/compliance/components/ComplianceDashboard.tsx` shows such a
framework without a bar and with "Nothing tracked yet"; the score tile says how
many frameworks it covers and shows "—" when none is assessed.

On the demo instance the two frameworks with an overdue deadline drop to 80 and
read "Overdue"; frameworks without deadlines read "Not assessed".

### 8. Model details dialog

`app/src/features/deployment/components/models/ModelDetailsModal.tsx` was a
512 px column with metrics and files below the fold. It is now `4xl` wide and,
from the `lg` breakpoint, two columns: facts, URIs and notes on the left;
metrics, stored files, experiments and comments on the right. Display only.

### Key files

- `app/src/features/pipeline/pages/PipelinePage.tsx`
- `app/src/features/simulation/components/ScenesView.tsx`
- `app/src/features/auth/components/RequireSession.tsx`
- `app/src/features/auth/pages/RegisterPage.tsx`
- `app/index.html`, `app/public/favicon.svg`
- `app/src/features/compliance/components/ComplianceDashboard.tsx`
- `app/src/features/compliance/types/compliance-tracker.types.ts`
- `app/src/features/deployment/components/models/ModelDetailsModal.tsx`
- `server/src/services/ComplianceTrackerService.ts`

## Acceptance Criteria

- [x] `/pipeline` with datasets, no sessions, no jobs and one registered model: Collect "Done · Datasets imported", Train "Done · 1 model registered", Evaluate "Up next"
- [x] A scene card whose preview fails to load shows the scene icon
- [x] A failed feature snapshot shows "Can't reach the server" with a retry on the deep link; the sign-in redirect only happens once the server says sign-in is required
- [x] `app/index.html` falls back to `dark`; the favicon is the NeoDEM mark
- [x] `/register` opens `/dashboard` where sign-in is not required
- [x] An overdue, uncompleted deadline lowers its framework's score and makes it "Overdue"; a framework with nothing tracked is "Not assessed" and outside the overall score
- [x] The model details dialog shows metrics and files beside the facts on a desktop viewport

## Test Strategy

- `app`: `npx tsc`, `npx vitest run` — new `PipelinePage.test.tsx`,
  `ScenesView.test.tsx`, `ComplianceDashboard.test.tsx`; extended
  `RequireSession.test.tsx`, `RegisterPage.test.tsx`, `UploadedModel.test.tsx`
- `server`: `npm run typecheck`, `npx vitest run` —
  `ComplianceTrackerService.test.ts`
- `app`: `npx playwright test` (the demo-build gate; covers `/pipeline`,
  `/models`, `/compliance`, the simulation tab)

## Notes

- Not checked in a browser against live data: the dialog's layout at
  1440×900 and the favicon at 16 px. Both want a look after the deploy.
- The compliance score on the demo instance changes visibly with this
  (two frameworks at 80 "Overdue", the rest "Not assessed" or 100). That is the
  intent, but the presenter should see it before Monday.
- Left for later: the 404s of `/api/simulation/preview/*` themselves, closing
  the `/register` endpoint on the server, returning to the original path after a
  real sign-in, and writing `?model=` into the URL when a model row is opened.
