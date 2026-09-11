# NeoDEM — Brand and Design Contract

The single source of truth for how NeoDEM looks, reads and behaves — the
landing page and every page of the app. Part I is the brand (name, logo,
voice). Part II is the design contract every page in `app/src` follows; the
tokens live in `app/src/index.css`, the components in
`app/src/shared/components/ui/` (`@/shared/components/ui`).

---

# Part I — Brand

## Name

**NeoDEM** (Neo-Deus Ex Machina) — "the One" and "the god from the machine":
the architectural bridge between raw hardware and autonomy. In the product the
expansion is **Neo Data & Execution Management**.

| Symbol  | Origin                    | Meaning                                   |
| ------- | ------------------------- | ----------------------------------------- |
| **Neo** | Greek *neos* + The Matrix | The unified intelligence across a fleet   |
| **DEM** | Deus Ex Machina           | The model that makes the machine capable  |

Write it **NeoDEM** — one word, capital N, D, E, M. Never "Neodem", "NEODEM"
or "Neo DEM".

NeoDEM is the open Physical AI platform covering the whole lifecycle —
Collect → Train → Deploy → Evaluate → Operate → Comply. Personality:
intelligent, trustworthy, calm, professional, minimal. Grounded, not sci-fi.

## Logo

- Variants: primary (icon + wordmark "NeoDEM"), icon only, monochrome
  (light-on-dark / dark-on-light), app icon (square, simplified symbol).
- Minimum clear space: the height of the letter "N".
- Never distort, rotate, recolor outside the brand palette, or apply filters,
  glows or shadows.
