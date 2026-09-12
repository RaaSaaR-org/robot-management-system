---
id: "TASK-306"
aliases: []
title: "Write the platform doc the landing page links into"
slug: "write-the-platform-doc-the-landing-page-links-into"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, design, landing]
sprint: ""
parent: "[[TASK-305]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Write the platform doc the landing page links into

## Description

Create `docs/platform.md` — one product-level page saying what NeoDEM does and how
ready each part is — and file it under Getting Started in the docs viewer. It is the
first child of [[TASK-305]] because it is the destination: every later slice cuts
detail off the landing page and links to a heading in this file, so the file has to
exist, and the detail has to be *here*, before anything is removed from the page.

This slice touches no landing component. The page keeps rendering exactly as it does
today.

## Details

### Current state

`docs/` holds 25 markdown files and nothing covers the product end to end:

- `docs/vla-integration-guide.md` is about *serving* a model from the sibling
  `vla-server` repo. Its support table is three rows (lines 39–41): SmolVLA
  `Active`, GR00T N1 `Ready`, pi0.5 `Stub only (TASK-078)`.
- World action models appear nowhere in `docs/` at all.
- `docs/regulatory-compliance.md` is a 2027–2028 requirements matrix — what the AI
  Act will ask for, not what this repository implements.

So the tables the landing page is about to lose have nowhere to go. Writing this
doc is not documentation housekeeping; without it the cut *deletes* information.

The docs viewer needs no new code: `app/src/components/docs/docsRegistry.ts` inlines
every `docs/**/*.md` through `import.meta.glob('../../../../docs/**/*.md', {query:
'?raw', eager: true})`, `app/src/pages/DocsPage.tsx` serves it at `/docs/*` and
resolves a `#hash` to a heading id via `slugifyHeading` in
`app/src/components/docs/docsMarkdown.ts`. Only the category needs declaring.

### Where the content comes from

Harvest it from the components that still exist on this branch — later children of
[[TASK-305]] delete three of them, which is why this slice runs first:

| Source | What to take |
| ------ | ------------ |
| `app/src/components/landing/DataEngineSection.tsx` | `SOURCES` (five capture paths, each with its `produces` sub-label and note), `PIPELINE` (the four steps), the Curation panel ("Improve the data. Keep the original.") |
| `app/src/components/landing/ModelLayerSection.tsx` | `POLICIES` (six VLA rows), `WORLD_MODELS` (three rows including the Cosmos 3 evaluator no-go), the four-point "No vendor login" panel **including both honest exceptions**, and the closing GPU footnote |
| `app/src/components/landing/HonestySection.tsx` | `ROWS` (UNCONFIRMED · UNKNOWN · NULL · SIM), the four E-Stop scopes and the keep-out fence paragraph, `CLOSING_FACTS` (the 0.48 m stop, crash recovery) |
| `app/src/components/landing/SovereigntySection.tsx` | `PROVIDERS`, `RECORDS` (the six AI Act / GDPR citations), the Art. 17 erasure panel |
| `app/src/components/landing/RunItSection.tsx` | `PATHS` (Local, Docker, Kubernetes commands verbatim), `REQUIREMENTS`, the sibling-repository paragraph, the runtime footnote |
| `app/src/pages/LandingPage.tsx` lines 46–51 | the provenance paragraph: "a logged warehouse simulation on 2 August 2026… stopped 0.48 m from the rack; a second approach stopped at 0.49 m" |

Copy the *substance*, not the register. These are marketing blocks; this is a
reference page. Turn the ledger rows into tables and prose, keep every number, and
keep every caveat that makes a number honest.

### The seven headings — they are the anchors

Write exactly these, in this order. `slugifyHeading` lowercases, strips anything
that is not a letter, number, space or hyphen, then turns spaces into hyphens, so
the slugs are:

