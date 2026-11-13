---
id: "TASK-489"
aliases: []
title: "Help opens an accurate docs landing page, the dashboard's robot list sits inside its panel, and Agent Mode empty states speak to users"
slug: "help-opens-an-accurate-docs-landing-page-the-dashboard-s"
status: "review"              # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["docs", "dashboard", "agentmode", "demo", "ui"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "low"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# Help opens an accurate docs landing page, the dashboard's robot list sits inside its panel, and Agent Mode empty states speak to users

## Description

Three defects found on the live demo instance (build 5ba4cf5) ahead of the demo day on
2026-11-16. Each is the first thing a visitor meets on its page:

1. **Help** ("?" in the top bar) opens `/docs/README`, i.e. `docs/README.md`. It told a
   visitor "NeoDEM is a fleet management platform for autonomous robots … The current
   deployment runs a single SO-101 robot arm on a Raspberry Pi 5" — the opposite of
   `docs/platform.md` and `CLAUDE.md`: an open Physical AI platform across Collect → Train
   → Deploy → Evaluate → Operate → Comply, focused on the Unitree G1 with Dex3-1 hands,
   with the SO-101 as the bootstrap embodiment. The page also listed Raspberry Pi system
   requirements and systemd commands as *the* way to run it, and left out most documents,
   `docs/dataset-upload.md` among them.
2. **Dashboard**: the site picker, the map and the list of robots under it ("NO SITE",
   SimBot-01, MicroDuck …) sat flush on the Site map panel's left border.
3. **Agent Mode** named environment variables to end users: "This robot does not publish
   a map (AGENT_MAP_ENABLED)." and "This robot does not keep a point cloud
   (AGENT_CLOUD_ENABLED)."

## Details

### Current state (before)

- `docs/README.md` — a 2025-era quick start for the SO-101 rig on a Raspberry Pi.
- `app/src/features/dashboard/pages/DashboardPage.tsx` rendered `<SiteMap size="compact" />`
  as a bare child of a `Panel` that also has a `Panel.Header`. `Panel`
  (`app/src/shared/components/ui/Panel.tsx`) pads itself only when it has **no** section
  children; with a header it resolves to `padding: none` and expects a `Panel.Body`.
  `FleetPage` was never affected: its panel has no header, so it pads.
- `app/src/features/agentmode/components/RobotMapPanel.tsx` and `WorldCloudView.tsx`
  printed the agent's setting name inside the sentence.

### Docs

- `docs/README.md` is rewritten as the landing page of the in-app docs: what the platform
  is (facts from `docs/platform.md` only — no readiness verdicts are repeated, the page
  points at "Readiness at a glance" as the one place they are stated; no statement about
  any one deployment), the six stages with the app page and the document for each, a
  "Start here" table, a **Datasets** section (record, import, direct upload →
  `dataset-upload.md`, episode browser, curation, publish, research), and an index of
  every top-level document grouped the way the sidebar groups them. App pages are linked
  as `/route`, which the viewer turns into in-app navigation
  (`resolveDocLink` in `app/src/components/docs/docsMarkdown.ts`).
- The same stale claim in other openings:
  - `docs/vla-integration-guide.md` — "how the SO-101 robot arm executes learned skills"
    → how a robot does; the SO-101 is named as the walkthrough's example.
  - `docs/robot-integration-guide.md` — listed the SO-101 as "Production-tested" and the
    G1 as "hardware-pending". The G1 is now first, with its status deferred to
    `platform.md#readiness-at-a-glance`; the SO-101 is the bootstrap arm.
  - `docs/deployment.md` — "the NeoDEM reference platform (Raspberry Pi 5 …)" → the
    SO-101 bootstrap rig, matching `docs/architecture.md`.
  - `docs/nats-rustfs.md` — "the EmAI Robot Fleet Management System" → NeoDEM.
  - Left alone on purpose: `docs/regulatory-compliance.md` (its subject *is* the
    regulatory class "robot fleet management system"), `docs/demo-intro.md` (already says
    Physical AI platform; its H1 claim matches `app/src/mocks/demoData.ts`).
