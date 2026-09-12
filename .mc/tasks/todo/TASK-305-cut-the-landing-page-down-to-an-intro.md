---
id: "TASK-305"
aliases: []
title: "Cut the landing page down to an intro"
slug: "cut-the-landing-page-down-to-an-intro"
status: "todo"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [design, landing]
sprint: ""
parent: ""
depends_on: []
spe:
effort: ""
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Cut the landing page down to an intro

## Description

The landing page reads as a reference, not an introduction: ~3,260 words of prose
across ten blocks, with nine-row model tables, six EU AI Act citations and three
pasteable install paths. Rebuild it as an intro for developers, AI engineers, CTOs
and managers — seven sections built on the Embodied Loop — and move the detail into
one new product doc, `docs/platform.md`.

The job the page has to do, and the measure of every decision below: a first-time
visitor finishes one pass able to say **"I get what this is, and I believe it's
real."** Nothing on the page needs to survive an audit; the docs carry that.

## Details

### Current state (measured 2026-09-12)

`app/src/pages/LandingPage.tsx` renders ten blocks: `HeroSection`,
`PlatformSection`, `FullCircleSection`, `DataEngineSection`, `ModelLayerSection`,
an inline Proof section, `HonestySection`, `SovereigntySection`, `RunItSection`,
`CommunitySection`, with `Header` and `Footer` around them.

Prose per block, user-visible strings only:

| Block | Words |
| ----- | ----: |
| `HonestySection` | 733 |
| `FullCircleSection` | 612 |
| `ModelLayerSection` | 375 |
| `RunItSection` | 362 |
| `DataEngineSection` | 291 |
| `SovereigntySection` | 281 |
| Proof (in `LandingPage`) + `BeliefReadout` | 215 |
| `CommunitySection` | 148 |
| `PlatformSection` | 141 |
| `HeroSection` · `Header` · `Footer` | 98 |
| **Total** | **3,256** |

About 550 of those are behind a click — five of the loop's six stage panels and two
of Install's three command tabs — so always-visible prose is ~2,700 words.

**The structural defect.** Four sections are expansions of a single loop stage the
page has already named:

| Section | Restates | Loop stage |
| ------- | -------- | ---------- |
| `DataEngineSection` | how episodes get in | Collect |
| `ModelLayerSection` | what you train | Train |
| Proof + `HonestySection` | what happens when it runs | Operate |
| `SovereigntySection` | the record and the ownership | Comply |

This is the same defect #221's commit message named in the version before it
("15 sections that stated the six-stage lifecycle five times"). #221 cut the count
and kept the pattern. Shortening every section leaves it intact.

**Anchors.** `#platform` `#circle` `#data` `#models` `#safety` `#sovereignty`
`#install` `#who`, linked from three places: `Header.NAV_ITEMS` (6),
`Footer` (7 entries) and `FullCircleSection.STAGE_LINKS` (6). `#data`, `#models`,
`#safety` and `#sovereignty` all disappear — every one of those links has to be
remapped.

**Test exposure is small.** `app/src/components/landing/__tests__/` holds only
`FullCircleSection.test.tsx` (63 lines) and `scrollToSection.test.ts`;
`app/e2e/landing-hero.spec.ts` covers the hero; `app/e2e/app-routes.spec.ts`
explicitly excludes the landing page.

### The shape rule — applies to every section

One heading, a lede of **at most 40 words**, and **at most one supporting block**
(a short list, a stat pair, or an exhibit — never two). Loop stages get a headline,
a one-line summary and **at most two bullets of at most 18 words each**.

This is the budget. It is per section on purpose: a page-total budget is satisfied
by gutting one section and leaving another at 360 words. Expect the page to land
around 900–1,000 always-visible words by construction.

### The seven sections

| # | Section | id | Its one supporting block |
| - | ------- | -- | ------------------------ |
| 1 | Hero | — | the existing `HeroScene` animation |
| 2 | What it is | `#platform` | the `platform-blueprint` diagram |
| 3 | The Embodied Loop | `#circle` | the interactive loop |
| 4 | Proof | `#proof` | the stop exhibit (`SafetyRobotScene` + `BeliefReadout`) |
| 5 | Ownership | `#ownership` | the provider switch (Gemini · OpenRouter · Ollama) |
| 6 | Run it | `#install` | three stats: MIT · ~5 min clone-to-running · no accounts |
| 7 | Who | `#who` | the three-row party ledger |

