# RoboMindOS Frontend Architecture

> **Stack**: React 18 + TypeScript + Tauri 2.0 + Tailwind CSS + Zustand  
> **API**: REST Backend (OpenAPI 3.1 spec)  
> **Target**: Desktop, Mobile (iOS/Android), Web

---

## Design Principles

1. **AI-Agent Friendly**: Each file has a single responsibility with clear boundaries. File headers document purpose and dependencies.
2. **Feature-First Organization**: Code grouped by domain feature, not technical layer.
3. **Colocation**: Tests, types, and utilities live next to the code they support.
4. **Explicit Over Implicit**: No magic - dependencies are imported, not injected.
5. **Backend Agnostic**: API layer abstracts REST calls; swappable for GraphQL/gRPC.

---

## Project Structure

```
src/
├── app/                        # Application shell & routing
│   ├── App.tsx                 # Root component, providers setup
│   ├── Router.tsx              # Route definitions
│   ├── providers/              # Context providers (theme, auth, etc.)
│   │   ├── index.ts
│   │   ├── AuthProvider.tsx
│   │   ├── ThemeProvider.tsx
│   │   └── ToastProvider.tsx
│   └── layouts/                # Page layout templates
│       ├── DashboardLayout.tsx
│       ├── AuthLayout.tsx
│       └── MobileLayout.tsx
│
├── features/                   # Feature modules (domain-driven)
│   ├── robots/                 # Robot management feature
│   │   ├── index.ts            # Public exports only
│   │   ├── api/                # API calls for this feature
│   │   │   ├── robotsApi.ts
│   │   │   └── robotsApi.test.ts
│   │   ├── components/         # Feature-specific components
│   │   │   ├── RobotCard.tsx
│   │   │   ├── RobotList.tsx
│   │   │   ├── RobotStatusBadge.tsx
│   │   │   └── RobotDetailPanel.tsx
│   │   ├── hooks/              # Feature-specific hooks
│   │   │   ├── useRobot.ts
│   │   │   ├── useRobotList.ts
│   │   │   └── useRobotTelemetry.ts
│   │   ├── store/              # Feature state (Zustand slice)
│   │   │   └── robotsStore.ts
│   │   ├── types/              # Feature type definitions
│   │   │   └── robot.types.ts
│   │   ├── utils/              # Feature utilities
│   │   │   └── robotHelpers.ts
│   │   └── pages/              # Route pages for this feature
│   │       ├── RobotsPage.tsx
│   │       └── RobotDetailPage.tsx
│   │
│   ├── tasks/                  # Task management feature
│   │   ├── index.ts
│   │   ├── api/
│   │   │   └── tasksApi.ts
│   │   ├── components/
│   │   │   ├── TaskCard.tsx
│   │   │   ├── TaskList.tsx
│   │   │   ├── TaskForm.tsx
│   │   │   ├── TaskTimeline.tsx
│   │   │   └── CommandInput.tsx  # Natural language command input
│   │   ├── hooks/
│   │   │   ├── useTask.ts
│   │   │   └── useTaskQueue.ts
│   │   ├── store/
│   │   │   └── tasksStore.ts
│   │   ├── types/
│   │   │   └── task.types.ts
│   │   └── pages/
│   │       └── TasksPage.tsx
│   │
│   ├── telemetry/              # Real-time sensor data feature
│   │   ├── index.ts
│   │   ├── api/
│   │   │   └── telemetryApi.ts
│   │   ├── components/
│   │   │   ├── TelemetryChart.tsx
│   │   │   ├── BatteryGauge.tsx
│   │   │   ├── JointStateVisualizer.tsx
│   │   │   ├── SensorGrid.tsx
│   │   │   └── CameraFeed.tsx
│   │   ├── hooks/
│   │   │   ├── useTelemetryStream.ts
│   │   │   └── useSensorData.ts
│   │   ├── store/
│   │   │   └── telemetryStore.ts
│   │   └── types/
│   │       └── telemetry.types.ts
│   │
│   ├── fleet/                  # Fleet overview & management
│   │   ├── index.ts
│   │   ├── components/
│   │   │   ├── FleetMap.tsx
│   │   │   ├── FleetStats.tsx
│   │   │   ├── FleetTable.tsx
│   │   │   └── ZoneOverlay.tsx
│   │   ├── hooks/
│   │   │   └── useFleetStatus.ts
│   │   ├── store/
│   │   │   └── fleetStore.ts
│   │   └── pages/
│   │       └── FleetDashboard.tsx
│   │
│   ├── alerts/                 # Alerts & notifications
│   │   ├── index.ts
│   │   ├── components/
│   │   │   ├── AlertBanner.tsx
│   │   │   ├── AlertList.tsx
│   │   │   ├── AlertDetails.tsx
│   │   │   └── EmergencyStopButton.tsx
│   │   ├── hooks/
│   │   │   └── useAlerts.ts
│   │   ├── store/
│   │   │   └── alertsStore.ts
│   │   └── types/
│   │       └── alert.types.ts
│   │
│   ├── command/                # VLA command interface
│   │   ├── index.ts
│   │   ├── api/
│   │   │   └── commandApi.ts
│   │   ├── components/
│   │   │   ├── CommandBar.tsx          # Main NL input
│   │   │   ├── CommandHistory.tsx
│   │   │   ├── CommandPreview.tsx      # Shows interpreted command
│   │   │   ├── CommandConfirmation.tsx
│   │   │   └── VoiceInput.tsx
│   │   ├── hooks/
│   │   │   ├── useCommand.ts
│   │   │   └── useVoiceRecognition.ts
│   │   ├── store/
│   │   │   └── commandStore.ts
│   │   └── types/
│   │       └── command.types.ts
│   │
│   └── auth/                   # Authentication
│       ├── index.ts
│       ├── api/
│       │   └── authApi.ts
│       ├── components/
│       │   ├── LoginForm.tsx
│       │   ├── LogoutButton.tsx
│       │   └── ProtectedRoute.tsx
│       ├── hooks/
│       │   └── useAuth.ts
│       ├── store/
│       │   └── authStore.ts
│       └── pages/
│           └── LoginPage.tsx
│
├── shared/                     # Shared code (cross-feature)
│   ├── components/             # Reusable UI components
│   │   ├── ui/                 # Primitive UI elements
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Dropdown.tsx
│   │   │   ├── Badge.tsx
│   │   │   ├── Spinner.tsx
│   │   │   ├── Skeleton.tsx
│   │   │   ├── Tabs.tsx
│   │   │   ├── Tooltip.tsx
│   │   │   └── index.ts
│   │   ├── feedback/           # User feedback components
│   │   │   ├── Toast.tsx
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── LoadingOverlay.tsx
│   │   │   └── EmptyState.tsx
│   │   ├── data-display/       # Data visualization
│   │   │   ├── DataTable.tsx
│   │   │   ├── StatCard.tsx
│   │   │   ├── ProgressBar.tsx
│   │   │   ├── Gauge.tsx
│   │   │   └── TimeSeriesChart.tsx
│   │   └── navigation/         # Navigation components
│   │       ├── Sidebar.tsx
│   │       ├── Breadcrumb.tsx
│   │       ├── NavItem.tsx
│   │       └── MobileNav.tsx
│   │
│   ├── hooks/                  # Shared hooks
│   │   ├── useApi.ts           # Base API hook with error handling
│   │   ├── useDebounce.ts
│   │   ├── useLocalStorage.ts
│   │   ├── useMediaQuery.ts
│   │   ├── useWebSocket.ts
│   │   ├── useOffline.ts
│   │   └── usePermissions.ts
│   │
│   ├── utils/                  # Utility functions
│   │   ├── formatters.ts       # Date, number, unit formatting
│   │   ├── validators.ts       # Input validation
│   │   ├── constants.ts        # App-wide constants
│   │   ├── logger.ts           # Logging utility
│   │   └── storage.ts          # LocalStorage/IndexedDB wrappers
│   │
│   └── types/                  # Shared type definitions
│       ├── api.types.ts        # API response/request types
│       ├── common.types.ts     # Common utility types
│       └── permissions.types.ts
│
├── api/                        # API layer (REST client)
│   ├── client.ts               # Axios/fetch instance config
│   ├── interceptors.ts         # Request/response interceptors
│   ├── endpoints.ts            # API endpoint constants
│   └── types/                  # Generated API types (OpenAPI)
│       └── generated.ts
│
├── store/                      # Global state management
│   ├── index.ts                # Combined store exports
│   ├── createStore.ts          # Store factory with devtools
│   ├── middleware/             # Zustand middleware
│   │   ├── persist.ts          # Persistence middleware
│   │   ├── logger.ts           # Logging middleware
│   │   └── offline.ts          # Offline queue middleware
│   └── slices/                 # Global state slices
│       ├── uiStore.ts          # UI state (sidebar, modals)
│       └── settingsStore.ts    # User preferences
│
├── styles/                     # Global styles
│   ├── globals.css             # Tailwind imports & base styles
│   ├── themes/                 # Theme configurations
│   │   ├── light.css
│   │   └── dark.css
│   └── components/             # Component-specific overrides
│       └── charts.css
│
├── assets/                     # Static assets
│   ├── icons/                  # SVG icons
│   ├── images/                 # Images
│   └── fonts/                  # Custom fonts
│
├── config/                     # Configuration files
│   ├── env.ts                  # Environment variables
│   ├── routes.ts               # Route path constants
│   ├── permissions.ts          # RBAC permission definitions
│   └── features.ts             # Feature flags
│
├── i18n/                       # Internationalization
│   ├── index.ts
│   ├── en.json
│   └── de.json
│
└── __tests__/                  # Integration & E2E tests
    ├── setup.ts
    └── integration/
```

