---
id: "TASK-309"
aliases: []
title: "Take the commands out of Run it and lock the page budget"
slug: "take-the-commands-out-of-run-it-and-lock-the-page-budget"
status: "todo"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, design, landing]
sprint: ""
parent: "[[TASK-305]]"
depends_on: ["[[TASK-308]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Take the commands out of Run it and lock the page budget

## Description

The last two sections of the seven-section intro from [[TASK-305]] — Run it loses
every shell command, Who gets trimmed — and the three page-level guards that keep
the page from growing back: a word-budget test, an anchor-integrity test, and the
orphaned-CSS sweep. It runs last because the budget can only be measured once every
cut has landed.

## Details

### Current state

`app/src/components/landing/RunItSection.tsx` is 384 lines and 362 words: a tablist
of three `PATHS`, a 12-line pasteable Local block, copy-to-clipboard with a flash
state and an `aria-live` status, `splitComment`, roving-tabindex arrow/Home/End
keyboard handling, a `REQUIREMENTS` stat row, a sibling-repository paragraph and a
runtime footnote. `CommunitySection.tsx` is 132 lines and 148 words.

After [[TASK-308]], `Header.NAV_ITEMS` is five entries with `Install` still labelled
`Install`, and the page renders its final seven sections.

`noUnusedLocals` is on in `app/tsconfig.json` — it is your check that the
clipboard, tab and `splitComment` machinery is fully gone, not just unreferenced.

### The shape rule — from [[TASK-305]]

One heading, a lede of **at most 40 words**, and **at most one supporting block**.

### Section 6 — Run it (`RunItSection.tsx`)

**No commands on the page.** Delete:

- the `PATHS` array and the `InstallPath` interface
- the whole tablist and every `tabpanel`, including the `<pre>` blocks
- `handleCopy`, `flash`, `timerRef`, `tabRefs`, `handleTabKey`, `splitComment`, the
  `CopyState` type and the `sr-only` `aria-live` status
- the sibling-repository paragraph (lines 340–347) and the runtime footnote
  (lines 352–357) — both are in `docs/platform.md#install`
- the `HELM_URL` constant and its "Browse the Helm chart" link; the chart is covered
  in the doc

**What the section becomes:** the rail (`Install` · `Live`), the existing `h2`
("Your robotic cloud. / On your hardware."), a lede of ≤40 words, the three
`REQUIREMENTS` stats as its one supporting block (`~5 minutes` · `MIT` ·
`no accounts needed`), and two links:

- `<Link to="/docs/platform#install">` — where the commands now live
- the GitHub repository, external, as today

Keep `REQUIREMENTS` and its `dl` markup as they are; re-check the three values
against the repo before shipping them. Check whether `useBrand()` survives the lede
rewrite and drop the import if not.

The reason, for whoever revisits this: the commands are the most drift-prone content
on the page. This file's own header records that two of them were wrong once —
`npx prisma migrate dev` aborting with P3019 against a `sqlite` schema, and
`npm run dev:g1` silently starting an H1 on :41243 because `.env.g1` is untracked.
A command that fails on first paste costs more credibility than it buys. They belong
next to the repo, in the doc.

### Section 7 — Who (`CommunitySection.tsx`)

Smallest change on the page:

- Cut the lede to ≤40 words. Fold in or drop the "Have a robot, a research question
  or a use case worth exploring?" paragraph (lines 112–115); it repeats what the
  lede already says.
- **Keep all three `PARTIES` rows**, both open partner slots included — public cloud
  host and compute credits. The open slots are the point of the ledger.
- Keep the `The team and open opportunities` label, the `Active` / `Open` tags, the
  rail, and the `Start a conversation` contact action.
- The three `description` strings run 30–40 words each. Trim them so the ledger
  reads as a ledger — one or two lines a row.

### Navigation

`Header.tsx`: `{ label: 'Install', href: '#install' }` → `{ label: 'Run it', href:
'#install' }`. The id stays `#install`; only the label changes.

`Footer.tsx`: the same rename in `footerLinks['On this page']`.

Final nav: Platform · Embodied Loop · Proof · Ownership · Run it, plus Docs and
GitHub. Final footer list: Platform · Embodied Loop · Proof · Ownership · Run it ·
Who builds it.

### Guard 1 — the word budget

`app/src/components/landing/__tests__/landingBudget.test.tsx` (new). This is the
only thing standing between the page and a slow return to 2,700 words, so it ships
with the last cut.

Render the real page and count what a visitor actually reads:

```tsx
vi.mock('../HeroScene', () => ({ HeroScene: () => null }));
render(<MemoryRouter><LandingPage /></MemoryRouter>);
```

`vi.mock` resolves relative to the test file, so `'../HeroScene'` is the same module
id `HeroSection` imports. Mocking it loses no prose: every string inside `HeroScene`
is `aria-hidden` decoration. It also keeps three.js out of jsdom —
`HeroScene` dynamically imports `./heroEngine`, and the global `matchMedia` stub in
`app/src/test/setup.ts` reports `matches: false`, so the real component would try.

Then walk `<main>` and count words in text nodes, skipping any ancestor that is
`[hidden]`, `[aria-hidden="true"]`, `.sr-only`, `<svg>`, `<style>` or `<script>`.
Measure `<main>`, not the document: `Header` renders `NAV_ITEMS` twice (desktop and
a mobile menu that is `invisible`, not `hidden`), and chrome counted twice is noise.

Assert two things:

- the whole of `<main>` is **under 1,100 words**
- **no single `<section>` is over 300 words** — this is what makes [[TASK-305]]'s
  per-section rule checkable, because a page total is satisfied by gutting one
  section and leaving another at 360

Report per-section counts in the failure message, keyed by each section's `id` or
its `aria-labelledby` heading, or the test tells a maintainer nothing they can act
on.

The loop naturally renders one stage panel at a time, so the five unopened panels
are outside the count by construction — no special casing.

### Guard 2 — anchor integrity

`app/src/components/landing/__tests__/landingAnchors.test.tsx` (new). Nothing in the
page today prevents a link pointing at a section that no longer exists, and
`scrollToSection` fails silently on a missing target: it returns without
`preventDefault`, the browser follows the href, and the demo build's `HashRouter`
renders `NotFoundPage`.

Export the link models so the test reads the real data rather than a copy:

- `Header.tsx`: `export const NAV_ITEMS` (it is already a module const)
- `Footer.tsx`: export the link map as `FOOTER_LINKS` — rename the existing
  `footerLinks` const and its single `Object.entries` use

Then, in the test:

- render `LandingPage` (same mock and router wrapper as guard 1) and collect every
  `id` in `<main>`
- for every `href` in `NAV_ITEMS` and every `FooterLink` that is neither `external`
  nor `internal`: assert it starts with `#` and that the id exists on the page
- for every `to`/`href` of the shape `/docs/platform#…` — from `NAV_ITEMS`,
  `FOOTER_LINKS`, `FullCircleSection.STAGE_LINKS` and the two section links added by
  [[TASK-307]] — assert the fragment matches a heading id produced by
  `extractHeadings` over the real markdown:

```ts
import platformDoc from '../../../../../docs/platform.md?raw';
import { extractHeadings } from '../../docs/docsMarkdown';
```

  `?raw` is typed by `vite/client` (referenced from `app/src/vite-env.d.ts`), and
  `extractHeadings` is the same function `DocsPage` uses to build those ids — so the
  assertion is against what the viewer will really render, not against a second call
  to the same helper on both sides.
- assert explicitly that **no** link anywhere points at `#data`, `#models`,
  `#safety` or `#sovereignty`

### Guard 3 — the orphaned-CSS sweep

Three components and several blocks were deleted across [[TASK-307]] and
[[TASK-308]]. For each class defined in `landing-theme.css`, `platform.css` and
`embodied-loop.css`, grep `app/src` for a remaining user and delete the rules that
have none. Expect few — the deleted sections mostly used shared `lp-*` classes —
and check before each deletion: `lp-tag-stopped` and `lp-tag-gated` had users
outside the landing page.

**`hero.css` is out of bounds.** The hero did not change, so it has no orphans, and
[[TASK-305]] requires it untouched.

### Key files

Modify:
- `app/src/components/landing/RunItSection.tsx` — commands out, stats stay
- `app/src/components/landing/CommunitySection.tsx` — trim to the shape rule
- `app/src/components/landing/Header.tsx` — `Install` → `Run it`, export `NAV_ITEMS`
- `app/src/components/landing/Footer.tsx` — same rename, export `FOOTER_LINKS`
- `app/src/components/landing/landing-theme.css`, `platform.css`,
  `embodied-loop.css` — orphaned rules only

Create:
- `app/src/components/landing/__tests__/landingBudget.test.tsx`
- `app/src/components/landing/__tests__/landingAnchors.test.tsx`

## Acceptance Criteria

- [ ] `RunItSection` contains no shell command, no `<pre>`, no `role="tablist"` and
      no clipboard call: `grep -nE 'npm |git clone|docker |helm |<pre|tablist|clipboard'
      app/src/components/landing/RunItSection.tsx` returns nothing.
- [ ] Run it renders one heading, a lede of ≤40 words, the three `REQUIREMENTS`
      stats, a `Link` to `/docs/platform#install` and the GitHub link — and keeps
      its `Install` · `Live` rail.
- [ ] Who renders one heading, a lede of ≤40 words, all three `PARTIES` rows with
      both open partner slots, and the contact action.
- [ ] `Header.NAV_ITEMS` reads Platform · Embodied Loop · Proof · Ownership · Run it,
      and the footer's `On this page` lists those five plus Who builds it.
- [ ] The word-budget test asserts `<main>` under 1,100 words and every `<section>`
      under 300, and names the per-section counts when it fails.
- [ ] The anchor-integrity test covers `NAV_ITEMS`, `FOOTER_LINKS` and
      `STAGE_LINKS`; every `#…` resolves to an id rendered by `LandingPage` and every
      `/docs/platform#…` resolves to a heading id from `extractHeadings` over
      `docs/platform.md`; `#data`, `#models`, `#safety` and `#sovereignty` appear
      nowhere.
- [ ] Every CSS rule whose last user was deleted in [[TASK-307]] or [[TASK-308]] is
      gone, and `hero.css` is unmodified.
- [ ] `npx tsc --noEmit` clean; `npx vitest run src/components/landing
      src/components/docs src/__tests__/design-drift.test.ts --silent` green;
      `app/e2e/landing-hero.spec.ts` passes unmodified.
- [ ] No horizontal overflow at 320, 390, 768, 1024 and 1440 px in both themes, with
      reduced motion honoured and no console errors.
- [ ] With this slice merged, every criterion on [[TASK-305]] is satisfiable — check
      the epic's list and say in the PR which criteria this slice closed.

## Test Strategy

**Unit**

The two new guards above, plus the existing suites staying green:
`FullCircleSection.test.tsx`, `scrollToSection.test.ts`, `landingClaims.test.ts`
(the GR00T guard from [[TASK-308]]), `docsRegistry.test.ts` and
`design-drift.test.ts`.

Write the budget test so a failure is actionable and the number is not a magic
constant: state in a comment that 1,100 is [[TASK-305]]'s criterion, measured down
from ~2,700 always-visible words.

**Browser**

Playwright MCP over the finished page, at 320, 390, 768, 1024 and 1440 px, in light
and dark:

- no horizontal overflow (`document.documentElement.scrollWidth <= innerWidth`) and
  no page errors at any width
- every header, footer and in-page link reaches its section
- the loop's three docs links land on the right heading in the docs viewer
- the pause control and reduced motion still behave
- `app/e2e/landing-hero.spec.ts` green, unmodified — the hero's contract

**Manual read**

Read the whole page top to bottom once as each of the three readers [[TASK-305]]
names: a developer, an AI engineer, a CTO. If any of them hits a paragraph they
would skip, it is still too long. This is the last slice, so this read is the
epic's final check.

## Notes

Child of [[TASK-305]], last in the order — the word budget and the anchor set are
only true once every section has been cut. Decision record:
`docs/records/TASK-305-cut-the-landing-page-down-to-an-intro.md`.
