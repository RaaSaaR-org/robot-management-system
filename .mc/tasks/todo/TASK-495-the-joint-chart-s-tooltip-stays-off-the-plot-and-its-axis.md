---
id: "TASK-495"
aliases: []
title: "The joint chart's tooltip stays off the plot and its axis fits the data, site map names are legible, and the product calls itself an open Physical AI platform"
slug: "the-joint-chart-s-tooltip-stays-off-the-plot-and-its-axis"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "fleet", "brand", "demo", "ui", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# The joint chart's tooltip stays off the plot and its axis fits the data, site map names are legible, and the product calls itself an open Physical AI platform

## Description

Four cosmetic leftovers of the demo walk-through for 2026-11-16, all in the app: two on
the dataset episode page's joint chart, one on the two site maps, and the product
tagline in the brand defaults. One task because each is a few lines of presentation and
they ship together.

## Details

### Current state

**Tooltip.** `app/src/features/training/components/datasets/TrajectoryPanels.tsx`
(TASK-494) draws its own tooltip. At 1280x720 the chart sits beside the video and its
plot is 293 × 174 px; on the `arms` and `hands` tabs of the bottle dataset (14 joints
each) the tooltip is one column of fourteen rows, 209 × 249 px, anchored at the top of
the plot beside the pointer — it covers the plot it describes and hangs out over the
legend.

**Y axis.** The chart leaves the y domain to Recharts, which rounds both ends out to its
tick step: arms that stay within about ±2 rad are drawn on −2.4…2.4 or −4…4 depending on
the episode, and the lines are bunched in the middle.

**Site maps.** `app/src/features/digitaltwin/components/TwinTopDown.tsx` writes zone
names at `fontSize={12}` in a 720 × 540 viewBox, and
`app/src/features/fleet/components/SiteMap.tsx` writes robot names the same way. The
dashboard's map is 256 px tall, so those 12 units are 5.7 px on screen. On both maps the
two robots planned into `STAGING` (seeded by TASK-493: the G1 and the SO-101) are stacked
18 units apart directly over the zone's name and under `CROSS-AISLE`: four lines of text
in about 45 px.

**Tagline.** `app/src/brand/defaults.ts` says `tagline: 'Fleet Management System'`.
The product is the open Physical AI platform (Collect → Train → Deploy → Evaluate →
Operate → Comply); fleet operation is one of six stages. `app/vite.config.ts` builds the
browser title from its own copy of the default, "The Open Physical AI Platform".
`brands/neodem/messaging.md` notes the mismatch. Nothing else repeats the old tagline:
`app/index.html` takes its title from the Vite plugin, the Tauri window title is
"NeoDEM", and no e2e spec expects it.

### Frontend

- **Tooltip.** Under a chart width of 560 px the tooltip is docked above the plot (over
  the panel's heading and group buttons, right edge on the chart's) instead of following
  the pointer, in 10 px type. A left/right pair is one row at every width (seven rows
  for two arms), the time shares the header's empty corner, and a list without pairs is
  split into two columns once it has more than eight rows. The panel no longer clips
  its overflow. On the wide plot under the videos it still sits beside the pointer.
- **Y axis.** `fitAxis()` in `episodeFormat.ts`: domain = the min and max of every
  visible channel's state and action over the whole episode, padded 5 %; ticks at round
  values (1/2/2.5/5 × 10ⁿ) inside it. Computed per group tab from all frames, so it does
  not move while the episode plays or when a legend entry is picked out.
- **Map labels.** `SiteMap` measures its map element and asks for names of 12 px (fleet
  page) / 11 px (dashboard) on screen, converted to viewBox units (`mapLabelSize`).
  `TwinTopDown` takes the size as `labelSize`; given one, a name wider than its tall,
  narrow zone is written along it (`layoutZoneLabels`). The zone editor passes none and
  is unchanged.
- **Planned markers.** `plannedMarkerPositions` places each label on the first line
  around its zone's name (above, below, two above, …) where it covers no zone name and
  no label placed before it; the longest label picks first; a label wider than its zone
  starts at the zone's left edge so the ring stays over the zone. The seeded positions
  are not moved.
- **Tagline.** `DEFAULT_BRAND.tagline` and the Vite fallback become "Open Physical AI
  Platform"; a test keeps the two in step.

### Key files

- `app/src/features/training/components/datasets/TrajectoryPanels.tsx`
- `app/src/features/training/components/datasets/episodeFormat.ts`
- `app/src/features/digitaltwin/components/TwinTopDown.tsx`
- `app/src/features/fleet/components/SiteMap.tsx`
- `app/src/brand/defaults.ts`, `app/src/brand/types.ts`, `app/vite.config.ts`
- `docs/brand.md`, `brands/neodem/messaging.md`
- Tests: `episodeFormat.test.ts`, `TrajectoryPanels.test.tsx`, `TwinTopDown.test.ts`,
  `SiteMap.test.tsx`, `app/src/brand/__tests__/brand.test.ts`

## Acceptance Criteria

- [x] At 1280x720 on the `arms` and `hands` tabs of the bottle dataset the tooltip does
      not overlap the plot beyond its empty top margin, and every joint's state and
      action is readable in it.
- [x] At 1440x900 the tooltip covers well under half of the plot and sits beside the
      pointer.
- [x] The y axis of a group ends just outside that group's data, with round tick
      labels, and is the same from the first to the last frame of an episode.
- [x] Zone and robot names on the dashboard's site map are at least 11 px on screen and
      no two names overlap; on the fleet map the G1's and the SO-101's planned labels
      overlap neither each other nor a zone name.
- [x] The default tagline and the browser title say "Open Physical AI Platform"; "Fleet
      Management System" is gone from the brand defaults.
- [x] App typecheck, vitest and build pass.

## Test Strategy

Unit tests for `fitAxis`, `tooltipColumns`, `layoutZoneLabels`, `labelBoxesCollide`,
`plannedMarkerPositions`, `mapLabelSize` and the brand default. Visual check with
Playwright at 1280x720 and 1440x900 against a local app proxied to the live API
(`VITE_PROXY_TARGET=https://neodem.emai.dev npx vite --port 1437`), on
`/datasets/9923225e-9d0a-463f-b072-eeded251142a/episodes`, `/dashboard` and `/fleet`.

## Notes

- The tooltip's docked position reaches a few px over the panel's top edge when the
  heading wraps to two lines; it is `pointer-events: none` and gone as soon as the
  pointer leaves the plot.
- Widths of SVG labels are estimated (0.6 em a character for zone names, 0.52 em for
  robot names): the layout runs before render and jsdom measures nothing.
- `shortSlogan` ("Bringing Intelligence to Motion") is left as it is; it is not shown
  anywhere and was not part of this task.