---

## File Header Convention (AI Context)

Every file starts with a header comment for AI agent context:

```typescript
/**
 * @file RobotCard.tsx
 * @description Displays single robot status card with battery, status, and quick actions.
 * @feature robots
 * @dependencies
 *   - shared/components/ui (Button, Badge, Card)
 *   - features/robots/types/robot.types
 *   - features/robots/hooks/useRobot
 * @stateAccess robotsStore (read: selectedRobotId)
 * @apiCalls None (receives data via props)
 * @sideEffects None
 */
```

### Header Fields

| Field           | Purpose                                          |
| --------------- | ------------------------------------------------ |
| `@file`         | Filename for quick identification                |
| `@description`  | One-line purpose description                     |
| `@feature`      | Parent feature module                            |
| `@dependencies` | Internal imports this file needs                 |
| `@stateAccess`  | Which stores are read/written                    |
| `@apiCalls`     | Which API endpoints are called                   |
| `@sideEffects`  | External effects (localStorage, analytics, etc.) |

---

## Component Patterns

### Standard Component Template

```typescript
/**
 * @file RobotCard.tsx
 * @description Displays single robot status with battery level and quick actions.
 * @feature robots
 * @dependencies shared/components/ui, features/robots/types
 */

import { memo, useCallback } from 'react';
import { Card, Badge, Button } from '@/shared/components/ui';
import { BatteryGauge } from '@/features/telemetry/components/BatteryGauge';
import type { Robot, RobotStatus } from '../types/robot.types';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

interface RobotCardProps {
  /** Robot data to display */
  robot: Robot;
  /** Whether this card is currently selected */
  isSelected?: boolean;
  /** Callback when card is clicked */
  onSelect?: (robotId: string) => void;
  /** Callback for quick action button */
  onQuickAction?: (robotId: string, action: 'locate' | 'stop') => void;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STATUS_COLORS: Record<RobotStatus, string> = {
  online: 'bg-green-500',
  offline: 'bg-gray-400',
  busy: 'bg-blue-500',
  error: 'bg-red-500',
  charging: 'bg-yellow-500',
} as const;

// ============================================================================
// COMPONENT
// ============================================================================

export const RobotCard = memo(function RobotCard({
  robot,
  isSelected = false,
  onSelect,
  onQuickAction,
  className,
}: RobotCardProps) {
  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  const handleClick = useCallback(() => {
    onSelect?.(robot.id);
  }, [robot.id, onSelect]);

  const handleLocate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onQuickAction?.(robot.id, 'locate');
  }, [robot.id, onQuickAction]);

  const handleStop = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onQuickAction?.(robot.id, 'stop');
  }, [robot.id, onQuickAction]);

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <Card
      onClick={handleClick}
      className={cn(
        'p-4 cursor-pointer transition-all hover:shadow-md',
        isSelected && 'ring-2 ring-primary-500',
        className
      )}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`Robot ${robot.name}, status: ${robot.status}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
          {robot.name}
        </h3>
        <Badge className={STATUS_COLORS[robot.status]}>
          {robot.status}
        </Badge>
      </div>

      {/* Battery */}
      <div className="mb-3">
        <BatteryGauge level={robot.batteryLevel} size="sm" />
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={handleLocate}>
          Locate
        </Button>
        <Button size="sm" variant="destructive" onClick={handleStop}>
          Stop
        </Button>
      </div>
    </Card>
  );
});

