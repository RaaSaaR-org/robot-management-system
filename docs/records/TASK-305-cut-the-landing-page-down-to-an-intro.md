# TASK-305 — Cut the landing page down to an intro

**Date:** 2026-09-12
**Task:** `.mc/tasks/todo/TASK-305-cut-the-landing-page-down-to-an-intro.md`
**Hand-off:** `/plan` — this is an epic, not a slice

Immutable once committed. Later changes of mind get their own record.

## What prompted it

> "there is currently too much content. so not sure if we have too many sections —
> but for sure we have too much text and too 'techy' information. i like to make
> this page as an 'intro' for devs, ai engineers and also cto and managers —
> detailed info they can get on the docs — but on the landingpage, we maybe just
> mention things like (GR00T) in one sentence, but not giving it a box in a
> section."

## Facts established before any decision was taken

| Fact | Why it mattered |
| ---- | --------------- |
| The page is **~3,260 words** of prose across ten blocks; ~2,700 always visible | Made "too much text" a number instead of an impression |
| **Four sections are expansions of one loop stage each** — Data engine/Collect, Models/Train, Proof+Safety/Operate, Sovereignty/Comply | Reframed the problem from length to redundancy, and decided Q2 |
| The density is **deliberate**: #221 cut the page 15 → 8 sections and rebuilt it as an "instrument panel" that deliberately ends on a refusal | This grill partly reverses a prior decision; doing so on purpose rather than by accident |
| `docs/brand.md` §Voice **pins the honest-label rule** and pins "Intelligence. Made physical." as the landing hero primary tagline | Made the maturity tags and the `h1` brand-contract items, not page choices |
| `docs/vla-integration-guide.md`'s support table is **three rows about serving**; **world models appear nowhere in `docs/`**; `docs/regulatory-compliance.md` is a **2027–2028 requirements matrix**, not a statement of what shipped | Killed "the detail is already in the docs" and decided Q4 |
| The loop's 612 words are **progressively disclosed** — a visitor reads ~85 | Decided what the budget in Q6 counts |
| `HonestySection` publishes `Open defect / TASK-201 — "It is open, priority 1"`, but **TASK-201 is `done` on `origin/main`, closed 2026-08-25** | The page had been publishing a false claim for eighteen days; became the argument for moving detail off the page and a hard requirement to re-verify survivors |
| `RunItSection`'s own header records **two of its commands were already wrong once** (P3019 on `prisma migrate dev`; `npm run dev:g1` starting an H1) | Decided Q7 |
| Test exposure is one unit test, one helper test and one e2e hero spec; `app-routes.spec.ts` excludes the landing page | Rewriting copy is cheap; the new guards have to be written, not inherited |

## Decisions

Each was put to the user with a recommendation and a named rejected alternative.
Owner column records who the decision belongs to.

### D1 — The page's job

**Chosen:** a visitor finishes one pass able to say *"I get what this is, and I
believe it's real."*
**Rejected:** a builder's page ("I can decide whether to clone it") — the page
already leans builder with three install blocks and nine model rows, and that lean
*is* what reads as too techy to a CTO. Also rejected: a decider-only page, and a
demo-first page with prose as a caption layer.
**Owner:** user. Matched the recommendation.

### D2 — Structure

**Chosen:** seven sections built on the loop — Hero · What it is · The Embodied
Loop · Proof · Ownership · Run it · Who. The four stage-expansion sections fold in.
**Rejected:** five sections with the loop carrying everything — it looks like the
boldest cut and is the riskiest, because data, models, safety and compliance end up
behind a click and the surviving copy gets denser, not lighter. Also rejected: ten
sections each a third as long (compresses the redundancy instead of removing it),
and dropping the loop as the spine.
**Owner:** user. Matched the recommendation.

### D3 — Where the positioning sentence lives

