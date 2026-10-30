---
id: "TASK-429"
aliases: []
title: "Wrap-up is one summary band with one dataset action"
slug: "wrap-up-is-one-summary-band-with-one-dataset-action"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "ui"]
sprint: ""
parent: "[[TASK-425]]"
depends_on: ["[[TASK-426]]"]
spe: 3
effort: "low"
due_date: ""
created: "2026-10-30"
updated: "2026-10-30"
---

# Wrap-up is one summary band with one dataset action

## Description

Fourth slice of [[TASK-425]]. On a `completed` or `failed` session, the page shows under the
command bar from TASK-426:
- one highlighted summary band: the result, one sentence, five readouts, and **one**
  dataset action in its own centred column, away from the E-STOP;
- the takes table, with thumbnails;
- a details list.

The Dataset card's second Open/Create dataset button goes. This slice also updates the
docs for the whole redesign.

Branch: `feat/task-429-wrap-up-is-one-summary-band-with-one-dataset-action`.

## Details

### Current state

- After TASK-426, Wrap up renders the bar, with no left group and no robot link dot, and
  the old `SessionCompleted`
  (`app/src/features/datacollection/components/session/SessionCompleted.tsx`, 199 lines). It
  holds:
  - a recording summary (`session-frames`, with the TASK-418 "…" while settling;
    `session-warning`);
  - a Dataset card (`dataset-card` when exported, `open-dataset`) that repeats the
    status action;
  - the takes table `review-episodes` (`episode-input-N`).
- The Edit task and Create dataset `FormModal`s live in `SessionDetailPage.tsx`; they stay
  unchanged.
- `docs/data-collection-two-person.md` has "## What the assistant sees" (line 34) and
  "## Setup" (line 60), which describe the old stacked page.
- `docs/brand.md` has "## 1. Tokens" (line 92) and "## 3. Page anatomy" (line 187).

### Frontend

Build to the epic's section **"WRAP UP (completed, failed)"**: the band, the one action and
its order (Open dataset → New session at 0 frames → Create dataset), the readouts, the grid
below, the takes table columns and the details rows. Apply Explicit change 8. The action is
never on the band's top row, which lies under the E-STOP. Below 640 px it spans the band's
width under the readouts, in the page and not in the dock.

### Docs

- `docs/brand.md`:
  - the `media` token and `animate-breathe` in the token table;
  - the tally colours;
  - in §3, the sentence "A live console may use a console bar instead of PageHeader.";
  - the E-STOP clear-zone rule: alone at the far right, at least 64 px from any other
    control at 1512 px, and the bar's 32 px sticky offset.
- `docs/data-collection-two-person.md`:
  - rewrite "What the assistant sees" for the three phases (Set up, Record, Wrap up);
  - point Setup steps 1–8 at the "Get ready" steps (robot side, arm control, stand and
    balance, Quest, operator in VR);
  - say where Testing tools and the E-STOP are.

  Describe the page as it ships. If TASK-427 or TASK-428 has not merged yet, describe only
  what is on `main` and leave a one-line note in the PR.

### Key files

Modify:
- `app/src/features/datacollection/components/session/SessionCompleted.tsx` and
  `__tests__/SessionCompleted.test.tsx`.
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`: the Wrap up layout (JSX
  only).
- `app/e2e/datacollection-console.spec.ts`: add the Wrap up block. Reach it with End session
  on `demo-session-takes`.
- `docs/brand.md`, `docs/data-collection-two-person.md`.

### Live specs

`app/e2e/live/datacollection-vr.spec.ts:125-131` reads `dataset-card`, `review-episodes`
and `open-dataset` after End session. It is not part of `test-all.sh`. Keep
`review-episodes` and `open-dataset`. Put `dataset-card` on the Details "Dataset" row when
a dataset exists, or update the spec to read `session-summary`. Update it in the same PR.

### Visual reference

While the scratchpad exists, compare against
`/tmp/claude-1002/-home-humanoid-develop-robot-management-system/80869d0d-8d7d-4554-975b-5fccdc543248/scratchpad/ui/mockup/wrap-1512.png`,
`wrap-390.png` and `wrap-390-full.png` (same folder). The page must match them closely.

## Acceptance Criteria

From the epic's criteria, the parts assigned to this child (ownership table under the
epic's "Split"):

- [ ] **One lit action in Wrap up.** Exactly one visible kit `primary` button is on screen
  (the band's action), not counting the E-STOP.
- [ ] **Every function within one disclosure.** Edit task and Create / Open dataset are
  reached with at most one click.
- [ ] **E-STOP stands alone, page-wide in Wrap up.** The nearest other interactive element
  is ≥ 64 px from the E-STOP at 1512×945 and 1920×1080, and ≥ 48 px at 1280×800, at scroll
  position 0. The mockup measured 84 px at 1512 to Create dataset.
- [ ] **Phone (390×844), Wrap up.**
  - No horizontal scroll.
  - The dataset action spans the band's width in the page, not in the dock.
- [ ] **Brand.**
  - The `media` token, `animate-breathe`, the tally colours and the console-bar sentence
    are documented in `docs/brand.md`.
  - Wrap up renders correctly in the light theme and with the ZeMA `brand/` config.
- [ ] **Docs.** `docs/data-collection-two-person.md` "What the assistant sees" describes the
  three phases, and the Setup steps point at the Get ready steps.
- [ ] **Screenshots.** The PR shows before/after screenshots of Wrap up at 1512×945,
  1920×1080 and 390×844.
- [ ] **Gates (every child).**
  - `design-drift.test.ts` passes, with no raw hex or hue utilities, no `backdrop-filter`
    and no glow shadows.
  - `./scripts/test-all.sh --skip-pw` is green.
  - The four Playwright specs are green.

## Test Strategy

- **Vitest.** `SessionCompleted.test.tsx` covers:
  - the action order: exported → `open-dataset`; 0 frames → New session; otherwise Create
    dataset;
  - exactly one dataset button in the DOM;
  - the failed variant with its reason;
  - `session-frames` "…" while settling;
  - `session-warning`;
  - `episode-input-N`.
- **E2E.** The Wrap up block in `datacollection-console.spec.ts`:
  - one primary;
  - the page-wide E-STOP clearance at 1280, 1512 and 1920;
  - no horizontal scroll at 390, with the action in the band.

  The E-STOP sweep from TASK-426 still passes.
- **Manual.** Create a dataset from the band on the sim robot. Read the two docs against the
  shipped page. Compare the screenshots with the mockup PNGs.
