# AGENTS.md - Frontend Application

This file provides guidance for AI agents working with the RoboMindOS frontend application.

## Overview

React + TypeScript frontend with Tauri v2 for desktop deployment. Uses Zustand for state management and Tailwind CSS for styling.

## Commands

```bash
npm run dev          # Start Vite dev server (http://localhost:1420)
npm run build        # Build frontend (TypeScript check + Vite build)
npx tsc              # Run TypeScript compiler
```

## Architecture

| Layer | Technology | Purpose |
|-------|------------|---------|
| UI Framework | React 18 | Component rendering |
| State | Zustand + Immer | Global state management |
| Styling | Tailwind CSS v4 | Utility-first CSS |
| Routing | React Router v7 | Client-side routing |
| Desktop | Tauri v2 | Native desktop wrapper |
| HTTP | Axios | API communication |

## Project Structure

```
src/
├── app/                 # App shell, providers, routing
├── features/            # Feature modules (domain-driven)
│   ├── compliance/      # EU AI Act compliance (see features/compliance/AGENTS.md)
│   ├── explainability/  # AI decision transparency
│   ├── robots/          # Robot management
│   ├── fleet/           # Fleet operations
│   ├── command/         # Natural language commands
│   ├── alerts/          # Alert system
│   ├── safety/          # Safety monitoring
│   ├── a2a/             # A2A protocol integration
│   ├── auth/            # Authentication (planned)
│   ├── dashboard/       # Main dashboard
│   ├── processes/       # Task/process management
│   └── settings/        # User settings
├── shared/              # Shared code
│   ├── components/ui/   # Reusable UI components
│   ├── hooks/           # Shared hooks
│   ├── types/           # Shared types
│   └── utils/           # Utility functions
├── api/                 # API client configuration
└── routes/              # Route definitions
```

## Feature Module Structure

Each feature follows this pattern:

```
features/{feature}/
├── api/             # API calls (featureApi.ts)
├── components/      # Feature components
├── hooks/           # Feature hooks
├── pages/           # Route pages
├── store/           # Zustand store (featureStore.ts)
├── types/           # TypeScript types
├── index.ts         # Public exports
└── AGENTS.md        # Feature-specific guidance
```

## Key Features

### Compliance (`features/compliance/`)
EU AI Act and GDPR compliance features:
- Audit log viewer with hash chain verification
- Integrity verification UI
- RoPA (Records of Processing Activities) management
- Technical documentation management
- Retention policy configuration
- Legal hold management

### Explainability (`features/explainability/`)
AI decision transparency:
- Decision viewer with reasoning display
- Confidence metrics visualization
- Factor analysis
- Decision timeline

### Robots (`features/robots/`)
Robot management:
- Robot list and detail views
- Real-time telemetry display
- Command execution
- Status monitoring

## Development Guidelines

### Implementation Order
1. **Types** - Define interfaces first
2. **Store** - Create Zustand store
3. **API** - Implement API module
4. **Hooks** - Create data fetching hooks
5. **Components** - Build UI components
6. **Pages** - Assemble pages

### Code Patterns

```typescript
// File header
/**
 * @file ComponentName.tsx
 * @description Brief description
 * @feature feature-name
 */

// Named exports only
export function ComponentName() { ... }

// Use cn() for conditional classes
import { cn } from '@/shared/utils';
className={cn('base-class', condition && 'conditional-class')}

// Zustand store with Immer
export const useFeatureStore = create<FeatureState>()(
  immer((set) => ({
    // state and actions
  }))
);
```

### Brand Colors

```
Primary: #2A5FFF (Cobalt Blue) -> primary-500
Accent: #18E4C3 (Turquoise) -> accent-500
Status:
  - Online: green-500
  - Offline: gray-400
  - Busy: blue-500
  - Error: red-500
  - Charging: yellow-500
```

## Key Dependencies

- `zustand` + `immer` - State management
- `axios` - HTTP client
- `react-router-dom` - Routing
- `@tauri-apps/api` - Tauri APIs
- `tailwind-merge` + `clsx` - CSS utilities

## Related Documentation

- `docs/app-architecture.md` - Detailed frontend architecture
- `docs/brand.md` - Design system and brand guide
- `../server/AGENTS.md` - Backend API reference