`Header.NAV_ITEMS` becomes five anchors: Platform · Embodied Loop · Proof ·
Ownership · Run it. `Footer`'s list follows the same seven sections. `Who` is
reachable by scroll and from the footer.

### Section 1 — Hero: unchanged except the kicker

**Do not touch** `HeroScene`, `hero.css`, the `h1`, the lede, the actions or the
principles row. The animation is wanted exactly as it is, and
`docs/brand.md` pins **"Intelligence. Made physical."** as the landing hero
primary tagline — it stays.

One edit: `field-kicker` becomes `NeoDEM / MODULAR PLATFORM FOR PHYSICAL AI`
(from `NeoDEM / THE OPEN PHYSICAL AI PLATFORM`). Read the name from
`useBrand()` as it already does.

### Section 2 — What it is (`PlatformSection`)

- `h2` becomes the positioning sentence: **"A modular platform for Physical AI,
  built for an open ecosystem."** Replaces "A home for Physical AI."
- The definition paragraph currently says *"an open, **all-in-one** platform"*.
  That is the less accurate claim and it contradicts the new heading: `vla-server`
  and `training-worker` are separate repositories, NATS and RustFS are optional with
  the dependent features switching themselves off, and the Helm chart makes
  in-cluster PostgreSQL, NATS and RustFS optional. Rewrite it around **modular**
  and the open ecosystem — open format, open weights, models from four vendors.