// ============================================================================
// EXPORTS
// ============================================================================

export type { RobotCardProps };
```

### Component Guidelines

1. **Single Responsibility**: One component = one visual unit
2. **Props Interface First**: Define types before implementation
3. **Named Exports**: Use named exports, not default
4. **Memo by Default**: Wrap components in `memo()` for performance
5. **Section Comments**: Use separator comments for scanning
6. **Accessibility**: Include ARIA attributes and keyboard support

---

## State Management (Zustand)

### Store Structure

```typescript
/**
 * @file robotsStore.ts
 * @description Global state for robot entities and selection.
 * @feature robots
 * @stateAccess Creates: robotsStore
 * @apiCalls None (state only, API calls in hooks)
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { Robot, RobotId } from "../types/robot.types";

// ============================================================================
// TYPES
// ============================================================================

interface RobotsState {
  // Data
  robots: Map<RobotId, Robot>;
  selectedRobotId: RobotId | null;

  // UI State
  isLoading: boolean;
  error: string | null;

  // Filters
  statusFilter: Robot["status"] | "all";
  searchQuery: string;
}

interface RobotsActions {
  // CRUD
  setRobots: (robots: Robot[]) => void;
  updateRobot: (id: RobotId, updates: Partial<Robot>) => void;
  removeRobot: (id: RobotId) => void;

  // Selection
  selectRobot: (id: RobotId | null) => void;

  // Filters
  setStatusFilter: (status: Robot["status"] | "all") => void;
  setSearchQuery: (query: string) => void;

  // UI State
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Reset
  reset: () => void;
}

type RobotsStore = RobotsState & RobotsActions;

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: RobotsState = {
  robots: new Map(),
  selectedRobotId: null,
  isLoading: false,
  error: null,
  statusFilter: "all",
  searchQuery: "",
};

// ============================================================================
// STORE
// ============================================================================

export const useRobotsStore = create<RobotsStore>()(
  devtools(
    persist(
      immer((set, get) => ({
        ...initialState,

        setRobots: (robots) =>
          set((state) => {
            state.robots = new Map(robots.map((r) => [r.id, r]));
          }),

        updateRobot: (id, updates) =>
          set((state) => {
            const robot = state.robots.get(id);
            if (robot) {
              state.robots.set(id, { ...robot, ...updates });
            }
          }),

        removeRobot: (id) =>
          set((state) => {
            state.robots.delete(id);
            if (state.selectedRobotId === id) {
              state.selectedRobotId = null;
            }
          }),

        selectRobot: (id) =>
          set((state) => {
            state.selectedRobotId = id;
          }),

        setStatusFilter: (status) =>
          set((state) => {
            state.statusFilter = status;
          }),

        setSearchQuery: (query) =>
          set((state) => {
            state.searchQuery = query;
          }),

        setLoading: (loading) =>
          set((state) => {
            state.isLoading = loading;
          }),

        setError: (error) =>
          set((state) => {
            state.error = error;
          }),

        reset: () => set(initialState),
      })),
      {
        name: "robots-storage",
        partialize: (state) => ({
          selectedRobotId: state.selectedRobotId,
          statusFilter: state.statusFilter,
        }),
      },
    ),
    { name: "RobotsStore" },
  ),
);

// ============================================================================
// SELECTORS (Memoized)
// ============================================================================

export const selectRobotsList = (state: RobotsStore): Robot[] =>
  Array.from(state.robots.values());

export const selectFilteredRobots = (state: RobotsStore): Robot[] => {
  const robots = Array.from(state.robots.values());

  return robots.filter((robot) => {
    const matchesStatus =
      state.statusFilter === "all" || robot.status === state.statusFilter;
    const matchesSearch =
      !state.searchQuery ||
      robot.name.toLowerCase().includes(state.searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });
};

export const selectSelectedRobot = (state: RobotsStore): Robot | null => {
  if (!state.selectedRobotId) return null;
  return state.robots.get(state.selectedRobotId) ?? null;
};

export const selectRobotById =
  (id: RobotId) =>
  (state: RobotsStore): Robot | null =>
    state.robots.get(id) ?? null;
```

### Store Guidelines

1. **Feature Isolation**: Each feature has its own store slice
2. **Immer for Updates**: Use immer for immutable updates
3. **Selectors**: Export memoized selectors for computed data
4. **Persistence**: Only persist necessary state (not loading/error)
5. **DevTools**: Enable Redux DevTools for debugging

---

## API Layer

### API Client Configuration

```typescript
/**
 * @file client.ts
 * @description Configured Axios instance for REST API calls.
 * @dependencies axios, features/auth/store
 * @sideEffects Sets up request/response interceptors
 */

