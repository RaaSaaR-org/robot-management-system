---
id: "TASK-307"
aliases: []
title: "Give Proof an anchor and turn Sovereignty into Ownership"
slug: "give-proof-an-anchor-and-turn-sovereignty-into-ownership"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, design, landing]
sprint: ""
parent: "[[TASK-305]]"
depends_on: ["[[TASK-306]]"]
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Give Proof an anchor and turn Sovereignty into Ownership

## Description

Sections 4 and 5 of the seven-section intro from [[TASK-305]]. The Proof exhibit
finally gets an `id` of its own, `SovereigntySection` becomes Ownership, and
`HonestySection` — 733 words, the largest block on the page and the one publishing
a stale defect claim — is deleted. Its substance is already in
`docs/platform.md#safety`, written by [[TASK-306]].

This slice runs before the loop slice because the loop's stage links need `#proof`
to exist.

## Details

### Current state

`app/src/pages/LandingPage.tsx` (91 lines) renders ten blocks. Lines 33–82 are an
inline Proof section — the only section on the page with **no `id`**, which is why
its own call to action at lines 52–58 points at `#safety`, a different section.
`HonestySection` renders `id="safety"` and `SovereigntySection` renders
`id="sovereignty"`; both ids disappear in this slice, so every inbound link has to
move with them.

`app/src/pages/LandingPage.tsx` is **not** excluded from
`app/src/__tests__/design-drift.test.ts` (only `app/src/components/landing/**` is),
so edits there must use design tokens — no raw hex, no `dark:` variants, no
Tailwind hue classes.

`noUnusedLocals` is on in `app/tsconfig.json`, so a leftover import fails
`npx tsc --noEmit`. Use that as your check that a deletion was complete.

### The shape rule — from [[TASK-305]], applies to both sections here

One heading, a lede of **at most 40 words**, and **at most one supporting block**
(a short list, a stat pair, or an exhibit — never two).

### Section 4 — Proof (inline in `LandingPage.tsx`)

Give the section its identity:

```tsx
<section id="proof" className="lp-section lp-anchor" aria-labelledby="landing-proof-heading">
```

- **Keep** the `lp-key` kicker (`FROM THE SIMULATOR / A LOGGED RUN`), the `h2`
  ("Intelligence is knowing / when to stop."), the existing lede at lines 42–45
  (25 words — inside budget), and the whole `safety-exhibit`: `SafetyRobotScene`,
  the `HUMANOID CONCEPT / HOLD POSITION` label, the `0.48 m` clearance readout with
  its `LOGGED SIMULATION` caption, `BeliefReadout`, and the paragraph stating the
  illustration is a concept and the readout a replay. This exhibit is the page's
  evidence and the reason a reader believes the rest of it.
