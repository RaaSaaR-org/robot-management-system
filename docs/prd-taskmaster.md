# RoboMindOS PRD - TaskMaster RPG Format

> This PRD follows the Repository Planning Graph (RPG) methodology for Task Master parsing.

---

<rpg-method>
# Repository Planning Graph (RPG) Method

**Dual-Semantics**: Functional (capabilities) AND Structural (code organization)
**Explicit Dependencies**: Every module states what it depends on
**Topological Order**: Foundation first, then layers on top
</rpg-method>

---

<overview>

## Problem Statement

Germany faces a critical labor shortage with 86% of companies reporting hiring difficulties. Humanoid robots are approaching economic viability (2026-2027), but businesses lack accessible tools to manage them effectively. Existing solutions are either too technical (industrial SCADA), too limited (manufacturer apps), or non-existent.

## Target Users

| Persona | Description | Key Need |
|---------|-------------|----------|
| **Home User (Maria)** | 1-3 robots, moderate tech savvy | Simple control, safety assurance |
| **Operations Manager (Thomas)** | 10-100 robots, warehouse ops | Fleet visibility, task coordination |
| **Robot Operator (Lisa)** | Floor worker, low tech savvy | Mobile-first, easy commands |
| **IT Admin (Stefan)** | Security & integration focus | RBAC, audit logs, SSO |

## Success Metrics

- 80% task completion rate via natural language commands
- < 5% E-stop usage rate (indicating user trust)
- < 2s real-time update latency
- 99.9% API availability

</overview>

---

<functional-decomposition>

## Capability Tree

### Capability: Authentication & Authorization
Secure user access and permission management across the platform.

#### Feature: User Authentication
- **Description**: Email/password login with JWT tokens
- **Inputs**: Email, password credentials
- **Outputs**: Access token, refresh token, user profile
- **Behavior**: Validate credentials, issue tokens, manage sessions

#### Feature: Token Management
- **Description**: Handle token refresh and expiration
- **Inputs**: Refresh token
- **Outputs**: New access token
- **Behavior**: Validate refresh token, issue new access, handle expiry

#### Feature: Role-Based Access Control
- **Description**: Permission checks based on user roles (Admin, Operator, Viewer)
- **Inputs**: User role, requested action
- **Outputs**: Allow/deny decision
- **Behavior**: Check role permissions, enforce tenant isolation

---

### Capability: Robot Management
Core CRUD operations and status tracking for robots.

#### Feature: Robot List Display
- **Description**: Grid/list view of all robots with status indicators
- **Inputs**: Tenant ID, filter/sort options
- **Outputs**: Paginated robot list with status, battery, location
- **Behavior**: Fetch robots, apply filters, real-time status updates

#### Feature: Robot Detail View
- **Description**: Comprehensive single robot view with controls
- **Inputs**: Robot ID
- **Outputs**: Full robot data, current task, recent activity
- **Behavior**: Load robot details, subscribe to telemetry updates

#### Feature: Robot Status System
- **Description**: Visual status indicators (online/offline/busy/error/charging)
- **Inputs**: Robot status enum
- **Outputs**: Color-coded badge with icon
- **Behavior**: Map status to visual representation, animate active states

---

### Capability: Fleet Overview
High-level fleet monitoring and spatial awareness.

#### Feature: Fleet Dashboard
- **Description**: Summary metrics and quick actions for entire fleet
- **Inputs**: Tenant ID
- **Outputs**: Robot counts by status, alert count, utilization metrics
- **Behavior**: Aggregate robot data, calculate KPIs, auto-refresh

#### Feature: Fleet Map
- **Description**: Interactive 2D map showing robot positions
- **Inputs**: Floor plan image, robot locations
- **Outputs**: Interactive map with robot markers
- **Behavior**: Render floor plan, plot robots, handle zoom/pan, cluster markers

---

### Capability: Command Interface
Natural language command processing and execution.