| Heading | Slug | Receives |
| ------- | ---- | -------- |
| `# NeoDEM — the platform` | (title, not linked) | one paragraph: what it is, who it is for, what this page is |
| `## Readiness at a glance` | `readiness-at-a-glance` | what Live / Sim / Gated mean, and a per-component table |
| `## The data engine` | `the-data-engine` | the five capture paths with their notes, the four-step pipeline, curation-keeps-the-original |
| `## Models` | `models` | the VLA lineup, the three world action models including the Cosmos 3 evaluator no-go, and "no vendor login" with both honest exceptions |
| `## Safety` | `safety` | the four honest states, the four E-Stop scopes, the keep-out fence, the LiDAR 0.017 m vs 0.94 m comparison, crash recovery, and the logged-run provenance of the 0.48 m stop |
| `## Ownership and the record` | `ownership-and-the-record` | the provider switch in detail, the six implemented AI Act / GDPR controls, Art. 17 erasure reaching the fleet, retention vs legal hold |
| `## Install` | `install` | the three command paths (Local · Docker · Kubernetes), the requirements, the sibling repositories |

Four of those slugs are linked from the landing page by later children
(`the-data-engine`, `models`, `safety`, `ownership-and-the-record`, `install`), so
**do not reword those five headings** — a later slice hard-codes them.

The em dash in the title collapses to a double hyphen (`neodem--the-platform`).
That is fine because nothing links to it; do not put an em dash in any heading that
is a link target.

Sub-headings (`###`) are welcome inside a section. Keep the maturity words
`Live` / `Sim` / `Gated` as words, spelled exactly as the landing page spells them —
the rail tag on the page is what sends a reader here, and the two must agree.

`## Readiness at a glance` carries the same six verdicts as
`FullCircleSection.STAGES`: Collect `Live`, Train `Live`, Deploy `Gated`,
Evaluate `Sim`, Operate `Sim`, Comply `Live`. No child of [[TASK-305]] changes
those values, so the table and the loop must match.

Aim for about 1,500 words. Voice: `docs/brand.md` §Voice — honest labels,
simulated data says Sim, gated features say Gated, never claim more than the system
knows.

### Nothing about task status, defects or the roadmap

Explicit user direction on [[TASK-305]], and it binds this doc too.
`HonestySection` renders an `Open defect` / `TASK-201` panel — **do not carry it
here in any form**. Open work will be shown by a future task-status and roadmap
surface, which is out of scope and is not to be filed.

The mechanism behind that panel is still worth documenting, without the task id and
without calling it open: a robot that has walked far enough without a fresh position
fix stops trusting its own pose, the fence then answers *unknown*, and the safety
layer is built to do nothing on unknown. `TASK-201` — "say when the geofence is not
enforcing" — shipped, so the console now reports the lapse. Verify that in the code
before you write it either way.

`grep -nE 'TASK-[0-9]{3}|priority|roadmap' docs/platform.md` must come back empty.

### Re-verify every claim before you write it

`TASK-201`'s panel was stale in public for eighteen days. Nothing goes into this
file unchecked. Known things to check, with where:

| Claim | Check against |
| ----- | ------------- |
| SmolVLA `Active` / GR00T N1 `Ready` / π0.5 `Stub` | `docs/vla-integration-guide.md:39–41` |
| "six base models" | `server/src/types/vla.types.ts:23` — `BaseModels = ['pi0','pi0_6','openvla','groot','groot_n1_7','smolvla']`. **π0.5 is not in that tuple.** The landing table's six rows are not these six: it merges π0 · π0.6 into one row and adds π0.5, which is a serving-side stub rather than a selectable base model. Say what is true: six selectable base models, and π0.5 scaffolded in the VLA server but not selectable |
| GR00T N1.7 "trains natively, straight from the training wizard" | `app/src/features/training/components/TrainingJobWizard.tsx` and the `BaseModels` tuple |
| the two world-model generators, their embodiments, and which one wants a paid HuggingFace account | `server/src/services/CosmosSyntheticService.ts` |
| the Cosmos 3 evaluator no-go | `server/curation/README.md`, the `cosmos3_wm_eval.py` study (around line 140) |
| `Gemini` · `OpenRouter` · `Ollama` | `server/src/services/llm/index.ts` |
| all seven data-subject request types | `server/src/types/gdpr.types.ts` |
| a legal hold beats retention | `server/src/jobs/RetentionCleanupJob.ts` |
| Art. 17 erasure reaches the fleet, offline robots reported unreachable | `server/src/services/RobotMemoryErasureService.ts` |
| the audit trail names a tampered entry | `GET /api/compliance/verify` |
| E-Stop reporting `UNCONFIRMED` and the four scopes | `robot-agent/src/agent-mode/agent-mode-controller.ts` |
| LiDAR 0.017 m average error over 24 measurements vs 0.94 m for the vision guess | the range query the `HonestySection` header names (`range.ts`) and the run that produced the numbers |
| the three install paths | the repo itself: `package.json` scripts, `server/prisma/schema.prisma`'s provider, `docker-compose.yml`, `helm/neodem` |