**Chosen:** the hero kicker becomes `MODULAR PLATFORM FOR PHYSICAL AI`, and
"A modular platform for Physical AI, built for an open ecosystem" becomes the
"What it is" `h2`. The hero `h1`, animation and type scale are untouched.
**Rejected:** putting it in the `h1` — the literal reading of the request. It
spends `clamp(64px, 6.3vw, 91px)` at `-0.065em` on nine words (four lines on
desktop, a wall at 390px) and retires a brand-pinned tagline. Offered with the
condition that `docs/brand.md` would change in the same PR; the user declined it.
**Owner:** user, on explicit instruction to keep the hero ("keep the current hero —
i really like that animation"). Matched the recommendation.

**Consequence recorded as a correction, not a preference:** `PlatformSection`
currently calls NeoDEM an *"open, all-in-one platform"*. "Modular" is the more
accurate word — `vla-server` and `training-worker` are separate repositories, NATS
and RustFS are optional with dependent features self-disabling, and the Helm chart
makes in-cluster PostgreSQL, NATS and RustFS optional.

### D4 — Where the cut detail goes

**Chosen:** one new product doc, `docs/platform.md`, receiving everything cut; each
landing section links to its anchor. One `CATEGORY_MAP` entry files it under
Getting Started.
**Rejected:** extending the existing engineering docs. It sounds tidier but
scatters one coherent answer across three documents written for a different reader
and a different question — a visitor clicking "see the model lineup" would land
inside a gRPC integration guide, and the implemented controls would sit in a matrix
about what the law will require in 2027. Also rejected: four new docs (four things
to keep true), and cutting without relocating (deletes the world-model lineup, the
implemented-controls mapping and the LiDAR comparison from the written record).
**Owner:** user. Matched the recommendation.

### D5 — Which evidence stays

**Chosen:** per-section `Live` / `Sim` / `Gated` rail tags stay, and the 0.48 m
protective-stop replay stays as the page's single exhibit. The four-row honesty
ledger, the six AI Act citations, the Art. 17 panel and the LiDAR comparison move
to `docs/platform.md`.
**Rejected:** dropping the tags for one global readiness line — it trades a
one-word tag for a disclaimer sentence, reads as legal cover rather than
confidence, and costs a brand-contract change to buy nothing the reader notices.
Also rejected: dropping the replay, which would leave "safety-first", "honest" and
"evidence" as adjectives on a page whose job is half credibility.
**Owner:** user. Matched the recommendation.

### D5a — No task status, defects or roadmap on the page

**Chosen:** nothing about open work appears on the landing page, and the
`TASK-201` panel is **removed rather than relocated**. Open work will be carried by
a future task-status and roadmap surface.
**Owner:** user, unprompted — this overrode the assistant's position. The
assistant had proposed *correcting* the stale panel and keeping the disclosure,
on the argument that a safety claim omitting its own exception is worth less than
the exception. The user's direction supersedes it, and out of scope for this
session means not filed here either.
**Verified before accepting:** the removal does not create an overclaim. TASK-201
was "say when the geofence is not enforcing" and it shipped, so the console now
reports a lapse and "an enforced keep-out zone" stands unqualified.

### D6 — The budget

**Chosen:** a per-section shape — one heading, a lede of ≤40 words, at most one
supporting block; loop stages get a headline, a one-line summary and ≤2 bullets of
≤18 words. Lands the page around 900–1,000 always-visible words by construction.
**Rejected:** a ~1,200-word total counting hidden panels — it punishes the only
progressive disclosure on the page, buys the visitor zero reading time by cutting
five panels nobody opened, and costs the AI engineer the depth-on-demand that is
the main thing left once the tables go. Also rejected: a page total (gameable — an
agent hits 900 by gutting Proof and leaving Install at 360) and no number at all
(three rounds of iteration).
**Owner:** user. Matched the recommendation.

### D7 — What "Run it" shows

**Chosen:** no commands on the page. Heading, lede, three stats (MIT · ~5 minutes
clone-to-running · no accounts) and links to `/docs/platform#install` and GitHub.
**Rejected:** keeping the three tabs. It genuinely serves the developer, but it
spends the section's one block on the least skimmable thing left and keeps the page
on the hook for commands across three install paths — two of which have already
been wrong once. The near-miss alternative, a lone `git clone`, was rejected
because a clone on its own starts nothing, so it promises a quick start it does not
deliver.
**Owner:** user. Matched the recommendation.

## Folded in without a question

Redundancy, not decisions — stated so the user could override, and not overridden:

- The `platform-team` block in "What it is" goes; `CommunitySection` says the same
  thing and keeps it.
- Both partner slots stay as Who's one supporting block — an ask, not a feature
  claim, and Who is where a convinced reader looks.
- The hero stays as it is. Thirteen words of copy, the newest work on the page
  (#259), and nothing in the request pointed at it.

## Consequences the implementer inherits

- `#data`, `#models`, `#safety` and `#sovereignty` stop existing. Nineteen links
  across `Header.NAV_ITEMS`, `Footer` and `FullCircleSection.STAGE_LINKS` must be
  remapped, and the loop's Collect / Train / Comply links become `/docs/platform#…`
  routes rather than hash scrolls.
- The Proof section has no `id` today, which is why its own CTA points at
  `#safety`. It gets `#proof`.
- Two new guards have to be written, because nothing currently prevents the page
  growing back: a word-budget test over always-visible prose, and an
  anchor-integrity test that fails if any nav, footer or stage link points at a
  section that no longer exists.
- Every surviving claim is re-verified against the repo. The `TASK-201` panel is
  the proof that this is not optional.

## Why this is an epic

Fourteen files, a new ~1,500-word doc and a rewrite of roughly 2,000 words of copy
across six components is over the `spe` ceiling as one slice. It splits with the
doc first, because every section links into it.