#### Feature: Natural Language Input
- **Description**: Text input for plain language robot commands
- **Inputs**: Command text, target robot(s)
- **Outputs**: Interpreted action, confidence score
- **Behavior**: Send to VLA model, display interpretation

#### Feature: Command Interpretation Display
- **Description**: Show what VLA model understood before execution
- **Inputs**: VLA interpretation response
- **Outputs**: Action type, objects, confidence, safety classification
- **Behavior**: Parse response, render interpretation UI

#### Feature: Safety Simulation Preview
- **Description**: 3D/2D preview of planned robot action
- **Inputs**: Planned action, robot position, environment
- **Outputs**: Animated preview of path and actions
- **Behavior**: Generate simulation, highlight hazards, show grip points

#### Feature: Command History
- **Description**: Searchable log of all commands sent
- **Inputs**: User ID, filter options
- **Outputs**: Paginated command history with status
- **Behavior**: Store commands, enable search/filter, allow re-send

---

### Capability: Task Management
Task lifecycle management from creation to completion.

#### Feature: Task List
- **Description**: View all tasks with status and filtering
- **Inputs**: Filter/sort options
- **Outputs**: Task list with progress indicators
- **Behavior**: Fetch tasks, display status, enable bulk actions

#### Feature: Task Detail View
- **Description**: Detailed progress view with step-by-step tracking
- **Inputs**: Task ID
- **Outputs**: Task steps, progress percentage, timing info
- **Behavior**: Load task details, show step status, provide controls

#### Feature: Task Queue
- **Description**: Pending tasks per robot with ordering
- **Inputs**: Robot ID
- **Outputs**: Ordered queue with estimated start times
- **Behavior**: Display queue, enable reordering (admin), quick cancel

---

### Capability: Telemetry & Monitoring
Real-time sensor data and health monitoring.

#### Feature: Battery Monitoring
- **Description**: Battery level display with warnings
- **Inputs**: Battery telemetry data
- **Outputs**: Visual gauge, estimated runtime, alerts
- **Behavior**: Update in real-time, trigger alerts at thresholds

#### Feature: Sensor Data Display
- **Description**: Key sensor readings in readable format
- **Inputs**: Sensor telemetry array
- **Outputs**: Formatted sensor values with units
- **Behavior**: Update at 5-10s interval, show health status

---

### Capability: Alerts & Safety
Critical notification and emergency systems.

#### Feature: Emergency Stop Button
- **Description**: Always-visible E-stop that immediately halts robots
- **Inputs**: User tap/click
- **Outputs**: Stop command to robot(s)
- **Behavior**: Send immediate stop, pause tasks, require resume confirmation

#### Feature: Alert System
- **Description**: Notification system for critical/warning/info events
- **Inputs**: Alert data from backend
- **Outputs**: Banners, push notifications, alert list
- **Behavior**: Display by severity, require acknowledgment for critical

---

### Capability: Cross-Platform UI
Responsive design and platform-specific adaptations.

#### Feature: Responsive Layout
- **Description**: Adaptive layouts for mobile, tablet, desktop
- **Inputs**: Viewport size
- **Outputs**: Appropriate layout (1/2/3 column)
- **Behavior**: Apply breakpoints, adjust navigation position

#### Feature: Dark Mode
- **Description**: System-preference-aware theme switching
- **Inputs**: System preference, user override
- **Outputs**: Dark/light theme applied
- **Behavior**: Detect preference, persist choice, smooth transition

#### Feature: Offline Support
- **Description**: Cache data and queue commands when offline
- **Inputs**: Network status
- **Outputs**: Offline indicator, cached data display
- **Behavior**: Cache robot states, queue commands, sync on reconnect

</functional-decomposition>

---

<structural-decomposition>

## Repository Structure