- **Delete the `platform-team` block** (the "Agentic by design / Expert-led by
  choice" pair). It says what `CommunitySection` says; Who keeps it.
- Keep the blueprint diagram — it is this section's one block. Keep its `aria-label`
  in sync with the copy.

### Section 3 — The Embodied Loop (`FullCircleSection`)

The loop absorbs what Data engine and Models were saying, at stage-copy size —
not at section size. Current stage copy is 510 words (longest bullet 38). Rewrite
to the shape rule: headline, one-line summary, at most two bullets of ≤18 words.

- **GR00T gets one sentence, in `Train`, and no box** — this is explicit user
  direction. It currently appears five times: two rows of the VLA table, one
  world-model row, and the `Train` and `Evaluate` bullets.
- Keep the per-stage `Live` / `Sim` / `Gated` tags and the `embodied-loop-disclosure`
  paragraph that defines them.
- Keep the geometry, the animation, the pause control, the keyboard interaction and
  `stagePosition`. Copy changes only.
- **`STAGE_LINKS` must be remapped** — `#data`, `#models` and `#sovereignty` no
  longer exist. Point `collect` at `/docs/platform#the-data-engine`, `train` at
  `/docs/platform#models`, `comply` at `/docs/platform#ownership-and-the-record`,
  and `deploy` / `evaluate` / `operate` at `#proof`. The docs targets are routes,
  not hash scrolls: use `<Link to=…>`, not `scrollToSection`. `DocsPage` already
  resolves a hash to a heading.

### Section 4 — Proof (the inline section in `LandingPage.tsx`)

Keep it, and give it `id="proof"` and `className="lp-section lp-anchor"` — it is
currently the only section with no id, which is why its own CTA points at
`#safety`.

- Keep `SafetyRobotScene`, `BeliefReadout`, the `0.48 m` clearance readout and the
  "logged simulation, not physical hardware" labels. This exhibit is the page's
  evidence and the reason a reader believes the rest.
- Cut the copy to the shape rule: heading, ≤40-word lede, the exhibit. The
  "This replay comes from a logged warehouse simulation on 2 August 2026…"
  paragraph moves to `docs/platform.md#safety`; the simulation disclaimers that sit
  *on* the exhibit stay.
- Its CTA becomes a link to `/docs/platform#safety`.

### Section 5 — Ownership (`SovereigntySection`, absorbing `HonestySection`)

`HonestySection` is deleted as a section. What survives of it is one line in the
loop's `Operate` stage and the Proof exhibit; everything else moves to
`docs/platform.md#safety`.

`SovereigntySection` becomes Ownership, `id="ownership"`:

- Keep the `h2` ("Your intelligence. / On your terms.") and the provider switch —
  that switch is the argument, and it is this section's one block.
- **Leaves the page:** the six `RECORDS` citations (Art. 12, Annex IV, Art. 14,
  Art. 30, Art. 15–22, Retention) and the Art. 17 erasure panel. Both go to
  `docs/platform.md#ownership-and-the-record`.
- The four-point "No vendor login" panel in `ModelLayerSection` is the same argument
  as this section. Fold its substance into the ≤40-word lede — MIT, self-hosted,
  and a model in your own building — and move the rest, **including the two honest
  exceptions** (Cosmos 3 wants a paid HuggingFace account; a hosted AI provider
  needs your key), to `docs/platform.md#models`.
- **Word the lede so it does not need the exceptions to be true.** "No account
  needed to run it" is accurate; "no account needed for anything" is not.
  `docs/brand.md` §Voice — the page never claims more than the system knows.
- Keep one `Live` tag on the rail, and a link to
  `/docs/platform#ownership-and-the-record`.

### Section 6 — Run it (`RunItSection`)

**No commands on the page.** Delete the whole tablist, the three `PATHS` command
blocks, the copy-to-clipboard machinery, `splitComment`, the roving-tabindex
keyboard handling and the sibling-repo paragraph.

What replaces it: the heading, a ≤40-word lede, the three `REQUIREMENTS` stats
(`~5 minutes` · `MIT` · `no accounts needed`) as the one block, and two links —
`/docs/platform#install` and the GitHub repository.

Reason, for whoever revisits this: the commands are the most drift-prone content on
the page. `RunItSection`'s own file header records that two of them were already
wrong once (`npx prisma migrate dev` aborting with P3019 against a `sqlite`
schema, and `npm run dev:g1` silently starting an H1 on :41243 because `.env.g1`
is untracked). A command that fails on first paste costs more credibility than it
buys. They belong in a doc that is read next to the repo.

### Section 7 — Who (`CommunitySection`)

Smallest change. Cut to the shape rule: heading, ≤40-word lede, the three-row
`PARTIES` ledger, the contact action. **Both partner slots stay** — public cloud
host and compute credits. Drop the "Have a robot, a research question…" paragraph
into the lede or cut it; it duplicates what the lede says.

### Nothing about task status, defects or the roadmap — anywhere

Explicit user direction, and it overrides what the page does today.

`HonestySection` renders a panel tagged `Open defect` / `TASK-201` asserting *"It
is open, priority 1"*. **`TASK-201` has `status: done` on `origin/main`, closed
2026-08-25** — the page has been publishing a false claim. Remove it. Do **not**
carry it into `docs/platform.md`: open work will be shown by a future task-status
and roadmap surface, which is out of scope here and is not to be filed as part of
this task.

The claim it qualified is fine without it, because the fix shipped: TASK-201 was
"say when the geofence is not enforcing", so the console now reports a lapse.
"An enforced keep-out zone" stands on its own.

### Re-verify every claim that survives

TASK-201 went stale in public for eighteen days. Before a claim is carried into
either the page or `docs/platform.md`, check it against the repo, and correct or
drop what no longer holds. Known things to check: the `π0.5` stub status (cited as
TASK-078), `GR00T N1.7` "trains natively", the six-entry `BaseModels` tuple in
`server/src/types/vla.types.ts`, the three-row support table in
`docs/vla-integration-guide.md`, and the `Cosmos 3` evaluator no-go in
`server/curation/README.md`.

### The new doc — `docs/platform.md`

One product-level page: what NeoDEM does and how ready each part is. It exists
because there is nowhere else for this to go — `docs/vla-integration-guide.md`'s
support table is three rows about *serving* a model, world models appear nowhere in
`docs/` at all, and `docs/regulatory-compliance.md` is a 2027–2028 requirements
matrix rather than a statement of what was implemented.

Headings, which are also the anchors the landing page links to (GitHub-style slugs
via `slugifyHeading`):

| Heading | Receives |
| ------- | -------- |
| `# NeoDEM — the platform` | title; one paragraph |
| `## Readiness at a glance` | what Live / Sim / Gated mean, and a per-component table |
| `## The data engine` | the five capture paths with their notes, the four-step pipeline, curation-keeps-the-original |
| `## Models` | the six-row VLA lineup, the three world action models incl. the Cosmos 3 evaluator no-go, and "no vendor login" with both honest exceptions |
| `## Safety` | the four honest states (UNCONFIRMED · UNKNOWN · NULL · SIM), the four E-Stop scopes, the keep-out fence, the LiDAR 0.017 m vs 0.94 m comparison, crash recovery, and the logged-run provenance of the 0.48 m stop |
| `## Ownership and the record` | the provider switch in detail, the six implemented AI Act / GDPR controls, Art. 17 erasure reaching the fleet, retention vs legal hold |
| `## Install` | the three command paths (Local · Docker · Kubernetes), the requirements, the sibling repositories |

Add one entry to `CATEGORY_MAP` in `app/src/components/docs/docsRegistry.ts`:
`'platform': 'Getting Started'`. Without it the slug falls through to `Other`.

Keep the maturity tags in the doc as words (`Live` / `Sim` / `Gated`) — the page
and the doc must agree, because the rail tag is what sends a reader here.

### Key files

Modify:
- `app/src/pages/LandingPage.tsx` — drop two imports, give Proof an id, cut its copy
- `app/src/components/landing/HeroSection.tsx` — kicker only
- `app/src/components/landing/PlatformSection.tsx` — heading, definition, delete team block
- `app/src/components/landing/FullCircleSection.tsx` — `STAGES` copy, `STAGE_LINKS`
- `app/src/components/landing/SovereigntySection.tsx` — becomes Ownership
- `app/src/components/landing/RunItSection.tsx` — commands out, stats in
- `app/src/components/landing/CommunitySection.tsx` — trim
- `app/src/components/landing/Header.tsx` — `NAV_ITEMS` → five anchors
- `app/src/components/landing/Footer.tsx` — section list
- `app/src/components/docs/docsRegistry.ts` — one `CATEGORY_MAP` entry
- `app/src/components/landing/__tests__/FullCircleSection.test.tsx` — assertions on stage copy

Delete:
- `app/src/components/landing/DataEngineSection.tsx`
- `app/src/components/landing/ModelLayerSection.tsx`
- `app/src/components/landing/HonestySection.tsx`

Create:
- `docs/platform.md`

Check for orphans afterwards: `platform.css`, `embodied-loop.css`, `hero.css` and
`landing-theme.css` — the deleted sections used shared `lp-*` classes, so expect
few, but a rule with no remaining selector should go.

## Acceptance Criteria

- [ ] `LandingPage.tsx` renders exactly seven sections in order: Hero, What it is
      (`#platform`), The Embodied Loop (`#circle`), Proof (`#proof`), Ownership
      (`#ownership`), Run it (`#install`), Who (`#who`).
- [ ] `DataEngineSection.tsx`, `ModelLayerSection.tsx` and `HonestySection.tsx` are
      deleted and no longer imported anywhere.
- [ ] Every section satisfies the shape rule: one heading, a lede of ≤40 words, and
      at most one supporting block. Every loop stage is a headline, a one-line
      summary and ≤2 bullets of ≤18 words.
- [ ] Always-visible landing prose is under 1,100 words, down from ~2,700. A unit
      test measures it so it cannot silently drift back.
- [ ] The hero is byte-identical apart from `field-kicker`, which reads
      `MODULAR PLATFORM FOR PHYSICAL AI`. `HeroScene`, `hero.css` and the `h1` are
      untouched.
- [ ] `PlatformSection`'s `h2` is the positioning sentence, the definition paragraph
      says modular rather than all-in-one, and the `platform-team` block is gone.
- [ ] GR00T appears exactly once on the landing page — one sentence in the loop's
      `Train` stage — and in no table, card or panel.
- [ ] No task id, open defect, priority or roadmap item appears anywhere on the
      landing page or in `docs/platform.md`. `grep -rE 'TASK-[0-9]{3}'
      app/src/components/landing app/src/pages/LandingPage.tsx docs/platform.md`
      returns nothing.
- [ ] Per-section `Live` / `Sim` / `Gated` rail tags survive on every section that
      had one, and the loop keeps its per-stage tags and its disclosure paragraph.
- [ ] The Proof exhibit still renders `SafetyRobotScene`, `BeliefReadout`, the
      `0.48 m` readout and its simulation labels.
- [ ] `RunItSection` contains no shell command, no `<pre>`, no tablist and no
      clipboard call.
- [ ] `docs/platform.md` exists with the seven headings above, and
      `CATEGORY_MAP['platform'] === 'Getting Started'` so it files under Getting
      Started in the docs sidebar.
- [ ] Every anchor referenced by `Header.NAV_ITEMS`, `Footer` and
      `FullCircleSection.STAGE_LINKS` either exists on the page or is a
      `/docs/platform#…` route that resolves to a real heading. A unit test asserts
      it — no link may point at `#data`, `#models`, `#safety` or `#sovereignty`.
- [ ] Every claim carried into the page or the doc has been checked against the
      repo, and the stale `TASK-201` panel is gone rather than relocated.
- [ ] `npx tsc --noEmit` clean; `npx vitest run src/components/landing
      src/components/docs src/__tests__/design-drift.test.ts` green;
      `app/e2e/landing-hero.spec.ts` green.
- [ ] No horizontal overflow at 320, 390, 768, 1024 and 1440 px, in both themes,
      with reduced motion honoured.

## Test Strategy

**Unit** (`app/src/components/landing/__tests__/`)

- A **word-budget test** that walks the landing components, extracts user-visible
  strings and asserts always-visible prose is under 1,100 words, with the loop's
  unopened stage panels and any hidden content excluded. This is the only
  guard that keeps the page from growing back, so it belongs in the same commit as
  the cut.
- An **anchor-integrity test**: collect every `href`/`to` in `Header.NAV_ITEMS`,
  `Footer` and `STAGE_LINKS`; assert each `#…` matches an `id` rendered by
  `LandingPage`, and each `/docs/platform#…` matches a heading slug produced by
  `slugifyHeading` over `docs/platform.md`. Build the expected set by walking the
  source, not by calling the same helper on both sides.
- A **GR00T occurrence test**: exactly one mention across the landing components.
- Update `FullCircleSection.test.tsx` for the new stage copy. Do not delete a case
  to make it pass and do not weaken one into a tautology; the geometry and
  interaction cases stay.
- `docsRegistry` test: `platform` resolves to the `Getting Started` category and its
  content is non-empty.

**Browser**

- `app/e2e/landing-hero.spec.ts` must pass unchanged — it is the contract that the
  hero was not disturbed.
- Playwright MCP at 320, 390, 768, 1024, 1440 px, light and dark: no overflow, no
  page errors, every nav anchor scrolls to its section, the loop's docs links land
  on the right heading in the docs viewer, the pause control and reduced motion
  still work.

**Manual read**

- Read the page top to bottom once as each reader: a dev, an AI engineer, a CTO. If
  any of the three hits a paragraph they would skip, it is still too long.

## Notes

Decision record: `docs/records/TASK-305-cut-the-landing-page-down-to-an-intro.md`.

Grilled 2026-09-12. Seven decisions, all taken by the user: the page's job, the
seven-section shape, where the positioning sentence lives, one new product doc as
the destination, which evidence stays, a per-section budget instead of a page
total, and no commands in Run it. The record carries the alternative each one
rejected.

Out of scope, named here so it is not quietly picked up: the task-status and
roadmap surface that will eventually carry open work. Not to be filed as part of
this task.

This is an epic — it is over the `spe` ceiling as one slice (fourteen files, a new
~1,500-word doc, and a rewrite of roughly 2,000 words of copy across six
components) and it splits cleanly with the doc first, since every section links
into it.

### Children

Planned 2026-09-12. Four slices, in dependency order — the doc first, because every
section links into it, and the page-level guards last, because the word budget and
the anchor set are only true once every cut has landed.

| Task | Slice | spe | effort | Blocked by |
| ---- | ----- | --: | ------ | ---------- |
| [[TASK-306]] | Write the platform doc the landing page links into | 5 | medium | — |
| [[TASK-307]] | Give Proof an anchor and turn Sovereignty into Ownership | 3 | medium | [[TASK-306]] |
| [[TASK-308]] | Rebuild the top of the page on the loop | 5 | high | [[TASK-306]], [[TASK-307]] |
| [[TASK-309]] | Take the commands out of Run it and lock the page budget | 5 | medium | [[TASK-308]] |

Section 4 (Proof) comes before section 3 (the loop) on purpose: the loop's remapped
stage links need `#proof` to exist, and a slice must never leave a nav or stage link
pointing at an id that is gone — `scrollToSection` fails silently on a missing
target and the demo build's `HashRouter` then renders `NotFoundPage`.

One redundancy is allowed to stand for exactly one commit: after [[TASK-307]] the
Ownership lede and `ModelLayerSection`'s "No vendor login" panel say the same thing,
until [[TASK-308]] deletes that file. It is noted in both children so it is not
"fixed" out of turn.
