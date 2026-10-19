---
id: "TASK-420"
aliases: []
title: "The docs describe the data-collection flow as it now works, including remote testing"
slug: "the-docs-describe-the-data-collection-flow-as-it-now-works"
status: done
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "low"
due_date: ""
created: "2026-10-19"
updated: "2026-10-19"
---

# The docs describe the data-collection flow as it now works, including remote testing

## Description

TASK-401..419 (PRs #424–#442) replaced the terminal bringup and the fixed-count
recording with the readiness panel, the robot supervisor, open-ended sessions,
explicit takes and a shared two-person live session. The docs lag behind: the
two-person runbook still names old labels, the sim rehearsal robot has no install
steps, and nothing says how to test the flow from a laptop over Tailscale, where
WebXR needs a secure origin. This task brings the docs in line with the merged
code. Docs only.

## Details

**Current state:** `docs/data-collection-two-person.md` (TASK-414) is the
session runbook; `docs/g1-edu-lab-bringup.md` "Start the robot side from NeoDEM"
covers the supervisor for `g1-edu-4` and runs the sim profile only by hand;
`docs/vr-teleop-data-collection.md` is the single-operator runbook;
`docs/platform.md` states the teleop maturity; `CLAUDE.md` has a Documentation
table.

**Key files:**

- `docs/data-collection-two-person.md` — the session runbook: setup order
  (Start robot side → Take control → Switch to arm control → Stand up → Balance →
  Connect / Open on headset → Launch VR → Take control → Enter VR), open-ended
  sessions and takes, the quick check, the live link's 4 h rule, the
  warnings table's E-stop labels, and a new "Remote testing over Tailscale"
  section (SSH tunnel to :1420, `?xremu`, a Quest on the remote laptop via
  `adb reverse`, the Chrome insecure-origin flag as a fallback).
- `docs/g1-edu-lab-bringup.md` — the sim rehearsal robot as a systemd user unit
  (`neodem-robot-supervisor@sim-g1-edu-dev`, port 18766, the shared server token,
  `ROBOT_SUPERVISORS` with both entries).
- `docs/vr-teleop-data-collection.md` — the in-headset robot panel's buttons.
- `docs/platform.md` — the Teleoperation and VR note.
- `CLAUDE.md` — Documentation table rows for the runbooks.

Every label, route and env name is read from the merged code
(`app/src/features/robots/components/readiness/`, `.../tabs/vr/`,
`app/src/features/datacollection/`, `app/vite.config.ts`,
`app/src/shared/utils/websocket.ts`, `robot-agent/supervisor/`,
`server/src/services/robot-supervisor/`).

## Acceptance Criteria

- [ ] The two-person runbook walks one lab session from the readiness panel to the last take, with labels that match the app.
- [ ] The warnings table names the current E-stop reset labels (headset: **Hold 1 s to reset**; desktop VR window: **Reset E-stop**).
- [ ] The sim rehearsal robot can be installed and started as a systemd user unit from the lab bringup doc, with no real token in the repo.
- [ ] A "Remote testing over Tailscale" section says exactly which ports to forward and why, and where Connect / Open on headset do not apply.
- [ ] `CLAUDE.md` lists the runbooks; `docs/platform.md`'s teleop note matches the current state.

## Test Strategy

Docs only. Every relative link in the touched docs resolves to an existing file
and heading (checked with a local script); labels are grepped against the app
source. CI runs the normal Check workflow.

## Notes (2026-10-19)

- Remote testing needs only port 1420: `app/vite.config.ts` proxies `/api` with
  `ws: true`, and `getWebSocketUrl` uses the page origin unless
  `VITE_WS_URL`/`VITE_API_BASE_URL` are set. `?xremu` activates only in a dev
  build on `localhost`/`127.0.0.1` (`EMULATOR_ACTIVE`), and the live redirect
  drops the query, so the doc opens the session URL directly.
- The headset must hold the lease before Enter VR (`canEnterVr` needs
  `leaseAllows`); the old step 5 said Enter VR takes it.
- Found, not changed: `docs/api.md` does not list the take routes under
  `/api/teleoperation` (start/stop/next/discard, live state); the desktop VR
  window's controller legend still says "Reset E-stop: hold 1 s" while the
  in-headset button reads "Hold 1 s to reset" (`VRTeleopModal.tsx`).