```
src/
├── features/                # Domain-driven feature modules
│   ├── auth/               # Maps to: Authentication & Authorization
│   ├── robots/             # Maps to: Robot Management
│   ├── fleet/              # Maps to: Fleet Overview
│   ├── command/            # Maps to: Command Interface
│   ├── tasks/              # Maps to: Task Management
│   ├── telemetry/          # Maps to: Telemetry & Monitoring
│   └── alerts/             # Maps to: Alerts & Safety
├── shared/                 # Cross-feature components
│   ├── components/ui/      # Primitive UI elements
│   ├── components/feedback/# User feedback components
│   ├── hooks/              # Shared hooks
│   └── utils/              # Utility functions
├── api/                    # REST client layer
├── store/                  # Global state (Zustand)
├── app/                    # App shell & routing
└── styles/                 # Global styles & themes
```

## Module Definitions

### Module: auth
- **Maps to capability**: Authentication & Authorization
- **Responsibility**: User login, token management, permission checks
- **Exports**:
  - `useAuth()` - Authentication hook
  - `AuthProvider` - Context provider
  - `ProtectedRoute` - Route guard component
  - `LoginForm`, `LogoutButton` - UI components

### Module: robots
- **Maps to capability**: Robot Management
- **Responsibility**: Robot CRUD, status display, detail views
- **Exports**:
  - `useRobotList()`, `useRobot()` - Data hooks
  - `RobotCard`, `RobotList`, `RobotDetailPanel` - UI components
  - `RobotStatusBadge` - Status indicator

### Module: fleet
- **Maps to capability**: Fleet Overview
- **Responsibility**: Fleet-wide metrics and map visualization
- **Exports**:
  - `useFleetStatus()` - Fleet data hook
  - `FleetMap`, `FleetStats`, `FleetTable` - UI components

### Module: command
- **Maps to capability**: Command Interface
- **Responsibility**: NL input, interpretation, preview, history
- **Exports**:
  - `useCommand()` - Command execution hook
  - `CommandBar`, `CommandPreview`, `CommandHistory` - UI components

### Module: tasks
- **Maps to capability**: Task Management
- **Responsibility**: Task listing, detail view, queue management
- **Exports**:
  - `useTask()`, `useTaskQueue()` - Data hooks
  - `TaskList`, `TaskCard`, `TaskTimeline` - UI components

### Module: telemetry
- **Maps to capability**: Telemetry & Monitoring
- **Responsibility**: Real-time sensor data and battery display
- **Exports**:
  - `useTelemetryStream()` - WebSocket hook
  - `BatteryGauge`, `SensorGrid`, `TelemetryChart` - UI components

### Module: alerts
- **Maps to capability**: Alerts & Safety
- **Responsibility**: Alert display, E-stop, notifications
- **Exports**:
  - `useAlerts()` - Alert management hook
  - `AlertBanner`, `AlertList`, `EmergencyStopButton` - UI components

### Module: shared/components/ui
- **Maps to capability**: Cross-Platform UI
- **Responsibility**: Reusable primitive components
- **Exports**:
  - `Button`, `Card`, `Input`, `Modal`, `Badge`, `Dropdown`, `Tabs`

</structural-decomposition>

---

<dependency-graph>

## Dependency Chain

### Foundation Layer (Phase 0)
No dependencies - built first.

- **shared/components/ui**: Primitive UI elements (Button, Card, Input, etc.)
- **shared/hooks**: Base hooks (useApi, useDebounce, useWebSocket)
- **shared/utils**: Formatters, validators, constants
- **api/client**: Axios instance, interceptors
- **store/createStore**: Zustand factory with middleware

### Data Layer (Phase 1)
- **auth/store**: Depends on [store/createStore]
- **auth/api**: Depends on [api/client]
- **auth/hooks**: Depends on [auth/store, auth/api, shared/hooks]

### Entity Layer (Phase 2)
- **robots/types**: Depends on [none] (pure type definitions)
- **robots/store**: Depends on [store/createStore, robots/types]
- **robots/api**: Depends on [api/client, robots/types]
- **robots/hooks**: Depends on [robots/store, robots/api, shared/hooks]

