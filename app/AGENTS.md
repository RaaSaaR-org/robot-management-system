# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RoboMindOS is a Tauri v2 desktop application for robot fleet management. It features a React + TypeScript frontend with Zustand state management and a Rust backend. The app enables users to manage, monitor, and control humanoid robots through natural language commands and an A2A orchestration chat interface.

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
| `/models`           | `ModelsPage`          | Model registry               |
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
│   ├── processes/       # Workflow/process management
│   ├── robots/          # Robot management, telemetry, 3D viewer
│   ├── safety/          # Safety monitoring
│   ├── settings/        # Theme & UI stores
│   └── training/        # VLA dataset & training management
├── shared/              # Cross-feature shared code
│   ├── components/ui/   # Reusable UI (Badge, Button, Card, Input, Modal, ProgressBar, Spinner, Tabs)
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

### Brand Colors (Tailwind)

```
Primary: #2A5FFF (Cobalt Blue) -> primary-500
Accent: #18E4C3 (Turquoise) -> accent-500
Status:
  - Online: #22c55e (green-500)
  - Offline: #9ca3af (gray-400)
  - Busy: #3b82f6 (blue-500)
  - Error: #ef4444 (red-500)
  - Charging: #eab308 (yellow-500)
```

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
