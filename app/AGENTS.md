# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NeoDEM is a Tauri v2 desktop application for robot fleet management. It features a React + TypeScript frontend with Zustand state management and a Rust backend. The app enables users to manage, monitor, and control humanoid robots through natural language commands and an A2A orchestration chat interface.

## Commands

### Development

```bash
npm run dev          # Start Vite dev server (frontend only, http://localhost:1420)
```

### Build

```bash
npm run build        # Build frontend (TypeScript check + Vite build)
```

### Type Checking

```bash
npx tsc              # Run TypeScript compiler (noEmit mode)
```

## Architecture

### Frontend (React/TypeScript)

- **Entry point**: `src/main.tsx` - React app bootstrap with providers
- **Root component**: `src/App.tsx` - Routes and layout
- **Build tool**: Vite with React plugin
- **Dev server**: Port 1420
- **State management**: Zustand with Immer middleware
- **Styling**: Tailwind CSS v4
- **Routing**: React Router DOM v7 (lazy-loaded pages)

### Backend (Rust/Tauri)

- **Entry point**: `src-tauri/src/main.rs` - Tauri application entry
- **Commands**: `src-tauri/src/lib.rs` - Tauri command handlers
- **Config**: `src-tauri/tauri.conf.json` - Tauri application configuration

### Provider Composition (outermost to innermost)

```
BrowserRouter > ThemeProvider > AuthProvider > App
```

- **ThemeProvider**: Applies `light`/`dark` class to `<html>` from `themeStore`
- **AuthProvider**: Auto-logs in with mock user in `DEV` mode. Exposes `can()`, `hasRole()` helpers

## Routes

### Public Routes

| Path              | Page                | Description              |
| ----------------- | ------------------- | ------------------------ |
| `/`               | `LandingPage`       | Marketing/landing page   |
| `/login`          | `LoginPage`         | Authentication           |
| `/register`       | `RegisterPage`      | User registration        |
| `/forgot-password`| `ForgotPasswordPage`| Password reset request   |
| `/reset-password` | `ResetPasswordPage` | Password reset with token|

### Protected Routes (require auth, wrapped in `AppLayout`)

| Path              | Page                  | Description                  |
| ----------------- | --------------------- | ---------------------------- |
| `/dashboard`      | `DashboardPage`       | Fleet overview with map      |
| `/orchestrator`   | `OrchestratorChatPage`| AI chat with auto-routing    |
| `/robots`         | `RobotsPage`          | Robot list with filtering    |
| `/robots/:id`     | `RobotDetailPage`     | Robot detail (tabs: Telemetry, Commands, Tasks, Info, 3D Model, Chat) |
| `/fleet`          | `FleetPage`           | Fleet map & zone management  |
| `/alerts`         | `AlertsPage`          | Alert management             |
| `/patrol`         | `PatrolPage`          | Patrol routes, runs, findings (TASK-212) |
| `/patrol/routes/new`, `/patrol/routes/:id` | `RouteEditorPage` | Patrol route editor |
| `/patrol/runs/:runId` | `RunDetailPage`   | Patrol run: legs, photo pairs, findings |
| `/tour`           | `TourPage`            | Host mode: tour routes and visits (TASK-213) |
| `/tour/routes/new`, `/tour/routes/:id` | `TourEditorPage` | Tour editor: greeting, offer, farewell, site card, stops |
| `/tour/runs/:runId` | `RunDetailPage` (tour) | One visit: stops, disclosure spoken, questions and where each answer came from |
| `/processes`      | `ProcessesPage`       | Workflow/process list        |
| `/processes/:id`  | `ProcessDetailPage`   | Process detail               |
| `/settings`       | `SettingsPage`        | Theme preferences            |
| `/account`        | `AccountPage`         | User account settings        |
| `/a2a`            | `ChatPage`            | A2A direct chat              |
| `/a2a/agents`     | `AgentListPage`       | Registered A2A agents        |
| `/a2a/agents/:name` | `AgentDetailPage`  | Agent detail                 |
| `/a2a/tasks`      | `TaskListPage`        | A2A task list                |
| `/a2a/events`     | `EventsPage`          | A2A event viewer             |

### Compliance & Governance Routes