import axios, { AxiosInstance, AxiosError } from "axios";
import { env } from "@/config/env";
import { useAuthStore } from "@/features/auth/store/authStore";

// ============================================================================
// CLIENT INSTANCE
// ============================================================================

export const apiClient: AxiosInstance = axios.create({
  baseURL: env.API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// ============================================================================
// REQUEST INTERCEPTOR
// ============================================================================

apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ============================================================================
// RESPONSE INTERCEPTOR
// ============================================================================

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Token expired - attempt refresh
      const refreshed = await useAuthStore.getState().refreshToken();
      if (refreshed && error.config) {
        return apiClient.request(error.config);
      }
      // Refresh failed - logout
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  },
);
```

### Feature API Module

```typescript
/**
 * @file robotsApi.ts
 * @description API calls for robot CRUD operations.
 * @feature robots
 * @dependencies api/client, features/robots/types
 * @apiCalls GET /robots, GET /robots/:id, POST /robots/:id/command
 */

import { apiClient } from "@/api/client";
import type { Robot, RobotId, RobotCommand } from "../types/robot.types";
import type { ApiResponse, PaginatedResponse } from "@/shared/types/api.types";

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  list: "/robots",
  detail: (id: RobotId) => `/robots/${id}`,
  command: (id: RobotId) => `/robots/${id}/command`,
  telemetry: (id: RobotId) => `/robots/${id}/telemetry`,
} as const;

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const robotsApi = {
  /**
   * Fetch all robots for the current tenant.
   * @param params - Pagination and filter parameters
   */
  async list(params?: {
    page?: number;
    limit?: number;
    status?: Robot["status"];
  }): Promise<PaginatedResponse<Robot>> {
    const response = await apiClient.get<PaginatedResponse<Robot>>(
      ENDPOINTS.list,
      { params },
    );
    return response.data;
  },

  /**
   * Fetch single robot by ID.
   * @param id - Robot identifier
   */
  async get(id: RobotId): Promise<Robot> {
    const response = await apiClient.get<ApiResponse<Robot>>(
      ENDPOINTS.detail(id),
    );
    return response.data.data;
  },

  /**
   * Send command to robot.
   * @param id - Robot identifier
   * @param command - Command payload
   */
  async sendCommand(
    id: RobotId,
    command: RobotCommand,
  ): Promise<{
    taskId: string;
    estimatedDuration: number;
  }> {
    const response = await apiClient.post(ENDPOINTS.command(id), command);
    return response.data;
  },

  /**
   * Fetch telemetry snapshot for robot.
   * @param id - Robot identifier
   */
  async getTelemetry(id: RobotId): Promise<RobotTelemetry> {
    const response = await apiClient.get(ENDPOINTS.telemetry(id));
    return response.data;
  },
};
```

### Custom Hook for API Calls

```typescript
/**
 * @file useRobotList.ts
 * @description Hook for fetching and managing robot list data.
 * @feature robots
 * @dependencies features/robots/api, features/robots/store
 * @stateAccess robotsStore (write: setRobots, setLoading, setError)
 */

import { useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { robotsApi } from "../api/robotsApi";
import { useRobotsStore, selectFilteredRobots } from "../store/robotsStore";
import type { Robot, RobotCommand } from "../types/robot.types";

// ============================================================================
// QUERY KEYS
// ============================================================================

export const robotKeys = {
  all: ["robots"] as const,
  lists: () => [...robotKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) =>
    [...robotKeys.lists(), filters] as const,
  details: () => [...robotKeys.all, "detail"] as const,
  detail: (id: string) => [...robotKeys.details(), id] as const,
};

// ============================================================================
// HOOK
// ============================================================================

export function useRobotList() {
  const queryClient = useQueryClient();
  const setRobots = useRobotsStore((s) => s.setRobots);
  const statusFilter = useRobotsStore((s) => s.statusFilter);
  const filteredRobots = useRobotsStore(selectFilteredRobots);

  // --------------------------------------------------------------------------
  // Query: Fetch robots
  // --------------------------------------------------------------------------

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: robotKeys.list({ status: statusFilter }),
    queryFn: () =>
      robotsApi.list({
        status: statusFilter === "all" ? undefined : statusFilter,
      }),
    staleTime: 30_000, // 30 seconds
    refetchInterval: 60_000, // Auto-refresh every minute
  });

  // Sync to Zustand store
  useEffect(() => {
    if (data?.data) {
      setRobots(data.data);
    }
  }, [data, setRobots]);

  // --------------------------------------------------------------------------
  // Mutation: Send command
  // --------------------------------------------------------------------------

  const sendCommand = useMutation({
    mutationFn: ({
      robotId,
      command,
    }: {
      robotId: string;
      command: RobotCommand;
    }) => robotsApi.sendCommand(robotId, command),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: robotKeys.lists() });
    },
  });

  // --------------------------------------------------------------------------
  // Return
  // --------------------------------------------------------------------------

  return {
    robots: filteredRobots,
    totalCount: data?.total ?? 0,
    isLoading,
    error: error?.message ?? null,
    refetch,
    sendCommand: sendCommand.mutate,
    isSendingCommand: sendCommand.isPending,
  };
}
```

---

## Tailwind CSS Configuration

### tailwind.config.ts

```typescript
import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // ========================================
      // COLORS
      // ========================================
      colors: {
        // Brand colors
        primary: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
        // Robot status colors
        status: {
          online: "#22c55e",
          offline: "#9ca3af",
          busy: "#3b82f6",
          error: "#ef4444",
          charging: "#eab308",
        },
        // Alert severity colors
        severity: {
          critical: "#dc2626",
          warning: "#f59e0b",
          info: "#3b82f6",
        },
        // Surface colors (for dark mode)
        surface: {
          DEFAULT: "#ffffff",
          dark: "#1f2937",
        },
      },

      // ========================================
      // TYPOGRAPHY
      // ========================================
      fontFamily: {
        sans: ["Inter var", ...defaultTheme.fontFamily.sans],
        mono: ["JetBrains Mono", ...defaultTheme.fontFamily.mono],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.75rem" }],
      },

      // ========================================
      // SPACING
      // ========================================
      spacing: {
        "18": "4.5rem",
        "112": "28rem",
        "128": "32rem",
      },

      // ========================================
      // ANIMATIONS
      // ========================================
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "spin-slow": "spin 2s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },

      // ========================================
      // BREAKPOINTS
      // ========================================
      screens: {
        xs: "475px",
        "3xl": "1920px",
      },

      // ========================================
      // Z-INDEX
      // ========================================
      zIndex: {
        modal: "100",
        toast: "110",
        tooltip: "120",
        emergency: "200", // E-stop button always on top
      },
    },
  },
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/typography"),
    require("tailwindcss-animate"),
  ],
} satisfies Config;
```

### Global Styles (globals.css)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ============================================================================
   BASE STYLES
   ============================================================================ */

@layer base {
  :root {
    --color-background: 255 255 255;
    --color-foreground: 15 23 42;
    --color-primary: 59 130 246;
    --radius: 0.5rem;
  }

  .dark {
    --color-background: 15 23 42;
    --color-foreground: 248 250 252;
  }

  html {
    @apply antialiased;
    font-feature-settings: "cv02", "cv03", "cv04", "cv11";
  }

  body {
    @apply bg-surface text-gray-900 dark:bg-surface-dark dark:text-gray-100;
  }

  /* Better focus visibility */
  *:focus-visible {
    @apply outline-2 outline-offset-2 outline-primary-500;
  }
}

/* ============================================================================
   COMPONENT STYLES
   ============================================================================ */

@layer components {
  /* Card base */
  .card {
    @apply bg-white dark:bg-gray-800 rounded-lg border border-gray-200 
           dark:border-gray-700 shadow-sm;
  }

  /* Status indicator dot */
  .status-dot {
    @apply w-2 h-2 rounded-full;
  }
  .status-dot--online {
    @apply bg-status-online;
  }
  .status-dot--offline {
    @apply bg-status-offline;
  }
  .status-dot--busy {
    @apply bg-status-busy animate-pulse;
  }
  .status-dot--error {
    @apply bg-status-error animate-pulse;
  }
  .status-dot--charging {
    @apply bg-status-charging animate-pulse-slow;
  }

  /* Emergency stop button */
  .btn-emergency {
    @apply fixed bottom-6 right-6 z-emergency
           w-16 h-16 rounded-full
           bg-red-600 hover:bg-red-700 active:bg-red-800
           text-white font-bold text-lg
           shadow-lg hover:shadow-xl
           transition-all duration-150
           flex items-center justify-center;
  }

  /* Telemetry value display */
  .telemetry-value {
    @apply font-mono text-sm tabular-nums;
  }
}

/* ============================================================================
   UTILITY STYLES
   ============================================================================ */

@layer utilities {
  /* Scrollbar styling */
  .scrollbar-thin {
    scrollbar-width: thin;
  }
  .scrollbar-thin::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  .scrollbar-thin::-webkit-scrollbar-track {
    @apply bg-gray-100 dark:bg-gray-800;
  }
  .scrollbar-thin::-webkit-scrollbar-thumb {
    @apply bg-gray-300 dark:bg-gray-600 rounded-full;
  }

  /* Grid patterns for industrial dashboard look */
  .grid-dots {
    background-image: radial-gradient(
      circle,
      currentColor 1px,
      transparent 1px
    );
    background-size: 24px 24px;
  }

  /* Truncate with fade */
  .truncate-fade {
    mask-image: linear-gradient(to right, black 80%, transparent 100%);
  }
}
```