- **tasks/types**: Depends on [robots/types]
- **tasks/store**: Depends on [store/createStore, tasks/types]
- **tasks/api**: Depends on [api/client, tasks/types]
- **tasks/hooks**: Depends on [tasks/store, tasks/api]

- **alerts/types**: Depends on [robots/types]
- **alerts/store**: Depends on [store/createStore, alerts/types]
- **alerts/hooks**: Depends on [alerts/store, shared/hooks]

### Feature Layer (Phase 3)
- **telemetry/hooks**: Depends on [shared/hooks/useWebSocket, robots/types]
- **telemetry/components**: Depends on [shared/components/ui, telemetry/hooks]

- **command/api**: Depends on [api/client, robots/types]
- **command/hooks**: Depends on [command/api, robots/hooks]
- **command/components**: Depends on [shared/components/ui, command/hooks]

- **fleet/hooks**: Depends on [robots/hooks, alerts/hooks]
- **fleet/components**: Depends on [shared/components/ui, robots/components, fleet/hooks]

### UI Layer (Phase 4)
- **robots/components**: Depends on [shared/components/ui, robots/hooks, telemetry/components]
- **tasks/components**: Depends on [shared/components/ui, tasks/hooks, robots/components]
- **alerts/components**: Depends on [shared/components/ui, alerts/hooks]
- **auth/components**: Depends on [shared/components/ui, auth/hooks]

### Application Layer (Phase 5)
- **app/providers**: Depends on [auth/AuthProvider, ThemeProvider, ToastProvider]
- **app/layouts**: Depends on [shared/components/navigation, alerts/EmergencyStopButton]
- **app/Router**: Depends on [all feature pages, app/layouts]