| Path              | Page                  | Description                  |
| ----------------- | --------------------- | ---------------------------- |
| `/compliance`     | `CompliancePage`      | Audit logging viewer         |
| `/explainability` | `ExplainabilityPage`  | AI decision transparency     |
| `/gdpr`           | `GDPRPage`            | GDPR self-service portal     |
| `/incidents`      | `IncidentsPage`       | Incident management          |
| `/incidents/:id`  | `IncidentDetailPage`  | Incident detail              |
| `/oversight`      | `OversightPage`       | Human oversight dashboard    |
| `/approvals`      | `ApprovalsPage`       | Approval workflows           |

### AI & ML Routes

| Path                | Page                  | Description                  |
| ------------------- | --------------------- | ---------------------------- |
| `/datasets`         | `DatasetsPage`        | VLA dataset management       |
| `/training`         | `TrainingPage`        | Training job management      |
| `/deployments`      | `DeploymentsPage`     | Fleet deployment management  |
| `/deployments/:id`  | `DeploymentDetailPage`| Deployment detail            |
| `/skills`           | `SkillsPage`          | Skill library                |
| `/contributions`    | `ContributionsPage`   | Data contribution portal     |
| `/contributions/new`| `NewContributionPage` | Submit new contribution      |
| `/contributions/:id`| `ContributionDetailPage` | Contribution detail       |

**Redirects**: `/tasks` → `/processes`, `/tasks/:id` → `/processes`

## Project Structure (Feature-First)

```
src/
├── app/providers/       # Context providers (Auth, Theme)
├── features/            # 21 feature modules (domain-driven)
│   ├── a2a/             # A2A orchestration & chat
│   ├── alerts/          # Alert management
│   ├── approvals/       # Human approval workflows (EU AI Act Art. 14)
│   ├── auth/            # Authentication (login, register, password reset)
│   ├── command/         # NL command interface & safety preview
│   ├── compliance/      # Audit logging viewer (EU AI Act Art. 12)
│   ├── contributions/   # Data contribution portal
│   ├── dashboard/       # Fleet dashboard page
│   ├── datacollection/  # Robot data collection management
│   ├── deployment/      # VLA model deployment management
│   ├── explainability/  # AI decision transparency
│   ├── fleet/           # Fleet map & zone management
│   ├── fleetlearning/   # Federated learning management
│   ├── gdpr/            # GDPR self-service portal (Articles 15-22)
│   ├── incidents/       # Incident management & regulatory reporting
│   ├── oversight/       # Human oversight dashboard
│   ├── patrol/          # Patrol routes, scheduled runs, findings (TASK-212)
│   ├── tour/            # Host mode: tour routes, visits (TASK-213)
│   ├── processes/       # Workflow/process management
│   ├── robots/          # Robot management, telemetry, 3D viewer
│   ├── safety/          # Safety monitoring
│   ├── settings/        # Theme & UI stores
│   └── training/        # VLA dataset & training management
├── shared/              # Cross-feature shared code
│   ├── components/ui/   # The UI kit (Panel, PageHeader, DataTable, FormModal, toast, … — see "Design System" below)
│   ├── hooks/           # Shared hooks (useApi, useDebounce, useLocalStorage, useMediaQuery, useWebSocket)
│   ├── types/           # Shared types (ApiResponse, PaginatedResponse, WebSocketStatus)
│   └── utils/           # Utilities (cn, error, format, thresholds)
├── api/                 # Axios client with token refresh
├── store/               # Zustand store factory (createStore with immer + devtools + persist)
├── components/          # Layout components (AppLayout, Sidebar, TopBar) + landing sections
├── pages/               # Top-level pages (LandingPage, SettingsPage)
├── routes/              # Lazy page imports (lazyPages.ts)
└── mocks/               # Mock data for development
```

### Feature Module Structure

Each feature follows this structure:

```
features/{feature-name}/
├── types/           # TypeScript type definitions (create FIRST)
├── store/           # Zustand store slice
├── api/             # API module with endpoints
├── hooks/           # React hooks (useX)
├── components/      # Feature components
├── pages/           # Route pages
└── index.ts         # Public exports
```

## Development Guidelines

### Implementation Order

When building features, implement in this order:

1. **Types** - Define interfaces and type aliases first
2. **Store** - Create Zustand store with state and actions
3. **API** - Implement API module with typed endpoints
4. **Hooks** - Create hooks for data fetching/state access
5. **Components** - Build UI components using shared primitives
6. **Pages** - Assemble pages from components

### File Header Convention

Every file should start with:

```typescript
/**
 * @file FileName.tsx
 * @description One-line purpose description
 * @feature feature-name
 */
```

### Code Patterns

- Use named exports (no default exports)
- Wrap components in `memo()` for performance
- Use `cn()` utility from `@/shared/utils` for conditional classnames
- Store slices use the `createStore<T>()` factory from `src/store/createStore.ts` (includes immer + devtools + persist)
- All pages are lazy-loaded via `React.lazy()` in `routes/lazyPages.ts`
- Dev mode auto-login: `AuthProvider` injects `MOCK_USER` when `import.meta.env.DEV` is true

### Page Invariants

#### Agent Mode (`/agent`, `features/agentmode/`)

**Amber and red are reserved for conditions that are true right now.** Nothing on this
page may render an always-on warning, a permanent "Idle" pill or a status badge that is
present whether or not anything is wrong. When the robot is calm — answering, snapshot
fresh, nothing latched, damped, superseded or recovered — the page has no colour on it
and the condition stack (`EstopBanner`) renders nothing at all. That is what makes the
one amber thing on a bad day readable at a glance. A badge that always warns is a badge
people stop reading, and the argument for demoting the old always-on badges collapses
the moment a new feature adds its own permanent pill.

Concretely, when adding anything to this page:

- **New status must be conditional, or it goes behind the knowledge tabs / the robot
  details drawer.** It does not get a row of its own above the workspace. The page owns
  exactly two always-visible full-width bars: the `PageHeader` row and the sticky status
  rail (`BlockTimeline`).
- **Disclosure is a CSS clamp, never conditional rendering.** Collapsed detail text stays
  in the DOM under `line-clamp-1`; expanding removes the clamp. `EstopBanner.test.tsx`
  asserts the full prose via `toHaveTextContent` while collapsed, and the reason is not
  the test: an operator's screen reader and their browser's find-in-page must be able to
  reach the sentence explaining why a robot will not move.
- **Alarm states render fully expanded with no collapse control** (E-Stop `failed` /
  `unconfirmed`). "It may still be moving — use the hardware E-Stop" is an instruction,
  not an explanation.
- **Safety controls are never behind a disclosure, a tab, a hover or a drawer**, and keep
  their ≥44px coarse-pointer targets: STOPP, Reset E-Stop, and the recovered-acknowledge
  button.
- **Never render "unknown" as a confident value.** An unknown place is `Place unknown` in
  a dashed chip, so it *looks* different rather than merely saying something different;
  an undated snapshot says `cached · age unknown` exactly as loudly as an old one.
- **One renderer per belief.** `PlaceChip` owns `agent-scene-place`; `agent-self-freshness`
  owns the snapshot age. A second copy is a second chance for them to disagree about what
  the robot knows.

## Design System

The whole app speaks the landing page's language. **`docs/brand.md` is the
binding contract** — tokens, type, page anatomy, the CRUD pattern, the kit,
the shell and how to test a page. Read it before touching UI. The short form:

### Rules

- **Tokens, not colors.** Surfaces `bg-canvas` · `bg-panel` · `bg-inset` ·
  `bg-raised` · `bg-field`; text `text-ink-primary` · `-secondary` ·
  `-tertiary` · `-muted`; lines `border-line-subtle` · `border-line` ·
  `border-line-strong`; brand `bg-primary` / `text-primary` / `bg-accent`;
  status `text-signal-measured` · `-estimated` · `-unknown` · `-stopped`
  (tints via `/10`, `/30`); the STOP fill `bg-stop text-on-stop`.
- **Never** raw hues (`green-500`, `red-400`, `blue-*`, `gray-*`, `slate-*` …),
  hex literals, `cobalt-*` / `turquoise-*`, or `dark:` variants — light is the
  same tokens with other values. Dark is the default theme. The drift ratchet
  fails on every one of these (see "Design-system guards" below).