- `docs/agent-mode.md` — the settings table now has `AGENT_CLOUD_ENABLED`, corrects the
  default of `AGENT_MAP_ENABLED` (it follows `AGENT_RANGE_ENABLED` when unset,
  `robot-agent/src/config/config.ts`), and quotes what the panel says when each is off —
  the place an operator looks.

### Frontend

- `DashboardPage.tsx` — the map sits in `Panel.Body`.
- `app/src/features/fleet/components/SiteMap.tsx` — `RobotGroup` takes `compact`. Under
  the dashboard's map the list has the panel's full width, so a robot is one line (name
  left, reason right) in two columns from `sm` up instead of a name with a tag stacked
  under it; the heading carries the count. The full-size list beside the Fleet map keeps
  its stacked rows (the column is 16rem wide).
- `RobotMapPanel.tsx`, `WorldCloudView.tsx` — the sentence is plain ("This robot is not
  sharing a map of its surroundings." / "This robot is not keeping a 3D view of its
  surroundings."); the setting name is folded under `AdminHint` ("For administrators"),
  the component PR #485 (TASK-486) introduced for exactly this.

### Key files

- `docs/README.md`, `docs/agent-mode.md`, `docs/vla-integration-guide.md`,
  `docs/robot-integration-guide.md`, `docs/deployment.md`, `docs/nats-rustfs.md`
- `app/src/features/dashboard/pages/DashboardPage.tsx`
- `app/src/features/fleet/components/SiteMap.tsx`
- `app/src/features/agentmode/components/RobotMapPanel.tsx`
- `app/src/features/agentmode/components/WorldCloudView.tsx`
- `app/src/components/docs/__tests__/docsLanding.test.ts` (new)
- `app/src/features/dashboard/pages/__tests__/DashboardPage.requests.test.tsx`
- `app/src/features/fleet/components/__tests__/SiteMap.test.tsx`
- `app/src/features/agentmode/components/__tests__/RobotMapPanel.test.tsx`

## Acceptance Criteria

- [x] `/docs/README` describes the platform as `docs/platform.md` does and makes no
      statement about a particular deployment.
- [x] Every link on the landing page resolves: documents and their headings exist, app
      routes exist in `app/src/App.tsx`; every top-level document is indexed, including
      `dataset-upload.md` (`docsLanding.test.ts`).
- [x] No document lands in the "Other" category (`docsRegistry.test.ts`, unchanged).
- [x] The dashboard's site picker, map and robot list are inset by the panel's padding at
      1440x900 and 1280x720, light and dark.
- [x] The Agent Mode map and 3D empty states name no environment variable in the sentence
      a visitor reads; the name is still on the page under "For administrators" and in
      `docs/agent-mode.md`.

## Test Strategy

- `cd app && npx vitest run` — `docsLanding.test.ts`, the dashboard panel-body test, the
  compact-row test in `SiteMap.test.tsx`, the reworded cases in `RobotMapPanel.test.tsx`.
- In a browser against a local server (`npm run seed:demo-fleet`, one digital twin, a sim
  robot agent started with `AGENT_MAP_ENABLED=false`): `/dashboard`, `/agent` (2D and
  3D) and `/docs/README` at 1440x900 and 1280x720, light and dark.

## Notes

- Not changed, noted for a follow-up: documents under `docs/adr/`, `docs/records/` and
  `docs/testing/` get the categories "Adr", "Records" and "Testing", which
  `CATEGORY_ORDER` in `app/src/components/docs/docsRegistry.ts` does not list, so they
  are in no sidebar group (they are still reachable by link and by previous/next).
  Whether internal records belong in a visitor's sidebar is a product decision.
- Not changed: `tagline: 'Fleet Management System'` in `app/src/brand/defaults.ts`.