- **features/*/pages**: Depends on [feature/components, feature/hooks, app/layouts]

</dependency-graph>

---

<implementation-roadmap>

## Development Phases

### Phase 0: Foundation
**Goal**: Establish shared infrastructure that all features depend on.

**Entry Criteria**: Clean repository with Tauri + React + TypeScript configured

**Tasks**:
- [ ] Implement shared/components/ui (Button, Card, Input, Modal, Badge) (depends on: none)
  - Acceptance: All primitives render correctly with Tailwind styling
  - Tests: Component unit tests with Vitest

- [ ] Create shared/hooks (useApi, useDebounce, useWebSocket, useLocalStorage) (depends on: none)
  - Acceptance: Hooks work in isolation
  - Tests: Hook unit tests

- [ ] Setup api/client with Axios and interceptors (depends on: none)
  - Acceptance: API client handles auth tokens, errors, retries
  - Tests: Mock API tests

- [ ] Create store/createStore with Zustand + devtools + persist (depends on: none)
  - Acceptance: Store factory produces typed stores
  - Tests: Store unit tests

**Exit Criteria**: Foundation modules can be imported without errors

**Delivers**: Reusable infrastructure for all features

---

### Phase 1: Authentication
**Goal**: User can login, logout, and access is protected.

**Entry Criteria**: Phase 0 complete

**Tasks**:
- [ ] Implement auth/store (authStore with token state) (depends on: [store/createStore])
- [ ] Implement auth/api (login, logout, refresh endpoints) (depends on: [api/client])
- [ ] Implement auth/hooks (useAuth) (depends on: [auth/store, auth/api])
- [ ] Create LoginForm, LogoutButton, ProtectedRoute (depends on: [shared/ui, auth/hooks])
- [ ] Create AuthProvider context (depends on: [auth/store])
- [ ] Create LoginPage (depends on: [LoginForm, auth/hooks])

**Exit Criteria**: User can login, protected routes redirect unauthorized users

**Delivers**: Secure authentication flow

---

### Phase 2: Robot Core
**Goal**: Display and manage robot entities.

**Entry Criteria**: Phase 1 complete

**Tasks**:
- [ ] Define robots/types (Robot, RobotStatus, RobotTelemetry) (depends on: none)
- [ ] Implement robots/store (robotsStore with CRUD, filters) (depends on: [store/createStore, robots/types])
- [ ] Implement robots/api (list, get, sendCommand) (depends on: [api/client, robots/types])
- [ ] Implement robots/hooks (useRobotList, useRobot) (depends on: [robots/store, robots/api])
- [ ] Create RobotStatusBadge component (depends on: [shared/ui, robots/types])
- [ ] Create RobotCard component (depends on: [shared/ui, RobotStatusBadge])
- [ ] Create RobotList component (depends on: [RobotCard, robots/hooks])
- [ ] Create RobotDetailPanel component (depends on: [shared/ui, robots/hooks])
- [ ] Create RobotsPage, RobotDetailPage (depends on: [RobotList, RobotDetailPanel])

**Exit Criteria**: User can view robot list and details with real-time status

**Delivers**: Core robot management UI

---

### Phase 3: Task Management
**Goal**: View and manage robot tasks.

**Entry Criteria**: Phase 2 complete

**Tasks**:
- [ ] Define tasks/types (Task, TaskStatus, TaskStep) (depends on: [robots/types])
- [ ] Implement tasks/store (tasksStore) (depends on: [store/createStore, tasks/types])
- [ ] Implement tasks/api (list, get, cancel, pause) (depends on: [api/client, tasks/types])
- [ ] Implement tasks/hooks (useTask, useTaskQueue) (depends on: [tasks/store, tasks/api])
- [ ] Create TaskCard, TaskList, TaskTimeline components (depends on: [shared/ui, tasks/hooks])
- [ ] Create TasksPage (depends on: [TaskList, TaskCard])

**Exit Criteria**: User can view tasks, see progress, cancel/pause tasks

**Delivers**: Task lifecycle visibility

---

### Phase 4: Telemetry & Alerts
**Goal**: Real-time monitoring and safety systems.

**Entry Criteria**: Phase 2 complete

**Tasks**:
- [ ] Implement telemetry/hooks (useTelemetryStream) with WebSocket (depends on: [shared/hooks/useWebSocket, robots/types])
- [ ] Create BatteryGauge component (depends on: [shared/ui])
- [ ] Create SensorGrid component (depends on: [shared/ui, telemetry/hooks])
- [ ] Define alerts/types (Alert, AlertSeverity) (depends on: [robots/types])
- [ ] Implement alerts/store, alerts/hooks (depends on: [store/createStore, alerts/types])
- [ ] Create AlertBanner, AlertList components (depends on: [shared/ui, alerts/hooks])
- [ ] Create EmergencyStopButton (depends on: [shared/ui, robots/api])

**Exit Criteria**: Real-time telemetry updates, E-stop functional, alerts displayed

**Delivers**: Safety-critical monitoring

---

### Phase 5: Command Interface
**Goal**: Natural language command execution with preview.

**Entry Criteria**: Phases 2-4 complete

**Tasks**:
- [ ] Implement command/api (sendCommand with VLA interpretation) (depends on: [api/client, robots/types])
- [ ] Implement command/hooks (useCommand) (depends on: [command/api, robots/hooks])
- [ ] Create CommandBar (NL input) (depends on: [shared/ui])
- [ ] Create CommandPreview (interpretation display) (depends on: [shared/ui, command/hooks])
- [ ] Create CommandConfirmation modal (depends on: [shared/ui/Modal, command/hooks])
- [ ] Create CommandHistory component (depends on: [shared/ui, command/hooks])
- [ ] Implement Safety Simulation Preview (depends on: [command/hooks, telemetry/components])

**Exit Criteria**: User can send NL commands, see interpretation, preview action

**Delivers**: Core differentiating feature (Safety Preview)

---

### Phase 6: Fleet Overview
**Goal**: Fleet-wide dashboard and map.

**Entry Criteria**: Phases 2-4 complete

**Tasks**:
- [ ] Implement fleet/hooks (useFleetStatus) (depends on: [robots/hooks, alerts/hooks])
- [ ] Create FleetStats component (KPI cards) (depends on: [shared/ui, fleet/hooks])
- [ ] Create FleetMap with Leaflet.js (depends on: [fleet/hooks, robots/components])
- [ ] Create ZoneOverlay component (depends on: [FleetMap])
- [ ] Create FleetDashboard page (depends on: [FleetStats, FleetMap, CommandBar, AlertBanner])

**Exit Criteria**: Dashboard shows fleet status, map shows robot positions

**Delivers**: Fleet-wide situational awareness

---

### Phase 7: Cross-Platform & Polish
**Goal**: Responsive design, dark mode, offline support.

**Entry Criteria**: Phases 1-6 complete

**Tasks**:
- [ ] Implement responsive layouts (mobile/tablet/desktop) (depends on: [all pages])
- [ ] Create MobileNav, Sidebar components (depends on: [shared/ui])
- [ ] Implement ThemeProvider with dark mode (depends on: [shared/utils])
- [ ] Implement offline indicator and caching (depends on: [shared/hooks/useOffline, store])
- [ ] Create DashboardLayout, AuthLayout, MobileLayout (depends on: [navigation components])
- [ ] Finalize app/Router with lazy loading (depends on: [all pages, layouts])

**Exit Criteria**: App works on all platforms, dark mode toggles, offline indicator shows

**Delivers**: Production-ready cross-platform app

</implementation-roadmap>

---

<test-strategy>

## Test Pyramid

```
        /\
       /E2E\       ← 10% (Critical user flows)
      /------\
     /Integration\ ← 20% (Feature modules)
    /------------\
   /  Unit Tests  \ ← 70% (Components, hooks, utils)
  /----------------\
```

## Coverage Requirements
- Line coverage: 80% minimum
- Branch coverage: 70% minimum
- Function coverage: 85% minimum

## Critical Test Scenarios

### Authentication
- **Happy path**: Valid credentials → successful login → token stored
- **Edge cases**: Empty fields, malformed email
- **Error cases**: Invalid credentials → error message, network failure → offline handling

### Robot List
- **Happy path**: Fetch robots → display in grid → status updates in real-time
- **Edge cases**: Empty list, 500+ robots (pagination), long robot names
- **Error cases**: API failure → error state, stale data → refresh indicator

### Emergency Stop
- **Happy path**: Tap E-stop → immediate stop command → confirmation required to resume
- **Edge cases**: Multiple rapid taps, offline state
- **Error cases**: Network failure → queue command → send on reconnect

### Command Interface
- **Happy path**: Enter command → see interpretation → preview → execute
- **Edge cases**: Low confidence interpretation, ambiguous commands
- **Error cases**: VLA timeout, prohibited action → blocked with explanation

## Test Generation Guidelines
- Use Vitest for unit tests
- Use React Testing Library for component tests
- Mock API calls with MSW
- Test accessibility with axe-core
- E2E with Playwright for critical flows

</test-strategy>

---

<architecture>

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND (Tauri + React)                │
├─────────────────────────────────────────────────────────────┤
│  App Shell → Router → Layouts → Pages → Components          │
│                           ↓                                  │
│  Feature Modules (robots, tasks, command, fleet, alerts)    │
│                           ↓                                  │
│  State Layer (Zustand stores) ←→ API Layer (Axios)          │
│                           ↓                                  │
│  WebSocket (real-time telemetry, alerts)                    │
└─────────────────────────────────────────────────────────────┘
                           ↓ REST + WebSocket
┌─────────────────────────────────────────────────────────────┐
│                     BACKEND API (External)                  │
│  /api/v1/robots, /tasks, /alerts, /auth                     │
│  WebSocket: robot.status, task.progress, alert.new          │
└─────────────────────────────────────────────────────────────┘
```

## Data Models

See `src/features/robots/types/robot.types.ts` for:
- `Robot`, `RobotStatus`, `RobotLocation`
- `RobotCommand`, `CommandInterpretation`
- `RobotTelemetry`, `BatteryTelemetry`, `SensorTelemetry`

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Framework | Tauri 2.0 | Cross-platform desktop + mobile, Rust security |
| Frontend | React 18 + TypeScript | Type safety, ecosystem, component model |
| Styling | Tailwind CSS | Utility-first, responsive, dark mode built-in |
| State | Zustand | Simple API, good devtools, middleware support |
| Data Fetching | TanStack Query | Caching, refetching, optimistic updates |
| API | Axios | Interceptors, cancelation, well-documented |
| Real-time | WebSocket | Low latency for telemetry and alerts |
| Maps | Leaflet.js | Open source, customizable, performant |
| 3D Preview | Three.js | Lighter weight than Babylon, large community |

</architecture>

---

<risks>

## Technical Risks

**Risk**: Tauri mobile support immaturity
- **Impact**: High (mobile is critical)
- **Likelihood**: Medium
- **Mitigation**: Early mobile testing, keep React Native as fallback
- **Fallback**: Web-only mobile with PWA

**Risk**: VLA model latency affects UX
- **Impact**: Medium
- **Likelihood**: Medium
- **Mitigation**: Loading states, progressive interpretation display
- **Fallback**: Local model caching, pre-built command templates

**Risk**: Real-time performance at scale (1000+ robots)
- **Impact**: High
- **Likelihood**: Medium
- **Mitigation**: Virtualized lists, WebSocket message throttling, pagination
- **Fallback**: Reduce update frequency, aggregate telemetry server-side

## Dependency Risks

**Risk**: Backend API not ready during frontend development
- **Impact**: High (blocks integration testing)
- **Mitigation**: MSW mocks from OpenAPI spec, parallel backend development

## Scope Risks

**Risk**: Safety Simulation Preview complexity
- **Impact**: Medium
- **Likelihood**: High
- **Mitigation**: Start with 2D path preview, add 3D later
- **Fallback**: Static preview image instead of animation

</risks>

---

<appendix>

## References
- [Existing PRD](docs/prd.md)
- [Architecture](docs/architecture.md)
- [Brand Guide](docs/brand.md)
- [TaskMaster RPG Template](.taskmaster/templates/example_prd_rpg.txt)

## Glossary
- **VLA**: Vision-Language-Action model (AI for NL → robot commands)
- **E-stop**: Emergency stop
- **Telemetry**: Real-time sensor data
- **Fleet**: Collection of robots in an organization

## Resolved Decisions
- **3D Rendering**: Three.js for Safety Preview (lighter weight, larger community)
- **Real-time Protocol**: WebSocket for telemetry (simpler integration, sufficient for MVP scale)
- **Voice Input**: Post-MVP (focus on text input first)

</appendix>

---

<task-master-integration>

## Parsing Notes for Task Master

1. **Capabilities** → Top-level tasks (8 capabilities = 8 main tasks)
2. **Features** → Subtasks under each capability
3. **Dependencies** → Explicit in dependency-graph section
4. **Phases** → 8 phases ordered by topological sort

## Task Graph Summary

```
Phase 0: Foundation (shared/*, api/*, store/*)
    ↓
Phase 1: Authentication (auth/*)
    ↓
Phase 2: Robot Core (robots/*)
    ↓
Phase 3: Task Management (tasks/*)  ←── depends on Phase 2
Phase 4: Telemetry & Alerts (telemetry/*, alerts/*) ←── depends on Phase 2
    ↓
Phase 5: Command Interface (command/*) ←── depends on Phases 2-4
Phase 6: Fleet Overview (fleet/*) ←── depends on Phases 2-4
    ↓
Phase 7: Cross-Platform & Polish (app/*, responsive, offline)
```

</task-master-integration>