- Place it on the canvas or a panel — never on a busy image.
- White-label deployments replace it through `brand/logo.svg` (see
  [White-label](#white-label)).

## Voice

Confident but never arrogant, clear, calm, safety-first. Technical but human.

| Context | Good | Not good |
| ------- | ---- | -------- |
| Status  | "Your robot is ready. Battery at 92%." | "Robot initialized. Execute task protocol." |
| Alert   | "SimBot-01 detected an obstacle. Pausing for safety." | "CRITICAL: Obstacle detected! Immediate intervention required!" |
| Skill   | "Skill 'Pick and Place' deployed to 12 robots." | "VLA model propagated across fleet nodes." |
| Unknown | "Place unknown" | a confident guess |

- **Sentence case everywhere** — "New route", "Save changes". Uppercase only
  through the eyebrow and tag styles.
- **Honest labels.** Simulated data says Sim; gated features say Gated;
  unknown values say unknown. The page never claims more than the system knows.
- Buttons are verbs: "Create route", "Delete", "Retry" — not "OK", "Submit".

## Taglines

| Tagline | Context |
| ------- | ------- |
| **"Intelligence. Made physical."** | Landing hero, primary |
| *"One intelligence. Many forms."* | Embodiment-agnostic story |
| *"From demonstration to deployment."* | Training workflow |
| *"Transparent AI. Aligned autonomy."* | Compliance |
| *"I know Kung Fu."* | Skill transfer (sparingly) |

Matrix references ("skill upload", "the Oracle" for the inference server,
"awakening" for a robot coming online with new skills) are seasoning, never
the dish — keep them tasteful and out of safety surfaces.

---

# Part II — Design contract

## 0. Principles

1. **One language with the landing page.** Dark matte ground, mint primary,
   honest signal colors, Archivo for headlines, Inter for every normal text,
   mono only for code and machine output.
2. **State first, then action.** Above the fold, every page answers "what state
   is it in?" and "what can I do here?".
3. **One way to do each thing.** Every list, form, destructive action, status,
   empty/loading/error state looks and behaves the same on every page.
4. **Matte, not glass.** No `backdrop-filter`, no gradient-clipped text, no glow
   shadows, no hover lift. Borders and ground changes do the separating.
5. **Honest.** Simulated data is tagged Sim; unknown (amber) never looks like a
   fault (red); a STOP is the only saturated red on screen.
6. **Simple.** Fewer boxes, fewer colors, fewer buttons. Remove before adding.

## 1. Tokens

Dark is the default theme. Light is the same token set with other values;
code never uses `dark:` variants.

| Role | CSS var | Utility | Dark | Light |
|---|---|---|---|---|
| Page ground | `--bg-primary` | `bg-canvas` | `#080f18` | `#f5f7fa` |
| Panel | `--bg-secondary` | `bg-panel` | `#101d2c` | `#ffffff` |
| Inset / sidebar / table head | `--bg-tertiary` | `bg-inset` | `#0b1522` | `#eef2f6` |
| Raised (hover, menus, popovers, modals) | `--bg-elevated` | `bg-raised` | `#192a3c` | `#ffffff` |
| Field (inputs) | `--bg-card` | `bg-field` | `#0d1826` | `#ffffff` |
| Text primary | `--text-primary` | `text-ink-primary` | `#f1f5fc` | `#0f1b2a` |
| Text secondary | `--text-secondary` | `text-ink-secondary` | `#b2c3d5` | `#3a4b5e` |
| Text tertiary | `--text-tertiary` | `text-ink-tertiary` | `#9aafc5` | `#566a80` |
| Text muted | `--text-muted` | `text-ink-muted` | `#8499b0` | `#6b7f94` |
| Hairline | `--border-subtle` | `border-line-subtle` | `#1a2a3c` | `#e3e8ee` |
| Border | `--border-color` | `border-line` | `#243649` | `#d5dde6` |
| Border strong | `--border-color-strong` | `border-line-strong` | `#3b546c` | `#b4c1ce` |
| Primary (fills, links, focus) | `--color-primary` | `bg-primary` / `text-primary` | `#b2f8df` | `#0f7a60` |
| Primary hover | `--color-primary-hover` | `bg-primary-hover` | `#d9fff1` | `#0b6650` |
| Text on primary | `--color-on-primary` | `text-on-primary` | `#0a2225` | `#ffffff` |
| Accent | `--color-accent` | `text-accent` | `#a9e6d8` | `#0e7c6b` |
| Text on accent | `--color-on-accent` | `text-on-accent` | `#0a2225` | `#ffffff` |
| Signal measured / live / success | `--signal-measured` | `text-signal-measured` | `#a7e8d3` | `#0a6e5c` |
| Signal estimated / sim / info | `--signal-estimated` | `text-signal-estimated` | `#c5b9ef` | `#5b4bb0` |
| Signal unknown / gated / warning | `--signal-unknown` | `text-signal-unknown` | `#e9c39c` | `#7a5510` |
| Signal stopped / fault / danger | `--signal-stopped` | `text-signal-stopped` | `#ff9b9b` | `#b02020` |
| STOP fill (E-stop buttons, alarm banners) | `--signal-stopped-fill` | `bg-stop` + `text-on-stop` | `#e5484d` / `#ffffff` | `#c9302c` / `#ffffff` |

Also: `--panel-highlight-from` (`#162638` / `#eef7f3`) starts the highlight
panel's `linear-gradient(135deg, var(--panel-highlight-from), var(--bg-secondary))`,
and `--shadow-raised` is the one shadow in the system (menus, popovers and
modals lifting off the page — a drop shadow, never a glow).

- **Text on a primary or accent fill is `text-on-primary` / `text-on-accent`,
  never `text-white`** — white on the mint is 1.2:1. Fills that carry text use
  the theme-aware `bg-primary` / `bg-accent`, not a fixed ramp shade.
- The `primary-50…900` and `accent-50…900` ramps are for tints
  (`bg-primary/10`, `border-primary/30`). The old `cobalt-*` / `turquoise-*`
  names no longer exist.
- Opacity modifiers work on every token (`bg-signal-measured/10`,
  `border-signal-stopped/30`) — Tailwind resolves them with `color-mix`.
- Raw Tailwind hues (`green-500`, `red-400`, `blue-*`, `gray-*`, `slate-*`,
  `zinc-*` …) and hex literals are not used (see §9). Status uses the
  signal tokens; neutrals use the ink/line/surface tokens. Charts take their
  series colors from the kit's `chartColors` (tokens), not literals.
- New color tokens stay out of the `theme-` namespace, and a token name must
  not collide with a static utility: `--color-inset` would turn `ring-inset`
  into a ring-color setter, which is why `bg-inset` is a plain `@utility`.

Radius: `rounded-panel` 14px (panels, modals), `rounded-control` 10px (buttons,
inputs, insets, menus), `rounded-tag` 6px (tags, badges). `rounded-brand`
(10px) is the landing page's button radius only. Motion: 150ms
`--ease-instrument`; nothing bounces; reduced motion respected.

### White-label

A brand (`brand/brand.config.ts`, gitignored; template in `brand/_template/`)
controls exactly two slots:

- `primaryColors` / `accentColors` — a partial 50–900 scale plus `DEFAULT`.
  `BrandProvider` writes them over `--color-primary*` / `--color-accent*` on
  `<html>`, and every `primary-*` / `accent-*` utility follows. A brand `DEFAULT`
  applies in both themes.
- `onPrimary` / `onAccent` — optional. When omitted, white or `#0a2225` is
  chosen by WCAG contrast against the brand `DEFAULT` (an orange primary gets
  dark text), and the primary hover is derived from `DEFAULT`.
- `darkOverrides` / `lightOverrides` — surface, text and border values.

**Signal colors are never brand-controlled.** "Stopped" and "unknown" must mean
the same thing on every deployment.

## 2. Type

| Role | Face | Size / weight | Where |
|---|---|---|---|
| Page title (h1) | Archivo | 28px desktop, 24px < 640px, 600, tracking −0.03em | `PageHeader` only, exactly one per page |
| Section / panel title (h2) | Archivo | 16px, 600, tracking −0.01em | `Panel.Header`, modal titles |
| Stat value | Archivo | 24–28px, 600, tabular-nums | `StatTile` |
| Sub-heading (h3) | Inter | 14px, 600 | inside panels |
| Body | Inter | 14px / 1.55 | default |
| Small / caption | Inter | 13px / 12px | meta, table cells, hints |
| Eyebrow / label | Inter | 11px, 500–600, uppercase, tracking 0.12em | `Eyebrow`, table heads, stat labels |
| Code / machine output | JetBrains Mono | 12–13px | `<code>`, `<pre>`, logs, IDs, hashes, commands |

- Faces: `font-display` (Archivo, self-hosted with the width axis), `font-sans`
  (Inter, the default), `font-mono` (JetBrains Mono). Inside the app shell and
  in dialogs, bare `h1`/`h2` already take Archivo.
- **Nothing renders below 10px.** `text-[8px]`/`text-[9px]` are banned;
  `text-[10px]` only for tags and chart ticks.
- Mono is never used for labels, values, headings, buttons or nav.
- Sentence case everywhere ("New route", "Save changes"); uppercase only via
  the eyebrow/tag styles.

## 3. Page anatomy — every page, same order

```
PageHeader   eyebrow (nav group) · h1 title · description · meta (StatusTag) · actions (right)
Tabs         optional, underline style, state in ?tab=
StatRow      optional, 2–6 StatTiles summarising state
Toolbar      optional, SearchInput · filters (Select / SegmentedControl) · right: view toggle
Content      Panel(s) · DataTable · card grid
```

- The eyebrow is the sidebar group the page lives in: **Operate**, **Build**,
  **Comply**, **System**, **Admin** (the dashboard uses **Overview**).
- **One primary button per view** — the page's main act (create, start,
  record). Everything else is `secondary` or `ghost`. Primary sits right-most.
- Detail pages: `PageHeader` with `back={{ to, label }}` (renders "← Fleet"
  above the title), title = the entity's name, `meta` = its `StatusTag`,
  actions = `Edit` (secondary) and a `RowActions`-style "more" menu holding
  destructive actions.
- Content goes in `Panel`s on the canvas. A panel inside a panel is an
  `inset` panel, never another bordered card with its own shadow.
- Pages use the full width of the content area (the shell pads it); long
  reading text is capped at ~70ch.

## 4. CRUD — identical on every page

| Step | Pattern |
|---|---|
| List | `DataTable` for records with ≥3 attributes; a card grid of `Panel interactive` for visual entities (robots, sites, marketplace items). Both sit under a `Toolbar` with `SearchInput` (client-side filter at minimum) and filters. |
| Paging | A server-paged list passes `pagination={{ page, totalPages, total, noun, onPageChange }}` to `DataTable`, which renders the kit `Pager` in its footer ("Page 2 of 7 · 1,234 entries", Previous / Next; disabled while loading; hidden for one page). `Pager` alone only under a list that is not a table. Never a hand-built pager. |
| Open | Row / card click → the detail page if one exists, else opens Edit. |
| Row actions | `RowActions` (kebab menu): Edit, then other verbs, then a separator and **Delete** (danger) last. |
| Create | Header primary button **"New ‹thing›"** (use "Add", "Invite", "Register", "Import", "Upload" only when that is literally the act) → `FormModal` titled "New ‹thing›", footer **Cancel** (ghost) + **Create ‹thing›** (primary). Large editors (route editors, training setup) are pages with the same header and a sticky footer bar: Cancel + Save. |
| Edit | Same `FormModal`, prefilled, title "Edit ‹thing›", primary **Save changes**. |
| Delete | Always `ConfirmDialog` tone `danger`: title "Delete ‹name›?", body states the consequence, confirm **Delete**. Never `window.confirm`, never a one-click delete. |
| Feedback | `toast.success("Route created")`, `toast.error("Couldn't delete route", { description: errorMessage(err) })`. Field errors inline under the field via `FormField error`; a failed request is the form-level `FormModal error={errorMessage(err)}`. Submit button shows its loading state; the form is disabled while submitting. Toasts sit bottom-right from 640px and at the top below it, so a bottom sheet's footer and a sticky dock stay reachable. |
| Error text | Always `errorMessage(err, fallback?)`. The API client rejects with plain `{ code, message, statusCode }` objects, not `Error`s, so `err instanceof Error ? err.message : String(err)` prints "[object Object]". `errorMessage` reads a server body (`response.data.message` / `.error`), `Error.message`, `{ message }`, `{ error }` or a string, else the fallback ("Something went wrong. Try again."). |
| Empty | `EmptyState`: icon, "No ‹things› yet", one line on what they are, and the same primary action as the header. Filtered-to-nothing shows "No ‹things› match" + Clear filters. |
| Loading | `Skeleton` shaped like the content (rows, tiles). Never a blank area; `Spinner` only for small inline waits. |
| Error | `ErrorState` in place of the content: "Couldn't load ‹things›", the message, **Retry**. |
| Status | `StatusTag` with the kit's `statusTone()` map — never an ad-hoc colored span. |

The E-stop is the one exception to "confirm before acting": it fires on one
press, always visible, never behind a disclosure, a tab, a hover or a drawer.

## 5. The kit — `@/shared/components/ui`

Pages are built from these and nothing else for the generic parts. A feature
may keep domain widgets (maps, 3D viewers, charts, timelines), but they are
styled with the tokens and sit inside kit panels.

- **Layout:** `PageHeader`, `Panel` (+ `Panel.Header`, `Panel.Body`,
  `Panel.Footer`), `StatTile`, `StatRow`, `Toolbar`, `KeyValueList`, `Tabs`,
  `Eyebrow`, `Divider`.
- **Actions:** `Button`, `LinkButton`, `RowActions` / `DropdownMenu`,
  `SegmentedControl` (+ `ToggleChip`).
- **Forms:** `FormField`, `Input`, `SearchInput`, `Textarea`, `Select`,
  `Checkbox`, `Switch`, `ChoiceCard` / `ChoiceCardGroup`, `FormModal`.
- **Feedback:** `Modal`, `ConfirmDialog` / `confirm()`, `toast` / `useToast`,
  `errorMessage()`, `EmptyState`, `ErrorState`, `Skeleton` (+ `SkeletonText`,
  `SkeletonRows`), `Spinner`, `PageLoader`, `ProgressBar` (+ `indeterminate`),
  `Tooltip` (+ `InfoIcon`).
- **Status:** `StatusTag`, `statusTone()`, `humanizeStatus()`, `Badge`,
  `chartColors` / `chartTheme` / `chartSeriesColor()`, `cssColor()` /
  `useCssColor()` (a token's value for three.js, canvas and SVG attributes).
- **Data:** `DataTable` (+ `pagination`), `Pager`.
- **Class strings:** `focusRing`, `focusRingInset`, `buttonClasses()`,
  `panelClasses()`, `choiceSurface()` — for the rare element that cannot be a
  kit component.

Every test hook is optional and additive: `FormModal submitTestId` /
`cancelTestId`, `testId` on a `DropdownMenuItem` / `RowActionItem`, on
`confirm()` options and on `Modal` / `ConfirmDialog` (the buttons get
`‹testId›-confirm` / `-cancel`), `data-testid` on `StatTile` and `ChoiceCard`,
and `rowProps(row)` on `DataTable`.

`FeedbackProvider` (alias `ToastProvider`: the `Toaster` plus the
`ConfirmHost`) is mounted once in `App.tsx`, around every route. Pages never
mount it. Without a host (unit tests), `toast()` queues quietly and
`confirm()` falls back to `window.confirm`.

### Kit API reference

The props that matter; every component also takes `className`. Types come from
the same barrel (`ButtonProps`, `DataTableColumn<T>`, …).

**Layout**

| Export | Props |
|---|---|
| `PageHeader` | `title` (the page's one h1) · `description` (alias `subtitle`) · `eyebrow` (nav group) · `back={{ to, label }}` · `meta` (a `StatusTag`) · `actions` (primary last) · `children` (under the header row) |
| `Panel` | `variant` `default` · `inset` · `highlight` · `interactive` (hover border; focusable and Enter/Space-activatable with `onClick`) · `padding` `none` · `sm` · `md` (default `md`, or `none` when built from the sub-parts; explicit `none` clips a flush `DataTable`) · `as` `div` · `section` · `article` · `aside` · all div attributes |
| `Panel.Header` | `title` (Archivo 16px) · `description` · `eyebrow` · `actions` · `titleAs` `h2` · `h3` · `borderless` |
| `Panel.Body`, `Panel.Footer` | div attributes; they pad themselves (the footer right-aligns its buttons) |
| `panelClasses({ variant?, interactive?, padding? })` | the panel's class string, for elements that cannot be a `Panel` |
| `StatTile` | `label` · `value` · `unit` · `hint` · `tone` (any `Tone`) · `icon` · `trend={{ value, direction: 'up'\|'down'\|'flat', sentiment?: 'positive'\|'negative'\|'neutral' }}` · `progress` (0–100) · `isLoading` · `data-testid` |
| `StatRow` | `columns` 2–6 (default: the number of tiles; 2-up on phones) |
| `Toolbar` | `search` (grows) · `filters` · `actions` (pushed right) · or free `children` |
| `KeyValueList` | `items: { label, value, mono?, key? }[]` (an empty value renders "—") · `columns` 1–3 (default 2) |
| `Tabs` | `tabs: { id, label, icon?, content?, disabled?, count? }[]` · `activeTab` + `onTabChange` (controlled) or `defaultTab` · `variant` `default` · `pills` · `label` · `panelClassName`. Omit `content` to render the bar only (for `?tab=` pages) |
| `Eyebrow` | `dash` (the landing's 22×2px lead-in) |
| `Divider` | `orientation` `horizontal` · `vertical` · `label` · `strong` |
| `Card` | legacy, kept so old pages compile: `variant` `default` · `elevated` · `subtle` · `outlined` · `noPadding` · `interactive` · `Card.Header/Body/Footer`. New code uses `Panel` |

**Actions**

| Export | Props |
|---|---|
| `Button` | `variant` `primary` (default) · `secondary` · `ghost` · `danger` (legacy `outline` → secondary, `destructive` → danger) · `size` `sm` 32px · `md` 38px (default) · `lg` 44px · `iconOnly` (needs `aria-label`) · `isLoading` + `loadingText` · `leftIcon` · `rightIcon` · `fullWidth` · all button attributes. Defaults to `type="button"`; pass `type="submit"` to submit |
| `buttonClasses(options)` | the button's class string (`variant`, `size`, `iconOnly`, `fullWidth`, `disabled`, `className`) |
| `LinkButton` | a router `Link` styled as a `Button`: `to` + `variant` · `size` · `iconOnly` · `leftIcon` · `rightIcon` · `fullWidth` |
| `DropdownMenu` | `trigger` (an element, usually a `Button`) · `items` · `align` `start` · `end` (default `end`) · `label`. Portalled; arrow keys, Home/End, Esc with focus return |
| `RowActions` | a kebab `Button` plus a `DropdownMenu`: `items` · `label` (default "More actions") · `align` · `size` |
| item shape (`DropdownMenuItem` = `RowActionItem`) | `{ label, onSelect, icon?, tone?: 'danger'\|'default', disabled?, separatorBefore?, key?, testId? }`. Delete goes last, `tone: 'danger'`, `separatorBefore: true` |
| `SegmentedControl<T>` | `options: { value, label, title?, disabled? }[]` · `value` · `onChange` · `label` · `size` `sm` · `md` |
| `ToggleChip` | `active` · `onClick` · `title` · `disabled` · `size` `sm` · `md` |
| `MenuButton` | legacy hamburger: `isOpen` · `onClick` · `label` |

**Forms**

| Export | Props |
|---|---|
| `FormField` | `label` · `hint` · `error` (replaces the hint and turns the control red) · `required` · `aside` (right of the label) · `htmlFor`. With a single child it injects `id`, `aria-describedby` and `aria-invalid` |
| `Input` | all input attributes · `size` `sm` · `md` · `lg` · `leftIcon` · `rightIcon` · `invalid` · `fullWidth`. Legacy `label` / `helperText` / `error` still render; new code wraps it in `FormField` |
| `SearchInput` | `value` · `onChange(value: string)` (a string, not an event) · `placeholder` (default "Search") · `size`. Has a clear button |
| `Textarea` | all textarea attributes · `invalid` |
| `Select` | `options: { value, label, disabled? }[]` (or `<option>` children) · `placeholder` (an empty first option) · `size` · `invalid` · `fullWidth` (default true; `false` in toolbars) · `className` on the wrapper (width lives there) · `selectClassName` on the `<select>` |
| `Checkbox` | all input attributes · `label` · `description` · `invalid` |
| `Switch` | `checked` · `onCheckedChange(checked)` · `label` · `description` · `size` `sm` · `md` · `labelPosition` `left` · `right` |
| `FormModal` | `isOpen` · `onClose` · `title` · `description` · `onSubmit(event)` (default already prevented; may return a promise) · `submitLabel` · `submittingLabel` · `cancelLabel` · `isSubmitting` (disables every field, blocks Esc) · `submitDisabled` · `submitVariant` `primary` · `danger` · `error` (form-level; `errorMessage(err)`) · `size` · `closeOnBackdrop` (default false) · `noValidate` · `submitTestId` · `cancelTestId` |
| `ChoiceCard` | one selectable card (an `aria-pressed` button): `selected` · `onSelect` · `title` · `description` · `aside` (a `StatusTag`: Beta, Ready) · `disabled` · `data-testid`. For one of a few options that each need a line of explanation; short options use `SegmentedControl` |
| `ChoiceCardGroup` | the labelled grid around them: `label` (required, the group's name) · `columns` 1–4 from 640px (default 2; one column on phones) |
| `choiceSurface(selected)` | the card's border and tint, for a custom selectable row (a multi-select list) |

**Feedback**

| Export | Props |
|---|---|
| `Modal` | `isOpen` · `onClose` · `title` · `description` · `footer` (right-aligned buttons) · `size` `sm` · `md` · `lg` · `xl` · `full` · `closeOnBackdrop` · `closeOnEscape` · `showCloseButton` · `bodyClassName` · `initialFocusRef` · `role` `dialog` · `alertdialog` · `onSubmit` (the panel becomes a `<form>`; the page reload is prevented before it runs) · `noValidate` · `testId`. Focus trap, Esc, focus return, scroll lock, nested stacking; a bottom sheet below 640px |
| `ConfirmDialog` | `isOpen` · `onClose` · `onConfirm` (a returned promise shows loading) · `title` · `description` · `children` · `confirmLabel` (default "Delete" for danger, else "Confirm") · `cancelLabel` · `tone` `danger` · `default` · `isLoading` · `testId`. One `alertdialog` element, no `dialog` around it |
| `confirm(options)` | imperative: `await confirm({ title, description?, confirmLabel?, cancelLabel?, tone?, testId? })` resolves `true`/`false`. The usual way to confirm a delete |
| `toast` / `useToast()` | `toast(title, options?)`, `toast.success` · `.error` · `.warning` · `.info`, `toast.dismiss(id?)`. Options: `description` · `tone` · `duration` (ms, `null` = sticky; default 5000, errors 8000) · `id` (reusing one replaces that toast) · `action: { label, onClick }`. Each call returns the toast id. Errors are `role="alert"`, every other tone `role="status"`. Bottom-right from 640px, top of the screen below it |
| `errorMessage(err, fallback?)` | the readable text of any rejection, for toast descriptions and form errors (see §4 "Error text"). `ERROR_MESSAGE_FALLBACK` is the default fallback |
| `dismissToast(id?)`, `getToasts()`, `TOAST_DURATION`, `TOAST_ERROR_DURATION` | helpers for tests and edge cases |
| `FeedbackProvider` / `ToastProvider`, `Toaster`, `ConfirmHost` | the hosts; already mounted once in `App.tsx` |
| `EmptyState` | `icon` · `title` · `description` · `action` · `secondaryAction` · `size` `sm` · `md` · `lg` |
| `ErrorState` | `title` (default "Couldn't load this") · `message` · `onRetry` · `retryLabel` · `size` |
| `Skeleton` | `className` sets size and shape ("h-4 w-32") |
| `SkeletonText` | `lines` (default 3) |
| `SkeletonRows` | `rows` (default 5) · `columns` (default 4) · `dense` |
| `Spinner` | `size` `xs` … `xl` · `color` `current` (default) · `primary` · `accent` (legacy `cobalt` / `turquoise` / `white` still map while auth, a2a and processes pass them; deprecated) · `label` |
| `PageLoader` | `message` |
| `ProgressBar` | `value` · `max` · `variant` `default` · `success` · `info` · `warning` · `error` · `label` · `showValue` · `size` `sm` · `md` · `indeterminate` (a sliding segment, no value or percentage, for work with no known end) |
| `Tooltip` | `content` · `children` (the trigger) · `side` `top` · `bottom` · `left` · `right` (flips) · `maxWidth` (default 260). Portalled, so panels and tables cannot clip it |
| `InfoIcon` | a lucide `Info` icon with a `Tooltip`: `content` · `side` · `size` · `label` · `maxWidth` |
| `NextStepBanner` | `title` · `description` · `ctaLabel` · `ctaHref` · `icon` · `variant` `default` · `subtle` |
| `PipelineBreadcrumb` | `stage` `collect` · `dataset` · `train` · `evaluate` · `deploy` · `hideOnMobile` |

**Status**

| Export | Props |
|---|---|
| `StatusTag` | `status` (a domain string; sets tone and label) or `tone` + `children` · `dot` · `pulse` · `size` `sm` · `md`. Tones (`Tone`): `success` · `info` · `warning` · `danger` · `neutral` · `accent`, plus the signal aliases `live` · `sim` · `gated` · `stopped` |
| `statusTone(status)` | the map below; unknown strings fall back to `neutral` |
| `humanizeStatus(status)`, `normalizeStatus(status)` | `'in_progress'` → "In progress", `'estop'` → "E-stop"; normalise to the lower-case underscore key |
| `Badge` | kept for counts and labels: `variant` `default` · `neutral` · `success` · `warning` · `error` · `danger` · `info` · `accent` (older `purple` → info) · `size` `sm` · `md` · `lg` · `pill` · `dot` · `dotPulse` |
| `chartColors` | CSS var strings: `primary` · `accent` · `measured` · `estimated` · `unknown` · `stopped` · `series[6]` · `grid` · `axis` · `tick` · `label` · `muted` · `surface` · `tooltipBg` · `tooltipBorder` · `tooltipText` |
| `chartTheme` | recharts props to spread: `grid` · `xAxis` · `yAxis` · `tooltip` · `legend` |
| `chartSeriesColor(i)` | the i-th categorical colour (wraps; red last) |
| `cssColor(name, fallback?)`, `useCssColor(name, fallback?)` | a token's resolved value (`cssColor('--color-primary')`) for renderers that cannot read `var(…)`: three.js materials, canvas, SVG attributes set from code. The hook re-reads when the theme changes |

**Data**

| Export | Props |
|---|---|
| `DataTable<T>` | `columns` · `rows` · `getRowId` · `onRowClick` (rows become focusable, Enter opens) · `rowActions(row)` (a trailing `RowActions` kebab) · `rowActionsLabel(row)` · `isLoading` (skeleton rows until the first rows arrive) · `skeletonRows` · `error` + `errorTitle` + `onRetry` (an `ErrorState`) · `empty` (usually an `EmptyState`) · `dense` · `caption` · `defaultSort` or `sort` + `onSortChange` · `rowClassName(row)` · `rowProps(row)` (extra `<tr>` attributes: `data-testid`, `data-*`, `title`) · `pagination` (the `Pager` props; renders it in the footer, outside the scroll area, and keeps it under an empty page; `disabled` defaults to `isLoading`). Scrolls horizontally inside its container |
| column (`DataTableColumn<T>`) | `{ key, header, cell?(row, i), align?: 'left'\|'right'\|'center', width?, sortable?, sortValue?(row), hideBelow?: 'sm'\|'md'\|'lg', className? }`; without `cell` it renders `row[key]` |
| `Pager` | `page` (1-based) · `totalPages` · `total` · `noun` + `nounPlural` ("entry" / "entries"; without a noun the total reads "57 total") · `onPageChange(page)` · `disabled` · `showSinglePage` (keep it, and the total, on one page) · `label` (landmark name, default "Pagination"). A `nav` with "Page x of y · total" and Previous / Next; renders nothing for one page |

**Class strings**

| Export | Use |
|---|---|
| `focusRing`, `focusRingInset` | the kit's focus-visible outline (inset for rows and flush list items), for an element that is not a kit component |

Put a `DataTable` in `<Panel padding="none">` so it runs flush to the panel's
edges.

`statusTone` map (amber means unknown or needs attention, red means stopped or
a fault):

- success — online, active, running, completed, succeeded, healthy, deployed,
  approved, connected, ready, published; done (runs), production
  (deployments), resolved, closed (incidents), sent, acknowledged
  (notifications).
- info — busy, queued, in_progress, training, recording, syncing, rolling_out;
  working, submitted (A2A tasks), canary (deployments), investigating,
  contained (incidents being worked on).
- warning — charging, degraded, paused, pending, pending_review, warning,
  stale, draft_review; aborted, abandoned (runs), input_required (A2A),
  rolling_back, rolled_back (deployments), detected (a new incident), medium
  (severity).
- danger — error, failed, stopped, estop, e-stop, critical, rejected, blocked,
  fault; high (severity), overdue (a notification past its legal deadline).
- neutral — offline, idle, draft, archived, cancelled, canceled, unknown
  (fallback); low, info (severities), deprecated (deployments).

A feature keeps its own map only where its word means something else (a
compliance legal hold that is `active` needs attention; a patrol leg that is
`pending` is calm), and says so next to the map.

A dev-only `/design-system` route renders every primitive in every state.

## 6. Shell

- Matte top bar on `bg-canvas` with a hairline bottom border; matte sidebar on
  `bg-inset` with a hairline right border. No glass. The shell root carries
  `data-app-shell`; inside it (and in anything portalled to `<body>`)
  `backdrop-filter` is switched off globally.
- Sidebar groups (static eyebrow labels, no accordions): **Overview**
  (Dashboard) · **Operate** (Fleet, Control Center, Agent Mode, Patrol, Guide,
  Automations, Alerts, Digital Twin) · **Build** (Skill Training, Data
  Collection, Datasets, Training, Models, Deployments, Fleet Learning,
  Marketplace) · **Comply** (Compliance) · **System** (Updates, Docs,
  Settings) · **Admin** (Organizations, Team — existing role/feature gates).
- Active item: `bg-primary/10 text-primary` with a 2px primary bar on the
  left; never a solid primary block. Collapsed sidebar = icon rail with
  tooltips. Mobile (<768px) = drawer with the same groups.
- The global E-stop / alarm banner uses `bg-stop text-on-stop`, matte.

## 7. Icons, responsiveness, accessibility

- Icons: `lucide-react` only, `w-4 h-4` in buttons, rows and tags, `w-5 h-5`
  in nav, stroke width 1.75. Line-based, no glow on active states.
- Every page works at **390px** wide with no horizontal page scroll (tables
  scroll inside their panel, header actions wrap under the title, stat tiles
  go 2-up) and at the Tauri default **800×600**.
- Focus-visible ring: 2px `--color-primary`, offset on the canvas. Icon-only
  buttons carry `aria-label`. Dialogs trap focus, close on Esc, return focus.
  Text contrast meets WCAG AA in both themes.
- Safety controls (STOPP, Reset E-Stop, recovered-acknowledge) keep ≥44px
  coarse-pointer targets.

## 8. Testing a page in the browser

A page counts as done when it has been opened in a real browser and looked at.
Type checks and unit tests prove the code compiles; they do not prove the page
reads.

- **Both data sources.** Live mode — `cd app && npm run dev` against a local
  server (`cd server && npm run dev`, auth disabled, ideally on a copy of the
  dev database so create/delete flows are safe). Demo mode — the MSW build that
  GitHub Pages ships, served with `VITE_DEMO_MODE=true` under
  `/robot-management-system/#/<route>`. About a dozen pages render
  `DemoFeaturePlaceholder` in demo mode by design; test those live.
- **Two widths, two themes.** Every changed route at **1440** and **390** wide,
  in **dark** and **light** (plus 800×600 for shell changes).
- **What to check on every screenshot:** the canvas is `#080f18` in dark;
  nothing is frosted (no element outside the landing page has a
  `backdrop-filter`); no horizontal page overflow; no text under 10px; mono
  only on code, IDs and machine output; exactly one `h1`; text on primary
  fills is dark in dark mode and readable in light; no page errors or failed
  requests in the console.
- **Automate the measuring, not the judging.** A small Playwright script can
  report overflow, tiny text, mono misuse, `backdrop-filter`, h1 count and
  errors per route and write screenshots — then a person (or a reviewing
  agent) **reads the screenshots**. A passing report is not a reviewed page.
- **CRUD flows are clicked through for real** — create → edit → delete —
  against the live server, including the empty, error and loading states.
- **The landing page must not move.** Anything that touches global CSS is
  checked against a before-screenshot of `/`; the landing is scoped under
  `.landing-page` and keeps its own tokens.

## 9. Guards — the legacy layer is retired

The compatibility layer that kept unmigrated pages rendering is gone
(TASK-269). `app/src/index.css` no longer defines the `cobalt-*` /
`turquoise-*` aliases, the `--glass-*` variables, the `.glass*`, `.card*`,
`.btn-*` and `.section-*` classes, or the `.text-theme-*` / `.bg-theme-*`
utilities; a class that uses one of those names now renders nothing. The one
safety net that stays is the `[data-app-shell]` rule that switches
`backdrop-filter` off inside the shell and in body portals.

Two guards in the gate keep the old language from coming back:

| Guard | Runs in | Fails when |
|---|---|---|
| **Drift ratchet** — `app/src/__tests__/design-drift.test.ts` | `npx vitest run` | a line in `app/src` (except the landing page, brand configs, mocks and tests) uses a `cobalt`/`turquoise` name, a glass class or variable, a `dark:` variant, a raw Tailwind hue or grey, a hex colour in TS/TSX, a `theme-*` utility, a `.btn-*`/`.section-*`/`.card-*` class, backdrop blur, `text-[8px]`/`text-[9px]` or `window.confirm`. It names the file and line. |
| **Route smoke** — `app/e2e/app-routes.spec.ts` | `npx playwright test` (demo build) | any app route, at 1440 and 390, throws a page error, has other than one visible `h1`, overflows horizontally, shows text under 10px, has an element with `backdrop-filter`, or the dark body ground is not `rgb(8, 15, 24)`. |

- Every ratchet count is zero. The allowlist in the test is the whole list of
  exceptions and each entry carries its reason; adding one needs a reason a
  token cannot serve (a three.js material, server-stored zone data).
- A new in-shell route goes into the smoke's `ROUTES` list, with a demo id
  from `app/src/mocks` when the route takes a parameter.
- Break a rule on purpose (`bg-cobalt-500` on a page) and the ratchet fails;
  its self-check feeds such lines through the same matchers, so it cannot
  silently match nothing.
