---
id: "TASK-279"
aliases: []
title: "Move Docs, Settings, Updates and Admin out of the sidebar"
slug: "move-docs-settings-updates-and-admin-out-of-the-sidebar"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, app]
sprint: ""
parent: "[[TASK-273]]"
depends_on: ["[[TASK-275]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Move Docs, Settings, Updates and Admin out of the sidebar

## Description

Five of the sidebar's rows are not navigation: `Updates`, `Docs` and `Settings`
in the `System` group and `Organizations` + `Team` in `Admin`. They move to the
chrome that already owns their kind of thing — Updates into Settings, Docs into a
top-bar help icon, Settings into the user menu, Organizations and Team into the
organization switcher — and both groups disappear. **This is the slice that makes
the sidebar 10 rows.**

Parent: [[TASK-273]]. Blocked by [[TASK-275]].

## Details

### Current state (verified 2026-09-12)

- `navigation.ts` groups `system` (Updates `/updates` · Docs `/docs` · Settings
  `/settings`) and `admin` (Organizations `/organizations`, super-admin only ·
  Team `/team`, owner + super-admin), the latter gated on
  `requiresFeature: 'multiTenancyEnabled'` **and**
  `requiresRole: ['super-admin', 'owner']`.
- `TopBar.tsx` (86 lines) right-hand cluster, verbatim:

```tsx
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Only rendered when multi-tenancy is on */}
          <OrganizationSwitcher />
          <Button
            variant="ghost"
            iconOnly
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            title={themeLabel}
            aria-label={themeLabel}
          >
            {isDark ? <Sun className="h-5 w-5" strokeWidth={1.75} /> : <Moon className="h-5 w-5" strokeWidth={1.75} />}
          </Button>
          <UserMenu />
        </div>
```

  Label constants (`themeLabel`, `sidebarLabel`) are computed above the return;
  lucide imports are one alphabetised list on line 10.
- `UserMenu.tsx` (98 lines) has one `<Link to="/account" role="menuitem" tabIndex={-1}
  onClick={() => menu.close(false)} className={cn(topBarMenuItem, 'h-9')}>` with a
  `UserRound` icon, in its own `<div className="p-1">`, above a separated Sign-out
  block. Icons inside a menu row are sized by the `topBarMenuItem` class string
  (`[&_svg]:h-4 [&_svg]:w-4`), so they pass only `strokeWidth={1.75}
  aria-hidden="true"`. `menu.close(false)` closes without pulling focus back to
  the trigger — the right call when navigating away.
- `OrganizationSwitcher.tsx` (191 lines) returns `null` unless
  `multiTenancyEnabled && current`. **Only super-admins get a menu**; everyone
  else gets a static `<span>` pill (lines 92-103). The menu is
  `role="menu" aria-label="View as organization"` with a header block, a
  `role="menuitemradio"` tenant list, and an "Exit impersonation" row while
  impersonating. It links to no route at all today.
- `SettingsPage.tsx` — `TABS` = appearance · notifications · dashboard,
  `label="Settings sections"`, and the tab bodies sit **inside** a
  `{!settings ? (loading/error) : (<>…</>)}` gate that depends on the user's
  settings request.
- `UpdatesPage.tsx` (157 lines) — `eyebrow="System"`, `title="Secure updates"`,
  description "Signed over-the-air packages for the robot software. Every package
  is approved before it reaches a robot.", one header action `Button` "New
  package", no tab bar, no live subscription (one-shot fetch on mount).
- `App.tsx` route gates stay the source of truth for access:
  `/organizations` `requiresRole={['super-admin']}`, `/team`
  `requiresRole={['super-admin','owner']}`.
- `navigation.test.ts` asserts the group order and a case `/docs/architecture` →
  `Docs`; `Shell.test.tsx` asserts owner-vs-super-admin Admin gating and that the
  collapsed rail has no `Build` heading.

### Frontend

#### 1. Updates becomes the fourth Settings tab

- New `app/src/features/updates/components/UpdatesSection.tsx` — everything
  `UpdatesPage` renders below its header (package list, approve, deploy to robot,
  roll back, the create-package modal), header-less, following
  `RobotsPage.tsx`'s "No PageHeader: the parent renders it" convention. Takes
  `{ newPackageOpen: boolean; onNewPackageOpenChange: (open: boolean) => void }`
  so the Settings header can own the "New package" button. Export it from the
  feature barrel.
- Delete `UpdatesPage.tsx`, its `pages` barrel export and `LazyUpdatesPage` in
  `app/src/routes/lazyPages.ts`.
- `SettingsPage.tsx`: `TABS` gains `{ id: 'updates', label: 'Updates' }`. Render
  the Updates tab **outside** the `!settings` loading/error gate — a failed
  user-settings fetch must not hide the update packages. Give `PageHeader` a
  tab-dependent `actions`: "New package" on the updates tab, nothing on the other
  three (the pattern `TrainingPage` and `DeploymentsPage` already use).
- `App.tsx`: `/updates` becomes
  `<Route path="/updates" element={<Navigate to="/settings?tab=updates" replace />} />`
  under a `{/* Updates — now a Settings tab (TASK-279) */}` comment.

#### 2. Docs becomes a top-bar help icon

In `TopBar.tsx`, between `OrganizationSwitcher` and the theme toggle:

```tsx
          <LinkButton to="/docs" variant="ghost" iconOnly title={docsLabel} aria-label={docsLabel}>
            <CircleHelp className="h-5 w-5" strokeWidth={1.75} />
          </LinkButton>
```

with `const docsLabel = 'Docs';` beside the existing label constants, `LinkButton`
imported from `@/shared/components/ui` and `CircleHelp` added to the alphabetised
lucide import. `/docs` and `/docs/*` routes and `DocsSidebar` are untouched.

#### 3. Settings joins the user menu

In `UserMenu.tsx`, add a second row in the same `<div className="p-1">` block,
directly under "Account settings", copying its markup exactly:

```tsx
            <Link
              to="/settings"
              role="menuitem"
              tabIndex={-1}
              onClick={() => menu.close(false)}
              className={cn(topBarMenuItem, 'h-9')}
            >
              <Settings strokeWidth={1.75} aria-hidden="true" />
              <span>Settings</span>
            </Link>
```

#### 4. Organizations and Team join the organization switcher

`OrganizationSwitcher.tsx` has to serve owners, not just super-admins:

- Render the menu whenever the user is an **owner or a super-admin**; only the
  tenant-switch `menuitemradio` list and the "Exit impersonation" row stay
  super-admin-only. Non-admin roles keep today's static pill.
- Add a bottom section, separated with `border-t border-line-subtle p-1`, holding
  `role="menuitem"` `<Link>`s styled with `topBarMenuItem`: **Team** (`/team`,
  `Users` icon) for owners and super-admins, and **Organizations**
  (`/organizations`, `Building2` icon) for super-admins only. Close with
  `menu.close(false)` like `UserMenu` does.
- Keep `multiTenancyEnabled` as the outer gate. This preserves today's reach
  exactly: the `admin` nav group was gated on the same flag, so with
  multi-tenancy off these two pages have no UI entry point now either — they stay
  reachable by URL and through the ⌘K palette ([[TASK-280]]).
- Role gating stays enforced by `App.tsx`'s route guards; the menu only hides
  what the guard would refuse.

#### 5. The model loses two groups

Delete the `system` and `admin` groups from `NAV_GROUPS`. `navigation.ts`'s file
header comment must be rewritten — it still describes "the six sidebar groups
(Overview · Operate · Build · Comply · System · Admin)". `filterNavGroups`,
`requiresFeature` and `requiresRole` stay in the model: they are still the gates
the palette and any future group rely on, and `filterNavGroups` keeps its unit
tests with a fixture group instead of the real `admin` one.

The sidebar is now: `Dashboard`, `Operate` (Fleet · Control Center · Alerts),
`Automate` (Agent Mode · Missions), `Build` (Skill Training · Deployments ·
Marketplace), `Compliance` — **10 rows**, once [[TASK-276]], [[TASK-277]] and
[[TASK-278]] have landed too.

## Acceptance Criteria

- [ ] `NAV_GROUPS` has no `system` and no `admin` group, and nothing in the
      sidebar points at `/updates`, `/docs`, `/settings`, `/organizations` or
      `/team`
- [ ] The top bar shows a help icon linking to `/docs`, with an accessible name,
      placed left of the theme toggle
- [ ] The user menu has `Account settings` and `Settings`, both keyboard-reachable
      with the arrow keys, and Sign out still last behind its separator
- [ ] With multi-tenancy on, an **owner** gets an organization-switcher menu
      containing `Team` and no tenant list; a **super-admin** gets the tenant
      list, `Team` and `Organizations`; a `member` still gets only the static pill
- [ ] `/organizations` and `/team` keep their route role guards; a member typing
      the URL still lands back on `/dashboard`
- [ ] `/settings` has four tabs `Appearance · Notifications · Dashboard · Updates`;
      `?tab=updates` deep-links to it and the Updates tab renders even when the
      user-settings request fails
- [ ] The Updates tab keeps every view the old page had: package list, approve,
      deploy to a robot, roll back, New package
- [ ] `/updates` redirects to `/settings?tab=updates`
- [ ] `cd app && npx tsc --noEmit` clean, `npm run test` green

## Test Strategy

- `app/src/components/layout/__tests__/navigation.test.ts` — the group list is
  `[undefined, 'Operate', 'Automate', 'Build', undefined]`; nothing is active on
  `/docs/architecture`, `/settings`, `/updates`, `/team` or `/organizations`
  (replacing the current `/docs/architecture` → Docs case); `filterNavGroups`
  keeps its four gate cases against a fixture group
- `Shell.test.tsx` — drop the Admin-gating cases (the group is gone), keep the
  collapsed-rail and `aria-current` cases
- New `app/src/components/layout/__tests__/TopBar.test.tsx` — the help link points
  at `/docs` and has an accessible name
- New `app/src/components/layout/__tests__/UserMenu.test.tsx` — opening the menu
  shows `Account settings`, `Settings` and `Sign out` in that order
- New `app/src/components/layout/__tests__/OrganizationSwitcher.test.tsx` — the
  three role cases above, with `useFeatures` mocked both ways
- A `SettingsPage` test: `?tab=updates` renders the updates section and the New
  package action; a rejected settings fetch still renders the Updates tab
- Playwright: from `/dashboard`, reach the Updates tab through the user menu, and
  open the docs through the help icon
