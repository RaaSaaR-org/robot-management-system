# AGENTS.md - Frontend Features

Overview of all feature modules in the frontend application.

## Feature Architecture

Each feature is a self-contained module following domain-driven design:

```
features/{feature}/
├── api/             # API calls
├── components/      # UI components
├── hooks/           # React hooks
├── pages/           # Route pages
├── store/           # Zustand store
├── types/           # TypeScript types
├── index.ts         # Public exports
└── AGENTS.md        # Feature documentation
```

## Feature Summary

| Feature | Path | Purpose | Key File |
|---------|------|---------|----------|
| **compliance** | `/compliance` | EU AI Act compliance, audit logs | `CompliancePage.tsx` |
| **explainability** | `/explainability` | AI decision transparency | `ExplainabilityPage.tsx` |
| **robots** | `/robots` | Robot management | `RobotsPage.tsx` |
| **fleet** | `/fleet` | Fleet operations | `FleetPage.tsx` |
| **command** | `/orchestrator` | Natural language commands | `CommandPage.tsx` |
| **alerts** | `/alerts` | Alert management | `AlertsPage.tsx` |
| **safety** | `/safety` | Safety monitoring | `SafetyPage.tsx` |
| **a2a** | - | A2A protocol integration | (internal) |
| **dashboard** | `/dashboard` | Main dashboard | `DashboardPage.tsx` |
| **processes** | `/processes` | Task management | `ProcessesPage.tsx` |
| **settings** | `/settings` | User settings | `SettingsPage.tsx` |
| **auth** | - | Authentication (planned) | - |

## Core Features

### Compliance & Regulatory
- **compliance**: Audit logs, hash chain, RoPA, technical docs
- **explainability**: AI decision viewer, reasoning, factors

### Robot Operations
- **robots**: Robot list, details, telemetry
- **fleet**: Fleet overview, bulk operations
- **command**: Natural language control
- **safety**: Emergency stop, safety events

### System
- **alerts**: Notifications and warnings
- **dashboard**: Overview and quick access
- **settings**: User preferences

## Development Guidelines

### Creating a New Feature

1. Create feature directory under `src/features/`
2. Add subdirectories: `api/`, `components/`, `pages/`, `store/`, `types/`
3. Create `index.ts` with public exports
4. Create `AGENTS.md` with feature documentation
5. Add route in `src/routes/`
6. Add navigation link in `Sidebar.tsx`

### Feature Store Pattern

```typescript
// store/featureStore.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface FeatureState {
  items: Item[];
  isLoading: boolean;
  fetchItems: () => Promise<void>;
}

export const useFeatureStore = create<FeatureState>()(
  immer((set) => ({
    items: [],
    isLoading: false,
    fetchItems: async () => {
      set({ isLoading: true });
      const items = await featureApi.getItems();
      set({ items, isLoading: false });
    },
  }))
);
```

### Feature API Pattern

```typescript
// api/featureApi.ts
import { apiClient } from '@/api/client';

export const featureApi = {
  async getItems(): Promise<Item[]> {
    const response = await apiClient.get<{ items: Item[] }>('/feature/items');
    return response.data.items;
  },

  async createItem(data: CreateInput): Promise<Item> {
    const response = await apiClient.post<Item>('/feature/items', data);
    return response.data;
  },
};
```

## Related Documentation

- `../../AGENTS.md` - App-level documentation
- `../../shared/AGENTS.md` - Shared components and utilities
- `../../../server/AGENTS.md` - Backend API reference