---

## Routing Structure

### routes.ts

```typescript
/**
 * @file routes.ts
 * @description Route path constants and configuration.
 * @dependencies None
 */

export const ROUTES = {
  // Auth
  LOGIN: "/login",
  LOGOUT: "/logout",

  // Dashboard
  HOME: "/",
  DASHBOARD: "/dashboard",

  // Fleet
  FLEET: "/fleet",
  FLEET_MAP: "/fleet/map",

  // Robots
  ROBOTS: "/robots",
  ROBOT_DETAIL: "/robots/:robotId",
  ROBOT_TELEMETRY: "/robots/:robotId/telemetry",
  ROBOT_TASKS: "/robots/:robotId/tasks",

  // Tasks
  TASKS: "/tasks",
  TASK_DETAIL: "/tasks/:taskId",
  TASK_CREATE: "/tasks/new",

  // Alerts
  ALERTS: "/alerts",
  ALERT_DETAIL: "/alerts/:alertId",

  // Settings
  SETTINGS: "/settings",
  SETTINGS_PROFILE: "/settings/profile",
  SETTINGS_NOTIFICATIONS: "/settings/notifications",
  SETTINGS_INTEGRATIONS: "/settings/integrations",
} as const;

// Helper to build paths with params
export function buildPath(
  route: string,
  params: Record<string, string>,
): string {
  let path = route;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`:${key}`, value);
  }
  return path;
}
```

