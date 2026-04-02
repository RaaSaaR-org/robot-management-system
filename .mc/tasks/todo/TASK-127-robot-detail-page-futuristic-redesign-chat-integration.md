---
id: TASK-127
aliases:
- TASK-127
title: Robot Detail Page — Futuristic Redesign mit Chat-Integration
slug: robot-detail-page-futuristic-redesign-chat-integration
status: todo
priority: 1
owner: ''
projects: []
customers: []
tags:
- core
- ux
- redesign
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-02
updated: 2026-04-02
---



# Robot Detail Page — Futuristic Redesign mit Chat-Integration

## Description

Complete redesign of the Robot Detail Page (`/robots/:id`) to transform it into a professional, futuristic "Robot Dashboard & Control Center". The page should feel like a mission control interface for a single robot — polished, immersive, and functional. Two main improvements: (1) a futuristic loading experience with a cool spinner that only reveals the robot once fully loaded, and (2) chat/A2A elevated to a first-class element visible from the root detail page, not buried in a tab.

## Details

### Current State

The robot detail page is a standard tab-based layout with 6 tabs (Telemetry, Commands, Tasks, Info, 3D Model, Chat). The loading state is a basic `Spinner` with text. Chat is hidden behind a tab — users must click through to interact with the robot via A2A.

**Key files (current):**
- `app/src/features/robots/pages/RobotDetailPage.tsx` — thin wrapper, extracts `robotId` from URL params
- `app/src/features/robots/components/RobotDetailPanel.tsx` — main panel with tabs, hero section, e-stop, VLA controls
- `app/src/features/robots/components/RobotHeroSection.tsx` — robot name/status/avatar header
- `app/src/features/robots/components/RobotChatPanel.tsx` — A2A chat panel (currently only shown in Chat tab)
- `app/src/features/robots/components/tabs/ChatTab.tsx` — wraps RobotChatPanel
- `app/src/features/robots/components/tabs/TelemetryTab.tsx` — live telemetry metrics
- `app/src/features/robots/components/tabs/CommandsTab.tsx` — NL command input + history
- `app/src/features/robots/components/tabs/TasksTab.tsx` — robot task list
- `app/src/features/robots/components/tabs/InfoTab.tsx` — robot metadata
- `app/src/features/robots/components/tabs/Model3DTab.tsx` — 3D viewer
- `app/src/features/robots/components/VlaControlSection.tsx` — VLA model controls

### Frontend

#### 1. Futuristic Loading Experience

Create a new `RobotLoadingScreen` component that replaces the plain Spinner:
- Full-page loading overlay with a futuristic animation (e.g., pulsing hexagonal grid, scanning line effect, or orbiting dots around a robot silhouette)
- Use CSS animations (keyframes) — no heavy animation libraries
- Show robot name/ID if available while loading
- Smooth fade-out transition when data arrives — the robot UI should "materialize"
- Only render the actual robot detail content once loading is complete (no flash of incomplete UI)
- Dark background (#141414 base) with orange (#FF6700) accent glow effects
- File: create `app/src/features/robots/components/RobotLoadingScreen.tsx`

#### 2. Chat as First-Class Element

Elevate the A2A chat from a hidden tab to a persistent, accessible element:
- Add a chat panel/sidebar that is visible on the root robot detail page — either as a collapsible right sidebar or a persistent bottom section
- The chat input should be immediately accessible without tab-switching
- Chat can be expanded/collapsed to give more space when needed
- On mobile: chat could be a floating action button (FAB) that opens a full-screen chat overlay
- Remove chat from the tab list (it's now always accessible)
- Keep using the existing `RobotChatPanel` component — just change where/how it's rendered

#### 3. Layout Redesign — "Robot Control Center"

Redesign the overall layout to feel like a professional robot control dashboard:

**Header area:**
- Compact robot identity bar: avatar/icon, name, model, status badge, connection indicator (pulsing dot), e-stop button
- Remove the large hero section — make it information-dense but elegant

**Main content area — replace tabs with a dashboard grid layout:**
- **Primary panel (left/center, ~60-70%):** Switchable between Telemetry, 3D Model, or Commands view (use a compact view switcher, not full tabs)
- **Secondary panel (right, ~30-40%):** Chat panel — always visible, scrollable, with message input at bottom
- **Quick stats bar:** Key metrics strip (battery, CPU, speed, task count) always visible below the header — small cards/pills, not full stat cards
- **VLA controls:** Integrated into the header or as a collapsible section, not a separate block

**Mobile layout:**
- Stack panels vertically: header → quick stats → main panel → FAB for chat
- Bottom nav for switching between Telemetry/3D/Commands views

**Design tokens (from `docs/brand.md`):**
- Background: `#141414`
- Accent: `#FF6700` (orange)
- Use subtle glow effects, thin borders with slight opacity, glass-morphism where appropriate
- Monospace font for data values (telemetry numbers, IDs)
- Subtle grid/scan-line background patterns for the "futuristic" feel

#### 4. Refactoring

- Extract the new layout into `RobotControlCenter.tsx` as the main component (replaces `RobotDetailPanel.tsx` content)
- Keep individual tab content components (TelemetryTab, CommandsTab, etc.) — they become "views" rendered in the main panel
- Create a `RobotQuickStats.tsx` component for the metrics strip
- Create a `RobotIdentityBar.tsx` component for the compact header
- Update `RobotDetailPage.tsx` to use the new layout

**New files to create:**
- `app/src/features/robots/components/RobotLoadingScreen.tsx`
- `app/src/features/robots/components/RobotControlCenter.tsx`
- `app/src/features/robots/components/RobotQuickStats.tsx`
- `app/src/features/robots/components/RobotIdentityBar.tsx`

**Files to modify:**
- `app/src/features/robots/components/RobotDetailPanel.tsx` — refactor to use new layout
- `app/src/features/robots/pages/RobotDetailPage.tsx` — wire up new components

## Test Strategy

1. **Visual verification:** Navigate to `/robots/:id` — loading screen should appear with futuristic animation, then smoothly transition to the control center
2. **Chat accessibility:** Chat panel should be visible and usable immediately on the root detail page without clicking any tab
3. **View switching:** Telemetry, Commands, 3D Model, and other views should switch smoothly in the main panel
4. **Quick stats:** Battery, CPU, speed, and task count should display real-time data
5. **Mobile responsive:** Layout should stack properly on mobile viewports, chat accessible via FAB
6. **Type check:** `cd app && npx tsc` passes with no errors
7. **No regressions:** All existing functionality (telemetry streaming, command execution, task list, 3D viewer, e-stop, VLA controls) still works
