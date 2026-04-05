---
id: TASK-133
aliases:
- TASK-133
title: Educational UX overhaul for Simulation page
slug: educational-ux-overhaul-for-simulation-page
status: done
priority: 3
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-05
updated: 2026-04-05
---


# Educational UX overhaul for Simulation page

## Description

Users unfamiliar with simulation/VLA evaluation struggle to interpret what the page is showing. Add inline educational content: a collapsible "How this works" banner, (i) tooltips on every concept, an interpretation panel for results, and richer job cards with timestamps and status counts.

## Details

### New shared components

- `app/src/shared/components/ui/Tooltip.tsx` — minimal CSS-positioned tooltip + `<InfoIcon>` convenience wrapper. Exports `Tooltip`, `InfoIcon`, types.
- Exported from `app/src/shared/components/ui/index.ts`.

### Simulation page changes

File: `app/src/features/simulation/pages/SimulationPage.tsx`

1. **GLOSSARY constant** — single source of truth for short explanations of: simulation, vla, mujoco, isaac, modelId, backend, environment, rolloutCount, episode, step, successRate, avgSteps, collisions, avgDuration, simToReal, frames, chunkSize.
2. **`<EducationBanner>`** component — collapsible card right below header. Explains what the page does + a 4-step diagram (camera → VLA → actions → physics → success).
3. **Launch tab** — InfoIcon on every label (Model ID, Backend, Environment, Rollouts). Estimated runtime calculated from rollout count (~35s per episode baseline). Helper text under Model ID explains it's a display label, not the model selector. Async note under the submit button.
4. **Jobs tab** — summary bar with total count + per-status counts (completed/failed/running/queued) + "Auto-refreshing every 3s" hint. Better empty state with explicit call-to-action to Launch tab. Job cards now show relative created time ("2h ago") with full ISO date on hover.
5. **Results tab** — InfoIcons on Success Rate, Avg Steps, Collisions, Avg Duration, and Episode Replay headings. "N of M episodes solved" subtitle under the hero percentage. New **interpretation panel** that reads the success rate and renders one of four human-friendly summaries (strong / partial / weak / no successes yet), with root-cause hints when 0% AND when avg steps is at the 200-step cap. Better empty states with guidance.

### Helpers added

- `formatRelativeTime(date)` — "30s ago" / "5m ago" / "2h ago" / "3d ago" / date
- `estimateJobDurationSec(rolloutCount)` — rollout-count × ~35s
- `successInterpretation(rate)` — returns {label, detail, variant} for the panel

## Test Strategy

1. Verify `npx tsc --noEmit` in `app/` is clean
2. Open http://localhost:1420/simulation — expect new banner above the tabs
3. Click banner → 4 concept cards appear (camera, actions, physics, success)
4. Launch tab: hover each (i) icon → tooltip with explanation appears; slider drag updates estimated runtime live
5. Jobs tab: summary bar shows correct counts per status, relative time on each card
6. Results tab: open a 0% job → interpretation panel warns about sim-to-real gap; open a higher-success job → panel reports stronger performance
7. All tooltips should be keyboard-accessible (tab + focus shows tooltip)