### Router.tsx

```typescript
/**
 * @file Router.tsx
 * @description Application routing configuration.
 * @dependencies react-router-dom, features/*/pages
 */

import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { DashboardLayout } from './layouts/DashboardLayout';
import { AuthLayout } from './layouts/AuthLayout';
import { ProtectedRoute } from '@/features/auth/components/ProtectedRoute';
import { LoadingOverlay } from '@/shared/components/feedback/LoadingOverlay';
import { ROUTES } from '@/config/routes';

// Lazy-loaded pages
const LoginPage = lazy(() => import('@/features/auth/pages/LoginPage'));
const FleetDashboard = lazy(() => import('@/features/fleet/pages/FleetDashboard'));
const RobotsPage = lazy(() => import('@/features/robots/pages/RobotsPage'));
const RobotDetailPage = lazy(() => import('@/features/robots/pages/RobotDetailPage'));
const TasksPage = lazy(() => import('@/features/tasks/pages/TasksPage'));
const AlertsPage = lazy(() => import('@/features/alerts/pages/AlertsPage'));

const router = createBrowserRouter([
  // Public routes
  {
    element: <AuthLayout />,
    children: [
      { path: ROUTES.LOGIN, element: <LoginPage /> },
    ],
  },

  // Protected routes
  {
    element: (
      <ProtectedRoute>
        <DashboardLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: ROUTES.HOME, element: <Navigate to={ROUTES.DASHBOARD} replace /> },
      { path: ROUTES.DASHBOARD, element: <FleetDashboard /> },
      { path: ROUTES.FLEET, element: <FleetDashboard /> },
      { path: ROUTES.ROBOTS, element: <RobotsPage /> },
      { path: ROUTES.ROBOT_DETAIL, element: <RobotDetailPage /> },
      { path: ROUTES.TASKS, element: <TasksPage /> },
      { path: ROUTES.ALERTS, element: <AlertsPage /> },
    ],
  },

  // Catch-all
  { path: '*', element: <Navigate to={ROUTES.HOME} replace /> },
]);

export function Router() {
  return (
    <Suspense fallback={<LoadingOverlay />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
```

---

## Type Definitions

### robot.types.ts

```typescript
/**
 * @file robot.types.ts
 * @description Type definitions for robot entities.
 * @feature robots
 */

// ============================================================================
// IDENTIFIERS
// ============================================================================

export type RobotId = string & { readonly __brand: "RobotId" };
export type TenantId = string & { readonly __brand: "TenantId" };

// ============================================================================
// ENUMS
// ============================================================================

export type RobotStatus = "online" | "offline" | "busy" | "error" | "charging";

export type RobotType = "humanoid" | "mobile_base" | "arm" | "quadruped";

export type CommandPriority =
  | "emergency" // P0 - immediate
  | "high" // P1 - next available
  | "normal" // P2 - standard queue
  | "low" // P3 - when idle
  | "background"; // P4 - batch processing

// ============================================================================
// ENTITIES
// ============================================================================

export interface Robot {
  id: RobotId;
  tenantId: TenantId;
  name: string;
  type: RobotType;
  model: string;
  serialNumber: string;
  status: RobotStatus;
  batteryLevel: number; // 0-100
  lastSeen: string; // ISO timestamp
  location?: RobotLocation;
  capabilities: RobotCapability[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RobotLocation {
  x: number;
  y: number;
  z?: number;
  floor?: string;
  zone?: string;
  heading?: number; // degrees, 0-360
  accuracy?: number; // meters
}

export interface RobotCapability {
  name: string;
  enabled: boolean;
  parameters?: Record<string, unknown>;
}

// ============================================================================
// COMMANDS
// ============================================================================

export interface RobotCommand {
  type: "natural_language" | "structured";
  priority: CommandPriority;
  payload: NaturalLanguageCommand | StructuredCommand;
  timeout?: number; // seconds
  confirmationRequired?: boolean;
}

export interface NaturalLanguageCommand {
  text: string;
  context?: {
    targetObjects?: string[];
    targetLocation?: string;
    constraints?: string[];
  };
}

export interface StructuredCommand {
  action: string;
  parameters: Record<string, unknown>;
}

// ============================================================================
// COMMAND RESPONSE
// ============================================================================

export interface CommandInterpretation {
  originalInput: string;
  interpretedAction: string;
  confidence: number; // 0-1
  parameters: Record<string, unknown>;
  estimatedSteps: number;
  estimatedDuration: number; // seconds
  safetyClassification: "safe" | "requires_confirmation" | "prohibited";
  warnings?: string[];
}

// ============================================================================
// TELEMETRY
// ============================================================================

export interface RobotTelemetry {
  robotId: RobotId;
  timestamp: string;
  battery: BatteryTelemetry;
  joints?: JointTelemetry[];
  sensors: SensorTelemetry[];
  diagnostics: DiagnosticsTelemetry;
}

export interface BatteryTelemetry {
  level: number;
  voltage: number;
  current: number;
  temperature: number;
  isCharging: boolean;
  estimatedRuntime: number; // minutes
}

export interface JointTelemetry {
  name: string;
  position: number;
  velocity: number;
  effort: number;
  temperature: number;
  status: "ok" | "warning" | "error";
}

export interface SensorTelemetry {
  name: string;
  type: string;
  value: number | boolean | string;
  unit?: string;
  timestamp: string;
}

export interface DiagnosticsTelemetry {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkLatency: number;
  errors: DiagnosticError[];
}

export interface DiagnosticError {
  code: string;
  message: string;
  severity: "info" | "warning" | "error" | "critical";
  timestamp: string;
}
```

