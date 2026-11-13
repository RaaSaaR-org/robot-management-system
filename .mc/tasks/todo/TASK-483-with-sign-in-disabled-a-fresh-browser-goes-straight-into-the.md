---
id: "TASK-483"
aliases: []
title: "With sign-in disabled, a fresh browser goes straight into the app"
slug: "with-sign-in-disabled-a-fresh-browser-goes-straight-into-the"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["core", "auth", "demo"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# With sign-in disabled, a fresh browser goes straight into the app

## Description

On a server running with `AUTH_DISABLED=true` every API request is already the one shared
super-admin, but the app did not know that. `authStore.initialize()` returned "not signed
in" whenever `localStorage.access_token` was missing, before it ever called
`/api/auth/me`, and the route guard then sent the browser to `/login`. Seen on the demo
instance on 2026-11-13: any app URL in a browser without a stored session — a deep link
to a dataset's episodes, the landing page's "Open App" — ended on a sign-in form that no
credentials exist for, and "Sign out" in the user menu dropped to the same dead end.

The identity shown in that mode was a developer placeholder as well: "Dev User",
`dev@neodem.local`, and a "member since" date that `/me` stamps with the time of the
request.

What changes:

- **Server.** `GET /api/config/features` (public, booleans only) carries
  `signInRequired`, false only under `AUTH_DISABLED=true`. It tells a caller nothing it
  could not learn by calling a protected route without a token. The shared user's display
  name comes from `ANONYMOUS_USER_NAME`, defaulting to "Demo user" under
  `NODE_ENV=production` and "Dev User" elsewhere; id and email stay fixed because rows
  reference them. The seeded user row is renamed on boot to match.
- **App.** With no stored token the auth store asks the feature snapshot first. When
  sign-in is not required it loads `/api/auth/me` and is signed in as the shared user;
  otherwise — sign-in required, an older server that omits the flag, or a snapshot that
  cannot be read — it behaves as before. The shell's guard (`RequireSession`) redirects to
  `/login` only where sign-in exists; without it, a server that does not answer gets a
  "Can't reach the server / Try again" state. `/login` itself leads to the dashboard in
  that mode.
- **Chrome.** Without sign-in the user menu replaces "Sign out" with a sentence saying
  sign-in is turned off and the account is shared, and leaves out the placeholder
  address. The account page drops Sign out, the address, "Member since" / "Last sign-in",
  and the password and two-step panels, none of which apply to the shared user.

## Acceptance Criteria
- [x] `GET /api/config/features` reports `signInRequired: false` under
      `AUTH_DISABLED=true` and `true` otherwise, and still returns booleans only.
- [x] Sign-in off: a browser with empty storage opening a deep link renders that page as
      the server's user, with no `/login` redirect and no token stored.
- [x] Sign-in off: `/login` leads to the dashboard; the landing page's "Open App" reaches
      the dashboard.
- [x] Sign-in off: the user menu and the account page offer no "Sign out" and say why.
- [x] Sign-in off, server not answering `/me`: a retry state, never the sign-in form.
- [x] Sign-in on: a browser without a session on a deep link still goes to `/login`
      without calling `/me`; a stored session opens the page; a 401 with a rejected
      refresh — at boot or mid-session — drops the tokens and goes to `/login`.
- [x] An older server (no flag) or an unreadable snapshot counts as sign-in required.
- [x] Under `NODE_ENV=production` the shared user is "Demo user"; `ANONYMOUS_USER_NAME`
      overrides it; development keeps "Dev User".
- [x] Looked at in a real browser against a local `AUTH_DISABLED=true` production build,
      at 1280x720 and 1440x900, and against a sign-in-required server.

## Notes

- The Vite dev server (`import.meta.env.DEV`) and the static demo build still log in the
  bundled mock user in `AuthProvider`; this task leaves that path alone. The fix is for
  production builds, which is what the demo instance runs.
- Not covered: other pages that list users from the database (Team) still show the
  shared user's `dev@neodem.local` address.
