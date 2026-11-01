---
id: "TASK-397"
aliases: []
title: "A Quest without internet access still reports its controllers to NeoDEM"
slug: "a-quest-without-internet-access-still-reports-its"
status: "done"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1", "teleop", "vr"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# A Quest without internet access still reports its controllers to NeoDEM

## Description

On the real G1 the Meta Quest 3 joined the VR teleop session, but the arms never
armed: the grip was never seen, so the clutch stayed false. The headset was on a
Wi-Fi without internet access. The VR session must get its controllers from the
NeoDEM app itself, not from a CDN.

## Details

**Root cause.** `@react-three/xr` (`@pmndrs/xr` 6.6.30) creates a controller
input-source state only after it has fetched the controller's WebXR input
profile, by default from
`https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/`.
Without internet that fetch fails, no controller state is created, the grip is
never read, and the clutch is always false.

**Fix.**

- `app/public/xr-profiles/` ships `profilesList.json` and the `profile.json` of
  every profile a Quest 3 controller or hand can report or fall back to:
  `meta-quest-touch-plus`, `oculus-touch-v3`, `oculus-touch-v2`, `oculus-touch`,
  `generic-trigger-squeeze-thumbstick`, `generic-trigger`, `generic-hand`.
- `app/src/features/robots/components/tabs/vr/vrConstants.ts` exports
  `XR_PROFILES_BASE`, the absolute URL of that folder on the app's own origin
  (absolute because the loader resolves files with `new URL(file, base)`).
- `app/src/features/robots/components/tabs/vr/VRTeleopModal.tsx` passes it to
  `createXRStore({ baseAssetPath: XR_PROFILES_BASE })`.

**Key files**

- `app/public/xr-profiles/**`
- `app/src/features/robots/components/tabs/vr/vrConstants.ts`
- `app/src/features/robots/components/tabs/vr/VRTeleopModal.tsx`
- `app/src/features/robots/components/tabs/vr/__tests__/vrXrProfiles.test.ts`

## Acceptance Criteria

- [x] The XR store loads input profiles from `XR_PROFILES_BASE`, not jsdelivr.
- [x] `XR_PROFILES_BASE` is an absolute URL on the app's origin ending in `/xr-profiles/`.
- [x] Every profile a Quest Touch Plus controller falls back to exists under
      `app/public/xr-profiles/` at the path `profilesList.json` names.
- [x] With the headset on a network without internet, the grip arms the arms
      (verified on the real G1 on 2026-10-17).

## Test Strategy

- `cd app && npx vitest run src/features/robots/components/tabs/vr/` —
  `vrXrProfiles.test.ts` checks the base URL and the shipped profiles.
- `cd app && npx tsc`.
- On hardware: Quest on a Wi-Fi without internet, open the VR teleop session,
  squeeze a grip — the HUD shows the arm engaged.

## Notes

Found and fixed live on the real G1 on 2026-10-17; this task lands the fix.