---

## AI Agent Guidelines

### Context Loading Strategy

When AI agents work with this codebase:

1. **Start with types**: Load `types/*.ts` files first to understand data shapes
2. **Then store**: Load `store/*.ts` to understand state management
3. **Then API**: Load `api/*.ts` to understand data flow
4. **Finally components**: Load components with full context

### File Discovery Commands

```bash
# Find all files for a feature
find src/features/robots -type f -name "*.ts" -o -name "*.tsx"

# Find all store files
find src -name "*Store.ts" -o -name "*store.ts"

# Find all API files
find src -name "*Api.ts" -o -name "*api.ts"

# Find all type definitions
find src -name "*.types.ts"

# Find component by name
find src -name "*RobotCard*"
```

### Recommended Context Loading

For modifying robot-related features, load in this order:

```
1. src/features/robots/types/robot.types.ts
2. src/features/robots/store/robotsStore.ts
3. src/features/robots/api/robotsApi.ts
4. src/features/robots/hooks/useRobotList.ts
5. src/features/robots/components/[target-component].tsx
```

### Code Change Patterns

**Adding a new feature**:

1. Create feature folder under `src/features/`
2. Add types first (`types/`)
3. Add store slice (`store/`)
4. Add API module (`api/`)
5. Add hooks (`hooks/`)
6. Add components (`components/`)
7. Add page (`pages/`)
8. Register routes in `Router.tsx`
9. Export public API in `index.ts`

**Adding a new component**:

1. Create file in appropriate `components/` folder
2. Add file header with metadata
3. Define props interface
4. Implement with section comments
5. Export named component and types

**Adding a new API endpoint**:

1. Add endpoint constant to feature's `api/` module
2. Add typed function to API object
3. Add corresponding hook in `hooks/`
4. Update types if new shapes needed

---

## Dependencies

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "@tanstack/react-query": "^5.56.0",
    "zustand": "^4.5.0",
    "immer": "^10.1.0",
    "axios": "^1.7.0",
    "date-fns": "^3.6.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.5.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "typescript": "^5.5.0",
    "tailwindcss": "^3.4.0",
    "@tailwindcss/forms": "^0.5.0",
    "@tailwindcss/typography": "^0.5.0",
    "tailwindcss-animate": "^1.0.0",
    "vite": "^5.4.0",
    "@vitejs/plugin-react-swc": "^3.7.0",
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0",
    "eslint": "^9.9.0",
    "prettier": "^3.3.0"
  }
}
```

---

## Quick Reference

| Concept       | Location                     | Pattern         |
| ------------- | ---------------------------- | --------------- |
| Feature code  | `src/features/{name}/`       | Domain-driven   |
| Shared UI     | `src/shared/components/`     | Atomic design   |
| Global state  | `src/store/`                 | Zustand slices  |
| Feature state | `src/features/{name}/store/` | Zustand + immer |
| API calls     | `src/features/{name}/api/`   | Axios + types   |
| Data fetching | `src/features/{name}/hooks/` | React Query     |
| Routes        | `src/config/routes.ts`       | Constants       |
| Types         | `src/features/{name}/types/` | Colocated       |
| Styles        | Tailwind classes             | Utility-first   |
