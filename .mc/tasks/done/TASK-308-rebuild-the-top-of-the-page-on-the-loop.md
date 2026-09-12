---
id: "TASK-308"
aliases: []
title: "Rebuild the top of the page on the loop"
slug: "rebuild-the-top-of-the-page-on-the-loop"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, design, landing]
sprint: ""
parent: "[[TASK-305]]"
depends_on: ["[[TASK-306]]", "[[TASK-307]]"]
spe: 5
effort: "high"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Rebuild the top of the page on the loop

## Description

Sections 1–3 of the seven-section intro from [[TASK-305]], and the slice that
removes the epic's structural defect: `DataEngineSection` and `ModelLayerSection`
are expansions of two loop stages the page has already named, so the loop absorbs
them at stage-copy size and both files are deleted. The hero gains a new kicker,
`PlatformSection` gains the positioning sentence, and every stage of the loop is
rewritten to the shape rule.

This is the copy-heavy slice. It is also where the "GR00T gets one sentence and no
box" direction becomes true.

## Details

### Current state

`app/src/components/landing/FullCircleSection.tsx` (321 lines) holds `STAGES` —
six stages of `headline` + `summary` + three bullets, **510 words**, longest bullet
38 words — and `STAGE_LINKS` (lines 109–116), which points at `#data`, `#models`
and `#sovereignty`. `#data` and `#models` are deleted by this slice and
`#sovereignty` was renamed to `#ownership` by [[TASK-307]], so every one of the six
links has to move.

`DataEngineSection.tsx` (176 lines, `id="data"`, 291 words) and
`ModelLayerSection.tsx` (243 lines, `id="models"`, 375 words) still render. Their
content is already in `docs/platform.md` — `## The data engine` and `## Models`,
written by [[TASK-306]].

`noUnusedLocals` is on in `app/tsconfig.json`: a leftover import fails
`npx tsc --noEmit`, which is your completeness check on every deletion here.

### The shape rule — from [[TASK-305]]

One heading, a lede of **at most 40 words**, and **at most one supporting block**.
Loop stages get a headline, a one-line summary and **at most two bullets of at most
18 words each**.

### Section 1 — Hero: one line changes, nothing else

`app/src/components/landing/HeroSection.tsx` line 22:

```tsx
<span /> {brand.name} / MODULAR PLATFORM FOR PHYSICAL AI
```

(from `{brand.name} / THE OPEN PHYSICAL AI PLATFORM`). Keep reading the name from
`useBrand()`.

**Touch nothing else in the hero.** Not `HeroScene`, not `hero.css`, not the `h1`,
the lede, the actions, the principles row or the footnote. The animation is wanted
exactly as it is, and `docs/brand.md` §Taglines pins "Intelligence. Made physical."
as the landing hero primary tagline. `app/e2e/landing-hero.spec.ts` is the contract
that this held: it must pass unchanged, and it checks `.field-kicker`'s computed
font family and size, so keep it a plain `field-kicker` paragraph.

### Section 2 — What it is (`PlatformSection.tsx`)

- **The `h2` becomes the positioning sentence**, keeping the two-line display
  treatment:

```tsx
<h2 id="platform-heading" className="lp-display">
  A modular platform for Physical AI,
  <br />
  <span>built for an open ecosystem.</span>
</h2>
```

  It is much longer than "A home for / Physical AI.", and `.platform-intro h2` in
  `platform.css` is `clamp(3.5rem, 6.8vw, 6.3rem)` (line 33) with
  `clamp(3.3rem, 12vw, 5.2rem)` under the mobile media query (line 250). Check it at
  320 and 390 px; if the block turns into a wall, lower the clamp minimum in
  `platform.css`. That file is landing-scoped and excluded from the design-drift
  scan, so a type adjustment there is in scope.
- **Rewrite the definition to ≤40 words total**, and around *modular*. It currently
  says "an open, **all-in-one** platform" (line 40), which is both the less accurate
  claim and a contradiction of the new heading: `vla-server` and `training-worker`
  are separate repositories, NATS and RustFS are optional with the dependent
  features switching themselves off and saying so, and `helm/neodem` makes
  in-cluster PostgreSQL, NATS and RustFS optional. Build the sentence on modular and
  the open ecosystem — open format, open weights, models from more than one vendor.
  Count the vendors against `ModelLayerSection.POLICIES`' `origin` values before you
  name a number.
