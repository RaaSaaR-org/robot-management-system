---
id: "TASK-396"
aliases: []
title: "A VR data-collection session has one Take control, in the VR window"
slug: "a-vr-data-collection-session-has-one-take-control-in-the-vr"
status: "done"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "vr", "datacollection", "teleop"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "medium"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# A VR data-collection session has one Take control, in the VR window

## Description

Found live on a real Meta Quest 3 in a `vr_quest` data-collection session: the session
page showed two "Take control" controls — the page's Control panel and the one inside
the VR window. Taking control on the page made the VR window report "Robot in use. Dev
User is controlling this robot." and "Enter VR" stayed disabled, because the server
grants one lease per robot. A real-headset session must have exactly one control: the
VR window's.

## Details

**Current state.** `app/src/features/datacollection/pages/SessionDetailPage.tsx` ran
`useSessionControlLease(...)` with `leaseInputs = gamepadEligible || sessionIsVr` and
rendered `<ControlLeaseBar>` in the `session-control-lease` panel. For a VR session
that page lease only serves the simulated-VR input (`useSimulatedVrInput`, gated by
`useInputLeaseGate`). The VR window (`VRTeleopModal.tsx`, opened from
`VRTeleopSection`) holds its own `useControlLease` and gates "Enter VR" on it.
`utils/preflight.ts` already does not require the page lease for VR session types.

### Frontend

- `SessionDetailPage.tsx` owns the "Simulate VR input" switch state and sets
  `leaseInputs = gamepadEligible || (sessionIsVr && simulateVr)`. Without simulation
  a VR session opens no page lease socket and shows no Control panel; with it, the
  page lease comes up for the simulated input as before. Gamepad and keyboard sessions
  are unchanged.
- `components/VRSessionPanel.tsx` takes `simulate` / `onSimulateChange` (local state
  when not passed) and, while simulating, passes `launchDisabledReason` to
  `VRTeleopSection`.
- `robots/components/tabs/vr/VRTeleopSection.tsx` gains optional
  `launchDisabledReason`: "Launch VR" is disabled and the reason replaces the hint, so
  the page lease and the VR window's lease are never both offered. The Teleop tab
  passes nothing and is unchanged. `VRTeleopModal`'s lease logic is untouched.

**Key files**
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/features/datacollection/components/VRSessionPanel.tsx`
- `app/src/features/robots/components/tabs/vr/VRTeleopSection.tsx`
- `app/src/features/datacollection/pages/__tests__/SessionDetailPage.vrLease.test.tsx` (new)

## Acceptance Criteria
- [x] A `vr_quest` session without "Simulate VR input" shows no `session-control-lease` panel and never activates the page lease.
- [x] Switching simulation on activates the page lease and shows its Control panel; switching it off drops both.
- [x] While simulating, "Launch VR" is disabled with a hint saying why.
- [x] Gamepad / keyboard sessions keep their page lease as before.

## Test Strategy

`SessionDetailPage.vrLease.test.tsx` renders a recording `vr_quest` session with the
lease capability on, records the `active` argument `useSessionControlLease` receives,
and asserts: no Control panel and `active` always false before the toggle; panel shown,
`active` true and "Launch VR" disabled after it; both gone after toggling off. The test
fails against the old `leaseInputs`. App `npx tsc` and the datacollection + robots
vitest suites pass. Live check: on a Quest, a `vr_quest` session page shows a single
"Take control", inside the VR window, and "Enter VR" enables after taking it.