- **Delete** the `lp-body` provenance paragraph at lines 46–51 ("This replay comes
  from a logged warehouse simulation on 2 August 2026…"). It is the section's second
  block and it is already in `docs/platform.md#safety`. The disclaimers that sit
  *on* the exhibit stay — they are what keep the numbers honest at a glance.
- **Replace the call to action.** It currently scrolls to `#safety`. Make it a route
  into the doc:

```tsx
<Link to="/docs/platform#safety" className="lp-btn-secondary mt-7 inline-flex px-5 py-3 text-sm">
  Read how the safety layer works →
</Link>
```

  Import `Link` from `react-router-dom`. After this, `scrollToSection` is no longer
  used in `LandingPage.tsx` — drop the import (line 7).
- Do **not** add an `lp-rail` to this section. It has never had one, the exhibit's
  own labels carry the provenance, and [[TASK-305]]'s criterion is that the rails
  which exist survive, not that new ones appear.

### Section 5 — Ownership (`SovereigntySection.tsx`)

`id="sovereignty"` → `id="ownership"`, `aria-labelledby="sovereignty-heading"` →
`"ownership-heading"`, and the rail name `Sovereignty` → `Ownership`. Keep the
`lp-tag lp-tag-live` Live tag on the rail.

- **Keep** the `h2` ("Your intelligence. / On your terms.") with its id renamed.
- **Keep the provider switch** — the `lp-panel-inset` block rendering `PROVIDERS`
  (Gemini · OpenRouter · Ollama) with Ollama lit. That switch *is* the argument, and
  it is this section's one supporting block. Keep its `role="img"` and `aria-label`,
  and keep the aria-label in step with the copy.
- **Rewrite the lede to ≤40 words**, folding in the substance of the four-point
  "No vendor login" panel that currently lives in `ModelLayerSection`: MIT-licensed,
  self-hosted, and the platform's own AI can run on a model in your own building.
  **Word it so it stays true without the exceptions.** "No account needed to run it"
  is accurate; "no account needed for anything" is not — the Cosmos 3 generator
  wants a paid HuggingFace account and a hosted AI provider needs your key. Both
  exceptions are stated in `docs/platform.md#models`; the page must not imply they
  do not exist. `docs/brand.md` §Voice: the page never claims more than the system
  knows.
- **Delete the `h3` "Where the AI runs".** With one block in the section, the
  section heading is the only heading it needs.
- **Keep at most one caption under the switch**, ≤25 words, carrying the one fact
  the switch cannot draw: it is a single setting, and whichever provider you pick,
  the model that made a decision is named in the audit trail. Delete the two
  paragraphs at lines 130–140 and write that one line instead.
- **Delete and do not relocate** (all of it is in
  `docs/platform.md#ownership-and-the-record` after [[TASK-306]]):
  - the `RECORDS` array and the `RecordRow` interface (lines 17–21, 30–59)
  - the "A record you can verify" column (lines 144–170)
  - the GDPR Art. 17 "Erasure that reaches the fleet" panel (lines 174–197)
  - the two-column grid wrapper at line 91 — with one block left, it is a single
    column
- **Add the outbound link**, as a route rather than an anchor:

```tsx
<Link to="/docs/platform#ownership-and-the-record">…</Link>
```

  Match the link treatment the other landing sections use for a secondary action.
- Check whether `useBrand()` is still used after the rewrite; if the lede no longer
  interpolates `brand.name`, remove the import. `noUnusedLocals` will tell you.

### Delete `HonestySection`

- Delete `app/src/components/landing/HonestySection.tsx` (247 lines).
- Remove its import (line 14) and its render (line 83) from `LandingPage.tsx`.

Everything it said now lives in `docs/platform.md#safety`, except two things that
stay on the page in other form: the 0.48 m stop (the Proof exhibit) and one line in
the loop's `Operate` stage, which [[TASK-308]] writes.

**One thing does not move anywhere.** `HonestySection` renders a panel tagged
`Open defect` / `TASK-201` asserting *"It is open, priority 1"*. `TASK-201` has
`status: done` on `origin/main`, closed 2026-08-25 — the page has been publishing a
false claim. It is removed, not corrected and not relocated: explicit user
direction on [[TASK-305]] is that task status, defects and the roadmap appear
nowhere on the landing page or in the docs, because a future task-status and
roadmap surface will carry open work. That surface is out of scope and is not to be
filed as part of this epic.

The claim it qualified survives without it, because the fix shipped: `TASK-201` was
"say when the geofence is not enforcing", so the console now reports a lapse. "An
enforced keep-out zone" stands on its own.

### Navigation

`app/src/components/landing/Header.tsx`, `NAV_ITEMS` (lines 16–23):

- `{ label: 'Safety', href: '#safety' }` → `{ label: 'Proof', href: '#proof' }`
- add `{ label: 'Ownership', href: '#ownership' }` directly after it

It reads seven rows after this slice; [[TASK-308]] removes `Data` and `Models` and
brings it to the final five. Leaving a row pointing at a deleted id is not an
option: `scrollToSection` returns without `preventDefault` when the target is
missing, and the demo build's `HashRouter` then renders `NotFoundPage` — the exact
failure `scrollToSection.ts`'s file header describes.

`app/src/components/landing/Footer.tsx`, `footerLinks['On this page']`
(lines 31–39):

- `{ name: 'Safety', href: '#safety' }` → `{ name: 'Proof', href: '#proof' }`
- `{ name: 'Sovereignty', href: '#sovereignty' }` → `{ name: 'Ownership', href: '#ownership' }`

### One redundancy to leave alone for one commit

`ModelLayerSection`'s "No vendor login" panel still renders after this slice, saying
in four points roughly what Ownership's new lede says in one sentence. **Do not
delete `ModelLayerSection` here.** The loop's `STAGE_LINKS.train` points at
`#models` until [[TASK-308]] remaps it, and deleting the section early leaves a
dead nav link. The redundancy is gone one commit later.

### Key files

Modify:
- `app/src/pages/LandingPage.tsx` — Proof gets `id="proof"`, loses the provenance
  paragraph, CTA becomes a docs `Link`; `HonestySection` import and render removed
- `app/src/components/landing/SovereigntySection.tsx` — becomes Ownership
- `app/src/components/landing/Header.tsx` — `NAV_ITEMS`
- `app/src/components/landing/Footer.tsx` — `On this page`

Delete:
- `app/src/components/landing/HonestySection.tsx`

## Acceptance Criteria

- [ ] The Proof section renders `id="proof"` with `className="lp-section lp-anchor"`,
      and its call to action is a `Link` to `/docs/platform#safety`.
- [ ] The Proof exhibit still renders `SafetyRobotScene`, `BeliefReadout`, the
      `0.48 m` clearance readout and both simulation labels.
- [ ] The Proof section holds one heading, a lede of ≤40 words and the exhibit —
      nothing else. The "logged warehouse simulation on 2 August 2026" paragraph is
      gone from the page.
- [ ] `SovereigntySection` renders `id="ownership"`, its rail reads `Ownership` with
      the `Live` tag, it holds one heading, a lede of ≤40 words, the provider switch
      with at most one ≤25-word caption, and a `Link` to
      `/docs/platform#ownership-and-the-record`.
- [ ] The Ownership lede is true as written even though the Cosmos 3 generator wants
      a paid HuggingFace account and a hosted provider needs a key.
- [ ] `RECORDS`, the "A record you can verify" column and the Art. 17 panel are gone
      from the component and appear nowhere else on the landing page.
- [ ] `HonestySection.tsx` is deleted and imported nowhere; `grep -rn
      'HonestySection' app/src` returns nothing.
- [ ] No task id, open defect, priority or roadmap item appears anywhere on the
      landing page: `grep -rnE 'TASK-[0-9]{3}|Open defect' app/src/components/landing
      app/src/pages/LandingPage.tsx` returns nothing.
- [ ] No `href` in `Header.NAV_ITEMS` or `Footer`'s `On this page` points at
      `#safety` or `#sovereignty`, and every one that remains matches an `id`
      rendered by `LandingPage`.
- [ ] `ModelLayerSection` and `DataEngineSection` are untouched and still render —
      they belong to [[TASK-308]].
- [ ] `npx tsc --noEmit` clean; `npx vitest run src/components/landing
      src/__tests__/design-drift.test.ts --silent` green.

## Test Strategy

**Unit**

No new test file in this slice — the page-level guards (word budget and anchor
integrity) land with the last cut, in [[TASK-309]], because they can only be true
once every section is done. What must stay green here:

- `app/src/components/landing/__tests__/scrollToSection.test.ts` — it uses `#proof`,
  `#install` and `#safety` as jsdom fixture ids, not page anchors, so it is
  unaffected. If it fails, you changed the helper, which is out of scope.
- `app/src/__tests__/design-drift.test.ts` — it scans `LandingPage.tsx`.

**Browser**

With the app running, on the landing page: every header and footer link scrolls to
a real section; `Proof` and `Ownership` both land on their heading; the Proof CTA
and the Ownership link open the docs viewer on the right heading. Check both themes
at 390 px and 1440 px — the Ownership section loses a two-column grid in this
slice, so its single column is worth a look at desktop width.

**Manual read**

Read Proof and Ownership as a CTO. Proof should be believable in fifteen seconds;
Ownership should answer "what does this cost me in lock-in?" in one sentence.

## Notes

Child of [[TASK-305]]. Runs after [[TASK-306]] (its two links point into
`docs/platform.md`) and before [[TASK-308]] (whose stage links need `#proof`).
Decision record: `docs/records/TASK-305-cut-the-landing-page-down-to-an-intro.md`.
