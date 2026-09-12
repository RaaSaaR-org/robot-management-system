---
id: "TASK-284"
aliases: []
title: "Gate destructive robot actions in the client permission matrix"
slug: "gate-destructive-robot-actions-in-the-client-permission-matrix"
status: "in-progress"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: [core, app]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Gate destructive robot actions in the client permission matrix

## Description

The app ships a complete role-permission matrix and a `can()` helper that **no component ever
calls**. Every robot control — unregister, register, send-to-charge, return-home — renders for every
role, gated only on whether the robot is reachable. This task points the existing matrix at the
destructive robot actions so a `viewer` stops seeing controls the server refuses.

This is the client half of the same defect whose server half is [[TASK-282]]. It is deliberately
client-only: the server contract already exists after that task, and the server — not this — remains
the security boundary. What this fixes is a UI that invites a click it knows will fail.

## Details

### Current state

**The matrix exists and is complete.** `app/src/features/auth/types/auth.types.ts:24-36` declares a
12-member `Permission` union. The role maps at `:257-295`:

| role | permissions |
| --- | --- |
| `owner` / `super-admin` | all 12, including `robots:write`, `robots:command`, `fleet:manage` |
| `member` | `robots:read`, **`robots:command`**, `tasks:*`, `alerts:*`, `fleet:read` — **no `robots:write`** |
| `viewer` | `robots:read`, `tasks:read`, `alerts:read`, `fleet:read` only |

`hasPermission()` (`:304-312`) checks a user's explicit `permissions` array first, then falls back to
the role map.

**Nothing calls it.** `grep -rn "\bcan(" app/src` returns exactly two hits, and both are the
mechanism itself, not a use:

- `app/src/features/auth/components/ProtectedRoute.tsx:154` — the `requiredPermission` check.
- `app/src/features/auth/hooks/useAuth.ts:68` — a JSDoc example,
  `{can('robots:command') && <CommandButton />}`. **This is the house pattern to copy.**

`grep -rn requiredPermission app/src` hits only `ProtectedRoute.tsx` itself (`:107` JSDoc example,
`:121` the prop, `:154` the check). The two real `<ProtectedRoute>` uses in `app/src/App.tsx`
(`:109`, `:371`) pass only `onUnauthenticated`.

`can()` is reachable three ways, all already exported: `useAuth()`
(`app/src/features/auth/hooks/useAuth.ts:75`, `can` at `:108-111`), `useAuthContext()`
(`app/src/app/providers/AuthProvider.tsx:165`, `can` at `:114`), and the single-permission
`usePermission(permission)` (`useAuth.ts:193`) — the cleanest choice for a component needing one
check. All are re-exported through the `app/src/features/auth` barrel.

**The control sites, all currently ungated by role:**

- `app/src/features/robots/components/RobotList.tsx:115-118` — `actionsFor()` builds the row menu;
  `:117` is the `Unregister` item (`tone: 'danger'`), calling `askUnregister` (`:96-113`).
- `app/src/features/robots/components/RobotList.tsx:44` — the `onRegister` prop, wired from
  `app/src/features/robots/pages/RobotsPage.tsx:18` to `RegisterRobotModal`. The toolbar button that
  calls it is in `RobotList.tsx`.
- `app/src/features/robots/components/RobotDetailPanel.tsx:109-125` — `handleUnregister`, rendered
  at `:195-201` as a `RowActions` item.
- `app/src/features/robots/components/RobotDetailPanel.tsx:155` —
  `const canExecuteCommands = isRobotAvailable(robot) && !isCommandLoading;` **This is the single
  gate point for commands.** It flows to `RobotControlCenter` (`:221`) and from there into
  `OverviewTab` (`:100`, `:111`) and `CommandsTab` (`:72`, `:82`), and it already drives the
  `disabled` prop on the charge and home items at `:186` and `:192`.
- `app/src/features/robots/pages/RobotCockpitPage.tsx:146` —
  `const canExecute = isLive || isRobotAvailable(robot);` the cockpit's own equivalent.

So a viewer today sees an enabled "Unregister" in two places and enabled charge/home controls in
four, and after [[TASK-282]] every one of them returns 403.

### Frontend

**1. Resolve the contract mismatch first — this is a decision, not a detail.** Unregistering is
semantically `robots:write`, but `member` does **not** hold `robots:write` while the server guard in
[[TASK-282]] is `memberOrAbove`, which *does* let a member unregister. Gating the button on
`robots:write` as-is would make the client stricter than the server — two declarations of one rule
disagreeing, which is precisely the defect class this epic exists to remove.

**Decision: add `'robots:write'` to `MEMBER_PERMISSIONS`** (`auth.types.ts:272-281`) so the client
matrix matches `memberOrAbove`. Record in a comment that the two are intentionally paired, and name
`server/src/middleware/auth.middleware.ts:411` as the server-side counterpart. (The alternative —
leaving members unable to unregister — is a product change to the server guard, not a client fix, and
belongs in [[TASK-282]] if anyone wants it.)

**2. Gate the two destructive controls on `robots:write`:**

- `RobotList.tsx:115-118` — `actionsFor()` returns the `Unregister` item only when
  `can('robots:write')`. **Filter it out of the array, do not `disabled` it**: `disabled` is the
  repo's idiom for transient state (`RobotDetailPanel.tsx:186,192` disable on
  `!canExecuteCommands`), whereas a permission the user will never hold should not render at all.
- `RobotList.tsx:44` — the toolbar button calling `onRegister` renders only when
  `can('robots:write')`.
- `RobotDetailPanel.tsx:195-201` — same treatment for its `Unregister` `RowActions` item.

**3. Gate the command controls on `robots:command`,** by folding the check into the two existing
single points rather than touching the leaf components:

- `RobotDetailPanel.tsx:155` → `const canExecuteCommands = can('robots:command') &&
  isRobotAvailable(robot) && !isCommandLoading;`. Because this value already feeds both tabs and both
  RowActions items, that one line covers `OverviewTab.tsx:100,111` and `CommandsTab.tsx:72,82` — no
  edit needed in either tab.
- `RobotCockpitPage.tsx:146` → `const canExecute = can('robots:command') && (isLive ||
  isRobotAvailable(robot));`.

Use `usePermission('robots:command')` (`useAuth.ts:193`) in these two components — it is the
purpose-built single-permission hook and avoids subscribing to the whole auth object.

**4. Keep the explanatory copy honest.** `OverviewTab.tsx:119-124` renders "Robot must be online to
receive commands — currently {status}", which becomes wrong for a viewer looking at an online robot.
Either pass a reason down or render a permission-specific sentence. Do not leave a message that
blames the robot for the user's role.

**5. Leave E-Stop alone.** `EmergencyStopButton` (`RobotDetailPanel.tsx:179`) and
`FleetEmergencyStopButton` (`app/src/features/safety/components/FleetEmergencyStopButton.tsx:29`)
stay ungated: stopping a robot is never destructive, and a read-only operator who can see a hazard
must be able to halt it. Record this as a deliberate exclusion in the PR body.

**Key files:**
- `app/src/features/auth/types/auth.types.ts` — add `'robots:write'` to `MEMBER_PERMISSIONS` (`:272-281`)
- `app/src/features/robots/components/RobotList.tsx` — gate `actionsFor()` `:115-118` and the register button (`:44`)
- `app/src/features/robots/components/RobotDetailPanel.tsx` — gate `:155` and the Unregister item `:195-201`
- `app/src/features/robots/pages/RobotCockpitPage.tsx` — gate `:146`
- `app/src/features/robots/components/tabs/OverviewTab.tsx` — the explanatory sentence at `:119-124`
- `app/src/features/auth/hooks/useAuth.ts` — read-only, `usePermission` at `:193`, the pattern at `:68`
- `app/src/features/robots/components/__tests__/RobotList.test.tsx` — per-role rendering tests
- `app/src/features/auth/types/__tests__/auth.types.test.ts` — the member/server pairing test

## Acceptance Criteria

- [ ] `MEMBER_PERMISSIONS` includes `'robots:write'`, with a comment naming `memberOrAbove` (`server/src/middleware/auth.middleware.ts:411`) as the server rule it mirrors.
- [ ] With a `viewer` user, neither the robots list row menu nor the robot detail RowActions renders an "Unregister" item, and the register button is absent.
- [ ] With a `viewer` user, the charge and home controls are unavailable in all four places they render — `OverviewTab`, `CommandsTab`, the `RobotDetailPanel` RowActions, and the cockpit.
- [ ] With a `member` user, every one of those controls renders and is enabled for an online robot.
- [ ] With an `owner` user, behaviour is unchanged from today.
- [ ] No control is gated by duplicating the permission check in a leaf component: `OverviewTab.tsx` and `CommandsTab.tsx` are not edited except for the explanatory sentence.
- [ ] A viewer looking at an **online** robot is never shown "Robot must be online to receive commands".
- [ ] The per-robot and fleet E-Stop buttons still render and work for a `viewer`.
- [ ] `cd app && npx tsc && npx vitest run` passes.

## Test Strategy

**There is no test that mocks this seam, because there is no test of this seam at all.** `can()` has
zero call sites outside `ProtectedRoute`, so no existing test can be pointed at the fix — the absence
*is* the seam, and stating that is the honest answer here. The nearest existing coverage,
`ProtectedRoute`'s own tests, exercises `requiredPermission` against a hand-built context and never
touches a robot control.

What to add:

1. **Per-role rendering tests** in
   `app/src/features/robots/components/__tests__/RobotList.test.tsx` (and a sibling for
   `RobotDetailPanel`). Drive the real `useAuthStore` with a `viewer`, a `member` and an `owner` user
   rather than mocking `useAuth` — mocking the hook would mock exactly the boundary under test.
   Assert on the rendered menu items, not on `can` being called. Use `renderWithProviders` from
   `app/src/test/utils.tsx`; these components use `useNavigate`, so the router wrapper is required.
2. **A matrix-pairing test** asserting `MEMBER_PERMISSIONS` contains `robots:write` and
   `VIEWER_PERMISSIONS` contains neither `robots:write` nor `robots:command`. This is small, but it
   is the thing that breaks if someone later narrows the client matrix out of step with the server
   guard.
3. Note for whoever implements it: `AuthProvider.tsx:102-106` auto-logs-in `MOCK_USER` when
   `import.meta.env.DEV` or `VITE_DEMO_MODE === 'true'`. Check what role `MOCK_USER` carries before
   assuming a test or a manual dev check is exercising the role you intend.

## Notes

This is the second half of one defect. [[TASK-282]] makes the server refuse a viewer's write; this
makes the client stop offering it. Landing this **without** TASK-282 would be actively harmful — it
would hide the controls while leaving the API open, which looks like a fix and is not. Neither task
blocks the other technically, but ship TASK-282 first.

Deliberately out of scope: wiring `requiredPermission` on the two `<ProtectedRoute>` uses in
`app/src/App.tsx` (`:109`, `:371`). Those guard whole route trees, and route-level permission gating
is a navigation concern — the parallel session owns TASK-273 to TASK-280 and the route table. Raise
it with that session rather than editing there.

**Do not touch** `app/src/components/layout/{Sidebar,NavList,MobileNav,navigation}.*` or
`app/src/components/docs/DocsSidebar.tsx` — the parallel navigation session owns them. Every file in
this task is under `app/src/features/`, so there is no overlap.
