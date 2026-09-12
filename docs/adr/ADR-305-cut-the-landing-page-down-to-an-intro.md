# ADR-305 — Cut the landing page down to an intro

- **Status:** Accepted — implemented and merged 2026-09-12
- **Epic:** TASK-305 (closed; children TASK-306 … TASK-309)
- **Supersedes:** the spec body of TASK-305, distilled here so the task file can close
- **Decision record:** `docs/records/TASK-305-cut-the-landing-page-down-to-an-intro.md` keeps the interview, with the alternatives each decision rejected

## Context

The landing page had ~3,260 words of prose across ten blocks — nine-row model
tables, six EU AI Act citations, three pasteable install paths. It read as a
reference. Five sections deep it was explaining curation revisions and E-Stop
scopes to a reader who had not yet been told what the platform is.

The measure the rebuild was judged against: a first-time visitor — a developer,
an AI engineer, a CTO or an operations manager — finishes one pass able to say
*"I get what this is, and I believe it's real."* Nothing on the page needs to
survive an audit; the docs carry that.

**The structural defect was not length.** Four sections were expansions of a
loop stage the page had already named: `DataEngineSection` restated Collect,
`ModelLayerSection` restated Train, Proof plus `HonestySection` restated
Operate, `SovereigntySection` restated Comply. That is the same defect #221's
commit message named one redesign earlier ("15 sections that stated the
six-stage lifecycle five times"): #221 cut the count and kept the pattern.
Shortening every section would have left it intact a third time.

One fact settled the shape: the page had been publishing a false claim.
`HonestySection` rendered a panel tagged `Open defect / TASK-201` asserting
*"It is open, priority 1"* — and TASK-201 had been `done` on `main` since
2026-08-25, eighteen days. A page that carries task status goes stale in public
without anyone noticing.

## Decision

**Seven sections, built on the Embodied Loop, with the detail one link away.**

| # | Section | id | Its one supporting block |
| - | ------- | -- | ------------------------ |
| 1 | Hero | — | the existing `HeroScene` animation |
| 2 | What it is | `#platform` | the `platform-blueprint` diagram |
| 3 | The Embodied Loop | `#circle` | the interactive loop |
| 4 | Proof | `#proof` | the stop exhibit |
| 5 | Ownership | `#ownership` | the provider switch |
| 6 | Run it | `#install` | three stats: MIT · ~5 min · no accounts |
| 7 | Who | `#who` | the three-row party ledger |

Five decisions carry the rest:

1. **A per-section budget, not a page total.** One heading, a lede of ≤40 words,
   at most one supporting block; loop stages get a headline, a one-line summary
   and ≤2 bullets of ≤18 words. A page-total budget is satisfied by gutting one
   section and leaving another at 360 words.
2. **The loop absorbs the four redundant sections at stage-copy size** — not at
   section size. `DataEngineSection`, `ModelLayerSection` and `HonestySection`
   are deleted, and `docs/platform.md` receives what they carried.
3. **The positioning word is modular, not all-in-one.** All-in-one is the less
   accurate claim: `vla-server` and `training-worker` are separate repositories,
   NATS and RustFS are optional with their features switching themselves off,
   and the Helm chart makes in-cluster PostgreSQL, NATS and RustFS optional.
4. **No commands on the page.** They are the most drift-prone content it had —
   two were wrong once already (`prisma migrate dev` aborting with P3019 against
   a `sqlite` schema; `npm run dev:g1` silently starting an H1 because `.env.g1`
   is untracked and dotenv no-ops on a missing file). A command that fails on
   first paste costs more credibility than it buys, so they live next to the
   repository that corrects them.
5. **Nothing about task status, defects or the roadmap, anywhere** — page or
   doc. Open work belongs on a task-status surface, which this epic deliberately
   did not build. The stale panel was removed rather than corrected: the claim it
   qualified ("an enforced keep-out zone") stands on its own now that TASK-201's
   fix has shipped.

**`docs/platform.md` is the destination**, served by the in-app docs viewer under
Getting Started (`CATEGORY_MAP['platform']`), under a title and six sections whose
slugs are the anchors the page links into: Readiness at a glance · The data engine
· Models · Safety · Ownership and the record · Install. It exists because there was
nowhere else for this material: `docs/vla-integration-guide.md`'s support table is
three rows about *serving*, world models appear nowhere in `docs/`, and
`docs/regulatory-compliance.md` is a 2027–2028 requirements matrix rather than a
statement of what is implemented.

## Why the slices ran out of page order

TASK-306 (the doc) → TASK-307 (Proof, Ownership) → TASK-308 (hero, loop) →
TASK-309 (Run it, the guards).

The doc runs first because nothing may be cut before the detail has a home. Proof
is cut before the loop, against page order, because the loop's remapped stage
links need `#proof` to exist — and a stale anchor here is not a no-op.
`scrollToSection` returns without calling `preventDefault` when its target is
missing, the browser follows the bare href, and the demo build's `HashRouter`
parses `#data` as the pathname `data` and renders `NotFoundPage`. So every slice
repointed the nav rows it invalidated inside its own commit, and no intermediate
commit left a link pointing at a deleted id.

The one accepted redundancy: Ownership's new lede duplicated
`ModelLayerSection`'s "no vendor login" panel for exactly one commit, because
deleting that section belonged to TASK-308.

## Corrections the re-verification found

The epic required every surviving claim to be re-checked against the repository
before it was carried into the page or the doc. Four things were not true as
written:

- **`BaseModels` has no π0.5.** The tuple in `server/src/types/vla.types.ts` is
  six entries and π0.5 is not among them — it is scaffolded in the sibling
  `vla-server` with no weights behind it. The page's six-row table was never that
  tuple: it merged π0 · π0.6 into one row and added π0.5. The doc now says "six
  selectable base models" and states π0.5's status as prose rather than as a
  table row that would imply selectability.
- **GR00T-Dreams' "within 0.08 rad" figure had no source.** It appeared only in
  the component asserting it. Dropped rather than softened.
- **Over-the-air delivery does not exist.** The doc's first draft called the
  signed OTA update "real"; `UpdateService.ts` says in its own header that it
  signs and records an update and never delivers one. The row now says packages
  are signed and recorded and nothing reaches a robot yet.
- **This repository cannot vouch for a sibling's licence.** The draft asserted
  that all sibling repos are MIT and linked from the README; neither is in the
  README. It now points at the README's "Next door" table.

## Explicitly rejected — do not re-raise

- **Shortening the ten sections instead of deleting four.** Tried in #221. It
  preserves the restatement pattern, which is the actual defect.
- **A page-total word budget.** See decision 1.
- **Keeping the commands on the page behind a tab.** The drift risk is in the
  commands, not in their presentation.
- **Relocating the task-status panel into `docs/platform.md`.** Status belongs to
  a surface that is generated from the tracker, not to prose a human maintains.
- **Renaming `SovereigntySection.tsx` to match its new Ownership heading.** Left
  as it is; the file's header explains what the section became.

## Consequences

Always-visible prose in `<main>` is **659 words**, down from ~2,700, and three
guards hold the shape:

- `landingBudget.test.tsx` walks `<main>` (Header renders `NAV_ITEMS` twice) and
  fails over 1,100 words total or 300 in any one section, printing per-section
  counts. The ceiling leaves room to grow by two thirds before it fires — it
  catches a relapse, not creep.
- `landingAnchors.test.tsx` resolves every in-page anchor against the ids the
  page really renders and every `/docs/platform#…` fragment against
  `extractHeadings` run over the real markdown — the same function `DocsPage`
  uses — so a renamed heading in the doc fails the page's test.
- `landingClaims.test.ts` counts claims in shipped copy with comments stripped:
  GR00T exactly once, "all-in-one" never.

The cost is that the page and the doc must now agree about maturity words **by
hand**: a rail tag reading `Gated` is what sends a reader to the doc, so `Live` /
`Sim` / `Gated` are spelled the same in both, and the doc's readiness table
restates the six verdicts that live in `FullCircleSection.STAGES`. Nothing
asserts that the two still match — `landingAnchors.test.tsx` catches a renamed
*heading*, not a changed verdict, so a stage that turns `Sim` into `Live` has to
be edited in both places. Tying the table to `STAGES` in a test is the obvious
next guard; it was not built here.