- **Text on a primary/accent fill is `text-on-primary` / `text-on-accent`,
  never `text-white`** (white on mint is 1.2:1). A fill that carries text is
  `bg-primary`, not a ramp shade — the ramps (`primary-50…900`) are for tints.
- **Matte, not glass.** No `backdrop-filter` / `backdrop-blur-*`, no `.glass*`
  classes, no gradient-clipped text, no glow shadows, no hover lift
  (`translate`/`scale`/shadow on hover). Borders and ground changes separate.
- **Type.** Archivo (`font-display`) for page titles, panel titles and stat
  values only; Inter (`font-sans`, the default) for all normal text; mono
  (`font-mono`) only for code, logs, IDs, hashes and commands — never labels,
  values, buttons or nav. Nothing below 10px (`text-[10px]` only for tags and
  chart ticks). Sentence case.
- **Radius** `rounded-panel` (14px) · `rounded-control` (10px) · `rounded-tag`
  (6px). Motion 150ms `ease-instrument`.
- **Signals are honest.** Sim is violet (`estimated`), unknown is amber, a
  fault is red, and a STOP is the only saturated red on screen. Signal colors
  are never brand-controlled.

### How to build a page

Every page, same order (see `docs/brand.md` §3):

```
PageHeader   eyebrow (nav group) · h1 · description · meta (StatusTag) · actions (right)
Tabs         optional, state in ?tab=
StatRow      optional, 2–6 StatTiles
Toolbar      optional, SearchInput · filters · view toggle
Content      Panel(s) · DataTable · card grid of Panel interactive
```

- One `h1` per page (from `PageHeader`), one primary button per view
  (right-most). Detail pages use `PageHeader back={{ to, label }}`.
- **CRUD is identical everywhere** (§4): list in `DataTable` or a card grid →
  header **"New ‹thing›"** opens a `FormModal` (Cancel + Create ‹thing›) →
  edit reuses it ("Edit ‹thing›", Save changes) → row actions in `RowActions`
  with Delete last → delete always goes through `ConfirmDialog` tone `danger`
  (never `window.confirm`) → `toast.success` / `toast.error` for feedback →
  `EmptyState`, `Skeleton` and `ErrorState` (with Retry) for the other states →
  status via `StatusTag` + `statusTone()`.
- **The kit** (`@/shared/components/ui`; every prop is listed in
  `docs/brand.md` §5 "Kit API reference"):
  - Layout: `PageHeader`, `Panel` (+ `Panel.Header` / `.Body` / `.Footer`,
    `panelClasses`), `StatTile`, `StatRow`, `Toolbar`, `KeyValueList`, `Tabs`,
    `Eyebrow`, `Divider`; legacy `Card`.
  - Actions: `Button` (+ `buttonClasses`), `LinkButton`, `DropdownMenu`,
    `RowActions`, `SegmentedControl`, `ToggleChip`; legacy `MenuButton`.
  - Forms: `FormField`, `Input`, `SearchInput`, `Textarea`, `Select`,
    `Checkbox`, `Switch`, `FormModal`.
  - Feedback: `Modal`, `ConfirmDialog`, `confirm()`, `toast` / `useToast`
    (+ `dismissToast`, `getToasts`), `EmptyState`, `ErrorState`, `Skeleton`,
    `SkeletonText`, `SkeletonRows`, `Spinner`, `PageLoader`, `ProgressBar`,
    `Tooltip`, `InfoIcon`, `NextStepBanner`, `PipelineBreadcrumb`. The hosts
    (`FeedbackProvider` = `ToastProvider`, `Toaster`, `ConfirmHost`) are
    mounted once in `App.tsx`; pages never mount them.
  - Status: `StatusTag`, `statusTone`, `humanizeStatus`, `normalizeStatus`,
    `Badge`, `chartColors`, `chartTheme`, `chartSeriesColor`.
  - Data: `DataTable` (inside `<Panel padding="none">`).

  Generic UI comes from the kit; feature code keeps only domain widgets (maps,
  3D, charts, timelines), styled with tokens inside kit panels. Every
  primitive renders on the dev-only `/design-system` route.