- The lede budget covers the `platform-lead` line ("Big ideas deserve a life beyond
  the lab.") **and** the definition paragraph together — keep one of the two, or
  merge them, but ≤40 words in total.
- **Keep the blueprint diagram.** It is this section's one supporting block. Keep
  its `role="img"` and `aria-label`, and keep the label in step with the copy.
- **Delete the `platform-team` block** (lines 100–119, the "Agentic by design /
  Expert-led by choice" pair). It says what `CommunitySection` says; Who keeps it.
  Then delete the orphaned rules in `platform.css`: `.platform-team` (line 226),
  `.platform-team h3` (234), `.platform-team-copy` (240), the
  `.platform-team-copy p` half of the shared selector at 43–46, and the
  `.platform-team` entries inside the media queries at 244–245 and 280.
- Check `ArrowUpRight` and `NeoDEMMark` are still used after the deletion;
  `noUnusedLocals` will say.

### Section 3 — The Embodied Loop (`FullCircleSection.tsx`)

**Keep every mechanic.** The geometry (`STAGE_ANGLES`, `stagePosition`,
`infinityPath`, `LOOP_PATH`, `CROSSING_PATH`), the SVG, the nodes, the
`aria-pressed` / `aria-controls` wiring, the `aria-live` readout, the pause control
and `data-paused`, the per-stage `Live` / `Sim` / `Gated` tags and `tagLabel`, and
the `embodied-loop-disclosure` paragraph that defines the three words. Copy and
links are what change.

**The intro.** `embodied-loop-promise` ("Every deployment starts the next
discovery.") and `embodied-loop-description` (lines 166–171) together are the
section's lede: ≤40 words for both. Keep the eyebrow and the `h2`.

**Delete the `embodied-loop-return` strip** (lines 307–311). "What happens in the
world becomes what you teach next" restates the promise line one screen below it,
and the shape rule allows the section one supporting block — the loop. Remove the
orphaned CSS in `embodied-loop.css`: `.embodied-loop-return` and its children
(lines 318–341) and the media-query entries at 438–447 and 467.

**Rewrite `STAGES`** to headline + one-line summary + ≤2 bullets of ≤18 words. From
510 words to roughly 300, of which about 50 are visible at a time. What each stage
has to carry, now that two sections are gone:

| Stage | Must still say | Absorbed from |
| ----- | -------------- | ------------- |
| `Collect` | versioned datasets in an open format; the LiDAR scan that became a navigable twin | `DataEngineSection` |
| `Train` | your data, your model, LeRobot format both ways; **the one GR00T sentence** | `ModelLayerSection` |
| `Deploy` | registry, staged rollout, signed updates; the bridge to a real G1 is locked | — |
| `Evaluate` | scored attempt by attempt; the two traps you are meant to fail | — |
| `Operate` | a plan you can read before it runs; the fence stopped it 0.48 m clear | `HonestySection` (one line) |
| `Comply` | an audit trail that cannot be edited quietly; erasure that reaches the robot | — |

**GR00T appears exactly once on the whole page**: one sentence, in `Train`, and in
no table, card or panel. It occurs five times today — two rows of the VLA table, one
world-model row, and the `Train` and `Evaluate` bullets. Deleting
`ModelLayerSection` removes three; you remove the `Evaluate` mention and keep one in
`Train`.

**Every surviving claim gets re-checked** against the repo before it is rewritten
— see [[TASK-306]]'s verification table, and note two traps it found: `BaseModels`
in `server/src/types/vla.types.ts:23` is six entries and **π0.5 is not one of
them**, and the "GR00T N1.7 trains natively" claim needs the training wizard's model
list to still agree. A shorter bullet is not a licence to drop the qualifier that
made the old one true.

**Remap `STAGE_LINKS`.** Three targets are now docs routes and three are the Proof
section, so the type needs to carry both kinds. Use a discriminated union — it needs
no non-null assertion at the call site:

```ts
type StageLink =
  | { kind: 'anchor'; href: string; label: string }
  | { kind: 'doc'; to: string; label: string };

const STAGE_LINKS: Record<string, StageLink> = {
  collect: { kind: 'doc', to: '/docs/platform#the-data-engine', label: 'Read about the data engine' },
  train: { kind: 'doc', to: '/docs/platform#models', label: 'See which models are ready' },
  deploy: { kind: 'anchor', href: '#proof', label: 'See the deployment gates hold' },
  evaluate: { kind: 'anchor', href: '#proof', label: 'See the simulation evidence' },
  operate: { kind: 'anchor', href: '#proof', label: 'Watch it stop' },
  comply: { kind: 'doc', to: '/docs/platform#ownership-and-the-record', label: 'Read about ownership and the record' },
};
```

Render a `doc` link as `<Link to={link.to}>` (import `Link` from
`react-router-dom`) and an `anchor` link as today's `<a href>` with
`scrollToSection`. Keep the `embodied-loop-link` class and the `ArrowUpRight` on
both. Three distinct labels on the same `#proof` target is deliberate — it is what
the section does today with `#safety`.

**`scrollToSection` must not be used for a docs route.** It only handles `#…` and
would let the browser follow the href; under the demo build's `HashRouter` that is
the `NotFoundPage` failure `scrollToSection.ts`'s header describes. `DocsPage`
resolves the `#heading` part itself (`app/src/pages/DocsPage.tsx`, the
`location.hash` effect).

**`collect` is the default active stage**, so the component now renders a `<Link>`
on first paint. Every test that renders `FullCircleSection` must wrap it in a
`MemoryRouter` from now on, or React Router throws.

### Delete the two absorbed sections

- Delete `app/src/components/landing/DataEngineSection.tsx`
- Delete `app/src/components/landing/ModelLayerSection.tsx`
- Remove both imports (lines 12–13) and both renders (lines 31–32) from
  `app/src/pages/LandingPage.tsx`

Check `landing-theme.css` for tags that lose their last user — `lp-tag-stopped` and
`lp-tag-gated` are used by `ModelLayerSection`'s `STATUS_TAG`, but also elsewhere;
grep before deleting any rule.

### Navigation

`Header.tsx`, `NAV_ITEMS`: remove `{ label: 'Data', href: '#data' }` and
`{ label: 'Models', href: '#models' }`. Five rows remain — Platform, Embodied Loop,
Proof, Ownership, Install — which is the final set apart from the `Install` label,
renamed by [[TASK-309]].

`Footer.tsx`, `footerLinks['On this page']`: remove `Data engine` and `Models`, and
add `{ name: 'Platform', href: '#platform' }` as the first entry so the footer
lists the same sections the page has.

**Also fix the footer brand column.** Line 75 reads "The all-in-one Physical AI
platform." — the same claim this slice corrects in `PlatformSection`, and it
contradicts the new hero kicker. Rewrite it around modular, in the one line it has.

### Key files

Modify:
- `app/src/components/landing/HeroSection.tsx` — kicker only
- `app/src/components/landing/PlatformSection.tsx` — heading, definition, delete the team block
- `app/src/components/landing/platform.css` — orphaned `.platform-team*` rules, h2 clamp if needed
- `app/src/components/landing/FullCircleSection.tsx` — intro, `STAGES`, `STAGE_LINKS`, the return strip
- `app/src/components/landing/embodied-loop.css` — orphaned `.embodied-loop-return` rules
- `app/src/pages/LandingPage.tsx` — two imports and two renders removed
- `app/src/components/landing/Header.tsx` — `NAV_ITEMS`
- `app/src/components/landing/Footer.tsx` — `On this page`, brand column
- `app/src/components/landing/__tests__/FullCircleSection.test.tsx` — new copy, `MemoryRouter`

Delete:
- `app/src/components/landing/DataEngineSection.tsx`
- `app/src/components/landing/ModelLayerSection.tsx`

Create:
- `app/src/components/landing/__tests__/landingClaims.test.ts` — the GR00T occurrence guard

## Acceptance Criteria

- [ ] The hero is byte-identical apart from `field-kicker`, which reads
      `MODULAR PLATFORM FOR PHYSICAL AI`. `HeroScene.tsx`, `hero.css` and the `h1`
      are untouched, and `app/e2e/landing-hero.spec.ts` passes unmodified.
- [ ] `PlatformSection`'s `h2` is the positioning sentence, its lede is ≤40 words
      and says modular rather than all-in-one, the blueprint is its only supporting
      block, and the `platform-team` block and its CSS are gone.
- [ ] `grep -rn 'all-in-one' app/src/components/landing app/src/pages/LandingPage.tsx`
      returns nothing.
- [ ] Every stage in `STAGES` is a headline, a one-line summary and at most two
      bullets of at most 18 words each. A test asserts the bullet budget over
      `STAGES` so it cannot drift back.
- [ ] `STAGES` totals under 330 words, down from 510.
- [ ] GR00T appears exactly once across the landing components and
      `LandingPage.tsx`, in the loop's `Train` stage, and in no table, card or
      panel. A test asserts the count.
- [ ] No entry in `STAGE_LINKS` points at `#data`, `#models`, `#safety` or
      `#sovereignty`; the three `doc` links render as router `Link`s and the three
      `anchor` links scroll to `#proof`.
- [ ] The loop keeps its six per-stage maturity tags, the disclosure paragraph, the
      geometry, the pause control and the keyboard interaction.
- [ ] `DataEngineSection.tsx` and `ModelLayerSection.tsx` are deleted and imported
      nowhere; `LandingPage` renders seven sections in order — Hero, `#platform`,
      `#circle`, `#proof`, `#ownership`, `#install`, `#who`.
- [ ] `Header.NAV_ITEMS` is five entries and `Footer`'s `On this page` lists
      Platform, Embodied Loop, Proof, Ownership, Install and Who builds it; no link
      points at a missing id.
- [ ] The footer brand column no longer claims all-in-one.
- [ ] `npx tsc --noEmit` clean; `npx vitest run src/components/landing
      src/__tests__/design-drift.test.ts --silent` green.

## Test Strategy

**Unit** — `app/src/components/landing/__tests__/FullCircleSection.test.tsx`

Keep the geometry case and the pause case exactly as they are. Update the selection
case to the new copy, and **wrap every render in `MemoryRouter`** — the default
active stage now renders a router `Link`. Assert the two link kinds:

```tsx
render(<MemoryRouter><FullCircleSection /></MemoryRouter>);
// collect is active: a route into the docs
expect(screen.getByRole('link', { name: /data engine/ }).getAttribute('href'))
  .toBe('/docs/platform#the-data-engine');
fireEvent.click(screen.getByRole('button', { name: 'Operate — Sim' }));
expect(screen.getByRole('link', { name: 'Watch it stop' }).getAttribute('href')).toBe('#proof');
```

Add the budget case over the data, not the DOM:

```ts
STAGES.forEach((stage) => {
  expect(stage.bullets.length).toBeLessThanOrEqual(2);
  stage.bullets.forEach((b) => expect(b.split(/\s+/).length).toBeLessThanOrEqual(18));
  expect(stage.summary.split(/\s+/).length).toBeLessThanOrEqual(20);
});
```

Do not delete a case to make it pass, and do not weaken one into a tautology.

**Unit** — `app/src/components/landing/__tests__/landingClaims.test.ts` (new)

Read the landing sources as text and count GR00T. Strip comments first, so a comment
explaining the rule does not break the rule:

```ts
const SOURCES = import.meta.glob<string>(
  ['../*.tsx', '../../../pages/LandingPage.tsx'],
  { query: '?raw', import: 'default', eager: true },
);
// strip /* */ and // comments, then count /GR00T/g across every file
```

Assert exactly one occurrence in total, and that the file holding it is
`FullCircleSection.tsx`.

**Browser**

Playwright MCP, both themes: the loop's six stages each select and read correctly;
the three `#proof` links scroll to the Proof section; the three docs links open the
viewer at `#the-data-engine`, `#models` and `#ownership-and-the-record`; the pause
control works; reduced motion is honoured. Check `#platform` at 320 and 390 px —
the new heading is long, and the hero must be unchanged at every width.

**Manual read**

Read Hero → What it is → the loop as a developer and then as a manager. After three
sections a reader should be able to say what NeoDEM is; if a stage panel still reads
like a spec sheet, it is over budget.

## Notes

Child of [[TASK-305]]. Needs [[TASK-306]] for the three docs anchors and
[[TASK-307]] for `#proof`. Decision record:
`docs/records/TASK-305-cut-the-landing-page-down-to-an-intro.md`.
