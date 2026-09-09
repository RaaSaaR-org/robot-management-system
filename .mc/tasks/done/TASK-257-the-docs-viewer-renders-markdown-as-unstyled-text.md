---
id: "TASK-257"
aliases: []
title: "The docs viewer renders markdown as unstyled text"
slug: "the-docs-viewer-renders-markdown-as-unstyled-text"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "high"
due_date: ""
created: "2026-09-09"
updated: "2026-09-09"
---

# The docs viewer renders markdown as unstyled text

## Description

`/docs/*` renders every document as one undifferentiated block: headings at
body size and weight, lists without bullets, no spacing between anything. The
cause is that the app moved to Tailwind v4, which does not read
`tailwind.config.js` unless a stylesheet pulls it in with `@config` — so the
`@tailwindcss/typography` plugin registered there registered nothing and every
`prose` class in the app has emitted zero CSS since. Three further defects sit
on top of it.

## Details

### Current state

- `app/tailwind.config.js` registers `plugins: [typography]`. `app/src/index.css`
  does `@import "tailwindcss"` with no `@config` and no `@plugin`, so the file is
  dead weight. `.prose` has no rules; computed styles on `/docs/README` gave
  every `h1`, `h2` and `p` 16px/400 with zero margins.
- `app/src/pages/DocsPage.tsx` carries ~20 `prose-*` modifier classes on the
  article, all of them inert for the same reason.
- **Fenced blocks without a language** — 23 of them across `docs/` — render as
  *inline code pills*. react-markdown v10 no longer passes `inline` to the `code`
  component, so the "has a language class" test the file uses is the only thing
  separating a block from an inline span.
- **Every cross-reference is dead.** `urlTransform` prefixes `BASE_URL` to any
  relative URL, which turns `architecture.md` into `/architecture.md` (404) and
  `#troubleshooting` into a link to the app root. Both forms are used throughout
  `docs/`.
- Only `MessageBubble.tsx` (A2A chat) also uses `prose`; it renders onto a
  cobalt bubble, so switching the plugin on must not let the plugin's own greys
  paint over `text-white`.

### Frontend

- `app/src/index.css` — register the plugin with `@plugin
  "@tailwindcss/typography"`; add a `.prose-inherit` utility that maps the
  `--tw-prose-*` slots to `inherit`/`currentColor` for markdown on a coloured
  surface.
- `app/src/components/docs/docs-prose.css` (new) — the reading surface: bind the
  `--tw-prose-*` slots to the app's theme variables so light/dark follow
  ThemeProvider with no `prose-invert`; Archivo display headings matching the
  landing page; table, inline-code, blockquote and image treatments.
- `app/src/components/docs/docsMarkdown.ts` (new) — GitHub-compatible heading
  slugs, `extractHeadings` (skipping fenced code, de-duplicating repeats),
  `resolveDocLink`, and the fence-tag → Prism-grammar map.
- `app/src/components/docs/DocsCodeBlock.tsx` (new) — language plate, copy
  button, theme-aware highlighter, wrapped in `not-prose`.
- `app/src/components/docs/DocsToc.tsx` (new) — "On this page" rail with a
  scroll spy rooted on the reading column.
- `app/src/components/docs/docsRegistry.ts` (new) — the document set: the
  `docs/**/*.md` glob, slugs, titles, categories and ordering.
- `app/src/components/docs/DocsArticle.tsx` (new) — the markdown renderer: take
  fenced blocks over at the `pre` level, anchor headings by source line, resolve
  links to in-app routes, drop empty `thead`s.
- `app/src/components/docs/DocsSidebar.tsx` — moved from `components/`.
- `app/src/pages/DocsPage.tsx` — layout, navigation and scroll behaviour only:
  provenance rail, contents rail, prev/next pager, deep links and the scroll
  reset on document change.
- `app/src/shared/hooks/useIsDarkTheme.ts` (new) — resolved theme for the
  highlighter palette.
- `app/src/features/a2a/components/MessageBubble.tsx` — `prose-inherit` in place
  of `dark:prose-invert`.

## Test Strategy

- `app/src/components/docs/__tests__/docsMarkdown.test.ts` covers the slug rules
  against anchors the docs already link to (`#tls--https`,
  `#7-current-limitations`), heading extraction inside and outside fences,
  duplicate-heading de-duplication, and every branch of link resolution.
- `app/src/components/docs/__tests__/docsRegistry.test.ts` covers slugs, titles,
  categories and the loaded set — including that no document is stranded in
  `Other`, which is how a newly added doc announces itself.
- Manually: `/docs/README` and `/docs/architecture` in both themes, at 1440px
  and 430px.

## Acceptance Criteria

- [x] `.prose` emits real rules; headings, lists and spacing render
- [x] Language-less fenced blocks render as code blocks, not inline pills
- [x] `architecture.md#agent-mode` navigates in-app; `#anchor` scrolls in-page
- [x] Deep links (`/docs/deployment#tls--https`) land on the heading
- [x] Switching documents returns to the top of the page
- [x] Light and dark both follow the app theme
- [x] The A2A chat bubble keeps its own text colour

## Notes

Doc-to-doc navigation looked broken during testing but is not: with the API
server down, `/api/config/features` and `/api/alerts/active` are re-requested
every few milliseconds and the resulting re-render storm starves the page.
Unrelated to this task, worth its own.