- **Kit gotchas.** `Button` defaults to `type="button"` (pass `type="submit"`
  to submit). `SearchInput`'s `onChange` gets the string, not an event.
  `Select` takes its width on `className` (the wrapper) and needs
  `fullWidth={false}` in toolbars. There is no `bg-inset/50`: `bg-inset` is a
  plain utility with no opacity modifier. A delete is
  `if (await confirm({ title: 'Delete X?', tone: 'danger' }))`, never
  `window.confirm`.
- **Check it in a browser** (§8): the route at 1440 and 390, dark and light,
  live and demo mode — and read the screenshots.

### Theme and brand plumbing

- Tokens live in `src/index.css` (`@theme` + `:root` / `:root.light`); the
  landing page is scoped under `.landing-page` (`components/landing/landing-theme.css`)
  and must look identical after any global CSS change.
- `ThemeProvider` puts `dark`/`light` on `<html>` from `themeStore` (default
  `dark`). `BrandProvider` writes a white-label brand's primary/accent slots and
  on-colors (`src/brand/brandVars.ts`); see `brand/_template/README.md`.
- The legacy layer is gone (TASK-269): `cobalt-*` / `turquoise-*`, `.glass*`,
  `.card*`, `.btn-*`, `.section-*`, `--glass-*` and the `*-theme-*` utilities
  are no longer defined, so a class using one renders nothing.

### Design-system guards

Two tests keep the old visual language out; both are part of the gate
(`docs/brand.md` §9).

- **Drift ratchet** — `src/__tests__/design-drift.test.ts`, runs in
  `npx vitest run`. Scans `src/` (except `components/landing`, `brand/`,
  `mocks/` and tests) and fails on `cobalt`/`turquoise`, glass classes or
  variables, `dark:`, raw Tailwind hues and greys, hex colours in TS/TSX,
  `theme-*` utilities, `.btn-*`/`.section-*`/`.card-*`, backdrop blur,
  `text-[8px]`/`text-[9px]` and `window.confirm`, naming file and line. Every
  count is zero. Its `ALLOWED` map is the whole list of exceptions, each with a
  reason; do not grow it to get a page through — use a token.
- **Route smoke** — `e2e/app-routes.spec.ts`, runs in `npx playwright test`
  against the demo build. Opens every in-shell route at 1440 and 390 and fails
  on a page error, anything but one visible `h1`, horizontal overflow, visible
  text under 10px, any `backdrop-filter`, or a dark ground that is not
  `rgb(8, 15, 24)`. **A new route goes into its `ROUTES` list** (with a demo id
  from `src/mocks` if it takes a parameter).

## Key Dependencies

| Package                | Purpose                     |
| ---------------------- | --------------------------- |
| `react` / `react-dom`  | UI framework (v19)         |
| `react-router-dom`     | Client-side routing (v7)   |
| `zustand`              | State management           |
| `immer`                | Immutable state updates    |
| `axios`                | HTTP client                |
| `three`                | 3D rendering               |
| `@react-three/fiber`   | React bindings for Three.js|
| `@react-three/drei`    | Three.js helpers           |
| `urdf-loader`          | URDF robot model loader    |
| `react-markdown`       | Markdown rendering (chat)  |
| `@google/generative-ai`| Gemini API client          |
| `clsx` + `tailwind-merge` | CSS class utilities     |
| `@tauri-apps/api`      | Tauri desktop APIs         |

## Environment Variables

| Variable              | Default                           | Description               |
| --------------------- | --------------------------------- | ------------------------- |
| `VITE_API_BASE_URL`   | `http://localhost:3001/api`       | Server API base URL       |
| `VITE_A2A_SERVER_URL` | `http://localhost:3001`           | A2A server URL            |
| `VITE_A2A_WS_URL`     | `ws://localhost:3001/api/a2a/ws`  | A2A WebSocket URL         |
| `VITE_A2A_USE_MOCK`   | `false`                           | Use mock A2A data         |
| `GOOGLE_API_KEY`       | —                                | Gemini API key            |

## Documentation

More detailed documentation:

- `docs/architecture.md` - Full frontend architecture patterns
- `docs/brand.md` - Brand guide and visual design system
- `docs/prd.md` - Product requirements document
- `../server/AGENTS.md` - Server documentation
- `../robot-agent/AGENTS.md` - Robot agent documentation
