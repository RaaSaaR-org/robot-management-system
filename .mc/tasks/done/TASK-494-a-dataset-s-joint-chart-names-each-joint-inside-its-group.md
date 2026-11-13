---
id: "TASK-494"
aliases: []
title: "A dataset's joint chart names each joint inside its group, and a dataset imported from Hugging Face says so in its page header"
slug: "a-dataset-s-joint-chart-names-each-joint-inside-its-group"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "demo", "ui", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# A dataset's joint chart names each joint inside its group, and a dataset imported from Hugging Face says so in its page header

## Description

Two presentation defects on the dataset episode page, both visible in the demo on
2026-11-16. (1) A dataset that has joint groups (`meta/modality.json`) loses its joint
names: the chart and the statistics table say `arms[5]` although `meta/info.json` names
every joint, and in the demo dataset the vector alternates left and right, so `arms[5]`
tells nobody which joint it is. (2) The header shows the source of a Hub import as a bare
`owner/repo@commit` under the title, where it reads like a second name for the dataset.

This task started as (2) alone; (1) was added on 2026-11-13 because both are one page,
one file and one demo.

## Details

### Current state

**Joint names.** `app/src/features/training/pages/DatasetEpisodesPage.tsx` computes
`jointNames`: as soon as `GET /api/datasets/:id/modality` answers groups it calls
`channelLabels(groups, width)` (`components/datasets/episodeFormat.ts`), which labels
every channel `<group>[<index in group>]` and never looks at `info.json`. That was right
for the dataset it was built for (TASK-476): `nvidia/GR00T-N1.7-AppleToPlate` carries the
single name `observation_to_policy` for 43 channels. It is wrong for
`g1-dex3-bottle-sorting-sim` (31 joints; groups `waist` 0–3, `arms` 3–17, `hands` 17–31;
`info.json` names all 31, index 3 `left_shoulder_pitch_joint`, 4
`right_shoulder_pitch_joint`, …). `DatasetStatsPanel.tsx` has the same rule.

With real names the `arms` tab draws 28 lines (14 joints × state + action) from a palette
of ten colours, so four joints reuse a colour; the legend lists 14 long names in a panel
that is 326 px wide beside the video at 1280x720; and Recharts' default tooltip lists 28
rows with every digit of the float, taller than the plot.

**Provenance.** In `<PageHeader meta={…}>` of the same page:

```tsx
{dataset.huggingFaceRepoId && (
  <span className="break-all font-mono text-xs text-ink-tertiary" title={…} data-testid="dataset-source">
    {formatRepoAtRevision(dataset.huggingFaceRepoId, dataset.sourceRevision)}
  </span>
)}
```

`app/src/features/training/components/datasets/DatasetProvenance.tsx` (TASK-493, with
`__tests__/DatasetProvenance.test.tsx`) renders "Imported from Hugging Face: <owner/repo>
at revision 37cb1d6e": the repo is a link to that exact commit on the Hub
(`hubDatasetUrl`, new tab), the full SHA is the hover text, nothing is rendered for a
dataset without `huggingFaceRepoId`, and the root keeps `data-testid="dataset-source"`.
Nothing uses it yet. No other page header shows the bare line (`DatasetCard.tsx` has a
repo link, but the component is not mounted anywhere).

### Frontend

`components/datasets/episodeFormat.ts`

- `isPlaceholderName(name)`: a bare number, or a generic stem with a number —
  `motor_0`, `dim_3`, `joint 4`, `q7`, `j0`, `action[2]`, `ch[40]`. `x`, `yaw`,
  `shoulder_pan`, `kLeftShoulderPitch` are names.
- `realChannelNames(names, width)`: the names when there is one per channel, all
  different, none a placeholder; otherwise null. All or nothing per vector — a legend
  that mixes `left_elbow` with `arms[7]` is worse than either.
- `channelLabels(groups, width, names?)`: the real names when there are any, else
  group and index as before.
- `shortChannelNames(names)`: drops the suffix `_joint` when every name on screen ends
  in it (so two labels can never collide). The full name stays the hover text.
- `channelSides(names)`: left/right pairs when every name starts with `left`/`right`
  (also `kLeft…`) and both sides are present; null otherwise, so the one-sided
  `left_arm[0]…` of a GR00T dataset is untouched.