The install commands need real care: `RunItSection`'s file header records that two
of them were wrong once — `npx prisma migrate dev` aborts with P3019 against a
`sqlite` schema (so the block uses `prisma db push`), and `npm run dev:g1` silently
starts an H1 on :41243 unless `.env.g1` is written first, because that file is
untracked and dotenv no-ops on a missing file. Both fixes are in the current
`PATHS`; carry them, and re-check them.

If a claim no longer holds, correct it or drop it. Do not soften it into something
unfalsifiable.

### The registry entry

`app/src/components/docs/docsRegistry.ts`, in `CATEGORY_MAP`, next to the other
Getting Started entries:

```ts
'platform': 'Getting Started',
```

Without it `categoryFromSlug('platform')` falls through to `'Other'` — and
`app/src/components/docs/__tests__/docsRegistry.test.ts` already has a case,
"leaves nothing stranded in Other", that fails on exactly that. So the omission is
caught; add the entry in the same commit as the file.

### Key files

Create:
- `docs/platform.md`

Modify:
- `app/src/components/docs/docsRegistry.ts` — one `CATEGORY_MAP` entry
- `app/src/components/docs/__tests__/docsRegistry.test.ts` — one new case

## Acceptance Criteria

- [ ] `docs/platform.md` exists and carries exactly the seven headings above, in
      that order, spelled so that `slugifyHeading` yields `readiness-at-a-glance`,
      `the-data-engine`, `models`, `safety`, `ownership-and-the-record` and
      `install`.
- [ ] `## Readiness at a glance` defines Live, Sim and Gated, and its per-component
      table carries the same six verdicts as `FullCircleSection.STAGES`
      (Live · Live · Gated · Sim · Sim · Live).
- [ ] Every block listed in "Where the content comes from" is represented: the five
      capture paths, the four pipeline steps, curation, the VLA lineup, the three
      world action models with the Cosmos 3 no-go, both honest exceptions, the four
      honest states, the four E-Stop scopes, the fence, the LiDAR comparison, crash
      recovery, the 0.48 m stop with its provenance, the provider switch, the six
      citations, Art. 17, retention vs legal hold, and the three install paths.
- [ ] `grep -nE 'TASK-[0-9]{3}|priority 1|roadmap' docs/platform.md` returns
      nothing.
- [ ] Every claim in the file has been checked against the repository, and the notes
      in the commit message or the PR say which ones were corrected.
- [ ] `categoryFromSlug('platform') === 'Getting Started'`, and `platform` appears
      under Getting Started in the docs sidebar.
- [ ] `/docs/platform` renders in the viewer, its table of contents lists the seven
      headings, and `/docs/platform#safety` scrolls to Safety.
- [ ] No file under `app/src/components/landing/` or `app/src/pages/LandingPage.tsx`
      is modified by this slice.
- [ ] `npx tsc --noEmit` clean; `npx vitest run src/components/docs --silent`
      green.

## Test Strategy

**Unit** — `app/src/components/docs/__tests__/docsRegistry.test.ts`

Add one case to the `categoryFromSlug` describe and one to `the loaded registry`:

```ts
expect(categoryFromSlug('platform')).toBe('Getting Started');
expect(DOC_CONTENT.get('platform')).toContain('## Readiness at a glance');
```

The existing "leaves nothing stranded in Other" case covers the failure mode; do
not weaken it.

**Browser**

Open `/docs/platform` in the viewer. Check the sidebar category, the table of
contents, and that each of the five linked anchors resolves:
`#the-data-engine`, `#models`, `#safety`, `#ownership-and-the-record`, `#install`.
These are the exact URLs later children link to, so a typo here surfaces as a dead
link on the landing page two slices later.

**Manual read**

Read it as a CTO who has just left the landing page wanting one level more detail.
Every claim should either carry its evidence or say plainly that it is simulated.

## Notes

Child of [[TASK-305]]. First in the order: nothing may be cut from the landing page
until the detail has landed here. Decision record:
`docs/records/TASK-305-cut-the-landing-page-down-to-an-intro.md`.