`components/datasets/TrajectoryPanels.tsx` (`JointChartPanel`)

- A left/right pair shares its hue (seven hues for two arms, none reused); the right
  side is the same hue stepped back towards the panel colour
  (`color-mix(in oklab, <hue> 55%, var(--bg-secondary))`).
- The legend lists a pair once (`▬ ▬ elbow`), led by a `left ▬ ▬ right` key; seven
  entries instead of fourteen. Entries are buttons: hover previews one joint (the other
  lines step back), a click keeps it, a second click lets go.
- The tooltip is a table: a row per channel with `state` and `action` to three
  decimals; on a chart at least 360 px wide a pair is one row with both sides (seven
  rows fit over the low plot under the videos). With a joint picked out it shows only
  that joint. It opens from the top of the plot, because the panel clips what hangs
  below it.

`components/datasets/DatasetStatsPanel.tsx`: passes the names to `channelLabels`.

`pages/DatasetEpisodesPage.tsx`: passes the `info.json` names of the grouped vector to
`channelLabels`; replaces the span above with `<DatasetProvenance dataset={dataset} />`.

### Key files

- `app/src/features/training/components/datasets/episodeFormat.ts`
- `app/src/features/training/components/datasets/TrajectoryPanels.tsx`
- `app/src/features/training/components/datasets/DatasetStatsPanel.tsx`
- `app/src/features/training/pages/DatasetEpisodesPage.tsx`
- `app/src/features/training/components/datasets/__tests__/episodeFormat.test.ts`
- `app/src/features/training/components/datasets/__tests__/TrajectoryPanels.test.tsx`
- `app/src/features/training/components/datasets/__tests__/DatasetStatsPanel.test.tsx`
- `app/src/features/training/pages/__tests__/DatasetEpisodesPage.jointNames.test.tsx` (new)

## Acceptance Criteria

- [x] On a dataset with joint groups whose `info.json` names every channel, the chart
      legend, the chart tooltip and the statistics table show the joint's name inside
      each group, never `<group>[n]`.
- [x] On a dataset with joint groups whose names are placeholders (`motor_0`…) or one
      name for the whole vector (GR00T's `observation_to_policy`), labels stay
      `<group>[n]` exactly as before.
- [x] A dataset with names and no groups is labelled as before.
- [x] A shared `_joint` suffix is dropped from the legend only when every name has it;
      the full name is the hover text.
- [x] State (solid) and action (dashed) of one joint share one colour; in a two-sided
      group no two joints share a hue, and left and right of one joint do.
- [x] The legend and the tooltip of the `arms` tab fit inside the chart panel at
      1280x720 and 1440x900.
- [x] The header of a Hub-imported dataset reads "Imported from Hugging Face: owner/repo
      at revision <8 characters>", the repo linking to
      `https://huggingface.co/datasets/<owner>/<repo>/tree/<full revision>`, the full
      revision on hover.
- [x] A dataset that was not imported from the Hub shows no source line.
- [x] The header still fits one screen with the video and the joint chart at 1280x720.

## Test Strategy

- `cd app && npx vitest run src/features/training` — `episodeFormat.test.ts` (what
  counts as a real name, labels, suffix, sides), `TrajectoryPanels.test.tsx` (paired
  legend, hues, picking a joint out), `DatasetStatsPanel.test.tsx`,
  `DatasetEpisodesPage.jointNames.test.tsx` (the page on the demo dataset's metadata,
  the placeholder fallback, the header).
- In a browser against a server with object storage: `/datasets/<id>/episodes` of
  `g1-dex3-bottle-sorting-sim` (each group tab, hover the chart, hover and click a legend
  entry, the Statistics tab), of a copy with `motor_<n>` names, of a copy without
  `meta/modality.json`, and of a Hub import (`lerobot/pusht`), at 1280x720 and 1440x900,
  light and dark.

## Notes

- Not changed: a dataset with names and no groups still draws every channel at once
  (31 lines for the demo dataset without its `modality.json`); its tooltip is then a
  31-row table, taller than the panel. Grouping such a vector by name prefix would be a
  separate task.
